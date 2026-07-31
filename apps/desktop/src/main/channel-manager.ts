import { spawn, ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { BrowserWindow } from 'electron'
import * as path from 'path'
import { OpenClawEnvironment } from './openclaw-environment'
import { ConfigManager } from './managers/config-manager'
import { resolveAgentHarness, readExecContextForAgent } from './agent-harness'
import { detectSystemOpenClaw } from './managers/system-openclaw-resolver'
import { getDevOpenClawSpawn, isPathResolvedRuntime } from './dev-openclaw-runtime'
import {
  setAgentRuntime,
  getAgentRuntime,
} from './managers/agent-runtime-config'
import { listAgents, getAgent, ensureAgent, deleteAgent } from './managers/agent-roster'
import { repairInstalledWeixinPlugin } from './managers/weixin-plugin-repair'

/**
 * Strip ANSI escape codes (color, cursor, mode) from a string. The openclaw
 * CLI wraps each WhatsApp QR row with `\x1b[47m\x1b[30m...\x1b[0m` (white
 * background, black foreground) so the QR scans cleanly in a real terminal.
 * In the desktop renderer we render to HTML and the escape codes show up
 * literally, breaking both the look and the QR's machine-readability.
 */
export function stripAnsi(s: string): string {
  // Covers CSI (ESC [ ...), OSC (ESC ] ... BEL/ST), and standalone ESC sequences
  // commonly used by chalk/ansi-colors. The CSI form is what whatsapp-web.js
  // and qrcode-terminal emit; the others are belt-and-suspenders.
  return s
    .replace(/\[[0-9;?]*[ -/]*[@-~]/g, '') // CSI sequences
    .replace(/\][^]*(|\\)/g, '') // OSC sequences
    .replace(/[@-Z\\-_]/g, '') // Other Fe escape sequences
}

/**
 * Extract the QR-art block from a buffer of CLI stdout. Returns the QR as a
 * clean (ANSI-stripped) joined string, or null if no contiguous block of
 * QR-glyph lines is found.
 *
 * Robust to stdout chunking: callers buffer all stdout and re-run this on
 * each new chunk. The previous per-chunk check
 * (`text.includes('█') && text.includes('▄')`) silently failed whenever
 * pty/pipe buffering split the QR across two `data` events — the most
 * common reason customers reported "QR doesn't generate" in the UI.
 */
/**
 * Weixin ships as an external official plugin, so its npm spec and ids are
 * pinned here from scripts/lib/official-external-channel-catalog.json. Keep
 * them in sync with that catalog on upstream syncs — a stale spec silently
 * installs an old plugin.
 */
export const WEIXIN_CHANNEL_ID = 'openclaw-weixin'
export const WEIXIN_PLUGIN_ID = 'openclaw-weixin'
export const WEIXIN_NPM_SPEC = '@tencent-weixin/openclaw-weixin'

let weixinPty: { kill: () => void; write: (data: string) => void } | null = null
let weixinOperationInProgress = false

/**
 * Extracts a terminal-rendered QR (half-block glyphs) from buffered CLI
 * output. Channel-agnostic: WhatsApp and Weixin both render the same way.
 */
export function extractTerminalQr(buffer: string): string | null {
  const stripped = stripAnsi(buffer)
  const lines = stripped.split('\n')
  // QR uses half-block glyphs: ▀ ▄ █ plus space-padding on the row edges.
  const isQrLine = (l: string) => /[▀▄█]/.test(l) && l.length >= 8
  let bestStart = -1
  let bestEnd = -1
  let curStart = -1
  for (let i = 0; i < lines.length; i++) {
    if (isQrLine(lines[i])) {
      if (curStart < 0) curStart = i
      if (i - curStart > bestEnd - bestStart) {
        bestStart = curStart
        bestEnd = i
      }
    } else if (curStart >= 0) {
      curStart = -1
    }
  }
  // Real WhatsApp QR is 33+ rows; require >= 16 to avoid false positives on
  // stray bullet/box-drawing in surrounding log noise.
  if (bestStart < 0 || bestEnd - bestStart < 15) return null
  return lines.slice(bestStart, bestEnd + 1).join('\n')
}

/** Back-compat name; existing callers and tests import this. */
export const extractWhatsAppQr = extractTerminalQr

/**
 * Account ids the Weixin plugin has completed a QR login for.
 *
 * The plugin keeps its own state dir — NOT `~/.openclaw/credentials/<channel>/`,
 * which is the WhatsApp layout:
 *
 *   ~/.openclaw/openclaw-weixin/accounts.json          -> ["<accountId>", ...]
 *   ~/.openclaw/openclaw-weixin/accounts/<id>.json     (+ .sync/.context-tokens sidecars)
 *
 * Module-level and homeDir-injected so status can be unit-tested against a
 * temp dir without building a ChannelManager (which needs Electron).
 */
export async function listWeixinAccountIds(homeDir: string): Promise<string[]> {
  const { promises: fs } = await import('fs')
  const path = await import('path')
  const stateDir = path.join(homeDir, '.openclaw', WEIXIN_CHANNEL_ID)

  try {
    const parsed: unknown = JSON.parse(
      await fs.readFile(path.join(stateDir, 'accounts.json'), 'utf-8'),
    )
    if (Array.isArray(parsed)) {
      return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0)
    }
  } catch {
    // No registry yet, or malformed — fall through to the per-account files
    // the plugin writes alongside it.
  }

  try {
    const entries = await fs.readdir(path.join(stateDir, 'accounts'))
    // `<id>.sync.json` and `<id>.context-tokens.json` sit next to `<id>.json`;
    // only the bare account file means a completed login.
    return entries
      .filter(
        (name) =>
          name.endsWith('.json') &&
          !name.endsWith('.sync.json') &&
          !name.endsWith('.context-tokens.json'),
      )
      .map((name) => name.slice(0, -'.json'.length))
  } catch {
    return []
  }
}

/**
 * Channels that store their auth credential inline in
 * `~/.openclaw/openclaw.json` (vs. a per-channel directory under
 * `~/.openclaw/credentials/<channel>/`). The field name is the
 * primary auth credential the gateway uses to decide whether the
 * channel is configured — disconnect/add verify-by-state checks
 * read this field.
 *
 * Note: Slack also needs `appToken` and Discord stores `serverId`,
 * but those are secondary to the primary `botToken` for connection
 * status. The disconnect fallback (clearTokenChannelConfig) wipes
 * ALL plausible fields, so this map only needs the primary.
 */
const TOKEN_CHANNEL_FIELDS: Record<'telegram' | 'discord' | 'slack', string> = {
  telegram: 'botToken',
  discord: 'botToken',
  slack: 'botToken',
}

// WhatsApp session management
let whatsappLoginProcess: ChildProcess | null = null
let activeWhatsAppSession: {
  startTime: Date
  qrData?: string
  status: 'pending' | 'qr_ready' | 'connected' | 'failed'
} | null = null
let whatsappOperationInProgress = false

export class ChannelManager {
  private configPath: string
  private mainWindow: BrowserWindow | null = null
  private openclawEnv: OpenClawEnvironment
  private configManager: ConfigManager
  /** Notify the renderer that the gateway should be restarted to pick up channel changes. */
  private suggestGatewayRestart(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('gateway:restart-suggested')
    }
  }
  private sessionCleanupTimer: ReturnType<typeof setInterval> | null = null
  private readyPromise: Promise<void>

  constructor(configPath: string, configManager?: ConfigManager) {
    this.configPath = configPath
    this.openclawEnv = new OpenClawEnvironment(configPath)
    this.configManager = configManager || new ConfigManager()
    this.setupSessionCleanup()
    // Backfill `agentRuntime.id` for any agent whose model is set but
    // harness isn't. Without this, the codex harness's GPT-5 persona-latch
    // leaks into every non-Codex model. Exposed via `ready()` so the
    // gateway start path can await it instead of racing the spawn.
    this.readyPromise = this.repairAgentHarnesses().catch((error) => {
      console.error('[ChannelManager] repairAgentHarnesses failed:', error)
    })
  }

  /**
   * Resolves once any one-shot startup repairs (harness backfill, etc.)
   * have committed to disk. Callers that spawn the gateway should await
   * this before triggering a config-watched restart — otherwise the
   * gateway can pick up stale `agentRuntime.id` values and boot the
   * wrong harness for the first chat.
   */
  ready(): Promise<void> {
    return this.readyPromise
  }

  /**
   * Walk `agents.list[]` and pin each entry's per-model harness id based on
   * the entry's resolved primary model. Idempotent. Runs once at startup
   * (via the constructor's readyPromise) and again after any default-model
   * change (BYOK provider switch, managed-backend sync) — without that
   * re-run, agents that inherit from `defaults.model.primary` keep their
   * old harness and start the wrong runtime.
   *
   * Writes go through {@link setAgentRuntime} which places the value at the
   * canonical `entry.models[primary].agentRuntime.id`. The legacy
   * top-level `entry.agentRuntime` field is rejected by the gateway zod
   * schema (>= 2026.6) and is migrated away by the config-repair pass that
   * `OpenClawManager.start()` runs before every spawn.
   *
   * Public so the top-level config-write paths can trigger it.
   */
  async repairAgentHarnesses(): Promise<void> {
    try {
      const openclawConfig = await this.configManager.loadConfig()
      const list = listAgents(openclawConfig)
      if (list.length === 0) return

      let dirty = false
      for (const entry of list) {
        const primary: string | undefined =
          entry?.model?.primary ?? openclawConfig.agents?.defaults?.model?.primary
        if (!primary) continue
        // Pass exec context so codex harness isn't pinned for agents
        // whose tools.exec policy would make the codex app-server
        // reject startup ("Codex app-server local execution is not
        // available when tools.exec.mode=allowlist").
        const execContext = readExecContextForAgent(openclawConfig, entry?.id ?? '')
        const desired = resolveAgentHarness(primary, execContext)
        const current = getAgentRuntime(entry, primary)
        if (current !== desired) {
          setAgentRuntime(entry, primary, desired)
          dirty = true
        }

        // Also re-resolve ALL per-model pins under entry.models — these
        // were written by past channel-manager runs with the old
        // exec-blind resolver and now disagree with the current exec
        // policy. Without this loop, an upgrade install still has the
        // stale codex pins and chat fails on the first send.
        const modelsMap = (entry as any)?.models
        if (modelsMap && typeof modelsMap === 'object' && !Array.isArray(modelsMap)) {
          for (const [modelRef, slot] of Object.entries(modelsMap)) {
            if (typeof modelRef !== 'string' || modelRef.length === 0) continue
            const desiredForSlot = resolveAgentHarness(modelRef, execContext)
            const currentForSlot = (slot as any)?.agentRuntime?.id
            if (currentForSlot !== desiredForSlot) {
              setAgentRuntime(entry, modelRef, desiredForSlot)
              dirty = true
            }
          }
        }
      }

      if (dirty) {
        await this.configManager.writeConfig(openclawConfig)
        console.log('[ChannelManager] Refreshed per-model agent runtime pins')
      }
    } catch (error) {
      console.error('[ChannelManager] repairAgentHarnesses failed:', error)
    }
  }

  setMainWindow(window: BrowserWindow | null) {
    this.mainWindow = window
  }

  async listChannels(): Promise<any[]> {
    try {
      const result = await this.executeOpenClawCommand(['channels', 'list', '--json'])
      return result ? JSON.parse(result) : []
    } catch (error) {
      console.error('[ChannelManager] Failed to list channels:', error)
      return []
    }
  }

  async getChannelStatus(): Promise<any[]> {
    try {
      const result = await this.executeOpenClawCommand(['channels', 'status', '--json'])
      return result ? JSON.parse(result) : []
    } catch (error) {
      console.error('[ChannelManager] Failed to get channel status:', error)
      return []
    }
  }

  // WhatsApp Methods
  async addWhatsAppChannel(name: string = 'WhatsApp'): Promise<boolean> {
    try {
      // Bundled channel plugins are auto-enabled by the gateway's doctor on startup.
      // Do NOT call ensurePluginEnabled() here — writing plugins.entries to the config
      // triggers a gateway self-restart, causing ProcessManager to lose track of the process.
      await this.executeOpenClawCommand(['channels', 'add', '--channel', 'whatsapp', '--name', name])
      this.addLog('✅ WhatsApp channel added successfully')
      return true
    } catch (error: any) {
      console.error('[ChannelManager] Failed to add WhatsApp channel:', error)
      this.addLog(`❌ Failed to add WhatsApp channel: ${error.message}`)
      return false
    }
  }

  // Ensure a plugin is enabled in the OpenClaw configuration.
  // Uses the shared ConfigManager so all writes go through the validation pipeline and write lock.
  private async ensurePluginEnabled(pluginId: string): Promise<void> {
    try {
      const config = await this.configManager.loadConfig()

      if (!config.plugins) { config.plugins = {} }
      if (!config.plugins.entries) { config.plugins.entries = {} }

      if (!config.plugins.entries[pluginId]?.enabled) {
        config.plugins.entries[pluginId] = { enabled: true }
        await this.configManager.writeConfig(config)
        console.log(`[ChannelManager] Enabled ${pluginId} plugin`)
      }
    } catch (error: any) {
      console.error(`[ChannelManager] Failed to ensure ${pluginId} plugin enabled:`, error)
    }
  }

  async checkWhatsAppStatus(): Promise<{ connected: boolean; logs: string[] }> {
    try {
      // Fast check: Look for WhatsApp session files instead of running slow openclaw command
      const { promises: fs } = await import('fs')
      const path = await import('path')

      const homeDir = process.env.HOME || process.env.USERPROFILE || ''
      const sessionDir = path.join(homeDir, '.openclaw', 'credentials', 'whatsapp')

      // Check if session directory exists
      try {
        await fs.access(sessionDir)
      } catch {
        this.addLog('📱 WhatsApp session directory not found - not connected')
        return { connected: false, logs: ['Session directory not found'] }
      }

      // Look for credential files in the WhatsApp credentials directory.
      // The primary auth file is creds.json, written immediately after QR scan.
      // session-*.json files only appear later during full session handshake.
      try {
        const accounts = await fs.readdir(sessionDir)
        const logs: string[] = []

        for (const account of accounts) {
          const accountDir = path.join(sessionDir, account)
          const stat = await fs.stat(accountDir)

          if (stat.isDirectory()) {
            const credFiles = await fs.readdir(accountDir)
            const hasCredentials = credFiles.some(file =>
              file === 'creds.json'
            )

            if (hasCredentials) {
              this.addLog('📱 WhatsApp credentials found - connected')
              return { connected: true, logs: [`Credentials found for account: ${account}`] }
            }
          }
        }

        this.addLog('📱 No WhatsApp credentials found - not connected')
        return { connected: false, logs: ['No credentials found'] }
      } catch (error: any) {
        this.addLog(`📱 Error checking session files: ${error.message}`)
        return { connected: false, logs: [error.message] }
      }
    } catch (error: any) {
      this.addLog(`❌ Failed to check WhatsApp status: ${error.message}`)
      return { connected: false, logs: [error.message] }
    }
  }

  /**
   * Check whether a channel that stores its credentials INLINE in
   * `~/.openclaw/openclaw.json` (Telegram, Discord, Slack — bot-token
   * channels) is currently configured. Unlike WhatsApp, these channels
   * don't drop a file into `~/.openclaw/credentials/<channel>/`, so the
   * old credentials-dir check always returned false and the UI offered
   * to "connect" a channel that was already running at the gateway.
   *
   * Returns true iff `config.channels.<channel>` exists, is enabled,
   * and has a non-empty primary auth field (e.g. `botToken`). Falls
   * back to the credentials-dir check on read errors so we don't
   * regress for any future channel that happens to use that shape.
   */
  private async isTokenChannelConfigured(
    channel: 'telegram' | 'discord' | 'slack',
    tokenField: string,
  ): Promise<boolean> {
    try {
      const config = await this.configManager.loadConfig()
      const entry = config?.channels?.[channel]
      if (entry && entry.enabled !== false) {
        const token = entry[tokenField]
        if (typeof token === 'string' && token.trim().length > 0) return true
      }
    } catch (err) {
      // Fall through to credentials-dir fallback.
      console.warn(`[ChannelManager] config-based ${channel} status check failed, falling back:`, err)
    }
    // Fallback: legacy credentials-dir check (used by WhatsApp + any
    // future channel that adopts the dir-based shape).
    try {
      const { app } = await import('electron')
      const { promises: fs } = await import('fs')
      const path = await import('path')
      const homeDir = app.getPath('home')
      const credentialsDir = path.join(homeDir, '.openclaw', 'credentials', channel)
      const files = await fs.readdir(credentialsDir)
      return files.some(f => !f.startsWith('.'))
    } catch {
      return false
    }
  }

  /**
   * Read the per-channel auth token (botToken, channelAccessToken, etc.)
   * directly from `~/.openclaw/openclaw.json`. Used by the add/remove
   * verify-by-state checks: after spawning the upstream CLI we trust
   * the actual on-disk state more than the CLI exit code, because the
   * CLI's gateway-WS call frequently times out at 10s despite the
   * gateway having processed the request and written the config.
   */
  private async readChannelToken(
    channel: 'telegram' | 'discord' | 'slack',
    tokenField: string,
  ): Promise<string | null> {
    try {
      const config = await this.configManager.loadConfig()
      const token = config?.channels?.[channel]?.[tokenField]
      return typeof token === 'string' && token.trim().length > 0 ? token : null
    } catch {
      return null
    }
  }

  async checkTelegramStatus(): Promise<{ connected: boolean }> {
    return { connected: await this.isTokenChannelConfigured('telegram', 'botToken') }
  }

  async checkDiscordStatus(): Promise<{ connected: boolean }> {
    return { connected: await this.isTokenChannelConfigured('discord', 'botToken') }
  }

  /**
   * Check whether a channel's local credentials/auth files have been cleared.
   * After `openclaw channels logout` runs, the per-channel credentials
   * directory under ~/.openclaw/credentials/<channel>/ should be empty
   * (or non-existent). Same convention used by checkWhatsAppStatus,
   * checkTelegramStatus, etc. — we re-use it here as a post-disconnect
   * verification, so a CLI that exited non-zero (e.g. the upstream
   * `channels.logout` gateway-call timeout bug — gateway responds in
   * <1s but the CLI's WS client times out at 10s) is still reported
   * as success when the local fallback actually cleared the auth.
   */
  private async isChannelLoggedOut(channel: string): Promise<boolean> {
    // Token-in-config channels (Telegram/Discord/Slack): logged out iff
    // the inline auth field has been cleared from `openclaw.json`. The
    // credentials-dir never exists for these channels, so the original
    // check below would falsely report "logged out" while the bot kept
    // running on the gateway from the stored config token.
    const tokenField = TOKEN_CHANNEL_FIELDS[channel as keyof typeof TOKEN_CHANNEL_FIELDS]
    if (tokenField) {
      try {
        const stored = await this.readChannelToken(
          channel as 'telegram' | 'discord' | 'slack',
          tokenField,
        )
        return stored === null
      } catch {
        // Fall through to legacy check below.
      }
    }
    try {
      const { app } = await import('electron')
      const { promises: fs } = await import('fs')
      const path = await import('path')

      const homeDir = app.getPath('home')
      const credentialsDir = path.join(homeDir, '.openclaw', 'credentials', channel)
      try {
        const files = await fs.readdir(credentialsDir)
        // "Logged out" iff there are no non-dotfile entries
        return !files.some(f => !f.startsWith('.'))
      } catch {
        // Directory doesn't exist — definitely logged out
        return true
      }
    } catch {
      // Couldn't determine — assume not logged out (safe default)
      return false
    }
  }

  /**
   * Manually clear the inline auth token + disable the channel in
   * `~/.openclaw/openclaw.json`. Used as a last-resort fallback when
   * the upstream `channels logout` CLI doesn't clear the token (e.g.
   * the gateway-WS call timed out before the local fallback ran).
   * Without this, "Disconnect" reported success but the gateway kept
   * the bot running on the next start, and the user couldn't connect
   * with a fresh token because the channel was still treated as added.
   */
  private async clearTokenChannelConfig(
    channel: 'telegram' | 'discord' | 'slack',
  ): Promise<void> {
    try {
      const config = await this.configManager.loadConfig()
      const entry = config?.channels?.[channel]
      if (!entry) return
      // Wipe every plausible auth field for the channel. Discord/Slack
      // hold multiple credentials (botToken + serverId, botToken +
      // appToken); a partial clear would leave a half-configured entry
      // the gateway might still try to load.
      delete entry.botToken
      delete entry.appToken
      delete entry.serverId
      delete entry.channelAccessToken
      delete entry.channelSecret
      entry.enabled = false
      await this.configManager.writeConfig(config)
      this.addLog(`🔧 Cleared ${channel} credentials from config (fallback)`)
    } catch (err: any) {
      console.error(`[ChannelManager] Failed to clear ${channel} config:`, err)
      this.addLog(`⚠️ Could not clear ${channel} config: ${err.message}`)
    }
  }

  /**
   * Generic per-channel disconnect via `openclaw channels logout`.
   *
   * The CLI in turn tries `channels.logout` over the gateway WebSocket; if
   * that times out (the upstream WS client has a known 10s timeout that
   * fires even when the gateway has already responded) it falls back to
   * deleting the local credentials directory. Either path leaves the
   * channel logged out, so we treat "credentials gone" as the source of
   * truth instead of trusting the CLI's exit code or stderr.
   *
   * Timeouts:
   *   - 30s spawn timeout (handles dev-mode plugin scanning + the CLI's
   *     own 10s gateway-WS timeout + local fallback execution time).
   *   - On timeout we DON'T immediately give up — we kill the proc, then
   *     re-check the local auth state. The local fallback often
   *     completes before the kill takes effect.
   *
   * Returns success based on the post-spawn auth-state check, not the CLI
   * exit code.
   */
  private async disconnectChannel(opts: {
    channel: 'whatsapp' | 'telegram' | 'discord' | 'slack'
    statusEvent: string
    logEmoji: string
  }): Promise<{ success: boolean; logs: string[] }> {
    const { channel, statusEvent, logEmoji } = opts
    const display = channel.charAt(0).toUpperCase() + channel.slice(1)
    try {
      this.addLog(`${logEmoji} Disconnecting ${display}...`)

      const { runtime, enhancedEnv, cwd, buildArgs } = await this.resolveOpenClawSpawn()
      const disconnectProc = spawn(runtime, buildArgs('channels', 'logout', '--channel', channel), {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: enhancedEnv,
        cwd,
        windowsHide: true,
      })

      const logs: string[] = []
      disconnectProc.stdout?.on('data', (data) => {
        const text = data.toString()
        logs.push(text)
        this.addLog(`${logEmoji} STDOUT: ${text.trim()}`)
      })
      disconnectProc.stderr?.on('data', (data) => {
        const text = data.toString()
        if (!text.includes('DeprecationWarning')) {
          logs.push(text)
          this.addLog(`⚠️ STDERR: ${text.trim()}`)
        }
      })

      // Wait for proc exit OR 30s timeout. Either way, we then verify
      // by checking the local auth state.
      const procEnded = new Promise<{ code: number | null; reason: 'exit' | 'error' | 'timeout' }>((resolve) => {
        let settled = false
        const settle = (v: { code: number | null; reason: 'exit' | 'error' | 'timeout' }) => {
          if (settled) return
          settled = true
          resolve(v)
        }

        disconnectProc.on('exit', (code) => settle({ code, reason: 'exit' }))
        disconnectProc.on('error', (error) => {
          this.addLog(`❌ ${display} disconnect process error: ${error.message}`)
          logs.push(error.message)
          settle({ code: null, reason: 'error' })
        })

        setTimeout(() => {
          if (!disconnectProc.killed) disconnectProc.kill('SIGTERM')
          settle({ code: null, reason: 'timeout' })
        }, 30_000)
      })

      const result = await procEnded
      // Verify: was the local auth actually cleared? This is the source
      // of truth — covers the upstream CLI bug where exit code can be
      // misleading when the gateway-WS call times out.
      let loggedOut = await this.isChannelLoggedOut(channel)

      // Token-in-config channels (Telegram/Discord/Slack) often slip
      // through both the CLI's gateway-WS call AND its local fallback
      // when the bot is currently mid-startup at the gateway — the
      // config token never gets cleared. Wipe it manually as a last
      // resort so the next "Connect" cycle starts from a clean state.
      if (!loggedOut && (channel === 'telegram' || channel === 'discord' || channel === 'slack')) {
        this.addLog(`🔧 ${display} CLI logout did not clear token — applying config fallback...`)
        await this.clearTokenChannelConfig(channel)
        loggedOut = await this.isChannelLoggedOut(channel)
      }

      if (loggedOut) {
        this.addLog(`✅ ${display} disconnected successfully (verified locally)`)
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send(statusEvent, 'disconnected')
        }
        // Token-channel disconnects need a gateway restart so the bot
        // actually stops (the running provider holds the old token in
        // memory until the gateway re-reads config on restart).
        if (channel !== 'whatsapp') {
          this.suggestGatewayRestart()
        }
        return { success: true, logs }
      }

      this.addLog(
        `❌ Failed to disconnect ${display} (proc reason=${result.reason}, exit code=${result.code ?? 'n/a'}, auth still present)`,
      )
      return { success: false, logs }
    } catch (error: any) {
      this.addLog(`❌ Failed to disconnect ${display}: ${error.message}`)
      return { success: false, logs: [error.message] }
    }
  }

  async disconnectWhatsApp(): Promise<{ success: boolean; logs: string[] }> {
    return await this.disconnectChannel({
      channel: 'whatsapp',
      statusEvent: 'whatsapp:status-change',
      logEmoji: '📱',
    })
  }

  async disconnectTelegram(): Promise<{ success: boolean; logs: string[] }> {
    return await this.disconnectChannel({
      channel: 'telegram',
      statusEvent: 'telegram:status-change',
      logEmoji: '🔵',
    })
  }

  async disconnectDiscord(): Promise<{ success: boolean; logs: string[] }> {
    return await this.disconnectChannel({
      channel: 'discord',
      statusEvent: 'discord:status-change',
      logEmoji: '🟦',
    })
  }

  async loginWhatsApp(): Promise<{success: boolean, logs: string[]}> {
    const logs: string[] = []

    try {
      this.addLog('🔗 Starting WhatsApp login process...')

      const { runtime, enhancedEnv, cwd, buildArgs } = await this.resolveOpenClawSpawn()
      const loginProc = spawn(runtime, buildArgs('channels', 'login', '--channel', 'whatsapp', '--verbose'), {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: enhancedEnv,
        cwd,
        windowsHide: true,
      })

      return new Promise((resolve) => {
        loginProc.stdout?.on('data', (data) => {
          const text = data.toString()
          logs.push(text)
          this.addLog(`📱 ${text.trim()}`)
        })

        loginProc.stderr?.on('data', (data) => {
          const text = data.toString()
          if (!text.includes('DeprecationWarning')) {
            logs.push(text)
            this.addLog(`⚠️ ${text.trim()}`)
          }
        })

        loginProc.on('exit', (code) => {
          const success = code === 0
          this.addLog(success ? '✅ WhatsApp login completed' : '❌ WhatsApp login failed')
          resolve({ success, logs })
        })

        loginProc.on('error', (error) => {
          this.addLog(`❌ Login process error: ${error.message}`)
          resolve({ success: false, logs })
        })
      })
    } catch (error: any) {
      console.error('[ChannelManager] Failed to start WhatsApp login:', error)
      this.addLog(`❌ Failed to start WhatsApp login: ${error.message}`)
      return { success: false, logs: [error.message] }
    }
  }

  async getWhatsAppQRFromLogin(): Promise<{success: boolean, qrData?: string, logs: string[]}> {
    const logs: string[] = []

    // Prevent concurrent WhatsApp operations (login vs disconnect race)
    if (whatsappOperationInProgress) {
      return { success: false, logs: ['WhatsApp operation already in progress, please wait'] }
    }
    whatsappOperationInProgress = true

    try {
      // Check if there's already an active WhatsApp login session
      if (whatsappLoginProcess && !whatsappLoginProcess.killed) {
        if (activeWhatsAppSession?.qrData) {
          return {
            success: true,
            qrData: activeWhatsAppSession.qrData,
            logs: ['Using existing QR code from active session']
          }
        }

        return {
          success: false,
          logs: ['WhatsApp login already in progress. Please wait...']
        }
      }

      // Clean up any previous session
      this.cleanupWhatsAppSession()

      // Create new session
      activeWhatsAppSession = {
        startTime: new Date(),
        status: 'pending'
      }

      this.addLog('🔗 Starting WhatsApp QR generation...')

      const { runtime, openclawPath, enhancedEnv, cwd, buildArgs } = await this.resolveOpenClawSpawn()
      console.log('[ChannelManager] Starting WhatsApp login:', runtime, openclawPath, 'cwd:', cwd)

      whatsappLoginProcess = spawn(runtime, buildArgs('channels', 'login', '--channel', 'whatsapp', '--account', 'default'), {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: enhancedEnv,
        cwd,
        windowsHide: true,
      })

      return new Promise((resolve) => {
        let qrData = ''
        let foundQR = false
        // Buffer all stdout so the QR detector can scan across chunk
        // boundaries. WhatsApp's QR is ~17 rows; pty/pipe buffering
        // routinely splits it across multiple `data` events, and a
        // per-chunk includes('█') check would miss every split QR —
        // the bug customers were hitting as "QR doesn't generate".
        let stdoutBuffer = ''

        whatsappLoginProcess!.stdout?.on('data', (data) => {
          const text = data.toString()
          logs.push(text)
          stdoutBuffer += text

          // Strip ANSI for the success-marker checks too — the CLI sometimes
          // colorizes "Linked!" / status lines, and the bare includes() would
          // miss them when the chunk also carried color codes.
          const cleanText = stripAnsi(text)

          if (cleanText.includes('already linked') ||
              cleanText.includes('Linked!') ||
              cleanText.includes('web session ready') ||
              cleanText.includes('Credentials saved')) {
            if (foundQR) {
              this.addLog('✅ WhatsApp login successful — credentials saved')
              if (activeWhatsAppSession) {
                activeWhatsAppSession.status = 'connected'
              }
              if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('whatsapp:status-change', 'connected')
              }
              this.cleanupWhatsAppSession()
              this.suggestGatewayRestart()
              return
            }

            this.addLog('✅ WhatsApp is already connected')
            if (activeWhatsAppSession) {
              activeWhatsAppSession.status = 'connected'
              activeWhatsAppSession.qrData = 'ALREADY_CONNECTED'
            }
            this.cleanupWhatsAppSession()
            resolve({ success: true, qrData: 'ALREADY_CONNECTED', logs })
            return
          }

          if (!foundQR) {
            const qr = extractWhatsAppQr(stdoutBuffer)
            if (qr) {
              qrData = qr
              foundQR = true

              if (activeWhatsAppSession) {
                activeWhatsAppSession.qrData = qrData
                activeWhatsAppSession.status = 'qr_ready'
              }

              this.addLog('✅ QR code detected and extracted')
              clearTimeout(qrTimeout)
              resolve({ success: true, qrData, logs })
            }
          }

          this.addLog(`📱 ${cleanText.trim()}`)
        })

        whatsappLoginProcess!.stderr?.on('data', (data) => {
          const text = data.toString()
          if (!text.includes('DeprecationWarning')) {
            logs.push(text)
            this.addLog(`⚠️ ${text.trim()}`)
          }
        })

        // 90s timeout — chosen because in dev mode (`bun src/index.ts ...`)
        // bun has to load+transpile the entire openclaw TS source on each
        // spawn, which takes ~30s before any stdout flushes (proven via a
        // direct spawn diagnostic on 2026-05-10: first chunk @30,274ms,
        // QR @30,704ms). In production (packaged DMG) the runtime runs
        // pre-built openclaw.mjs and the QR appears in 3-5s, so the same
        // 90s ceiling stays well above slow networks/disks. The previous
        // 30s value was racing the dev cold-start by ~270ms — appearing
        // as "QR Generation Failed" with empty logs in the UI.
        const QR_TIMEOUT_MS = 90000
        const qrTimeout = setTimeout(() => {
          if (!foundQR) {
            console.log(`[ChannelManager] QR generation timed out after ${QR_TIMEOUT_MS / 1000} seconds. Logs collected:`)
            console.log(logs.join('\n'))
            this.addLog(`⏱️ QR generation timed out after ${QR_TIMEOUT_MS / 1000} seconds`)
            this.cleanupWhatsAppSession()
            resolve({ success: false, logs })
          }
        }, QR_TIMEOUT_MS)

        whatsappLoginProcess!.on('exit', (code) => {
          clearTimeout(qrTimeout)
          if (activeWhatsAppSession) {
            activeWhatsAppSession.status = code === 0 ? 'connected' : 'failed'

            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              if (code === 0) {
                this.mainWindow.webContents.send('whatsapp:status-change', 'connected')
              } else {
                this.mainWindow.webContents.send('whatsapp:status-change', 'error')
              }
            }

            if (code === 0) {
              this.suggestGatewayRestart()
            }
          }

          setTimeout(() => this.cleanupWhatsAppSession(), 2000)

          if (!foundQR) {
            resolve({ success: false, logs })
          }
        })

        whatsappLoginProcess!.on('error', (error) => {
          clearTimeout(qrTimeout)
          console.error('[ChannelManager] WhatsApp process error:', error)
          this.addLog(`❌ QR generation error: ${error.message}`)
          resolve({ success: false, logs: [error.message, ...logs] })
        })
      })
    } catch (error: any) {
      console.error('[ChannelManager] Failed to get WhatsApp QR:', error)
      this.addLog(`❌ Failed to get WhatsApp QR: ${error.message}`)
      return { success: false, logs: [error.message] }
    } finally {
      whatsappOperationInProgress = false
    }
  }

  private cleanupWhatsAppSession() {
    // Capture the process before nulling the module state: the SIGKILL
    // escalation below must act on THIS child only. Re-reading the module
    // var from the timer used to kill a retry's fresh login spawned within
    // the 2s window ("QR Generation Failed" with empty logs on retry).
    const proc = whatsappLoginProcess
    whatsappLoginProcess = null
    activeWhatsAppSession = null

    // exitCode === null means still running; `.killed` only records that a
    // signal was ever SENT, so it can neither detect a live process nor a
    // dead one reliably.
    if (proc && proc.exitCode === null) {
      this.addLog('🧹 Cleaning up WhatsApp login process')
      proc.kill('SIGTERM')
      const killTimer = setTimeout(() => {
        if (proc.exitCode === null) {
          proc.kill('SIGKILL')
        }
      }, 2000)
      killTimer.unref?.()
      proc.once('exit', () => clearTimeout(killTimer))
    }
  }

  private setupSessionCleanup() {
    if (this.sessionCleanupTimer) clearInterval(this.sessionCleanupTimer)
    this.sessionCleanupTimer = setInterval(() => {
      if (activeWhatsAppSession) {
        const sessionAge = Date.now() - activeWhatsAppSession.startTime.getTime()
        if (sessionAge > 300000) { // 5 minutes
          this.addLog('🧹 Cleaning up stale WhatsApp session')
          this.cleanupWhatsAppSession()
        }
      }
    }, 60000) // Every minute
  }

  // System openclaw detection lives in
  // src/main/managers/system-openclaw-resolver.ts (`detectSystemOpenClaw`).
  // ChannelManager used to ship its own findSystemOpenClaw with a
  // marginally different ordering; the resolver is now a strict superset
  // (`.bun/bin/openclaw`, node_modules filter, augmented PATH) so the
  // local impl was removed during the consolidation that landed alongside
  // the Doctor SQLite cascade fix.

  /**
   * Resolves the correct runtime binary, openclaw entry point, and environment
   * for spawning openclaw subprocesses. Production uses bundled Node +
   * ~/.openclaw-easy/app/openclaw.mjs; development prefers the system
   * openclaw binary, falling back to Node + built dist
   * (dev-openclaw-runtime.ts).
   */
  private async resolveOpenClawSpawn(): Promise<{ runtime: string; openclawPath: string; enhancedEnv: NodeJS.ProcessEnv; cwd: string; buildArgs: (...args: string[]) => string[] }> {
    const { app } = await import('electron')
    const isWindows = process.platform === 'win32'
    const home = process.env.HOME || process.env.USERPROFILE || ''
    const pathSep = isWindows ? ';' : ':'
    const openclawEnv = this.openclawEnv.getEnvironmentVariables()

    let runtime: string
    let openclawPath: string
    let enhancedEnv: NodeJS.ProcessEnv
    let cwd: string

    // Rich PATH so the spawned openclaw + its deps resolve even when Electron
    // inherited a sparse PATH. Shared by every spawn mode below.
    const expandedPath = isWindows
      ? (process.env.PATH || '')
      : [
          path.join(home, '.bun', 'bin'),
          path.join(home, '.npm-global', 'bin'),
          path.join(home, '.local', 'bin'),
          '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin',
          process.env.PATH || ''
        ].join(pathSep)

    if (app.isPackaged) {
      // Run openclaw under bundled Node (has node:sqlite); bun is install-only.
      const nodeBinaryName = isWindows
        ? 'node-windows.exe'
        : `node-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
      const bundledNode = path.join(process.resourcesPath, 'node', nodeBinaryName)

      const openclawMjs = path.join(home, '.openclaw-easy', 'app', 'openclaw.mjs')
      if (existsSync(bundledNode) && existsSync(openclawMjs)) {
        // ── Bundled node + openclaw.mjs both present (normal production path) ──
        runtime = bundledNode
        openclawPath = openclawMjs
        cwd = path.join(home, '.openclaw-easy', 'app')
        enhancedEnv = { ...process.env, ...openclawEnv, PATH: expandedPath, OPENCLAW_INCLUDE_OPTIONAL_BUNDLED: '1' }
      } else {
        // ── Bundled node or openclaw.mjs missing — fall back to system binary ──
        // Happens when: node not in Resources (old DMG), or openclaw.mjs not yet
        // installed (gateway running in system binary mode, bundle never unpacked).
        // The system binary also runs under Node, so node:sqlite stays available.
        const systemBinary = await detectSystemOpenClaw()
        runtime = systemBinary || 'openclaw'
        openclawPath = '' // system binary IS the entry point
        cwd = home
        enhancedEnv = { ...process.env, ...openclawEnv, PATH: expandedPath, OPENCLAW_INCLUDE_OPTIONAL_BUNDLED: '1' }
        console.warn(`[ChannelManager] bundledNode=${existsSync(bundledNode)} openclawMjs=${existsSync(openclawMjs)}; using system binary: ${runtime}`)
      }
    } else {
      // Dev (unpackaged). Prefer the system openclaw binary, which runs under
      // Node — Node 22.5+/24+ ships `node:sqlite`, which the CLI requires for
      // health-state and agent writes (bun has no node:sqlite, which is why
      // no dev path spawns bun anymore — see dev-openclaw-runtime.ts). The
      // gateway (ProcessManager) and OpenClawCommandExecutor already use the
      // system binary in dev; this aligns channel/agent commands with them.
      const systemBinary = await detectSystemOpenClaw()
      if (systemBinary) {
        runtime = systemBinary
        openclawPath = '' // system binary IS the entry point (Node runtime)
        cwd = home
        enhancedEnv = { ...process.env, ...openclawEnv, PATH: expandedPath, OPENCLAW_INCLUDE_OPTIONAL_BUNDLED: '1' }
      } else {
        // Last resort with no global install: built CLI under Node (see
        // dev-openclaw-runtime.ts) — the gateway/CLI needs node:sqlite.
        const dev = getDevOpenClawSpawn()
        runtime = dev.runtime
        openclawPath = dev.entry
        cwd = dev.cwd
        enhancedEnv = { ...process.env, ...openclawEnv, PATH: expandedPath, OPENCLAW_INCLUDE_OPTIONAL_BUNDLED: '1' }
      }
    }

    // Diagnostic logging — visible in Electron logs so production failures can
    // be root-caused. Bare names ('node') resolve via PATH at spawn time, so
    // only path-shaped runtimes get an existence check.
    const runtimeOk = isPathResolvedRuntime(runtime) || existsSync(runtime)
    // openclawPath is empty in system binary mode — the runtime IS the entry point
    const openclawOk = !openclawPath || existsSync(openclawPath)
    console.log(`[ChannelManager] resolveOpenClawSpawn: runtime=${runtime} (exists=${runtimeOk}), openclaw=${openclawPath || '(system binary)'} (exists=${openclawOk}), cwd=${cwd}`)
    if (!runtimeOk) console.error('[ChannelManager] *** MISSING runtime binary — spawn will ENOENT ***')
    if (!openclawOk) console.error('[ChannelManager] *** MISSING openclaw entry point — spawn will fail ***')

    // buildArgs prepends openclawPath when needed; empty means system binary mode
    const buildArgs = (...args: string[]) => openclawPath ? [openclawPath, ...args] : args
    return { runtime, openclawPath, enhancedEnv, cwd, buildArgs }
  }

  private async executeOpenClawCommand(args: string[]): Promise<string | null> {
    const { runtime, enhancedEnv, cwd, buildArgs } = await this.resolveOpenClawSpawn()
    const spawnArgs = buildArgs(...args)
    return new Promise((resolve, reject) => {
      const commandProcess = spawn(runtime, spawnArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: enhancedEnv,
        cwd,
        windowsHide: true,
      })

      let stdout = ''
      let stderr = ''
      let finished = false

      // Set a timeout to prevent hanging (30 seconds for most commands)
      const timeout = setTimeout(() => {
        if (!finished) {
          finished = true
          console.error('[ChannelManager] Command timed out after 30 seconds:', args.join(' '))
          commandProcess.removeAllListeners()
          commandProcess.stdout?.removeAllListeners()
          commandProcess.stderr?.removeAllListeners()
          commandProcess.kill('SIGTERM')
          setTimeout(() => {
            try { commandProcess.kill('SIGKILL') } catch { /* already dead */ }
          }, 2000)
          reject(new Error('Command timed out after 30 seconds'))
        }
      }, 30000)

      commandProcess.stdout?.on('data', (data) => {
        stdout += data.toString()
      })

      commandProcess.stderr?.on('data', (data) => {
        const text = data.toString()
        // Ignore deprecation warnings and bun warnings
        if (!text.includes('DeprecationWarning') && !text.includes('[bun] Warning')) {
          stderr += text
        }
      })

      commandProcess.on('exit', (code) => {
        finished = true
        clearTimeout(timeout)
        if (code === 0) {
          resolve(stdout)
        } else {
          reject(new Error(`OpenClaw command failed with code ${code}: ${stderr}`))
        }
      })

      commandProcess.on('error', (error) => {
        finished = true
        clearTimeout(timeout)
        reject(error)
      })
    })
  }

  /**
   * After adding a channel via the CLI, set dmPolicy to "open" and allowFrom to ["*"]
   * so the bot responds to all DMs immediately. The CLI defaults to "pairing" which
   * silently drops messages until the user pairs — bad UX for a desktop app where
   * the user owns the bot.
   *
   * Goes through ConfigManager so the write is serialised with every
   * other config write in the desktop. The raw `fs.readFile`+`writeFile`
   * pattern used previously could race with concurrent edits (e.g. an
   * agent-config write triggered while this method was mid-flight) and
   * lose data when both sides re-read + wrote at the same time.
   */
  private async setChannelOpenAccess(channelId: string): Promise<void> {
    try {
      const config = await this.configManager.loadConfig()
      if (config.channels?.[channelId]) {
        config.channels[channelId].dmPolicy = 'open'
        config.channels[channelId].allowFrom = ['*']
        await this.configManager.writeConfig(config)
        console.log(`[ChannelManager] Set ${channelId} dmPolicy=open, allowFrom=["*"]`)
      }
    } catch (error: any) {
      console.warn(`[ChannelManager] Failed to set open access for ${channelId}:`, error.message)
    }
  }

  private addLog(message: string) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      const timestamp = new Date().toISOString()
      this.mainWindow.webContents.send('openclaw:log-update', {
        timestamp,
        message,
        fullEntry: `[${timestamp}] ${message}`
      })
    }
  }

  // Telegram Methods
  async addTelegramChannel(botToken: string, name: string = 'Telegram'): Promise<{ success: boolean; error?: string }> {
    return this.addTokenChannel({
      channel: 'telegram',
      tokenField: 'botToken',
      token: botToken,
      name,
      logEmoji: '🔵',
      validateFormat: (t) => t.includes(':') && t.length >= 40,
      formatHint: 'Expected format: 123456:ABC-DEF...',
    })
  }

  /**
   * Generic add-token-channel helper for Telegram/Discord/Slack.
   *
   * Why we bypass the upstream `channels add` CLI:
   *
   * The CLI's `channels.add` WS call to the running gateway frequently
   * hangs — the well-documented upstream `callGateway` bug in
   * `src/gateway/call.ts` (10s timeout that fires even when the
   * gateway already processed the request). For DISCONNECT, the CLI
   * has a local fallback that clears credentials regardless of WS
   * timeout; for ADD it does NOT — when the WS call hangs the CLI
   * never writes the config. Empirically: a 30s desktop spawn timeout
   * fires, the config is unchanged, the user sees the generic
   * "Please check your credentials" toast.
   *
   * Same shape as Feishu/Line already use (`connectFeishu`,
   * `connectLine`): write `config.channels.<channel>` directly via
   * ConfigManager (which holds the write lock), then nudge the
   * gateway to reload. No CLI in the hot path.
   *
   * Short-circuit: if the config ALREADY has the same token, the
   * channel is already added with this exact credential — common
   * when the user opens the connect modal on a channel that's still
   * running. Skip even the write and just refresh open-access.
   */
  private async addTokenChannel(opts: {
    channel: 'telegram' | 'discord' | 'slack'
    tokenField: string
    token: string
    name: string
    logEmoji: string
    validateFormat?: (token: string) => boolean
    formatHint?: string
    extraFields?: Record<string, unknown>
  }): Promise<{ success: boolean; error?: string }> {
    const { channel, tokenField, token, name, logEmoji, validateFormat, formatHint, extraFields } = opts
    const display = channel.charAt(0).toUpperCase() + channel.slice(1)
    try {
      this.addLog(`${logEmoji} Adding ${display} channel: ${name}`)

      if (!token || (validateFormat && !validateFormat(token))) {
        return {
          success: false,
          error: `Invalid ${display} token format.${formatHint ? ' ' + formatHint : ''}`,
        }
      }

      // Short-circuit: same token already in config → nothing to write.
      const existing = await this.readChannelToken(channel, tokenField)
      if (existing === token) {
        this.addLog(`✅ ${display} channel already configured with this token; refreshing open-access only.`)
        await this.setChannelOpenAccess(channel)
        return { success: true }
      }

      // Direct config write — match the schema `channels add --token` would
      // produce. Goes through ConfigManager.writeConfig which holds the
      // write lock, so we don't race with a concurrent edit elsewhere.
      // Set dmPolicy:open + allowFrom:* in the SAME write so the bot
      // accepts DMs without manual pairing. Single atomic write here
      // instead of CLI-spawn + setChannelOpenAccess back-to-back: no
      // race window, no second readFile/writeFile pair.
      const config = await this.configManager.loadConfig()
      if (!config.channels) config.channels = {}
      const entry: Record<string, any> = config.channels[channel] ?? {}
      entry.name = name
      entry.enabled = true
      entry[tokenField] = token
      entry.dmPolicy = 'open'
      entry.allowFrom = ['*']
      if (extraFields) {
        for (const [k, v] of Object.entries(extraFields)) entry[k] = v
      }
      config.channels[channel] = entry
      await this.configManager.writeConfig(config)
      this.addLog(`💾 Wrote ${display} credentials to openclaw.json (dmPolicy=open)`)

      // The gateway needs to reload its config to pick up the new
      // channel. Desktop emits the suggestion event so the user can
      // hit "Restart Gateway" — auto-restart would interrupt any
      // in-flight chat.
      this.suggestGatewayRestart()
      this.addLog(`✅ ${display} channel added successfully (restart gateway to activate)`)
      return { success: true }
    } catch (error: any) {
      console.error(`[ChannelManager] Failed to add ${display} channel:`, error)
      this.addLog(`❌ Failed to add ${display} channel: ${error.message}`)
      return { success: false, error: error.message }
    }
  }

  async testTelegramBot(botToken: string): Promise<{ success: boolean; botInfo?: any; error?: string }> {
    try {
      this.addLog('🔵 Testing Telegram bot token...')

      // Validate token format
      if (!botToken || !botToken.includes(':') || botToken.length < 40) {
        return { success: false, error: 'Invalid bot token format' }
      }

      // Test the bot using Telegram API
      const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`)
      const data = await response.json()

      if (data.ok && data.result) {
        this.addLog(`✅ Bot verified: @${data.result.username ?? 'unknown'}`)
        return {
          success: true,
          botInfo: {
            username: data.result.username ?? '',
            firstName: data.result.first_name ?? '',
            id: data.result.id
          }
        }
      } else {
        return { success: false, error: data.description || 'Invalid bot token' }
      }
    } catch (error: any) {
      console.error('[ChannelManager] Failed to test Telegram bot:', error)
      this.addLog(`❌ Failed to test Telegram bot: ${error.message}`)
      return { success: false, error: error.message }
    }
  }

  async connectTelegramBot(botToken: string, name: string = 'Telegram'): Promise<{ success: boolean; error?: string }> {
    try {
      // First test the bot
      const testResult = await this.testTelegramBot(botToken)
      if (!testResult.success) {
        return testResult
      }

      // Add the channel
      const addResult = await this.addTelegramChannel(botToken, name)
      if (!addResult.success) {
        return addResult
      }

      // Notify UI of successful connection
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('telegram:status-change', 'connected')
      }

      this.suggestGatewayRestart()

      return { success: true }
    } catch (error: any) {
      console.error('[ChannelManager] Failed to connect Telegram bot:', error)
      return { success: false, error: error.message }
    }
  }

  // Discord Methods
  async addDiscordChannel(botToken: string, serverId: string, name: string = 'Discord'): Promise<{ success: boolean; error?: string }> {
    if (!serverId || !/^\d{17,19}$/.test(serverId)) {
      return { success: false, error: 'Invalid Discord server ID' }
    }
    // Reuse the same direct-config-write path Telegram uses (bypasses the
    // buggy `channels add` CLI). After the main add succeeds, register
    // the user-supplied guild under `channels.discord.guilds[serverId]`
    // — preserving any other guilds already present (don't pass `guilds`
    // through `extraFields`, that would wipe them).
    const result = await this.addTokenChannel({
      channel: 'discord',
      tokenField: 'botToken',
      token: botToken,
      name,
      logEmoji: '🟦',
      validateFormat: (t) => t.length >= 50,
      formatHint: 'Discord bot tokens are at least 50 characters.',
    })
    if (!result.success) return result

    try {
      const config = await this.configManager.loadConfig()
      if (!config.channels.discord.guilds) config.channels.discord.guilds = {}
      if (!config.channels.discord.guilds[serverId]) {
        config.channels.discord.guilds[serverId] = {}
        await this.configManager.writeConfig(config)
        this.addLog(`📌 Registered Discord guild ${serverId}`)
      }
    } catch (writeErr: any) {
      this.addLog(`⚠️ Discord channel added but couldn't register guild ${serverId}: ${writeErr.message}`)
      // Non-fatal — the bot still works on any guild it's invited to.
    }
    return { success: true }
  }

  async testDiscordBot(botToken: string): Promise<{ success: boolean; botInfo?: any; error?: string }> {
    try {
      this.addLog('🟦 Testing Discord bot token...')

      // Validate token format
      if (!botToken || botToken.length < 50) {
        return { success: false, error: 'Invalid Discord bot token length' }
      }

      // Test the bot using Discord API
      const response = await fetch('https://discord.com/api/v10/users/@me', {
        headers: {
          'Authorization': `Bot ${botToken}`,
          'Content-Type': 'application/json'
        }
      })

      if (response.ok) {
        const data = await response.json()
        this.addLog(`✅ Discord bot verified: ${data?.username ?? 'unknown'}#${data?.discriminator ?? '0'}`)
        return {
          success: true,
          botInfo: {
            username: data?.username ?? '',
            discriminator: data?.discriminator ?? '0',
            id: data?.id
          }
        }
      } else {
        const errorData = await response.json()
        return { success: false, error: errorData.message || 'Invalid bot token' }
      }
    } catch (error: any) {
      console.error('[ChannelManager] Failed to test Discord bot:', error)
      this.addLog(`❌ Failed to test Discord bot: ${error.message}`)
      return { success: false, error: error.message }
    }
  }

  async connectDiscordBot(botToken: string, serverId: string, name: string = 'Discord'): Promise<{ success: boolean; error?: string }> {
    try {
      // First test the bot
      const testResult = await this.testDiscordBot(botToken)
      if (!testResult.success) {
        return testResult
      }

      // Add the channel
      const addResult = await this.addDiscordChannel(botToken, serverId, name)
      if (!addResult.success) {
        return addResult
      }

      // Notify UI of successful connection
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('discord:status-change', 'connected')
      }

      this.suggestGatewayRestart()

      return { success: true }
    } catch (error: any) {
      console.error('[ChannelManager] Failed to connect Discord bot:', error)
      return { success: false, error: error.message }
    }
  }

  // Slack Methods
  async checkSlackStatus(): Promise<{ connected: boolean }> {
    return { connected: await this.isTokenChannelConfigured('slack', 'botToken') }
  }

  async testSlackBotToken(botToken: string): Promise<{ success: boolean; teamName?: string; botName?: string; error?: string }> {
    try {
      this.addLog('💬 Testing Slack bot token...')

      if (!botToken || !botToken.startsWith('xoxb-')) {
        return { success: false, error: 'Invalid bot token format. Must start with xoxb-' }
      }

      const response = await fetch('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${botToken}`,
          'Content-Type': 'application/json',
        },
      })

      const data = await response.json()

      if (data.ok) {
        this.addLog(`✅ Slack bot verified: ${data.bot_id} in workspace "${data.team}"`)
        return { success: true, teamName: data.team, botName: data.user }
      } else {
        return { success: false, error: data.error || 'Invalid bot token' }
      }
    } catch (error: any) {
      this.addLog(`❌ Failed to test Slack bot: ${error.message}`)
      return { success: false, error: error.message }
    }
  }

  async addSlackChannel(botToken: string, appToken: string, name: string = 'Slack'): Promise<{ success: boolean; error?: string }> {
    if (!appToken || !appToken.startsWith('xapp-')) {
      return { success: false, error: 'Invalid Slack app token format. Must start with xapp-' }
    }
    // Single direct-config-write path. The previous code did CLI →
    // catch → raw fs.writeFile as a fallback, with both branches
    // bypassing the write lock and the fallback duplicating dmPolicy/
    // allowFrom logic. Now we use the same addTokenChannel helper that
    // works for Telegram, with extraFields carrying the second token
    // (appToken) and the socket-mode flag.
    const result = await this.addTokenChannel({
      channel: 'slack',
      tokenField: 'botToken',
      token: botToken,
      name,
      logEmoji: '💬',
      validateFormat: (t) => t.startsWith('xoxb-'),
      formatHint: 'Slack bot tokens start with xoxb-.',
      extraFields: { mode: 'socket', appToken },
    })
    if (!result.success) return result

    // Ensure the slack plugin is enabled. (The CLI used to do this for
    // us. With the direct-write path we have to do it ourselves —
    // otherwise the gateway has the credentials but the plugin stays
    // off and no events flow.)
    try {
      const config = await this.configManager.loadConfig()
      if (!config.plugins) config.plugins = {}
      if (!config.plugins.entries) config.plugins.entries = {}
      if (!config.plugins.entries.slack?.enabled) {
        config.plugins.entries.slack = { ...(config.plugins.entries.slack ?? {}), enabled: true }
        await this.configManager.writeConfig(config)
        this.addLog('🔧 Enabled Slack plugin')
      }
    } catch (pluginErr: any) {
      this.addLog(`⚠️ Slack channel added but plugin-enable failed: ${pluginErr.message}`)
      // Non-fatal — user can enable manually if needed.
    }
    return { success: true }
  }

  async connectSlackBot(botToken: string, appToken: string, name: string = 'Slack'): Promise<{ success: boolean; error?: string }> {
    try {
      // Validate bot token first
      const testResult = await this.testSlackBotToken(botToken)
      if (!testResult.success) {
        return testResult
      }

      // Validate app token format (no REST endpoint available)
      if (!appToken || !appToken.startsWith('xapp-')) {
        return { success: false, error: 'Invalid app token format. Must start with xapp-' }
      }

      const addResult = await this.addSlackChannel(botToken, appToken, name)
      if (!addResult.success) {
        return addResult
      }

      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('slack:status-change', 'connected')
      }

      this.suggestGatewayRestart()

      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  async disconnectSlack(): Promise<{ success: boolean; logs: string[] }> {
    try {
      // Route through the shared disconnect helper so Slack gets the
      // same verify-by-state + config-fallback behavior as Telegram and
      // Discord. The previous Slack-only implementation didn't verify
      // the actual auth state (relied on CLI exit code) and didn't
      // suggest a gateway restart on success — both regressions vs
      // the disconnect refactor that landed for the other channels.
      return await this.disconnectChannel({
        channel: 'slack',
        statusEvent: 'slack:status-change',
        logEmoji: '💬',
      })
    } catch (error: any) {
      this.addLog(`❌ Failed to disconnect Slack: ${error.message}`)
      return { success: false, logs: [error.message] }
    }
  }

  // Feishu Methods
  async checkFeishuStatus(): Promise<{ connected: boolean }> {
    try {
      const config = await this.configManager.loadConfig()
      const appId = config?.channels?.feishu?.accounts?.main?.appId
      return { connected: typeof appId === 'string' && appId.trim().length > 0 }
    } catch {
      return { connected: false }
    }
  }

  async connectFeishu(appId: string, appSecret: string, botName: string = ''): Promise<{ success: boolean; error?: string }> {
    try {
      this.addLog('🔵 Connecting Feishu...')

      if (!appId || !appId.trim() || !appSecret || !appSecret.trim()) {
        return { success: false, error: 'Feishu requires both appId and appSecret' }
      }

      // Use ConfigManager so writes serialise with everything else. The
      // previous raw `fs.readFile`+`writeFile` pair could lose data when
      // a concurrent agent-config write hit at the same time. Same fix
      // pattern as Telegram now uses.
      const config = await this.configManager.loadConfig()
      if (!config.channels) config.channels = {}
      if (!config.channels.feishu) config.channels.feishu = {}
      if (!config.channels.feishu.accounts) config.channels.feishu.accounts = {}
      config.channels.feishu.accounts.main = {
        appId: appId.trim(),
        appSecret: appSecret.trim(),
        ...(botName.trim() ? { botName: botName.trim() } : {}),
        enabled: true,
      }
      // Match the open-access default the bot-token channels use, so
      // Feishu DMs work without manual pairing.
      config.channels.feishu.enabled = true
      config.channels.feishu.dmPolicy = 'open'
      config.channels.feishu.allowFrom = ['*']
      await this.configManager.writeConfig(config)
      this.addLog('✅ Feishu configured successfully')

      this.suggestGatewayRestart()
      return { success: true }
    } catch (error: any) {
      this.addLog(`❌ Failed to connect Feishu: ${error.message}`)
      return { success: false, error: error.message }
    }
  }

  async disconnectFeishu(): Promise<{ success: boolean; logs: string[] }> {
    try {
      this.addLog('🔵 Disconnecting Feishu...')

      const config = await this.configManager.loadConfig()
      if (config?.channels?.feishu) {
        delete config.channels.feishu
        await this.configManager.writeConfig(config)
      }

      this.addLog('✅ Feishu disconnected successfully')
      // Suggest gateway restart so the running provider actually stops.
      // The previous implementation skipped this, so the bot kept
      // responding until the user manually restarted the gateway.
      this.suggestGatewayRestart()
      return { success: true, logs: [] }
    } catch (error: any) {
      this.addLog(`❌ Failed to disconnect Feishu: ${error.message}`)
      return { success: false, logs: [error.message] }
    }
  }

  // Line Methods
  async checkLineStatus(): Promise<{ connected: boolean }> {
    try {
      const config = await this.configManager.loadConfig()
      const token = config?.channels?.line?.channelAccessToken
      return { connected: typeof token === 'string' && token.trim().length > 0 }
    } catch {
      return { connected: false }
    }
  }

  async connectLine(channelAccessToken: string, channelSecret: string): Promise<{ success: boolean; error?: string }> {
    try {
      this.addLog('🟢 Connecting LINE...')

      if (!channelAccessToken || !channelAccessToken.trim() || !channelSecret || !channelSecret.trim()) {
        return { success: false, error: 'LINE requires both channelAccessToken and channelSecret' }
      }

      // ConfigManager.writeConfig for the same write-lock reason
      // documented in connectFeishu / addTokenChannel above.
      const config = await this.configManager.loadConfig()
      if (!config.channels) config.channels = {}
      config.channels.line = {
        ...(config.channels.line ?? {}),
        enabled: true,
        channelAccessToken: channelAccessToken.trim(),
        channelSecret: channelSecret.trim(),
        // Mirror the open-access default the bot-token channels use.
        dmPolicy: 'open',
        allowFrom: ['*'],
      }
      await this.configManager.writeConfig(config)
      this.addLog('✅ LINE configured successfully')

      this.suggestGatewayRestart()

      return { success: true }
    } catch (error: any) {
      this.addLog(`❌ Failed to connect LINE: ${error.message}`)
      return { success: false, error: error.message }
    }
  }

  async disconnectLine(): Promise<{ success: boolean; logs: string[] }> {
    try {
      this.addLog('🟢 Disconnecting LINE...')

      const config = await this.configManager.loadConfig()
      if (config?.channels?.line) {
        delete config.channels.line
        await this.configManager.writeConfig(config)
      }

      this.addLog('✅ LINE disconnected successfully')
      // Suggest gateway restart so the running provider actually stops.
      this.suggestGatewayRestart()
      return { success: true, logs: [] }
    } catch (error: any) {
      this.addLog(`❌ Failed to disconnect LINE: ${error.message}`)
      return { success: false, logs: [error.message] }
    }
  }

  // Agent Management Methods
  async listAgents(): Promise<any[]> {
    try {
      const result = await this.executeOpenClawCommand(['agents', 'list', '--json'])
      const agents = result ? JSON.parse(result) : []

      // Read openclaw.json to get model and fallback configuration
      try {
        const { readFile } = require('fs/promises')
        const { app } = require('electron')
        const configPath = path.join(app.getPath('home'), '.openclaw', 'openclaw.json')

        const content = await readFile(configPath, 'utf8')
        const openclawConfig = JSON.parse(content)

        // Attach model and fallbacks from config to agents
        if (openclawConfig?.agents?.defaults?.model) {
          const modelConfig = openclawConfig.agents.defaults.model

          agents.forEach((agent: any) => {
            // Set model from config if available
            if (modelConfig.primary) {
              agent.model = modelConfig.primary
            }

            // Attach fallbacks from config
            if (modelConfig.fallbacks && modelConfig.fallbacks.length > 0) {
              agent.fallbacks = modelConfig.fallbacks
            }
          })
        }
      } catch (configError) {
        // Silently handle config read errors
      }

      return agents
    } catch (error) {
      console.error('[ChannelManager] Failed to list agents:', error)
      // Return default agent structure if command fails
      return [{
        id: 'main',
        name: 'Main Agent',
        status: 'active',
        model: 'claude-sonnet',
        description: 'Default OpenClaw agent'
      }]
    }
  }

  async getAgentInfo(agentId: string): Promise<any> {
    try {
      const result = await this.executeOpenClawCommand(['agents', 'info', agentId, '--json'])
      return result ? JSON.parse(result) : null
    } catch (error) {
      console.error('[ChannelManager] Failed to get agent info:', error)
      return {
        id: agentId,
        name: `Agent ${agentId}`,
        status: 'unknown',
        model: 'claude-sonnet'
      }
    }
  }

  async createAgent(agentName: string, config: any): Promise<{ success: boolean; error?: string }> {
    try {
      this.addLog(`🤖 Creating agent: ${agentName}`)

      // Sanitize agent name - replace spaces/special chars with hyphens
      const sanitizedAgentName = (agentName ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')

      // Reject names that sanitize to an empty string (e.g. user typed
      // "!!!" or "🦞"). The CLI would otherwise receive `--workspace
      // ~/.openclaw/workspace/` and create an oddly-named agent dir
      // with no readable id. Audit finding #7.
      if (!sanitizedAgentName) {
        const msg = `Agent name "${agentName}" is empty after sanitization. Use letters, digits, or hyphens.`
        this.addLog(`❌ ${msg}`)
        return { success: false, error: msg }
      }

      const { app } = require('electron')
      const homeDir = app.getPath('home')
      // Sibling dir (`workspace-<id>`), NOT nested under the main agent's
      // `~/.openclaw/workspace` — matches the gateway's resolveAgentWorkspaceDir
      // default and keeps the main agent's workspace from listing sub-agent
      // folders. The path is also persisted to agents.list[].workspace so the
      // desktop's WorkspaceManager and the gateway resolve the same dir.
      const workspaceDir = config.workspace || path.join(homeDir, '.openclaw', `workspace-${sanitizedAgentName}`)

      // Use non-interactive mode with workspace directory to avoid prompts
      this.addLog('⏳ Creating agent...')
      await this.executeOpenClawCommand([
        'agents', 'add',
        '--non-interactive',
        '--workspace', workspaceDir,
        sanitizedAgentName
      ])

      // Update per-agent config in openclaw.json (model, fallbacks, workspace)
      await this.updateAgentConfigEntry(sanitizedAgentName, config)

      this.addLog(`✅ Agent "${sanitizedAgentName}" created successfully`)
      return { success: true }
    } catch (error: any) {
      console.error('[ChannelManager] Failed to create agent:', error)
      const errorMessage = error.message || 'Unknown error occurred'
      this.addLog(`❌ Failed to create agent: ${errorMessage}`)
      return { success: false, error: errorMessage }
    }
  }

  /**
   * Write per-agent config (model, fallbacks) into
   * the matching agents.list[] entry in openclaw.json. Also updates
   * agents.defaults.model.primary for backward compatibility.
   */
  private async updateAgentConfigEntry(agentId: string, config: any): Promise<void> {
    const openclawConfig = await this.configManager.loadConfig()

    if (!openclawConfig.agents) openclawConfig.agents = {}
    if (!openclawConfig.agents.defaults) openclawConfig.agents.defaults = {}
    if (!openclawConfig.agents.defaults.model) openclawConfig.agents.defaults.model = {}
    // Canonical roster is the keyed map `agents.entries` — the agent id is the
    // key, not an `id` field. ensureAgent migrates a legacy `agents.list` in
    // place and returns the live entry to mutate.
    const agentEntry = ensureAgent(openclawConfig, agentId)

    // Per-agent model. Bug B2/B3 fix: this used to ALSO write
    // openclaw.agents.defaults.model.primary "for backward compat",
    // making `defaults` effectively "the model of the last edited agent"
    // — every agent edit clobbered the default. New agents added later
    // would inherit whatever was edited most recently, not a stable
    // default. Now we only update defaults when:
    //   - the config has no defaults primary set yet (first-time bootstrap), OR
    //   - the agent being edited IS the active "main" agent (the one
    //     unspecified-routing chats hit) AND no other agent has a
    //     different primary that would be unrelated to "default".
    // This preserves per-agent overrides without making defaults a
    // moving target.
    if (config.model) {
      if (!agentEntry.model) agentEntry.model = {}
      agentEntry.model.primary = config.model

      const defaultsPrimary = openclawConfig.agents.defaults.model.primary
      const isFirstBootstrap = !defaultsPrimary || typeof defaultsPrimary !== 'string'
      const isMainAgent = agentId === 'main'
      if (isFirstBootstrap || isMainAgent) {
        openclawConfig.agents.defaults.model.primary = config.model
      }

      // Pin the harness explicitly to match the model. Without this,
      // openclaw's auto-selection routes anything under provider "openai"
      // (including the openclaw-easy.com openai-responses backend that
      // tunnels Claude/DeepSeek variants) to the codex harness, which
      // injects a "I am Codex / GPT-5" persona-latch system prompt — the
      // model still receives the right weights but reports a wrong
      // identity. {@link setAgentRuntime} writes the canonical per-model
      // location; see agent-harness.ts for the harness resolution rules.
      //
      // Exec policy matters: codex app-server rejects when tools.exec.mode
      // resolves to deny/allowlist; we pass the merged exec context so
      // resolveAgentHarness can fall back to pi when codex would refuse.
      const execContext = readExecContextForAgent(openclawConfig, agentId)
      const harness = resolveAgentHarness(config.model, execContext)
      setAgentRuntime(agentEntry, config.model, harness)
    }

    // Per-agent fallbacks — same rule.
    if (config.fallbacks !== undefined) {
      if (!agentEntry.model) agentEntry.model = {}
      agentEntry.model.fallbacks = config.fallbacks

      const defaultsFallbacks = openclawConfig.agents.defaults.model.fallbacks
      const isFirstBootstrap = !Array.isArray(defaultsFallbacks)
      const isMainAgent = agentId === 'main'
      if (isFirstBootstrap || isMainAgent) {
        openclawConfig.agents.defaults.model.fallbacks = config.fallbacks
      }
    }

    // Clean up keys that OpenClaw's config schema doesn't recognize
    // (these cause "Unrecognized key" validation errors and crash the gateway)
    delete agentEntry.description
    delete agentEntry.systemPrompt

    await this.configManager.writeConfig(openclawConfig)
  }

  async deleteAgent(agentId: string): Promise<{ success: boolean; error?: string }> {
    try {
      this.addLog(`🗑️ Deleting agent: ${agentId}`)

      // The CLI removes the agent's workspace + sessions dir but leaves
      // a stale entry in `~/.openclaw/openclaw.json::agents.list[]`.
      // We try the CLI first (handles the on-disk cleanup) then ALWAYS
      // remove the config entry — even if the CLI fails we want the
      // deleted agent to disappear from listAgents (otherwise it
      // resurrects on the next reload).
      let cliError: Error | null = null
      try {
        await this.executeOpenClawCommand([
          'agents', 'delete',
          '--force',
          agentId,
        ])
      } catch (err: any) {
        cliError = err instanceof Error ? err : new Error(String(err))
        this.addLog(`⚠️ Agent CLI delete reported error: ${cliError.message} — falling through to config cleanup`)
      }

      // Remove the agent's config entry. Goes through ConfigManager
      // so the write is serialised with every other config write.
      try {
        const config = await this.configManager.loadConfig()
        if (deleteAgent(config, agentId)) {
          await this.configManager.writeConfig(config)
          this.addLog(`🧹 Removed '${agentId}' from agents.entries`)
        }
      } catch (cleanupErr: any) {
        // If we can't write the config we have to report failure even
        // if the CLI succeeded — otherwise the ghost entry stays.
        this.addLog(`❌ Failed to clean up agent config: ${cleanupErr.message}`)
        return { success: false, error: cleanupErr.message }
      }

      if (cliError) {
        // CLI failed but config cleanup succeeded — surface to user.
        // The agent is gone from the desktop's view but may have
        // leftover workspace files on disk.
        return { success: false, error: cliError.message }
      }
      this.addLog(`✅ Agent '${agentId}' deleted successfully`)
      return { success: true }
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error occurred'
      this.addLog(`❌ Failed to delete agent: ${errorMessage}`)
      return { success: false, error: errorMessage }
    }
  }

  async updateAgent(agentId: string, config: any): Promise<{ success: boolean; error?: string; prevModel?: string }> {
    try {
      this.addLog(`🔧 Updating agent: ${agentId}`)

      // Read previous model for return value
      const openclawConfig = await this.configManager.loadConfig()
      const agentEntry = getAgent(openclawConfig, agentId)
      const prevModel = agentEntry?.model?.primary || openclawConfig.agents?.defaults?.model?.primary

      // Write per-agent config using the shared helper
      await this.updateAgentConfigEntry(agentId, config)

      this.addLog(`✅ Agent ${agentId} updated successfully`)
      return { success: true, prevModel }
    } catch (error: any) {
      console.error('[ChannelManager] Failed to update agent:', error)
      this.addLog(`❌ Failed to update agent: ${error.message}`)
      return { success: false, error: error.message }
    }
  }

  // WhatsApp Message Content Methods
  async getWhatsAppMessages(): Promise<{ success: boolean; messages?: any[]; error?: string }> {
    try {
      this.addLog('📱 Fetching WhatsApp messages...')

      // Try to get messages using OpenClaw commands
      try {
        // Method 1: Try to get recent messages from OpenClaw
        const messagesResult = await this.executeOpenClawCommand([
          'channels', 'messages', '--channel', 'whatsapp', '--limit', '50', '--json'
        ])

        if (messagesResult) {
          try {
            const messages = JSON.parse(messagesResult)
            this.addLog(`✅ Retrieved ${messages.length} WhatsApp messages via OpenClaw API`)
            return { success: true, messages }
          } catch (parseError: any) {
            console.log('[ChannelManager] Failed to parse OpenClaw result as JSON:', parseError.message)
          }
        }
      } catch (error: any) {
        console.log('[ChannelManager] OpenClaw command failed, trying alternative methods...', error.message)
      }

      // Method 2: Try to read message history from files
      const homeDir = require('os').homedir()
      const path = require('path')
      const fs = require('fs').promises

      // Check for WhatsApp session/message files
      const sessionDir = path.join(homeDir, '.openclaw', 'sessions', 'whatsapp')
      const credentialsDir = path.join(homeDir, '.openclaw', 'credentials', 'whatsapp')

      const messagePaths = [
        path.join(sessionDir, 'messages.json'),
        path.join(sessionDir, 'chat_history.json'),
        path.join(credentialsDir, 'messages.json'),
        path.join(homeDir, '.openclaw', 'messages', 'whatsapp.json')
      ]

      for (const messagePath of messagePaths) {
        try {
          const messageData = await fs.readFile(messagePath, 'utf-8')
          const messages = JSON.parse(messageData)

          if (Array.isArray(messages) && messages.length > 0) {
            this.addLog(`✅ Found ${messages.length} messages in file system`)
            return { success: true, messages: messages.slice(-50) } // Last 50 messages
          }
        } catch (error: any) {
          // File doesn't exist or can't be read, continue to next
        }
      }

      // Method 3: Extract from recent logs if we can find content patterns
      const recentMessages = this.extractMessagesFromLogs()
      if (recentMessages.length > 0) {
        this.addLog(`✅ Extracted ${recentMessages.length} messages from memory logs`)
        return { success: true, messages: recentMessages }
      }

      // Method 4: Read directly from OpenClaw JSON log file
      const logFileMessages = await this.extractMessagesFromOpenClawLogFile()
      if (logFileMessages.length > 0) {
        this.addLog(`✅ Extracted ${logFileMessages.length} messages from OpenClaw log file`)
        return { success: true, messages: logFileMessages }
      }

      this.addLog('⚠️ No WhatsApp messages found in any location')
      return { success: false, error: 'No messages found' }

    } catch (error: any) {
      console.error('[ChannelManager] Failed to get WhatsApp messages:', error)
      this.addLog(`❌ Failed to get WhatsApp messages: ${error.message}`)
      return { success: false, error: error.message }
    }
  }

  // Helper method to extract messages from logs
  private extractMessagesFromLogs(): any[] {
    const messages: any[] = []

    // Look through recent logs for message content
    const recentLogs: string[] = [] // Logs are streamed to renderer, not stored locally

    for (let i = 0; i < recentLogs.length; i++) {
      const log = recentLogs[i]

      // Look for message metadata logs
      const metadataMatch = log.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z).*\[whatsapp\]\s+(Inbound|Outbound) message\s+([+\d]+)\s*(?:->\s*)?([+\d]+)?\s*\(([^,]+),\s+(\d+)\s+chars\)/)

      if (metadataMatch) {
        const [, timestamp, direction, from, to, type, charCount] = metadataMatch

        // Look for content in surrounding logs (within next 5 logs)
        let content = ''

        for (let j = i + 1; j < Math.min(i + 6, recentLogs.length); j++) {
          const contentLog = recentLogs[j]

          // Look for content patterns
          const contentMatch = contentLog.match(/(?:content|text|message):\s*(.+)/i) ||
                              contentLog.match(/^\s*"([^"]+)"/) ||
                              contentLog.match(/Body:\s*(.+)/i) ||
                              contentLog.match(/Text:\s*(.+)/i)

          if (contentMatch) {
            content = contentMatch[1].trim()
            break
          }

          // Also check for plain text that might be the message (if it's not a log format)
          const isLikelyContent = !contentLog.includes('[whatsapp]') &&
              !contentLog.includes('ERROR') &&
              !contentLog.includes('INFO') &&
              !contentLog.includes('WARN') &&
              contentLog.trim().length > 0 &&
              contentLog.trim().length <= parseInt(charCount)

          if (isLikelyContent) {
            content = contentLog.trim()
            break
          }
        }

        const messageObj = {
          timestamp,
          direction: direction.toLowerCase(),
          from: direction === 'Inbound' ? from : 'bot',
          to: direction === 'Outbound' ? (to || from) : 'bot',
          content: content || `${type} message (${charCount} chars)`,
          charCount: parseInt(charCount),
          type
        }

        messages.push(messageObj)
      }
    }

    return messages
  }

  // New method to parse OpenClaw JSON log file
  private async extractMessagesFromOpenClawLogFile(): Promise<any[]> {
    try {
      const fs = require('fs').promises

      // Try to read the OpenClaw log file (dynamically generate today's date)
      const today = new Date().toISOString().split('T')[0]
      const logPath = `/tmp/openclaw/openclaw-${today}.log`

      const logContent = await fs.readFile(logPath, 'utf-8')
      const logLines = logContent.trim().split('\n')

      const messages: any[] = []
      const messageMap = new Map<string, any>()

      // Process each log line
      for (let i = 0; i < logLines.length; i++) {
        const line = logLines[i]

        if (!line.trim()) {continue}

        try {
          const logEntry = JSON.parse(line)

          // Check for WhatsApp inbound metadata
          if (logEntry['0']?.includes('whatsapp/inbound') &&
              logEntry['1']?.includes('Inbound message')) {

            const metadataMatch = logEntry['1'].match(/Inbound message ([+\d]+) -> ([+\d]+) \(([^,]+), (\d+) chars\)/)
            if (metadataMatch) {
              const [, from, to, type, charCount] = metadataMatch
              const timestamp = logEntry._meta?.date || logEntry.time
              const messageId = `${from}-${timestamp}`

              messageMap.set(messageId, {
                timestamp,
                direction: 'inbound',
                from,
                to,
                charCount: parseInt(charCount),
                type,
                content: null // Will be filled by content entry
              })
            }
          }

          // Check for WhatsApp outbound metadata
          if (logEntry['0']?.includes('whatsapp/outbound') &&
              logEntry['1']?.includes('Auto-replied')) {

            const outboundMatch = logEntry['1'].match(/Auto-replied to ([+\d]+)/)
            if (outboundMatch) {
              const [, to] = outboundMatch
              const timestamp = logEntry._meta?.date || logEntry.time
              const messageId = `bot-${timestamp}`

              messageMap.set(messageId, {
                timestamp,
                direction: 'outbound',
                from: 'bot',
                to,
                charCount: 0,
                type: 'reply',
                content: null
              })
            }
          }

          // Check for message content in web-auto-reply entries
          if (logEntry['0']?.includes('web-auto-reply') &&
              logEntry['1']?.body) {

            const body = logEntry['1'].body

            // Parse the content - format: [WhatsApp +number +time GMT] [openclaw] ACTUAL_CONTENT
            const contentMatch = body.match(/\[WhatsApp ([+\d]+) .+?\] \[openclaw\] (.+)/)
            if (contentMatch) {
              const [, phoneNumber, actualContent] = contentMatch

              // Find corresponding metadata entry
              for (const [messageId, messageData] of messageMap.entries()) {
                if (messageData.content === null &&
                    (messageData.from === phoneNumber || messageData.to === phoneNumber)) {
                  messageData.content = actualContent
                  messageData.charCount = actualContent.length
                  break
                }
              }
            }
          }

        } catch (parseError) {
          // Skip invalid JSON lines
          continue
        }
      }

      // Convert map to array and filter out messages without content
      const finalMessages = Array.from(messageMap.values())
        .filter(msg => msg.content && msg.content.trim().length > 0)
        .slice(-20) // Last 20 messages

      return finalMessages

    } catch (error: any) {
      console.error('[ChannelManager] Error parsing OpenClaw log file:', error)
      return []
    }
  }

  // ---------------------------------------------------------------------
  // Weixin (personal WeChat)
  // ---------------------------------------------------------------------
  // Unlike our other six channels, Weixin is an EXTERNAL official plugin: it
  // is excluded from the core dist, so `channels login` only works after the
  // npm package is installed and enabled and the gateway has restarted.
  // Pinned spec + id come from scripts/lib/official-external-channel-catalog.json.

  /**
   * Installs + enables the Weixin plugin if it is not already usable.
   * Idempotent: a second call short-circuits once the plugin is enabled, so
   * the connect button can be pressed repeatedly without reinstalling.
   */
  async ensureWeixinPlugin(): Promise<{ success: boolean; alreadyInstalled: boolean; logs: string[] }> {
    const logs: string[] = []
    try {
      const listed = await this.executeOpenClawCommand(['plugins', 'list'])
      if (listed?.includes(WEIXIN_PLUGIN_ID)) {
        // A reinstall/update done outside the desktop (CLI, doctor) restores
        // the broken 2.4.6 import — re-apply the compat repair every time.
        this.repairWeixinPluginCompat({ suggestRestartOnRepair: true })
        this.addLog('✅ Weixin plugin already installed')
        return { success: true, alreadyInstalled: true, logs }
      }

      this.addLog('📦 Installing Weixin plugin…')
      const installed = await this.executeOpenClawCommand(['plugins', 'install', WEIXIN_NPM_SPEC])
      if (installed === null) {
        this.addLog('❌ Weixin plugin install failed')
        return { success: false, alreadyInstalled: false, logs }
      }

      // 2.4.6 (newest on npm) imports a deleted SDK subpath and crash-loops
      // on 2026.7.x without this rewrite — see weixin-plugin-repair.ts.
      this.repairWeixinPluginCompat({ suggestRestartOnRepair: false })

      // Enable explicitly: install alone does not flip
      // plugins.entries.<id>.enabled. Goes through ConfigManager so the write
      // uses the shared validation pipeline and write lock rather than a raw
      // `config set`.
      await this.ensurePluginEnabled(WEIXIN_PLUGIN_ID)
      this.addLog('✅ Weixin plugin installed and enabled')
      // The gateway only picks up a newly installed plugin after a restart —
      // plugin metadata is process-stable by design.
      this.suggestGatewayRestart()
      return { success: true, alreadyInstalled: false, logs }
    } catch (error: any) {
      this.addLog(`❌ Weixin plugin setup failed: ${error.message}`)
      return { success: false, alreadyInstalled: false, logs }
    }
  }

  /**
   * Apply the createTypingCallbacks import rewrite to the installed plugin.
   * When a repair actually changed files while the plugin was already
   * running, the channel process has likely exhausted its crash-loop
   * retries — only then is a gateway restart suggested.
   */
  private repairWeixinPluginCompat(opts: { suggestRestartOnRepair: boolean }): void {
    try {
      const { changedFiles } = repairInstalledWeixinPlugin(path.dirname(this.configPath))
      if (changedFiles.length > 0) {
        this.addLog(`🔧 Repaired Weixin plugin SDK imports (${changedFiles.length} file(s)) for OpenClaw 2026.7.x`)
        if (opts.suggestRestartOnRepair) {
          this.suggestGatewayRestart()
        }
      }
    } catch (error: any) {
      // Best-effort: a failed repair leaves the plugin exactly as installed.
      this.addLog(`⚠️ Weixin plugin compat repair failed: ${error.message}`)
    }
  }

  /**
   * Runs `channels login --channel openclaw-weixin` and returns the scannable
   * QR. Mirrors the WhatsApp flow (same terminal-QR rendering), but success is
   * detected from process exit rather than log-marker strings so we do not
   * depend on this plugin's wording.
   */
  async getWeixinQRFromLogin(): Promise<{ success: boolean; qrData?: string; logs: string[] }> {
    const logs: string[] = []

    if (weixinOperationInProgress) {
      return { success: false, logs: ['Weixin operation already in progress, please wait'] }
    }
    weixinOperationInProgress = true

    try {
      const prepared = await this.ensureWeixinPlugin()
      if (!prepared.success) {
        return { success: false, logs: ['Weixin plugin is not installed — see Activity log'] }
      }

      this.cleanupWeixinSession()
      this.addLog('🔗 Starting Weixin QR generation…')

      const { runtime, enhancedEnv, cwd, buildArgs } = await this.resolveOpenClawSpawn()
      // Run under a pty, not a plain pipe. `channels login` drives the
      // onboarding wizard, whose prompt library only reads from a real TTY:
      // with piped stdio the "Install Weixin plugin?" prompt renders but can
      // never be answered, so the process hangs and no QR is ever produced.
      // A pty also gives us the terminal-rendered QR verbatim.
      const { spawn: ptySpawn } = await import('node-pty')
      const ptyProcess = ptySpawn(
        runtime,
        buildArgs('channels', 'login', '--channel', WEIXIN_CHANNEL_ID),
        {
          name: 'xterm-256color',
          // Wide enough that the QR is not wrapped; wrapping would break the
          // contiguous glyph-run detection in extractTerminalQr.
          cols: 120,
          rows: 40,
          cwd,
          env: enhancedEnv as Record<string, string>,
        },
      )

      weixinPty = ptyProcess

      return await new Promise((resolve) => {
        let settled = false
        // Buffer across chunks: a terminal QR is routinely split across
        // multiple `data` events, so per-chunk scanning misses it entirely.
        let stdoutBuffer = ''
        // `channels login` runs the onboarding wizard, which asks
        // "Install Weixin plugin?" with "Download from npm" preselected — and
        // it asks even when the plugin is already installed and enabled.
        // We spawn with piped stdio and no TTY, so nothing answers it and the
        // process hangs forever without ever emitting a QR. Confirm the
        // highlighted default once, which is what a user would do.
        let answeredInstallPrompt = false

        const finish = (result: { success: boolean; qrData?: string; logs: string[] }) => {
          if (settled) return
          settled = true
          resolve(result)
        }

        const onData = (chunk: string) => {
          const text = chunk
          logs.push(text)
          stdoutBuffer += text

          const clean = stripAnsi(text)

          if (!answeredInstallPrompt && /Install .*plugin\?|Download from npm/i.test(clean)) {
            answeredInstallPrompt = true
            this.addLog('📦 Confirming Weixin plugin install prompt…')
            try {
              // CR is what the prompt library treats as Enter; the
              // highlighted default is "Download from npm".
              ptyProcess.write('\r')
            } catch {
              // pty already gone — exit handler settles the promise.
            }
            return
          }

          if (/already linked|already logged in|已登录/i.test(clean)) {
            this.addLog('✅ Weixin is already connected')
            this.cleanupWeixinSession()
            finish({ success: true, qrData: 'ALREADY_CONNECTED', logs })
            return
          }

          const qr = extractTerminalQr(stdoutBuffer)
          if (qr) {
            this.addLog('📱 Weixin QR code ready — scan it in WeChat')
            finish({ success: true, qrData: qr, logs })
          }
        }

        ptyProcess.onData(onData)

        ptyProcess.onExit(({ exitCode }) => {
          const ok = exitCode === 0
          this.addLog(ok ? '✅ Weixin login completed' : `❌ Weixin login exited (${exitCode})`)
          // The IPC promise already resolved when the QR was extracted, so the
          // scan result can only reach the renderer as an event. Emit BOTH
          // outcomes: without the failure case an expired QR leaves the modal
          // showing a dead code forever, with no way to tell it apart from one
          // still waiting to be scanned.
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send(
              'weixin:status-change',
              ok ? 'connected' : 'failed',
            )
          }
          weixinPty = null
          finish({ success: ok, logs })
        })
      })
    } catch (error: any) {
      this.addLog(`❌ Failed to start Weixin login: ${error.message}`)
      return { success: false, logs }
    } finally {
      weixinOperationInProgress = false
    }
  }

  /**
   * Weixin keeps no credential in openclaw.json. A completed QR login writes a
   * logged-in account into the plugin's own state dir:
   *
   *   ~/.openclaw/openclaw-weixin/accounts.json   -> ["<accountId>", ...]
   *   ~/.openclaw/openclaw-weixin/accounts/<accountId>.json
   *
   * NOT `~/.openclaw/credentials/<channel>/`, which is the WhatsApp layout this
   * check was originally modelled on. Probing there meant a successful scan
   * still reported "not connected" forever — the app looked like nothing had
   * happened even though the channel was live and replying.
   *
   * `channels['openclaw-weixin'].enabled` is deliberately NOT the signal:
   * `channels add` sets it before any login, so it is true for a channel that
   * has never been paired. The account registry is the only real login proof.
   */
  async checkWeixinStatus(): Promise<{ connected: boolean }> {
    try {
      const config = await this.configManager.loadConfig()
      if (!config?.plugins?.entries?.[WEIXIN_PLUGIN_ID]?.enabled) {
        return { connected: false }
      }
      const homeDir = process.env.HOME || process.env.USERPROFILE || ''
      return { connected: (await listWeixinAccountIds(homeDir)).length > 0 }
    } catch {
      return { connected: false }
    }
  }

  /**
   * Disconnects Weixin and reports the resulting STATE, not a command's exit
   * code.
   *
   * This used to run `channels logout --channel openclaw-weixin`. The plugin
   * declares only a login action (`loginWithQrStart`/`loginWithQrWait`), so the
   * CLI exits 1 with "does not support logout" and disconnect always failed.
   *
   * `channels remove` retires the account in openclaw.json, but the plugin also
   * keeps its own account registry under `~/.openclaw/openclaw-weixin/` (see
   * listWeixinAccountIds). Leaving that behind makes checkWeixinStatus report
   * "connected" against a channel that is gone, so both have to go — and the
   * verdict is whether the account registry actually came back empty.
   */
  async disconnectWeixin(): Promise<boolean> {
    const homeDir = process.env.HOME || process.env.USERPROFILE || ''
    try {
      this.cleanupWeixinSession()

      // Best-effort: retires the config entry. A non-zero exit here is not
      // fatal — the state check below decides.
      await this.executeOpenClawCommand([
        'channels',
        'remove',
        '--channel',
        WEIXIN_CHANNEL_ID,
        '--delete',
      ]).catch(() => null)

      await this.clearWeixinAccountState(homeDir)

      const success = (await listWeixinAccountIds(homeDir)).length === 0
      this.addLog(success ? '✅ Weixin disconnected' : '❌ Weixin disconnect failed')
      if (success) this.suggestGatewayRestart()
      return success
    } catch (error: any) {
      this.addLog(`❌ Weixin disconnect failed: ${error.message}`)
      return false
    }
  }

  /**
   * Removes the plugin's logged-in account files. Scoped to the account
   * registry and its per-account files so unrelated plugin state is left
   * alone; the dir itself stays so a later login writes into place.
   */
  private async clearWeixinAccountState(homeDir: string): Promise<void> {
    const { promises: fs } = await import('fs')
    const path = await import('path')
    const stateDir = path.join(homeDir, '.openclaw', WEIXIN_CHANNEL_ID)

    await fs.rm(path.join(stateDir, 'accounts.json'), { force: true })
    try {
      const accountsDir = path.join(stateDir, 'accounts')
      for (const name of await fs.readdir(accountsDir)) {
        if (name.endsWith('.json')) {
          await fs.rm(path.join(accountsDir, name), { force: true })
        }
      }
    } catch {
      // Accounts dir absent — nothing logged in, already the desired state.
    }
  }

  private cleanupWeixinSession() {
    if (weixinPty) {
      try {
        weixinPty.kill()
      } catch {
        // Already exited — nothing to clean up.
      }
    }
    weixinPty = null
  }

  destroy() {
    if (this.sessionCleanupTimer) {
      clearInterval(this.sessionCleanupTimer)
      this.sessionCleanupTimer = null
    }
    this.cleanupWhatsAppSession()
    this.cleanupWeixinSession()
  }
}