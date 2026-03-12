import { app } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

export interface AppSettings {
  startOnBoot: boolean
  minimizeToTray: boolean
  autoUpdate: boolean
  telemetry: boolean
  language: string
  version?: string
  lastUpdated?: string
}

const DEFAULT_SETTINGS: AppSettings = {
  startOnBoot: false,
  minimizeToTray: true,
  autoUpdate: true,
  telemetry: false,
  language: 'en',
  version: '1.0.0'
}

export class SettingsManager {
  private settingsPath: string
  private settings: AppSettings | null = null
  private cachedMinimizeToTray: boolean | null = null

  constructor() {
    const openclawDir = path.join(os.homedir(), '.openclaw')
    this.settingsPath = path.join(openclawDir, 'desktop-settings.json')
  }

  async ensureSettingsDir(): Promise<void> {
    const dir = path.dirname(this.settingsPath)
    try {
      await fs.mkdir(dir, { recursive: true })
    } catch (error) {
      console.error('[SettingsManager] Failed to create settings directory:', error)
    }
  }

  async getSettings(): Promise<AppSettings> {
    if (this.settings) {
      return this.settings
    }

    try {
      await this.ensureSettingsDir()
      const data = await fs.readFile(this.settingsPath, 'utf-8')
      this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(data) }
      this.cachedMinimizeToTray = this.settings.minimizeToTray
      return this.settings
    } catch (error) {
      // File doesn't exist or is invalid, use defaults
      console.log('[SettingsManager] Using default settings')
      this.settings = { ...DEFAULT_SETTINGS }
      this.cachedMinimizeToTray = this.settings.minimizeToTray
      await this.saveSettings()
      return this.settings
    }
  }

  async saveSettings(): Promise<void> {
    if (!this.settings) {
      return
    }

    try {
      await this.ensureSettingsDir()
      this.settings.lastUpdated = new Date().toISOString()
      await fs.writeFile(
        this.settingsPath,
        JSON.stringify(this.settings, null, 2),
        'utf-8'
      )
      console.log('[SettingsManager] Settings saved successfully')
    } catch (error) {
      console.error('[SettingsManager] Failed to save settings:', error)
      throw error
    }
  }

  async updateSettings(updates: Partial<AppSettings>): Promise<void> {
    const current = await this.getSettings()
    this.settings = { ...current, ...updates }
    await this.saveSettings()
  }

  async setStartOnBoot(enabled: boolean): Promise<{ success: boolean; error?: string }> {
    try {
      // Update Electron's login item settings
      app.setLoginItemSettings({
        openAtLogin: enabled,
        openAsHidden: false,
        ...(process.platform === 'darwin' ? { type: 'mainAppService' } : {}),
        ...(process.platform === 'win32' ? { path: process.execPath, args: [] } : {})
      })

      // Save to settings file
      await this.updateSettings({ startOnBoot: enabled })

      console.log(`[SettingsManager] Start on boot ${enabled ? 'enabled' : 'disabled'}`)
      return { success: true }
    } catch (error: any) {
      console.error('[SettingsManager] Failed to set start on boot:', error)
      return { success: false, error: error.message }
    }
  }

  async getStartOnBootStatus(): Promise<boolean> {
    const settings = await this.getSettings()
    return settings.startOnBoot
  }

  async setMinimizeToTray(enabled: boolean): Promise<void> {
    await this.updateSettings({ minimizeToTray: enabled })
    this.cachedMinimizeToTray = enabled
    console.log(`[SettingsManager] Minimize to tray ${enabled ? 'enabled' : 'disabled'}`)
  }

  async getMinimizeToTray(): Promise<boolean> {
    const settings = await this.getSettings()
    return settings.minimizeToTray
  }

  /**
   * Synchronous getter for use in Electron event handlers where
   * event.preventDefault() must be called synchronously.
   * Returns the cached value, or the default (true) if not yet loaded.
   */
  getMinimizeToTraySync(): boolean {
    if (this.cachedMinimizeToTray !== null) {
      return this.cachedMinimizeToTray
    }
    // Settings not loaded yet — default is true (minimize to tray)
    return DEFAULT_SETTINGS.minimizeToTray
  }

  async setAutoUpdate(enabled: boolean): Promise<void> {
    await this.updateSettings({ autoUpdate: enabled })
    console.log(`[SettingsManager] Auto-update ${enabled ? 'enabled' : 'disabled'}`)
  }

  async getAutoUpdate(): Promise<boolean> {
    const settings = await this.getSettings()
    return settings.autoUpdate
  }

  async setTelemetry(enabled: boolean): Promise<void> {
    await this.updateSettings({ telemetry: enabled })
    console.log(`[SettingsManager] Telemetry ${enabled ? 'enabled' : 'disabled'}`)
  }

  async getTelemetry(): Promise<boolean> {
    const settings = await this.getSettings()
    return settings.telemetry
  }

  async setLanguage(language: string): Promise<void> {
    await this.updateSettings({ language })
    console.log(`[SettingsManager] Language set to ${language}`)
  }

  async getLanguage(): Promise<string> {
    const settings = await this.getSettings()
    return settings.language || 'en'
  }

  async applyStartupSettings(): Promise<void> {
    try {
      const settings = await this.getSettings()

      // Apply start on boot setting
      if (settings.startOnBoot !== undefined) {
        app.setLoginItemSettings({
          openAtLogin: settings.startOnBoot,
          openAsHidden: false,
          ...(process.platform === 'darwin' ? { type: 'mainAppService' } : {}),
          ...(process.platform === 'win32' ? { path: process.execPath, args: [] } : {})
        })
      }

      console.log('[SettingsManager] Startup settings applied')
    } catch (error) {
      console.error('[SettingsManager] Failed to apply startup settings:', error)
    }
  }
}
