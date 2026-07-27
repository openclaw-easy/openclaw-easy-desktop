import * as path from 'path'
import * as os from 'os'
import { BrowserWindow } from 'electron'
import { createProcessManager, ProcessManager, ProcessStatus, GatewayMode, GatewayModeInfo } from './process-manager.js'
import { ProcessManagerWindows } from './process-manager-windows.js'
import { ChannelManager } from './channel-manager.js'
import { OpenClawEnvironment } from './openclaw-environment'
import { Logger } from './managers/logger'
import { OpenClawCommandExecutor } from './managers/openclaw-command-executor'
import { OpenClawCommandExecutorWindows } from './managers/openclaw-command-executor-windows'
import { ConfigManager } from './managers/config-manager'
import { DEFAULT_GATEWAY_PORT } from '../shared/constants'
import { defaultByokAgentModelId } from '../shared/providerModels'
import { AgentBindingManager } from './managers/agent-binding-manager'
import { SkillsManager } from './managers/skills-manager'
import { HooksManager } from './managers/hooks-manager'
import { PluginsManager } from './managers/plugins-manager'
import { CronManager, AddCronJobParams, CronJob } from './managers/cron-manager'
import { DoctorManager } from './managers/doctor-manager'
import { parseOpenClawHelp, DiscoveredCommand } from './managers/commands-discovery'
import { StatisticsManager } from './managers/statistics-manager'
import { runOpenaiCodexLegacyMigration } from './managers/openai-codex-legacy-migration'
import { runKeychainMigration } from './managers/keychain-migration'
import { repairInstalledWeixinPlugin } from './managers/weixin-plugin-repair'
import { listAgents } from './managers/agent-roster'

// Unified executor interface — both implementations expose executeCommand()
type CommandExecutor = {
  executeCommand(args: string[], timeoutMs?: number, opts?: { stdinData?: string }): Promise<string | null>
  setSystemBinary?(binaryPath: string | null): void
}

export class OpenClawManager {
  private processManager: ProcessManager
  private channelManager: ChannelManager
  private openclawEnv: OpenClawEnvironment
  private gatewayPort: number = DEFAULT_GATEWAY_PORT  // Track active gateway port (matches official OpenClaw default)
  private lastStatusLogTime: number = 0  // Track last time we logged status

  // Specialized managers
  private logger: Logger
  private executor: CommandExecutor
  private configManager: ConfigManager
  private agentBindingManager: AgentBindingManager
  private skillsManager: SkillsManager
  private hooksManager: HooksManager
  private pluginsManager: PluginsManager
  private cronManager: CronManager
  private doctorManager: DoctorManager
  private statisticsManager: StatisticsManager

  /**
   * Single-flight cache for {@link listDiscoveredCommands}. `openclaw --help`
   * is stable across a process lifetime and the spawn cost (~200ms) would
   * otherwise stack up on every Commands-tab switch.
   */
  private discoveredCommandsCache: {
    success: boolean
    commands?: DiscoveredCommand[]
    error?: string
  } | null = null

  constructor() {
    const configPath = this.getConfigPath()

    // Initialize logger and config manager first
    this.logger = new Logger()
    this.configManager = new ConfigManager(this.logger)

    // Initialize core managers using platform factory
    this.processManager = createProcessManager(configPath, this.configManager)
    this.channelManager = new ChannelManager(configPath, this.configManager)
    this.openclawEnv = new OpenClawEnvironment(configPath)

    // Platform-specific command executor
    this.executor = process.platform === 'win32'
      ? new OpenClawCommandExecutorWindows(configPath)
      : new OpenClawCommandExecutor(configPath)

    // ConfigManager shells out to `openclaw models auth paste-*` to sync
    // credentials into the per-agent SQLite auth store.
    this.configManager.setCommandExecutor(this.executor)

    this.agentBindingManager = new AgentBindingManager(this.configManager)
    this.skillsManager = new SkillsManager(this.executor as OpenClawCommandExecutor, this.configManager)
    this.hooksManager = new HooksManager(this.executor as OpenClawCommandExecutor)
    this.pluginsManager = new PluginsManager(this.executor as OpenClawCommandExecutor, this.configManager)
    this.cronManager = new CronManager(this.executor as OpenClawCommandExecutor)
    this.doctorManager = new DoctorManager(this.executor as OpenClawCommandExecutor, this.logger, this.configManager)
    this.statisticsManager = new StatisticsManager(this.executor as OpenClawCommandExecutor, this.processManager)
  }

  private getConfigPath(): string {
    return path.join(os.homedir(), '.openclaw', 'openclaw.json')
  }

  setMainWindow(window: BrowserWindow | null) {
    this.mainWindow = window
    this.processManager.setMainWindow(window)
    this.channelManager.setMainWindow(window)
  }

  private mainWindow: BrowserWindow | null = null

  // Process Management
  async start(): Promise<boolean> {
    this.logger.addLog('=== Starting OpenClaw Gateway ===')

    const configPath = this.getConfigPath()
    console.log(`[OpenClawManager] Config path: ${configPath}`)

    // Check if already running
    const existingStatus = this.processManager.getStatus()
    if (existingStatus === 'running') {
      this.logger.addLog('✅ OpenClaw gateway is already running')
      return true
    }

    // Detect gateway mode FIRST — before modifying any config files.
    // The system OpenClaw gateway watches its config and restarts on changes,
    // so writing config while it's running would cause a restart race condition.
    this.logger.addLog('🔍 Detecting OpenClaw installation...')
    const detectedMode = await this.processManager.detectGatewayMode()

    // (1) Bootstrap config on first launch when we own the spawn path.
    // External mode means a system gateway is already running — it owns
    // the config and we never create one on its behalf.
    if (detectedMode.mode !== 'external' && !await this.configManager.configExists()) {
      this.logger.addLog('⚠️ No OpenClaw configuration found, creating default config...')
      await this.configManager.createDefaultConfig(this.gatewayPort)
    } else if (detectedMode.mode === 'external') {
      this.logger.addLog('✅ Connecting to existing OpenClaw gateway')
    } else {
      this.logger.addLog('✅ Using existing OpenClaw configuration')
    }

    // (2) Repair gateway-rejecting fields for EVERY mode. This pass is
    // pure cleanup — it only removes / migrates fields the strict zod
    // schema would crash on (provider compat junk, dangling plugin
    // entries, legacy top-level `agents.list[].agentRuntime`). Skipping
    // it on bundled/system mode is what caused the "Launch Assistant"
    // hangs after the 2026.6 upstream merge: the gateway died at startup
    // and the supervisor reported nothing.
    const repaired = await this.configManager.repairGatewayRejections()
    if (repaired) {
      this.logger.addLog('🔧 Repaired gateway-rejecting fields in shared config')
    }

    // (2b) Migrate legacy `openai-codex` auth profiles + catalog entries
    // to `openai`. Upstream 2026.6 folded the standalone openai-codex
    // provider into openai; the codex harness's `.supports()` whitelist
    // now rejects anything with provider id `openai-codex`, which trips
    // chat on every upgrade where pre-2026.6 state survives.
    //
    // Upstream `openclaw doctor --fix` ships the same repair via
    // src/commands/doctor-auth.ts +
    // src/commands/doctor/shared/legacy-config-migrations.runtime.providers.ts,
    // but the desktop's DoctorManager strips `--fix` for safety so the
    // migration never fires automatically. This is the narrowly-scoped
    // mirror — see openai-codex-legacy-migration.ts for the full why.
    //
    // Idempotent: a clean tree is a silent no-op. Safe for every mode —
    // it only touches per-agent files we own (~/.openclaw/agents/*).
    try {
      const openClawHome = path.join(os.homedir(), '.openclaw')
      await runOpenaiCodexLegacyMigration(openClawHome, this.logger)
    } catch (err) {
      // Never fail the gateway boot for a migration error. The codex
      // harness will surface a clear message on the next chat attempt
      // and the user can fall back to `openclaw doctor --fix`.
      this.logger.addLog(
        `⚠️ openai-codex legacy migration skipped: ${(err as Error)?.message ?? err}`,
      )
    }

    // (2c) macOS keychain-access-group rename cleanup (audit W1.9).
    // 2026-06-17 the entitlement was renamed from com.moltbot-easy.app
    // to com.openclaw-easy.app. Old safeStorage-encrypted auth tokens
    // can't be decrypted under the new entitlement — this eagerly
    // clears the stale field so the user gets a clean sign-in prompt
    // instead of a recurring decrypt-error log on every config read.
    //
    // Idempotent on a clean tree. Same try/catch policy as above —
    // never block gateway boot.
    try {
      runKeychainMigration(undefined, this.logger)
    } catch (err) {
      this.logger.addLog(
        `⚠️ keychain migration skipped: ${(err as Error)?.message ?? err}`,
      )
    }

    // (3) Tool config + validation, only when we own the spawn path.
    if (detectedMode.mode !== 'external') {
      await this.configManager.ensureToolsConfigured()
      await this.configManager.cleanupInvalidToolNames()
      await this.configManager.loadAndValidateConfig()
      // Re-project the UI-selected provider so openclaw.json's catalog can't
      // stay drifted from app-config across restarts (e.g. Google selected
      // but openclaw.json still holding the BYOK-OpenAI catalog). Idempotent.
      await this.configManager.reconcileActiveProvider()
    }

    this.logger.addLog('ℹ️ Doctor diagnostics available - click "Run Doctor" button if needed')

    // Compat-repair the installed Weixin plugin BEFORE the gateway spawns:
    // a reinstall/update outside the desktop restores the broken 2.4.6
    // import and the channel would crash-loop at startup (all gateway
    // modes load the plugin, so this runs unconditionally). Idempotent
    // no-op once Tencent ships a 2026.7.x-compatible version.
    try {
      const { changedFiles } = repairInstalledWeixinPlugin(path.dirname(this.getConfigPath()))
      if (changedFiles.length > 0) {
        this.logger.addLog(`🔧 Repaired Weixin plugin SDK imports (${changedFiles.length} file(s)) for OpenClaw 2026.7.x`)
      }
    } catch (err) {
      this.logger.addLog(`⚠️ Weixin plugin compat repair skipped: ${(err as Error)?.message ?? err}`)
    }

    // Make sure one-shot startup repairs (e.g. `agentRuntime.id` backfill)
    // have committed before we spawn the gateway. The gateway watches the
    // config file and would otherwise boot from stale agent metadata,
    // re-introducing the codex/GPT-5 persona-latch on the first message.
    await this.channelManager.ready()

    // Pass the already-detected mode down so processManager.start()
    // doesn't repeat the TCP probe + `which openclaw` work. Previously
    // detection ran 3× per launch (here, inside processManager.start,
    // and again for external-mode binary refresh below).
    const result = await this.processManager.start(detectedMode)

    if (result) {
      this.gatewayPort = this.processManager.getActivePort() || DEFAULT_GATEWAY_PORT
      const modeInfo = this.processManager.getGatewayModeInfo()

      // Wire up the command executor to use the right binary for this mode
      if (modeInfo.mode === 'system' || modeInfo.mode === 'external') {
        // For system/external modes, CLI commands should use the system binary
        const systemBinary = modeInfo.systemBinaryPath || null
        if (systemBinary && this.executor.setSystemBinary) {
          this.executor.setSystemBinary(systemBinary)
        } else if (modeInfo.mode === 'external') {
          // External mode without a known system binary: try to detect it
          // so CLI commands work correctly
          const detectedBinary = await this.processManager.detectGatewayMode()
          if (detectedBinary.systemBinaryPath && this.executor.setSystemBinary) {
            this.executor.setSystemBinary(detectedBinary.systemBinaryPath)
          }
        }
      } else {
        // Bundled mode: revert to bundled binary
        if (this.executor.setSystemBinary) {
          this.executor.setSystemBinary(null)
        }
      }

      // Log mode-specific messages
      switch (modeInfo.mode) {
        case 'external':
          this.logger.addLog(`✅ Connected to existing OpenClaw gateway on port ${this.gatewayPort}`)
          this.logger.addLog('🔗 Running as GUI manager for your existing OpenClaw installation')
          break
        case 'system':
          this.logger.addLog(`✅ Started system OpenClaw gateway on port ${this.gatewayPort}`)
          this.logger.addLog(`🖥️ Using system binary: ${modeInfo.systemBinaryPath}`)
          break
        case 'bundled':
          this.logger.addLog(`✅ Desktop OpenClaw gateway started on port ${this.gatewayPort}`)
          this.logger.addLog('📦 Using bundled OpenClaw runtime')
          break
      }

      console.log(`[OpenClawManager] Gateway started in ${modeInfo.mode} mode on port ${this.gatewayPort}`)

      // On Windows, share the detected WSL2 distro with the command executor
      if (process.platform === 'win32') {
        const wsl2Info = (this.processManager as ProcessManagerWindows).getWSL2Info()
        if (wsl2Info) {
          (this.executor as OpenClawCommandExecutorWindows).setWSLDistro(wsl2Info.distro)
        }
      }

      // Update configuration with the actual port being used (skip for external mode
      // since we don't want to overwrite the user's existing port config)
      if (modeInfo.mode !== 'external') {
        await this.configManager.updateGatewayPort(this.gatewayPort)
      }
      return true
    }

    this.logger.addLog('❌ Failed to start OpenClaw gateway')
    this.logger.addLog('ℹ️ Please ensure OpenClaw is properly installed and try again')
    return false
  }

  async stop(): Promise<boolean> {
    this.logger.addLog('🛑 Stopping OpenClaw gateway...')

    const result = await this.processManager.stop()

    if (result) {
      this.logger.addLog('✅ OpenClaw gateway stopped')
    } else {
      this.logger.addLog('⚠️ Failed to stop OpenClaw gateway')
    }

    return result
  }

  async restart(): Promise<boolean> {
    this.logger.addLog('🔄 Restarting OpenClaw gateway...')
    this.emitRestartStatus('restarting', 'gateway restart')

    const result = await this.processManager.restart()

    if (result) {
      this.logger.addLog('✅ OpenClaw gateway restarted successfully')
      this.emitRestartStatus('ready', 'gateway restart')
    } else {
      this.logger.addLog('⚠️ Failed to restart OpenClaw gateway')
      this.emitRestartStatus('failed', 'gateway restart')
    }

    return result
  }

  private emitRestartStatus(
    status: 'queued' | 'restarting' | 'ready' | 'failed',
    reason: string,
  ): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('gateway:restart-status', { status, reason })
    }
  }

  getStatus(): ProcessStatus {
    const status = this.processManager.getStatus()

    // Throttle this log to every 3 seconds
    const now = Date.now()
    if (now - this.lastStatusLogTime >= 3000) {
      console.log('[OpenClawManager] getStatus:', status)
      this.lastStatusLogTime = now
    }

    return status
  }

  /** Subscribe to underlying process-manager status changes (e.g. tray menu refresh). */
  onStatusChange(fn: (status: ProcessStatus, previous: ProcessStatus) => void): () => void {
    return this.processManager.onStatusChange(fn)
  }

  isRunning(): boolean {
    return this.processManager.isRunning()
  }

  /**
   * True when a gateway is listening, including one this app did not start.
   * Use for "must restart to apply" decisions — see
   * ProcessManager.isGatewayReachable.
   */
  async isGatewayReachable(): Promise<boolean> {
    return this.processManager.isGatewayReachable()
  }

  getActivePort(): number {
    return this.gatewayPort
  }

  getActivePid(): number | null {
    return this.processManager.getActivePid()
  }

  /** Milliseconds since the current gateway child was spawned (0 in external mode). */
  getUptime(): number {
    return this.processManager.getUptime()
  }

  /**
   * Re-resolve `agentRuntime.id` for every agent whose harness can be
   * inferred from its current model. Exposed publicly so the
   * `config:save` IPC handler can fire it after a provider/model
   * switch — without that call agents inheriting from the new
   * `defaults.model.primary` keep their old harness ids (codex on a
   * Claude model, pi on a GPT model) until the next desktop launch.
   *
   * Delegates to ChannelManager which owns the agent-config write
   * path; safe to call multiple times (idempotent).
   */
  async repairAgentHarnesses(): Promise<void> {
    await this.channelManager.repairAgentHarnesses()
  }

  getGatewayModeInfo(): GatewayModeInfo {
    return this.processManager.getGatewayModeInfo()
  }

  getCommandExecutor(): CommandExecutor {
    return this.executor
  }

  async getLogs(): Promise<string[]> {
    // First, try to get actual OpenClaw gateway logs
    try {
      const result = await this.executor.executeCommand(['logs'], 5000)
      if (result) {
        // Parse the logs and combine with internal logs
        const gatewayLogs = result.split('\n').filter(line => line.trim().length > 0)

        // Combine internal desktop logs with gateway logs
        const combinedLogs = [
          ...this.logger.getLogs(), // Desktop app logs
          ...gatewayLogs.map(log => `[Gateway] ${log}`) // Gateway logs with prefix
        ]

        // Return the most recent 200 logs
        return combinedLogs.slice(-200)
      }
    } catch {
      // Expected during startup or when gateway is not ready — silently fall back
    }

    // Fallback to internal logs only
    return this.logger.getLogs()
  }
  // Channel Management (delegated to ChannelManager)
  async listChannels(): Promise<any[]> {
    return await this.channelManager.listChannels()
  }

  async getChannelStatus(): Promise<any[]> {
    return await this.channelManager.getChannelStatus()
  }

  async addWhatsAppChannel(name?: string): Promise<boolean> {
    return await this.channelManager.addWhatsAppChannel(name)
  }

  async checkWhatsAppStatus(): Promise<{ connected: boolean; logs: string[] }> {
    return await this.channelManager.checkWhatsAppStatus()
  }

  async checkTelegramStatus(): Promise<{ connected: boolean }> {
    return await this.channelManager.checkTelegramStatus()
  }

  async checkDiscordStatus(): Promise<{ connected: boolean }> {
    return await this.channelManager.checkDiscordStatus()
  }

  async disconnectWhatsApp(): Promise<{ success: boolean; logs: string[] }> {
    return await this.channelManager.disconnectWhatsApp()
  }

  async disconnectTelegram(): Promise<{ success: boolean; logs: string[] }> {
    return await this.channelManager.disconnectTelegram()
  }

  async disconnectDiscord(): Promise<{ success: boolean; logs: string[] }> {
    return await this.channelManager.disconnectDiscord()
  }

  async loginWhatsApp(): Promise<{success: boolean, logs: string[]}> {
    return await this.channelManager.loginWhatsApp()
  }

  async getWhatsAppQRFromLogin(): Promise<{success: boolean, qrData?: string, logs: string[]}> {
    return await this.channelManager.getWhatsAppQRFromLogin()
  }

  // Weixin (personal WeChat) — external official plugin, installed on demand.
  async getWeixinQRFromLogin(): Promise<{ success: boolean; qrData?: string; logs: string[] }> {
    return await this.channelManager.getWeixinQRFromLogin()
  }

  async ensureWeixinPlugin(): Promise<{ success: boolean; alreadyInstalled: boolean; logs: string[] }> {
    return await this.channelManager.ensureWeixinPlugin()
  }

  async checkWeixinStatus(): Promise<{ connected: boolean }> {
    return await this.channelManager.checkWeixinStatus()
  }

  async disconnectWeixin(): Promise<boolean> {
    return await this.channelManager.disconnectWeixin()
  }

  async getWhatsAppQR(): Promise<string> {
    const result = await this.getWhatsAppQRFromLogin()
    return result.qrData || 'QR_GENERATION_FAILED'
  }

  async getWhatsAppMessages(): Promise<{ success: boolean; messages?: any[]; error?: string }> {
    return await this.channelManager.getWhatsAppMessages()
  }

  // Telegram Integration
  async connectTelegram(botToken: string, name?: string): Promise<{ success: boolean; error?: string }> {
    return await this.channelManager.connectTelegramBot(botToken, name)
  }

  async testTelegram(botToken: string): Promise<{ success: boolean; botInfo?: any; error?: string }> {
    return await this.channelManager.testTelegramBot(botToken)
  }

  // Discord Integration
  async connectDiscord(botToken: string, serverId: string, name?: string): Promise<{ success: boolean; error?: string }> {
    return await this.channelManager.connectDiscordBot(botToken, serverId, name)
  }

  async testDiscord(botToken: string): Promise<{ success: boolean; botInfo?: any; error?: string }> {
    return await this.channelManager.testDiscordBot(botToken)
  }

  // Slack Integration
  async checkSlackStatus(): Promise<{ connected: boolean }> {
    return await this.channelManager.checkSlackStatus()
  }

  async connectSlack(botToken: string, appToken: string, name?: string): Promise<{ success: boolean; error?: string }> {
    return await this.channelManager.connectSlackBot(botToken, appToken, name)
  }

  async testSlack(botToken: string): Promise<{ success: boolean; teamName?: string; botName?: string; error?: string }> {
    return await this.channelManager.testSlackBotToken(botToken)
  }

  async disconnectSlack(): Promise<{ success: boolean; logs: string[] }> {
    return await this.channelManager.disconnectSlack()
  }

  // Feishu Integration
  async checkFeishuStatus(): Promise<{ connected: boolean }> {
    return await this.channelManager.checkFeishuStatus()
  }

  async connectFeishu(appId: string, appSecret: string, botName?: string): Promise<{ success: boolean; error?: string }> {
    return await this.channelManager.connectFeishu(appId, appSecret, botName)
  }

  async disconnectFeishu(): Promise<{ success: boolean; logs: string[] }> {
    return await this.channelManager.disconnectFeishu()
  }

  // Line Integration
  async checkLineStatus(): Promise<{ connected: boolean }> {
    return await this.channelManager.checkLineStatus()
  }

  async connectLine(channelAccessToken: string, channelSecret: string): Promise<{ success: boolean; error?: string }> {
    return await this.channelManager.connectLine(channelAccessToken, channelSecret)
  }

  async disconnectLine(): Promise<{ success: boolean; logs: string[] }> {
    return await this.channelManager.disconnectLine()
  }

  // Agent Management (delegated to ChannelManager)
  async listAgents(): Promise<any[]> {
    try {
      if (!await this.configManager.configExists()) {
        console.log('[OpenClawManager] Config file not found, returning empty agents list');
        return [];
      }

      const config = await this.configManager.loadConfig();
      const agents = listAgents(config);
      console.log('[OpenClawManager] Found agents in config:', agents.length);

      // Last-resort fallback when openclaw.json has no default model
      // configured yet. Sourced from the catalog so it tracks renames.
      // Was `defaultByokAgentModelId('anthropic')` before Anthropic was
      // removed as a BYOK provider on 2026-06-15.
      const defaultModel = config.agents?.defaults?.model?.primary || defaultByokAgentModelId('openai');
      const fallbackModels = config.agents?.defaults?.model?.fallbacks || [];

      return agents.map((agent: any) => ({
        id: agent.id,
        name: agent.name || agent.id,
        workspace: agent.workspace,
        agentDir: agent.agentDir,
        model: agent.model?.primary || defaultModel,
        fallbacks: agent.model?.fallbacks || fallbackModels,
        status: 'active'
      }));
    } catch (error) {
      console.error('[OpenClawManager] Error reading agents from config:', error);
      return [];
    }
  }

  async getAgentInfo(agentId: string): Promise<any> {
    return await this.channelManager.getAgentInfo(agentId)
  }

  async createAgent(agentName: string, config: any): Promise<{ success: boolean; error?: string }> {
    return await this.channelManager.createAgent(agentName, config)
  }

  async updateAgent(agentId: string, config: any): Promise<{ success: boolean; error?: string; prevModel?: string }> {
    return await this.channelManager.updateAgent(agentId, config)
  }

  async deleteAgent(agentId: string): Promise<{ success: boolean; error?: string }> {
    return await this.channelManager.deleteAgent(agentId)
  }

  // Configuration Management (delegated to ConfigManager)
  async validateApiKey(provider: string, apiKey: string): Promise<boolean> {
    return await this.configManager.validateApiKey(provider, apiKey)
  }

  /**
   * Configure a BYOK provider by writing its full provider+model block to
   * openclaw.json. Single-source-of-truth implementation: delegates to
   * ConfigManager.applyProviderToOpenClaw which uses BYOK_PROVIDER_MODELS
   * (kept up-to-date in src/shared/providerModels.ts) so the model list
   * never drifts. The legacy Google special-case in this method previously
   * pinned its own gemini-2.5-flash list and silently shadowed the
   * up-to-date catalog whenever this code path ran.
   */
  async setApiKey(provider: string, apiKey: string): Promise<{ success: boolean; error?: string }> {
    try {
      const isValid = await this.validateApiKey(provider, apiKey)
      if (!isValid) {
        return { success: false, error: `Invalid ${provider} API key format` }
      }

      // Build a minimal AppProviderConfig and let applyProviderToOpenClaw do
      // the actual work — it knows the full model catalog, normalizes the
      // primary model, runs the orphan-repair, and writes atomically.
      // Anthropic removed 2026-06-15 — direct sk-ant-* keys aren't
      // authorized for OpenClaw clients. Claude is still reachable via
      // the OpenRouter aggregator.
      const supportedByokProviders = ['google', 'openai', 'venice', 'openrouter'] as const
      type ByokProvider = typeof supportedByokProviders[number]
      if (!supportedByokProviders.includes(provider as ByokProvider)) {
        return { success: false, error: `Unsupported provider: ${provider}` }
      }
      const byokProvider = provider as ByokProvider

      const existingAppConfig = (await this.configManager.getAppConfig()) ?? {}
      const merged = {
        aiProvider: 'byok' as const,
        ...existingAppConfig,
        byok: {
          provider: byokProvider,
          // Preserve previously selected model if it's for this same provider;
          // otherwise let applyProviderToOpenClaw pick the default.
          model: existingAppConfig?.byok?.provider === byokProvider
            ? (existingAppConfig.byok?.model ?? '')
            : '',
          apiKeys: {
            ...(existingAppConfig?.byok?.apiKeys ?? {}),
            [byokProvider]: apiKey,
          },
        },
      }

      await this.configManager.applyProviderToOpenClaw(merged)
      // Switching the default model invalidates the per-agent
      // `agentRuntime.id` cache: agents that inherit from defaults need
      // their harness re-resolved (e.g. GPT-5 → Claude must flip codex
      // → pi, or the codex harness's GPT-5 persona-latch will mis-
      // identify the new model on the first message).
      await this.channelManager.repairAgentHarnesses()
      this.logger.addLog(`✅ ${provider} API key configured successfully`)
      return { success: true }
    } catch (error: any) {
      console.error('[OpenClawManager] Set API key error:', error)
      this.logger.addLog(`❌ Failed to set ${provider} API key: ${error.message}`)
      return { success: false, error: error.message }
    }
  }

  async getApiKey(provider: string): Promise<{ success: boolean; apiKey?: string; error?: string }> {
    try {
      const command = ['config', 'get', `${provider}.api_key`]
      const result = await this.executor.executeCommand(command)

      if (result && result.trim()) {
        const maskedKey = result.length > 10
          ? result.substring(0, 6) + '...' + result.substring(result.length - 4)
          : '***'

        return {
          success: true,
          apiKey: maskedKey
        }
      } else {
        return {
          success: true,
          apiKey: ''
        }
      }

    } catch (error: any) {
      console.error('[OpenClawManager] Get API key error:', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  async generateConfig(config: any): Promise<void> {
    await this.configManager.generateConfig(config, this.gatewayPort)
  }

  async createDefaultConfig(): Promise<void> {
    await this.configManager.createDefaultConfig(this.gatewayPort)
  }

  async configExists(): Promise<boolean> {
    return await this.configManager.configExists()
  }

  // Removed: the @deprecated `updateOpenClawConfig` method (and its
  // `config:update-openclaw` IPC handler + preload binding). It had no
  // active callers and carried a hardcoded models list (gpt-4.1, gpt-4o,
  // claude-opus-4-6, etc.) that had drifted far behind providerModels.ts.
  // The canonical write path is `config:save` (main/index.ts) →
  // `configManager.applyProviderToOpenClaw`, which always uses the
  // catalog in shared/providerModels.ts as the single source of truth.

  // Legacy methods for compatibility
  async getOpenClawInstallations(): Promise<any[]> {
    // Use app.getVersion() so this stays in sync with the actual shipped
    // version (read from package.json at build time). Hardcoding here
    // meant the legacy diagnostic endpoint reported the wrong version
    // forever after every release.
    const { app } = await import('electron')
    return [{
      path: 'system-global',
      version: app.getVersion(),
      installMethod: 'npm-global',
      isProductionVersion: true
    }]
  }

  async uninstallOpenClaw(): Promise<boolean> {
    this.logger.addLog('ℹ️ OpenClaw is embedded in Openclaw Easy and cannot be uninstalled')
    return false
  }

  async installOpenClaw(): Promise<boolean> {
    this.logger.addLog('ℹ️ OpenClaw is already embedded in Openclaw Easy')
    return true
  }

  async checkOpenClawUpdates(): Promise<any> {
    return {
      currentVersion: '2026.3.15',
      latestVersion: '2026.3.15',
      updateAvailable: false,
      updateCommand: 'Updates are included with Openclaw Easy updates'
    }
  }

  async setupOpenClaw(): Promise<boolean> {
    if (!await this.configManager.configExists()) {
      await this.configManager.createDefaultConfig(this.gatewayPort)
      return true
    }
    return true
  }

  // Skills Management (delegated to SkillsManager)
  async listSkills(): Promise<{ success: boolean; skills?: any[]; error?: string }> {
    return await this.skillsManager.listSkills()
  }

  /** Resolve a skill name to a folder path, or null if not found anywhere. */
  async resolveSkillFolderPath(skillName: string): Promise<string | null> {
    return await this.skillsManager.resolveSkillFolderPath(skillName)
  }

  // `checkSkills` and `getSkillInfo` wrappers (and their `skills:check` /
  // `skills:info` IPC routes + preload bindings) were removed: nothing in
  // the renderer called them. `SkillsManager.getSkillInfo` is still used
  // internally by `installSkillRequirements`.

  async installSkillRequirements(skillName: string): Promise<{ success: boolean; message?: string; error?: string }> {
    return await this.skillsManager.installSkillRequirements(skillName)
  }

  async setSkillEnabled(skillName: string, enabled: boolean): Promise<{ success: boolean; error?: string }> {
    return await this.skillsManager.setSkillEnabled(skillName, enabled)
  }

  async searchSkillRegistry(query: string) {
    return await this.skillsManager.searchRegistry(query)
  }

  async installSkillFromRegistry(slug: string) {
    const result = await this.skillsManager.installFromRegistry(slug)
    if (result.success) {
      await this.skillsManager.clearSkillsSnapshots()
    }
    return result
  }

  async removeSkill(skillName: string) {
    const result = await this.skillsManager.removeSkill(skillName)
    if (result.success) {
      await this.skillsManager.clearSkillsSnapshots()
    }
    return result
  }

  async listWorkspaceSkills() {
    return await this.skillsManager.listWorkspaceSkills()
  }

  async checkSkills(agentId?: string) {
    return await this.skillsManager.checkSkills(agentId)
  }

  async updateAllSkills() {
    const result = await this.skillsManager.updateAllSkills()
    if (result.success) {
      await this.skillsManager.clearSkillsSnapshots()
    }
    return result
  }

  // Hooks Management (delegated to HooksManager)
  async listHooks(): Promise<{ success: boolean; hooks?: any[]; error?: string }> {
    return await this.hooksManager.listHooks()
  }

  async checkHooks(): Promise<{ success: boolean; status?: any; error?: string }> {
    return await this.hooksManager.checkHooks()
  }

  async getHookInfo(hookName: string): Promise<{ success: boolean; info?: any; error?: string }> {
    return await this.hooksManager.getHookInfo(hookName)
  }

  async setHookEnabled(hookName: string, enabled: boolean): Promise<{ success: boolean; error?: string }> {
    return await this.hooksManager.setHookEnabled(hookName, enabled)
  }

  async installHook(hookSpec: string): Promise<{ success: boolean; message?: string; error?: string }> {
    return await this.hooksManager.installHook(hookSpec)
  }

  // Plugins Management (delegated to PluginsManager)
  async listPlugins(): Promise<{ success: boolean; plugins?: any[]; error?: string }> {
    return await this.pluginsManager.listPlugins()
  }

  async getPluginInfo(pluginId: string): Promise<{ success: boolean; info?: any; error?: string }> {
    return await this.pluginsManager.getPluginInfo(pluginId)
  }

  async enablePlugin(pluginId: string): Promise<{ success: boolean; error?: string }> {
    return await this.pluginsManager.enablePlugin(pluginId)
  }

  async disablePlugin(pluginId: string): Promise<{ success: boolean; error?: string }> {
    return await this.pluginsManager.disablePlugin(pluginId)
  }

  async installPlugin(pluginSpec: string): Promise<{ success: boolean; message?: string; error?: string }> {
    return await this.pluginsManager.installPlugin(pluginSpec)
  }

  async updatePlugin(pluginId: string): Promise<{ success: boolean; message?: string; error?: string }> {
    return await this.pluginsManager.updatePlugin(pluginId)
  }

  async runPluginsDoctor(): Promise<{ success: boolean; results?: any; error?: string }> {
    return await this.pluginsManager.runPluginsDoctor()
  }

  // Cron Management (delegated to CronManager)
  async listCronJobs(): Promise<{ success: boolean; jobs?: CronJob[]; error?: string }> {
    return await this.cronManager.listCronJobs()
  }

  async addCronJob(params: AddCronJobParams): Promise<{ success: boolean; job?: CronJob; error?: string }> {
    return await this.cronManager.addCronJob(params)
  }

  async enableCronJob(id: string): Promise<{ success: boolean; error?: string }> {
    return await this.cronManager.enableCronJob(id)
  }

  async disableCronJob(id: string): Promise<{ success: boolean; error?: string }> {
    return await this.cronManager.disableCronJob(id)
  }

  async removeCronJob(id: string): Promise<{ success: boolean; error?: string }> {
    return await this.cronManager.removeCronJob(id)
  }

  async runCronJob(id: string): Promise<{ success: boolean; error?: string }> {
    return await this.cronManager.runCronJob(id)
  }

  async getCronRuns(id: string, limit?: number): Promise<{ success: boolean; runs?: any[]; error?: string }> {
    return await this.cronManager.getCronRuns(id, limit)
  }

  // Doctor Management (delegated to DoctorManager)
  async runDoctor(): Promise<{
    success: boolean;
    output: string;
    errors: string;
    problemsFound: number;
    problemsFixed: number;
    error?: string;
  }> {
    return await this.doctorManager.runDoctor()
  }

  /**
   * Discover the top-level commands the system openclaw CLI exposes by
   * running `openclaw --help` and parsing its Commands: block.
   *
   * Powers the Commands page's "More from CLI" section — surfaces commands
   * shipped by upstream after our static catalog was authored (acp,
   * commitments, crestodian, message, onboard, …) so users don't have to
   * wait for a desktop release just to access them. Pure-parser at the
   * helper layer; this method owns the spawn + caching.
   *
   * Single-flight cached for the process lifetime: `openclaw --help` is
   * stable across a session and the spawn cost is ~200ms, which would
   * stack up on every Commands tab switch.
   */
  async listDiscoveredCommands(): Promise<{
    success: boolean;
    commands?: DiscoveredCommand[];
    error?: string;
  }> {
    if (this.discoveredCommandsCache) return this.discoveredCommandsCache
    try {
      const output = await this.executor.executeCommand(['--help'], 10000)
      if (!output) {
        return { success: false, error: 'openclaw --help returned no output' }
      }
      const commands = parseOpenClawHelp(output)
      const result = { success: true, commands }
      this.discoveredCommandsCache = result
      return result
    } catch (error: any) {
      return { success: false, error: error?.message || 'Unknown error' }
    }
  }

  // Statistics Management (delegated to StatisticsManager)
  async getDashboardStatistics(): Promise<{
    success: boolean;
    statistics?: {
      messagesToday: number;
      activeChannels: number;
      responseTime: string;
      uptime: string;
      trend: {
        messagesToday: number;
        activeChannels: number;
        responseTime: number;
        uptime: number;
      };
    };
    error?: string;
  }> {
    return await this.statisticsManager.getDashboardStatistics()
  }

  // Agent Binding Management (delegated to AgentBindingManager)
  async listAgentBindings(): Promise<any> {
    return await this.agentBindingManager.listAgentBindings()
  }

  async addAgentBinding(binding: any): Promise<any> {
    return await this.agentBindingManager.addAgentBinding(binding)
  }

  async removeAgentBinding(agentId: string, channel: string): Promise<any> {
    return await this.agentBindingManager.removeAgentBinding(agentId, channel)
  }

  async updateAgentBindings(bindings: any[]): Promise<any> {
    return await this.agentBindingManager.updateAgentBindings(bindings)
  }

  async testAgentRouting(params: any): Promise<any> {
    return await this.agentBindingManager.testAgentRouting(params)
  }

  async getSessionConfig(): Promise<any> {
    return await this.agentBindingManager.getSessionConfig()
  }

  async updateSessionConfig(sessionConfig: any): Promise<any> {
    return await this.agentBindingManager.updateSessionConfig(sessionConfig)
  }

  destroy() {
    this.processManager.destroy()
    this.channelManager.destroy()
    this.logger.destroy()
  }
}
