import { spawn, execSync, type ChildProcess } from 'child_process'
import { existsSync, writeFileSync, mkdirSync, realpathSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { BrowserWindow } from 'electron'

export type WhisperServerStatus = 'stopped' | 'installing' | 'starting' | 'running' | 'error'

export interface WhisperDetectionResult {
  installed: boolean
  canInstall: boolean
  installerTool: 'pipx' | 'pip3' | null
  binaryPath?: string
}

export interface WhisperStatusInfo {
  status: WhisperServerStatus
  port: number
  model: string
  installed: boolean
  error?: string
}

export const WHISPER_MODELS = [
  { id: 'tiny', name: 'Tiny (~75 MB)', size: '75 MB' },
  { id: 'base', name: 'Base (~150 MB)', size: '150 MB' },
  { id: 'small', name: 'Small (~500 MB) — recommended', size: '500 MB' },
  { id: 'medium', name: 'Medium (~1.5 GB)', size: '1.5 GB' },
  { id: 'large-v3', name: 'Large v3 (~3 GB, most accurate)', size: '3 GB' },
  { id: 'turbo', name: 'Turbo (~1.5 GB, fast + accurate)', size: '1.5 GB' },
] as const

const DEFAULT_PORT = 8000
const DEFAULT_MODEL = 'small'
const HEALTH_POLL_INTERVAL = 2000
const HEALTH_POLL_TIMEOUT = 300_000 // 5 min — first launch downloads model

export class WhisperServerManager {
  private process: ChildProcess | null = null
  private status: WhisperServerStatus = 'stopped'
  private port: number = DEFAULT_PORT
  private model: string = DEFAULT_MODEL
  private installed: boolean = false
  private lastError: string | undefined
  private mainWindow: BrowserWindow | null = null
  private healthPollTimer: ReturnType<typeof setInterval> | null = null
  private binaryPath: string | null = null

  setMainWindow(win: BrowserWindow | null) {
    this.mainWindow = win
  }

  /** Check if faster-whisper-server is installed and if pipx/pip3 are available. */
  async detectInstallation(): Promise<WhisperDetectionResult> {
    try {
      const home = homedir()
      console.log(`[WhisperServer] Detecting installation (home=${home})`)

      // Check well-known paths
      const candidates = [
        join(home, '.local', 'bin', 'faster-whisper-server'),
        join(home, '.local', 'bin', 'faster_whisper_server'),
        '/opt/homebrew/bin/faster-whisper-server',
        '/usr/local/bin/faster-whisper-server',
      ]

      for (const p of candidates) {
        try {
          const found = existsSync(p)
          console.log(`[WhisperServer] Checking ${p} → ${found}`)
          if (found) {
            this.binaryPath = p
            this.installed = true
            return { installed: true, canInstall: true, installerTool: 'pipx', binaryPath: p }
          }
        } catch (err) {
          console.error(`[WhisperServer] existsSync error for ${p}:`, err)
        }
      }

      // Try PATH lookup
      const found = this.whichSync('faster-whisper-server')
      console.log(`[WhisperServer] PATH lookup: ${found || 'not found'}`)
      if (found) {
        this.binaryPath = found
        this.installed = true
        return { installed: true, canInstall: true, installerTool: 'pipx', binaryPath: found }
      }

      this.installed = false
      this.binaryPath = null

      // Check available installers
      const hasPipx = !!this.whichSync('pipx')
      const hasPip3 = !!this.whichSync('pip3')
      console.log(`[WhisperServer] Not installed. pipx=${hasPipx}, pip3=${hasPip3}`)

      return {
        installed: false,
        canInstall: hasPipx || hasPip3,
        installerTool: hasPipx ? 'pipx' : hasPip3 ? 'pip3' : null,
      }
    } catch (err) {
      console.error('[WhisperServer] detectInstallation failed:', err)
      return { installed: false, canInstall: false, installerTool: null }
    }
  }

  /** Install faster-whisper-server via pipx or pip3. Emits progress to renderer. */
  async install(): Promise<{ success: boolean; error?: string }> {
    const detection = await this.detectInstallation()
    if (detection.installed) {
      return { success: true }
    }
    if (!detection.canInstall || !detection.installerTool) {
      return { success: false, error: 'Python is required. Install Python 3 first.' }
    }

    this.setStatus('installing')
    this.sendLog('Starting installation of faster-whisper-server...')

    return new Promise((resolve) => {
      const args = detection.installerTool === 'pipx'
        ? ['install', 'faster-whisper-server']
        : ['install', '--user', 'faster-whisper-server']

      const cmd = detection.installerTool!
      this.sendLog(`Running: ${cmd} ${args.join(' ')}`)

      const proc = spawn(cmd, args, {
        env: { ...process.env, PATH: this.buildPath() },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      proc.stdout?.on('data', (data: Buffer) => {
        this.sendLog(data.toString().trim())
      })

      proc.stderr?.on('data', (data: Buffer) => {
        this.sendLog(data.toString().trim())
      })

      proc.on('close', async (code) => {
        if (code === 0) {
          // Re-detect to update binaryPath
          await this.detectInstallation()
          // Patch missing pyproject.toml (faster-whisper-server bug)
          if (this.binaryPath) this.patchPyprojectToml(this.binaryPath)
          this.setStatus('stopped')
          this.sendLog('Installation complete.')
          resolve({ success: true })
        } else {
          this.setStatus('error', `Installation failed with exit code ${code}`)
          resolve({ success: false, error: `Installation failed (exit code ${code})` })
        }
      })

      proc.on('error', (err) => {
        this.setStatus('error', err.message)
        resolve({ success: false, error: err.message })
      })
    })
  }

  /** Start the whisper server with the given model and port. */
  async start(model?: string, port?: number): Promise<{ success: boolean; error?: string }> {
    if (this.process && this.status === 'running') {
      return { success: true }
    }

    // Stop any existing process first
    await this.stop()

    if (!this.installed) {
      const detection = await this.detectInstallation()
      if (!detection.installed) {
        return { success: false, error: 'faster-whisper-server is not installed.' }
      }
    }

    this.model = model || this.model || DEFAULT_MODEL
    this.port = port || this.port || DEFAULT_PORT

    // Check if a whisper server is already running on this port
    if (await this.isPortHealthy(this.port)) {
      this.sendLog(`Whisper server already running on port ${this.port}`)
      this.setStatus('running')
      return { success: true }
    }

    // If port is occupied by something else, find a free port
    if (await this.isPortInUse(this.port)) {
      const origPort = this.port
      this.port = await this.findFreePort(this.port)
      this.sendLog(`Port ${origPort} is in use, using port ${this.port} instead`)
    }

    const bin = this.binaryPath || 'faster-whisper-server'
    this.patchPyprojectToml(bin)
    const modelId = `Systran/faster-whisper-${this.model}`
    const args = [this.model, '--host', '127.0.0.1', '--port', String(this.port)]
    const env = {
      ...process.env,
      PATH: this.buildPath(),
      // Tell the server to download the model during startup so /health only
      // returns 200 after the model is ready (supported by speaches / newer builds).
      PRELOAD_MODELS: JSON.stringify([modelId]),
      // Never auto-unload the model while the server is running
      STT_MODEL_TTL: '-1',
    }

    this.setStatus('starting')
    this.sendLog(`Starting: ${bin} ${args.join(' ')}`)

    try {
      let lastStderr = ''
      this.process = spawn(bin, args, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      })

      this.process.stdout?.on('data', (data: Buffer) => {
        const line = data.toString().trim()
        if (line) this.sendLog(line)
      })

      this.process.stderr?.on('data', (data: Buffer) => {
        const line = data.toString().trim()
        if (line) {
          lastStderr = line
          this.sendLog(line)
        }
      })

      this.process.on('close', (code) => {
        this.stopHealthPoll()
        if (this.status !== 'stopped') {
          const detail = lastStderr ? `: ${lastStderr}` : ''
          this.setStatus('error', `Server exited with code ${code}${detail}`)
        }
        this.process = null
      })

      this.process.on('error', (err) => {
        this.stopHealthPoll()
        this.setStatus('error', err.message)
        this.process = null
      })

      // Poll health endpoint until HTTP server is up
      await this.waitForHealth()

      // Probe with a tiny silent audio clip to trigger model download/load.
      // The /health endpoint returns 200 before the model is ready, so without
      // this probe the UI shows "Running" while the model is still downloading.
      this.sendLog('Loading model (downloading if not cached — this may take a few minutes)...')
      await this.probeModelReady()

      this.setStatus('running')
      this.sendLog('Whisper server is ready.')
      return { success: true }
    } catch (err: any) {
      this.setStatus('error', err.message)
      return { success: false, error: err.message }
    }
  }

  /** Stop the whisper server. */
  async stop(): Promise<void> {
    this.stopHealthPoll()

    if (!this.process) {
      this.setStatus('stopped')
      return
    }

    this.sendLog('Stopping whisper server...')

    return new Promise((resolve) => {
      const proc = this.process!
      const forceKillTimer = setTimeout(() => {
        try { proc.kill('SIGKILL') } catch { /* already dead */ }
      }, 2000)

      proc.on('close', () => {
        clearTimeout(forceKillTimer)
        this.process = null
        this.setStatus('stopped')
        this.sendLog('Whisper server stopped.')
        resolve()
      })

      try {
        proc.kill('SIGTERM')
      } catch {
        clearTimeout(forceKillTimer)
        this.process = null
        this.setStatus('stopped')
        resolve()
      }
    })
  }

  /** Get current status info. */
  getStatus(): WhisperStatusInfo {
    return {
      status: this.status,
      port: this.port,
      model: this.model,
      installed: this.installed,
      error: this.lastError,
    }
  }

  /** Return the active port (for STT manager to use). */
  getActivePort(): number {
    return this.port
  }

  isRunning(): boolean {
    return this.status === 'running'
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private setStatus(status: WhisperServerStatus, error?: string) {
    this.status = status
    this.lastError = error
    this.broadcastStatus()
  }

  private broadcastStatus() {
    const info = this.getStatus()
    this.mainWindow?.webContents?.send('whisper-server:status-update', info)
  }

  private sendLog(message: string) {
    console.log(`[WhisperServer] ${message}`)
    this.mainWindow?.webContents?.send('whisper-server:log', message)
  }

  private async waitForHealth(): Promise<void> {
    const url = `http://127.0.0.1:${this.port}/health`
    const start = Date.now()

    return new Promise<void>((resolve, reject) => {
      let settled = false
      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        this.stopHealthPoll()
        if (this.process) this.process.removeListener('close', onProcessExit)
        fn()
      }

      // If the process exits before becoming healthy, reject immediately
      // instead of leaving the promise hanging with no resolve/reject path.
      const onProcessExit = (code: number | null) => {
        settle(() => {
          reject(new Error(`Server process exited with code ${code} before becoming healthy`))
        })
      }
      this.process?.on('close', onProcessExit)

      this.healthPollTimer = setInterval(async () => {
        if (settled) return

        if (Date.now() - start > HEALTH_POLL_TIMEOUT) {
          settle(() => {
            this.setStatus('error', 'Server did not become healthy in time (model may still be downloading)')
            reject(new Error('Health check timeout'))
          })
          return
        }

        try {
          const resp = await fetch(url, { signal: AbortSignal.timeout(2000) })
          if (resp.ok) {
            settle(() => {
              this.sendLog('HTTP server is up, verifying model readiness...')
              resolve()
            })
          }
        } catch {
          // Server not ready yet — keep polling
        }
      }, HEALTH_POLL_INTERVAL)
    })
  }

  /**
   * Send a tiny silent WAV to the transcription endpoint to force the model
   * to download (if not cached) and load into memory. This blocks until the
   * model is actually ready, unlike /health which returns 200 immediately.
   */
  private async probeModelReady(): Promise<void> {
    const url = `http://127.0.0.1:${this.port}/v1/audio/transcriptions`

    // Minimal valid WAV: 16-bit mono 16kHz, 0.5s of silence (16000 samples)
    const numSamples = 16000
    const dataSize = numSamples * 2 // 16-bit = 2 bytes per sample
    const header = Buffer.alloc(44)
    header.write('RIFF', 0)
    header.writeUInt32LE(36 + dataSize, 4)
    header.write('WAVE', 8)
    header.write('fmt ', 12)
    header.writeUInt32LE(16, 16)       // fmt chunk size
    header.writeUInt16LE(1, 20)        // PCM
    header.writeUInt16LE(1, 22)        // mono
    header.writeUInt32LE(16000, 24)    // sample rate
    header.writeUInt32LE(32000, 28)    // byte rate
    header.writeUInt16LE(2, 32)        // block align
    header.writeUInt16LE(16, 34)       // bits per sample
    header.write('data', 36)
    header.writeUInt32LE(dataSize, 40)
    const silentWav = Buffer.concat([header, Buffer.alloc(dataSize)])

    const boundary = `----Probe${Date.now()}`
    const parts: Buffer[] = []
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="probe.wav"\r\nContent-Type: audio/wav\r\n\r\n`
    ))
    parts.push(silentWav)
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`))
    const body = Buffer.concat(parts)

    // 10-minute timeout — large models can take a while to download
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 600_000)

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body,
        signal: controller.signal,
      })
      clearTimeout(timeout)
      // We don't care about the response content — we only care that the
      // request completed, which means the model is loaded and ready.
      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        this.sendLog(`Model probe returned ${resp.status}: ${text.slice(0, 200)}`)
      }
    } catch (err: any) {
      clearTimeout(timeout)
      if (err.name === 'AbortError') {
        throw new Error('Model loading timed out after 10 minutes')
      }
      throw err
    }
  }

  private stopHealthPoll() {
    if (this.healthPollTimer) {
      clearInterval(this.healthPollTimer)
      this.healthPollTimer = null
    }
  }

  private whichSync(cmd: string): string | null {
    try {
      const result = execSync(`which ${cmd}`, {
        encoding: 'utf-8',
        env: { ...process.env, PATH: this.buildPath() },
        timeout: 5000,
      }).trim()
      return result || null
    } catch {
      return null
    }
  }

  /**
   * Workaround: faster-whisper-server 0.0.x reads pyproject.toml at import time
   * to get its version. When installed via pipx the file doesn't exist in the
   * expected location, causing an immediate crash. Create a minimal stub if missing.
   */
  private patchPyprojectToml(bin: string) {
    try {
      const resolved = realpathSync(bin)
      // resolved is something like …/venvs/faster-whisper-server/bin/faster-whisper-server
      // site-packages is at …/venvs/faster-whisper-server/lib/python*/site-packages/
      const venvDir = join(dirname(dirname(resolved))) // …/venvs/faster-whisper-server/
      const libDir = join(venvDir, 'lib')
      if (!existsSync(libDir)) return

      const { readdirSync } = require('fs') as typeof import('fs')
      const pythonDirs = readdirSync(libDir).filter((d: string) => d.startsWith('python'))
      for (const pyDir of pythonDirs) {
        const sitePackages = join(libDir, pyDir, 'site-packages')
        const pyproject = join(sitePackages, 'pyproject.toml')
        if (existsSync(sitePackages) && !existsSync(pyproject)) {
          writeFileSync(pyproject, '[project]\nname = "faster-whisper-server"\nversion = "0.0.2"\n')
          console.log(`[WhisperServer] Created missing ${pyproject}`)
        }
      }
    } catch (err) {
      console.warn('[WhisperServer] patchPyprojectToml failed (non-fatal):', err)
    }
  }

  /** Check if a whisper server is already healthy on this port. */
  private async isPortHealthy(port: number): Promise<boolean> {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) })
      return resp.ok
    } catch {
      return false
    }
  }

  /** Check if a port is in use (TCP connect succeeds). */
  private async isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const { createConnection } = require('net') as typeof import('net')
      const socket = createConnection({ host: '127.0.0.1', port })
      socket.on('connect', () => { socket.destroy(); resolve(true) })
      socket.on('error', () => { resolve(false) })
      socket.setTimeout(1000, () => { socket.destroy(); resolve(false) })
    })
  }

  /** Find a free port starting from the given port. */
  private async findFreePort(startPort: number): Promise<number> {
    for (let p = startPort + 1; p < startPort + 100; p++) {
      if (!(await this.isPortInUse(p))) return p
    }
    return startPort + 1 // fallback
  }

  /** Build a PATH that includes common Python binary locations. */
  private buildPath(): string {
    const home = homedir()
    const extra = [
      join(home, '.local', 'bin'),
      '/usr/local/bin',
      '/opt/homebrew/bin',
    ]
    const current = process.env.PATH || ''
    return [...extra, current].join(':')
  }
}
