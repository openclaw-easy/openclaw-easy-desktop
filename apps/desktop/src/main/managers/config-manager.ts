import * as path from 'path'
import * as os from 'os'
import { app } from 'electron'
import { existsSync } from 'fs'
import { readFile, writeFile, mkdir, copyFile } from 'fs/promises'
import { Logger } from './logger'
import { BYOK_PROVIDER_MODELS } from '../../shared/providerModels'

export interface AppProviderConfig {
  aiProvider: 'byok' | 'local'
  byok?: {
    provider: 'google' | 'anthropic' | 'openai' | 'venice' | 'openrouter'
    model: string  // e.g. 'gemini-flash-latest', 'claude-sonnet-4-5', 'gpt-4o'
    apiKeys?: {
      google?: string
      anthropic?: string
      openai?: string
      venice?: string
      openrouter?: string
    }
  }
  local?: {
    model: string  // e.g. 'llama3.2:3b', 'qwen3:latest'
  }
  stt?: {
    provider: 'local' | 'openai' | 'google'
    openaiApiKey?: string
    googleApiKey?: string
    localEndpoint?: string  // e.g. 'http://localhost:8000'
    localModel?: string     // e.g. 'Systran/faster-whisper-large-v3'
  }
}

/**
 * ConfigManager - Manages OpenClaw configuration files
 */
export class ConfigManager {
  private logger?: Logger
  private configPath: string
  private appConfigPath: string
  // Serializes all writes to openclaw.json so concurrent IPC handlers
  // (e.g. config:save and auth:sync-remote-backend) never interleave writes
  // and corrupt the file.
  private writeLock: Promise<void> = Promise.resolve()

  constructor(logger?: Logger) {
    this.logger = logger
    this.configPath = this.getConfigPath()
    this.appConfigPath = this.getAppConfigPath()
  }

  private withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeLock.then(fn)
    // Keep the lock chain alive even if fn throws, so subsequent callers still run
    this.writeLock = next.then(() => {}, () => {})
    return next
  }

  getAppConfigPath(): string {
    const userHome = app.getPath('home')
    // Desktop app-specific config (auth token, UI preferences, etc.)
    // Separate from OpenClaw's main config
    return path.join(userHome, '.config', 'openclaw-desktop', 'app-config.json')
  }

  getConfigPath(): string {
    const userHome = app.getPath('home')
    // Use the standard OpenClaw directory for consistency across all components
    return path.join(userHome, '.openclaw', 'openclaw.json')
  }

  async loadConfig(): Promise<any> {
    try {
      const content = await readFile(this.configPath, 'utf8')
      return JSON.parse(content)
    } catch (error) {
      return {}
    }
  }

  async getAppConfig(): Promise<any | null> {
    try {
      if (!existsSync(this.appConfigPath)) {
        return null
      }
      const configData = await readFile(this.appConfigPath, 'utf-8')
      const config = JSON.parse(configData)
      return config
    } catch (error) {
      console.error('Failed to read app config:', error)
      return null
    }
  }

  async saveAppConfig(config: any): Promise<void> {
    try {
      const configDir = path.dirname(this.appConfigPath)
      if (!existsSync(configDir)) {
        await mkdir(configDir, { recursive: true })
      }
      const configToWrite = { ...config }
      await writeFile(this.appConfigPath, JSON.stringify(configToWrite, null, 2), 'utf-8')
      console.log('App config saved:', this.appConfigPath)
    } catch (error) {
      console.error('Failed to save app config:', error)
      throw error
    }
  }

  /**
   * Validate config before writing to catch issues early
   * Returns validated config with auto-repairs applied
   */
  private validateAndRepairConfig(config: any): { config: any; warnings: string[] } {
    const warnings: string[] = []
    const repaired = { ...config }

    // ── Agents ──
    if (!repaired.agents) {
      repaired.agents = {}
      warnings.push('Created missing agents structure')
    }
    if (!repaired.agents.list || !Array.isArray(repaired.agents.list) || repaired.agents.list.length === 0) {
      repaired.agents.list = [{ id: 'main' }]
      warnings.push('Created missing agents.list with default "main" agent')
    }
    if (!repaired.agents.defaults) {
      repaired.agents.defaults = {}
      warnings.push('Created missing agents.defaults structure')
    }
    if (!repaired.agents.defaults.model) {
      repaired.agents.defaults.model = {}
      warnings.push('Created missing agents.defaults.model structure')
    }
    if (!repaired.agents.defaults.model.primary) {
      warnings.push('WARNING: agents.defaults.model.primary is not set - agent may not work correctly')
    }

    // Detect and repair mismatched provider/model combinations
    const primaryModel = repaired.agents.defaults.model.primary
    if (primaryModel && typeof primaryModel === 'string') {
      const [provider, modelId] = primaryModel.split('/')
      if (provider && modelId) {
        let fixedModel = primaryModel
        if (modelId.startsWith('gemini') && provider !== 'google') {
          fixedModel = `google/${modelId}`
        } else if (modelId.startsWith('claude') && provider !== 'anthropic' && provider !== 'openai') {
          fixedModel = `anthropic/${modelId}`
        } else if ((modelId.startsWith('gpt') || modelId.startsWith('o')) && provider !== 'openai') {
          fixedModel = `openai/${modelId}`
        }
        if (fixedModel !== primaryModel) {
          repaired.agents.defaults.model.primary = fixedModel
          warnings.push(`🔧 Fixed mismatched model: "${primaryModel}" → "${fixedModel}"`)
        }
      }
    }

    // ── Gateway ──
    if (!repaired.gateway) {
      repaired.gateway = {}
      warnings.push('Created missing gateway structure')
    }
    if (!repaired.gateway.mode) {
      repaired.gateway.mode = 'local'
      warnings.push('Set gateway.mode to default "local"')
    }
    if (!repaired.gateway.port) {
      repaired.gateway.port = 18800
      warnings.push('Set gateway.port to default 18800')
    }

    // ── Channels — each entry must be an object; credential fields must be non-empty strings ──
    // The gateway zod validator rejects non-object channel entries and non-string tokens.
    if (repaired.channels && typeof repaired.channels === 'object') {
      const credentialFields = ['token', 'apiKey', 'apiSecret', 'webhook', 'botToken', 'signingSecret', 'appToken']
      for (const [channelName, channelConfig] of Object.entries(repaired.channels)) {
        // Channel entry must be an object (e.g. { token: "...", ... }).
        // Non-object values like `true`, `false`, `"string"`, `null` are invalid.
        if (!channelConfig || typeof channelConfig !== 'object' || Array.isArray(channelConfig)) {
          delete (repaired.channels as any)[channelName]
          warnings.push(`🔧 Removed invalid channels.${channelName} (expected object, got ${channelConfig === null ? 'null' : typeof channelConfig})`)
          continue
        }
        for (const field of credentialFields) {
          const value = (channelConfig as any)[field]
          if (value === undefined) continue
          if (typeof value !== 'string') {
            delete (channelConfig as any)[field]
            warnings.push(`🔧 Removed invalid channels.${channelName}.${field} (expected string, got ${typeof value})`)
          } else if (value.trim() === '') {
            delete (channelConfig as any)[field]
            warnings.push(`🔧 Removed empty channels.${channelName}.${field}`)
          }
        }
      }
    }

    // ── Plugins — each entry must be an object; enabled must be boolean ──
    if (repaired.plugins?.entries && typeof repaired.plugins.entries === 'object') {
      for (const [pluginId, entry] of Object.entries(repaired.plugins.entries)) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          delete repaired.plugins.entries[pluginId]
          warnings.push(`🔧 Removed invalid plugins.entries.${pluginId} (expected object, got ${entry === null ? 'null' : typeof entry})`)
          continue
        }
        const enabled = (entry as any).enabled
        if (enabled !== undefined && typeof enabled !== 'boolean') {
          // Coerce truthy string values ("true", "1") to boolean, remove anything else
          if (enabled === 'true' || enabled === '1') {
            (entry as any).enabled = true
          } else if (enabled === 'false' || enabled === '0') {
            (entry as any).enabled = false
          } else {
            delete (entry as any).enabled
            warnings.push(`🔧 Removed invalid plugins.entries.${pluginId}.enabled (expected boolean, got ${typeof enabled})`)
          }
        }
      }
    }

    // ── Skills — each entry must be an object; enabled must be boolean ──
    if (repaired.skills?.entries && typeof repaired.skills.entries === 'object') {
      for (const [skillName, entry] of Object.entries(repaired.skills.entries)) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          delete repaired.skills.entries[skillName]
          warnings.push(`🔧 Removed invalid skills.entries.${skillName} (expected object, got ${entry === null ? 'null' : typeof entry})`)
          continue
        }
        const enabled = (entry as any).enabled
        if (enabled !== undefined && typeof enabled !== 'boolean') {
          if (enabled === 'true' || enabled === '1') {
            (entry as any).enabled = true
          } else if (enabled === 'false' || enabled === '0') {
            (entry as any).enabled = false
          } else {
            delete (entry as any).enabled
            warnings.push(`🔧 Removed invalid skills.entries.${skillName}.enabled (expected boolean, got ${typeof enabled})`)
          }
        }
      }
    }

    // ── Models — provider configs must have string apiKey/baseUrl ──
    if (repaired.models?.providers && typeof repaired.models.providers === 'object') {
      for (const [providerName, providerConfig] of Object.entries(repaired.models.providers)) {
        if (!providerConfig || typeof providerConfig !== 'object') continue
        for (const field of ['apiKey', 'baseUrl']) {
          const value = (providerConfig as any)[field]
          if (value !== undefined && typeof value !== 'string') {
            delete (providerConfig as any)[field]
            warnings.push(`🔧 Removed invalid models.providers.${providerName}.${field} (expected string, got ${typeof value})`)
          }
        }
      }
    }

    return { config: repaired, warnings }
  }

  /**
   * Load config and validate/repair it. Use this before gateway startup
   * to catch corruption from external processes (CLI, gateway doctor, etc.).
   * Only writes back to disk if repairs were actually needed.
   */
  async loadAndValidateConfig(): Promise<any> {
    const config = await this.loadConfig()
    const { config: repaired, warnings } = this.validateAndRepairConfig(config)

    if (warnings.length > 0) {
      const hasRepairs = warnings.some(w => w.startsWith('🔧'))
      if (hasRepairs) {
        console.warn('[ConfigManager] Startup validation found issues, writing repairs:', warnings)
        warnings.forEach(w => this.logger?.addLog(`⚠️ Config: ${w}`))
        await this.writeConfig(repaired)
      }
    }

    return repaired
  }

  /**
   * Create a backup of the current config before making changes
   * Keeps the last 3 backups (openclaw.json.bak, .bak2, .bak3)
   */
  private async backupConfig(): Promise<void> {
    try {
      if (!existsSync(this.configPath)) {
        return // No config to backup
      }

      // Rotate backups: .bak2 -> .bak3, .bak -> .bak2
      const backup3 = `${this.configPath}.bak3`
      const backup2 = `${this.configPath}.bak2`
      const backup1 = `${this.configPath}.bak`

      if (existsSync(backup2)) {
        await copyFile(backup2, backup3)
      }
      if (existsSync(backup1)) {
        await copyFile(backup1, backup2)
      }

      // Create new backup
      await copyFile(this.configPath, backup1)
      console.log('[ConfigManager] Config backed up successfully')
    } catch (error) {
      console.error('[ConfigManager] Failed to backup config:', error)
      // Don't fail the whole operation if backup fails
    }
  }

  async writeConfig(config: any): Promise<void> {
    return this.withWriteLock(async () => {
      // Backup existing config before writing
      await this.backupConfig()

      // Validate and repair config before writing
      const { config: validatedConfig, warnings } = this.validateAndRepairConfig(config)

      // Log warnings if any issues were found and repaired
      if (warnings.length > 0) {
        console.warn('[ConfigManager] Config validation warnings:', warnings)
        warnings.forEach(warning => this.logger?.addLog(`⚠️ Config: ${warning}`))
      }

      await writeFile(this.configPath, JSON.stringify(validatedConfig, null, 2))
    })
  }

  async configExists(): Promise<boolean> {
    return existsSync(this.configPath)
  }

  async validateApiKey(provider: string, apiKey: string): Promise<boolean> {
    try {
      if (provider === 'anthropic' && !apiKey.startsWith('sk-ant-')) {
        return false
      }
      if (provider === 'openai' && !apiKey.startsWith('sk-')) {
        return false
      }
      return true
    } catch (error) {
      console.error('[ConfigManager] API key validation error:', error)
      return false
    }
  }

  async generateConfig(config: any, gatewayPort: number): Promise<void> {
    console.log('[ConfigManager] Generating config:', JSON.stringify(config, null, 2))

    try {
      const configDir = path.dirname(this.configPath)

      if (!existsSync(configDir)) {
        await mkdir(configDir, { recursive: true })
      }

      let existingConfig = {}
      try {
        if (existsSync(this.configPath)) {
          const configContent = await readFile(this.configPath, 'utf8')
          existingConfig = JSON.parse(configContent)
        }
      } catch (error) {
        console.log('[ConfigManager] Could not read existing config, creating new:', error)
      }

      const openclawConfig: any = {
        ...existingConfig,
        gateway: {
          ...(existingConfig as any).gateway,
          mode: 'local',
          port: gatewayPort || 18800,  // Use dynamic port (desktop app range: 18800-18809)
          bind: 'loopback',
          auth: {
            token: 'openclaw-easy-local-dev-token'
          }
        },
        agents: {
          defaults: {
            ...(existingConfig as any).agents?.defaults,
            model: {
              primary: config.model || 'ollama/qwen3:latest',  // Use Qwen3 which supports web_fetch
              fallbacks: config.fallbacks || []
            },
            timeoutSeconds: 600,  // Default agent timeout (10 minutes) per OpenClaw docs
            compaction: {
              mode: 'safeguard'
            },
            maxConcurrent: 4,
            subagents: {
              maxConcurrent: 8
            }
          },
          list: this.ensureAgentsWithTools((existingConfig as any).agents?.list || [])
        },
        // Preserve existing plugin config. Do NOT hardcode plugins.entries here —
        // channel plugins are auto-discovered by the gateway from extensions/ (dev)
        // or the bundled plugins dir (prod). Adding them here causes "duplicate
        // plugin id" warnings. Use channel-manager.ensurePluginEnabled() when a
        // specific channel operation needs a plugin enabled on demand.
        plugins: {
          ...(existingConfig as any).plugins,
        },
        tools: {
          ...(existingConfig as any).tools,
          web: {
            search: {
              enabled: true
            },
            fetch: {
              enabled: true
            }
          }
        }
      }

      delete openclawConfig.agent
      delete openclawConfig.providers

      await this.writeConfig(openclawConfig)
      this.logger?.addLog('✅ Configuration saved successfully')

    } catch (error: any) {
      console.error('[ConfigManager] Config generation error:', error)
      throw error
    }
  }

  async createDefaultConfig(gatewayPort: number): Promise<void> {
    const defaultConfig = {
      provider: 'ollama',  // Use Ollama with Qwen3 for better web_fetch support
      apiKey: '',
      model: 'ollama/qwen3:latest'  // Use Qwen3 which we discovered works with web_fetch
    }

    await this.generateConfig(defaultConfig, gatewayPort)

    // Ensure tools are configured after creating default config
    await this.ensureToolsConfigured()
  }

  /**
   * Ensure all agents (existing and new) have comprehensive tools configuration.
   * This applies the full toolset to every agent, so users can create any agent
   * and have access to all available OpenClaw capabilities without API keys.
   *
   * IMPORTANT: Only include actual OpenClaw agent tools here. Do NOT include:
   * - Shell commands (those go in exec-approvals.json allowlist)
   * - Non-existent tools like 'glob', 'grep', 'read', 'write'
   *   (OpenClaw uses tool groups like 'group:fs' for file operations)
   * - Experimental/disabled tools like 'apply_patch' (requires explicit enablement)
   */
  private ensureAgentsWithTools(existingAgentsList: any[]): any[] {
    // Comprehensive tools list for all agents (based on OpenClaw official documentation)
    // Using tool groups for better maintainability and avoiding unknown tool errors
    const fullToolsSet = [
      'web_fetch',        // Extract readable content from URLs (no API key required)
      'group:runtime',    // exec, bash, process
      'group:fs',         // read, write, edit (NOT apply_patch - requires explicit config)
      'group:sessions',   // sessions_list, sessions_history, sessions_send, sessions_spawn, session_status
      'group:ui',         // browser, canvas
      'group:automation', // cron, gateway
      'group:messaging',  // message
      'nodes',            // Discover/target paired nodes, send notifications, capture media
      'image',            // Analyze images using configured image model
      'agents_list'       // List available agents for spawning sessions
      // Note: Excluding 'web_search' to avoid API key requirements
      // Note: Excluding 'apply_patch' (experimental, OpenAI-only, requires tools.exec.applyPatch.enabled)
      // Note: NOT including individual tools like 'exec', 'read', 'write' - use groups instead
      // Note: NEVER include shell commands like 'grep', 'glob' - those go in exec-approvals.json
    ]

    const updatedAgents = existingAgentsList.map(agent => ({
      ...agent,
      tools: {
        allow: fullToolsSet
      }
    }))

    // Ensure main agent exists
    const hasMainAgent = updatedAgents.some(agent => agent.id === 'main')
    if (!hasMainAgent) {
      updatedAgents.push({
        id: 'main',
        tools: {
          allow: fullToolsSet
        }
      })
    }

    return updatedAgents
  }

  async ensureGatewayConfigured(gatewayPort: number): Promise<void> {
    try {
      let config: any = {}

      if (existsSync(this.configPath)) {
        const content = await readFile(this.configPath, 'utf-8')
        config = JSON.parse(content)
      }

      let hasChanges = false

      // Ensure gateway structure exists
      if (!config.gateway) {
        config.gateway = {}
        hasChanges = true
      }

      // Always ensure mode is 'local' for desktop app
      if (config.gateway.mode !== 'local') {
        config.gateway.mode = 'local'
        hasChanges = true
        console.log('[ConfigManager] Set gateway mode to local')
      }

      // Always ensure bind is 'loopback' for desktop app
      if (config.gateway.bind !== 'loopback') {
        config.gateway.bind = 'loopback'
        hasChanges = true
      }

      // Update port if it doesn't match (ProcessManager may have found a different available port)
      if (config.gateway.port !== gatewayPort) {
        config.gateway.port = gatewayPort
        hasChanges = true
        console.log(`[ConfigManager] Updated gateway port to ${gatewayPort}`)
      }

      // Allow WebSocket connections from the Electron desktop app in both dev and production modes.
      // In dev mode the renderer origin is http://localhost:5173; in production it is file:// (or null).
      const requiredOrigins = ['http://localhost:5173', 'http://localhost:5174', 'file://', 'null']
      if (!config.gateway.controlUi) {
        config.gateway.controlUi = { allowedOrigins: requiredOrigins }
        hasChanges = true
      } else {
        const existing: string[] = config.gateway.controlUi.allowedOrigins || []
        const missing = requiredOrigins.filter(o => !existing.includes(o))
        if (missing.length > 0) {
          config.gateway.controlUi.allowedOrigins = [...existing, ...missing]
          hasChanges = true
        }
      }

      // CRITICAL: Always ensure gateway.auth exists
      if (!config.gateway.auth || !config.gateway.auth.token) {
        config.gateway.auth = {
          mode: 'token',
          token: 'openclaw-easy-local-dev-token'
        }
        hasChanges = true
        console.log('[ConfigManager] Set gateway auth to local dev token')
        this.logger?.addLog('🔐 Set gateway auth to local dev token')
      }

      if (hasChanges) {
        await this.writeConfig(config)
        this.logger?.addLog('🔧 Gateway configuration updated')
      }
    } catch (error: any) {
      console.error(`[ConfigManager] Failed to ensure gateway configured: ${error.message}`)
      this.logger?.addLog(`⚠️ Failed to configure gateway automatically: ${error.message}`)
    }
  }

  async ensureToolsConfigured(): Promise<void> {
    try {
      let config: any = {}

      if (existsSync(this.configPath)) {
        const content = await readFile(this.configPath, 'utf-8')
        config = JSON.parse(content)
      }

      let hasChanges = false

      // Check if tools are already properly configured
      const hasWebSearch = config.tools?.web?.search?.enabled === true
      const hasWebFetch = config.tools?.web?.fetch?.enabled === true

      if (!hasWebSearch || !hasWebFetch) {
        // Configure tools if missing or incomplete
        if (!config.tools) {
          config.tools = {}
        }
        if (!config.tools.web) {
          config.tools.web = {}
        }

        // Enable web search and fetch tools
        config.tools.web.search = { enabled: true }
        config.tools.web.fetch = { enabled: true }
        hasChanges = true
      }

      // Enable bash command by default (required for image handling, code execution, etc.)
      if (!config.commands) {
        config.commands = {}
      }
      if (config.commands.bash !== true) {
        config.commands.bash = true
        hasChanges = true
        this.logger?.addLog('🔧 Enabled commands.bash for shell command support')
      }

      // Enable elevated tools (sandbox) — required for image processing and file operations
      if (!config.tools) {
        config.tools = {}
      }
      if (!config.tools.elevated || config.tools.elevated.enabled !== true) {
        config.tools.elevated = { enabled: true }
        hasChanges = true
        this.logger?.addLog('🔧 Enabled tools.elevated for sandbox/image support')
      }

      // Remove ALL plugins.entries — bundled plugins are auto-discovered by the
      // gateway from extensions/ (dev) or the bundled plugins dir (prod). Having
      // them in plugins.entries causes "duplicate plugin id detected" warnings.
      // Channel-specific operations (connect/add) re-add entries on demand via
      // channel-manager.ensurePluginEnabled() when needed.
      if (config.plugins?.entries && Object.keys(config.plugins.entries).length > 0) {
        delete config.plugins.entries
        hasChanges = true
      }

      // In dev mode, remove user-installed plugins that duplicate the source
      // extensions/ dir. The gateway discovers both ~/.openclaw/extensions/{id}
      // AND the source extensions/{id}, causing "duplicate plugin id" warnings.
      // Remove BOTH the config entry AND the actual directory.
      {
        const bundledPlugins = new Set<string>()
        try {
          const { readdirSync, statSync, rmSync } = await import('fs')
          const openclawRoot = path.resolve(__dirname, '..', '..', '..', '..', '..')
          const extensionsDir = path.join(openclawRoot, 'extensions')
          if (existsSync(extensionsDir)) {
            for (const name of readdirSync(extensionsDir)) {
              if (statSync(path.join(extensionsDir, name)).isDirectory()) {
                bundledPlugins.add(name)
              }
            }
          }

          if (bundledPlugins.size > 0) {
            // Clean plugins.installs config entries
            if (config.plugins?.installs) {
              for (const id of Object.keys(config.plugins.installs)) {
                if (bundledPlugins.has(id)) {
                  delete config.plugins.installs[id]
                  hasChanges = true
                }
              }
              if (Object.keys(config.plugins.installs).length === 0) {
                delete config.plugins.installs
              }
            }

            // Remove duplicate plugin directories from ~/.openclaw/extensions/
            const userExtDir = path.join(os.homedir(), '.openclaw', 'extensions')
            if (existsSync(userExtDir)) {
              for (const name of readdirSync(userExtDir)) {
                if (bundledPlugins.has(name)) {
                  const dupDir = path.join(userExtDir, name)
                  try {
                    rmSync(dupDir, { recursive: true, force: true })
                    console.log(`[ConfigManager] Removed duplicate plugin dir: ${dupDir}`)
                    hasChanges = true
                  } catch (e: any) {
                    console.warn(`[ConfigManager] Failed to remove ${dupDir}: ${e.message}`)
                  }
                }
              }
            }
          }
        } catch { /* not in dev mode or extensions dir missing — skip */ }
      }

      // Ensure timeoutSeconds is set to prevent infinite loops
      if (!config.agents) {
        config.agents = {}
      }
      if (!config.agents.defaults) {
        config.agents.defaults = {}
      }
      if (!config.agents.defaults.timeoutSeconds) {
        config.agents.defaults.timeoutSeconds = 600
        hasChanges = true
        this.logger?.addLog('🔧 Set timeoutSeconds=600 (default per OpenClaw docs)')
      }

      if (hasChanges) {
        await this.writeConfig(config)
        this.logger?.addLog('🔧 Automatically configured tools and agent limits')
        console.log('[ConfigManager] Tools configuration updated automatically')
      } else {
        this.logger?.addLog('✅ Tools configuration is up to date')
      }
    } catch (error: any) {
      console.error(`[ConfigManager] Failed to ensure tools configured: ${error.message}`)
      this.logger?.addLog(`⚠️ Failed to configure tools automatically: ${error.message}`)
    }
  }

  /**
   * Clean up invalid tool names from agent configurations.
   * Removes tool names that don't exist in OpenClaw's tool registry:
   * - 'glob', 'grep' (shell commands, not agent tools)
   * - Individual tool names that should be in groups (read, write, edit, exec, etc.)
   *
   * Replaces them with proper tool groups.
   */
  async cleanupInvalidToolNames(): Promise<void> {
    try {
      if (!existsSync(this.configPath)) {
        return
      }

      const content = await readFile(this.configPath, 'utf-8')
      const config = JSON.parse(content)

      let hasChanges = false
      const invalidTools = new Set(['glob', 'grep'])  // These don't exist as agent tools
      const fsTools = new Set(['read', 'write', 'edit'])  // Should use group:fs instead
      const runtimeTools = new Set(['exec', 'bash', 'process'])  // Should use group:runtime instead

      // Clean up agent-level tool allowlists
      if (config.agents?.list && Array.isArray(config.agents.list)) {
        for (const agent of config.agents.list) {
          if (agent.tools?.allow && Array.isArray(agent.tools.allow)) {
            const originalLength = agent.tools.allow.length

            // Remove invalid tools
            agent.tools.allow = agent.tools.allow.filter((tool: string) =>
              !invalidTools.has(tool)
            )

            // Check if we have individual fs tools
            const hasFsTools = agent.tools.allow.some((tool: string) =>
              fsTools.has(tool)
            )
            if (hasFsTools) {
              // Remove individual fs tools
              agent.tools.allow = agent.tools.allow.filter((tool: string) =>
                !fsTools.has(tool)
              )
              // Add group:fs if not already present
              if (!agent.tools.allow.includes('group:fs')) {
                agent.tools.allow.push('group:fs')
              }
            }

            // Check if we have individual runtime tools
            const hasRuntimeTools = agent.tools.allow.some((tool: string) =>
              runtimeTools.has(tool)
            )
            if (hasRuntimeTools) {
              // Remove individual runtime tools
              agent.tools.allow = agent.tools.allow.filter((tool: string) =>
                !runtimeTools.has(tool)
              )
              // Add group:runtime if not already present
              if (!agent.tools.allow.includes('group:runtime')) {
                agent.tools.allow.push('group:runtime')
              }
            }

            // Remove apply_patch if present (experimental, needs explicit config)
            if (agent.tools.allow.includes('apply_patch')) {
              agent.tools.allow = agent.tools.allow.filter((tool: string) =>
                tool !== 'apply_patch'
              )
              console.log(`[ConfigManager] Removed 'apply_patch' from agent ${agent.id} (experimental, OpenAI-only)`)
            }

            if (agent.tools.allow.length !== originalLength) {
              hasChanges = true
              console.log(`[ConfigManager] Cleaned up invalid tools for agent ${agent.id}`)
            }
          }
        }
      }

      if (hasChanges) {
        await this.writeConfig(config)
        this.logger?.addLog('🔧 Cleaned up invalid tool names from configuration')
        console.log('[ConfigManager] Invalid tool names cleaned up successfully')
      }
    } catch (error: any) {
      console.error(`[ConfigManager] Failed to cleanup invalid tool names: ${error.message}`)
      this.logger?.addLog(`⚠️ Failed to cleanup tool configuration: ${error.message}`)
    }
  }

  async updateGatewayPort(port: number): Promise<void> {
    try {
      let config: any = {}

      if (existsSync(this.configPath)) {
        const content = await readFile(this.configPath, 'utf-8')
        config = JSON.parse(content)
      }

      // Update gateway port in config
      if (!config.gateway) {config.gateway = {}}
      config.gateway.port = port
      config.gateway.mode = 'local'

      await this.writeConfig(config)
      console.log(`[ConfigManager] Updated config with gateway port ${port}`)
    } catch (error: any) {
      console.error(`[ConfigManager] Failed to update gateway port: ${error.message}`)
    }
  }

  /**
   * Apply the user's provider/model/key selection from AppProviderConfig to openclaw.json.
   * This is the single source-of-truth write path called from config:save IPC.
   * Preserves gateway, tools, agents.list, and plugins — only touches provider and model fields.
   */
  async applyProviderToOpenClaw(appConfig: AppProviderConfig): Promise<void> {
    const config = await this.loadConfig()

    if (!config.models) {config.models = {}}
    if (!config.models.providers) {config.models.providers = {}}
    if (!config.agents) {config.agents = {}}
    if (!config.agents.defaults) {config.agents.defaults = {}}
    if (!config.agents.defaults.model) {config.agents.defaults.model = {}}

    switch (appConfig.aiProvider) {
      case 'byok': {
        const byok = appConfig.byok
        if (!byok) {break}
        const { provider, model, apiKeys } = byok

        if (provider === 'google') {
          const apiKey = apiKeys?.google || config.models.providers.google?.apiKey || ''
          const validGoogleModels = [
            'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro',
            'gemini-3-flash-preview', 'gemini-3-pro-preview',
            // Legacy aliases for backward compatibility
            'gemini-flash-latest', 'gemini-pro-latest'
          ]

          // Validate model name - prevent mixing provider models (e.g., claude with google)
          let validatedModel = model
          if (!model.startsWith('gemini') || !validGoogleModels.includes(model)) {
            console.warn(`[ConfigManager] Invalid Google model "${model}" - using gemini-2.5-flash as fallback`)
            this.logger?.addLog(`⚠️ Invalid Google model "${model}" detected - switching to gemini-2.5-flash`)
            validatedModel = 'gemini-2.5-flash'
          }

          config.models.providers.google = {
            baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
            api: 'google-generative-ai',
            apiKey,
            headers: { 'X-goog-api-key': apiKey },
            models: BYOK_PROVIDER_MODELS.google.models
          }
          config.agents.defaults.model.primary = `google/${validatedModel}`

        } else if (provider === 'anthropic') {
          const apiKey = apiKeys?.anthropic || config.models.providers.anthropic?.apiKey || ''
          const validAnthropicModels = [
            'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5',
            // Legacy model IDs for backward compatibility
            'claude-opus', 'claude-sonnet', 'claude-haiku'
          ]

          // Validate model name - prevent mixing provider models (e.g., gemini with anthropic)
          let validatedModel = model
          if (!validAnthropicModels.includes(model)) {
            console.warn(`[ConfigManager] Invalid Anthropic model "${model}" - using claude-sonnet-4-6 as fallback`)
            this.logger?.addLog(`⚠️ Invalid Anthropic model "${model}" detected - switching to claude-sonnet-4-6`)
            validatedModel = 'claude-sonnet-4-6'
            // Persist the corrected model back to app-config so it survives restarts
            byok.model = validatedModel
            this.saveAppConfig(appConfig).catch(e => console.warn('[ConfigManager] Failed to persist corrected model:', e))
          }

          config.models.providers.anthropic = {
            baseUrl: 'https://api.anthropic.com/v1',
            api: 'anthropic-messages',
            apiKey,
            models: BYOK_PROVIDER_MODELS.anthropic.models
          }
          config.agents.defaults.model.primary = `anthropic/${validatedModel}`

        } else if (provider === 'openai') {
          const apiKey = apiKeys?.openai || config.models.providers.openai?.apiKey || ''
          const validOpenAIModels = [
            'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
            'o3', 'o4-mini',
            'gpt-4o', 'gpt-4o-mini'
          ]

          // Validate model name - prevent mixing provider models (e.g., claude/gemini with openai)
          let validatedModel = model
          if (!validOpenAIModels.includes(model) && !model.startsWith('gpt') && !model.startsWith('o')) {
            console.warn(`[ConfigManager] Invalid OpenAI model "${model}" - using gpt-4o as fallback`)
            this.logger?.addLog(`⚠️ Invalid OpenAI model "${model}" detected - switching to gpt-4o`)
            validatedModel = 'gpt-4o'
          }

          config.models.providers.openai = {
            baseUrl: 'https://api.openai.com/v1',
            api: 'openai-responses',
            apiKey,
            models: BYOK_PROVIDER_MODELS.openai.models
          }
          config.agents.defaults.model.primary = `openai/${validatedModel}`

        } else if (provider === 'venice') {
          const apiKey = apiKeys?.venice || config.models.providers.venice?.apiKey || ''
          config.models.providers.venice = {
            baseUrl: 'https://api.venice.ai/api/v1',
            api: 'openai-responses',
            apiKey,
            models: BYOK_PROVIDER_MODELS.venice.models
          }
          config.agents.defaults.model.primary = `venice/${model}`

        } else if (provider === 'openrouter') {
          const apiKey = apiKeys?.openrouter || config.models.providers.openrouter?.apiKey || ''
          config.models.providers.openrouter = {
            baseUrl: 'https://openrouter.ai/api/v1',
            api: 'openai-responses',
            apiKey,
            models: BYOK_PROVIDER_MODELS.openrouter.models
          }
          config.agents.defaults.model.primary = `openrouter/${model}`
        }
        break
      }

      case 'local': {
        const model = appConfig.local?.model || 'llama3.2:3b'
        config.models.providers.ollama = {
          baseUrl: 'http://127.0.0.1:11434/v1',
          apiKey: 'ollama-local',
          api: 'openai-responses',
          models: [
            {
              id: model,
              name: model.replace(/[-_:]/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
              reasoning: false,
              input: ['text'],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 32768,
              maxTokens: 4096
            }
          ]
        }
        config.agents.defaults.model.primary = `ollama/${model}`
        break
      }
    }

    // Sync per-agent model overrides whose provider prefix changed.
    // Without this, agents.list[].model.primary keeps the OLD provider/model and
    // the gateway uses that stale value instead of agents.defaults.model.primary.
    // Only touch agents on a DIFFERENT provider — preserve intentional per-agent
    // model choices within the same provider (e.g. gemini-2.5-flash vs gemini-2.5-pro).
    const newPrimary = config.agents.defaults.model.primary
    const newProvider = newPrimary?.split('/')[0]
    if (newProvider && Array.isArray(config.agents.list)) {
      for (const agent of config.agents.list) {
        const agentPrimary: string = agent.model?.primary || ''
        const agentProvider = agentPrimary.split('/')[0]
        if (agentPrimary && agentProvider !== newProvider) {
          console.log(`[ConfigManager] Updating agent "${agent.id}" model: ${agentPrimary} → ${newPrimary}`)
          agent.model.primary = newPrimary
        }
      }
    }

    await this.writeConfig(config)
    console.log(`[ConfigManager] Applied provider=${appConfig.aiProvider} to openclaw.json`)

    // Keep auth-profiles.json in sync with whichever provider is now active
    if (appConfig.aiProvider === 'byok' && appConfig.byok) {
      const { provider, apiKeys } = appConfig.byok
      const apiKey = apiKeys?.[provider as keyof typeof apiKeys] || ''
      if (apiKey) {
        await this._syncAuthProfiles(provider, { provider, type: 'api_key', key: apiKey })
      }
    }
  }

  /**
   * Sync a provider credential into every location the gateway reads for auth:
   *   1. ~/.openclaw/auth-profiles.json                     (global)
   *   2. ~/.openclaw/agents/main/agent/auth-profiles.json   (per-agent profiles)
   *   3. ~/.openclaw/agents/main/auth.json                  (per-agent auth)
   *
   * For premium logins, pass provider='openai' and the JWT as the key.
   * For BYOK, pass the actual provider name and its API key.
   */
  private async _syncAuthProfiles(provider: string, profile: { provider: string; type: string; key: string }): Promise<void> {
    const openclaw = path.join(os.homedir(), '.openclaw')
    const agentMain = path.join(openclaw, 'agents', 'main')

    const profileFiles = [
      path.join(openclaw, 'auth-profiles.json'),
      path.join(agentMain, 'agent', 'auth-profiles.json'),
      path.join(agentMain, 'auth.json'),
    ]

    for (const filePath of profileFiles) {
      let doc: any = { version: 1, profiles: {}, lastGood: {}, usageStats: {} }
      try {
        if (existsSync(filePath)) {
          doc = JSON.parse(await readFile(filePath, 'utf8'))
        }
      } catch {
        // Start fresh if the file is missing or corrupted
      }
      if (!doc.profiles) {doc.profiles = {}}
      // Remove legacy 'remote:default' if present
      delete doc.profiles['remote:default']
      doc.profiles[`${provider}:default`] = profile
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, JSON.stringify(doc, null, 2))
    }

    console.log(`[ConfigManager] Synced ${provider} credentials to all gateway auth files`)
  }

  /**
   * Sync per-agent model overrides with the global default provider.
   * Safe to call on every app startup — no-ops when all agents already match.
   *
   * Fixes: when user switches AI provider (e.g. Premium → BYOK Google), only
   * agents.defaults.model.primary was updated. Per-agent overrides in agents.list[]
   * kept the old provider/model, causing the gateway to use stale values.
   */
  async syncAgentModelsWithDefault(): Promise<void> {
    try {
      const config = await this.loadConfig()
      const defaultPrimary: string = config?.agents?.defaults?.model?.primary || ''
      const agentsList: any[] = config?.agents?.list || []

      if (!defaultPrimary || agentsList.length === 0) return

      // Extract the provider prefix from the global default (e.g. "google" from "google/gemini-2.5-pro")
      const defaultProvider = defaultPrimary.split('/')[0]
      let hasChanges = false

      for (const agent of agentsList) {
        const agentPrimary: string = agent.model?.primary || ''
        if (!agentPrimary) continue

        const agentProvider = agentPrimary.split('/')[0]
        // If the agent's provider doesn't match the global default provider, it's stale
        if (agentProvider !== defaultProvider) {
          console.log(`[ConfigManager] Fixing stale agent "${agent.id}" model: ${agentPrimary} → ${defaultPrimary}`)
          agent.model.primary = defaultPrimary
          hasChanges = true
        }
      }

      if (hasChanges) {
        await this.writeConfig(config)
        console.log('[ConfigManager] Synced stale per-agent models with global default')
      }
    } catch (error) {
      console.error('[ConfigManager] Failed to sync agent models:', error)
    }
  }

  async writeAuthProfile(profileId: string, apiKey: string): Promise<void> {
    const authProfilesPath = path.join(os.homedir(), '.openclaw', 'auth-profiles.json')
    let authProfiles: any = {}

    // Load existing auth profiles
    try {
      const content = await readFile(authProfilesPath, 'utf8')
      authProfiles = JSON.parse(content)
    } catch (error) {
      // File doesn't exist yet, that's okay
    }

    // Add or update the profile
    authProfiles[profileId] = { apiKey }

    // Write back to file
    await writeFile(authProfilesPath, JSON.stringify(authProfiles, null, 2))
    console.log(`[ConfigManager] Wrote auth profile: ${profileId}`)
  }
}
