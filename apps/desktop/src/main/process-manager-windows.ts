import { spawn, exec, execFile } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { promisify } from 'util'
import { ProcessManagerBase, ConfigManager } from './process-manager-base'
import { sanitizeConfigForBundled } from './utils/config-sanitizer'
import { getOpenClawBundle } from './openclaw-bundle'
import { getDevOpenClawSpawn } from './dev-openclaw-runtime'

const execAsync = (cmd: string) => promisify(exec)(cmd, { windowsHide: true })
const execFileAsync = promisify(execFile)

export class ProcessManagerWindows extends ProcessManagerBase {

  constructor(configPath: string, configManager?: ConfigManager) {
    super(configPath, configManager)
  }

  // ── Port helpers (Windows netstat) ──────────────────────────────────────────

  /**
   * Verify the gateway is actually serving on `port`. TCP bind + HTTP
   * round-trip — see `isGatewayServing` in the base class for why a
   * raw TCP listen check isn't enough.
   */
  private async isPortListening(port: number): Promise<boolean> {
    if (!(await this.isPortListeningBase(port))) return false
    return this.isGatewayServing(port)
  }

  /** Find the PID occupying a port via netstat. Returns null if the port is free. */
  private async getPidOnPort(port: number): Promise<number | null> {
    try {
      const { stdout } = await execAsync('netstat -aon')
      for (const line of stdout.split('\n')) {
        const match = line.match(/TCP\s+[\d.*]+:(\d+)\s+[\d.*]+:\d+\s+LISTENING\s+(\d+)/i)
        if (match && parseInt(match[1]) === port) {
          return parseInt(match[2])
        }
      }
    } catch {
      // ignore
    }
    return null
  }

  private async killGatewayOnPort(port: number): Promise<void> {
    try {
      const pid = await this.getPidOnPort(port)
      if (pid) {
        // Validate PID is a safe integer to prevent command injection
        if (!Number.isInteger(pid) || pid < 1) throw new Error(`Invalid PID: ${pid}`)
        await execAsync(`taskkill /F /PID ${pid}`)
        console.log(`[ProcessManagerWindows] Killed PID ${pid} on port ${port}`)
      }
    } catch { /* ignore */ }
  }

  // ── Native install / sync ───────────────────────────────────────────────────
  // Bundle install/extract is handled by openclaw-bundle.ts (single-flight,
  // shared with the onboarding terminal handler in index.ts).

  /**
   * Run `openclaw gateway stop` using the best available binary:
   * 1. System openclaw binary (if installed)
   * 2. Bundled Node + openclaw.mjs (production builds)
   * 3. Dev-mode Node + built dist (dev-openclaw-runtime.ts)
   */
  private async runGatewayStop(): Promise<void> {
    // 1. Try system binary
    const systemBinary = await this.detectSystemOpenClaw()
    if (systemBinary) {
      try {
        console.log(`[ProcessManagerWindows] Running: ${systemBinary} gateway stop`)
        await execFileAsync(systemBinary, ['gateway', 'stop'], { timeout: 15_000 })
        console.log('[ProcessManagerWindows] openclaw gateway stop succeeded (system binary)')
        return
      } catch (err: any) {
        console.warn('[ProcessManagerWindows] System openclaw gateway stop failed:', err.message)
      }
    }

    // 2. Try bundled openclaw
    const { app } = await import('electron')
    const home = process.env.USERPROFILE || process.env.HOME || ''

    if (app.isPackaged) {
      const bundledNode = path.join(process.resourcesPath, 'node', 'node-windows.exe')
      const openclawMjs = path.join(home, '.openclaw-easy', 'app', 'openclaw.mjs')

      if (fs.existsSync(bundledNode) && fs.existsSync(openclawMjs)) {
        try {
          console.log(`[ProcessManagerWindows] Running: ${bundledNode} ${openclawMjs} gateway stop`)
          await execFileAsync(bundledNode, [openclawMjs, 'gateway', 'stop'], { timeout: 15_000 })
          console.log('[ProcessManagerWindows] openclaw gateway stop succeeded (bundled)')
          return
        } catch (err: any) {
          console.warn('[ProcessManagerWindows] Bundled openclaw gateway stop failed:', err.message)
        }
      }
    } else {
      // Dev mode: built CLI under Node (see dev-openclaw-runtime.ts)
      try {
        const dev = getDevOpenClawSpawn()
        console.log(`[ProcessManagerWindows] Running: ${dev.runtime} ${dev.entry} gateway stop`)
        await execFileAsync(dev.runtime, [dev.entry, 'gateway', 'stop'], { timeout: 15_000 })
        console.log('[ProcessManagerWindows] openclaw gateway stop succeeded (dev)')
        return
      } catch (err: any) {
        console.warn('[ProcessManagerWindows] Dev openclaw gateway stop failed:', err.message)
      }
    }

    console.error('[ProcessManagerWindows] All openclaw gateway stop attempts failed')
  }

  private async sanitizeConfigForBundled(installDir: string): Promise<void> {
    const home = process.env.USERPROFILE || process.env.HOME || ''
    const openclawConfigPath = path.join(home, '.openclaw', 'openclaw.json')
    const bundledPluginsDir = path.join(installDir, 'extensions')
    await sanitizeConfigForBundled(openclawConfigPath, bundledPluginsDir, (msg) => {
      console.log(`[ProcessManagerWindows] ${msg}`)
      this.emitLog(msg)
    })
  }


  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async start(presetMode?: import('./process-manager-base').GatewayModeInfo): Promise<boolean> {
    if (this.status === 'running') {
      console.log('[ProcessManagerWindows] Already running')
      return true
    }
    if (this.status === 'starting') {
      console.log('[ProcessManagerWindows] Already starting')
      return false
    }

    // Fresh launch: clear any in-flight auto-restart timer and reset
    // the operator-stop flag so the exit handler treats subsequent
    // unexpected exits as crashes.
    this.cancelAutoRestart()
    this.intentionalStop = false

    try {
      this.setStatus('starting')

      if (this.process && !this.process.killed) {
        this.setStatus('running')
        return true
      }

      // ── Detect gateway mode ────────────────────────────────────────────
      // Reuse the caller's detection if supplied — see ProcessManagerMac.
      const modeInfo = presetMode ?? await this.detectGatewayMode()
      this.gatewayMode = modeInfo.mode
      this.systemBinaryPath = modeInfo.systemBinaryPath || null

      // ── Mode 1: External — gateway already running ─────────────────────
      if (modeInfo.mode === 'external') {
        return this.startExternal(modeInfo.port)
      }

      // ── Mode 2: System — use system openclaw binary ────────────────────
      if (modeInfo.mode === 'system') {
        return this.startSystem(modeInfo.systemBinaryPath!, modeInfo.port)
      }

      // ── Mode 3: Bundled — use embedded openclaw (legacy behavior) ──────
      return this.startBundled()

    } catch (error: any) {
      console.error('[ProcessManagerWindows] Start error:', error)
      // Surface pre-spawn failures (e.g. missing dev dist build) in the UI
      // log — spawn-time failures are reported by the process listeners, but
      // a synchronous throw here would otherwise only reach the console.
      this.emitLog(`Gateway start failed: ${error?.message ?? error}`)
      this.setStatus('error')
      return false
    }
  }

  /**
   * Mode 1: Connect to an already-running gateway (started outside the desktop app).
   */
  private async startExternal(port: number): Promise<boolean> {
    this.activePort = port
    console.log(`[ProcessManagerWindows] Connecting to existing gateway on port ${port} (external mode)`)
    this.emitLog(`Detected existing OpenClaw gateway on port ${port}, connecting...`)

    if (await this.isPortListening(port)) {
      this.setStatus('running')
      this.emitLog(`Connected to existing OpenClaw gateway on port ${port}`)
      this.startExternalMonitoring()
      return true
    }

    console.warn('[ProcessManagerWindows] External gateway disappeared during connect')
    this.setStatus('error')
    this.emitLog('External gateway is no longer reachable')
    return false
  }

  /**
   * Mode 2: Start the gateway using the system-installed openclaw binary.
   */
  private async startSystem(binaryPath: string, port: number): Promise<boolean> {
    this.activePort = port
    console.log(`[ProcessManagerWindows] Starting system OpenClaw at ${binaryPath} on port ${port}`)
    this.emitLog(`Starting system OpenClaw gateway (${binaryPath})...`)

    if (this.configManager) {
      await this.configManager.ensureGatewayConfigured(port)
      await this.clearAllCooldowns()
    }

    const openclawEnv = this.openclawEnv.getEnvironmentVariables()

    this.process = spawn(binaryPath, ['gateway', 'run', '--port', String(port), '--bind', 'loopback'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.env.USERPROFILE || process.env.HOME || '',
      env: { ...process.env, ...openclawEnv },
      windowsHide: true,
    })
    this.spawnedAt = Date.now()

    this.setupProcessListeners()

    const MAX_WAIT_MS = 60_000
    const POLL_INTERVAL_MS = 2_000
    let elapsed = 0

    while (elapsed < MAX_WAIT_MS) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
      elapsed += POLL_INTERVAL_MS

      if (!this.process || this.process.killed || this.process.exitCode !== null) {
        this.setStatus('error')
        this.emitLog('System OpenClaw gateway failed to start')
        return false
      }
      if (this.status !== 'starting') return false

      if (await this.isPortListening(port)) {
        this.setStatus('running')
        this.emitLog(`System OpenClaw gateway started on port ${port}`)
        return true
      }
      console.log(`[ProcessManagerWindows] Waiting for system gateway on port ${port}... (${elapsed / 1000}s)`)
    }

    this.setStatus('error')
    this.emitLog(`System gateway did not start within ${MAX_WAIT_MS / 1000}s`)
    if (this.process) { this.process.kill(); this.process = null }
    return false
  }

  /**
   * Mode 3: Start the gateway using the bundled openclaw copy (legacy behavior).
   */
  private async startBundled(): Promise<boolean> {
    const port = this.readConfiguredGatewayPort()

    // If something is already on this port, try to reclaim it
    const existingPid = await this.getPidOnPort(port)
    if (existingPid) {
      console.log(`[ProcessManagerWindows] Port ${port} in use (PID ${existingPid}), attempting to reclaim...`)
      await this.killGatewayOnPort(port)
      await new Promise(resolve => setTimeout(resolve, 1500))
      if (await this.getPidOnPort(port)) {
        this.setStatus('error')
        this.emitLog(`Port ${port} is still in use — cannot start bundled gateway`)
        return false
      }
      this.emitLog(`Reclaimed port ${port} from previous process`)
    }

    this.activePort = port
    console.log(`[ProcessManagerWindows] Using port ${port} (bundled mode)`)

    if (this.configManager) {
      await this.configManager.ensureGatewayConfigured(port)
      await this.clearAllCooldowns()
    }

    const openclawEnv = this.openclawEnv.getEnvironmentVariables()
    const { app } = await import('electron')
    const home = process.env.USERPROFILE || process.env.HOME || ''

    const enhancedEnv = {
      ...process.env,
      ...openclawEnv,
    }

    let spawnCmd: string
    let spawnArgs: string[]
    let spawnCwd: string

    if (app.isPackaged) {
      const bundle = getOpenClawBundle()
      await bundle.ensureInstalled((msg) => {
        console.log(`[ProcessManagerWindows] ${msg}`)
        this.emitLog(msg)
      })

      // Run openclaw under bundled Node (has node:sqlite); bun is install-only.
      const bundledNode = bundle.getNodeBinary()
      const openclawInstallDir = bundle.getInstallDir()
      const openclawMjs = bundle.getOpenClawMjs()

      await this.sanitizeConfigForBundled(openclawInstallDir)

      spawnCmd = bundledNode
      spawnArgs = [openclawMjs, 'gateway', 'run', '--port', String(this.activePort), '--bind', 'loopback']
      spawnCwd = openclawInstallDir
      console.log(`[ProcessManagerWindows] Production: ${bundledNode} ${openclawMjs}`)
      this.emitLog('Starting OpenClaw gateway (bundled runtime)...')
    } else {
      const dev = getDevOpenClawSpawn()
      spawnCmd = dev.runtime
      spawnArgs = [dev.entry, 'gateway', 'run', '--port', String(this.activePort), '--bind', 'loopback']
      spawnCwd = dev.cwd
      console.log(`[ProcessManagerWindows] Dev: ${dev.runtime} ${dev.entry}`)
    }

    this.process = spawn(spawnCmd, spawnArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: spawnCwd,
      env: enhancedEnv,
      windowsHide: true,
    })
    this.spawnedAt = Date.now()

    this.setupProcessListeners()
    this.emitLog(`Starting desktop OpenClaw gateway on port ${this.activePort}...`)

    // Wait for the gateway to accept connections.
    const MAX_WAIT_MS = 60_000
    const POLL_INTERVAL_MS = 2_000
    let elapsed = 0

    while (elapsed < MAX_WAIT_MS) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
      elapsed += POLL_INTERVAL_MS

      if (!this.process || this.process.killed || this.process.exitCode !== null) {
        console.error('[ProcessManagerWindows] Gateway process exited during startup')
        this.setStatus('error')
        this.emitLog('Desktop OpenClaw gateway failed to start')
        return false
      }
      if (this.status !== 'starting') {
        console.log('[ProcessManagerWindows] Startup aborted (status changed externally)')
        return false
      }

      if (await this.isPortListening(this.activePort)) {
        this.setStatus('running')
        this.emitLog('Desktop OpenClaw gateway started successfully')
        console.log('[ProcessManagerWindows] Gateway running successfully')
        return true
      }

      console.log(`[ProcessManagerWindows] Waiting for port ${this.activePort}... (${elapsed / 1000}s)`)
    }

    // Timed out
    console.error(`[ProcessManagerWindows] Gateway did not bind to port ${this.activePort} within ${MAX_WAIT_MS / 1000}s`)
    this.setStatus('error')
    this.emitLog(`Gateway did not start within ${MAX_WAIT_MS / 1000}s`)
    if (this.process) {
      this.process.kill()
      this.process = null
    }
    return false
  }

  async stop(): Promise<boolean> {
    if (this.status === 'stopped') { return true }

    this.stopExternalMonitoring()

    // Operator-driven stop: tell the exit handler not to auto-restart
    // and cancel any pending restart timer. Reset the attempt counter
    // so the next user-initiated start gets a fresh budget.
    this.intentionalStop = true
    this.cancelAutoRestart()
    this.restartAttempts = 0

    // In external mode, use `openclaw gateway stop`
    if (this.gatewayMode === 'external') {
      console.log('[ProcessManagerWindows] Stopping external gateway...')
      this.emitLog('Stopping external gateway...')

      await this.runGatewayStop()

      this.activePort = 0
      this.setStatus('stopped')
      this.emitLog('Gateway stopped')
      return true
    }

    try {
      console.log('[ProcessManagerWindows] Stopping gateway...')
      this.emitLog('Stopping gateway...')

      if (this.process) {
        this.cleanupProcessListeners(this.process)
        this.process.kill()
        await new Promise(resolve => setTimeout(resolve, 2000))
        this.process = null
      }

      // Also kill any lingering process on the port (bundled mode only)
      if (this.gatewayMode === 'bundled' && this.activePort > 0) {
        await this.killGatewayOnPort(this.activePort)
      }

      this.activePort = 0
      this.setStatus('stopped')
      this.emitLog('Gateway stopped')
      return true
    } catch (error: any) {
      console.error('[ProcessManagerWindows] Stop error:', error)
      this.setStatus('error')
      return false
    }
  }

  async restart(): Promise<boolean> {
    const portBeforeStop = this.activePort || this.readConfiguredGatewayPort()
    await this.stop()
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      const pid = await this.getPidOnPort(portBeforeStop)
      if (!pid) { break }
      await new Promise(resolve => setTimeout(resolve, 1500))
    }
    return this.start()
  }

  /** Kept for API compatibility with openclaw-manager.ts (always returns null — WSL2 no longer used) */
  getWSL2Info(): null {
    return null
  }
}
