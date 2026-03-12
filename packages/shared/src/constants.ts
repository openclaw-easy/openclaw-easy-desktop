// Constants for Openclaw Easy

export const SUPPORTED_CHANNELS = {
  whatsapp: {
    name: 'WhatsApp',
    description: 'Connect your personal WhatsApp account',
    icon: '📱',
    setupComplexity: 'easy', // QR code scan
    popular: true,
  },
  telegram: {
    name: 'Telegram',
    description: 'Create a Telegram bot for your assistant',
    icon: '✈️',
    setupComplexity: 'medium', // Need to create bot with BotFather
    popular: true,
  },
  discord: {
    name: 'Discord',
    description: 'Add your assistant to Discord servers',
    icon: '🎮',
    setupComplexity: 'hard', // Bot creation + OAuth
    popular: false,
  },
  slack: {
    name: 'Slack',
    description: 'Connect to your Slack workspace',
    icon: '💬',
    setupComplexity: 'hard', // App creation + OAuth
    popular: false,
  },
  signal: {
    name: 'Signal',
    description: 'Connect to Signal messenger',
    icon: '🔒',
    setupComplexity: 'hard', // Signal-cli setup
    popular: false,
  },
} as const;

export const MODEL_CONFIGS = {
  DIRECT_ANTHROPIC: {
    type: 'anthropic' as const,
    baseUrl: 'https://api.anthropic.com',
    requiresApiKey: true,
  },
  DIRECT_OPENAI: {
    type: 'openai' as const,
    baseUrl: 'https://api.openai.com/v1',
    requiresApiKey: true,
  },
} as const;

// Error messages
export const ERRORS = {
  OPENCLAW_NOT_FOUND: 'OpenClaw is not installed or not in PATH',
  OPENCLAW_START_FAILED: 'Failed to start OpenClaw process',
  INVALID_API_KEY: 'Invalid API key provided',
  TELEGRAM_INVALID_TOKEN: 'Invalid Telegram bot token format',
  WHATSAPP_QR_EXPIRED: 'WhatsApp QR code has expired, please refresh',
  NETWORK_ERROR: 'Network error, please check your connection',
} as const;

// File paths
export const PATHS = {
  OPENCLAW_CONFIG: '.openclaw/config.json',
  MOLTBOT_CONFIG: '.moltbot-easy/config.json',
  OPENCLAW_LOGS: '.openclaw/logs',
  BUNDLE_DIR: 'resources/openclaw', // Bundled OpenClaw in Electron app
} as const;
