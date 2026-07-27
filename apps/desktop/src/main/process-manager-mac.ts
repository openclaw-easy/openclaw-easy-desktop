import { spawn, execFile } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { promisify } from 'util'
import { ProcessManagerBase, ConfigManager } from './process-manager-base'
import { sanitizeConfigForBundled } from './utils/config-sanitizer'
import { getOpenClawBundle } from './openclaw-bundle'
import { getDevOpenClawSpawn } from './dev-openclaw-runtime'

const execFileAsync = promisify(execFile)

export class ProcessManagerMac extends ProcessManagerBase {

  constructor(configPath: string, configManager?: ConfigManager) {
    super(configPath, configManager)
  }

  /**
   * Verify the gateway is actually serving on `port`. Two-step probe:
   * TCP socket bind (cheap, weeds out "not listening") then an HTTP
   * round-trip (proves the event loop is processing requests, not just
   * accepted the syscall). See `isGatewayServing` in the base class for
   * the rationale — fixes the "TCP open but not serving" window where
   * the UI prematurely flips to running and the first chat hangs.
   */
  private async isPortListening(port: number): Promise<boolean> {
    if (!(await this.isPortListeningBase(port))) return false
    return this.isGatewayServing(port)
  }

  /** Find the PID occupying a port via lsof. Returns null if the port is free. */
  private async getPidOnPort(port: number): Promise<number | null> {
    try {
      const { stdout } = await execFileAsync('lsof', ['-i', `:${port}`, '-t'])
      const pid = parseInt(stdout.trim().split('\n')[0], 10)
      return isNaN(pid) ? null : pid
    } catch {
      return null
    }
  }

  private async killProcess(pid: number): Promise<boolean> {
    try {
      console.log(`[ProcessManager] Killing conflicting gateway process PID ${pid}`)
      process.kill(pid, 'SIGTERM')
      await new Promise(resolve => setTimeout(resolve, 2000))
      try {
        process.kill(pid, 0) // check if still alive
        console.log(`[ProcessManager] Force killing process PID ${pid}`)
        process.kill(pid, 'SIGKILL')
        await new Promise(resolve => setTimeout(resolve, 1000))
      } catch {
        // Process already dead
      }
      return true
    } catch (error: any) {
      console.error(`[ProcessManager] Failed to kill process ${pid}:`, error.message)
      return false
    }
  }

  async start(presetMode?: import('./process-manager-base').GatewayModeInfo): Promise<boolean> {
    if (this.status === 'running') {
      console.log('[ProcessManager] Already running')
      return true
    }

    if (this.status === 'starting') {
      console.log('[ProcessManager] Already starting')
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
      // Reuse the caller's detection if supplied (openclaw-manager runs
      // it earlier to decide config-write strategy). Saves a TCP probe +
      // `which openclaw` + several fs.existsSync calls.
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
      console.error('[ProcessManager] Start error:', error)
      // Surface pre-spawn failures (e.g. missing dev dist build) in the UI
      // log — spawn-time failures are reported by the process listeners, but
      // a synchronous throw here would otherwise only reach the console.
      this.emitLog(`❌ Gateway start failed: ${error?.message ?? error}`)
      this.setStatus('error')
      return false
    }
  }

  /**
   * Mode 1: Connect to an already-running gateway (started outside the desktop app).
   * No process is spawned — the desktop app is a pure GUI client.
   */
  private async startExternal(port: number): Promise<boolean> {
    this.activePort = port
    console.log(`[ProcessManager] Connecting to existing gateway on port ${port} (external mode)`)
    this.emitLog(`🔗 Detected existing OpenClaw gateway on port ${port}, connecting...`)

    // Verify it's actually reachable
    if (await this.isPortListening(port)) {
      this.setStatus('running')
      this.emitLog(`✅ Connected to existing OpenClaw gateway on port ${port}`)
      this.startExternalMonitoring()
      return true
    }

    // Race condition: gateway went away between detection and connect
    console.warn('[ProcessManager] External gateway disappeared during connect')
    this.setStatus('error')
    this.emitLog('❌ External gateway is no longer reachable')
    return false
  }

  /**
   * Mode 2: Start the gateway using the system-installed openclaw binary.
   * The desktop app spawns and owns this process.
   */
  private async startSystem(binaryPath: string, port: number): Promise<boolean> {
    this.activePort = port
    console.log(`[ProcessManager] Starting system OpenClaw at ${binaryPath} on port ${port}`)
    this.emitLog(`🚀 Starting system OpenClaw gateway (${binaryPath})...`)

    if (this.configManager) {
      await this.configManager.ensureGatewayConfigured(port)
      await this.clearAllCooldowns()
    }

    // Try `openclaw gateway start` first (uses launchd/systemd service management)
    try {
      console.log('[ProcessManager] Trying: openclaw gateway start')
      await execFileAsync(binaryPath, ['gateway', 'start'], { timeout: 15_000 })
      // Wait for the gateway to come online — the service may use a different port
      // than the config (e.g. LaunchAgent plist overrides with --port flag)
      const MAX_WAIT = 15_000
      const POLL = 1_000
      let waited = 0
      while (waited < MAX_WAIT) {
        await new Promise(resolve => setTimeout(resolve, POLL))
        waited += POLL
        // Check the configured port first, then re-read in case it changed
        const actualPort = this.readConfiguredGatewayPort()
        if (await this.isPortListening(actualPort)) {
          this.activePort = actualPort
          this.gatewayMode = 'external'
          this.setStatus('running')
          this.startExternalMonitoring()
          this.emitLog(`✅ System OpenClaw gateway started on port ${actualPort}`)
          console.log(`[ProcessManager] System gateway started via "openclaw gateway start" on port ${actualPort}`)
          return true
        }
      }
      console.warn('[ProcessManager] "openclaw gateway start" ran but port not listening, falling back to spawn')
    } catch (err: any) {
      console.warn('[ProcessManager] "openclaw gateway start" failed, falling back to spawn:', err.message)
    }

    // Fall back to spawning the process directly
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

    const openclawEnv = this.openclawEnv.getEnvironmentVariables()

    this.process = spawn(binaryPath, ['gateway', 'run', '--port', String(port), '--bind', 'loopback'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: home,
      env: {
        ...process.env,
        ...openclawEnv,
        PATH: expandedPath,
      }
    })
    this.spawnedAt = Date.now()

    this.setupProcessListeners()

    // Wait for the gateway to accept connections (system binary should start faster)
    const MAX_WAIT_MS = 60_000
    const POLL_INTERVAL_MS = 2_000
    let elapsed = 0

    while (elapsed < MAX_WAIT_MS) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
      elapsed += POLL_INTERVAL_MS

      if (!this.process || this.process.killed || this.process.exitCode !== null) {
        console.error('[ProcessManager] System gateway process exited during startup')
        this.setStatus('error')
        this.emitLog('❌ System OpenClaw gateway failed to start')
        return false
      }
      if (this.status !== 'starting') {
        console.log('[ProcessManager] Startup aborted (status changed externally)')
        return false
      }

      if (await this.isPortListening(port)) {
        this.setStatus('running')
        this.emitLog(`✅ System OpenClaw gateway started on port ${port}`)
        console.log('[ProcessManager] System OpenClaw gateway started successfully')
        return true
      }

      console.log(`[ProcessManager] Waiting for system gateway on port ${port}... (${elapsed / 1000}s)`)
    }

    console.error(`[ProcessManager] System gateway did not start within ${MAX_WAIT_MS / 1000}s`)
    this.setStatus('error')
    this.emitLog(`❌ System gateway did not start within ${MAX_WAIT_MS / 1000}s`)
    if (this.process) {
      this.process.kill('SIGTERM')
      this.process = null
    }
    return false
  }

  /**
   * Mode 3: Start the gateway using the bundled openclaw copy.
   * This is the original/legacy behavior, preserved exactly as-is.
   */
  private async startBundled(): Promise<boolean> {
    const port = this.readConfiguredGatewayPort()

    // If something is already on this port, try to reclaim it from a stale desktop process
    const existingPid = await this.getPidOnPort(port)
    if (existingPid) {
      console.log(`[ProcessManager] Port ${port} in use (PID ${existingPid}), attempting to reclaim...`)
      await this.killProcess(existingPid)
      await new Promise(resolve => setTimeout(resolve, 1500))
      if (await this.getPidOnPort(port)) {
        this.setStatus('error')
        this.emitLog(`❌ Port ${port} is still in use — cannot start bundled gateway`)
        return false
      }
      this.emitLog(`♻️ Reclaimed port ${port} from previous process`)
    }

    this.activePort = port
    console.log(`[ProcessManager] Using port ${port} for bundled gateway`)

    if (this.configManager) {
      await this.configManager.ensureGatewayConfigured(port)
      console.log(`[ProcessManager] Updated config with gateway port ${port}`)
      await this.clearAllCooldowns()
    }

    const openclawEnv = this.openclawEnv.getEnvironmentVariables()
    const validation = this.openclawEnv.validateEnvironment()
    if (!validation.valid) {
      console.warn(`[ProcessManager] Environment validation issues: missing ${validation.missing.join(', ')}`)
    }

    const { app } = await import('electron')
    const home = process.env.HOME || ''

    const expandedPath = [
      path.join(home, '.bun', 'bin'),
      path.join(home, '.npm-global', 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      process.env.PATH || ''
    ].join(':')

    const enhancedEnv = {
      ...process.env,
      ...openclawEnv,
      PATH: expandedPath,
    }

    let spawnCmd: string
    let spawnArgs: string[]
    let spawnCwd: string

    if (app.isPackaged) {
      const bundle = getOpenClawBundle()
      await bundle.ensureInstalled((msg) => {
        console.log(`[ProcessManager] ${msg}`)
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
      console.log(`[ProcessManager] Production: ${bundledNode} ${openclawMjs}`)
      this.emitLog('🚀 Starting OpenClaw gateway (bundled runtime)...')
    } else {
      const dev = getDevOpenClawSpawn()
      spawnCmd = dev.runtime
      spawnArgs = [dev.entry, 'gateway', 'run', '--port', String(this.activePort), '--bind', 'loopback']
      spawnCwd = dev.cwd
      console.log(`[ProcessManager] Dev: ${dev.runtime} ${dev.entry}`)
    }

    this.process = spawn(spawnCmd, spawnArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: spawnCwd,
      env: enhancedEnv
    })
    this.spawnedAt = Date.now()

    this.setupProcessListeners()
    this.emitLog(`🖥️ Starting desktop OpenClaw gateway on port ${this.activePort}...`)

    // Wait for the gateway to accept connections.
    // First launch may need to build UI assets, which can take 30s+.
    const MAX_WAIT_MS = 60_000
    const POLL_INTERVAL_MS = 2_000
    let elapsed = 0

    while (elapsed < MAX_WAIT_MS) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
      elapsed += POLL_INTERVAL_MS

      // Bail if the process died or if stop() was called during startup
      if (!this.process || this.process.killed || this.process.exitCode !== null) {
        console.error('[ProcessManager] Gateway process exited during startup')
        this.setStatus('error')
        this.emitLog('❌ Desktop OpenClaw gateway failed to start')
        return false
      }
      if (this.status !== 'starting') {
        console.log('[ProcessManager] Startup aborted (status changed externally)')
        return false
      }

      if (await this.isPortListening(this.activePort)) {
        this.setStatus('running')
        this.emitLog('✅ Desktop OpenClaw gateway started successfully')
        console.log('[ProcessManager] Desktop OpenClaw gateway started successfully')
        return true
      }

      console.log(`[ProcessManager] Waiting for port ${this.activePort}... (${elapsed / 1000}s)`)
    }

    // Timed out
    console.error(`[ProcessManager] Gateway did not bind to port ${this.activePort} within ${MAX_WAIT_MS / 1000}s`)
    this.setStatus('error')
    this.emitLog(`❌ Gateway did not start within ${MAX_WAIT_MS / 1000}s`)
    if (this.process) {
      this.process.kill('SIGTERM')
      this.process = null
    }
    return false
  }

  async stop(): Promise<boolean> {
    if (this.status === 'stopped') {
      return true
    }

    // Operator-driven stop: tell the exit handler not to auto-restart
    // and cancel any pending restart timer. Reset the attempt counter
    // so the next user-initiated start gets a fresh budget.
    this.intentionalStop = true
    this.cancelAutoRestart()
    this.restartAttempts = 0

    this.stopExternalMonitoring()

    // In external mode, use `openclaw gateway stop` (handles launchd/systemd properly)
    if (this.gatewayMode === 'external') {
      console.log('[ProcessManager] Stopping external gateway...')
      this.emitLog('🛑 Stopping external gateway...')

      await this.runGatewayStop()

      this.activePort = 0
      this.setStatus('stopped')
      this.emitLog('✅ Gateway stopped')
      return true
    }

    try {
      console.log('[ProcessManager] Stopping gateway...')
      this.emitLog('🛑 Stopping gateway...')

      if (this.process) {
        this.cleanupProcessListeners(this.process)
        this.process.kill('SIGTERM')
        await new Promise(resolve => setTimeout(resolve, 2000))
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL')
        }
        this.process = null
      }

      // Clean up any orphaned process still holding the port (bundled mode only)
      if (this.gatewayMode === 'bundled' && this.activePort > 0) {
        const pid = await this.getPidOnPort(this.activePort)
        if (pid) {
          console.log(`[ProcessManager] Killing orphaned gateway on port ${this.activePort} (PID ${pid})`)
          await this.killProcess(pid)
        }
      }

      this.activePort = 0
      this.setStatus('stopped')
      this.emitLog('✅ Gateway stopped')
      return true
    } catch (error: any) {
      console.error('[ProcessManager] Stop error:', error)
      this.setStatus('error')
      return false
    }
  }

  async restart(): Promise<boolean> {
    await this.stop()

    // Wait for the port to be fully released. Poll every 100ms (was
    // 1000ms — measured cost: 1-2s wasted per restart on a fast kernel
    // that releases the port in <100ms). 5s deadline is generous; if the
    // OS hasn't released the port by then, something else is wrong and
    // start() will surface a clearer error.
    const port = this.activePort || this.readConfiguredGatewayPort()
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      if (!(await this.getPidOnPort(port))) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    return this.start()
  }

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
        console.log(`[ProcessManager] Running: ${systemBinary} gateway stop`)
        await execFileAsync(systemBinary, ['gateway', 'stop'], { timeout: 15_000 })
        console.log('[ProcessManager] openclaw gateway stop succeeded (system binary)')
        return
      } catch (err: any) {
        console.warn('[ProcessManager] System openclaw gateway stop failed:', err.message)
      }
    }

    // 2. Try bundled openclaw
    const { app } = await import('electron')
    const home = process.env.HOME || ''

    if (app.isPackaged) {
      const nodeBinaryName = `node-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
      const bundledNode = path.join(process.resourcesPath, 'node', nodeBinaryName)
      const openclawMjs = path.join(home, '.openclaw-easy', 'app', 'openclaw.mjs')

      if (fs.existsSync(bundledNode) && fs.existsSync(openclawMjs)) {
        try {
          console.log(`[ProcessManager] Running: ${bundledNode} ${openclawMjs} gateway stop`)
          await execFileAsync(bundledNode, [openclawMjs, 'gateway', 'stop'], { timeout: 15_000 })
          console.log('[ProcessManager] openclaw gateway stop succeeded (bundled)')
          return
        } catch (err: any) {
          console.warn('[ProcessManager] Bundled openclaw gateway stop failed:', err.message)
        }
      }
    } else {
      // Dev mode: built CLI under Node (see dev-openclaw-runtime.ts)
      try {
        const dev = getDevOpenClawSpawn()
        console.log(`[ProcessManager] Running: ${dev.runtime} ${dev.entry} gateway stop`)
        await execFileAsync(dev.runtime, [dev.entry, 'gateway', 'stop'], { timeout: 15_000 })
        console.log('[ProcessManager] openclaw gateway stop succeeded (dev)')
        return
      } catch (err: any) {
        console.warn('[ProcessManager] Dev openclaw gateway stop failed:', err.message)
      }
    }

    console.error('[ProcessManager] All openclaw gateway stop attempts failed')
  }

  private async sanitizeConfigForBundled(installDir: string): Promise<void> {
    const openclawConfigPath = path.join(process.env.HOME || '', '.openclaw', 'openclaw.json')
    const bundledPluginsDir = path.join(installDir, 'extensions')
    await sanitizeConfigForBundled(openclawConfigPath, bundledPluginsDir, (msg) => {
      console.log(`[ProcessManager] ${msg}`)
      this.emitLog(`🔧 ${msg}`)
    })
  }

}
