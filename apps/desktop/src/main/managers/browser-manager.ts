import * as nodePath from 'path'
import { readFile, stat } from 'fs/promises'
import type { ConfigManager } from './config-manager'
import type { OpenClawCommandExecutor } from './openclaw-command-executor'

/** Narrow seams so tests can inject fakes without Electron. */
type ConfigStore = Pick<ConfigManager, 'mutateConfig'>
type CommandRunner = Pick<OpenClawCommandExecutor, 'executeCommand'>

/**
 * Desktop surface for OpenClaw's dedicated browser (the `browser` tool).
 * The gateway's browser plugin owns the runtime; the CLI is the supported
 * client (`openclaw browser status/start/stop/screenshot`, all local to the
 * gateway host). The only config this panel writes is `browser.enabled`
 * (root key, see upstream src/config/zod-schema.root-shape.ts).
 */

export interface BrowserStatus {
  enabled: boolean
  running: boolean
  profile?: string
  detectedBrowser?: string | null
  detectedExecutablePath?: string | null
  chosenBrowser?: string | null
  headless?: boolean
  cdpPort?: number
  pid?: number | null
}

export class BrowserManager {
  constructor(
    private configManager: ConfigStore,
    private executor: CommandRunner,
  ) {}

  async getStatus(): Promise<{ success: boolean; status?: BrowserStatus; error?: string }> {
    try {
      const result = await this.executor.executeCommand(['browser', 'status', '--json'], 20000)
      if (!result) return { success: false, error: 'No status output from browser CLI' }
      const raw = JSON.parse(result)
      return {
        success: true,
        status: {
          enabled: raw.enabled !== false,
          running: raw.running === true,
          profile: raw.profile,
          detectedBrowser: raw.detectedBrowser ?? null,
          detectedExecutablePath: raw.detectedExecutablePath ?? null,
          chosenBrowser: raw.chosenBrowser ?? null,
          headless: raw.headless === true,
          cdpPort: raw.cdpPort,
          pid: raw.pid ?? null,
        },
      }
    } catch (error: any) {
      console.error('[BrowserManager] Failed to get status:', error)
      return { success: false, error: error.message || 'Failed to get browser status' }
    }
  }

  /**
   * Writes `browser.enabled`. `changed` tells the caller whether a gateway
   * restart is owed: plugin activation reads this at server bootstrap
   * (upstream server-plugin-bootstrap.ts applyPluginAutoEnable), so a live
   * gateway keeps the old state until it reloads.
   */
  async setEnabled(enabled: boolean): Promise<{ success: boolean; changed?: boolean; error?: string }> {
    try {
      const changed = await this.configManager.mutateConfig((config: any) => {
        const current = config.browser && typeof config.browser === 'object' ? config.browser : {}
        if (current.enabled === enabled) return false
        config.browser = { ...current, enabled }
        return true
      })
      return { success: true, changed }
    } catch (error: any) {
      console.error('[BrowserManager] Failed to set enabled:', error)
      return { success: false, error: error.message || 'Failed to update browser config' }
    }
  }

  async start(): Promise<{ success: boolean; error?: string }> {
    try {
      // Browser launch can take a while on first run (profile creation).
      await this.executor.executeCommand(['browser', 'start'], 60000)
      return { success: true }
    } catch (error: any) {
      console.error('[BrowserManager] Failed to start browser:', error)
      return { success: false, error: error.message || 'Failed to start browser' }
    }
  }

  async stop(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.executor.executeCommand(['browser', 'stop'], 30000)
      return { success: true }
    } catch (error: any) {
      console.error('[BrowserManager] Failed to stop browser:', error)
      return { success: false, error: error.message || 'Failed to stop browser' }
    }
  }

  /**
   * Capture a screenshot; the CLI prints the saved file path. The image is
   * returned inline as a data URL — the renderer cannot read arbitrary
   * file:// paths (webSecurity), and 'show in folder' was removed as an
   * unvalidated IPC surface.
   */
  async screenshot(): Promise<{ success: boolean; path?: string; dataUrl?: string; error?: string }> {
    try {
      const output = await this.executor.executeCommand(['browser', 'screenshot'], 30000)
      const path = output
        ?.split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        // The path is the last line that looks like an absolute path. Test
        // both flavours explicitly: a POSIX-only check ("/…") silently never
        // matches the "C:\…" the CLI prints on Windows, which made the whole
        // screenshot feature fail there with "produced no file path".
        .reverse()
        .find((l) => nodePath.win32.isAbsolute(l) || nodePath.posix.isAbsolute(l))
      if (!path) return { success: false, error: 'Screenshot command produced no file path' }
      const info = await stat(path)
      // Screenshots are PNGs of one viewport; anything huge is unexpected.
      if (info.size > 20 * 1024 * 1024) {
        return { success: true, path }
      }
      const dataUrl = `data:image/png;base64,${(await readFile(path)).toString('base64')}`
      return { success: true, path, dataUrl }
    } catch (error: any) {
      console.error('[BrowserManager] Failed to capture screenshot:', error)
      return { success: false, error: error.message || 'Failed to capture screenshot' }
    }
  }
}
