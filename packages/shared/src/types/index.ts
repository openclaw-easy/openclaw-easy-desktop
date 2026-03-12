// OpenClaw configuration types
export interface OpenClawConfig {
  agent: {
    model: string;
    provider: ModelProvider;
  };
  channels: {
    whatsapp?: WhatsAppConfig;
    telegram?: TelegramConfig;
    discord?: DiscordConfig;
    slack?: SlackConfig;
    signal?: SignalConfig;
  };
  gateway: {
    mode: 'local' | 'cloud';
    port?: number;
  };
}

export interface ModelProvider {
  type: 'anthropic' | 'openai';
  baseUrl: string;
  apiKey: string;
}

// Channel configuration types
export interface WhatsAppConfig {
  enabled: boolean;
  accountId: string;
}

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  allowedUsers?: string[];
}

export interface DiscordConfig {
  enabled: boolean;
  botToken: string;
  allowedChannels?: string[];
}

export interface SlackConfig {
  enabled: boolean;
  botToken: string;
  signingSecret: string;
}

export interface SignalConfig {
  enabled: boolean;
  phoneNumber: string;
}

// Setup wizard state
export type SetupStep =
  | 'welcome'
  | 'channels'
  | 'whatsapp'
  | 'telegram'
  | 'discord'
  | 'complete';

export interface SetupWizardState {
  currentStep: SetupStep;
  completed: boolean;
  selectedChannels: string[];
  whatsappSetup?: {
    qrCode?: string;
    connected: boolean;
  };
  telegramSetup?: {
    botToken?: string;
    botUsername?: string;
    connected: boolean;
  };
  discordSetup?: {
    botToken?: string;
    connected: boolean;
  };
}

// API types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// Model management types
export interface ModelInfo {
  name: string;
  tag: string;
  size: string;
  modified: string;
  digest?: string;
  status: 'available' | 'downloading' | 'installed' | 'error';
  downloadProgress?: number;
}

export interface ModelDownloadProgress {
  modelName: string;
  progress: number;
  status: string;
  total?: number;
  completed?: number;
}

// Real-time event types
export interface StatusUpdateEvent {
  status: 'stopped' | 'starting' | 'running' | 'error';
  timestamp: string;
  previousStatus?: 'stopped' | 'starting' | 'running' | 'error';
}

export interface LogUpdateEvent {
  timestamp: string;
  message: string;
  fullEntry: string;
}

export interface HealthUpdateEvent {
  status: 'stopped' | 'starting' | 'running' | 'error';
  logCount: number;
  uptime: number;
  timestamp: string;
}

// Electron IPC types
export interface ElectronAPI {
  // OpenClaw process management
  startOpenClaw: () => Promise<boolean>;
  stopOpenClaw: () => Promise<boolean>;
  getOpenClawStatus: () => Promise<'running' | 'stopped' | 'error'>;
  getOpenClawLogs: () => Promise<string[]>;

  // Configuration management
  generateConfig: (config: Partial<OpenClawConfig>) => Promise<boolean>;
  validateApiKey: (provider: string, apiKey: string) => Promise<boolean>;

  // Model management
  installModel: (modelId: string, size?: string) => Promise<{ success: boolean; message: string }>;
  configureModel: (modelId: string) => Promise<{ success: boolean; message: string }>;
  getInstalledModels: () => Promise<ModelInfo[]>;
  getAvailableModels: () => Promise<string[]>;
  removeModel: (modelId: string) => Promise<{ success: boolean; message: string }>;
  validateModel: (modelId: string) => Promise<{ success: boolean; message: string }>;
  getModelInfo: (modelId: string) => Promise<ModelInfo | null>;
  getStorageInfo: () => Promise<{ totalSize: string; modelCount: number }>;
  checkOllamaAvailable: () => Promise<boolean>;
  installOllama: () => Promise<{ success: boolean; message: string }>;
  onModelInstallProgress: (callback: (progress: ModelDownloadProgress) => void) => () => void;

  // Real-time event subscriptions
  onStatusUpdate: (callback: (status: StatusUpdateEvent) => void) => () => void;
  onLogUpdate: (callback: (log: LogUpdateEvent) => void) => () => void;
  onHealthUpdate: (callback: (health: HealthUpdateEvent) => void) => () => void;

  // Channel setup
  getWhatsAppQR: () => Promise<string>;
  testTelegramBot: (token: string) => Promise<{ valid: boolean; username?: string }>;

  // System
  openExternal: (url: string) => Promise<void>;
  showInFolder: (path: string) => Promise<void>;
}
