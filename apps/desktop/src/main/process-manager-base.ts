import { spawn, ChildProcess } from 'child_process'
import { BrowserWindow } from 'electron'
import * as path from 'path'
import * as net from 'net'
import * as http from 'http'
import { OpenClawEnvironment } from './openclaw-environment'
import { DEFAULT_GATEWAY_PORT } from '../shared/constants'
import { detectSystemOpenClaw as resolveSystemOpenClaw } from './managers/system-openclaw-resolver'

// Forward declaration to avoid circular dependency
export type ConfigManager = {
  ensureGatewayConfigured(port: number): Promise<void>
}

export type ProcessStatus = 'stopped' | 'starting' | 'running' | 'error'

/**
 * Gateway mode determines how the desktop app interacts with the OpenClaw gateway:
 *
 * - 'external': An existing gateway is already running (started outside the desktop app).
 *   The desktop app connects to it as a GUI client without spawning anything.
 *
 * - 'system': The user has the core OpenClaw CLI installed system-wide, but the gateway
 *   is not running. The desktop app starts the gateway using the system binary.
 *
 * - 'bundled': No system OpenClaw found. The desktop app uses its own bundled copy
 *   (current/legacy behavior).
 */
export type GatewayMode = 'external' | 'system' | 'bundled'

export interface GatewayModeInfo {
  mode: GatewayMode
  /** Path to the system openclaw binary (only set for 'system' mode) */
  systemBinaryPath?: string
  /** Port of the running/target gateway */
  port: number
}

/** Returns true for curl progress-meter and header lines — pure noise, not useful errors. */
export function isCurlNoiseLine(line: string): boolean {
  return (
    /^\s*\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+[-\d:]+/.test(line) || // progress rows
    /^%\s+Total\s+%\s+Received/.test(line) ||   // header row 1
    /Dload\s+Upload\s+Total\s+Spent/.test(line) || // header row 2
    line.trim() === 'Command aborted by signal SIGTERM'
  )
}

/** Returns true for gateway stdout/stderr lines that are known noise (not actionable errors). */
export function isGatewayNoiseLine(line: string): boolean {
  const t = line.trim()
  return (
    t.includes('duplicate plugin id detected') ||
    t === 'Config warnings:' ||
    t.startsWith('RangeError:') ||
    t.includes('Maximum call stack size exceeded') ||
    t.startsWith('at ') || // stack trace frames
    /^\d+\s*\|/.test(t) || // source code snippet lines (e.g. "122 |   }")
    /^\^$/.test(t) || // caret pointing to error location
    t.includes('Failed to read config at') ||
    t === '' ||
    t === '(Use `node --trace-warnings ...` to show where the warning was created)'
  )
}

export interface ProcessEvent {
  status: ProcessStatus
  timestamp: string
  previousStatus?: ProcessStatus
}

export interface HealthEvent {
  status: ProcessStatus
  logCount: number
  uptime: number
  timestamp: string
}

export abstract class ProcessManagerBase {
  protected process: ChildProcess | null = null
  protected status: ProcessStatus = 'stopped'
  protected mainWindow: BrowserWindow | null = null
  protected healthCheckInterval: NodeJS.Timeout | null = null
  protected configPath: string
  protected openclawEnv: OpenClawEnvironment
  protected activePort: number = 0
  protected configManager: ConfigManager | null = null
  protected gatewayMode: GatewayMode = 'bundled'
  protected systemBinaryPath: string | null = null
  /** Polling interval for monitoring external/system gateway liveness */
  protected externalMonitorInterval: NodeJS.Timeout | null = null
  /** Epoch ms when the current child process was spawned (or 0 if none). */
  protected spawnedAt: number = 0
  /** True while a stop() is in flight — used to distinguish operator stops from crashes. */
  protected intentionalStop: boolean = false
  /** Auto-restart attempts since the last clean run. Reset on a successful run. */
  protected restartAttempts: number = 0
  /** Pending auto-restart timer; cancelled on stop(). */
  protected restartTimer: NodeJS.Timeout | null = null

  constructor(configPath: string, configManager?: ConfigManager) {
    this.configPath = configPath
    this.openclawEnv = new OpenClawEnvironment(configPath)
    this.configManager = configManager || null
    this.startHealthMonitoring()
  }

  setMainWindow(window: BrowserWindow | null) {
    this.mainWindow = window
  }

  /**
   * Start the gateway. `presetMode`, if supplied, lets the caller skip
   * an internal re-detection — the openclaw-manager already detects
   * the mode at its layer to decide config-write strategy, so passing
   * the same `GatewayModeInfo` down avoids running TCP probe +
   * `which openclaw` + 5 `fs.existsSync` calls a second time.
   */
  abstract start(presetMode?: GatewayModeInfo): Promise<boolean>
  abstract stop(): Promise<boolean>
  abstract restart(): Promise<boolean>

  getGatewayMode(): GatewayMode {
    return this.gatewayMode
  }

  getGatewayModeInfo(): GatewayModeInfo {
    return {
      mode: this.gatewayMode,
      systemBinaryPath: this.systemBinaryPath || undefined,
      port: this.activePort
    }
  }

  getStatus(): ProcessStatus {
    // For external mode, we don't own a process — status is based on port polling
    if (this.gatewayMode === 'external' && this.status === 'running' && !this.process) {
      return 'running'
    }
    if (this.process && !this.process.killed && this.status === 'running') {
      return 'running'
    } else if (this.status === 'running' && this.gatewayMode !== 'external') {
      this.setStatus('stopped')
    }
    return this.status
  }

  getActivePort(): number {
    return this.activePort
  }

  /**
   * The PID of the gateway process when we own it (bundled/system modes).
   * Returns null in external mode since we don't have a handle on the
   * launchd-managed or already-running process. The renderer should hide
   * the PID line when this is null instead of falling back to a misleading
   * placeholder string.
   */
  getActivePid(): number | null {
    return this.process && !this.process.killed && typeof this.process.pid === 'number'
      ? this.process.pid
      : null
  }

  isRunning(): boolean {
    return this.status === 'running'
  }

  /**
   * Is a gateway actually serving on the configured port, whoever started it?
   *
   * `isRunning()` reports the status this manager tracks, which lags or misses
   * a gateway the desktop does not own — the launchd service (external mode),
   * or one started before the app. Restart-to-apply decisions must not use it:
   * a model change that skips the restart leaves the running gateway on the
   * OLD model, and the user gets an auth error naming the previous provider
   * while the UI shows the new model as active.
   *
   * Probes the port instead, so external and owned gateways answer the same.
   */
  async isGatewayReachable(): Promise<boolean> {
    const port = this.activePort || this.readConfiguredGatewayPort()
    if (!port) return false
    return this.isPortListeningBase(port)
  }

  protected setStatus(newStatus: ProcessStatus) {
    if (this.status !== newStatus) {
      const oldStatus = this.status
      this.status = newStatus
      console.log(`[ProcessManager] Status changed: ${oldStatus} → ${newStatus}`)
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('openclaw:status-update', {
          status: newStatus,
          timestamp: new Date().toISOString(),
          previousStatus: oldStatus
        } as ProcessEvent)
      }
      for (const fn of this.statusListeners) {
        try { fn(newStatus, oldStatus) } catch (err) { console.error('[ProcessManager] Status listener threw:', err) }
      }
    }
  }

  private statusListeners: Array<(status: ProcessStatus, previous: ProcessStatus) => void> = []
  /** Subscribe to status changes outside the renderer (e.g. tray menu). Returns an unsubscribe fn. */
  public onStatusChange(fn: (status: ProcessStatus, previous: ProcessStatus) => void): () => void {
    this.statusListeners.push(fn)
    return () => { this.statusListeners = this.statusListeners.filter(f => f !== fn) }
  }

  protected emitLog(message: string) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      const timestamp = new Date().toISOString()
      this.mainWindow.webContents.send('openclaw:log-update', {
        timestamp,
        message,
        fullEntry: `[${timestamp}] ${message}`
      })
    }
  }

  protected cleanupProcessListeners(proc: ChildProcess | null) {
    if (!proc) return
    proc.stdout?.removeAllListeners()
    proc.stderr?.removeAllListeners()
    proc.removeAllListeners()
  }

  protected setupProcessListeners() {
    // Clean up listeners from any previous process before attaching new ones
    this.cleanupProcessListeners(this.process)
    if (!this.process) { return }
    const proc = this.process

    proc.stdout?.on('data', (data) => {
      const text = data.toString().trim()
      if (text) {
        const filtered = text.split('\n').filter((l: string) =>
          !isCurlNoiseLine(l) && !isGatewayNoiseLine(l)
        ).join('\n').trim()
        if (filtered) {
          console.log('[OpenClaw Gateway]', filtered)
          this.emitLog(`🖥️ ${filtered}`)
        }
      }
    })

    proc.stderr?.on('data', (data) => {
      const text = data.toString().trim()
      if (!text || text.includes('DeprecationWarning')) { return }
      const filtered = text.split('\n').filter((l: string) =>
        !isCurlNoiseLine(l) && !isGatewayNoiseLine(l)
      ).join('\n').trim()
      if (filtered) {
        console.log('[OpenClaw Gateway Error]', filtered)
        this.emitLog(`⚠️ ${filtered}`)
      }
    })

    proc.on('error', (error) => {
      if (this.process !== proc) { return }
      console.error('[ProcessManager] Gateway process error:', error)
      this.setStatus('error')
      this.emitLog(`❌ Gateway process error: ${error.message}`)
    })

    proc.on('exit', (code, signal) => {
      console.log(`[ProcessManager] Gateway process exited with code ${code}, signal ${signal}, pid=${proc.pid}`)
      if (this.process !== proc) {
        console.log(`[ProcessManager] Ignoring exit from stale process (current pid=${this.process?.pid})`)
        return
      }
      const wasRunning = this.status === 'running'
      const wasStarting = this.status === 'starting'
      if (wasRunning) {
        this.setStatus('stopped')
        this.emitLog('❌ Gateway process stopped unexpectedly')
      } else if (wasStarting) {
        this.setStatus('stopped')
        this.emitLog(`❌ Gateway process died during startup (signal=${signal})`)
      }
      this.process = null
      this.spawnedAt = 0

      // Auto-restart on unexpected exit. openclaw's own architecture
      // doc says "Supervision: launchd/systemd for auto-restart" — when
      // we own the process (bundled/system spawn) we have to supervise
      // ourselves. Operator-driven stop()s set intentionalStop so we
      // don't fight them. Backoff caps at 3 attempts; on the 3rd
      // failure we surface 'error' and stop trying.
      if (!this.intentionalStop && wasRunning && this.gatewayMode !== 'external') {
        this.scheduleAutoRestart()
      }
    })
  }

  /**
   * Schedule a backed-off restart of the gateway after an unexpected
   * exit. Backoff: 1s → 3s → 9s, then give up and stay 'error'.
   */
  protected scheduleAutoRestart(): void {
    if (this.restartTimer) return // already scheduled
    if (this.restartAttempts >= 3) {
      console.error('[ProcessManager] Gave up auto-restart after 3 attempts')
      this.emitLog('❌ Gateway failed to recover after 3 restart attempts — please restart manually')
      this.setStatus('error')
      return
    }
    const delayMs = 1000 * Math.pow(3, this.restartAttempts) // 1s, 3s, 9s
    this.restartAttempts++
    console.log(`[ProcessManager] Scheduling auto-restart #${this.restartAttempts} in ${delayMs}ms`)
    this.emitLog(`🔄 Gateway crashed — auto-restarting in ${delayMs / 1000}s (attempt ${this.restartAttempts}/3)`)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.start().then((ok) => {
        if (ok) {
          // Successful relaunch — reset attempts so a future independent
          // crash doesn't inherit the count.
          this.restartAttempts = 0
        }
      }).catch((err) => {
        console.error('[ProcessManager] Auto-restart attempt failed:', err)
      })
    }, delayMs)
  }

  /**
   * Cancel any pending auto-restart timer. Does NOT reset the attempt
   * counter — the auto-restart sequence itself needs the counter to
   * persist across its scheduled retries. Operator-driven stop()
   * resets the counter separately.
   */
  protected cancelAutoRestart(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
  }

  protected async clearAllCooldowns(): Promise<void> {
    try {
      const { readFile, writeFile } = await import('fs/promises')
      const { existsSync } = await import('fs')
      const home = process.env.HOME || process.env.USERPROFILE || ''
      const authProfilesPaths = [
        path.join(home, '.openclaw', 'auth-profiles.json'),
        path.join(home, '.openclaw', 'agents', 'main', 'agent', 'auth-profiles.json')
      ]

      for (const authPath of authProfilesPaths) {
        if (existsSync(authPath)) {
          try {
            const content = await readFile(authPath, 'utf8')
            const authProfiles = JSON.parse(content)
            if (authProfiles.usageStats) {
              for (const profileId in authProfiles.usageStats) {
                authProfiles.usageStats[profileId] = {
                  ...authProfiles.usageStats[profileId],
                  errorCount: 0,
                  cooldownUntil: undefined,
                  disabledUntil: undefined,
                  disabledReason: undefined,
                  failureCounts: undefined,
                  lastFailureAt: undefined
                }
              }
              await writeFile(authPath, JSON.stringify(authProfiles, null, 2))
              console.log(`[ProcessManager] Cleared cooldown state from ${authPath}`)
            }
          } catch (error: any) {
            console.error(`[ProcessManager] Failed to clear cooldowns from ${authPath}:`, error.message)
          }
        }
      }
    } catch (error: any) {
      console.error('[ProcessManager] Failed to clear cooldowns:', error.message)
    }
  }

  /**
   * Check if a port is accepting TCP connections on localhost.
   */
  protected isPortListeningBase(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket()
      socket.setTimeout(3000)
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => { socket.destroy(); resolve(false) })
      socket.once('timeout', () => { socket.destroy(); resolve(false) })
      socket.connect(port, '127.0.0.1')
    })
  }

  /**
   * Verify the gateway is actually serving requests, not just bound to
   * a port. TCP-listening fires the moment the socket binds — before
   * the gateway has finished plugin load and started accepting WS
   * handshakes (the doc explicitly flags a `UNAVAILABLE / "startup-
   * sidecars"` window after bind). A hung event loop will still pass
   * a TCP probe and fail every WS connect.
   *
   * We probe by sending a one-shot HTTP GET. The gateway exposes
   * `/__openclaw__/canvas/` on the same port, so any HTTP response —
   * 200, 404, 426 Upgrade Required, anything — proves the server is
   * processing requests. We don't care about the status code, only
   * that the server responded within the budget.
   */
  protected isGatewayServing(port: number, timeoutMs: number = 2000): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(
        { host: '127.0.0.1', port, path: '/', timeout: timeoutMs },
        (res) => { res.resume(); resolve(true) },
      )
      req.once('error', () => resolve(false))
      req.once('timeout', () => { req.destroy(); resolve(false) })
    })
  }

  /**
   * Read the gateway port from the shared config file.
   * Returns the configured port, or DEFAULT_GATEWAY_PORT if not set.
   */
  protected readConfiguredGatewayPort(): number {
    try {
      const fs = require('fs')
      const config = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'))
      return config?.gateway?.port || DEFAULT_GATEWAY_PORT
    } catch {
      return DEFAULT_GATEWAY_PORT
    }
  }

  /**
   * Detect whether a system-wide `openclaw` binary is installed.
   * Returns the absolute path to the binary, or null if not found.
   *
   * Delegates to the pure helper at managers/system-openclaw-resolver.ts
   * which owns the canonical detection logic — `which openclaw` with
   * augmented PATH, node_modules filter, and hard-coded fallback paths
   * for stripped-PATH environments. The same helper is used by
   * OpenClawCommandExecutor and the terminal:create-openclaw IPC handler
   * so all three spawn paths see the same binary.
   */
  protected async detectSystemOpenClaw(): Promise<string | null> {
    const result = await resolveSystemOpenClaw()
    if (result) {
      console.log(`[ProcessManager] Found system OpenClaw at: ${result}`)
    } else {
      console.log('[ProcessManager] No system OpenClaw installation found')
    }
    return result
  }

  /**
   * Determine the gateway mode by checking (in order):
   * 1. Is there a gateway already running on the configured port? → 'external'
   * 2. Is there a system openclaw binary installed? → 'system'
   * 3. Fall back to bundled → 'bundled'
   */
  async detectGatewayMode(): Promise<GatewayModeInfo> {
    const configPort = this.readConfiguredGatewayPort()

    // 1. Check if a gateway is already running on the configured port
    const isRunning = await this.isPortListeningBase(configPort)
    if (isRunning) {
      console.log(`[ProcessManager] Existing gateway detected on port ${configPort} → external mode`)
      return { mode: 'external', port: configPort }
    }

    // 2. Check if system openclaw binary exists
    const systemBinary = await this.detectSystemOpenClaw()
    if (systemBinary) {
      console.log(`[ProcessManager] System OpenClaw found at ${systemBinary} → system mode`)
      return { mode: 'system', systemBinaryPath: systemBinary, port: configPort }
    }

    // 3. Fall back to bundled
    console.log('[ProcessManager] No system OpenClaw found → bundled mode')
    return { mode: 'bundled', port: configPort }
  }

  /**
   * Start monitoring an external or system-started gateway.
   * Polls the port every 5 seconds to detect if the gateway stops.
   */
  protected startExternalMonitoring() {
    this.stopExternalMonitoring()
    console.log(`[ProcessManager] Starting external gateway monitoring on port ${this.activePort}`)

    let consecutiveFailures = 0
    this.externalMonitorInterval = setInterval(async () => {
      if (this.status !== 'running') return

      const alive = await this.isPortListeningBase(this.activePort)
      if (alive) {
        consecutiveFailures = 0
      } else {
        consecutiveFailures++
        console.log(`[ProcessManager] External gateway probe failed (${consecutiveFailures}/3)`)
        if (consecutiveFailures >= 3) {
          console.log(`[ProcessManager] External gateway on port ${this.activePort} is no longer responding`)
          this.setStatus('stopped')
          this.emitLog('⚠️ Gateway is no longer running')
          this.stopExternalMonitoring()
        }
      }
    }, 5000)
  }

  protected stopExternalMonitoring() {
    if (this.externalMonitorInterval) {
      clearInterval(this.externalMonitorInterval)
      this.externalMonitorInterval = null
    }
  }

  private startHealthMonitoring() {
    this.healthCheckInterval = setInterval(() => {
      if (this.status === 'running') {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('openclaw:health-update', {
            status: this.status,
            logCount: 0,
            // Previously `Date.now()` (1.7e12 — a wall-clock epoch, not
            // an uptime). spawnedAt is the epoch ms the current child
            // was spawned; subtract for real uptime. 0 in external mode
            // where we don't own the process.
            uptime: this.spawnedAt > 0 ? Date.now() - this.spawnedAt : 0,
            timestamp: new Date().toISOString()
          } as HealthEvent)
        }
      }
    }, 30000)
  }

  /** Get the uptime in milliseconds since the current child was spawned. */
  getUptime(): number {
    return this.spawnedAt > 0 ? Date.now() - this.spawnedAt : 0
  }

  destroy() {
    // Cancel any scheduled auto-restart so we don't relaunch after teardown.
    this.cancelAutoRestart()
    this.stopExternalMonitoring()
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
    // Kill the owned child so it doesn't orphan and hold the gateway port.
    // Mark as intentional so the exit handler doesn't trigger auto-restart
    // mid-teardown. SIGTERM only — the OS will reap if the process is
    // already dead, and we don't want to escalate to SIGKILL during a
    // graceful app quit.
    if (this.process) {
      this.intentionalStop = true
      try {
        this.process.kill('SIGTERM')
      } catch (err) {
        console.error('[ProcessManager] destroy() kill failed:', err)
      }
      this.process = null
    }
    this.spawnedAt = 0
  }
}
