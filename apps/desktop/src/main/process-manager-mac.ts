import { spawn, execFile } from 'child_process'
import * as crypto from 'crypto'
import * as path from 'path'
import * as fs from 'fs'
import * as net from 'net'
import { promisify } from 'util'
import { ProcessManagerBase, ConfigManager } from './process-manager-base'
import { sanitizeConfigForBundled } from './utils/config-sanitizer'

const execFileAsync = promisify(execFile)

/** Recursively copy a file or directory. */
function copyRecursive(src: string, dest: string): void {
  if (fs.statSync(src).isDirectory()) {
    fs.mkdirSync(dest, { recursive: true })
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry))
    }
  } else {
    fs.copyFileSync(src, dest)
  }
}

export class ProcessManagerMac extends ProcessManagerBase {

  constructor(configPath: string, configManager?: ConfigManager) {
    super(configPath, configManager)
  }

  /**
   * Check if a port is actually accepting TCP connections.
   * More reliable than parsing lsof output.
   */
  private isPortListening(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket()
      socket.setTimeout(3000)
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => { socket.destroy(); resolve(false) })
      socket.once('timeout', () => { socket.destroy(); resolve(false) })
      socket.connect(port, '127.0.0.1')
    })
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

  async start(): Promise<boolean> {
    if (this.status === 'running') {
      console.log('[ProcessManager] Already running')
      return true
    }

    if (this.status === 'starting') {
      console.log('[ProcessManager] Already starting')
      return false
    }

    try {
      this.setStatus('starting')

      if (this.process && !this.process.killed) {
        this.setStatus('running')
        return true
      }

      // ── Detect gateway mode ────────────────────────────────────────────
      const modeInfo = await this.detectGatewayMode()
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
      const bunBinaryName = `bun-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
      const bundledBun = path.join(process.resourcesPath, 'bun', bunBinaryName)
      const openclawInstallDir = path.join(home, '.openclaw-easy', 'app')
      const openclawMjs = path.join(openclawInstallDir, 'openclaw.mjs')
      const nodeModulesDir = path.join(openclawInstallDir, 'node_modules')

      if (!fs.existsSync(nodeModulesDir)) {
        this.emitLog('⚙️ First launch: setting up OpenClaw (this takes ~30 seconds)...')
        console.log('[ProcessManager] First-launch setup: installing OpenClaw dependencies')
        await this.installOpenClawBundle(bundledBun, openclawInstallDir)
      } else {
        this.syncBundledAssets(openclawInstallDir)
        // Re-install deps if package.json changed (e.g. after app update with new dependencies)
        if (this.needsDepsUpdate(openclawInstallDir)) {
          this.emitLog('⚙️ Updating dependencies after app update...')
          console.log('[ProcessManager] package.json changed — re-running bun install')
          await this.runBunInstall(bundledBun, openclawInstallDir)
        }
      }

      await this.sanitizeConfigForBundled(openclawInstallDir)

      spawnCmd = bundledBun
      spawnArgs = [openclawMjs, 'gateway', 'run', '--port', String(this.activePort), '--bind', 'loopback']
      spawnCwd = openclawInstallDir
      console.log(`[ProcessManager] Production: ${bundledBun} ${openclawMjs}`)
      this.emitLog('🚀 Starting OpenClaw gateway (bundled runtime)...')
    } else {
      const openclawPath = path.join(__dirname, '../../../../openclaw/src/index.ts')
      spawnCmd = 'bun'
      spawnArgs = [openclawPath, 'gateway', 'run', '--port', String(this.activePort), '--bind', 'loopback']
      spawnCwd = path.join(__dirname, '../../../../openclaw/')
      console.log(`[ProcessManager] Dev: bun ${openclawPath}`)
    }

    this.process = spawn(spawnCmd, spawnArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: spawnCwd,
      env: enhancedEnv
    })

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

    this.stopExternalMonitoring()

    // In external mode, use `openclaw gateway stop`
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

    // Wait for the port to be fully released
    const port = this.activePort || this.readConfiguredGatewayPort()
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      if (!(await this.getPidOnPort(port))) break
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    return this.start()
  }

  /** Returns true when the installed package.json differs from the bundled one. */
  private needsDepsUpdate(installDir: string): boolean {
    try {
      const hashFile = path.join(installDir, '.package-hash')
      const pkgPath = path.join(installDir, 'package.json')
      if (!fs.existsSync(pkgPath)) return false
      const currentHash = crypto.createHash('sha256').update(fs.readFileSync(pkgPath)).digest('hex')
      if (!fs.existsSync(hashFile)) return true
      return fs.readFileSync(hashFile, 'utf-8').trim() !== currentHash
    } catch {
      return true
    }
  }

  /** Run bun install and save the package.json hash on success. */
  private async runBunInstall(bundledBun: string, installDir: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(bundledBun, ['install', '--production', '--ignore-scripts'], {
        cwd: installDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, HOME: path.join(process.env.HOME || '', '.openclaw-easy') }
      })
      const timeout = setTimeout(() => { proc.kill(); reject(new Error('bun install timed out')) }, 3 * 60 * 1000)
      proc.stdout?.on('data', (d) => { const t = d.toString().trim(); if (t) this.emitLog(`  ${t}`) })
      proc.stderr?.on('data', (d) => { const t = d.toString().trim(); if (t && !t.includes('warn')) this.emitLog(`  ${t}`) })
      proc.on('exit', (code) => {
        clearTimeout(timeout)
        if (code === 0) {
          this.emitLog('✅ Dependencies updated successfully')
          this.savePackageHash(installDir)
          resolve()
        } else {
          reject(new Error(`bun install exited with code ${code}`))
        }
      })
      proc.on('error', (err) => { clearTimeout(timeout); reject(err) })
    })
  }

  private savePackageHash(installDir: string): void {
    try {
      const pkgPath = path.join(installDir, 'package.json')
      const hash = crypto.createHash('sha256').update(fs.readFileSync(pkgPath)).digest('hex')
      fs.writeFileSync(path.join(installDir, '.package-hash'), hash)
    } catch { /* best effort */ }
  }

  private syncBundledAssets(installDir: string): void {
    try {
      const resourcesOpenClaw = path.join(process.resourcesPath, 'openclaw')
      for (const dir of ['dist', 'docs', 'extensions', 'skills']) {
        const src = path.join(resourcesOpenClaw, dir)
        const dest = path.join(installDir, dir)
        if (fs.existsSync(src)) {
          copyRecursive(src, dest)
        }
      }
      for (const file of ['openclaw.mjs', 'package.json']) {
        const src = path.join(resourcesOpenClaw, file)
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(installDir, file))
        }
      }
      // Remove lockfiles that confuse bun install (e.g. leftover package-lock.json)
      for (const lockfile of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']) {
        const lf = path.join(installDir, lockfile)
        if (fs.existsSync(lf)) fs.unlinkSync(lf)
      }
      console.log('[ProcessManager] Synced bundled assets to install dir')
    } catch (error: any) {
      console.error('[ProcessManager] Failed to sync bundled assets:', error.message)
    }
  }

  /**
   * Run `openclaw gateway stop` using the best available binary:
   * 1. System openclaw binary (if installed)
   * 2. Bundled bun + openclaw.mjs (production builds)
   * 3. Dev-mode bun + source
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
      const bunBinaryName = `bun-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
      const bundledBun = path.join(process.resourcesPath, 'bun', bunBinaryName)
      const openclawMjs = path.join(home, '.openclaw-easy', 'app', 'openclaw.mjs')

      if (fs.existsSync(bundledBun) && fs.existsSync(openclawMjs)) {
        try {
          console.log(`[ProcessManager] Running: ${bundledBun} ${openclawMjs} gateway stop`)
          await execFileAsync(bundledBun, [openclawMjs, 'gateway', 'stop'], { timeout: 15_000 })
          console.log('[ProcessManager] openclaw gateway stop succeeded (bundled)')
          return
        } catch (err: any) {
          console.warn('[ProcessManager] Bundled openclaw gateway stop failed:', err.message)
        }
      }
    } else {
      // Dev mode: use bun + source
      const openclawPath = path.join(__dirname, '../../../../openclaw/src/index.ts')
      try {
        console.log(`[ProcessManager] Running: bun ${openclawPath} gateway stop`)
        await execFileAsync('bun', [openclawPath, 'gateway', 'stop'], { timeout: 15_000 })
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

  private async installOpenClawBundle(bundledBun: string, installDir: string): Promise<void> {
    const resourcesOpenClaw = path.join(process.resourcesPath, 'openclaw')

    this.emitLog('📦 Copying OpenClaw files...')
    fs.mkdirSync(installDir, { recursive: true })
    copyRecursive(resourcesOpenClaw, installDir)

    // Remove lockfiles that confuse bun install
    for (const lockfile of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']) {
      const lf = path.join(installDir, lockfile)
      if (fs.existsSync(lf)) fs.unlinkSync(lf)
    }

    this.emitLog('📥 Installing dependencies (first launch only, ~30 seconds)...')
    console.log('[ProcessManager] Running bun install --production in', installDir)

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(bundledBun, ['install', '--production', '--ignore-scripts'], {
        cwd: installDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, HOME: path.join(process.env.HOME || '', '.openclaw-easy') }
      })

      const timeout = setTimeout(() => {
        proc.kill()
        reject(new Error('bun install timed out after 3 minutes'))
      }, 3 * 60 * 1000)

      proc.stdout?.on('data', (d) => {
        const text = d.toString().trim()
        if (text) this.emitLog(`  ${text}`)
      })
      proc.stderr?.on('data', (d) => {
        const text = d.toString().trim()
        if (text && !text.includes('warn')) this.emitLog(`  ${text}`)
      })
      proc.on('exit', (code) => {
        clearTimeout(timeout)
        if (code === 0) {
          this.emitLog('✅ OpenClaw dependencies installed successfully')
          this.savePackageHash(installDir)
          resolve()
        } else {
          reject(new Error(`bun install exited with code ${code}`))
        }
      })
      proc.on('error', (err) => { clearTimeout(timeout); reject(err) })
    })
  }
}
