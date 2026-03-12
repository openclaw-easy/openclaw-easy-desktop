import { app, shell, BrowserWindow, ipcMain, Menu, Tray, nativeImage, session } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, statSync, renameSync, appendFileSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icons/icon.png?asset'
import lobsterIcon from '../../resources/icons/lobster-emoji.png?asset'
import lobsterDockIcon from '../../resources/icons/lobster-dock.png?asset'
import { registerMacHandlers, setupMacDockIcon } from './index-mac.js'
import { registerWindowsHandlers } from './index-windows.js'
import { OpenClawManager } from './openclaw-manager.js'
import { ConfigManager, AppProviderConfig } from './managers/config-manager'
import { ModelManager } from './model-manager.js'
import { EnvironmentManager } from './environment-manager.js'
import { ToolsManager } from './tools-manager.js'
import { SettingsManager } from './managers/settings-manager.js'
import { SessionManager } from './managers/session-manager.js'
import { WorkspaceManager } from './managers/workspace-manager'
import { SttManager } from './managers/stt-manager'
import { WhisperServerManager } from './managers/whisper-server-manager'
import { TelemetryManager } from './managers/telemetry-manager'

// Simple semver comparison: returns true if `latest` is strictly newer than `current`
function isNewerVersion(latest: string, current: string): boolean {
  const a = latest.split('.').map(Number)
  const b = current.split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false
  }
  return false
}

// Set app name as early as possible — before any async work or class construction.
// This controls the macOS dock tooltip and Windows taskbar label in both dev and
// production. Calling it here (module scope) ensures it fires before whenReady().
app.setName('Openclaw Easy')

// Global terminal processes storage
declare global {
  var terminals: Record<string, any>
}

// ── File logging ─────────────────────────────────────────────────────────────
// Intercepts console.log/error/warn and writes timestamped lines to
//   <app.getPath('logs')>/main.log
// On Windows: C:\Users\<user>\AppData\Roaming\Openclaw Easy\logs\main.log
// On macOS:   ~/Library/Logs/Openclaw Easy/main.log
function setupFileLogging() {
  let logFile: string
  try {
    const logsDir = app.getPath('logs')
    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true })
    }
    logFile = join(logsDir, 'main.log')

    // Rotate if larger than 5 MB
    try {
      if (existsSync(logFile) && statSync(logFile).size > 5 * 1024 * 1024) {
        renameSync(logFile, join(logsDir, 'main.old.log'))
      }
    } catch { /* ignore rotation errors */ }

    appendFileSync(logFile, `\n--- App started ${new Date().toISOString()} ---\n`)
    console.log(`[FileLogging] Writing logs to: ${logFile}`)
  } catch {
    return // If we can't open the log file, don't break the app
  }

  const write = (level: string, args: unknown[]) => {
    try {
      const line = `[${new Date().toISOString()}] [${level}] ${args.map(a =>
        typeof a === 'string' ? a : JSON.stringify(a)
      ).join(' ')}\n`
      appendFileSync(logFile, line)
    } catch { /* ignore write errors */ }
  }

  const origLog   = console.log.bind(console)
  const origError = console.error.bind(console)
  const origWarn  = console.warn.bind(console)

  console.log   = (...args) => { origLog(...args);   write('LOG',   args) }
  console.error = (...args) => { origError(...args); write('ERROR', args) }
  console.warn  = (...args) => { origWarn(...args);  write('WARN',  args) }
}

class OpenclawEasyApp {
  private mainWindow: BrowserWindow | null = null
  private tray: Tray | null = null
  private isQuitting: boolean = false
  private openClawManager: OpenClawManager
  private configManager: ConfigManager
  private modelManager: ModelManager
  private environmentManager: EnvironmentManager
  private toolsManager: ToolsManager
  private settingsManager: SettingsManager
  private sessionManager: SessionManager
  private workspaceManager: WorkspaceManager
  private sttManager: SttManager
  private whisperServerManager: WhisperServerManager
  private telemetryManager: TelemetryManager

  constructor() {
    this.openClawManager = new OpenClawManager()
    this.configManager = new ConfigManager()
    this.modelManager = new ModelManager()
    this.environmentManager = new EnvironmentManager()
    const configPath = join(app.getPath('home'), '.openclaw', 'openclaw.json')
    this.toolsManager = new ToolsManager(configPath)
    this.settingsManager = new SettingsManager()
    this.sessionManager = new SessionManager(this.openClawManager.getCommandExecutor())
    this.workspaceManager = new WorkspaceManager()
    this.sttManager = new SttManager()
    this.whisperServerManager = new WhisperServerManager()
    this.telemetryManager = new TelemetryManager(this.configManager)
  }

  async initialize() {
    await app.whenReady()

    // Set up file logging as early as possible so all subsequent logs are captured
    setupFileLogging()

    // Set app user model id for windows
    electronApp.setAppUserModelId('com.openclaw-easy.app')

    // macOS dev dock icon — handled in index-mac.ts
    if (process.platform === 'darwin' && is.dev) {
      setupMacDockIcon(lobsterDockIcon)
    }

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    this.createMainWindow()
    this.createTray()
    this.setupIPCHandlers()

    // Initialize environment variables based on current configuration
    await this.initializeEnvironment()

    // Fix stale per-agent model overrides that don't match the current global provider
    await this.configManager.syncAgentModelsWithDefault()

    // Apply startup settings (start on boot, etc.)
    await this.settingsManager.applyStartupSettings()

    // Start periodic telemetry snapshots
    this.telemetryManager.start()

    // Gateway is started manually by the user via "Launch assistant" button

    // Track when app is quitting to distinguish from minimize-to-tray
    app.on('before-quit', () => {
      this.isQuitting = true
      this.telemetryManager.stop()
    })

    app.on('activate', () => {
      // On macOS, re-create a window when dock icon is clicked
      if (BrowserWindow.getAllWindows().length === 0) {
        this.createMainWindow()
      } else {
        this.mainWindow?.show()
      }
    })
  }

  private createMainWindow() {
    // Create the browser window
    this.mainWindow = new BrowserWindow({
      width: 1320,
      height: 800,
      minWidth: 990,
      minHeight: 600,
      show: false,
      autoHideMenuBar: true,
      frame: false,
      transparent: false,
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
      trafficLightPosition: process.platform === 'darwin' ? { x: 20, y: 20 } : undefined,
      icon: nativeImage.createFromPath(icon),
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'),
        sandbox: false,
        contextIsolation: true,
        enableRemoteModule: false,
        nodeIntegration: false
      }
    })

    // Allow media permissions (microphone, camera) so getUserMedia works in the renderer
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      const allowed = ['media', 'mediaKeySystem', 'clipboard-read', 'clipboard-sanitized-write']
      callback(allowed.includes(permission))
    })

    // Pass mainWindow reference to managers for IPC events
    this.openClawManager.setMainWindow(this.mainWindow)
    this.whisperServerManager.setMainWindow(this.mainWindow)

    this.mainWindow.on('ready-to-show', () => {
      this.mainWindow?.show()

      // Delayed update check (let UI fully load first)
      setTimeout(async () => {
        const checkForUpdate = async () => {
          const settings = await this.settingsManager.getSettings()
          if (!settings.autoUpdate) return
          const response = await fetch('https://openclaw-easy.com/downloads/latest.json')
          const data = await response.json()
          const current = app.getVersion()
          if (isNewerVersion(data.version, current)) {
            this.mainWindow?.webContents.send('app:update-available', {
              hasUpdate: true,
              currentVersion: current,
              latestVersion: data.version,
              releaseDate: data.releaseDate,
              downloads: data.downloads,
            })
          }
        }

        try {
          await checkForUpdate()
        } catch {
          // Retry once after 30s on failure
          console.warn('[App] Update check failed, retrying in 30s...')
          setTimeout(async () => {
            try {
              await checkForUpdate()
            } catch {
              console.warn('[App] Update check retry failed')
              this.mainWindow?.webContents.send('app:update-check-failed')
            }
          }, 30000)
        }
      }, 5000)
    })

    // Handle window close - respect minimize-to-tray setting.
    // IMPORTANT: event.preventDefault() must be called synchronously —
    // an async handler defers it past the event dispatch, so the window
    // closes before preventDefault takes effect (especially on Windows).
    this.mainWindow.on('close', (event) => {
      if (!this.isQuitting && this.settingsManager.getMinimizeToTraySync()) {
        event.preventDefault()
        this.mainWindow?.hide()
      }
    })

    this.mainWindow.on('closed', () => {
      // Kill all orphaned terminal PTY processes
      if (global.terminals) {
        for (const [id, pty] of Object.entries(global.terminals)) {
          try { (pty as any).kill(); } catch {}
        }
        global.terminals = {}
      }
      this.openClawManager.setMainWindow(null)
      this.whisperServerManager.setMainWindow(null)
      this.mainWindow = null
    })

    this.mainWindow.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    // HMR for renderer based on electron-vite cli.
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      this.mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
  }

  private createTray() {
    // Use the red lobster icon for the menu bar, resized to 22x22 for macOS
    const trayIconImage = nativeImage.createFromPath(lobsterIcon).resize({ width: 22, height: 22 })
    this.tray = new Tray(trayIconImage)

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '🦞 Openclaw Easy',
        type: 'normal',
        enabled: false
      },
      { type: 'separator' },
      {
        label: 'Open Dashboard',
        type: 'normal',
        click: () => {
          if (this.mainWindow) {
            this.mainWindow.show()
            this.mainWindow.focus()
          } else {
            this.createMainWindow()
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Start Assistant',
        type: 'normal',
        click: async () => {
          await this.openClawManager.start()
        }
      },
      {
        label: 'Stop Assistant',
        type: 'normal',
        click: async () => {
          await this.openClawManager.stop()
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        type: 'normal',
        click: () => {
          app.quit()
        }
      }
    ])

    this.tray.setToolTip('Openclaw Easy - AI Assistant Manager')
    this.tray.setContextMenu(contextMenu)

    this.tray.on('double-click', () => {
      if (this.mainWindow) {
        this.mainWindow.show()
        this.mainWindow.focus()
      } else {
        this.createMainWindow()
      }
    })
  }

  private setupIPCHandlers() {
    // OpenClaw process management
    ipcMain.handle('openclaw:start', async () => {
      return await this.openClawManager.start()
    })

    ipcMain.handle('openclaw:stop', async () => {
      return await this.openClawManager.stop()
    })

    ipcMain.handle('openclaw:status', async () => {
      const status = this.openClawManager.getStatus()
      return {
        isRunning: status === 'running',
        port: this.openClawManager.getActivePort(),
        uptime: status === 'running' ? 60 : undefined, // Mock uptime for demo
        version: '1.0.0'
      }
    })

    ipcMain.handle('openclaw:logs', async () => {
      return this.openClawManager.getLogs()
    })

    // NEW: OpenClaw management functions
    ipcMain.handle('openclaw:get-installations', async () => {
      return await this.openClawManager.getOpenClawInstallations()
    })

    ipcMain.handle('openclaw:uninstall', async (_, installPath, installMethod) => {
      return await this.openClawManager.uninstallOpenClaw(installPath, installMethod)
    })

    ipcMain.handle('openclaw:install', async (_, installType) => {
      return await this.openClawManager.installOpenClaw(installType)
    })

    ipcMain.handle('openclaw:check-updates', async () => {
      return await this.openClawManager.checkOpenClawUpdates()
    })

    ipcMain.handle('openclaw:setup', async () => {
      return await this.openClawManager.setupOpenClaw()
    })

    ipcMain.handle('openclaw:restart', async () => {
      return await this.openClawManager.restart()
    })

    // Gateway API handlers for native dashboard
    ipcMain.handle('gateway:status', async () => {
      return this.openClawManager.getStatus()
    })

    ipcMain.handle('gateway:info', async () => {
      return {
        status: this.openClawManager.getStatus(),
        port: this.openClawManager.getActivePort(),
        version: '2026.1.30 (Embedded)',
        uptime: 'N/A' // TODO: Track actual uptime
      }
    })

    ipcMain.handle('gateway:channels', async () => {
      return await this.openClawManager.listChannels()
    })

    ipcMain.handle('gateway:agents', async () => {
      return await this.openClawManager.listAgents()
    })

    ipcMain.handle('gateway:get-token', async () => {
      try {
        const fs = require('fs').promises
        const path = require('path')
        const os = require('os')
        const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
        const configData = await fs.readFile(configPath, 'utf8')
        const config = JSON.parse(configData)
        return config?.gateway?.auth?.token || null
      } catch (error) {
        console.error('[Gateway] Failed to read gateway token:', error)
        return null
      }
    })

    // Ed25519 device identity for gateway auth (renderer lacks Web Crypto Ed25519 in Electron 28)
    ipcMain.handle('device:build-identity', async (_, opts: {
      clientId: string; clientMode: string; role: string;
      scopes: string[]; token: string; nonce: string;
    }) => {
      try {
        const nodeCrypto = require('crypto')
        const fs = require('fs').promises
        const path = require('path')
        const os = require('os')
        const keyPath = path.join(os.homedir(), '.openclaw', 'desktop_device_key.json')

        let privateKeyPem: string
        let publicKeyRaw: Buffer

        // Load existing key or generate a new one
        try {
          const stored = JSON.parse(await fs.readFile(keyPath, 'utf8'))
          privateKeyPem = stored.privateKeyPem
          publicKeyRaw = Buffer.from(stored.publicKeyHex, 'hex')
        } catch {
          const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync('ed25519', {
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
            publicKeyEncoding: { type: 'spki', format: 'der' }
          })
          // Raw 32-byte public key is the last 32 bytes of the 44-byte SPKI DER
          publicKeyRaw = publicKey.slice(-32)
          privateKeyPem = privateKey
          await fs.writeFile(keyPath, JSON.stringify({
            privateKeyPem,
            publicKeyHex: publicKeyRaw.toString('hex')
          }), { mode: 0o600 })
        }

        // Device ID = SHA-256 hex of raw public key bytes (matches gateway web UI)
        const deviceId = nodeCrypto.createHash('sha256').update(publicKeyRaw).digest('hex')
        const publicKey = publicKeyRaw.toString('base64')
          .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

        // Payload format matches gateway web UI Pp() function exactly:
        //   v1: "v1|deviceId|clientId|clientMode|role|scopes|signedAtMs|token"
        //   v2: "v2|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce"
        const signedAt = Date.now()
        const version = opts.nonce ? 'v2' : 'v1'
        const payloadParts = [
          version, deviceId, opts.clientId, opts.clientMode, opts.role,
          opts.scopes.join(','), signedAt.toString(), opts.token || ''
        ]
        if (version === 'v2') payloadParts.push(opts.nonce)
        const payloadStr = payloadParts.join('|')

        const sigBuffer = nodeCrypto.sign(null, Buffer.from(payloadStr), privateKeyPem)
        const signature = sigBuffer.toString('base64')
          .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

        return { id: deviceId, publicKey, signature, signedAt, nonce: opts.nonce }
      } catch (error) {
        console.error('[Device] Failed to build device identity:', error)
        return null
      }
    })

    // Return the stable device ID (SHA-256 of Ed25519 public key) for backend API headers
    ipcMain.handle('device:get-id', async () => {
      try {
        const nodeCrypto = require('crypto')
        const fs = require('fs').promises
        const path = require('path')
        const os = require('os')
        const keyPath = path.join(os.homedir(), '.openclaw', 'desktop_device_key.json')

        let publicKeyRaw: Buffer
        try {
          const stored = JSON.parse(await fs.readFile(keyPath, 'utf8'))
          publicKeyRaw = Buffer.from(stored.publicKeyHex, 'hex')
        } catch {
          // Key doesn't exist yet — generate it (same logic as device:build-identity)
          const { publicKey } = nodeCrypto.generateKeyPairSync('ed25519', {
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
            publicKeyEncoding: { type: 'spki', format: 'der' }
          })
          publicKeyRaw = publicKey.slice(-32)
          // Don't persist here — device:build-identity will handle that on first gateway connect
        }

        return nodeCrypto.createHash('sha256').update(publicKeyRaw).digest('hex')
      } catch (error) {
        console.error('[Device] Failed to get device ID:', error)
        return null
      }
    })

    ipcMain.handle('gateway:get-port', async () => {
      try {
        const fs = require('fs').promises
        const path = require('path')
        const os = require('os')
        const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
        const configData = await fs.readFile(configPath, 'utf8')
        const config = JSON.parse(configData)
        return config?.gateway?.port || 18800
      } catch (error) {
        console.error('[Gateway] Failed to read gateway port:', error)
        return 18800
      }
    })

    // Channel management handlers using OpenClaw CLI
    ipcMain.handle('channels:list', async () => {
      return await this.openClawManager.listChannels()
    })

    ipcMain.handle('channels:status', async () => {
      return await this.openClawManager.getChannelStatus()
    })

    ipcMain.handle('channels:add-whatsapp', async (_, name) => {
      return await this.openClawManager.addWhatsAppChannel(name)
    })

    ipcMain.handle('channels:login-whatsapp', async () => {
      return await this.openClawManager.loginWhatsApp()
    })

    ipcMain.handle('channels:check-whatsapp-status', async () => {
      return await this.openClawManager.checkWhatsAppStatus()
    })

    ipcMain.handle('channels:check-telegram-status', async () => {
      return await this.openClawManager.checkTelegramStatus()
    })

    ipcMain.handle('channels:check-discord-status', async () => {
      return await this.openClawManager.checkDiscordStatus()
    })

    ipcMain.handle('channels:disconnect-whatsapp', async () => {
      return await this.openClawManager.disconnectWhatsApp()
    })

    ipcMain.handle('channels:disconnect-telegram', async () => {
      return await this.openClawManager.disconnectTelegram()
    })

    ipcMain.handle('channels:disconnect-discord', async () => {
      return await this.openClawManager.disconnectDiscord()
    })

    ipcMain.handle('channels:get-whatsapp-messages', async () => {
      return await this.openClawManager.getWhatsAppMessages()
    })

    // Configuration management
    ipcMain.handle('config:generate', async (_, config) => {
      return await this.openClawManager.generateConfig(config)
    })

    ipcMain.handle('config:validate-api-key', async (_, provider, apiKey) => {
      return await this.openClawManager.validateApiKey(provider, apiKey)
    })

    ipcMain.handle('config:exists', async () => {
      return await this.openClawManager.configExists()
    })

    // App config handlers for config store
    ipcMain.handle('config:get', async () => {
      try {
        return await this.configManager.getAppConfig()
      } catch (error) {
        console.error('Failed to get app config:', error)
        return null
      }
    })

    ipcMain.handle('config:save', async (_, config) => {
      try {
        const prev = await this.configManager.getAppConfig() || {}

        // Save desktop app config
        await this.configManager.saveAppConfig(config)

        // Detect any provider/model/key change that requires openclaw.json update
        const providerChanged = config.aiProvider !== prev.aiProvider
        const byokProviderChanged = config.byok?.provider !== prev.byok?.provider
        const byokModelChanged = config.byok?.model !== prev.byok?.model
        const byokKeyChanged =
          config.byok?.apiKeys?.google !== prev.byok?.apiKeys?.google ||
          config.byok?.apiKeys?.anthropic !== prev.byok?.apiKeys?.anthropic ||
          config.byok?.apiKeys?.openai !== prev.byok?.apiKeys?.openai
        const localModelChanged = config.local?.model !== prev.local?.model

        const needsRestart = providerChanged || byokProviderChanged ||
            byokModelChanged || byokKeyChanged || localModelChanged
        const needsConfigUpdate = needsRestart

        if (needsConfigUpdate) {
          console.log(`[Config] Applying provider config: ${config.aiProvider}`)

          await this.configManager.applyProviderToOpenClaw(config)
          console.log(`[Config] ✅ openclaw.json updated for provider: ${config.aiProvider}`)

          if (needsRestart && this.openClawManager.isRunning()) {
            console.log('[Config] Restarting gateway to apply new provider config...')
            await this.openClawManager.restart()
            console.log('[Config] Gateway restarted successfully')
          }
        }

        return { success: true }
      } catch (error) {
        console.error('Failed to save app config:', error)
        throw error
      }
    })

    // Speech-to-Text: receive audio from renderer, transcribe via configured provider.
    // Falls back to OpenAI (using BYOK key) or local Whisper when no STT config is saved.
    ipcMain.handle('stt:transcribe', async (_, audioBase64: string) => {
      try {
        const appConfig = await this.configManager.getAppConfig()
        let sttConfig = appConfig?.stt
        // Migrate legacy 'ollama' provider to 'local'
        if ((sttConfig as any)?.provider === 'ollama') {
          sttConfig = { ...sttConfig, provider: 'local' }
        }
        if (!sttConfig?.provider) {
          // Auto-detect: use OpenAI if a BYOK key exists, otherwise try local Whisper
          const byokOpenaiKey = appConfig?.byok?.apiKeys?.openai
          if (byokOpenaiKey) {
            sttConfig = { provider: 'openai', openaiApiKey: byokOpenaiKey }
          } else {
            sttConfig = { provider: 'local' }
          }
        }
        // When using local provider with no custom endpoint, use the managed server's port
        if (sttConfig.provider === 'local' && !sttConfig.localEndpoint && this.whisperServerManager.isRunning()) {
          sttConfig = { ...sttConfig, localEndpoint: `http://127.0.0.1:${this.whisperServerManager.getActivePort()}` }
        }
        const audioBuffer = Buffer.from(audioBase64, 'base64')
        console.log(`[STT] Transcribing ${audioBuffer.length} bytes via provider=${sttConfig.provider}`)
        const result = await this.sttManager.transcribe(audioBuffer, sttConfig)
        console.log('[STT] Result:', JSON.stringify(result).slice(0, 200))
        return result
      } catch (error: any) {
        console.error('[STT] Transcription failed:', error)
        return { success: false, error: error.message || 'Transcription failed' }
      }
    })

    // Whisper Server management
    ipcMain.handle('whisper-server:detect', async () => {
      try {
        return await this.whisperServerManager.detectInstallation()
      } catch (err: any) {
        console.error('[WhisperServer] detect IPC error:', err?.message || err)
        return { installed: false, canInstall: false, installerTool: null }
      }
    })

    ipcMain.handle('whisper-server:install', async () => {
      return await this.whisperServerManager.install()
    })

    ipcMain.handle('whisper-server:start', async (_, model?: string, port?: number) => {
      return await this.whisperServerManager.start(model, port)
    })

    ipcMain.handle('whisper-server:stop', async () => {
      await this.whisperServerManager.stop()
      return { success: true }
    })

    ipcMain.handle('whisper-server:status', async () => {
      return this.whisperServerManager.getStatus()
    })

    ipcMain.handle('config:set-api-key', async (_, provider, apiKey) => {
      return await this.openClawManager.setApiKey(provider, apiKey)
    })

    ipcMain.handle('config:get-api-key', async (_, provider) => {
      return await this.openClawManager.getApiKey(provider)
    })

    ipcMain.handle('config:update-openclaw', async (_, config) => {
      return await this.openClawManager.updateOpenClawConfig(config)
    })

    ipcMain.handle('config:get-openclaw', async () => {
      try {
        const fs = require('fs').promises
        const path = require('path')
        const os = require('os')
        const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')

        console.log(`[Config] Reading OpenClaw config from: ${configPath}`)
        const configContent = await fs.readFile(configPath, 'utf8')
        const config = JSON.parse(configContent)
        console.log(`[Config] Current model config:`, config.agents?.defaults?.model)

        return { success: true, config }
      } catch (error) {
        console.error('[Config] Failed to read OpenClaw config:', error)
        return { success: false, error: error.message }
      }
    })

    // Model management - Real Ollama integration
    ipcMain.handle('model:install', async (_, modelId, size) => {
      console.log(`[ModelManager] Installing model: ${modelId} (${size || 'default'})`)

      return await this.modelManager.installModel(modelId, (progress) => {
        // Send progress updates to renderer via the mainWindow
        if (this.mainWindow) {
          this.mainWindow.webContents.send('model:install-progress', progress)
        }
      })
    })

    // Duplicate handler removed - using the more comprehensive one below

    ipcMain.handle('model:list-installed', async () => {
      console.log('[ModelManager] Listing installed models')
      return await this.modelManager.listInstalledModels()
    })

    ipcMain.handle('model:list-available', async () => {
      console.log('[ModelManager] Listing available models')
      return await this.modelManager.listAvailableModels()
    })

    ipcMain.handle('model:remove', async (_, modelId) => {
      console.log(`[ModelManager] Removing model: ${modelId}`)
      return await this.modelManager.removeModel(modelId)
    })

    ipcMain.handle('model:validate', async (_, modelId) => {
      console.log(`[ModelManager] Validating model: ${modelId}`)
      return await this.modelManager.validateModel(modelId)
    })

    ipcMain.handle('model:get-info', async (_, modelId) => {
      console.log(`[ModelManager] Getting model info: ${modelId}`)
      return await this.modelManager.getModelInfo(modelId)
    })

    ipcMain.handle('model:storage-info', async () => {
      console.log('[ModelManager] Getting storage info')
      return await this.modelManager.getStorageInfo()
    })

    ipcMain.handle('model:check-ollama', async () => {
      console.log('[ModelManager] Checking Ollama availability')
      return await this.modelManager.checkOllamaAvailable()
    })

    ipcMain.handle('model:install-ollama', async () => {
      console.log('[ModelManager] Installing Ollama')
      return await this.modelManager.installOllama()
    })

    ipcMain.handle('model:open-folder', async () => {
      console.log('[ModelManager] Opening model folder')
      const { shell } = require('electron')
      const os = require('os')
      const path = require('path')

      // Ollama stores models in ~/.ollama/models on macOS/Linux
      const modelPath = path.join(os.homedir(), '.ollama', 'models')

      try {
        await shell.openPath(modelPath)
        return { success: true }
      } catch (error) {
        console.error('[ModelManager] Error opening model folder:', error)
        return { success: false, message: error.message }
      }
    })
    ipcMain.handle('model:start-ollama-detection', async () => {
      console.log('[ModelManager] Starting Ollama detection for Model Manager page')
      this.modelManager.startOllamaDetection()
      return { success: true }
    })
    ipcMain.handle('model:stop-ollama-detection', async () => {
      console.log('[ModelManager] Stopping Ollama detection for Model Manager page')
      this.modelManager.stopOllamaDetection()
      return { success: true }
    })

    ipcMain.handle('model:configure', async (_, modelId) => {
      console.log(`[ModelManager] === CONFIGURE MODEL DEBUG START ===`)
      console.log(`[ModelManager] Configuring model: ${modelId}`)
      const fs = require('fs').promises
      const path = require('path')
      const os = require('os')

      try {
        console.log('[ModelManager] Manually editing OpenClaw config file...')
        const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
        console.log(`[ModelManager] Config file path: ${configPath}`)

        // Read current config
        const configContent = await fs.readFile(configPath, 'utf8')
        const config = JSON.parse(configContent)
        console.log(`[ModelManager] Current model config:`, config.agents?.defaults?.model)

        // Since OpenClaw validation is very strict about the model object format,
        // let's try different approaches to find what works
        if (!config.agents) {config.agents = {}}
        if (!config.agents.defaults) {config.agents.defaults = {}}

        // Set model using the correct OpenClaw configuration format
        config.agents.defaults.model = {
          primary: `ollama/${modelId}`
        }
        console.log(`[ModelManager] Setting model object to:`, config.agents.defaults.model)

        // Ensure models.providers.ollama configuration exists as required by OpenClaw
        if (!config.models) {
          config.models = {}
        }
        if (!config.models.providers) {
          config.models.providers = {}
        }

        // Set up Ollama provider configuration based on official OpenClaw documentation
        config.models.providers.ollama = {
          baseUrl: "http://127.0.0.1:11434/v1",
          apiKey: "ollama-local",
          models: [
            {
              id: modelId,
              name: modelId.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
            }
          ]
        }
        console.log(`[ModelManager] Setting Ollama provider config:`, config.models.providers.ollama)

        // Update meta timestamp
        if (!config.meta) {config.meta = {}}
        config.meta.lastTouchedAt = new Date().toISOString()
        config.meta.lastTouchedVersion = "2026.2.1"

        // Write back using ConfigManager to ensure write lock is respected
        await this.configManager.writeConfig(config)
        console.log(`[ModelManager] Model configured: ollama/${modelId}`)

        // Update system environment variables after successful model configuration
        try {
          console.log('[ModelManager] Updating system environment variables...')
          await this.environmentManager.updateEnvironmentVariables()
          console.log('[ModelManager] Environment variables updated successfully')
        } catch (envError) {
          console.error('[ModelManager] Failed to update environment variables:', envError)
          // Don't fail the entire operation if env vars fail, just warn
        }

        return {
          success: true,
          message: `Successfully configured ${modelId} as the active model in OpenClaw. The model configuration has been saved to the OpenClaw config file.`
        }

      } catch (error) {
        console.error('[ModelManager] Failed to configure model via file editing:', error)
        console.error('[ModelManager] Error details:', error.message)
        return {
          success: false,
          message: `Failed to configure model: ${error.message}`
        }
      } finally {
        console.log(`[ModelManager] === CONFIGURE MODEL DEBUG END ===`)
      }
    })

    // System information
    ipcMain.handle('system:get-info', async () => {
      console.log('[System] Getting system information')
      const os = require('os')
      const fs = require('fs')

      try {
        // Get memory info
        const totalMemory = Math.round(os.totalmem() / (1024 * 1024 * 1024)) // Convert to GB
        const freeMemory = Math.round(os.freemem() / (1024 * 1024 * 1024))

        // Get CPU info
        const cpus = os.cpus()
        const cpuModel = cpus[0]?.model || 'Unknown CPU'

        // Get architecture
        const arch = os.arch()
        const platform = os.platform()

        // Get disk space (approximate for home directory)
        let diskSpace = 100 // Default fallback
        try {
          const stats = fs.statSync(os.homedir())
          // This is a rough approximation, actual disk space checking is platform-specific
          diskSpace = 250 // Reasonable default for modern systems
        } catch (error) {
          console.log('[System] Could not get disk space, using default')
        }

        const systemInfo = {
          ram: totalMemory,
          freeRam: freeMemory,
          cpu: cpuModel,
          arch: arch,
          platform: platform,
          disk: diskSpace,
          gpu: 'Integrated' // Default, would need platform-specific detection for actual GPU
        }

        console.log('[System] System info:', systemInfo)
        return systemInfo
      } catch (error) {
        console.error('[System] Error getting system info:', error)
        return {
          ram: 16, // Fallback
          freeRam: 8,
          cpu: 'Unknown',
          arch: 'x64',
          platform: 'darwin',
          disk: 250,
          gpu: 'Integrated'
        }
      }
    })

    // Settings management
    ipcMain.handle('settings:get', async () => {
      return await this.settingsManager.getSettings()
    })

    ipcMain.handle('settings:update', async (_, updates) => {
      return await this.settingsManager.updateSettings(updates)
    })

    ipcMain.handle('settings:set-start-on-boot', async (_, enabled) => {
      return await this.settingsManager.setStartOnBoot(enabled)
    })

    ipcMain.handle('settings:get-start-on-boot', async () => {
      return await this.settingsManager.getStartOnBootStatus()
    })

    ipcMain.handle('settings:set-minimize-to-tray', async (_, enabled) => {
      return await this.settingsManager.setMinimizeToTray(enabled)
    })

    ipcMain.handle('settings:set-auto-update', async (_, enabled) => {
      return await this.settingsManager.setAutoUpdate(enabled)
    })

    ipcMain.handle('settings:set-telemetry', async (_, enabled) => {
      return await this.settingsManager.setTelemetry(enabled)
    })

    ipcMain.handle('settings:set-language', async (_, language: string) => {
      return await this.settingsManager.setLanguage(language)
    })

    // Platform-specific handlers (permissions, etc.)
    if (process.platform === 'darwin') {
      registerMacHandlers(() => this.mainWindow)
    } else if (process.platform === 'win32') {
      registerWindowsHandlers(() => this.mainWindow)
    }

    // Channel setup
    ipcMain.handle('channels:whatsapp-qr', async () => {
      return await this.openClawManager.getWhatsAppQR()
    })

    ipcMain.handle('channels:whatsapp-start', async () => {
      console.log('Starting real WhatsApp setup with OpenClaw')
      try {
        // First ensure WhatsApp channel exists
        const addResult = await this.openClawManager.addWhatsAppChannel('WhatsApp')
        if (!addResult) {
          console.log('Failed to add WhatsApp channel, but continuing...')
        }

        // Get the QR code from the login process
        const qrResult = await this.openClawManager.getWhatsAppQRFromLogin()

        if (qrResult.success && qrResult.qrData) {
          // Convert ASCII QR to data URL for display
          // For now, return the ASCII data - we'll enhance this later
          console.log('QR Code extracted successfully')
          return qrResult.qrData
        } else {
          console.log('No QR code found, falling back to placeholder')
          // Return a placeholder indicating QR generation failed
          return 'QR_GENERATION_FAILED'
        }
      } catch (error) {
        console.error('WhatsApp setup error:', error)
        return 'QR_ERROR: ' + error.message
      }
    })

    ipcMain.handle('channels:test-telegram', async (_, token) => {
      return await this.openClawManager.testTelegram(token)
    })

    ipcMain.handle('channels:connect-telegram', async (_, token, name) => {
      console.log(`Connecting Telegram with token: ${token.slice(0, 10)}...`)
      return await this.openClawManager.connectTelegram(token, name)
    })

    ipcMain.handle('channels:test-discord', async (_, token) => {
      return await this.openClawManager.testDiscord(token)
    })

    ipcMain.handle('channels:connect-discord', async (_, token, serverId, name) => {
      console.log(`Connecting Discord bot to server: ${serverId}`)
      return await this.openClawManager.connectDiscord(token, serverId, name)
    })

    // Slack channel management
    ipcMain.handle('channels:check-slack-status', async () => {
      return await this.openClawManager.checkSlackStatus()
    })

    ipcMain.handle('channels:test-slack', async (_, botToken) => {
      return await this.openClawManager.testSlack(botToken)
    })

    ipcMain.handle('channels:connect-slack', async (_, botToken, appToken, name) => {
      console.log(`Connecting Slack bot token: ${botToken.slice(0, 10)}...`)
      return await this.openClawManager.connectSlack(botToken, appToken, name)
    })

    ipcMain.handle('channels:disconnect-slack', async () => {
      return await this.openClawManager.disconnectSlack()
    })

    // Feishu channel management
    ipcMain.handle('channels:check-feishu-status', async () => {
      return await this.openClawManager.checkFeishuStatus()
    })

    ipcMain.handle('channels:connect-feishu', async (_, appId, appSecret, botName) => {
      return await this.openClawManager.connectFeishu(appId, appSecret, botName)
    })

    ipcMain.handle('channels:disconnect-feishu', async () => {
      return await this.openClawManager.disconnectFeishu()
    })

    // Line channel management
    ipcMain.handle('channels:check-line-status', async () => {
      return await this.openClawManager.checkLineStatus()
    })

    ipcMain.handle('channels:connect-line', async (_, channelAccessToken, channelSecret) => {
      return await this.openClawManager.connectLine(channelAccessToken, channelSecret)
    })

    ipcMain.handle('channels:disconnect-line', async () => {
      return await this.openClawManager.disconnectLine()
    })

    // Agent Management
    ipcMain.handle('agents:list', async () => {
      return await this.openClawManager.listAgents()
    })

    ipcMain.handle('agents:get-info', async (_, agentId) => {
      return await this.openClawManager.getAgentInfo(agentId)
    })

    ipcMain.handle('agents:create', async (_, agentName, config) => {
      console.log(`Creating agent: ${agentName}`)
      return await this.openClawManager.createAgent(agentName, config)
    })

    ipcMain.handle('agents:update', async (_, agentId, config) => {
      console.log(`Updating agent: ${agentId}`)
      const result = await this.openClawManager.updateAgent(agentId, config)

      // Restart the gateway when the primary model changes.
      // The gateway reads agents.defaults.model.primary only at startup — it is NOT hot-reloaded.
      if (result.success && config.model && config.model !== result.prevModel) {
        console.log(`[Agents] Primary model changed to ${config.model} — restarting gateway`)
        if (this.openClawManager.isRunning()) {
          await this.openClawManager.restart()
        }
      }

      return result
    })

    ipcMain.handle('agents:delete', async (_, agentId) => {
      console.log(`Deleting agent: ${agentId}`)
      return await this.openClawManager.deleteAgent(agentId)
    })

    // System integration
    ipcMain.handle('system:open-external', async (_, url) => {
      // Only allow http(s) URLs to prevent javascript:, file://, data: exploits
      if (typeof url !== 'string') return
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          console.warn(`[OpenclawApp] Blocked openExternal for unsafe protocol: ${parsed.protocol}`)
          return
        }
      } catch {
        console.warn(`[OpenclawApp] Blocked openExternal for invalid URL: ${url}`)
        return
      }
      await shell.openExternal(url)
    })

    ipcMain.handle('system:show-in-folder', async (_, path) => {
      shell.showItemInFolder(path)
    })

    // Skills management
    ipcMain.handle('skills:list', async () => {
      console.log('[Skills] Listing skills')
      return await this.openClawManager.listSkills()
    })

    ipcMain.handle('skills:check', async () => {
      console.log('[Skills] Checking skills status')
      return await this.openClawManager.checkSkills()
    })

    ipcMain.handle('skills:info', async (_, skillName) => {
      console.log(`[Skills] Getting info for skill: ${skillName}`)
      return await this.openClawManager.getSkillInfo(skillName)
    })

    ipcMain.handle('skills:install', async (_, skillName) => {
      console.log(`[Skills] Installing requirements for skill: ${skillName}`)
      return await this.openClawManager.installSkillRequirements(skillName)
    })

    ipcMain.handle('skills:set-enabled', async (_, skillName, enabled) => {
      console.log(`[Skills] Setting skill "${skillName}" enabled=${enabled}`)
      return await this.openClawManager.setSkillEnabled(skillName, enabled)
    })

    ipcMain.handle('skills:search-registry', async (_, query) => {
      console.log(`[Skills] Searching registry: query="${query}"`)
      return await this.openClawManager.searchSkillRegistry(query)
    })

    ipcMain.handle('skills:install-from-registry', async (_, slug) => {
      console.log(`[Skills] Installing from registry: ${slug}`)
      return await this.openClawManager.installSkillFromRegistry(slug)
    })

    ipcMain.handle('skills:remove', async (_, skillName) => {
      console.log(`[Skills] Removing skill: ${skillName}`)
      return await this.openClawManager.removeSkill(skillName)
    })

    ipcMain.handle('skills:list-workspace', async () => {
      return await this.openClawManager.listWorkspaceSkills()
    })

    ipcMain.handle('skills:open-folder', async (_, skillName: string) => {
      if (!skillName || !/^[a-zA-Z0-9_.-]+$/.test(skillName)) {
        return { success: false, error: 'Invalid skill name' }
      }
      const { access, readdir, readFile } = await import('fs/promises')
      const os = await import('os')
      const p = await import('path')
      const skillsDir = p.join(os.homedir(), '.openclaw', 'skills')

      // 1. Direct match: directory name equals skill name
      const directPath = p.join(skillsDir, skillName)
      try {
        await access(directPath)
        shell.openPath(directPath)
        return { success: true }
      } catch {}

      // 2. Scan directories and match by SKILL.md name: field
      //    (skill name in SKILL.md often differs from the directory slug)
      try {
        const entries = await readdir(skillsDir, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          try {
            const md = await readFile(p.join(skillsDir, entry.name, 'SKILL.md'), 'utf8')
            const m = md.match(/^name:\s*(.+)$/m)
            if (m && m[1].trim() === skillName) {
              shell.openPath(p.join(skillsDir, entry.name))
              return { success: true }
            }
          } catch {}
        }
      } catch {}

      // 3. Bundled extensions dir
      const extDir = process.env.OPENCLAW_BUNDLED_PLUGINS_DIR
      if (extDir) {
        const extPath = p.join(extDir, 'skills', skillName)
        try {
          await access(extPath)
          shell.openPath(extPath)
          return { success: true }
        } catch {}
      }
      return { success: false, error: `Could not find folder for skill: ${skillName}` }
    })

    // Hooks management
    ipcMain.handle('hooks:list', async () => {
      console.log('[Hooks] Listing hooks')
      return await this.openClawManager.listHooks()
    })

    ipcMain.handle('hooks:check', async () => {
      console.log('[Hooks] Checking hooks status')
      return await this.openClawManager.checkHooks()
    })

    ipcMain.handle('hooks:info', async (_, hookName) => {
      console.log(`[Hooks] Getting info for hook: ${hookName}`)
      return await this.openClawManager.getHookInfo(hookName)
    })

    ipcMain.handle('hooks:set-enabled', async (_, hookName, enabled) => {
      console.log(`[Hooks] Setting hook "${hookName}" enabled=${enabled}`)
      return await this.openClawManager.setHookEnabled(hookName, enabled)
    })

    ipcMain.handle('hooks:install', async (_, hookSpec) => {
      console.log(`[Hooks] Installing hook: ${hookSpec}`)
      return await this.openClawManager.installHook(hookSpec)
    })

    // Plugins management
    ipcMain.handle('plugins:list', async () => {
      console.log('[Plugins] Listing plugins')
      return await this.openClawManager.listPlugins()
    })

    ipcMain.handle('plugins:info', async (_, pluginId: string) => {
      console.log(`[Plugins] Getting info for plugin: ${pluginId}`)
      return await this.openClawManager.getPluginInfo(pluginId)
    })

    ipcMain.handle('plugins:enable', async (_, pluginId: string) => {
      console.log(`[Plugins] Enabling plugin: ${pluginId}`)
      return await this.openClawManager.enablePlugin(pluginId)
    })

    ipcMain.handle('plugins:disable', async (_, pluginId: string) => {
      console.log(`[Plugins] Disabling plugin: ${pluginId}`)
      return await this.openClawManager.disablePlugin(pluginId)
    })

    ipcMain.handle('plugins:install', async (_, pluginSpec: string) => {
      console.log(`[Plugins] Installing plugin: ${pluginSpec}`)
      return await this.openClawManager.installPlugin(pluginSpec)
    })

    ipcMain.handle('plugins:update', async (_, pluginId: string) => {
      console.log(`[Plugins] Updating plugin: ${pluginId}`)
      return await this.openClawManager.updatePlugin(pluginId)
    })

    ipcMain.handle('plugins:doctor', async () => {
      console.log('[Plugins] Running plugins doctor')
      return await this.openClawManager.runPluginsDoctor()
    })

    // Cron management
    ipcMain.handle('cron:list', async () => {
      console.log('[Cron] Listing cron jobs')
      return await this.openClawManager.listCronJobs()
    })

    ipcMain.handle('cron:add', async (_, params) => {
      console.log('[Cron] Adding cron job:', params?.name)
      return await this.openClawManager.addCronJob(params)
    })

    ipcMain.handle('cron:enable', async (_, id: string) => {
      console.log('[Cron] Enabling cron job:', id)
      return await this.openClawManager.enableCronJob(id)
    })

    ipcMain.handle('cron:disable', async (_, id: string) => {
      console.log('[Cron] Disabling cron job:', id)
      return await this.openClawManager.disableCronJob(id)
    })

    ipcMain.handle('cron:remove', async (_, id: string) => {
      console.log('[Cron] Removing cron job:', id)
      return await this.openClawManager.removeCronJob(id)
    })

    ipcMain.handle('cron:run', async (_, id: string) => {
      console.log('[Cron] Running cron job now:', id)
      return await this.openClawManager.runCronJob(id)
    })

    ipcMain.handle('cron:runs', async (_, id: string, limit?: number) => {
      console.log('[Cron] Getting runs for cron job:', id)
      return await this.openClawManager.getCronRuns(id, limit)
    })

    // Doctor management
    ipcMain.handle('doctor:run', async () => {
      console.log('[Doctor] Running OpenClaw doctor')
      return await this.openClawManager.runDoctor()
    })

    // Tools configuration management
    ipcMain.handle('tools:get-config', async () => {
      console.log('[Tools] Getting tools configuration')
      return await this.toolsManager.getConfig()
    })

    ipcMain.handle('tools:set-profile', async (_, profile: string) => {
      console.log('[Tools] Setting profile:', profile)
      return await this.toolsManager.setProfile(profile as any)
    })

    ipcMain.handle('tools:set-exec-host', async (_, host: string, applyToAllAgents?: boolean) => {
      console.log('[Tools] Setting exec host:', host, 'applyToAllAgents:', applyToAllAgents)
      return await this.toolsManager.setExecHost(host as any, applyToAllAgents)
    })

    ipcMain.handle('tools:set-exec-security', async (_, security: string, applyToAllAgents?: boolean) => {
      console.log('[Tools] Setting exec security:', security, 'applyToAllAgents:', applyToAllAgents)
      return await this.toolsManager.setExecSecurity(security as any, applyToAllAgents)
    })

    ipcMain.handle('tools:set-safe-bins', async (_, bins: string[]) => {
      console.log('[Tools] Setting safe bins:', bins.length, 'items')
      return await this.toolsManager.setSafeBins(bins)
    })

    ipcMain.handle('tools:set-web-search', async (_, enabled: boolean) => {
      console.log('[Tools] Setting web search enabled:', enabled)
      return await this.toolsManager.setWebSearchEnabled(enabled)
    })

    ipcMain.handle('tools:set-web-fetch', async (_, enabled: boolean) => {
      console.log('[Tools] Setting web fetch enabled:', enabled)
      return await this.toolsManager.setWebFetchEnabled(enabled)
    })

    ipcMain.handle('tools:allow-tool', async (_, tool: string) => {
      console.log('[Tools] Allowing tool:', tool)
      return await this.toolsManager.allowTool(tool)
    })

    ipcMain.handle('tools:deny-tool', async (_, tool: string) => {
      console.log('[Tools] Denying tool:', tool)
      return await this.toolsManager.denyTool(tool)
    })

    ipcMain.handle('tools:allow-group', async (_, group: string) => {
      console.log('[Tools] Allowing tool group:', group)
      return await this.toolsManager.allowToolGroup(group)
    })

    ipcMain.handle('tools:deny-group', async (_, group: string) => {
      console.log('[Tools] Denying tool group:', group)
      return await this.toolsManager.denyToolGroup(group)
    })

    ipcMain.handle('tools:update-config', async (_, updates: any, applyToAllAgents?: boolean) => {
      console.log('[Tools] Updating config:', Object.keys(updates), 'applyToAllAgents:', applyToAllAgents)
      return await this.toolsManager.updateConfig(updates, applyToAllAgents)
    })

    ipcMain.handle('tools:reconfigure-exec-approvals', async () => {
      console.log('[Tools] Reconfiguring exec approvals')
      return await this.toolsManager.reconfigureExecApprovals()
    })

    // Statistics
    ipcMain.handle('dashboard:get-statistics', async () => {
      console.log('[Dashboard] Getting statistics')
      return await this.openClawManager.getDashboardStatistics()
    })

    // Session Management
    ipcMain.handle('sessions:list', async (_, agentId, activeMinutes) => {
      console.log('[Sessions] Listing sessions')
      return await this.sessionManager.listSessions(agentId, activeMinutes)
    })

    ipcMain.handle('sessions:get', async (_, sessionKey) => {
      console.log('[Sessions] Getting session:', sessionKey)
      return await this.sessionManager.getSessionDetails(sessionKey)
    })

    ipcMain.handle('sessions:create-new', async (_, agentId) => {
      console.log('[Sessions] Creating new session')
      return await this.sessionManager.createNewSession(agentId)
    })

    ipcMain.handle('sessions:reset', async (_, agentId) => {
      console.log('[Sessions] Resetting session')
      return await this.sessionManager.resetSession(agentId)
    })

    ipcMain.handle('sessions:delete', async (_, sessionKey, agentId) => {
      console.log('[Sessions] Deleting session:', sessionKey)
      return await this.sessionManager.deleteSession(sessionKey, agentId)
    })

    // Agent Binding Management
    ipcMain.handle('agent-bindings:list', async () => {
      console.log('[AgentBindings] Listing agent bindings')
      return await this.openClawManager.listAgentBindings()
    })

    ipcMain.handle('agent-bindings:add', async (_, binding: any) => {
      console.log('[AgentBindings] Adding agent binding:', binding)
      return await this.openClawManager.addAgentBinding(binding)
    })

    ipcMain.handle('agent-bindings:remove', async (_, agentId: string, channel: string) => {
      console.log('[AgentBindings] Removing agent binding:', { agentId, channel })
      return await this.openClawManager.removeAgentBinding(agentId, channel)
    })

    ipcMain.handle('agent-bindings:update', async (_, bindings: any[]) => {
      console.log('[AgentBindings] Updating agent bindings:', bindings.length)
      return await this.openClawManager.updateAgentBindings(bindings)
    })

    ipcMain.handle('agent-bindings:test-routing', async (_, params: any) => {
      console.log('[AgentBindings] Testing routing:', params)
      return await this.openClawManager.testAgentRouting(params)
    })

    ipcMain.handle('session-config:get', async () => {
      console.log('[SessionConfig] Getting session configuration')
      return await this.openClawManager.getSessionConfig()
    })

    ipcMain.handle('session-config:update', async (_, config: any) => {
      console.log('[SessionConfig] Updating session configuration:', config)
      return await this.openClawManager.updateSessionConfig(config)
    })

    // Workspace file management
    ipcMain.handle('workspace:list', async () => {
      return await this.workspaceManager.listFiles()
    })

    ipcMain.handle('workspace:read', async (_, name: string) => {
      return await this.workspaceManager.readFile(name)
    })

    ipcMain.handle('workspace:write', async (_, name: string, content: string) => {
      return await this.workspaceManager.writeFile(name, content)
    })

    ipcMain.handle('workspace:create', async (_, name: string) => {
      return await this.workspaceManager.createFile(name)
    })

    ipcMain.handle('workspace:delete', async (_, name: string) => {
      return await this.workspaceManager.deleteFile(name)
    })

    ipcMain.handle('workspace:list-memory', async () => {
      return await this.workspaceManager.listMemoryFiles()
    })

    ipcMain.handle('workspace:read-memory', async (_, name: string) => {
      return await this.workspaceManager.readMemoryFile(name)
    })

    // Terminal management for onboarding wizard
    // Spawns OpenClaw from the embedded source — always bypasses any globally installed openclaw
    ipcMain.handle('terminal:create-openclaw', async (_, args: string[]) => {
      try {
        const { spawn } = await import('node-pty')
        const isWindows = process.platform === 'win32'
        const home = process.env.HOME || process.env.USERPROFILE || ''
        const pathSep = isWindows ? ';' : ':'
        const expandedPath = isWindows
          ? (process.env.PATH || '')
          : [
              join(home, '.bun', 'bin'),
              join(home, '.npm-global', 'bin'),
              '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin',
              process.env.PATH || ''
            ].join(pathSep)
        let termCmd: string
        let termArgs: string[]
        let cwd: string
        if (app.isPackaged) {
          const bunBinaryName = isWindows
            ? 'bun-windows.exe'
            : `bun-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
          termCmd = join(process.resourcesPath, 'bun', bunBinaryName)
          const openclawMjs = join(home, '.openclaw-easy', 'app', 'openclaw.mjs')
          termArgs = [openclawMjs, ...args]
          cwd = join(home, '.openclaw-easy', 'app')
        } else {
          const openclawPath = join(__dirname, '../../../../openclaw/src/index.ts')
          termCmd = 'bun'
          termArgs = [openclawPath, ...args]
          cwd = join(__dirname, '../../../../openclaw/')
        }

        const ptyProcess = spawn(termCmd, termArgs, {
          name: 'xterm-color',
          cols: 120,
          rows: 40,
          cwd,
          env: {
            ...process.env,
            PATH: expandedPath,
            FORCE_COLOR: '1',
            COLORTERM: 'truecolor',
            TERM: 'xterm-256color'
          }
        })

        const terminalId = `terminal-${Date.now()}`
        if (!global.terminals) global.terminals = {}
        global.terminals[terminalId] = ptyProcess

        ptyProcess.onData((data: string) => {
          this.mainWindow?.webContents.send('terminal:data', terminalId, data)
        })
        ptyProcess.onExit((exitInfo: { exitCode: number; signal?: number }) => {
          this.mainWindow?.webContents.send('terminal:exit', terminalId, exitInfo.exitCode)
          delete global.terminals[terminalId]
        })

        return { terminalId, pid: ptyProcess.pid }
      } catch (error) {
        console.error('[Terminal] Failed to create OpenClaw PTY:', error)
        throw error
      }
    })

    ipcMain.handle('terminal:create', async (_, command: string, args: string[], options?: { cwd?: string }) => {
      try {
        const { spawn } = await import('node-pty')

        console.log('[Terminal] Creating PTY process:', { command, args, cwd: options?.cwd })

        // Use node-pty for proper pseudo-terminal support
        const ptyProcess = spawn(command, args, {
          name: 'xterm-color',
          cols: 120,
          rows: 40,
          cwd: options?.cwd || process.env.HOME,
          env: {
            ...process.env,
            FORCE_COLOR: '1',
            COLORTERM: 'truecolor',
            TERM: 'xterm-256color'
          }
        })

        const terminalId = `terminal-${Date.now()}`

        // Store PTY reference
        if (!global.terminals) {
          global.terminals = {}
        }
        global.terminals[terminalId] = ptyProcess

        // Forward PTY output to renderer
        ptyProcess.onData((data: string) => {
          this.mainWindow?.webContents.send('terminal:data', terminalId, data)
        })

        // Handle PTY exit
        ptyProcess.onExit((exitInfo: { exitCode: number; signal?: number }) => {
          console.log('[Terminal] PTY exited:', { terminalId, exitCode: exitInfo.exitCode })
          this.mainWindow?.webContents.send('terminal:exit', terminalId, exitInfo.exitCode)
          delete global.terminals[terminalId]
        })

        console.log('[Terminal] PTY created:', { terminalId, pid: ptyProcess.pid })
        return { terminalId, pid: ptyProcess.pid }

      } catch (error) {
        console.error('[Terminal] Failed to create PTY:', error)
        throw error
      }
    })

    ipcMain.handle('terminal:write', async (_, terminalId: string, data: string) => {
      const ptyProcess = global.terminals?.[terminalId]
      if (ptyProcess) {
        ptyProcess.write(data)
        return { success: true }
      }
      return { success: false, error: 'Terminal not found' }
    })

    ipcMain.handle('terminal:resize', async (_, terminalId: string, cols: number, rows: number) => {
      const ptyProcess = global.terminals?.[terminalId]
      if (ptyProcess) {
        ptyProcess.resize(cols, rows)
        return { success: true }
      }
      return { success: false, error: 'Terminal not found' }
    })

    ipcMain.handle('terminal:kill', async (_, terminalId: string) => {
      const ptyProcess = global.terminals?.[terminalId]
      if (ptyProcess) {
        ptyProcess.kill()
        delete global.terminals[terminalId]
        return { success: true }
      }
      return { success: false, error: 'Terminal not found' }
    })

    // App version and update checks
    ipcMain.handle('app:get-version', () => app.getVersion())

    ipcMain.handle('app:check-for-updates', async () => {
      const current = app.getVersion()
      try {
        const response = await fetch('https://openclaw-easy.com/downloads/latest.json')
        if (!response.ok) {
          console.error(`[Update] HTTP ${response.status} checking for updates`)
          return { hasUpdate: false, currentVersion: current, latestVersion: current, downloads: {} }
        }
        const data = await response.json()
        const hasUpdate = isNewerVersion(data.version, current)
        return {
          hasUpdate,
          currentVersion: current,
          latestVersion: data.version,
          releaseDate: data.releaseDate,
          downloads: data.downloads ?? {},
        }
      } catch (error) {
        console.error('[Update] Failed to check for updates:', error)
        return { hasUpdate: false, currentVersion: current, latestVersion: current, downloads: {} }
      }
    })
  }

  private async initializeEnvironment() {
    console.log('[OpenclawApp] Initializing environment variables...')
    try {
      await this.environmentManager.initializeEnvironment()
      console.log('[OpenclawApp] Environment variables initialized successfully')
    } catch (error) {
      console.error('[OpenclawApp] Failed to initialize environment variables:', error)
    }
  }

  private autoStartOpenClaw() {
    console.log('[OpenclawApp] Auto-starting OpenClaw gateway...')
    // Give the app a moment to fully initialize
    setTimeout(async () => {
      try {
        const success = await this.openClawManager.start()
        if (success) {
          console.log('[OpenclawApp] OpenClaw gateway auto-started successfully')
          // Auto-start whisper server if STT provider is 'local' and already installed
          await this.autoStartWhisperServer()
        } else {
          console.error('[OpenclawApp] Failed to auto-start OpenClaw gateway')
        }
      } catch (error) {
        console.error('[OpenclawApp] Error during auto-start:', error)
      }
    }, 2000)
  }

  private async autoStartWhisperServer() {
    try {
      const appConfig = await this.configManager.getAppConfig()
      const sttProvider = appConfig?.stt?.provider
      if (sttProvider !== 'local') return

      const detection = await this.whisperServerManager.detectInstallation()
      if (!detection.installed) return

      const model = appConfig?.stt?.localModel || undefined
      console.log('[OpenclawApp] Auto-starting whisper server for local STT...')
      await this.whisperServerManager.start(model)
    } catch (error) {
      console.error('[OpenclawApp] Failed to auto-start whisper server:', error)
    }
  }
}

// Add error handling for uncaught exceptions and unhandled promise rejections
process.on('uncaughtException', (error) => {
  console.error('[OpenclawApp] Uncaught Exception:', error)
  // Don't exit immediately, let the app continue if possible
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('[OpenclawApp] Unhandled Rejection at:', promise, 'reason:', reason)
  // Don't exit immediately, let the app continue if possible
})

// Add error handling for stdout/stderr to prevent EPIPE errors
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') {
    // Ignore EPIPE errors (broken pipe)
    return
  }
  console.error('[OpenclawApp] stdout error:', err)
})

process.stderr.on('error', (err) => {
  if (err.code === 'EPIPE') {
    // Ignore EPIPE errors (broken pipe)
    return
  }
  console.error('[OpenclawApp] stderr error:', err)
})

// Initialize the app
const openclawApp = new OpenclawEasyApp()

app.whenReady().then(() => {
  openclawApp.initialize()
}).catch((error) => {
  console.error('[OpenclawApp] Error during app initialization:', error)
})

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Clean shutdown - stop OpenClaw gateway and whisper server when app quits.
// Guard against double-entry: the first call does cleanup then force-exits;
// subsequent calls (or re-entrant before-quit from app.quit()) are ignored.
let isCleaningUp = false
app.on('before-quit', async (event) => {
  if (isCleaningUp) return
  isCleaningUp = true

  console.log('[OpenclawApp] App is shutting down, stopping services...')
  event.preventDefault()

  try {
    await Promise.all([
      openclawApp.openClawManager.stop(),
      openclawApp.whisperServerManager.stop(),
    ])
    console.log('[OpenclawApp] All services stopped successfully')
  } catch (error) {
    console.error('[OpenclawApp] Error stopping services:', error)
  } finally {
    // Allow the app to quit after cleanup
    setImmediate(() => {
      app.exit(0)
    })
  }
})

// Also handle SIGINT/SIGTERM for development
process.on('SIGINT', async () => {
  console.log('[OpenclawApp] Received SIGINT, cleaning up...')
  try {
    await Promise.all([
      openclawApp.openClawManager.stop(),
      openclawApp.whisperServerManager.stop(),
    ])
  } catch (error) {
    console.error('[OpenclawApp] Error during SIGINT cleanup:', error)
  }
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('[OpenclawApp] Received SIGTERM, cleaning up...')
  try {
    await Promise.all([
      openclawApp.openClawManager.stop(),
      openclawApp.whisperServerManager.stop(),
    ])
  } catch (error) {
    console.error('[OpenclawApp] Error during SIGTERM cleanup:', error)
  }
  process.exit(0)
})

// Security: Prevent new window creation
app.on('web-contents-created', (_, contents) => {
  contents.on('new-window', (event, url) => {
    event.preventDefault()
    shell.openExternal(url)
  })
})