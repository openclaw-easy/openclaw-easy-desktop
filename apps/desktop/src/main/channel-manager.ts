import { spawn, execFile, ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { promisify } from 'util'
import { BrowserWindow } from 'electron'
import * as path from 'path'
import { OpenClawEnvironment } from './openclaw-environment'
import { ConfigManager } from './managers/config-manager'

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

  constructor(configPath: string, configManager?: ConfigManager) {
    this.configPath = configPath
    this.openclawEnv = new OpenClawEnvironment(configPath)
    this.configManager = configManager || new ConfigManager()
    this.setupSessionCleanup()
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

  async checkTelegramStatus(): Promise<{ connected: boolean }> {
    try {
      const { app } = await import('electron')
      const { promises: fs } = await import('fs')
      const path = await import('path')

      const homeDir = app.getPath('home')
      const credentialsDir = path.join(homeDir, '.openclaw', 'credentials', 'telegram')

      try {
        const files = await fs.readdir(credentialsDir)
        if (files.some(f => !f.startsWith('.'))) {
          return { connected: true }
        }
      } catch {
        // Directory doesn't exist — not connected
      }

      return { connected: false }
    } catch {
      return { connected: false }
    }
  }

  async checkDiscordStatus(): Promise<{ connected: boolean }> {
    try {
      const { app } = await import('electron')
      const { promises: fs } = await import('fs')
      const path = await import('path')

      const homeDir = app.getPath('home')
      const credentialsDir = path.join(homeDir, '.openclaw', 'credentials', 'discord')

      try {
        const files = await fs.readdir(credentialsDir)
        if (files.some(f => !f.startsWith('.'))) {
          return { connected: true }
        }
      } catch {
        // Directory doesn't exist — not connected
      }

      return { connected: false }
    } catch {
      return { connected: false }
    }
  }

  async disconnectWhatsApp(): Promise<{ success: boolean; logs: string[] }> {
    try {
      this.addLog('🔌 Disconnecting WhatsApp...')

      const { runtime, enhancedEnv, cwd, buildArgs } = await this.resolveOpenClawSpawn()
      const disconnectProc = spawn(runtime, buildArgs('channels', 'logout', '--channel', 'whatsapp'), {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: enhancedEnv,
        cwd,
        windowsHide: true,
      })

      return new Promise((resolve) => {
        const logs: string[] = []

        disconnectProc.stdout?.on('data', (data) => {
          const text = data.toString()
          logs.push(text)
          this.addLog(`📱 STDOUT: ${text.trim()}`)
        })

        disconnectProc.stderr?.on('data', (data) => {
          const text = data.toString()
          if (!text.includes('DeprecationWarning')) {
            logs.push(text)
            this.addLog(`⚠️ STDERR: ${text.trim()}`)
          }
        })

        disconnectProc.on('exit', (code) => {
          const success = code === 0
          if (success) {
            this.addLog('✅ WhatsApp disconnected successfully')
            // Emit status change to renderer
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.webContents.send('whatsapp:status-change', 'disconnected')
            }
          } else {
            this.addLog(`❌ Failed to disconnect WhatsApp (exit code: ${code})`)
          }

          resolve({ success, logs })
        })

        disconnectProc.on('error', (error) => {
          this.addLog(`❌ Disconnect process error: ${error.message}`)
          resolve({ success: false, logs: [error.message] })
        })

        // Timeout after 10 seconds
        setTimeout(() => {
          if (!disconnectProc.killed) {
            disconnectProc.kill('SIGTERM')
            resolve({ success: false, logs: ['Disconnect timeout'] })
          }
        }, 10000)
      })
    } catch (error: any) {
      this.addLog(`❌ Failed to disconnect WhatsApp: ${error.message}`)
      return { success: false, logs: [error.message] }
    }
  }

  async disconnectTelegram(): Promise<{ success: boolean; logs: string[] }> {
    try {
      this.addLog('🔵 Disconnecting Telegram...')

      const { runtime, enhancedEnv, cwd, buildArgs } = await this.resolveOpenClawSpawn()
      const disconnectProc = spawn(runtime, buildArgs('channels', 'logout', '--channel', 'telegram'), {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: enhancedEnv,
        cwd,
        windowsHide: true,
      })

      return new Promise((resolve) => {
        const logs: string[] = []

        disconnectProc.stdout?.on('data', (data) => {
          const text = data.toString()
          logs.push(text)
          this.addLog(`🔵 STDOUT: ${text.trim()}`)
        })

        disconnectProc.stderr?.on('data', (data) => {
          const text = data.toString()
          if (!text.includes('DeprecationWarning')) {
            logs.push(text)
            this.addLog(`⚠️ STDERR: ${text.trim()}`)
          }
        })

        disconnectProc.on('exit', (code) => {
          const success = code === 0
          if (success) {
            this.addLog('✅ Telegram disconnected successfully')
            // Emit status change to renderer
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.webContents.send('telegram:status-change', 'disconnected')
            }
          } else {
            this.addLog(`❌ Failed to disconnect Telegram (exit code: ${code})`)
          }

          resolve({ success, logs })
        })

        disconnectProc.on('error', (error) => {
          this.addLog(`❌ Telegram disconnect process error: ${error.message}`)
          resolve({ success: false, logs: [error.message] })
        })

        // Timeout after 10 seconds
        setTimeout(() => {
          if (!disconnectProc.killed) {
            disconnectProc.kill('SIGTERM')
            resolve({ success: false, logs: ['Disconnect timeout'] })
          }
        }, 10000)
      })
    } catch (error: any) {
      this.addLog(`❌ Failed to disconnect Telegram: ${error.message}`)
      return { success: false, logs: [error.message] }
    }
  }

  async disconnectDiscord(): Promise<{ success: boolean; logs: string[] }> {
    try {
      this.addLog('🟦 Disconnecting Discord...')

      const { runtime, enhancedEnv, cwd, buildArgs } = await this.resolveOpenClawSpawn()
      const disconnectProc = spawn(runtime, buildArgs('channels', 'logout', '--channel', 'discord'), {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: enhancedEnv,
        cwd,
        windowsHide: true,
      })

      return new Promise((resolve) => {
        const logs: string[] = []

        disconnectProc.stdout?.on('data', (data) => {
          const text = data.toString()
          logs.push(text)
          this.addLog(`🟦 STDOUT: ${text.trim()}`)
        })

        disconnectProc.stderr?.on('data', (data) => {
          const text = data.toString()
          if (!text.includes('DeprecationWarning')) {
            logs.push(text)
            this.addLog(`⚠️ STDERR: ${text.trim()}`)
          }
        })

        disconnectProc.on('exit', (code) => {
          const success = code === 0
          if (success) {
            this.addLog('✅ Discord disconnected successfully')
            // Emit status change to renderer
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.webContents.send('discord:status-change', 'disconnected')
            }
          } else {
            this.addLog(`❌ Failed to disconnect Discord (exit code: ${code})`)
          }

          resolve({ success, logs })
        })

        disconnectProc.on('error', (error) => {
          this.addLog(`❌ Discord disconnect process error: ${error.message}`)
          resolve({ success: false, logs: [error.message] })
        })

        // Timeout after 10 seconds
        setTimeout(() => {
          if (!disconnectProc.killed) {
            disconnectProc.kill('SIGTERM')
            resolve({ success: false, logs: ['Disconnect timeout'] })
          }
        }, 10000)
      })
    } catch (error: any) {
      this.addLog(`❌ Failed to disconnect Discord: ${error.message}`)
      return { success: false, logs: [error.message] }
    }
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

        whatsappLoginProcess!.stdout?.on('data', (data) => {
          const text = data.toString()
          logs.push(text)

          // Check if already connected or just completed login
          if (text.includes('already linked') ||
              text.includes('Linked!') ||
              text.includes('web session ready') ||
              text.includes('Credentials saved')) {
            if (foundQR) {
              // QR was shown and user scanned it — this is a successful login completion.
              // Send status-change event BEFORE cleanup so the renderer can react.
              this.addLog('✅ WhatsApp login successful — credentials saved')
              if (activeWhatsAppSession) {
                activeWhatsAppSession.status = 'connected'
              }
              if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('whatsapp:status-change', 'connected')
              }
              this.cleanupWhatsAppSession()
              this.suggestGatewayRestart()
              // Promise already resolved with QR data — no need to resolve again
              return
            }

            // No QR was shown — device was already linked before we started
            this.addLog('✅ WhatsApp is already connected')
            if (activeWhatsAppSession) {
              activeWhatsAppSession.status = 'connected'
              activeWhatsAppSession.qrData = 'ALREADY_CONNECTED'
            }
            this.cleanupWhatsAppSession()
            resolve({ success: true, qrData: 'ALREADY_CONNECTED', logs })
            return
          }

          // Look for QR code data
          if (text.includes('█') && text.includes('▄') && !foundQR) {
            const lines = text.split('\n')
            const qrLines = lines.filter((line: string) =>
              line.includes('█') || line.includes('▄') || line.includes('▀')
            )

            if (qrLines.length > 10) {
              qrData = qrLines.join('\n')
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

          this.addLog(`📱 ${text.trim()}`)
        })

        whatsappLoginProcess!.stderr?.on('data', (data) => {
          const text = data.toString()
          if (!text.includes('DeprecationWarning')) {
            logs.push(text)
            this.addLog(`⚠️ ${text.trim()}`)
          }
        })

        const qrTimeout = setTimeout(() => {
          if (!foundQR) {
            console.log('[ChannelManager] QR generation timed out after 30 seconds. Logs collected:')
            console.log(logs.join('\n'))
            this.addLog('⏱️ QR generation timed out after 30 seconds')
            this.cleanupWhatsAppSession()
            resolve({ success: false, logs })
          }
        }, 30000)

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
    if (whatsappLoginProcess && !whatsappLoginProcess.killed) {
      this.addLog('🧹 Cleaning up WhatsApp login process')
      whatsappLoginProcess.kill('SIGTERM')

      setTimeout(() => {
        if (whatsappLoginProcess && !whatsappLoginProcess.killed) {
          whatsappLoginProcess.kill('SIGKILL')
        }
      }, 2000)
    }

    whatsappLoginProcess = null
    activeWhatsAppSession = null
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

  /**
   * Finds the system-installed openclaw binary by checking common PATH locations.
   * Returns the absolute path, or null if not found.
   */
  private async findSystemOpenClaw(expandedPath: string): Promise<string | null> {
    const execFileAsync = promisify(execFile)

    // Try `which openclaw` with an expanded PATH
    try {
      const { stdout } = await execFileAsync('which', ['openclaw'], {
        env: { ...process.env, PATH: expandedPath }
      })
      const p = stdout.trim()
      if (p && !p.includes('node_modules')) return p
    } catch { /* not on PATH */ }

    // Check known install locations
    const home = process.env.HOME || process.env.USERPROFILE || ''
    const knownPaths = [
      path.join(home, '.bun', 'bin', 'openclaw'),
      path.join(home, '.npm-global', 'bin', 'openclaw'),
      path.join(home, '.local', 'bin', 'openclaw'),
      '/opt/homebrew/bin/openclaw',
      '/usr/local/bin/openclaw',
    ]
    for (const p of knownPaths) {
      if (existsSync(p)) return p
    }
    return null
  }

  /**
   * Resolves the correct runtime binary, openclaw entry point, and environment
   * for spawning openclaw subprocesses. Branches on app.isPackaged to use
   * bundled bun + ~/.openclaw-easy/app/openclaw.mjs in production, or the
   * local bun + TypeScript source in development.
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

    if (app.isPackaged) {
      const bunBinaryName = isWindows
        ? 'bun-windows.exe'
        : `bun-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
      const bundledBun = path.join(process.resourcesPath, 'bun', bunBinaryName)
      const expandedPath = isWindows
        ? (process.env.PATH || '')
        : [
            path.join(home, '.bun', 'bin'),
            path.join(home, '.npm-global', 'bin'),
            path.join(home, '.local', 'bin'),
            '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin',
            process.env.PATH || ''
          ].join(pathSep)

      const openclawMjs = path.join(home, '.openclaw-easy', 'app', 'openclaw.mjs')
      if (existsSync(bundledBun) && existsSync(openclawMjs)) {
        // ── Bundled bun + openclaw.mjs both present (normal production path) ──
        runtime = bundledBun
        openclawPath = openclawMjs
        cwd = path.join(home, '.openclaw-easy', 'app')
        enhancedEnv = { ...process.env, ...openclawEnv, PATH: expandedPath, OPENCLAW_INCLUDE_OPTIONAL_BUNDLED: '1' }
      } else {
        // ── Bundled bun or openclaw.mjs missing — fall back to system binary ──
        // Happens when: bun not in Resources (old DMG), or openclaw.mjs not yet
        // installed (gateway running in system binary mode, bundle never unpacked).
        const systemBinary = await this.findSystemOpenClaw(expandedPath)
        runtime = systemBinary || 'openclaw'
        openclawPath = '' // system binary IS the entry point
        cwd = home
        enhancedEnv = { ...process.env, ...openclawEnv, PATH: expandedPath, OPENCLAW_INCLUDE_OPTIONAL_BUNDLED: '1' }
        console.warn(`[ChannelManager] bundledBun=${existsSync(bundledBun)} openclawMjs=${existsSync(openclawMjs)}; using system binary: ${runtime}`)
      }
    } else {
      const bunBinDir = path.join(home, '.bun', 'bin')
      const bunAbsolute = path.join(bunBinDir, 'bun')
      // Use absolute path so spawn succeeds even when Electron's PATH is minimal
      runtime = existsSync(bunAbsolute) ? bunAbsolute : 'bun'
      openclawPath = path.join(__dirname, '../../../../openclaw/src/index.ts')
      cwd = path.join(__dirname, '../../../../openclaw/')
      enhancedEnv = { ...process.env, ...openclawEnv, PATH: `${bunBinDir}:${process.env.PATH}`, OPENCLAW_INCLUDE_OPTIONAL_BUNDLED: '1' }
    }

    // Diagnostic logging — visible in Electron logs so production failures can be root-caused.
    const runtimeOk = existsSync(runtime)
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
   */
  private async setChannelOpenAccess(channelId: string): Promise<void> {
    try {
      const fs = await import('fs/promises')
      const configData = await fs.readFile(this.configPath, 'utf8')
      const config = JSON.parse(configData)
      if (config.channels?.[channelId]) {
        config.channels[channelId].dmPolicy = 'open'
        config.channels[channelId].allowFrom = ['*']
        await fs.writeFile(this.configPath, JSON.stringify(config, null, 2))
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
    try {
      this.addLog(`🔵 Adding Telegram channel: ${name}`)

      // Validate token format
      if (!botToken || !botToken.includes(':')) {
        return { success: false, error: 'Invalid bot token format. Expected format: 123456:ABC-DEF...' }
      }

      // Add the Telegram channel using OpenClaw
      await this.executeOpenClawCommand([
        'channels', 'add', '--channel', 'telegram',
        '--name', name,
        '--token', botToken
      ])
      await this.setChannelOpenAccess('telegram')

      this.addLog('✅ Telegram channel added successfully')
      return { success: true }
    } catch (error: any) {
      console.error('[ChannelManager] Failed to add Telegram channel:', error)
      this.addLog(`❌ Failed to add Telegram channel: ${error.message}`)
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
    try {
      this.addLog(`🟦 Adding Discord channel: ${name}`)

      // Validate inputs
      if (!botToken || botToken.length < 50) {
        return { success: false, error: 'Invalid Discord bot token' }
      }
      if (!serverId || !/^\d{17,19}$/.test(serverId)) {
        return { success: false, error: 'Invalid Discord server ID' }
      }

      // Add the Discord channel using OpenClaw
      await this.executeOpenClawCommand([
        'channels', 'add', '--channel', 'discord',
        '--name', name,
        '--token', botToken,
      ])
      await this.setChannelOpenAccess('discord')

      this.addLog('✅ Discord channel added successfully')
      return { success: true }
    } catch (error: any) {
      console.error('[ChannelManager] Failed to add Discord channel:', error)
      this.addLog(`❌ Failed to add Discord channel: ${error.message}`)
      return { success: false, error: error.message }
    }
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
    try {
      const { app } = await import('electron')
      const { promises: fs } = await import('fs')
      const path = await import('path')

      const homeDir = app.getPath('home')
      const credentialsDir = path.join(homeDir, '.openclaw', 'credentials', 'slack')

      try {
        const files = await fs.readdir(credentialsDir)
        if (files.some(f => !f.startsWith('.'))) {
          return { connected: true }
        }
      } catch {
        // Directory doesn't exist — not connected
      }

      return { connected: false }
    } catch {
      return { connected: false }
    }
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
    try {
      this.addLog(`💬 Adding Slack channel: ${name}`)

      if (!botToken || !botToken.startsWith('xoxb-')) {
        return { success: false, error: 'Invalid bot token format. Must start with xoxb-' }
      }
      if (!appToken || !appToken.startsWith('xapp-')) {
        return { success: false, error: 'Invalid app token format. Must start with xapp-' }
      }

      await this.executeOpenClawCommand([
        'channels', 'add', '--channel', 'slack',
        '--name', name,
        '--bot-token', botToken,
        '--app-token', appToken,
      ])
      await this.setChannelOpenAccess('slack')

      this.addLog('✅ Slack channel added successfully')
      return { success: true }
    } catch (error: any) {
      // If CLI doesn't support --bot-token/--app-token flags, write config directly
      this.addLog('⚠️ CLI add failed, writing config directly...')
      try {
        const { app } = await import('electron')
        const fs = await import('fs/promises')
        const path = await import('path')

        const configPath = path.join(app.getPath('home'), '.openclaw', 'openclaw.json')
        let config: any = {}
        try {
          const data = await fs.readFile(configPath, 'utf8')
          config = JSON.parse(data)
        } catch {
          // Start fresh if config doesn't exist
        }

        if (!config.channels) config.channels = {}
        config.channels.slack = {
          enabled: true,
          mode: 'socket',
          botToken,
          appToken,
          dmPolicy: 'open',
          allowFrom: ['*'],
        }

        // Ensure slack plugin is enabled
        if (!config.plugins) config.plugins = {}
        if (!config.plugins.entries) config.plugins.entries = {}
        config.plugins.entries.slack = { enabled: true }

        await fs.writeFile(configPath, JSON.stringify(config, null, 2))
        this.addLog('✅ Slack config written successfully')
        return { success: true }
      } catch (configError: any) {
        this.addLog(`❌ Failed to add Slack channel: ${configError.message}`)
        return { success: false, error: configError.message }
      }
    }
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
      this.addLog('💬 Disconnecting Slack...')

      const { runtime, enhancedEnv, buildArgs } = await this.resolveOpenClawSpawn()
      const disconnectProc = spawn(runtime, buildArgs('channels', 'logout', '--channel', 'slack'), {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: enhancedEnv
      })

      return new Promise((resolve) => {
        const logs: string[] = []

        disconnectProc.stdout?.on('data', (data) => {
          const text = data.toString()
          logs.push(text)
          this.addLog(`💬 STDOUT: ${text.trim()}`)
        })

        disconnectProc.stderr?.on('data', (data) => {
          const text = data.toString()
          if (!text.includes('DeprecationWarning')) {
            logs.push(text)
            this.addLog(`⚠️ STDERR: ${text.trim()}`)
          }
        })

        disconnectProc.on('exit', (code) => {
          const success = code === 0
          if (success) {
            this.addLog('✅ Slack disconnected successfully')
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.webContents.send('slack:status-change', 'disconnected')
            }
          } else {
            this.addLog(`❌ Failed to disconnect Slack (exit code: ${code})`)
          }
          resolve({ success, logs })
        })

        disconnectProc.on('error', (error) => {
          this.addLog(`❌ Slack disconnect process error: ${error.message}`)
          resolve({ success: false, logs: [error.message] })
        })

        setTimeout(() => {
          if (!disconnectProc.killed) {
            disconnectProc.kill('SIGTERM')
            resolve({ success: false, logs: ['Disconnect timeout'] })
          }
        }, 10000)
      })
    } catch (error: any) {
      this.addLog(`❌ Failed to disconnect Slack: ${error.message}`)
      return { success: false, logs: [error.message] }
    }
  }

  // Feishu Methods
  async checkFeishuStatus(): Promise<{ connected: boolean }> {
    try {
      const { app } = await import('electron')
      const fs = await import('fs/promises')
      const pathMod = await import('path')

      const configPath = pathMod.join(app.getPath('home'), '.openclaw', 'openclaw.json')
      try {
        const data = await fs.readFile(configPath, 'utf8')
        const config = JSON.parse(data)
        const appId = config?.channels?.feishu?.accounts?.main?.appId
        if (appId && appId.trim()) {
          return { connected: true }
        }
      } catch {
        // Config doesn't exist or can't be parsed
      }
      return { connected: false }
    } catch {
      return { connected: false }
    }
  }

  async connectFeishu(appId: string, appSecret: string, botName: string = ''): Promise<{ success: boolean; error?: string }> {
    try {
      this.addLog('🔵 Connecting Feishu...')

      const { app } = await import('electron')
      const fs = await import('fs/promises')
      const pathMod = await import('path')

      const configPath = pathMod.join(app.getPath('home'), '.openclaw', 'openclaw.json')
      let config: any = {}
      try {
        const data = await fs.readFile(configPath, 'utf8')
        config = JSON.parse(data)
      } catch {
        // Start fresh if config doesn't exist
      }

      if (!config.channels) config.channels = {}
      if (!config.channels.feishu) config.channels.feishu = {}
      if (!config.channels.feishu.accounts) config.channels.feishu.accounts = {}
      config.channels.feishu.accounts.main = {
        appId: appId.trim(),
        appSecret: appSecret.trim(),
        ...(botName.trim() ? { botName: botName.trim() } : {}),
        enabled: true,
      }

      await fs.writeFile(configPath, JSON.stringify(config, null, 2))
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

      const { app } = await import('electron')
      const fs = await import('fs/promises')
      const pathMod = await import('path')

      const configPath = pathMod.join(app.getPath('home'), '.openclaw', 'openclaw.json')
      try {
        const data = await fs.readFile(configPath, 'utf8')
        const config = JSON.parse(data)
        if (config?.channels?.feishu) {
          delete config.channels.feishu
          await fs.writeFile(configPath, JSON.stringify(config, null, 2))
        }
      } catch { /* ignore */ }

      this.addLog('✅ Feishu disconnected successfully')
      return { success: true, logs: [] }
    } catch (error: any) {
      this.addLog(`❌ Failed to disconnect Feishu: ${error.message}`)
      return { success: false, logs: [error.message] }
    }
  }

  // Line Methods
  async checkLineStatus(): Promise<{ connected: boolean }> {
    try {
      const { app } = await import('electron')
      const fs = await import('fs/promises')
      const pathMod = await import('path')

      const configPath = pathMod.join(app.getPath('home'), '.openclaw', 'openclaw.json')
      try {
        const data = await fs.readFile(configPath, 'utf8')
        const config = JSON.parse(data)
        const token = config?.channels?.line?.channelAccessToken
        if (token && token.trim()) {
          return { connected: true }
        }
      } catch {
        // Config doesn't exist or can't be parsed
      }
      return { connected: false }
    } catch {
      return { connected: false }
    }
  }

  async connectLine(channelAccessToken: string, channelSecret: string): Promise<{ success: boolean; error?: string }> {
    try {
      this.addLog('🟢 Connecting LINE...')

      const { app } = await import('electron')
      const fs = await import('fs/promises')
      const pathMod = await import('path')

      const configPath = pathMod.join(app.getPath('home'), '.openclaw', 'openclaw.json')
      let config: any = {}
      try {
        const data = await fs.readFile(configPath, 'utf8')
        config = JSON.parse(data)
      } catch {
        // Start fresh if config doesn't exist
      }

      if (!config.channels) config.channels = {}
      config.channels.line = {
        enabled: true,
        channelAccessToken: channelAccessToken.trim(),
        channelSecret: channelSecret.trim(),
      }

      await fs.writeFile(configPath, JSON.stringify(config, null, 2))
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

      const { app } = await import('electron')
      const fs = await import('fs/promises')
      const pathMod = await import('path')

      const configPath = pathMod.join(app.getPath('home'), '.openclaw', 'openclaw.json')
      try {
        const data = await fs.readFile(configPath, 'utf8')
        const config = JSON.parse(data)
        if (config?.channels?.line) {
          delete config.channels.line
          await fs.writeFile(configPath, JSON.stringify(config, null, 2))
        }
      } catch { /* ignore */ }

      this.addLog('✅ LINE disconnected successfully')
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
      const sanitizedAgentName = agentName
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')

      const { app } = require('electron')
      const homeDir = app.getPath('home')
      const workspaceDir = config.workspace || path.join(homeDir, '.openclaw', 'workspace', sanitizedAgentName)

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
    if (!openclawConfig.agents.list) openclawConfig.agents.list = []

    // Find or create the agent entry
    let agentEntry = openclawConfig.agents.list.find((a: any) => a.id === agentId)
    if (!agentEntry) {
      agentEntry = { id: agentId }
      openclawConfig.agents.list.push(agentEntry)
    }

    // Per-agent model
    if (config.model) {
      if (!agentEntry.model) agentEntry.model = {}
      agentEntry.model.primary = config.model
      // Also set global default for backward compat
      openclawConfig.agents.defaults.model.primary = config.model
    }

    // Per-agent fallbacks
    if (config.fallbacks !== undefined) {
      if (!agentEntry.model) agentEntry.model = {}
      agentEntry.model.fallbacks = config.fallbacks
      openclawConfig.agents.defaults.model.fallbacks = config.fallbacks
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

      // Use OpenClaw CLI to delete the agent with --force flag to skip confirmation
      await this.executeOpenClawCommand([
        'agents', 'delete',
        '--force',
        agentId
      ])

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
      const agentEntry = openclawConfig.agents?.list?.find((a: any) => a.id === agentId)
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

  destroy() {
    if (this.sessionCleanupTimer) {
      clearInterval(this.sessionCleanupTimer)
      this.sessionCleanupTimer = null
    }
    this.cleanupWhatsAppSession()
  }
}