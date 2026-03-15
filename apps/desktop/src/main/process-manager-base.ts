import { spawn, ChildProcess, execFile } from 'child_process'
import { BrowserWindow } from 'electron'
import * as path from 'path'
import * as net from 'net'
import { promisify } from 'util'
import { OpenClawEnvironment } from './openclaw-environment'
import { DEFAULT_GATEWAY_PORT } from '../shared/constants'

const execFileAsync = promisify(execFile)

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

  constructor(configPath: string, configManager?: ConfigManager) {
    this.configPath = configPath
    this.openclawEnv = new OpenClawEnvironment(configPath)
    this.configManager = configManager || null
    this.startHealthMonitoring()
  }

  setMainWindow(window: BrowserWindow | null) {
    this.mainWindow = window
  }

  abstract start(): Promise<boolean>
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

  isRunning(): boolean {
    return this.status === 'running'
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
    }
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
      if (this.status === 'running') {
        this.setStatus('stopped')
        this.emitLog('❌ Gateway process stopped unexpectedly')
      } else if (this.status === 'starting') {
        this.setStatus('stopped')
        this.emitLog(`❌ Gateway process died during startup (signal=${signal})`)
      }
      this.process = null
    })
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
   */
  protected async detectSystemOpenClaw(): Promise<string | null> {
    const candidates = [
      // Check PATH first via `which`
      async (): Promise<string | null> => {
        try {
          const home = process.env.HOME || ''
          const expandedPath = [
            path.join(home, '.bun', 'bin'),
            path.join(home, '.npm-global', 'bin'),
            path.join(home, '.local', 'bin'),
            '/opt/homebrew/bin',
            '/usr/local/bin',
            '/usr/bin',
            '/bin',
            process.env.PATH || ''
          ].join(':')
          const { stdout } = await execFileAsync('which', ['openclaw'], {
            env: { ...process.env, PATH: expandedPath }
          })
          const p = stdout.trim()
          return p || null
        } catch {
          return null
        }
      },
      // Check known paths
      async (): Promise<string | null> => {
        const fs = require('fs')
        const home = process.env.HOME || ''
        const knownPaths = [
          '/usr/local/bin/openclaw',
          '/opt/homebrew/bin/openclaw',
          path.join(home, '.local', 'bin', 'openclaw'),
          path.join(home, '.npm-global', 'bin', 'openclaw'),
          path.join(home, '.bun', 'bin', 'openclaw'),
        ]
        for (const p of knownPaths) {
          if (fs.existsSync(p)) return p
        }
        return null
      }
    ]

    for (const detect of candidates) {
      const result = await detect()
      if (result) {
        console.log(`[ProcessManager] Found system OpenClaw at: ${result}`)
        return result
      }
    }
    console.log('[ProcessManager] No system OpenClaw installation found')
    return null
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
            uptime: this.process?.pid ? Date.now() : 0,
            timestamp: new Date().toISOString()
          } as HealthEvent)
        }
      }
    }, 30000)
  }

  destroy() {
    this.stopExternalMonitoring()
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
  }
}
