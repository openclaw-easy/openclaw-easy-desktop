import { OpenClawCommandExecutor } from './openclaw-command-executor'
import { Logger } from './logger'
import { ConfigManager } from './config-manager'

/**
 * DoctorManager - Manages OpenClaw doctor diagnostics
 *
 * CRITICAL: Doctor command with --fix flag can overwrite user configurations.
 * This manager now backs up config before running doctor and restores user settings after.
 */
export class DoctorManager {
  private executor: OpenClawCommandExecutor
  private logger: Logger
  private configManager: ConfigManager

  constructor(executor: OpenClawCommandExecutor, logger: Logger, configManager: ConfigManager) {
    this.executor = executor
    this.logger = logger
    this.configManager = configManager
  }

  async runDoctor(): Promise<{
    success: boolean;
    output: string;
    errors: string;
    problemsFound: number;
    problemsFixed: number;
    error?: string;
  }> {
    try {
      console.log('[DoctorManager] Running OpenClaw doctor...')

      // CRITICAL: Backup user configuration before running doctor
      let backupConfig: any = null
      try {
        backupConfig = await this.configManager.loadConfig()
        console.log('[DoctorManager] Config backed up before doctor run')
      } catch (error) {
        console.warn('[DoctorManager] Failed to backup config:', error)
      }

      // Execute doctor command WITHOUT --fix flag to avoid destructive changes
      // Use read-only mode to just diagnose issues
      const result = await this.executor.executeCommand(['doctor', '--non-interactive'], 15000) // 15 second timeout

      console.log('[DoctorManager] Doctor command result:', result ? 'Success' : 'No output', result ? `(${result.length} chars)` : '')

      if (result) {
        // Parse the structured doctor output
        const { problemsFound, problemsFixed } = this.parseDoctorOutput(result)

        console.log('[DoctorManager] Doctor parsing result:', { problemsFound, problemsFixed })

        // CRITICAL: Restore user configuration if doctor modified it
        // Check if important user settings were lost and restore them
        if (backupConfig) {
          try {
            const currentConfig = await this.configManager.loadConfig()
            let needsRestore = false
            const restoreConfig = { ...currentConfig }

            // Preserve user's model selection if it was lost
            const backupModel = backupConfig.agents?.defaults?.model?.primary
            const currentModel = currentConfig.agents?.defaults?.model?.primary
            if (backupModel && !currentModel) {
              console.log('[DoctorManager] Restoring lost model config:', backupModel)
              restoreConfig.agents = restoreConfig.agents || {}
              restoreConfig.agents.defaults = restoreConfig.agents.defaults || {}
              restoreConfig.agents.defaults.model = restoreConfig.agents.defaults.model || {}
              restoreConfig.agents.defaults.model.primary = backupModel
              needsRestore = true
              this.logger.addLog(`🔧 Restored model config: ${backupModel}`)
            }

            // Preserve agents.list if it was lost
            const backupAgents = backupConfig.agents?.list
            const currentAgents = currentConfig.agents?.list
            if (backupAgents && (!currentAgents || currentAgents.length === 0)) {
              console.log('[DoctorManager] Restoring lost agents.list')
              restoreConfig.agents = restoreConfig.agents || {}
              restoreConfig.agents.list = backupAgents
              needsRestore = true
              this.logger.addLog('🔧 Restored agents.list')
            }

            // Write restored config if needed
            if (needsRestore) {
              await this.configManager.writeConfig(restoreConfig)
              this.logger.addLog('✅ User configuration restored after doctor run')
            }
          } catch (error) {
            console.error('[DoctorManager] Failed to restore config after doctor:', error)
            this.logger.addLog('⚠️ Failed to restore user config - please check openclaw.json')
          }
        }

        this.logger.addLog(`✅ Doctor completed - Found: ${problemsFound} issue(s)`)

        return {
          success: true,
          output: result,
          errors: '',
          problemsFound,
          problemsFixed
        }
      } else {
        console.log('[DoctorManager] Doctor command returned no output')
        this.logger.addLog('❌ Doctor failed: No output received')

        return {
          success: false,
          output: '',
          errors: 'No output received from doctor command',
          problemsFound: 0,
          problemsFixed: 0,
          error: 'Doctor command returned no output'
        }
      }

    } catch (error: any) {
      console.error('[DoctorManager] Error running doctor:', error)
      this.logger.addLog(`❌ Doctor failed: ${error.message}`)

      return {
        success: false,
        output: '',
        errors: error.message || 'Unknown error occurred',
        problemsFound: 0,
        problemsFixed: 0,
        error: error.message || 'Doctor command failed'
      }
    }
  }

  private parseDoctorOutput(output: string): { problemsFound: number; problemsFixed: number } {
    const lines = output.split('\n')
    let problemsFound = 0
    let problemsFixed = 0

    for (const line of lines) {
      const trimmed = line.trim()

      // Count issues/warnings in bullet points
      if (trimmed.startsWith('- ') && !trimmed.includes('No ')) {
        if (trimmed.includes('missing') || trimmed.includes('error') ||
            trimmed.includes('failed') || trimmed.includes('warning') ||
            trimmed.includes('recommend') || trimmed.includes('issue')) {
          problemsFound++
        }
      }

      // Look for fix indicators
      if (trimmed.includes('✅') || trimmed.includes('Fixed:') ||
          trimmed.includes('Repaired:') || trimmed.includes('Applied:')) {
        problemsFixed++
      }
    }

    return { problemsFound, problemsFixed }
  }
}
