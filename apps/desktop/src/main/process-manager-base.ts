import { spawn, ChildProcess } from 'child_process'
import { BrowserWindow } from 'electron'
import * as path from 'path'
import { OpenClawEnvironment } from './openclaw-environment'

// Forward declaration to avoid circular dependency
export type ConfigManager = {
  ensureGatewayConfigured(port: number): Promise<void>
}

export type ProcessStatus = 'stopped' | 'starting' | 'running' | 'error'

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

  getStatus(): ProcessStatus {
    if (this.process && !this.process.killed && this.status === 'running') {
      return 'running'
    } else if (this.status === 'running') {
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
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
  }
}
