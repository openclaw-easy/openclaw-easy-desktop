import * as path from 'path'
import * as os from 'os'
import { BrowserWindow } from 'electron'
import { createProcessManager, ProcessManager, ProcessStatus } from './process-manager.js'
import { ProcessManagerWindows } from './process-manager-windows.js'
import { ChannelManager } from './channel-manager.js'
import { OpenClawEnvironment } from './openclaw-environment'
import { Logger } from './managers/logger'
import { OpenClawCommandExecutor } from './managers/openclaw-command-executor'
import { OpenClawCommandExecutorWindows } from './managers/openclaw-command-executor-windows'
import { ConfigManager } from './managers/config-manager'
import { AgentBindingManager } from './managers/agent-binding-manager'
import { SkillsManager } from './managers/skills-manager'
import { HooksManager } from './managers/hooks-manager'
import { PluginsManager } from './managers/plugins-manager'
import { CronManager, AddCronJobParams, CronJob } from './managers/cron-manager'
import { DoctorManager } from './managers/doctor-manager'
import { StatisticsManager } from './managers/statistics-manager'

// Unified executor interface — both implementations expose executeCommand()
type CommandExecutor = { executeCommand(args: string[], timeoutMs?: number): Promise<string | null> }

export class OpenClawManager {
  private processManager: ProcessManager
  private channelManager: ChannelManager
  private openclawEnv: OpenClawEnvironment
  private gatewayPort: number = 18800  // Track active gateway port (desktop app range: 18800-18809)
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

    this.agentBindingManager = new AgentBindingManager()
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
    this.processManager.setMainWindow(window)
    this.channelManager.setMainWindow(window)
  }

  // Process Management
  async start(): Promise<boolean> {
    this.logger.addLog('=== Starting Desktop OpenClaw Gateway ===')

    const configPath = this.getConfigPath()
    console.log(`[OpenClawManager] Config path: ${configPath}`)

    // Ensure config exists
    if (!await this.configManager.configExists()) {
      this.logger.addLog('⚠️ No OpenClaw configuration found, creating default config...')
      await this.configManager.createDefaultConfig(this.gatewayPort)
    } else {
      this.logger.addLog('✅ Using existing OpenClaw configuration')
      // Even with existing config, ensure tools are properly configured
      await this.configManager.ensureToolsConfigured()
      // Clean up invalid tool names from existing configs
      await this.configManager.cleanupInvalidToolNames()
    }

    // Validate and repair config before gateway startup.
    // Catches corruption from external processes (CLI, gateway doctor, manual edits)
    // that would otherwise crash the gateway (e.g. channels.discord.token = true).
    await this.configManager.loadAndValidateConfig()

    this.logger.addLog('ℹ️ Doctor diagnostics available - click "Run Doctor" button if needed')
    this.logger.addLog('🚀 Starting desktop OpenClaw gateway...')

    // Always try to start our own gateway first
    const existingStatus = this.processManager.getStatus()
    if (existingStatus === 'running') {
      this.logger.addLog('✅ Desktop OpenClaw gateway is already running')
      return true
    }

    // Start new gateway (this will handle clearing conflicts and configure the port)
    this.logger.addLog('🖥️ Starting desktop-managed OpenClaw gateway...')
    const result = await this.processManager.start()

    if (result) {
      this.gatewayPort = this.processManager.getActivePort() || 18800
      this.logger.addLog(`✅ Desktop OpenClaw gateway started successfully on port ${this.gatewayPort}`)
      this.logger.addLog('🌐 Desktop gateway ready - all channels will run in desktop-controlled process')
      console.log(`[OpenClawManager] Using desktop gateway on port ${this.gatewayPort}`)

      // On Windows, share the detected WSL2 distro with the command executor
      if (process.platform === 'win32') {
        const wsl2Info = (this.processManager as ProcessManagerWindows).getWSL2Info()
        if (wsl2Info) {
          (this.executor as OpenClawCommandExecutorWindows).setWSLDistro(wsl2Info.distro)
        }
      }

      // Update configuration with the actual port being used
      await this.configManager.updateGatewayPort(this.gatewayPort)
      return true
    }

    this.logger.addLog('❌ Failed to start desktop OpenClaw gateway')
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

    const result = await this.processManager.restart()

    if (result) {
      this.logger.addLog('✅ OpenClaw gateway restarted successfully')
    } else {
      this.logger.addLog('⚠️ Failed to restart OpenClaw gateway')
    }

    return result
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

  isRunning(): boolean {
    return this.processManager.isRunning()
  }

  getActivePort(): number {
    return this.gatewayPort
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
      const agents = config.agents?.list || [];
      console.log('[OpenClawManager] Found agents in config:', agents.length);

      const defaultModel = config.agents?.defaults?.model?.primary || 'anthropic/claude-sonnet-4-5';
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

  async setApiKey(provider: string, apiKey: string): Promise<{ success: boolean; error?: string }> {
    try {
      const isValid = await this.validateApiKey(provider, apiKey)
      if (!isValid) {
        return {
          success: false,
          error: `Invalid ${provider} API key format`
        }
      }

      // Google configuration
      if (provider === 'google') {
        // Write the entire provider config directly to avoid validation issues
        try {
          const currentConfig = await this.configManager.loadConfig()

          // Ensure models structure exists
          currentConfig.models = currentConfig.models || {}
          currentConfig.models.providers = currentConfig.models.providers || {}

          // Set the Google provider config using stable model aliases
          // These aliases (gemini-flash-latest, gemini-pro-latest) automatically point to
          // the newest versions, making the app forward-compatible with new Google releases
          currentConfig.models.providers.google = {
            baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
            api: 'google-generative-ai',
            apiKey: apiKey,
            headers: {
              'X-goog-api-key': apiKey
            },
            models: [
              { id: 'gemini-2.5-flash',      name: 'Gemini 2.5 Flash',      reasoning: false, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 8192  },
              { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', reasoning: false, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 8192  },
              { id: 'gemini-2.5-pro',        name: 'Gemini 2.5 Pro',        reasoning: true,  input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 65536 },
              { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (Preview)', reasoning: false, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 8192  },
            ]
          }

          // Also set the default model to Google Gemini if not already set
          // Use the stable 'latest' alias for forward compatibility
          currentConfig.agents = currentConfig.agents || {}
          currentConfig.agents.defaults = currentConfig.agents.defaults || {}
          currentConfig.agents.defaults.model = currentConfig.agents.defaults.model || {}

          // IMPORTANT: Preserve agents.list if it exists, or create default "main" agent
          if (!currentConfig.agents.list || currentConfig.agents.list.length === 0) {
            currentConfig.agents.list = [{ id: 'main' }]
          }

          if (!currentConfig.agents.defaults.model.primary?.startsWith('google/')) {
            currentConfig.agents.defaults.model.primary = 'google/gemini-2.5-flash'
          }

          await this.configManager.writeConfig(currentConfig)

          this.logger.addLog(`✅ ${provider} API key configured successfully`)
          return { success: true }
        } catch (error: any) {
          console.error('[OpenClawManager] Failed to configure Google:', error)
          this.logger.addLog(`❌ Failed to configure ${provider}: ${error.message}`)
          return {
            success: false,
            error: error.message
          }
        }
      }

      // For other providers (openai, anthropic), use the old method
      const command = ['config', 'set', `${provider}.api_key`, apiKey]
      await this.executor.executeCommand(command)

      this.logger.addLog(`✅ ${provider} API key configured successfully`)
      return { success: true }

    } catch (error: any) {
      console.error('[OpenClawManager] Set API key error:', error)
      this.logger.addLog(`❌ Failed to set ${provider} API key: ${error.message}`)
      return {
        success: false,
        error: error.message
      }
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

  async updateOpenClawConfig(config: any): Promise<boolean> {
    try {
      const currentConfig = await this.configManager.loadConfig()

      // Ensure models structure exists
      currentConfig.models = currentConfig.models || {}
      currentConfig.models.providers = currentConfig.models.providers || {}

      // Ensure auth structure exists
      currentConfig.auth = currentConfig.auth || {}
      currentConfig.auth.profiles = currentConfig.auth.profiles || {}

      // Ensure agents structure exists
      currentConfig.agents = currentConfig.agents || {}
      currentConfig.agents.defaults = currentConfig.agents.defaults || {}
      currentConfig.agents.defaults.model = currentConfig.agents.defaults.model || {}

      if (config.provider === 'byok' && config.selectedProvider) {
        if (config.selectedProvider === 'openai' && config.apiKeys?.openai) {
          currentConfig.models.providers.openai = {
            baseUrl: 'https://api.openai.com/v1',
            apiKey: config.apiKeys.openai,
            api: 'openai-responses',
            models: [
              { id: 'gpt-4.1',      name: 'GPT-4.1',      reasoning: false, input: ['text', 'image'], cost: { input: 0.002,   output: 0.008,  cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 32768 },
              { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', reasoning: false, input: ['text', 'image'], cost: { input: 0.0004,  output: 0.0016, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 32768 },
              { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', reasoning: false, input: ['text', 'image'], cost: { input: 0.0001,  output: 0.0004, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 32768 },
              { id: 'o3',           name: 'o3',           reasoning: true,  input: ['text', 'image'], cost: { input: 0.01,    output: 0.04,   cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000,  maxTokens: 100000 },
              { id: 'o4-mini',      name: 'o4-mini',      reasoning: true,  input: ['text', 'image'], cost: { input: 0.0011,  output: 0.0044, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000,  maxTokens: 100000 },
              { id: 'gpt-4o',       name: 'GPT-4o',       reasoning: false, input: ['text', 'image'], cost: { input: 0.0025,  output: 0.01,   cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000,  maxTokens: 16384  },
              { id: 'gpt-4o-mini',  name: 'GPT-4o Mini',  reasoning: false, input: ['text', 'image'], cost: { input: 0.00015, output: 0.0006, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000,  maxTokens: 16384  },
            ]
          }
          currentConfig.agents.defaults.model.primary = 'openai/gpt-4.1'
        } else if (config.selectedProvider === 'anthropic' && config.apiKeys?.anthropic) {
          currentConfig.models.providers.anthropic = {
            baseUrl: 'https://api.anthropic.com/v1',
            apiKey: config.apiKeys.anthropic,
            api: 'anthropic-messages',
            models: [
              { id: 'claude-opus-4-6',   name: 'Claude Opus 4.6',   reasoning: true, input: ['text', 'image'], cost: { input: 0.005, output: 0.025, cacheRead: 0.0005, cacheWrite: 0.00125 }, contextWindow: 200000, maxTokens: 128000 },
              { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', reasoning: true, input: ['text', 'image'], cost: { input: 0.003, output: 0.015, cacheRead: 0.0003, cacheWrite: 0.00075 }, contextWindow: 200000, maxTokens: 64000  },
              { id: 'claude-haiku-4-5',  name: 'Claude Haiku 4.5',  reasoning: true, input: ['text', 'image'], cost: { input: 0.001, output: 0.005, cacheRead: 0.0001, cacheWrite: 0.00025 }, contextWindow: 200000, maxTokens: 64000  },
            ]
          }
          currentConfig.agents.defaults.model.primary = 'anthropic/claude-sonnet-4-6'
        } else if (config.selectedProvider === 'google' && config.apiKeys?.google) {
          currentConfig.models.providers.google = {
            baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
            api: 'google-generative-ai',
            apiKey: config.apiKeys.google,
            headers: { 'X-goog-api-key': config.apiKeys.google },
            models: [
              {
                id: 'gemini-2.5-flash',
                name: 'Gemini 2.5 Flash',
                reasoning: false,
                input: ['text', 'image'],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 1000000,
                maxTokens: 8192
              }
            ]
          }
          currentConfig.agents.defaults.model.primary = 'google/gemini-2.5-flash'
        }
      } else if (config.provider === 'local') {
        currentConfig.models.providers.ollama = {
          baseUrl: 'http://localhost:11434/v1',
          apiKey: 'ollama',
          api: 'openai-responses',
          models: [
            {
              id: 'qwen3:latest',
              name: 'Qwen 3',
              reasoning: false,
              input: ['text'],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 32768,
              maxTokens: 2048
            }
          ]
        }
        if (!currentConfig.agents.defaults.model.primary?.startsWith('ollama/')) {
          currentConfig.agents.defaults.model.primary = 'ollama/qwen3:latest'
        }
      }

      await this.configManager.writeConfig(currentConfig)

      if (this.isRunning()) {
        await this.restart()
      }

      return true
    } catch (error) {
      console.error('[OpenClawManager] Failed to update config:', error)
      return false
    }
  }
  // Legacy methods for compatibility
  async getOpenClawInstallations(): Promise<any[]> {
    return [{
      path: 'system-global',
      version: '2026.2.1',
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
      currentVersion: '2026.1.30',
      latestVersion: '2026.1.30',
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

  async checkSkills(): Promise<{ success: boolean; status?: any; error?: string }> {
    return await this.skillsManager.checkSkills()
  }

  async getSkillInfo(skillName: string): Promise<{ success: boolean; info?: any; error?: string }> {
    return await this.skillsManager.getSkillInfo(skillName)
  }

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
