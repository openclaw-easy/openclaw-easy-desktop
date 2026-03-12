import * as path from 'path'
import * as os from 'os'
import { readFile, writeFile } from 'fs/promises'
import { OpenClawCommandExecutor } from './openclaw-command-executor'

/**
 * HooksManager - Manages OpenClaw hooks (event-driven automation)
 */
export class HooksManager {
  private executor: OpenClawCommandExecutor

  constructor(executor: OpenClawCommandExecutor) {
    this.executor = executor
  }

  /**
   * Extract the first complete JSON object or array from a string that may
   * contain ANSI escape codes, box-drawing art, or other CLI noise.
   */
  private extractJson(raw: string): string {
    // Strip ANSI escape codes
    const stripped = raw.replace(/\x1b\[[0-9;]*[mGKHFABCDsuJK]/g, '')

    const objStart = stripped.indexOf('{')
    const arrStart = stripped.indexOf('[')

    let start: number
    if (objStart === -1 && arrStart === -1) { return stripped.trim() }
    if (objStart === -1) { start = arrStart }
    else if (arrStart === -1) { start = objStart }
    else { start = Math.min(objStart, arrStart) }

    const closing = stripped[start] === '{' ? '}' : ']'
    const end = stripped.lastIndexOf(closing)
    if (end === -1) { return stripped.trim() }

    return stripped.substring(start, end + 1)
  }

  async listHooks(): Promise<{ success: boolean; hooks?: any[]; error?: string }> {
    try {
      console.log('[HooksManager] Getting hooks list...')
      const result = await this.executor.executeCommand(['hooks', 'list', '--json'], 30000)

      if (result) {
        console.log(`[HooksManager] Raw output length: ${result.length} chars`)
        const jsonStr = this.extractJson(result)
        const data = JSON.parse(jsonStr)
        const hooks = data.hooks || data || []
        return { success: true, hooks: Array.isArray(hooks) ? hooks : [] }
      }

      return { success: false, error: 'No hooks data received' }
    } catch (error: any) {
      console.error('[HooksManager] Error listing hooks:', error)
      return { success: false, error: error.message || 'Failed to list hooks' }
    }
  }

  async checkHooks(): Promise<{ success: boolean; status?: any; error?: string }> {
    try {
      console.log('[HooksManager] Checking hooks status...')
      const result = await this.executor.executeCommand(['hooks', 'check', '--json'], 30000)

      if (result) {
        const status = JSON.parse(this.extractJson(result))
        return { success: true, status }
      }

      return { success: false, error: 'No hooks status data received' }
    } catch (error: any) {
      console.error('[HooksManager] Error checking hooks:', error)
      return { success: false, error: error.message || 'Failed to check hooks' }
    }
  }

  async getHookInfo(hookName: string): Promise<{ success: boolean; info?: any; error?: string }> {
    try {
      console.log(`[HooksManager] Getting info for hook: ${hookName}`)
      const result = await this.executor.executeCommand(['hooks', 'info', hookName, '--json'])

      if (result) {
        const info = JSON.parse(this.extractJson(result))
        return { success: true, info }
      }

      return { success: false, error: 'No hook info received' }
    } catch (error: any) {
      console.error(`[HooksManager] Error getting hook info for ${hookName}:`, error)
      return { success: false, error: error.message || 'Failed to get hook info' }
    }
  }

  /**
   * Install a hook pack from npm or a local path.
   * Runs: openclaw hooks install <spec>
   */
  async installHook(hookSpec: string): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      console.log(`[HooksManager] Installing hook: ${hookSpec}`)
      const result = await this.executor.executeCommand(['hooks', 'install', hookSpec], 120000)
      return { success: true, message: result || `Hook "${hookSpec}" installed successfully` }
    } catch (error: any) {
      console.error(`[HooksManager] Error installing hook ${hookSpec}:`, error)
      return { success: false, error: error.message || 'Failed to install hook' }
    }
  }

  /**
   * Enable or disable a hook.
   *
   * Disable: uses `openclaw hooks disable <name>` (CLI supports it cleanly).
   * Enable: writes directly to openclaw.json because the CLI refuses to enable
   * a hook that is currently marked disabled (it treats disabled → ineligible,
   * blocking the enable command with "not eligible").
   */
  async setHookEnabled(hookName: string, enabled: boolean): Promise<{ success: boolean; error?: string }> {
    if (!enabled) {
      // Disable via CLI — works fine
      try {
        console.log(`[HooksManager] Disabling hook "${hookName}" via CLI`)
        await this.executor.executeCommand(['hooks', 'disable', hookName], 15000)
        return { success: true }
      } catch (error: any) {
        console.error(`[HooksManager] Error disabling hook ${hookName}:`, error)
        return { success: false, error: error.message || 'Failed to disable hook' }
      }
    }

    // Enable: patch the config directly to remove the disabled flag.
    // The CLI blocks re-enabling a disabled hook because it marks it ineligible.
    try {
      console.log(`[HooksManager] Enabling hook "${hookName}" via config patch`)
      const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
      const raw = await readFile(configPath, 'utf8')
      let config: any
      try { config = JSON.parse(raw) } catch { return { success: false, error: 'Config file contains invalid JSON' } }

      const entries = config?.hooks?.internal?.entries
      if (entries && entries[hookName]) {
        // Remove the entry entirely — absence means "use default" (enabled)
        delete entries[hookName]
        // If entries is now empty, clean up to keep config tidy
        if (Object.keys(entries).length === 0) {
          delete config.hooks.internal.entries
        }
      }
      // If no entry exists at all, the hook is already enabled by default — nothing to do

      await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8')
      console.log(`[HooksManager] Hook "${hookName}" enabled via config patch`)
      return { success: true }
    } catch (error: any) {
      console.error(`[HooksManager] Error enabling hook ${hookName} via config:`, error)
      return { success: false, error: error.message || 'Failed to enable hook' }
    }
  }
}
