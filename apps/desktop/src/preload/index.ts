import { contextBridge, ipcRenderer } from 'electron'

// Custom APIs for renderer
const api = {
  // OpenClaw process management
  startOpenClaw: () => ipcRenderer.invoke('openclaw:start'),
  stopOpenClaw: () => ipcRenderer.invoke('openclaw:stop'),
  getStatus: () => ipcRenderer.invoke('openclaw:status'),
  getOpenClawStatus: () => ipcRenderer.invoke('openclaw:status'),
  getOpenClawLogs: () => ipcRenderer.invoke('openclaw:logs'),
  restartOpenClaw: () => ipcRenderer.invoke('openclaw:restart'),

  // Gateway API methods for native dashboard
  getGatewayStatus: () => ipcRenderer.invoke('gateway:status'),
  getGatewayInfo: () => ipcRenderer.invoke('gateway:info'),
  getChannels: () => ipcRenderer.invoke('gateway:channels'),
  getAgents: () => ipcRenderer.invoke('gateway:agents'),
  getGatewayToken: () => ipcRenderer.invoke('gateway:get-token'),
  buildDeviceIdentity: (opts: {
    clientId: string; clientMode: string; role: string;
    scopes: string[]; token: string; nonce: string;
  }) => ipcRenderer.invoke('device:build-identity', opts),
  getDeviceId: () => ipcRenderer.invoke('device:get-id') as Promise<string | null>,
  getGatewayPort: () => ipcRenderer.invoke('gateway:get-port'),

  // Channel management using OpenClaw CLI
  listChannels: () => ipcRenderer.invoke('channels:list'),
  getChannelStatus: () => ipcRenderer.invoke('channels:status'),
  addWhatsAppChannel: (name?: string) => ipcRenderer.invoke('channels:add-whatsapp', name),
  loginWhatsApp: () => ipcRenderer.invoke('channels:login-whatsapp'),

  // NEW: OpenClaw management functions
  getOpenClawInstallations: () => ipcRenderer.invoke('openclaw:get-installations'),
  uninstallOpenClaw: (installPath: string, installMethod: string) => ipcRenderer.invoke('openclaw:uninstall', installPath, installMethod),
  installOpenClaw: (installType: 'official' | 'npm-global') => ipcRenderer.invoke('openclaw:install', installType),
  checkOpenClawUpdates: () => ipcRenderer.invoke('openclaw:check-updates'),
  setupOpenClaw: () => ipcRenderer.invoke('openclaw:setup'),

  // Event subscriptions - Real-time events
  onStatusUpdate: (callback: (status: any) => void) => {
    const handler = (_: any, status: any) => callback(status);
    ipcRenderer.on('openclaw:status-update', handler);
    // Return a cleanup function
    return () => ipcRenderer.removeListener('openclaw:status-update', handler);
  },
  onLogUpdate: (callback: (log: any) => void) => {
    const handler = (_: any, log: any) => callback(log);
    ipcRenderer.on('openclaw:log-update', handler);
    // Return a cleanup function
    return () => ipcRenderer.removeListener('openclaw:log-update', handler);
  },
  onHealthUpdate: (callback: (health: any) => void) => {
    const handler = (_: any, health: any) => callback(health);
    ipcRenderer.on('openclaw:health-update', handler);
    // Return a cleanup function
    return () => ipcRenderer.removeListener('openclaw:health-update', handler);
  },
  onSwitchToManagementChannel: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('switch-to-management-channel', handler);
    // Return a cleanup function
    return () => ipcRenderer.removeListener('switch-to-management-channel', handler);
  },
  onWhatsAppStatusChange: (callback: (status: 'connected' | 'disconnected' | 'error') => void) => {
    const handler = (_: any, status: 'connected' | 'disconnected' | 'error') => callback(status);
    ipcRenderer.on('whatsapp:status-change', handler);
    // Return a cleanup function
    return () => ipcRenderer.removeListener('whatsapp:status-change', handler);
  },

  // Configuration management
  generateConfig: (config: any) => ipcRenderer.invoke('config:generate', config),
  validateApiKey: (provider: string, apiKey: string) => ipcRenderer.invoke('config:validate-api-key', provider, apiKey),
  setApiKey: (provider: string, apiKey: string) => ipcRenderer.invoke('config:set-api-key', provider, apiKey),
  getApiKey: (provider: string) => ipcRenderer.invoke('config:get-api-key', provider),
  configExists: () => ipcRenderer.invoke('config:exists'),
  updateOpenClawConfig: (config: any) => ipcRenderer.invoke('config:update-openclaw', config),
  getOpenClawConfig: () => ipcRenderer.invoke('config:get-openclaw'),

  // App config management (for config store)
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config: any) => ipcRenderer.invoke('config:save', config),

  // Model management - Enhanced with real Ollama integration
  installModel: (modelId: string, size?: string) => ipcRenderer.invoke('model:install', modelId, size),
  configureModel: (modelId: string) => ipcRenderer.invoke('model:configure', modelId),
  getInstalledModels: () => ipcRenderer.invoke('model:list-installed'),
  getAvailableModels: () => ipcRenderer.invoke('model:list-available'),
  removeModel: (modelId: string) => ipcRenderer.invoke('model:remove', modelId),
  validateModel: (modelId: string) => ipcRenderer.invoke('model:validate', modelId),
  getModelInfo: (modelId: string) => ipcRenderer.invoke('model:get-info', modelId),
  getStorageInfo: () => ipcRenderer.invoke('model:storage-info'),
  checkOllamaAvailable: () => ipcRenderer.invoke('model:check-ollama'),
  installOllama: () => ipcRenderer.invoke('model:install-ollama'),
  openModelFolder: () => ipcRenderer.invoke('model:open-folder'),
  onModelInstallProgress: (callback: (progress: any) => void) => {
    const handler = (_: any, progress: any) => callback(progress);
    ipcRenderer.on('model:install-progress', handler);
    // Return a cleanup function
    return () => ipcRenderer.removeListener('model:install-progress', handler);
  },
  onOllamaInstalled: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('ollama-installed', handler);
    // Return a cleanup function
    return () => ipcRenderer.removeListener('ollama-installed', handler);
  },
  onOllamaStatusChanged: (callback: (status: { available: boolean }) => void) => {
    const handler = (_, status: { available: boolean }) => callback(status);
    ipcRenderer.on('ollama-status-changed', handler);
    return () => ipcRenderer.removeListener('ollama-status-changed', handler);
  },

  // Channel setup
  getWhatsAppQR: () => ipcRenderer.invoke('channels:whatsapp-qr'),
  startWhatsAppSetup: () => ipcRenderer.invoke('channels:whatsapp-start'),
  checkWhatsAppStatus: () => ipcRenderer.invoke('channels:check-whatsapp-status'),
  checkTelegramStatus: () => ipcRenderer.invoke('channels:check-telegram-status'),
  checkDiscordStatus: () => ipcRenderer.invoke('channels:check-discord-status'),
  disconnectWhatsApp: () => ipcRenderer.invoke('channels:disconnect-whatsapp'),
  disconnectTelegram: () => ipcRenderer.invoke('channels:disconnect-telegram'),
  disconnectDiscord: () => ipcRenderer.invoke('channels:disconnect-discord'),
  getWhatsAppMessages: () => ipcRenderer.invoke('channels:get-whatsapp-messages'),
  testTelegramBot: (token: string) => ipcRenderer.invoke('channels:test-telegram', token),
  connectTelegram: (token: string, name?: string) => ipcRenderer.invoke('channels:connect-telegram', token, name),
  testDiscordBot: (token: string) => ipcRenderer.invoke('channels:test-discord', token),
  connectDiscord: (token: string, serverId: string, name?: string) => ipcRenderer.invoke('channels:connect-discord', token, serverId, name),
  checkSlackStatus: () => ipcRenderer.invoke('channels:check-slack-status'),
  testSlackBot: (botToken: string) => ipcRenderer.invoke('channels:test-slack', botToken),
  connectSlack: (botToken: string, appToken: string, name?: string) => ipcRenderer.invoke('channels:connect-slack', botToken, appToken, name),
  disconnectSlack: () => ipcRenderer.invoke('channels:disconnect-slack'),
  onSlackStatusChange: (callback: (status: string) => void) => {
    const handler = (_: any, status: string) => callback(status)
    ipcRenderer.on('slack:status-change', handler)
    return () => ipcRenderer.removeListener('slack:status-change', handler)
  },

  // Gateway restart suggestion (after channel connect/disconnect)
  onGatewayRestartSuggested: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('gateway:restart-suggested', handler)
    return () => ipcRenderer.removeListener('gateway:restart-suggested', handler)
  },

  // Feishu channel setup
  checkFeishuStatus: () => ipcRenderer.invoke('channels:check-feishu-status'),
  connectFeishu: (appId: string, appSecret: string, botName?: string) => ipcRenderer.invoke('channels:connect-feishu', appId, appSecret, botName),
  disconnectFeishu: () => ipcRenderer.invoke('channels:disconnect-feishu'),

  // Line channel setup
  checkLineStatus: () => ipcRenderer.invoke('channels:check-line-status'),
  connectLine: (channelAccessToken: string, channelSecret: string) => ipcRenderer.invoke('channels:connect-line', channelAccessToken, channelSecret),
  disconnectLine: () => ipcRenderer.invoke('channels:disconnect-line'),

  // Agent management
  listAgents: () => ipcRenderer.invoke('agents:list'),
  getAgentInfo: (agentId: string) => ipcRenderer.invoke('agents:get-info', agentId),
  createAgent: (agentName: string, config: any) => ipcRenderer.invoke('agents:create', agentName, config),
  updateAgent: (agentId: string, config: any) => ipcRenderer.invoke('agents:update', agentId, config),
  deleteAgent: (agentId: string) => ipcRenderer.invoke('agents:delete', agentId),

  // System integration
  openExternal: (url: string) => ipcRenderer.invoke('system:open-external', url),
  showInFolder: (path: string) => ipcRenderer.invoke('system:show-in-folder', path),
  getSystemInfo: () => ipcRenderer.invoke('system:get-info'),

  // Skills management
  listSkills: () => ipcRenderer.invoke('skills:list'),
  checkSkills: () => ipcRenderer.invoke('skills:check'),
  getSkillInfo: (skillName: string) => ipcRenderer.invoke('skills:info', skillName),
  installSkillRequirements: (skillName: string) => ipcRenderer.invoke('skills:install', skillName),
  setSkillEnabled: (skillName: string, enabled: boolean) => ipcRenderer.invoke('skills:set-enabled', skillName, enabled),
  searchSkillRegistry: (query: string) => ipcRenderer.invoke('skills:search-registry', query),
  installSkillFromRegistry: (slug: string) => ipcRenderer.invoke('skills:install-from-registry', slug),
  removeSkill: (skillName: string) => ipcRenderer.invoke('skills:remove', skillName),
  listWorkspaceSkills: () => ipcRenderer.invoke('skills:list-workspace'),
  openSkillFolder: (skillName: string) => ipcRenderer.invoke('skills:open-folder', skillName),

  // Hooks management
  listHooks: () => ipcRenderer.invoke('hooks:list'),
  checkHooks: () => ipcRenderer.invoke('hooks:check'),
  getHookInfo: (hookName: string) => ipcRenderer.invoke('hooks:info', hookName),
  setHookEnabled: (hookName: string, enabled: boolean) => ipcRenderer.invoke('hooks:set-enabled', hookName, enabled),
  installHook: (hookSpec: string) => ipcRenderer.invoke('hooks:install', hookSpec),

  // Plugins management
  listPlugins: () => ipcRenderer.invoke('plugins:list'),
  getPluginInfo: (pluginId: string) => ipcRenderer.invoke('plugins:info', pluginId),
  enablePlugin: (pluginId: string) => ipcRenderer.invoke('plugins:enable', pluginId),
  disablePlugin: (pluginId: string) => ipcRenderer.invoke('plugins:disable', pluginId),
  installPlugin: (pluginSpec: string) => ipcRenderer.invoke('plugins:install', pluginSpec),
  updatePlugin: (pluginId: string) => ipcRenderer.invoke('plugins:update', pluginId),
  runPluginsDoctor: () => ipcRenderer.invoke('plugins:doctor'),

  // Model Manager page lifecycle
  startOllamaDetection: () => ipcRenderer.invoke('model:start-ollama-detection'),
  stopOllamaDetection: () => ipcRenderer.invoke('model:stop-ollama-detection'),

  // Cron management
  listCronJobs: () => ipcRenderer.invoke('cron:list'),
  addCronJob: (params: any) => ipcRenderer.invoke('cron:add', params),
  enableCronJob: (id: string) => ipcRenderer.invoke('cron:enable', id),
  disableCronJob: (id: string) => ipcRenderer.invoke('cron:disable', id),
  removeCronJob: (id: string) => ipcRenderer.invoke('cron:remove', id),
  runCronJob: (id: string) => ipcRenderer.invoke('cron:run', id),
  getCronRuns: (id: string, limit?: number) => ipcRenderer.invoke('cron:runs', id, limit),

  // Doctor management
  runDoctor: () => ipcRenderer.invoke('doctor:run'),

  // Dashboard Statistics
  getDashboardStatistics: () => ipcRenderer.invoke('dashboard:get-statistics'),

  // Session Management
  listSessions: (agentId?: string, activeMinutes?: number) => ipcRenderer.invoke('sessions:list', agentId, activeMinutes),
  getSession: (sessionKey: string) => ipcRenderer.invoke('sessions:get', sessionKey),
  createNewSession: (agentId?: string) => ipcRenderer.invoke('sessions:create-new', agentId),
  resetSession: (agentId?: string) => ipcRenderer.invoke('sessions:reset', agentId),
  deleteSession: (sessionKey: string, agentId?: string) => ipcRenderer.invoke('sessions:delete', sessionKey, agentId),

  // Agent routing management
  listAgentBindings: () => ipcRenderer.invoke('agent-bindings:list'),
  addAgentBinding: (binding: any) => ipcRenderer.invoke('agent-bindings:add', binding),
  removeAgentBinding: (agentId: string, channel: string) => ipcRenderer.invoke('agent-bindings:remove', agentId, channel),
  updateAgentBindings: (bindings: any[]) => ipcRenderer.invoke('agent-bindings:update', bindings),
  testAgentRouting: (params: {
    channel: string;
    accountId?: string;
    peerId?: string;
    peerKind?: "dm" | "group" | "channel";
  }) => ipcRenderer.invoke('agent-bindings:test-routing', params),
  getSessionConfig: () => ipcRenderer.invoke('session-config:get'),
  updateSessionConfig: (config: any) => ipcRenderer.invoke('session-config:update', config),

  // Terminal management for onboarding wizard
  // Spawns embedded OpenClaw directly — renderer passes only the CLI args
  createOpenclawTerminal: (args: string[]) =>
    ipcRenderer.invoke('terminal:create-openclaw', args),
  createTerminal: (command: string, args: string[], options?: { cwd?: string }) =>
    ipcRenderer.invoke('terminal:create', command, args, options),

  writeToTerminal: (terminalId: string, data: string) =>
    ipcRenderer.invoke('terminal:write', terminalId, data),

  resizeTerminal: (terminalId: string, cols: number, rows: number) =>
    ipcRenderer.invoke('terminal:resize', terminalId, cols, rows),

  killTerminal: (terminalId: string) =>
    ipcRenderer.invoke('terminal:kill', terminalId),

  onTerminalData: (callback: (terminalId: string, data: string) => void) => {
    const handler = (_: any, terminalId: string, data: string) => callback(terminalId, data);
    ipcRenderer.on('terminal:data', handler);
    return () => ipcRenderer.removeListener('terminal:data', handler);
  },

  onTerminalExit: (callback: (terminalId: string, exitCode: number) => void) => {
    const handler = (_: any, terminalId: string, exitCode: number) => callback(terminalId, exitCode);
    ipcRenderer.on('terminal:exit', handler);
    return () => ipcRenderer.removeListener('terminal:exit', handler);
  },

  // Tools configuration management
  getToolsConfig: () => ipcRenderer.invoke('tools:get-config'),
  setToolProfile: (profile: string) => ipcRenderer.invoke('tools:set-profile', profile),
  setExecHost: (host: string, applyToAllAgents?: boolean) => ipcRenderer.invoke('tools:set-exec-host', host, applyToAllAgents),
  setExecSecurity: (security: string, applyToAllAgents?: boolean) => ipcRenderer.invoke('tools:set-exec-security', security, applyToAllAgents),
  setSafeBins: (bins: string[]) => ipcRenderer.invoke('tools:set-safe-bins', bins),
  setWebSearchEnabled: (enabled: boolean) => ipcRenderer.invoke('tools:set-web-search', enabled),
  setWebFetchEnabled: (enabled: boolean) => ipcRenderer.invoke('tools:set-web-fetch', enabled),
  allowTool: (tool: string) => ipcRenderer.invoke('tools:allow-tool', tool),
  denyTool: (tool: string) => ipcRenderer.invoke('tools:deny-tool', tool),
  allowToolGroup: (group: string) => ipcRenderer.invoke('tools:allow-group', group),
  denyToolGroup: (group: string) => ipcRenderer.invoke('tools:deny-group', group),
  updateToolsConfig: (updates: any, applyToAllAgents?: boolean) => ipcRenderer.invoke('tools:update-config', updates, applyToAllAgents),
  reconfigureExecApprovals: () => ipcRenderer.invoke('tools:reconfigure-exec-approvals'),

  // Settings management
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (updates: any) => ipcRenderer.invoke('settings:update', updates),
  setStartOnBoot: (enabled: boolean) => ipcRenderer.invoke('settings:set-start-on-boot', enabled),
  getStartOnBoot: () => ipcRenderer.invoke('settings:get-start-on-boot'),
  setMinimizeToTray: (enabled: boolean) => ipcRenderer.invoke('settings:set-minimize-to-tray', enabled),
  setAutoUpdate: (enabled: boolean) => ipcRenderer.invoke('settings:set-auto-update', enabled),
  setTelemetry: (enabled: boolean) => ipcRenderer.invoke('settings:set-telemetry', enabled),
  setLanguage: (language: string) => ipcRenderer.invoke('settings:set-language', language),

  // System permissions (macOS + Windows)
  getPlatform: () => process.platform,
  checkAllPermissions: () => ipcRenderer.invoke('permissions:check-all'),
  requestPermission: (type: 'microphone' | 'camera') => ipcRenderer.invoke('permissions:request', type),
  openPermissionSettings: (type: string) => ipcRenderer.invoke('permissions:open-system-settings', type),

  // Workspace file management
  listWorkspaceFiles: () => ipcRenderer.invoke('workspace:list'),
  readWorkspaceFile: (name: string) => ipcRenderer.invoke('workspace:read', name),
  writeWorkspaceFile: (name: string, content: string) => ipcRenderer.invoke('workspace:write', name, content),
  createWorkspaceFile: (name: string) => ipcRenderer.invoke('workspace:create', name),
  deleteWorkspaceFile: (name: string) => ipcRenderer.invoke('workspace:delete', name),
  listMemoryFiles: () => ipcRenderer.invoke('workspace:list-memory'),
  readMemoryFile: (name: string) => ipcRenderer.invoke('workspace:read-memory', name),

  // Window controls (frameless window on Windows)
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),

  // Speech-to-Text
  transcribeAudio: (audioBase64: string) => ipcRenderer.invoke('stt:transcribe', audioBase64),

  // Whisper Server management
  detectWhisperServer: () => ipcRenderer.invoke('whisper-server:detect'),
  installWhisperServer: () => ipcRenderer.invoke('whisper-server:install'),
  startWhisperServer: (model?: string, port?: number) => ipcRenderer.invoke('whisper-server:start', model, port),
  stopWhisperServer: () => ipcRenderer.invoke('whisper-server:stop'),
  getWhisperServerStatus: () => ipcRenderer.invoke('whisper-server:status'),
  onWhisperServerStatus: (callback: (status: any) => void) => {
    const handler = (_: any, status: any) => callback(status)
    ipcRenderer.on('whisper-server:status-update', handler)
    return () => ipcRenderer.removeListener('whisper-server:status-update', handler)
  },
  onWhisperServerLog: (callback: (message: string) => void) => {
    const handler = (_: any, message: string) => callback(message)
    ipcRenderer.on('whisper-server:log', handler)
    return () => ipcRenderer.removeListener('whisper-server:log', handler)
  },

  // App update
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  onUpdateAvailable: (cb: (data: any) => void) => {
    const handler = (_: any, data: any) => cb(data)
    ipcRenderer.on('app:update-available', handler)
    return () => ipcRenderer.removeListener('app:update-available', handler)
  },
  removeUpdateAvailableListener: () => ipcRenderer.removeAllListeners('app:update-available'),
}

// Use `contextBridge` APIs to expose Electron APIs to renderer
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electronAPI', api)
  } catch (error) {
    console.error('Error exposing API:', error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electronAPI = api
}