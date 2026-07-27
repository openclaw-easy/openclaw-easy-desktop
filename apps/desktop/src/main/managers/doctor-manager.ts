import { OpenClawCommandExecutor } from './openclaw-command-executor'
import { Logger } from './logger'
import { ConfigManager } from './config-manager'
import { listAgents, setAgents, isRosterEmpty } from './agent-roster'

const ANSI_RE = /\[[0-9;]*m/g
// Strips clack-style box-drawing prefix from the start of a line. Keep
// `[]` set explicit (no shorthand) since prefixes mix multiple Unicode
// box-drawing blocks plus whitespace.
const BOX_PREFIX_RE = /^[\s│┌└├─◇◆◐◯╭╮╯╰┤┬┴┼]+/

/**
 * Parse the structured (clack-style box-drawing) output of `openclaw doctor`.
 *
 * Exported for direct unit testing. Counts:
 *   - problemsFound: distinct issue bullets across warning/error/config
 *     panels, plus one count per "Doctor changes" panel (which lists
 *     auto-fixable migrations as prose, not bullets).
 *   - problemsFixed: 0 when run without --fix; counts ✅/Applied/Fixed
 *     markers only for forward-compatibility with --fix runs.
 *
 * The 2026.5 upstream doctor switched from plain bullet output to clack
 * panels prefixed with the box-drawing vertical bar; the previous parser
 * missed every bullet because it required lines to literally START with
 * a hyphen-space.
 */
/** Severity assigned to bullets by the clack panel that contains them. */
type PanelSeverity = 'error' | 'warning' | 'preview'

/**
 * Classify a clack panel by its header line. Order matters — more
 * specific matches first.
 *
 *   "Doctor errors"   → error    (true blockers, surfaced in red)
 *   "Doctor warnings" → warning  (yellow advisories)
 *   "Doctor changes"  → preview  (auto-fixable migrations; not "problems")
 *   anything else     → warning  (generic checks are advisories, not
 *                                 blockers — previously they all counted
 *                                 as "problemsFound", inflating the badge)
 */
function classifyPanel(header: string): PanelSeverity {
  if (/^Doctor errors\b/i.test(header)) return 'error'
  if (/^Doctor warnings\b/i.test(header)) return 'warning'
  if (/^Doctor changes\b/i.test(header)) return 'preview'
  return 'warning'
}

/** Match a clack panel header: leading capitalized word(s) then box-drawing runs. */
const PANEL_HEADER_RE = /^([A-Z][\w\s/]*?)\s+[─╮╭]/

export interface DoctorParseResult {
  /** True blockers — bullets in "Doctor errors" panels or bare top-level bullets. */
  problemsFound: number
  /** Advisories — bullets in "Doctor warnings" / generic-check panels. */
  warningsFound: number
  /** "Doctor changes" entries — fixes that would apply with --fix. */
  fixesPreviewed: number
  /** Repairs already applied (only populated when doctor runs with --fix). */
  problemsFixed: number
}

export function parseDoctorOutput(output: string): DoctorParseResult {
  const cleanedLines = output
    .replace(ANSI_RE, '')
    .split('\n')
    .map((line) => line.replace(BOX_PREFIX_RE, '').trimEnd())

  let problemsFound = 0
  let warningsFound = 0
  let fixesPreviewed = 0
  let problemsFixed = 0

  // Outside any panel, default bullets to "error" — clack doctor only
  // emits bare top-level bullets for fatal pre-panel conditions.
  let currentSeverity: PanelSeverity = 'error'

  for (const line of cleanedLines) {
    const panelMatch = line.match(PANEL_HEADER_RE)
    if (panelMatch) {
      currentSeverity = classifyPanel(panelMatch[1].trim())
      // A "Doctor changes" panel without bullets still represents one
      // previewed migration (prose-style entries like
      // "openai/claude-haiku model configured, enabled automatically.").
      // Count the panel itself once; per-bullet counting below adds more.
      if (currentSeverity === 'preview') fixesPreviewed++
      continue
    }

    if (line.startsWith('- ') && !/^-\s+No\s/i.test(line)) {
      if (currentSeverity === 'error') problemsFound++
      else if (currentSeverity === 'warning') warningsFound++
      else if (currentSeverity === 'preview') fixesPreviewed++
    }

    if (/^✅|^Applied:|^Fixed:|^Repaired:/i.test(line)) {
      problemsFixed++
    }
  }

  return { problemsFound, warningsFound, fixesPreviewed, problemsFixed }
}

/**
 * DoctorManager - Manages OpenClaw doctor diagnostics
 *
 * CRITICAL: Doctor command with --fix flag can overwrite user configurations.
 * This manager backs up config before running doctor and restores user
 * settings after, in case the doctor wipes a user's selections.
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
    warningsFound: number;
    fixesPreviewed: number;
    problemsFixed: number;
    error?: string;
  }> {
    try {
      console.log('[DoctorManager] Running OpenClaw doctor...')

      let backupConfig: any = null
      try {
        backupConfig = await this.configManager.loadConfig()
        console.log('[DoctorManager] Config backed up before doctor run')
      } catch (error) {
        console.warn('[DoctorManager] Failed to backup config:', error)
      }

      // Execute doctor command WITHOUT --fix flag to avoid destructive changes.
      // 60s timeout: openclaw doctor has grown post-2026.5 — it now scans
      // 50+ plugins, 40+ skills, runs a security audit, and validates channel
      // config. Baseline is ~10s on a fresh machine, easily 30s under
      // Electron-process load. The old 15s timeout produced false
      // "Doctor failed: exit code 1" UX because spawn() killed the process
      // before it finished. Reference: plugins-manager.ts uses 60s for
      // `plugins doctor --json`.
      const result = await this.executor.executeCommand(['doctor', '--non-interactive'], 60000)

      console.log('[DoctorManager] Doctor command result:', result ? 'Success' : 'No output', result ? `(${result.length} chars)` : '')

      if (result) {
        const parsed = parseDoctorOutput(result)
        const { problemsFound, warningsFound, fixesPreviewed, problemsFixed } = parsed

        console.log('[DoctorManager] Doctor parsing result:', parsed)

        // Restore user configuration if doctor wiped important settings.
        if (backupConfig) {
          try {
            const currentConfig = await this.configManager.loadConfig()
            let needsRestore = false
            const restoreConfig = { ...currentConfig }

            const backupModel = backupConfig.agents?.defaults?.model?.primary
            const currentModel = currentConfig.agents?.defaults?.model?.primary
            if (backupModel && !currentModel) {
              console.log('[DoctorManager] Restoring lost model config:', backupModel)
              restoreConfig.agents = restoreConfig.agents || {}
              restoreConfig.agents.defaults = restoreConfig.agents.defaults || {}
              restoreConfig.agents.defaults.model = restoreConfig.agents.defaults.model || {}
              restoreConfig.agents.defaults.model.primary = backupModel
              needsRestore = true
              this.logger.addLog(`\u{1F527} Restored model config: ${backupModel}`)
            }

            // Compare through the shared accessor so a backup written in the
            // legacy array shape still restores into canonical agents.entries.
            const backupAgents = listAgents(backupConfig)
            if (backupAgents.length > 0 && isRosterEmpty(currentConfig)) {
              console.log('[DoctorManager] Restoring lost agent roster')
              setAgents(restoreConfig, backupAgents)
              needsRestore = true
              this.logger.addLog('\u{1F527} Restored agent roster')
            }

            if (needsRestore) {
              await this.configManager.writeConfig(restoreConfig)
              this.logger.addLog('✅ User configuration restored after doctor run')
            }
          } catch (error) {
            console.error('[DoctorManager] Failed to restore config after doctor:', error)
            this.logger.addLog('⚠️ Failed to restore user config - please check openclaw.json')
          }
        }

        this.logger.addLog(
          `✅ Doctor completed — ${problemsFound} error(s), ${warningsFound} warning(s), ${fixesPreviewed} migration(s) previewed`,
        )

        return {
          success: true,
          output: result,
          errors: '',
          problemsFound,
          warningsFound,
          fixesPreviewed,
          problemsFixed,
        }
      } else {
        console.log('[DoctorManager] Doctor command returned no output')
        this.logger.addLog('❌ Doctor failed: No output received')

        return {
          success: false,
          output: '',
          errors: 'No output received from doctor command',
          problemsFound: 0,
          warningsFound: 0,
          fixesPreviewed: 0,
          problemsFixed: 0,
          error: 'Doctor command returned no output',
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
        warningsFound: 0,
        fixesPreviewed: 0,
        problemsFixed: 0,
        error: error.message || 'Doctor command failed',
      }
    }
  }
}
