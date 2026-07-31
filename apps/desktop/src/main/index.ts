import { app, shell, BrowserWindow, ipcMain, Menu, Tray, nativeImage, session } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, statSync, renameSync, appendFileSync } from 'fs'
// Inline replacements for @electron-toolkit/utils to avoid pnpm require('electron') resolution issues
const is = { dev: !app.isPackaged }
const electronApp = {
  setAppUserModelId(id: string) {
    if (process.platform === 'win32') app.setAppUserModelId(is.dev ? process.execPath : id)
  }
}
const optimizer = {
  watchWindowShortcuts(window: BrowserWindow) {
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      if (is.dev && input.code === 'F12') {
        window.webContents.isDevToolsOpened()
          ? window.webContents.closeDevTools()
          : window.webContents.openDevTools({ mode: 'undocked' })
      }
      if (!is.dev) {
        if (input.code === 'KeyR' && (input.control || input.meta)) event.preventDefault()
        if (input.code === 'KeyI' && (input.alt && input.meta || input.control && input.shift)) event.preventDefault()
      }
    })
  }
}
import icon from '../../resources/icons/icon.png?asset'
// Base path only — the @2x/@3x siblings must ship alongside it (see createTray).
import lobsterTrayIcon from '../../resources/icons/lobster-tray.png?asset'
import lobsterDockIcon from '../../resources/icons/lobster-dock.png?asset'
import { registerMacHandlers, setupMacDockIcon } from './index-mac.js'
import { registerWindowsHandlers } from './index-windows.js'
import { OpenClawManager } from './openclaw-manager.js'
import { getOpenClawBundle } from './openclaw-bundle'
import { getDevOpenClawSpawn } from './dev-openclaw-runtime'
import { ConfigManager, AppProviderConfig } from './managers/config-manager'
import { AccessControlManager, ChannelAccessPatch } from './managers/access-control-manager'
import { BrowserManager } from './managers/browser-manager'
import { MemoryManager } from './managers/memory-manager'
import { BYOK_PROVIDER_MODELS } from '../shared/providerModels'
import { ModelManager } from './model-manager.js'
import { EnvironmentManager } from './environment-manager.js'
import { ToolsManager } from './tools-manager.js'
import { SettingsManager } from './managers/settings-manager.js'
import { SessionManager } from './managers/session-manager.js'
import { WorkspaceManager } from './managers/workspace-manager'
import { SttManager } from './managers/stt-manager'
import { DEFAULT_GATEWAY_PORT } from '../shared/constants'
import { WhisperServerManager } from './managers/whisper-server-manager'
import { TelemetryManager } from './managers/telemetry-manager'
import { safeOpenExternal } from './safe-open-external'
import { fetchLatestRelease } from './release-feed'

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
  // Tracks an in-flight start/stop triggered from the tray so the menu can
  // disable both actions while the transition is running (the underlying
  // ProcessStatus type has no 'stopping' state, and 'starting' is only set
  // for non-system spawns — tray needs to gate clicks regardless of mode).
  private trayTransition: 'starting' | 'stopping' | 'restarting' | null = null
  private isQuitting: boolean = false
  private openClawManager: OpenClawManager
  private configManager: ConfigManager
  private accessControlManager: AccessControlManager
  private browserManager: BrowserManager
  private memoryManager: MemoryManager
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
    // This ConfigManager instance also syncs credentials into the SQLite
    // auth store (the config:save path) — share the manager's
    // platform executor so those writes go through the OpenClaw CLI.
    this.configManager.setCommandExecutor(this.openClawManager.getCommandExecutor())
    const executor = this.openClawManager.getCommandExecutor()
    this.accessControlManager = new AccessControlManager(this.configManager, executor)
    this.browserManager = new BrowserManager(this.configManager, executor)
    this.memoryManager = new MemoryManager(executor)
    this.modelManager = new ModelManager()
    this.environmentManager = new EnvironmentManager()
    const configPath = join(app.getPath('home'), '.openclaw', 'openclaw.json')
    this.toolsManager = new ToolsManager(configPath)
    this.settingsManager = new SettingsManager()
    this.sessionManager = new SessionManager(this.openClawManager.getCommandExecutor())
    this.workspaceManager = new WorkspaceManager()
    this.sttManager = new SttManager()
    this.whisperServerManager = new WhisperServerManager()
    this.telemetryManager = new TelemetryManager(this.configManager, this.settingsManager)
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

    // Migrate legacy 'remote' provider to 'openai' (one-time, safe to call every startup)

    // Fix stale per-agent model overrides that don't match the current global provider
    await this.configManager.syncAgentModelsWithDefault()

    // Apply startup settings (start on boot, etc.)
    await this.settingsManager.applyStartupSettings()

    // Start periodic telemetry snapshots
    this.telemetryManager.start()

    // Auto-detect if a gateway is already running (e.g. official OpenClaw app).
    // If so, connect to it immediately so the UI shows "online" instead of "Launch Assistant".
    await this.autoDetectRunningGateway()

    // Eagerly extract the bundled runtime in the background so onboarding,
    // gateway start, and any spawned openclaw command all see ~/.openclaw-easy/app
    // ready immediately. ensureInstalled() is single-flight, so the gateway
    // start path will await this same promise instead of racing.
    if (app.isPackaged) {
      getOpenClawBundle().ensureInstalled((msg) => {
        console.log(`[OpenclawEasyApp] ${msg}`)
        this.mainWindow?.webContents.send('bundle:status', msg)
      }).catch((err: unknown) => {
        // electron-log serializes a bare Error to `{}`, which is how a total
        // runtime-install failure previously reached the log as no information
        // at all. Stringify before logging, and tell the renderer so the user
        // sees a reason instead of a loading screen that never resolves.
        const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
        console.error(`[OpenclawEasyApp] Bundle pre-install failed: ${detail}`)
        this.mainWindow?.webContents.send('bundle:status', `⚠️ OpenClaw runtime setup failed: ${detail}`)
      })
    }

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

  /** Bring the existing window to front when a second launch is attempted. */
  focusMainWindow() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (this.mainWindow.isMinimized()) { this.mainWindow.restore() }
      this.mainWindow.show()
      this.mainWindow.focus()
    }
  }

  /**
   * Probe the configured gateway port on startup.
   * If a gateway is already listening, call start() which will detect it as
   * 'external' mode and set status to 'running' — so the UI shows "online"
   * instead of "Launch Assistant".
   */
  private async autoDetectRunningGateway() {
    try {
      const net = require('net')
      const fs = require('fs')
      const path = require('path')
      const os = require('os')

      // Read configured port (same logic as readConfiguredGatewayPort)
      let port = DEFAULT_GATEWAY_PORT
      try {
        const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        port = config?.gateway?.port || DEFAULT_GATEWAY_PORT
      } catch { /* use default */ }

      // Quick TCP probe on the configured port
      const isListening = await new Promise<boolean>((resolve) => {
        const socket = new net.Socket()
        socket.setTimeout(3000)
        socket.once('connect', () => { socket.destroy(); resolve(true) })
        socket.once('error', () => { socket.destroy(); resolve(false) })
        socket.once('timeout', () => { socket.destroy(); resolve(false) })
        socket.connect(port, '127.0.0.1')
      })

      if (isListening) {
        console.log(`[OpenclawEasyApp] Gateway detected on port ${port} at startup — auto-connecting`)
        await this.openClawManager.start()
      } else {
        console.log(`[OpenclawEasyApp] No gateway detected on port ${port} at startup`)
      }
    } catch (error) {
      console.error('[OpenclawEasyApp] Auto-detect gateway failed:', error)
    }
  }

  private createMainWindow() {
    // Brand-refresh: enable native window vibrancy on macOS (frosted blur
    // behind the sidebar) and Mica on Windows 11. Falls back gracefully on
    // older OS — Electron ignores the option silently. Setting
    // `backgroundColor: '#00000000'` is required so the renderer's tinted
    // surfaces composite over the system blur instead of an opaque fill.
    const isDarwin = process.platform === 'darwin'
    const isWindows = process.platform === 'win32'

    this.mainWindow = new BrowserWindow({
      width: 1320,
      height: 800,
      minWidth: 990,
      minHeight: 600,
      show: false,
      autoHideMenuBar: true,
      frame: false,
      transparent: false,
      titleBarStyle: isDarwin ? 'hiddenInset' : 'hidden',
      trafficLightPosition: isDarwin ? { x: 20, y: 20 } : undefined,
      icon: nativeImage.createFromPath(icon),
      // macOS: 'under-window' lets the OS blur whatever's behind us.
      vibrancy: isDarwin ? 'under-window' : undefined,
      visualEffectState: isDarwin ? 'active' : undefined,
      // Windows 11: Mica gives a similar subtle backdrop blur effect.
      backgroundMaterial: isWindows ? 'mica' : undefined,
      // When vibrancy/Mica is active, set a transparent background so
      // the system effect shows through. Other platforms keep an opaque
      // fill to avoid render artifacts.
      backgroundColor: isDarwin || isWindows ? '#00000000' : undefined,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
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
          const data = await fetchLatestRelease()
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
      // Route through the validator — pre-2026-06-17 this passed
      // details.url straight to shell.openExternal with no protocol
      // check, the same hole audit W2 flagged on the IPC handler.
      void safeOpenExternal(details.url)
      return { action: 'deny' }
    })

    // Defense-in-depth: never let the app window navigate away from its own
    // renderer. A stray link/form/JS navigation would tear down the React tree
    // + WebSocket and brick the app; route http(s) to the external browser and
    // block everything else. Pairs with the renderer-side link handler.
    this.mainWindow.webContents.on('will-navigate', (event, url) => {
      const current = this.mainWindow?.webContents.getURL() ?? ''
      if (url !== current) {
        event.preventDefault()
        void safeOpenExternal(url)
      }
    })

    // The gateway (upstream 2026.7+) validates the browser Origin header on
    // WS connect and rejects unparseable origins BEFORE consulting the
    // gateway.controlUi.allowedOrigins allowlist. The built renderer loads
    // from file://, so Chromium sends Origin "file://"/"null" — unparseable →
    // CONTROL_UI_ORIGIN_NOT_ALLOWED and chat can never connect (packaged app
    // included, not just e2e). Rewrite Origin to a loopback origin for
    // gateway-bound WS requests; the gateway trusts loopback origins from
    // local socket clients (origin-check.ts "local-loopback" rule).
    // NOTE: Electron keeps ONE onBeforeSendHeaders listener per session —
    // registering another anywhere silently replaces this one and kills
    // chat. If another rewrite is ever needed, merge it into this handler.
    this.mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
      { urls: ['ws://localhost/*', 'ws://127.0.0.1/*'] },
      (details, callback) => {
        const requestHeaders = { ...details.requestHeaders }
        for (const key of Object.keys(requestHeaders)) {
          if (key.toLowerCase() === 'origin') delete requestHeaders[key]
        }
        requestHeaders['Origin'] = 'http://localhost'
        callback({ requestHeaders })
      }
    )

    // HMR for renderer based on electron-vite cli.
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      this.mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
  }

  private createTray() {
    // Load the 22pt menu-bar icon by its base path. createFromPath picks up the
    // sibling @2x/@3x files automatically, so the image carries a real
    // representation per scale factor.
    //
    // Do NOT go back to `.resize({width: 22, height: 22})` on a single large
    // PNG: that produces a 1x-only bitmap, which macOS then upscales on a
    // Retina display. The result is a washed-out blur that reads as the wrong
    // icon entirely — which is exactly how this looked before.
    const trayIconImage = nativeImage.createFromPath(lobsterTrayIcon)
    this.tray = new Tray(trayIconImage)

    this.refreshTrayMenu()

    // Rebuild the menu whenever the gateway transitions (running ↔ stopped/error).
    this.openClawManager.onStatusChange(() => this.refreshTrayMenu())

    this.tray.on('double-click', () => {
      if (this.mainWindow) {
        this.mainWindow.show()
        this.mainWindow.focus()
      } else {
        this.createMainWindow()
      }
    })
  }

  private refreshTrayMenu() {
    if (!this.tray) return
    const status = this.openClawManager.getStatus()
    const isRunning = status === 'running'
    const transitioning = this.trayTransition !== null
    const port = this.openClawManager.getActivePort()

    // ── Labels ──
    // Transition labels swap in an "…ing" suffix while a start/stop is in
    // flight so the user knows their click was received. The Restart label
    // also flips to "Restarting…" so the disabled state has an explanation.
    // Each action carries a leading emoji so the menu reads glanceably
    // (the action-glyph is the first thing the eye lands on, then the verb).
    const startLabel =
      this.trayTransition === 'starting' ? '▶ Starting…' : '▶ Start Assistant'
    const stopLabel =
      this.trayTransition === 'stopping' ? '⏹ Stopping…' : '⏹ Stop Assistant'
    const restartLabel =
      this.trayTransition === 'restarting' ? '🔄 Restarting…' : '🔄 Restart Assistant'

    // ── Status row text ──
    // U+25CF BLACK CIRCLE for running, U+25CB WHITE CIRCLE for stopped —
    // gives a glanceable color-free indicator that survives template-image
    // rendering on macOS dark/light menubars.
    const statusBullet = transitioning ? '…' : isRunning ? '●' : '○'
    const statusText = transitioning
      ? this.trayTransition === 'starting'
        ? 'Starting…'
        : this.trayTransition === 'stopping'
          ? 'Stopping…'
          : 'Restarting…'
      : isRunning
        ? `Running on :${port || '?'}`
        : 'Stopped'

    const contextMenu = Menu.buildFromTemplate([
      // Header: app name + shipped version. Sourced from package.json via
      // app.getVersion() so it can never drift from the actual binary.
      // No 🦞 emoji here — the brand mark is the 3D lobster image; the raw
      // emoji is the retired old-style logo (see ui/brand-lobster.tsx).
      { label: `Openclaw Easy v${app.getVersion()}`, type: 'normal', enabled: false },
      { label: `${statusBullet} ${statusText}`, type: 'normal', enabled: false },
      { type: 'separator' },
      {
        label: '✨ Open Dashboard',
        type: 'normal',
        click: () => {
          if (this.mainWindow) {
            this.mainWindow.show()
            this.mainWindow.focus()
          } else {
            this.createMainWindow()
          }
        },
      },
      { type: 'separator' },
      // Show BOTH Start and Stop at all times; disable the inapplicable one.
      // (Was: hide one entirely.) The launcher.py pattern is more
      // discoverable — the user always sees what actions exist.
      {
        label: startLabel,
        type: 'normal',
        enabled: !transitioning && !isRunning,
        click: async () => {
          if (this.trayTransition !== null) return
          this.trayTransition = 'starting'
          this.refreshTrayMenu()
          try {
            await this.openClawManager.start()
          } finally {
            this.trayTransition = null
            this.refreshTrayMenu()
          }
        },
      },
      {
        label: stopLabel,
        type: 'normal',
        enabled: !transitioning && isRunning,
        click: async () => {
          if (this.trayTransition !== null) return
          this.trayTransition = 'stopping'
          this.refreshTrayMenu()
          try {
            await this.openClawManager.stop()
          } finally {
            this.trayTransition = null
            this.refreshTrayMenu()
          }
        },
      },
      {
        label: restartLabel,
        type: 'normal',
        // Only meaningful when the gateway is currently running; otherwise
        // Start is the right action.
        enabled: !transitioning && isRunning,
        click: async () => {
          if (this.trayTransition !== null) return
          this.trayTransition = 'restarting'
          this.refreshTrayMenu()
          try {
            await this.openClawManager.restart()
          } finally {
            this.trayTransition = null
            this.refreshTrayMenu()
          }
        },
      },
      { type: 'separator' },
      {
        label: '📁 Show Logs Folder',
        type: 'normal',
        click: () => {
          // ~/.openclaw/logs/ holds gateway.log / gateway.err.log and the
          // stability/ bundles. shell.openPath opens it in the OS file
          // manager; resolved against userHome so it works across platforms.
          shell.openPath(join(app.getPath('home'), '.openclaw', 'logs'))
        },
      },
      { type: 'separator' },
      {
        label: '🚪 Quit',
        type: 'normal',
        click: () => {
          app.quit()
        },
      },
    ])

    // Tooltip mirrors the status row plus the port — clear visibility on
    // hover without opening the menu.
    const tooltipState = transitioning
      ? this.trayTransition === 'starting'
        ? 'starting…'
        : this.trayTransition === 'stopping'
          ? 'stopping…'
          : 'restarting…'
      : isRunning
        ? `running (port ${port || '?'})`
        : 'stopped'
    this.tray.setToolTip(`Openclaw Easy — ${tooltipState}`)
    this.tray.setContextMenu(contextMenu)
  }

  private setupIPCHandlers() {
    // OpenClaw process management
    ipcMain.handle('openclaw:start', async () => {
      // Flip the tray transition flag so the menu disables both Start/Stop
      // while a renderer-initiated start is in flight.
      this.trayTransition = 'starting'
      this.refreshTrayMenu()
      try {
        return await this.openClawManager.start()
      } finally {
        this.trayTransition = null
        this.refreshTrayMenu()
      }
    })

    ipcMain.handle('openclaw:stop', async () => {
      this.trayTransition = 'stopping'
      this.refreshTrayMenu()
      try {
        return await this.openClawManager.stop()
      } finally {
        this.trayTransition = null
        this.refreshTrayMenu()
      }
    })

    ipcMain.handle('openclaw:status', async () => {
      const status = this.openClawManager.getStatus()
      const modeInfo = this.openClawManager.getGatewayModeInfo()
      const uptimeMs = this.openClawManager.getUptime()
      return {
        isRunning: status === 'running',
        // Explicit status field so the renderer can distinguish
        // 'error' (gateway failed to start / gave up after retries)
        // from 'stopped' (clean stop). The legacy isRunning boolean
        // collapsed all non-running states.
        status,
        port: this.openClawManager.getActivePort(),
        // Real PID when we own the process (bundled/system modes), null in
        // external mode. The renderer should hide the PID line when this is
        // null instead of falling back to a misleading "Active" placeholder.
        pid: this.openClawManager.getActivePid(),
        gatewayMode: modeInfo.mode,
        // Seconds of uptime since the current child was spawned (0 in
        // external mode where we don't own the process). The renderer
        // formats this for display.
        uptime: status === 'running' && uptimeMs > 0 ? Math.floor(uptimeMs / 1000) : undefined,
        version: app.getVersion()
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
      // Restart goes stopping → starting under the hood; show "Stopping…" to
      // the user since the gateway is unavailable for the whole window.
      this.trayTransition = 'stopping'
      this.refreshTrayMenu()
      try {
        return await this.openClawManager.restart()
      } finally {
        this.trayTransition = null
        this.refreshTrayMenu()
      }
    })

    // Gateway API handlers for native dashboard
    ipcMain.handle('gateway:status', async () => {
      return this.openClawManager.getStatus()
    })

    ipcMain.handle('gateway:info', async () => {
      const modeInfo = this.openClawManager.getGatewayModeInfo()
      return {
        status: this.openClawManager.getStatus(),
        port: this.openClawManager.getActivePort(),
        // pid is null in external mode (we don't own the process) so the
        // renderer can hide the line instead of showing the misleading
        // placeholder it used to fall back to.
        pid: this.openClawManager.getActivePid(),
        // Read from app.getVersion() instead of a hardcoded string so this
        // can never go stale on a release. Sources from package.json at
        // build time → reflects the actual shipped version.
        version: app.getVersion(),
        uptime: 'N/A', // TODO: Track actual uptime
        gatewayMode: modeInfo.mode,
        systemBinaryPath: modeInfo.systemBinaryPath || null
      }
    })

    ipcMain.handle('gateway:mode', async () => {
      return this.openClawManager.getGatewayModeInfo()
    })

    ipcMain.handle('gateway:channels', async () => {
      return await this.openClawManager.listChannels()
    })

    ipcMain.handle('gateway:agents', async () => {
      return await this.openClawManager.listAgents()
    })

    ipcMain.handle('gateway:get-token', async () => {
      const start = Date.now()
      console.log('[Gateway] gateway:get-token called')
      try {
        const fs = require('fs').promises
        const path = require('path')
        const os = require('os')
        const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
        const configData = await fs.readFile(configPath, 'utf8')
        const config = JSON.parse(configData)
        const token = config?.gateway?.auth?.token || null
        console.log(`[Gateway] gateway:get-token resolved in ${Date.now() - start}ms (token: ${token ? 'present' : 'null'})`)
        return token
      } catch (error) {
        console.error(`[Gateway] gateway:get-token failed in ${Date.now() - start}ms:`, error)
        return null
      }
    })

    // Ed25519 device identity for gateway auth (renderer lacks Web Crypto Ed25519 in Electron 28).
    // Signs the V3 payload required by post-2026.5 openclaw gateway.
    // platform + deviceFamily are part of the signed payload; if the renderer
    // doesn't pass them, we fall back to '' (gateway normalizes both sides).
    ipcMain.handle('device:build-identity', async (_, opts: {
      clientId: string; clientMode: string; role: string;
      scopes: string[]; token: string; nonce: string;
      platform?: string; deviceFamily?: string;
    }) => {
      const start = Date.now()
      console.log(`[Device] device:build-identity called (clientId=${opts.clientId}, scopes=${opts.scopes.length})`)
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

        // Payload format must match the gateway's verifier exactly. Source of truth:
        //   src/gateway/device-auth.ts (gateway-side payload reconstruction).
        // Versions:
        //   v1: legacy, removed upstream in 2026
        //   v2: "v2|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce"
        //   v3: v2 plus "|<normalized-platform>|<normalized-deviceFamily>" appended.
        // Post-2026.5 gateway tries v3 first; v2 still works but triggers a
        // metadata-upgrade re-pairing flow on first reconnect (NOT_PAIRED 1008).
        // We sign v3 directly to skip that re-approval round-trip.
        //
        // Normalization (src/gateway/device-metadata-normalization.ts):
        // trim, then lowercase ASCII A-Z only. We do the same here so both
        // sides produce a byte-identical payload string.
        const normalizeMeta = (s: string | undefined): string => {
          if (!s) return ''
          let out = ''
          for (const ch of s.trim()) {
            const c = ch.charCodeAt(0)
            out += c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : ch
          }
          return out
        }

        const signedAt = Date.now()
        const payloadStr = [
          'v3',
          deviceId,
          opts.clientId,
          opts.clientMode,
          opts.role,
          opts.scopes.join(','),
          signedAt.toString(),
          opts.token || '',
          opts.nonce || '',
          normalizeMeta(opts.platform),
          normalizeMeta(opts.deviceFamily),
        ].join('|')

        const sigBuffer = nodeCrypto.sign(null, Buffer.from(payloadStr), privateKeyPem)
        const signature = sigBuffer.toString('base64')
          .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

        const result = { id: deviceId, publicKey, signature, signedAt, nonce: opts.nonce }
        console.log(`[Device] device:build-identity resolved in ${Date.now() - start}ms (deviceId: ${deviceId.slice(0, 16)}...)`)
        return result
      } catch (error) {
        console.error(`[Device] device:build-identity failed in ${Date.now() - start}ms:`, error)
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
        return config?.gateway?.port || DEFAULT_GATEWAY_PORT
      } catch (error) {
        console.error('[Gateway] Failed to read gateway port:', error)
        return DEFAULT_GATEWAY_PORT
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

    ipcMain.handle('channels:disconnect-weixin', async () => {
      return await this.openClawManager.disconnectWeixin()
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
        // Iterate over EVERY known BYOK provider so a change to a venice
        // or openrouter key triggers the same gateway restart that
        // anthropic/openai/google would. The previous hand-rolled list
        // missed venice + openrouter entirely, so swapping those keys
        // wrote new config but kept the gateway running with the stale
        // key in memory until next restart.
        const byokKeyChanged = Object.keys(BYOK_PROVIDER_MODELS).some(
          (provider) =>
            (config.byok?.apiKeys as Record<string, string | undefined> | undefined)?.[provider] !==
            (prev.byok?.apiKeys as Record<string, string | undefined> | undefined)?.[provider],
        )
        const localModelChanged = config.local?.model !== prev.local?.model

        // Any of these leaves the running gateway holding stale provider
        // state in memory, so the same condition drives both the
        // openclaw.json rewrite and the restart below.
        const needsRestart = providerChanged || byokProviderChanged ||
            byokModelChanged || byokKeyChanged || localModelChanged

        if (needsRestart) {
          console.log(`[Config] Applying provider config: ${config.aiProvider}`)

          await this.configManager.applyProviderToOpenClaw(config)
          console.log(`[Config] ✅ openclaw.json updated for provider: ${config.aiProvider}`)

          // Re-pin per-agent harness BEFORE the gateway restart below
          // so the restarted gateway loads from corrected agent state.
          // `applyProviderToOpenClaw` may have changed the default
          // model (and any agents that inherited that default); their
          // `agentRuntime.id` is now stale. Without this, the codex
          // harness's GPT-5 persona-latch can fire on a Claude/DeepSeek
          // model after a provider switch. Same call already fires
          // from setApiKey / syncRemoteBackend; this entry point was
          // missing it.
          await this.openClawManager.repairAgentHarnesses()

          // Reachability, not isRunning() — see the agents:update handler:
          // an externally-managed (launchd) gateway must be restarted too, or
          // it keeps serving the previous provider/model.
          if (needsRestart && (await this.openClawManager.isGatewayReachable())) {
            // Synchronous restart: wait until the gateway is actually
            // running the new config before resolving the IPC. The
            // renderer's Apply button stays in "saving…" state for the
            // duration (typically 3-5s after the 100ms-polling fix),
            // and the dashboard pill shows live status. This is slower
            // than fire-and-forget BUT is correct — by the time Apply
            // returns, the gateway IS using the new model. The previous
            // fire-and-forget (commit 2afae1df20) opened a window where
            // chat could hit the OLD gateway with the OLD model and
            // confuse users with stale responses.
            console.log('[Config] Restarting gateway to apply new provider config...')
            await this.openClawManager.restart()
            console.log('[Config] Gateway restart complete')
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
        config.meta.lastTouchedVersion = "2026.3.15"

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

    ipcMain.handle('channels:weixin-qr', async () => {
      return await this.openClawManager.getWeixinQRFromLogin()
    })

    ipcMain.handle('channels:weixin-ensure-plugin', async () => {
      return await this.openClawManager.ensureWeixinPlugin()
    })

    ipcMain.handle('channels:check-weixin-status', async () => {
      return await this.openClawManager.checkWeixinStatus()
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

      // Synchronous restart on model change — same rationale as
      // config:save above. Gateway only reads agents.*.model.primary
      // at startup, so chats sent during the restart window would
      // otherwise hit the OLD model. Wait until the new model is live
      // before resolving the IPC so Save returns "ready to chat".
      if (result.success && config.model && config.model !== result.prevModel) {
        // Reachability, not isRunning(): the gateway is often the launchd
        // service rather than a child of this app, and isRunning() is false
        // for it. Gating on isRunning() left an externally-started gateway on
        // the previous model, so chat kept failing against the OLD provider
        // ("No API key found for provider ollama") while the UI showed the
        // new model as active.
        if (await this.openClawManager.isGatewayReachable()) {
          console.log(`[Agents] Primary model changed to ${config.model} — restarting gateway`)
          await this.openClawManager.restart()
          console.log('[Agents] Gateway restart complete')
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
      await safeOpenExternal(url)
    })

    // NOTE: 'system:show-in-folder' was removed (security/cleanliness). It
    // passed a renderer-supplied path straight to shell.showItemInFolder with
    // no validation and had no first-party caller. Re-add via a validated
    // chokepoint (see safe-open-path.ts) if a real need appears.

    // Skills management
    ipcMain.handle('skills:list', async () => {
      console.log('[Skills] Listing skills')
      return await this.openClawManager.listSkills()
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

    // Added 2026-06-15 after ClawHub docs audit:
    // `openclaw skills check --json` reports eligibility breakdowns
    // (eligible / blocked / missing-requirements lists). Powers UI
    // surfaces like a "N skills need configuration" banner. Optional
    // agentId narrows the scope to a single agent's skill set.
    ipcMain.handle('skills:check', async (_, agentId?: string) => {
      return await this.openClawManager.checkSkills(agentId)
    })

    // Added 2026-06-15 after ClawHub docs audit:
    // `openclaw skills update --all` refreshes every ClawHub-installed
    // skill in-place. Pure addition — desktop had no update path before.
    ipcMain.handle('skills:update-all', async () => {
      return await this.openClawManager.updateAllSkills()
    })

    ipcMain.handle('skills:open-folder', async (_, skillName: string) => {
      // Validation + lookup live on SkillsManager (used to be inline here).
      // resolveSkillFolderPath returns null both for invalid names and for
      // names that match nothing on disk.
      const resolved = await this.openClawManager.resolveSkillFolderPath(skillName)
      if (!resolved) {
        return { success: false, error: `Could not find folder for skill: ${skillName}` }
      }
      shell.openPath(resolved)
      return { success: true }
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

    // Channel access control (dmPolicy / allowlists / group policy / pairing)
    ipcMain.handle('access:get', async () => {
      return await this.accessControlManager.getChannelAccess()
    })

    ipcMain.handle('access:set', async (_, channelId: string, patch: ChannelAccessPatch) => {
      console.log('[Access] Updating channel access:', channelId)
      const result = await this.accessControlManager.setChannelAccess(channelId, patch)
      // Channel policy is read by the gateway's channel runtime; restart so
      // the change applies to the live channel processes, mirroring the
      // provider-change flow in config:save.
      if (result.success && (await this.openClawManager.isGatewayReachable())) {
        await this.openClawManager.restart()
      }
      return result
    })

    ipcMain.handle('access:pairing-list', async () => {
      return await this.accessControlManager.listPairingRequests()
    })

    ipcMain.handle('access:pairing-approve', async (_, channel: string, code: string) => {
      console.log('[Access] Approving pairing code for', channel)
      return await this.accessControlManager.approvePairing(channel, code)
    })

    // Browser tool surface
    ipcMain.handle('browser:status', async () => {
      return await this.browserManager.getStatus()
    })

    ipcMain.handle('browser:set-enabled', async (_, enabled: boolean) => {
      console.log('[Browser] Setting enabled:', enabled)
      const result = await this.browserManager.setEnabled(enabled)
      // Plugin activation is resolved when the gateway boots, so a live
      // gateway ignores this flag until it reloads — same reason access:set
      // restarts. Only on a real change, so re-clicking the current state
      // never interrupts a chat.
      if (result.success && result.changed && (await this.openClawManager.isGatewayReachable())) {
        await this.openClawManager.restart()
      }
      return result
    })

    ipcMain.handle('browser:start', async () => {
      console.log('[Browser] Starting dedicated browser')
      return await this.browserManager.start()
    })

    ipcMain.handle('browser:stop', async () => {
      console.log('[Browser] Stopping dedicated browser')
      return await this.browserManager.stop()
    })

    ipcMain.handle('browser:screenshot', async () => {
      console.log('[Browser] Capturing screenshot')
      return await this.browserManager.screenshot()
    })

    // Memory surface
    ipcMain.handle('memory:status', async () => {
      return await this.memoryManager.getStatus()
    })

    ipcMain.handle('memory:search', async (_, query: string) => {
      return await this.memoryManager.search(query)
    })

    ipcMain.handle('memory:reindex', async () => {
      console.log('[Memory] Reindexing memory files')
      return await this.memoryManager.reindex()
    })

    ipcMain.handle('memory:list-files', async (_, workspaceDir?: string) => {
      return await this.memoryManager.listFiles(workspaceDir)
    })

    ipcMain.handle('memory:read-file', async (_, workspaceDir: string, relPath: string) => {
      return await this.memoryManager.readFileContent(workspaceDir, relPath)
    })

    ipcMain.handle('memory:delete-file', async (_, workspaceDir: string, relPath: string) => {
      console.log('[Memory] Deleting memory file:', relPath)
      return await this.memoryManager.deleteFile(workspaceDir, relPath)
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

    // Workspace file management. The optional agentId scopes file ops to a
    // specific agent's workspace dir (main → ~/.openclaw/workspace, others →
    // their configured/sibling dir); omitted → main agent for back-compat.
    ipcMain.handle('workspace:list', async (_, agentId?: string) => {
      return await this.workspaceManager.listFiles(agentId)
    })

    ipcMain.handle('workspace:read', async (_, name: string, agentId?: string) => {
      return await this.workspaceManager.readFile(name, agentId)
    })

    ipcMain.handle('workspace:write', async (_, name: string, content: string, agentId?: string) => {
      return await this.workspaceManager.writeFile(name, content, agentId)
    })

    ipcMain.handle('workspace:create', async (_, name: string, agentId?: string) => {
      return await this.workspaceManager.createFile(name, agentId)
    })

    ipcMain.handle('workspace:delete', async (_, name: string, agentId?: string) => {
      return await this.workspaceManager.deleteFile(name, agentId)
    })

    ipcMain.handle('workspace:open-dir', async (_, agentId?: string) => {
      return await this.workspaceManager.openDir(agentId)
    })

    // Commands discovery — surfaces top-level openclaw CLI commands so
    // the Commands page can show commands shipped by upstream after the
    // static catalog was authored. Cached single-flight in the manager.
    ipcMain.handle('commands:list-discovered', async () => {
      return await this.openClawManager.listDiscoveredCommands()
    })

    // Terminal management — spawns openclaw inside a node-pty so the
    // renderer can attach an xterm session (Commands page Run flow,
    // onboarding wizard). Runtime resolution mirrors the
    // OpenClawCommandExecutor's: prefer a globally installed openclaw on
    // disk, then the bundled runtime, then the dev-mode Node + built dist
    // fallback (dev-openclaw-runtime.ts) — every path runs under Node
    // because openclaw needs node:sqlite from first boot.
    // See managers/system-openclaw-resolver.ts.
    ipcMain.handle('terminal:create-openclaw', async (_, args: string[]) => {
      try {
        const { spawn } = await import('node-pty')
        const { detectSystemOpenClaw } = await import('./managers/system-openclaw-resolver')
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

        // (1) Globally installed openclaw — wins everywhere it's present.
        const systemOpenclaw = await detectSystemOpenClaw()
        if (systemOpenclaw) {
          termCmd = systemOpenclaw
          termArgs = [...args]
          cwd = home
        } else if (app.isPackaged) {
          // (2) Bundled mode — extract first; the bundled runtime may not
          // exist yet on a fresh upgrade (the gateway extracts it lazily).
          // Without this guard the onboarding wizard hangs at "Starting
          // OpenClaw onboarding…" with ENOENT.
          const bundle = getOpenClawBundle()
          await bundle.ensureInstalled((msg) => {
            console.log(`[Terminal] ${msg}`)
            this.mainWindow?.webContents.send('bundle:status', msg)
          })

          // Run under bundled Node (has node:sqlite) — onboarding creates the
          // first agent, which writes SQLite state and fails under bun.
          termCmd = bundle.getNodeBinary()
          termArgs = [bundle.getOpenClawMjs(), ...args]
          cwd = bundle.getInstallDir()
        } else {
          // (3) Dev fallback — built CLI under Node (see
          // dev-openclaw-runtime.ts). Only when no system openclaw exists.
          const dev = getDevOpenClawSpawn()
          termCmd = dev.runtime
          termArgs = [dev.entry, ...args]
          cwd = dev.cwd
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

    // NOTE: the generic 'terminal:create' handler was removed (security). It
    // spawned a renderer-supplied command/args under node-pty with the full
    // parent env and no allowlist — an arbitrary-code-execution surface if the
    // renderer is ever compromised (it renders untrusted channel/markdown
    // content). It had no first-party caller; all terminal use goes through
    // 'terminal:create-openclaw', which hard-pins the openclaw runtime.

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
        const data = await fetchLatestRelease()
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

// Single-instance gate. A second instance's bundled-mode start treats the
// first instance's healthy gateway as a stale process and kills it by PID —
// exit before constructing managers (ConfigManager's constructor already
// runs config repairs).
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  console.log('[OpenclawApp] Another OpenClaw Easy instance is already running — quitting')
  app.exit(0)
}

// Initialize the app
const openclawApp = new OpenclawEasyApp()

app.on('second-instance', () => {
  openclawApp.focusMainWindow()
})

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) { return }
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
    await Promise.race([
      Promise.all([
        openclawApp.openClawManager.stop(),
        openclawApp.whisperServerManager.stop(),
      ]),
      // Hard cap — external-mode stop chains several 15s execFile attempts;
      // don't let a slow/hung stop stall app quit for ~45s.
      new Promise((resolve) => setTimeout(resolve, 6000)),
    ])
    console.log('[OpenclawApp] All services stopped successfully')
  } catch (error) {
    console.error('[OpenclawApp] Error stopping services:', error)
  } finally {
    // Guarantee the owned gateway child is SIGTERM'd and all health/monitor
    // intervals + timers are cleared even if stop() threw or timed out —
    // otherwise the gateway orphans and holds the port (system-mode has no
    // port-reclaim on relaunch). The gateway is spawned non-detached, so a
    // bare app.exit() does NOT reap it.
    try {
      openclawApp.openClawManager.destroy()
    } catch (e) {
      console.error('[OpenclawApp] destroy() during quit failed:', e)
    }
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

// The deprecated `new-window` event was removed in Electron 31. The
// main window already declares `setWindowOpenHandler` which covers the
// same surface (intercepting target=_blank and `window.open` calls
// from the renderer) AND honours the URL validator. No replacement
// handler needed here.