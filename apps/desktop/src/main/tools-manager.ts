import { ChannelManager } from './channel-manager'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import * as path from 'path'
import { app } from 'electron'

export interface ToolsConfig {
  profile: 'minimal' | 'coding' | 'messaging' | 'full'
  allow?: string[]
  deny?: string[]
  byProvider?: Record<string, any>
  elevated?: {
    enabled: boolean
  }
  web?: {
    search?: { enabled: boolean }
    fetch?: { enabled: boolean }
  }
  exec?: {
    host: 'sandbox' | 'gateway' | 'node'
    security: 'deny' | 'allowlist' | 'full'
    safeBins?: string[]
    applyPatch?: { enabled: boolean }
  }
  media?: {
    image?: { enabled: boolean }
    audio?: { enabled: boolean }
    video?: { enabled: boolean }
  }
  links?: {
    enabled: boolean
  }
}

export class ToolsManager {
  private channelManager: ChannelManager

  constructor(configPath: string) {
    this.channelManager = new ChannelManager(configPath)
  }

  // Get current tools configuration
  async getConfig(): Promise<{ success: boolean; config?: ToolsConfig; error?: string }> {
    try {
      const configPath = this.getConfigPath()

      if (!existsSync(configPath)) {
        // Return default config if file doesn't exist
        return {
          success: true,
          config: {
            profile: 'coding',
            exec: {
              host: 'sandbox',
              security: 'allowlist',
              safeBins: []
            },
            web: {
              search: { enabled: true },
              fetch: { enabled: true }
            },
            elevated: { enabled: true }
          }
        }
      }

      const content = await readFile(configPath, 'utf8')
      const fullConfig = JSON.parse(content)

      const toolsConfig: ToolsConfig = {
        profile: fullConfig.tools?.profile || 'coding',
        allow: fullConfig.tools?.allow || [],
        deny: fullConfig.tools?.deny || [],
        byProvider: fullConfig.tools?.byProvider || {},
        elevated: fullConfig.tools?.elevated || { enabled: true },
        web: fullConfig.tools?.web || {
          search: { enabled: true },
          fetch: { enabled: true }
        },
        exec: fullConfig.tools?.exec || {
          host: 'sandbox',
          security: 'allowlist',
          safeBins: []
        }
      }

      return { success: true, config: toolsConfig }
    } catch (error: any) {
      console.error('[ToolsManager] Failed to get config:', error)
      return { success: false, error: error.message }
    }
  }

  // Set tool profile (minimal/coding/messaging/full)
  async setProfile(profile: 'minimal' | 'coding' | 'messaging' | 'full'): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.executeConfigCommand(['set', 'tools.profile', profile])
      console.log('[ToolsManager] Set profile result:', result)
      return { success: true }
    } catch (error: any) {
      console.error('[ToolsManager] Failed to set profile:', error)
      return { success: false, error: error.message }
    }
  }

  // Set exec host mode
  async setExecHost(host: 'sandbox' | 'gateway' | 'node', applyToAllAgents: boolean = false): Promise<{ success: boolean; error?: string }> {
    // Use updateConfig to merge exec.host into global config (and optionally per-agent).
    // Previously this called updateAllAgentsExecConfig which DELETE'd agent exec configs
    // instead of updating them — that was backwards and caused "allowlist miss" errors.
    return this.updateConfig({ exec: { host } } as Partial<ToolsConfig>, applyToAllAgents)
  }

  // Set exec security mode
  async setExecSecurity(security: 'deny' | 'allowlist' | 'full', applyToAllAgents: boolean = false): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.updateConfig({ exec: { security } } as Partial<ToolsConfig>, applyToAllAgents)
      // Sync exec-approvals.json security mode regardless of openclaw.json write result
      await this.syncExecApprovalsSecurity(security)
      return result
    } catch (error: any) {
      console.error('[ToolsManager] Failed to set exec security:', error)
      return { success: false, error: error.message }
    }
  }

  // Set safe binaries list
  async setSafeBins(bins: string[]): Promise<{ success: boolean; error?: string }> {
    try {
      const binsJson = JSON.stringify(bins)
      await this.executeConfigCommand(['set', 'tools.exec.safeBins', binsJson])
      return { success: true }
    } catch (error: any) {
      console.error('[ToolsManager] Failed to set safe bins:', error)
      return { success: false, error: error.message }
    }
  }

  // Enable/disable web search
  async setWebSearchEnabled(enabled: boolean): Promise<{ success: boolean; error?: string }> {
    try {
      await this.executeConfigCommand(['set', 'tools.web.search.enabled', String(enabled)])
      return { success: true }
    } catch (error: any) {
      console.error('[ToolsManager] Failed to set web search:', error)
      return { success: false, error: error.message }
    }
  }

  // Enable/disable web fetch
  async setWebFetchEnabled(enabled: boolean): Promise<{ success: boolean; error?: string }> {
    try {
      await this.executeConfigCommand(['set', 'tools.web.fetch.enabled', String(enabled)])
      return { success: true }
    } catch (error: any) {
      console.error('[ToolsManager] Failed to set web fetch:', error)
      return { success: false, error: error.message }
    }
  }

  // Allow specific tool
  async allowTool(tool: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Get current allow list
      const config = await this.getConfig()
      if (!config.success || !config.config) {
        throw new Error('Failed to get current config')
      }

      const currentAllow = config.config.allow || []
      if (!currentAllow.includes(tool)) {
        const newAllow = [...currentAllow, tool]
        await this.executeConfigCommand(['set', 'tools.allow', JSON.stringify(newAllow)])
      }

      return { success: true }
    } catch (error: any) {
      console.error('[ToolsManager] Failed to allow tool:', error)
      return { success: false, error: error.message }
    }
  }

  // Deny specific tool
  async denyTool(tool: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Get current deny list
      const config = await this.getConfig()
      if (!config.success || !config.config) {
        throw new Error('Failed to get current config')
      }

      const currentDeny = config.config.deny || []
      if (!currentDeny.includes(tool)) {
        const newDeny = [...currentDeny, tool]
        await this.executeConfigCommand(['set', 'tools.deny', JSON.stringify(newDeny)])
      }

      return { success: true }
    } catch (error: any) {
      console.error('[ToolsManager] Failed to deny tool:', error)
      return { success: false, error: error.message }
    }
  }

  // Allow tool group (e.g., "group:web", "group:runtime")
  async allowToolGroup(group: string): Promise<{ success: boolean; error?: string }> {
    return this.allowTool(group)
  }

  // Deny tool group
  async denyToolGroup(group: string): Promise<{ success: boolean; error?: string }> {
    return this.denyTool(group)
  }

  // Update multiple config values at once
  async updateConfig(updates: Partial<ToolsConfig>, applyToAllAgents: boolean = false): Promise<{ success: boolean; error?: string }> {
    try {
      const configPath = this.getConfigPath()
      let fullConfig: any = {}

      if (existsSync(configPath)) {
        const content = await readFile(configPath, 'utf8')
        fullConfig = JSON.parse(content)
      }

      // Ensure tools object exists
      if (!fullConfig.tools) {
        fullConfig.tools = {}
      }

      // Apply updates
      if (updates.profile !== undefined) {
        fullConfig.tools.profile = updates.profile
      }

      if (updates.exec !== undefined) {
        fullConfig.tools.exec = {
          ...fullConfig.tools.exec,
          ...updates.exec
        }
      }

      if (updates.web !== undefined) {
        fullConfig.tools.web = {
          ...fullConfig.tools.web,
          ...updates.web
        }
      }

      if (updates.elevated !== undefined) {
        fullConfig.tools.elevated = updates.elevated
      }

      if (updates.allow !== undefined) {
        fullConfig.tools.allow = updates.allow
      }

      if (updates.deny !== undefined) {
        fullConfig.tools.deny = updates.deny
      }

      if (updates.byProvider !== undefined) {
        fullConfig.tools.byProvider = updates.byProvider
      }

      if (updates.media !== undefined) {
        fullConfig.tools.media = {
          ...fullConfig.tools.media,
          ...updates.media
        }
      }

      if (updates.links !== undefined) {
        fullConfig.tools.links = updates.links
      }

      // Update all agents' exec config if requested
      if (applyToAllAgents && updates.exec !== undefined) {
        if (fullConfig.agents?.list && Array.isArray(fullConfig.agents.list)) {
          for (const agent of fullConfig.agents.list) {
            if (!agent.tools) {
              agent.tools = {}
            }
            if (!agent.tools.exec) {
              agent.tools.exec = {}
            }
            agent.tools.exec = {
              ...agent.tools.exec,
              ...updates.exec
            }
          }
          console.log(`[ToolsManager] Updated exec config for ${fullConfig.agents.list.length} agent(s)`)
        }
      }

      // Write back to file
      await writeFile(configPath, JSON.stringify(fullConfig, null, 2))

      // Sync exec-approvals.json if security mode changed
      if (updates.exec?.security) {
        await this.syncExecApprovalsSecurity(updates.exec.security)
      }

      console.log('[ToolsManager] Config updated successfully')
      return { success: true }
    } catch (error: any) {
      console.error('[ToolsManager] Failed to update config:', error)
      return { success: false, error: error.message }
    }
  }

  // Helper: Execute OpenClaw config command
  private async executeConfigCommand(args: string[]): Promise<string> {
    return this.channelManager.executeOpenClawCommand(['config', ...args])
  }

  // Helper: Get config path
  private getConfigPath(): string {
    const userHome = app.getPath('home')
    return path.join(userHome, '.openclaw', 'openclaw.json')
  }

  // Helper: Update all agents' exec configuration
  private async updateAllAgentsExecConfig(execConfig: Partial<ToolsConfig['exec']>): Promise<void> {
    const configPath = this.getConfigPath()

    if (!existsSync(configPath)) {
      return
    }

    const content = await readFile(configPath, 'utf8')
    const fullConfig = JSON.parse(content)

    // Remove agent-level exec configs to let agents use global settings and exec-approvals.json
    // Agent-level exec configs without allowlists cause "allowlist miss" errors
    if (fullConfig.agents?.list && Array.isArray(fullConfig.agents.list)) {
      for (const agent of fullConfig.agents.list) {
        // Remove agent-level exec config entirely
        // Agents will inherit from global tools.exec and use exec-approvals.json for allowlists
        if (agent.tools?.exec) {
          delete agent.tools.exec
          console.log(`[ToolsManager] Removed agent-level exec config for agent ${agent.id || 'unknown'} to use global settings`)
        }
      }

      // Write back
      await writeFile(configPath, JSON.stringify(fullConfig, null, 2))
      console.log(`[ToolsManager] Cleaned up exec config for ${fullConfig.agents.list.length} agent(s) - now using global settings`)
    }
  }

  // Public method: Reconfigure exec approvals (can be called from UI)
  async reconfigureExecApprovals(): Promise<{ success: boolean; error?: string }> {
    try {
      // Get current security mode from config
      const config = await this.getConfig()
      const security = config.config?.exec?.security || 'allowlist'
      await this.setupExecApprovals(security)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  // Helper: Sync exec-approvals.json security mode to match openclaw.json
  private async syncExecApprovalsSecurity(security: 'deny' | 'allowlist' | 'full'): Promise<void> {
    try {
      const userHome = app.getPath('home')
      const approvalsPath = path.join(userHome, '.openclaw', 'exec-approvals.json')

      // If file doesn't exist, create it with the appropriate security mode
      if (!existsSync(approvalsPath)) {
        await this.setupExecApprovals(security)
        return
      }

      // Read existing file
      const existingContent = await readFile(approvalsPath, 'utf8')
      const existing = JSON.parse(existingContent)

      // Update security mode for defaults and all agents
      if (existing.defaults) {
        existing.defaults.security = security
      }

      if (existing.agents) {
        for (const agentKey in existing.agents) {
          if (existing.agents[agentKey]) {
            existing.agents[agentKey].security = security
          }
        }
      }

      // Write back the updated config
      await writeFile(approvalsPath, JSON.stringify(existing, null, 2))
      console.log(`[ToolsManager] Synced exec-approvals.json security mode to: ${security}`)
    } catch (error) {
      console.error('[ToolsManager] Failed to sync exec-approvals.json security:', error)
      // If sync fails, recreate the file with correct security mode
      await this.setupExecApprovals(security)
    }
  }

  // Helper: Setup exec-approvals.json with sensible defaults
  private async setupExecApprovals(security: 'deny' | 'allowlist' | 'full' = 'allowlist'): Promise<void> {
    try {
      const userHome = app.getPath('home')
      const approvalsPath = path.join(userHome, '.openclaw', 'exec-approvals.json')

      // Default safe commands for allowlist mode - comprehensive set
      const defaultAllowlist = [
        // Basic file viewing & text processing
        { pattern: 'cat' },
        { pattern: 'ls' },
        { pattern: 'grep' },
        { pattern: 'find' },
        { pattern: 'jq' },
        { pattern: 'head' },
        { pattern: 'tail' },
        { pattern: 'cut' },
        { pattern: 'sort' },
        { pattern: 'uniq' },
        { pattern: 'wc' },
        { pattern: 'tr' },
        { pattern: 'file' },
        { pattern: 'stat' },
        { pattern: 'pwd' },
        { pattern: 'echo' },
        { pattern: 'date' },
        { pattern: 'sed' },
        { pattern: 'awk' },
        { pattern: 'less' },
        { pattern: 'more' },
        { pattern: 'diff' },
        { pattern: 'patch' },

        // Network & HTTP
        { pattern: 'curl' },
        { pattern: 'wget' },
        { pattern: 'ping' },
        { pattern: 'nc' },
        { pattern: 'telnet' },
        { pattern: 'ssh' },
        { pattern: 'scp' },
        { pattern: 'rsync' },

        // File operations
        { pattern: 'cp' },
        { pattern: 'mv' },
        { pattern: 'rm' },
        { pattern: 'mkdir' },
        { pattern: 'rmdir' },
        { pattern: 'touch' },
        { pattern: 'chmod' },
        { pattern: 'chown' },
        { pattern: 'ln' },

        // Archive & compression
        { pattern: 'tar' },
        { pattern: 'zip' },
        { pattern: 'unzip' },
        { pattern: 'gzip' },
        { pattern: 'gunzip' },
        { pattern: 'bzip2' },
        { pattern: 'bunzip2' },
        { pattern: 'xz' },

        // Git operations
        { pattern: 'git' },

        // Programming languages & runtimes
        { pattern: 'python' },
        { pattern: 'python3' },
        { pattern: 'node' },
        { pattern: 'ruby' },
        { pattern: 'perl' },
        { pattern: 'php' },
        { pattern: 'java' },
        { pattern: 'javac' },
        { pattern: 'go' },
        { pattern: 'cargo' },
        { pattern: 'rustc' },

        // Package managers
        { pattern: 'npm' },
        { pattern: 'yarn' },
        { pattern: 'pip' },
        { pattern: 'pip3' },
        { pattern: 'brew' },
        { pattern: 'gem' },
        { pattern: 'apt' },
        { pattern: 'yum' },

        // Build tools
        { pattern: 'make' },
        { pattern: 'cmake' },
        { pattern: 'gcc' },
        { pattern: 'g++' },
        { pattern: 'clang' },

        // System info
        { pattern: 'uname' },
        { pattern: 'whoami' },
        { pattern: 'hostname' },
        { pattern: 'uptime' },
        { pattern: 'df' },
        { pattern: 'du' },
        { pattern: 'ps' },
        { pattern: 'top' },
        { pattern: 'htop' },
        { pattern: 'kill' },
        { pattern: 'killall' },
        { pattern: 'free' },
        { pattern: 'lsof' },
        { pattern: 'netstat' },

        // Shell & execution
        { pattern: 'bash' },
        { pattern: 'sh' },
        { pattern: 'zsh' },
        { pattern: 'fish' },
        { pattern: 'which' },
        { pattern: 'env' },
        { pattern: 'export' },
        { pattern: 'source' },

        // Development & DevOps
        { pattern: 'docker' },
        { pattern: 'kubectl' },
        { pattern: 'terraform' },
        { pattern: 'ansible' },

        // Text editors (view mode)
        { pattern: 'vim' },
        { pattern: 'nano' },
        { pattern: 'emacs' },

        // Utilities
        { pattern: 'base64' },
        { pattern: 'openssl' },
        { pattern: 'gpg' },
        { pattern: 'column' },
        { pattern: 'comm' },
        { pattern: 'csplit' },
        { pattern: 'expand' },
        { pattern: 'fmt' },
        { pattern: 'fold' },
        { pattern: 'join' },
        { pattern: 'nl' },
        { pattern: 'paste' },
        { pattern: 'printenv' },
        { pattern: 'printf' },
        { pattern: 'seq' },
        { pattern: 'shuf' },
        { pattern: 'split' },
        { pattern: 'tac' },
        { pattern: 'tee' },
        { pattern: 'timeout' },
        { pattern: 'watch' },
        { pattern: 'xargs' },
        { pattern: 'yes' },
        { pattern: 'bc' },
        { pattern: 'dc' },
        { pattern: 'expr' },
        { pattern: 'factor' },
        { pattern: 'numfmt' },
        { pattern: 'shred' },
        { pattern: 'sum' },
        { pattern: 'truncate' },
        { pattern: 'md5' },
        { pattern: 'sha1sum' },
        { pattern: 'sha256sum' }
      ]

      // Merge existing configuration with new defaults
      let existingToken = this.generateToken()
      let existingAllowlist = [...defaultAllowlist]  // Start with full defaults
      let existingWildcardAllowlist = [...defaultAllowlist]  // Use full allowlist for all agents

      if (existsSync(approvalsPath)) {
        try {
          const existingContent = await readFile(approvalsPath, 'utf8')
          const existing = JSON.parse(existingContent)

          // Preserve socket token
          if (existing.socket?.token) {
            existingToken = existing.socket.token
          }

          // Merge existing custom patterns with new defaults
          // This ensures users get new defaults + keep their custom additions
          if (existing.agents?.main?.allowlist) {
            const defaultPatterns = new Set(defaultAllowlist.map(a => a.pattern))
            const customPatterns = existing.agents.main.allowlist.filter(
              (item: any) => !defaultPatterns.has(item.pattern)
            )
            existingAllowlist = [...defaultAllowlist, ...customPatterns]
          }

          if (existing.agents?.['*']?.allowlist) {
            const defaultPatterns = new Set(defaultAllowlist.map(a => a.pattern))
            const customPatterns = existing.agents['*'].allowlist.filter(
              (item: any) => !defaultPatterns.has(item.pattern)
            )
            existingWildcardAllowlist = [...defaultAllowlist, ...customPatterns]
          }
        } catch (error) {
          console.error('[ToolsManager] Failed to read existing exec-approvals.json:', error)
        }
      }

      const approvalsConfig = {
        version: 1,
        socket: {
          path: path.join(userHome, '.openclaw', 'exec-approvals.sock'),
          token: existingToken
        },
        defaults: {
          security: security,
          ask: 'off' as const,
          autoAllowSkills: true
        },
        agents: {
          main: {
            security: security,
            ask: 'off' as const,
            autoAllowSkills: true,
            allowlist: existingAllowlist
          },
          '*': {
            security: security,
            ask: 'off' as const,
            autoAllowSkills: true,
            allowlist: existingWildcardAllowlist
          }
        }
      }

      // Write the approvals config
      await writeFile(approvalsPath, JSON.stringify(approvalsConfig, null, 2))
      console.log(`[ToolsManager] Exec approvals configured with security: ${security}, autoAllowSkills enabled`)
    } catch (error) {
      console.error('[ToolsManager] Failed to setup exec approvals:', error)
      throw error
    }
  }

  // Helper: Generate a random token for exec approvals socket
  private generateToken(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let token = ''
    for (let i = 0; i < 32; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return token
  }
}
