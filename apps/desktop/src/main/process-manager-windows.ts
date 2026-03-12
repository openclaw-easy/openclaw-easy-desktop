import { spawn } from 'child_process'
import * as crypto from 'crypto'
import * as path from 'path'
import * as fs from 'fs'
import * as net from 'net'
import { promisify } from 'util'
import { exec } from 'child_process'
import { ProcessManagerBase, ConfigManager } from './process-manager-base'
import { sanitizeConfigForBundled } from './utils/config-sanitizer'

const execAsync = (cmd: string) => promisify(exec)(cmd, { windowsHide: true })

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

export class ProcessManagerWindows extends ProcessManagerBase {

  constructor(configPath: string, configManager?: ConfigManager) {
    super(configPath, configManager)
  }

  // ── Port helpers (Windows netstat) ──────────────────────────────────────────

  /**
   * Check if a port is actually accepting TCP connections.
   * More reliable than parsing netstat output.
   */
  private isPortListening(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket()
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => { socket.destroy(); resolve(false) })
      socket.connect(port, '127.0.0.1')
    })
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

  private async findAvailablePort(): Promise<number | null> {
    const ports = [18800, 18801, 18802, 18803, 18804, 18805, 18806, 18807, 18808, 18809]
    console.log('[ProcessManagerWindows] Finding available port...')
    for (const port of ports) {
      const pid = await this.getPidOnPort(port)
      if (!pid) {
        console.log(`[ProcessManagerWindows] Port ${port} is available`)
        return port
      }
      console.log(`[ProcessManagerWindows] Port ${port} in use (PID ${pid})`)
    }
    console.error('[ProcessManagerWindows] No available ports found')
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

  // ── Native install / sync (mirrors process-manager-mac.ts) ─────────────────

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
    const home = process.env.USERPROFILE || process.env.HOME || ''
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(bundledBun, ['install', '--production', '--ignore-scripts'], {
        cwd: installDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, HOME: path.join(home, '.openclaw-easy') },
        windowsHide: true,
      })
      const timeout = setTimeout(() => { proc.kill(); reject(new Error('bun install timed out')) }, 3 * 60 * 1000)
      proc.stdout?.on('data', (d) => { const t = d.toString().trim(); if (t) this.emitLog(`  ${t}`) })
      proc.stderr?.on('data', (d) => { const t = d.toString().trim(); if (t && !t.includes('warn')) this.emitLog(`  ${t}`) })
      proc.on('exit', (code) => {
        clearTimeout(timeout)
        if (code === 0) {
          this.emitLog('Dependencies updated successfully')
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
      console.log('[ProcessManagerWindows] Synced bundled assets to install dir')
    } catch (error: any) {
      console.error('[ProcessManagerWindows] Failed to sync bundled assets:', error.message)
    }
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

  private async installOpenClawBundle(bundledBun: string, installDir: string): Promise<void> {
    const resourcesOpenClaw = path.join(process.resourcesPath, 'openclaw')

    this.emitLog('Copying OpenClaw files...')
    fs.mkdirSync(installDir, { recursive: true })
    copyRecursive(resourcesOpenClaw, installDir)

    // Remove lockfiles that confuse bun install
    for (const lockfile of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']) {
      const lf = path.join(installDir, lockfile)
      if (fs.existsSync(lf)) fs.unlinkSync(lf)
    }

    this.emitLog('Installing dependencies (first launch only, ~30 seconds)...')
    console.log('[ProcessManagerWindows] Running bun install --production in', installDir)

    const home = process.env.USERPROFILE || process.env.HOME || ''

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(bundledBun, ['install', '--production', '--ignore-scripts'], {
        cwd: installDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, HOME: path.join(home, '.openclaw-easy') },
        windowsHide: true,
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
          this.emitLog('OpenClaw dependencies installed successfully')
          this.savePackageHash(installDir)
          resolve()
        } else {
          reject(new Error(`bun install exited with code ${code}`))
        }
      })
      proc.on('error', (err) => { clearTimeout(timeout); reject(err) })
    })
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async start(): Promise<boolean> {
    if (this.status === 'running') {
      console.log('[ProcessManagerWindows] Already running')
      return true
    }
    if (this.status === 'starting') {
      console.log('[ProcessManagerWindows] Already starting')
      return false
    }

    try {
      this.setStatus('starting')

      if (this.process && !this.process.killed) {
        this.setStatus('running')
        return true
      }

      // Find available port
      const availablePort = await this.findAvailablePort()
      if (!availablePort) {
        this.setStatus('error')
        this.emitLog('Could not find an available port (18800-18809 all in use)')
        return false
      }

      this.activePort = availablePort
      console.log(`[ProcessManagerWindows] Using port ${availablePort}`)
      this.emitLog(`Using port ${availablePort}`)

      if (this.configManager) {
        await this.configManager.ensureGatewayConfigured(availablePort)
        await this.clearAllCooldowns()
      }

      const openclawEnv = this.openclawEnv.getEnvironmentVariables()
      const { app } = await import('electron')
      const home = process.env.USERPROFILE || process.env.HOME || ''

      const enhancedEnv = {
        ...process.env,
        ...openclawEnv,
        OPENCLAW_ALLOW_MULTI_GATEWAY: '1'
      }

      let spawnCmd: string
      let spawnArgs: string[]
      let spawnCwd: string

      if (app.isPackaged) {
        // Production: use bundled bun-windows.exe and openclaw installed at ~/.openclaw-easy/app/
        const bundledBun = path.join(process.resourcesPath, 'bun', 'bun-windows.exe')
        const openclawInstallDir = path.join(home, '.openclaw-easy', 'app')
        const openclawMjs = path.join(openclawInstallDir, 'openclaw.mjs')
        const nodeModulesDir = path.join(openclawInstallDir, 'node_modules')

        if (!fs.existsSync(nodeModulesDir)) {
          this.emitLog('First launch: setting up OpenClaw (this takes ~30 seconds)...')
          console.log('[ProcessManagerWindows] First-launch setup: installing OpenClaw dependencies')
          await this.installOpenClawBundle(bundledBun, openclawInstallDir)
        } else {
          this.syncBundledAssets(openclawInstallDir)
          // Re-install deps if package.json changed (e.g. after app update with new dependencies)
          if (this.needsDepsUpdate(openclawInstallDir)) {
            this.emitLog('Updating dependencies after app update...')
            console.log('[ProcessManagerWindows] package.json changed — re-running bun install')
            await this.runBunInstall(bundledBun, openclawInstallDir)
          }
        }

        await this.sanitizeConfigForBundled(openclawInstallDir)

        spawnCmd = bundledBun
        spawnArgs = [openclawMjs, 'gateway', 'run', '--port', String(this.activePort), '--bind', 'loopback']
        spawnCwd = openclawInstallDir
        console.log(`[ProcessManagerWindows] Production: ${bundledBun} ${openclawMjs}`)
        this.emitLog('Starting OpenClaw gateway (bundled runtime)...')
      } else {
        // Dev mode: use bun from PATH + TypeScript source
        const openclawPath = path.join(__dirname, '../../../../openclaw/src/index.ts')
        spawnCmd = 'bun'
        spawnArgs = [openclawPath, 'gateway', 'run', '--port', String(this.activePort), '--bind', 'loopback']
        spawnCwd = path.join(__dirname, '../../../../openclaw/')
        console.log(`[ProcessManagerWindows] Dev: bun ${openclawPath}`)
      }

      this.process = spawn(spawnCmd, spawnArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: spawnCwd,
        env: enhancedEnv,
        windowsHide: true,
      })

      this.setupProcessListeners()
      this.emitLog(`Starting desktop OpenClaw gateway on port ${this.activePort}...`)

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

    } catch (error: any) {
      console.error('[ProcessManagerWindows] Start error:', error)
      this.setStatus('error')
      return false
    }
  }

  async stop(): Promise<boolean> {
    if (this.status === 'stopped') { return true }

    try {
      console.log('[ProcessManagerWindows] Stopping gateway...')
      this.emitLog('Stopping desktop gateway...')

      if (this.process) {
        this.cleanupProcessListeners(this.process)
        this.process.kill()
        await new Promise(resolve => setTimeout(resolve, 2000))
        this.process = null
      }

      // Also kill any lingering process on the port
      if (this.activePort > 0) {
        await this.killGatewayOnPort(this.activePort)
      }

      this.activePort = 0
      this.setStatus('stopped')
      this.emitLog('Desktop gateway stopped')
      return true
    } catch (error: any) {
      console.error('[ProcessManagerWindows] Stop error:', error)
      this.setStatus('error')
      return false
    }
  }

  async restart(): Promise<boolean> {
    const portBeforeStop = this.activePort || 18800
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
