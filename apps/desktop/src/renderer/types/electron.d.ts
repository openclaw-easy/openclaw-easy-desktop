import { AppConfig } from '../stores/configStore';
import { AppStatus } from '../hooks/useAppBridge';

// Agent routing types (from OpenClaw source)
export interface AgentBinding {
  agentId: string;
  match: {
    channel: string;
    accountId?: string;
    peer?: {
      kind: "dm" | "group" | "channel";
      id: string;
    };
    guildId?: string;  // Discord server ID
    teamId?: string;   // Slack workspace ID
  };
}

export interface ResolvedAgentRoute {
  agentId: string;
  accountId: string;
  sessionKey: string;
  matchedBy: "binding.peer" | "binding.peer.parent" | "binding.guild+roles" |
             "binding.guild" | "binding.team" | "binding.account" |
             "binding.channel" | "default";
}

export interface AgentBindingResult {
  success: boolean;
  error?: string;
  bindings?: (AgentBinding & { description: string; normalizedAgentId: string })[];
  added?: AgentBinding[];
  skipped?: AgentBinding[];
  conflicts?: Array<{ binding: AgentBinding; existingAgentId: string }>;
  removed?: number;
  route?: ResolvedAgentRoute;
}

// Update info returned by checkForUpdates / sent with app:update-available
export interface UpdateInfo {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
  releaseDate: string
  downloads: {
    'mac-arm64': string
    'mac-x64': string
    'win-x64': string
  }
}

// Session management types
export interface SessionConfig {
  dmScope?: "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer";
  identityLinks?: Record<string, string[]>;
}

export interface ElectronAPI {
  // Config
  getConfig: () => Promise<AppConfig | null>;
  saveConfig: (config: AppConfig) => Promise<void>;
  configExists: () => Promise<boolean>;

  // OpenClaw Management
  startOpenClaw: () => Promise<void>;
  stopOpenClaw: () => Promise<void>;
  getStatus: () => Promise<AppStatus>;
  getOpenClawConfig: () => Promise<{ success: boolean; config?: any; error?: string }>;
  getGatewayToken: () => Promise<string | null>;
  getGatewayPort: () => Promise<number>;

  // API Validation
  validateApiKey: (provider: 'anthropic' | 'openai' | 'google', apiKey: string) => Promise<boolean>;

  // Event Listeners
  onStatusUpdate: (callback: (status: AppStatus) => void) => () => void;
  onLogUpdate: (callback: (log: string) => void) => () => void;

  // Channel Management
  getWhatsAppQR: () => Promise<string>;
  getWhatsAppMessages: () => Promise<{ success: boolean; messages?: any[]; error?: string }>;
  connectTelegram: (token: string) => Promise<boolean>;
  disconnectTelegram: () => Promise<{ success: boolean; logs: string[] }>;
  disconnectDiscord: () => Promise<{ success: boolean; logs: string[] }>;
  checkSlackStatus: () => Promise<{ connected: boolean }>;
  testSlackBot: (botToken: string) => Promise<{ success: boolean; teamName?: string; botName?: string; error?: string }>;
  connectSlack: (botToken: string, appToken: string, name?: string) => Promise<{ success: boolean; error?: string }>;
  disconnectSlack: () => Promise<{ success: boolean; logs: string[] }>;
  onSlackStatusChange: (callback: (status: 'connected' | 'disconnected' | 'error') => void) => () => void;
  onGatewayRestartSuggested: (callback: () => void) => () => void;
  getChannelStatus: () => Promise<Record<string, boolean>>;
  checkFeishuStatus: () => Promise<{ connected: boolean }>;
  connectFeishu: (appId: string, appSecret: string, botName?: string) => Promise<{ success: boolean; error?: string }>;
  disconnectFeishu: () => Promise<{ success: boolean; logs: string[] }>;
  checkLineStatus: () => Promise<{ connected: boolean }>;
  connectLine: (channelAccessToken: string, channelSecret: string) => Promise<{ success: boolean; error?: string }>;
  disconnectLine: () => Promise<{ success: boolean; logs: string[] }>;

  // System Integration
  openExternal: (url: string) => Promise<void>;
  showInFolder: (path: string) => Promise<void>;

  // Agent Management
  listAgents: () => Promise<any[]>;
  getAgentInfo: (agentId: string) => Promise<any>;
  createAgent: (agentName: string, config: any) => Promise<{ success: boolean; error?: string }>;
  updateAgent: (agentId: string, config: any) => Promise<{ success: boolean; error?: string }>;
  deleteAgent: (agentId: string) => Promise<{ success: boolean; error?: string }>;

  // Model Management
  installModel: (modelId: string, size?: string) => Promise<{ success: boolean; message: string }>;
  configureModel: (modelId: string) => Promise<{ success: boolean; message: string }>;
  getInstalledModels: () => Promise<any[]>;
  getAvailableModels: () => Promise<any[]>;
  removeModel: (modelId: string) => Promise<{ success: boolean; message: string }>;
  validateModel: (modelId: string) => Promise<{ success: boolean; message: string }>;
  getModelInfo: (modelId: string) => Promise<any>;
  getStorageInfo: () => Promise<{ totalSize: string; modelCount: number }>;
  checkOllamaAvailable: () => Promise<boolean>;
  installOllama: () => Promise<{ success: boolean; message: string }>;
  openModelFolder: () => Promise<{ success: boolean; message?: string }>;
  onModelInstallProgress: (callback: (progress: any) => void) => () => void;
  onOllamaInstalled: (callback: () => void) => () => void;
  onOllamaStatusChanged: (callback: (status: { available: boolean }) => void) => () => void;

  // System Info
  getSystemInfo: () => Promise<any>;

  // Skills Management
  listSkills: () => Promise<{ success: boolean; skills?: any[]; error?: string }>;
  checkSkills: () => Promise<{ success: boolean; status?: any; error?: string }>;
  getSkillInfo: (skillName: string) => Promise<{ success: boolean; info?: any; error?: string }>;
  installSkillRequirements: (skillName: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  setSkillEnabled: (skillName: string, enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  searchSkillRegistry: (query: string) => Promise<{ success: boolean; skills?: any[]; total?: number; error?: string }>;
  installSkillFromRegistry: (slug: string) => Promise<{ success: boolean; output?: string; error?: string }>;
  removeSkill: (skillName: string) => Promise<{ success: boolean; error?: string }>;
  listWorkspaceSkills: () => Promise<{ success: boolean; skills?: Array<{ dir: string; name: string }>; error?: string }>;
  openSkillFolder: (skillName: string) => Promise<{ success: boolean; error?: string }>;

  // Hooks Management
  listHooks: () => Promise<{ success: boolean; hooks?: any[]; error?: string }>;
  checkHooks: () => Promise<{ success: boolean; status?: any; error?: string }>;
  getHookInfo: (hookName: string) => Promise<{ success: boolean; info?: any; error?: string }>;
  setHookEnabled: (hookName: string, enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  installHook: (hookSpec: string) => Promise<{ success: boolean; message?: string; error?: string }>;

  // Plugins Management
  listPlugins: () => Promise<{ success: boolean; plugins?: any[]; error?: string }>;
  getPluginInfo: (pluginId: string) => Promise<{ success: boolean; info?: any; error?: string }>;
  enablePlugin: (pluginId: string) => Promise<{ success: boolean; error?: string }>;
  disablePlugin: (pluginId: string) => Promise<{ success: boolean; error?: string }>;
  installPlugin: (pluginSpec: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  updatePlugin: (pluginId: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  runPluginsDoctor: () => Promise<{ success: boolean; results?: any; error?: string }>;

  // Cron Management
  listCronJobs: () => Promise<{ success: boolean; jobs?: any[]; error?: string }>;
  addCronJob: (params: {
    name: string;
    scheduleKind: 'every' | 'cron' | 'at';
    scheduleValue: string;
    payloadKind: 'message' | 'system-event';
    payloadValue: string;
    agentId?: string;
  }) => Promise<{ success: boolean; job?: any; error?: string }>;
  enableCronJob: (id: string) => Promise<{ success: boolean; error?: string }>;
  disableCronJob: (id: string) => Promise<{ success: boolean; error?: string }>;
  removeCronJob: (id: string) => Promise<{ success: boolean; error?: string }>;
  runCronJob: (id: string) => Promise<{ success: boolean; error?: string }>;
  getCronRuns: (id: string, limit?: number) => Promise<{ success: boolean; runs?: any[]; error?: string }>;

  // Model Manager page lifecycle
  startOllamaDetection: () => Promise<{ success: boolean }>;
  stopOllamaDetection: () => Promise<{ success: boolean }>;

  // Agent Routing Management
  listAgentBindings: () => Promise<AgentBindingResult>;
  addAgentBinding: (binding: AgentBinding) => Promise<AgentBindingResult>;
  removeAgentBinding: (agentId: string, channel: string) => Promise<AgentBindingResult>;
  updateAgentBindings: (bindings: AgentBinding[]) => Promise<AgentBindingResult>;
  testAgentRouting: (params: {
    channel: string;
    accountId?: string;
    peerId?: string;
    peerKind?: "dm" | "group" | "channel";
  }) => Promise<AgentBindingResult>;
  getSessionConfig: () => Promise<{ success: boolean; config?: SessionConfig; error?: string }>;
  updateSessionConfig: (config: SessionConfig) => Promise<{ success: boolean; error?: string }>;

  // Dashboard Statistics
  getDashboardStatistics: () => Promise<{
    success: boolean;
    statistics?: {
      messagesToday: number;
      activeChannels: number;
      responseTime: string;
      uptime: string;
      totalSessions: number;
      activeSessions: number;
      totalTokens: number;
      messagesThisWeek: number;
      trend: {
        messagesToday: number;
        activeChannels: number;
        responseTime: number;
        uptime: number;
        totalSessions: number;
        activeSessions: number;
        totalTokens: number;
        messagesThisWeek: number;
      };
    };
    error?: string;
  }>;

  // Session Management
  listSessions: (agentId?: string, activeMinutes?: number) => Promise<{
    success: boolean;
    sessions?: Array<{
      key: string;
      kind: string;
      chatType: string;
      updatedAt?: number;
      inputTokens?: number;
      outputTokens?: number;
      messageCount?: number;
    }>;
    error?: string;
  }>;
  getSession: (sessionKey: string) => Promise<{
    success: boolean;
    session?: any;
    error?: string;
  }>;
  createNewSession: (agentId?: string) => Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }>;
  resetSession: (agentId?: string) => Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }>;
  deleteSession: (sessionKey: string, agentId?: string) => Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }>;

  // Terminal Management for Onboarding Wizard
  // Spawns embedded OpenClaw — always bypasses any globally installed openclaw binary
  createOpenclawTerminal: (
    args: string[]
  ) => Promise<{ terminalId: string; pid: number }>;

  createTerminal: (
    command: string,
    args: string[],
    options?: { cwd?: string }
  ) => Promise<{ terminalId: string; pid: number }>;

  writeToTerminal: (
    terminalId: string,
    data: string
  ) => Promise<{ success: boolean; error?: string }>;

  resizeTerminal: (
    terminalId: string,
    cols: number,
    rows: number
  ) => Promise<{ success: boolean; error?: string }>;

  killTerminal: (
    terminalId: string
  ) => Promise<{ success: boolean; error?: string }>;

  onTerminalData: (
    callback: (terminalId: string, data: string) => void
  ) => () => void;

  onTerminalExit: (
    callback: (terminalId: string, exitCode: number) => void
  ) => () => void;

  // Tools Configuration Management
  getToolsConfig: () => Promise<{ success: boolean; config?: any; error?: string }>;
  setToolProfile: (profile: string, applyToAllAgents?: boolean) => Promise<{ success: boolean; error?: string }>;
  setExecHost: (host: string, applyToAllAgents?: boolean) => Promise<{ success: boolean; error?: string }>;
  setExecSecurity: (security: string, applyToAllAgents?: boolean) => Promise<{ success: boolean; error?: string }>;
  setSafeBins: (bins: string[], applyToAllAgents?: boolean) => Promise<{ success: boolean; error?: string }>;
  setWebSearchEnabled: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  setWebFetchEnabled: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  allowTool: (tool: string) => Promise<{ success: boolean; error?: string }>;
  denyTool: (tool: string) => Promise<{ success: boolean; error?: string }>;
  allowToolGroup: (group: string) => Promise<{ success: boolean; error?: string }>;
  denyToolGroup: (group: string) => Promise<{ success: boolean; error?: string }>;
  updateToolsConfig: (updates: any, applyToAllAgents?: boolean) => Promise<{ success: boolean; error?: string }>;

  // Language
  setLanguage: (language: string) => Promise<void>;

  // System permissions (macOS + Windows)
  getPlatform: () => string;
  checkAllPermissions: () => Promise<{
    microphone: string;
    camera: string;
    screen: string;
    accessibility: string;
  } | null>;
  requestPermission: (type: 'microphone' | 'camera') => Promise<boolean>;
  openPermissionSettings: (type: string) => Promise<boolean>;

  // Workspace file management
  listWorkspaceFiles: () => Promise<{ success: boolean; files?: Array<{ name: string; size: number; modified: number }>; error?: string }>
  readWorkspaceFile: (name: string) => Promise<{ success: boolean; content?: string; error?: string }>
  writeWorkspaceFile: (name: string, content: string) => Promise<{ success: boolean; error?: string }>
  createWorkspaceFile: (name: string) => Promise<{ success: boolean; error?: string }>
  deleteWorkspaceFile: (name: string) => Promise<{ success: boolean; error?: string }>
  listMemoryFiles: () => Promise<{ success: boolean; files?: Array<{ name: string; path: string; date: string; size: number; modified: number }>; error?: string }>
  readMemoryFile: (path: string) => Promise<{ success: boolean; content?: string; error?: string }>

  // Device identity for WebSocket auth
  buildDeviceIdentity: (opts: {
    clientId: string; clientMode: string; role: string;
    scopes: string[]; token: string; nonce: string;
  }) => Promise<any>

  // Gateway info
  getGatewayInfo: () => Promise<{ port?: number; [key: string]: any }>

  // Window controls (frameless window on Windows)
  windowMinimize: () => Promise<void>
  windowMaximize: () => Promise<void>
  windowClose: () => Promise<void>

  // Speech-to-Text
  transcribeAudio: (audioBase64: string) => Promise<{ success: boolean; transcript?: string; error?: string }>

  // Whisper Server management
  detectWhisperServer: () => Promise<{
    installed: boolean
    canInstall: boolean
    installerTool: 'pipx' | 'pip3' | null
    binaryPath?: string
  }>
  installWhisperServer: () => Promise<{ success: boolean; error?: string }>
  startWhisperServer: (model?: string, port?: number) => Promise<{ success: boolean; error?: string }>
  stopWhisperServer: () => Promise<{ success: boolean }>
  getWhisperServerStatus: () => Promise<{
    status: 'stopped' | 'installing' | 'starting' | 'running' | 'error'
    port: number
    model: string
    installed: boolean
    error?: string
  }>
  onWhisperServerStatus: (callback: (status: {
    status: 'stopped' | 'installing' | 'starting' | 'running' | 'error'
    port: number
    model: string
    installed: boolean
    error?: string
  }) => void) => () => void
  onWhisperServerLog: (callback: (message: string) => void) => () => void

  // App update
  getAppVersion: () => Promise<string>
  checkForUpdates: () => Promise<UpdateInfo>
  onUpdateAvailable: (cb: (data: UpdateInfo) => void) => () => void
  removeUpdateAvailableListener: () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}