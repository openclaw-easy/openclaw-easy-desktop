import { OpenClawCommandExecutor } from './openclaw-command-executor'
import { ConfigManager } from './config-manager'

/**
 * PluginsManager - Manages OpenClaw plugins
 */
export class PluginsManager {
  private executor: OpenClawCommandExecutor
  private configManager: ConfigManager

  constructor(executor: OpenClawCommandExecutor, configManager: ConfigManager) {
    this.executor = executor
    this.configManager = configManager
  }

  /**
   * Extract the first complete JSON object or array from a string that may
   * contain ANSI escape codes, Bun/Node runtime warnings, or other extra text.
   */
  private extractJson(raw: string): string {
    // Strip ANSI escape codes
    const stripped = raw.replace(/\x1b\[[0-9;]*[mGKHFABCDsuJK]/g, '')

    // Find the outermost JSON object or array
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

  async listPlugins(): Promise<{ success: boolean; plugins?: any[]; error?: string }> {
    try {
      console.log('[PluginsManager] Getting plugins list...')
      const result = await this.executor.executeCommand(['plugins', 'list', '--json'], 30000)

      if (result) {
        console.log(`[PluginsManager] Raw output length: ${result.length} chars`)
        const jsonStr = this.extractJson(result)
        const data = JSON.parse(jsonStr)
        const plugins = data.plugins || data || []
        return {
          success: true,
          plugins: Array.isArray(plugins) ? plugins : []
        }
      }

      return { success: false, error: 'No plugins data received' }
    } catch (error: any) {
      console.error('[PluginsManager] Error listing plugins:', error)
      return { success: false, error: error.message || 'Failed to list plugins' }
    }
  }

  async getPluginInfo(pluginId: string): Promise<{ success: boolean; info?: any; error?: string }> {
    try {
      console.log(`[PluginsManager] Getting info for plugin: ${pluginId}`)
      const result = await this.executor.executeCommand(['plugins', 'info', pluginId, '--json'])

      if (result) {
        const info = JSON.parse(this.extractJson(result))
        return { success: true, info }
      }

      return { success: false, error: 'No plugin info received' }
    } catch (error: any) {
      console.error(`[PluginsManager] Error getting plugin info for ${pluginId}:`, error)
      return { success: false, error: error.message || 'Failed to get plugin info' }
    }
  }

  async enablePlugin(pluginId: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`[PluginsManager] Enabling plugin: ${pluginId}`)
      await this.executor.executeCommand(['plugins', 'enable', pluginId], 15000)
      return { success: true }
    } catch (error: any) {
      console.error(`[PluginsManager] Error enabling plugin ${pluginId}:`, error)
      return { success: false, error: error.message || 'Failed to enable plugin' }
    }
  }

  async disablePlugin(pluginId: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`[PluginsManager] Disabling plugin: ${pluginId}`)
      await this.executor.executeCommand(['plugins', 'disable', pluginId], 15000)
      return { success: true }
    } catch (error: any) {
      console.error(`[PluginsManager] Error disabling plugin ${pluginId}:`, error)
      return { success: false, error: error.message || 'Failed to disable plugin' }
    }
  }

  async installPlugin(pluginSpec: string): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      console.log(`[PluginsManager] Installing plugin: ${pluginSpec}`)
      // Installation can take a while (npm install)
      const result = await this.executor.executeCommand(['plugins', 'install', pluginSpec], 120000)
      return { success: true, message: result || `Plugin "${pluginSpec}" installed successfully` }
    } catch (error: any) {
      console.error(`[PluginsManager] Error installing plugin ${pluginSpec}:`, error)
      return { success: false, error: error.message || 'Failed to install plugin' }
    }
  }

  async updatePlugin(pluginId: string): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      console.log(`[PluginsManager] Updating plugin: ${pluginId}`)
      const result = await this.executor.executeCommand(['plugins', 'update', pluginId], 120000)
      return { success: true, message: result || `Plugin "${pluginId}" updated successfully` }
    } catch (error: any) {
      console.error(`[PluginsManager] Error updating plugin ${pluginId}:`, error)
      return { success: false, error: error.message || 'Failed to update plugin' }
    }
  }

  async runPluginsDoctor(): Promise<{ success: boolean; results?: any; error?: string }> {
    try {
      console.log('[PluginsManager] Running plugins doctor...')
      const result = await this.executor.executeCommand(['plugins', 'doctor', '--json'], 60000)

      if (result) {
        const results = JSON.parse(this.extractJson(result))
        return { success: true, results }
      }

      return { success: false, error: 'No doctor results received' }
    } catch (error: any) {
      console.error('[PluginsManager] Error running plugins doctor:', error)
      return { success: false, error: error.message || 'Failed to run plugins doctor' }
    }
  }
}
