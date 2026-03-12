/**
 * OpenClaw Easy Command Catalog
 *
 * Every command here runs through createOpenclawTerminal() in the main process,
 * which resolves the embedded src/index.ts via __dirname — always bypassing any
 * globally installed openclaw binary.
 */

export type CommandCategory =
  | 'system'
  | 'gateway'
  | 'channels'
  | 'skills'
  | 'agents'
  | 'schedule'
  | 'models'
  | 'sessions'
  | 'memory'
  | 'hooks'
  | 'browser'

export interface CommandParam {
  /** Unique key for this param's form state */
  paramId: string
  /** CLI flag e.g. '--channel', or '' for a positional arg */
  flag: string
  label: string
  type: 'text' | 'select' | 'password'
  options?: string[]
  placeholder?: string
  required: boolean
  default?: string
}

export interface CommandDef {
  id: string
  category: CommandCategory
  icon: string
  title: string
  description: string
  /** Base CLI args — param values are appended after these */
  args: string[]
  params?: CommandParam[]
  danger?: boolean
  dangerMessage?: string
}

export const CATEGORY_LABELS: Record<CommandCategory, string> = {
  system:   '🔧 System',
  gateway:  '🌐 Gateway',
  channels: '📡 Channels',
  skills:   '🎯 Skills',
  agents:   '🤖 Agents',
  schedule: '⏰ Schedule',
  models:   '🧠 Models',
  sessions: '💬 Sessions',
  memory:   '💾 Memory',
  hooks:    '🪝 Hooks',
  browser:  '🌍 Browser',
}

/** Shared channel list for dropdown params — core + common extensions */
const CHANNEL_OPTIONS = [
  'whatsapp', 'telegram', 'discord', 'slack', 'signal',
  'matrix', 'teams', 'feishu', 'line',
]

export const COMMANDS: CommandDef[] = [

  // ── System ──────────────────────────────────────────────────────────────
  {
    id: 'doctor',
    category: 'system',
    icon: '🩺',
    title: 'Check System Health',
    description: 'Run diagnostics and auto-fix common issues with your OpenClaw setup',
    args: ['doctor'],
  },
  {
    id: 'update',
    category: 'system',
    icon: '⬆️',
    title: 'Update OpenClaw',
    description: 'Download and install the latest version of OpenClaw',
    args: ['update'],
  },
  {
    id: 'configure',
    category: 'system',
    icon: '🧙',
    title: 'Configuration Wizard',
    description: 'Interactive step-by-step setup for gateway, models, and workspace',
    args: ['configure'],
  },
  {
    id: 'config-get',
    category: 'system',
    icon: '🔍',
    title: 'Get Config Value',
    description: 'Read a specific configuration value by key path',
    args: ['config', 'get'],
    params: [
      { paramId: 'key', flag: '', label: 'Config Key', type: 'text', placeholder: 'e.g. gateway.port', required: true },
    ],
  },
  {
    id: 'config-set',
    category: 'system',
    icon: '✏️',
    title: 'Set Config Value',
    description: 'Write a configuration value by key path',
    args: ['config', 'set'],
    params: [
      { paramId: 'key', flag: '', label: 'Config Key', type: 'text', placeholder: 'e.g. gateway.port', required: true },
      { paramId: 'value', flag: '', label: 'Value', type: 'text', placeholder: 'New value', required: true },
    ],
  },
  {
    id: 'config-unset',
    category: 'system',
    icon: '🧹',
    title: 'Unset Config Value',
    description: 'Remove a configuration key and revert it to the default',
    args: ['config', 'unset'],
    params: [
      { paramId: 'key', flag: '', label: 'Config Key', type: 'text', placeholder: 'e.g. gateway.port', required: true },
    ],
  },
  {
    id: 'security-audit',
    category: 'system',
    icon: '🔒',
    title: 'Security Audit',
    description: 'Scan your configuration for security vulnerabilities and misconfigurations',
    args: ['security', 'audit'],
  },
  {
    id: 'reset',
    category: 'system',
    icon: '🔁',
    title: 'Reset State',
    description: 'Reset local OpenClaw state and configuration to defaults',
    args: ['reset'],
    danger: true,
    dangerMessage: 'This will clear local configuration and state. Your gateway data is not affected.',
  },

  // ── Gateway ──────────────────────────────────────────────────────────────
  {
    id: 'gateway-status',
    category: 'gateway',
    icon: '📊',
    title: 'Gateway Status',
    description: 'Show whether the OpenClaw Gateway service is running',
    args: ['gateway', 'status'],
  },
  {
    id: 'gateway-health',
    category: 'gateway',
    icon: '💚',
    title: 'Gateway Health',
    description: 'Fetch detailed health metrics from the running Gateway',
    args: ['gateway', 'health'],
  },
  {
    id: 'gateway-start',
    category: 'gateway',
    icon: '▶️',
    title: 'Start Gateway',
    description: 'Start the installed OpenClaw Gateway service',
    args: ['gateway', 'start'],
  },
  {
    id: 'gateway-stop',
    category: 'gateway',
    icon: '⏹️',
    title: 'Stop Gateway',
    description: 'Stop the running OpenClaw Gateway service cleanly',
    args: ['gateway', 'stop'],
    danger: true,
    dangerMessage: 'This will disconnect all active channels and sessions until the gateway is started again.',
  },
  {
    id: 'gateway-restart',
    category: 'gateway',
    icon: '🔄',
    title: 'Restart Gateway',
    description: 'Stop and restart the OpenClaw Gateway service',
    args: ['gateway', 'restart'],
    danger: true,
    dangerMessage: 'This will briefly disconnect all active channels and sessions.',
  },
  {
    id: 'gateway-install',
    category: 'gateway',
    icon: '📦',
    title: 'Install Gateway Service',
    description: 'Install the Gateway as a system service that starts automatically on login',
    args: ['gateway', 'install'],
  },
  {
    id: 'gateway-probe',
    category: 'gateway',
    icon: '🔎',
    title: 'Probe Gateway',
    description: 'Test connectivity and latency to the Gateway endpoint',
    args: ['gateway', 'probe'],
  },

  // ── Channels ─────────────────────────────────────────────────────────────
  {
    id: 'channels-list',
    category: 'channels',
    icon: '📋',
    title: 'List Channels',
    description: 'Show all connected messaging channels and their current status',
    args: ['channels', 'list'],
  },
  {
    id: 'channels-status',
    category: 'channels',
    icon: '📡',
    title: 'Channel Status',
    description: 'Check the connection status of a specific channel',
    args: ['channels', 'status'],
    params: [
      {
        paramId: 'channel', flag: '--channel', label: 'Channel', type: 'select',
        options: CHANNEL_OPTIONS,
        required: true,
      },
    ],
  },
  {
    id: 'channels-logs',
    category: 'channels',
    icon: '📜',
    title: 'Channel Logs',
    description: 'View recent activity and message logs for a channel',
    args: ['channels', 'logs'],
    params: [
      {
        paramId: 'channel', flag: '--channel', label: 'Channel', type: 'select',
        options: CHANNEL_OPTIONS,
        required: true,
      },
    ],
  },
  {
    id: 'channels-add',
    category: 'channels',
    icon: '➕',
    title: 'Add Channel',
    description: 'Set up a new messaging channel connection (interactive wizard)',
    args: ['channels', 'add'],
    params: [
      {
        paramId: 'channel', flag: '--channel', label: 'Channel', type: 'select',
        options: CHANNEL_OPTIONS,
        required: true,
      },
    ],
  },
  {
    id: 'channels-login',
    category: 'channels',
    icon: '🔑',
    title: 'Channel Login',
    description: 'Re-authenticate or refresh the login session for a channel',
    args: ['channels', 'login'],
    params: [
      {
        paramId: 'channel', flag: '--channel', label: 'Channel', type: 'select',
        options: CHANNEL_OPTIONS,
        required: true,
      },
    ],
  },
  {
    id: 'channels-logout',
    category: 'channels',
    icon: '🚪',
    title: 'Channel Logout',
    description: 'Log out and disconnect a channel session',
    args: ['channels', 'logout'],
    params: [
      {
        paramId: 'channel', flag: '--channel', label: 'Channel', type: 'select',
        options: CHANNEL_OPTIONS,
        required: true,
      },
    ],
  },
  {
    id: 'channels-remove',
    category: 'channels',
    icon: '🗑️',
    title: 'Remove Channel',
    description: 'Unregister and remove a channel account configuration',
    args: ['channels', 'remove'],
    params: [
      {
        paramId: 'channel', flag: '--channel', label: 'Channel', type: 'select',
        options: CHANNEL_OPTIONS,
        required: true,
      },
    ],
    danger: true,
    dangerMessage: 'This will remove the channel configuration. You can re-add it later.',
  },

  // ── Skills ────────────────────────────────────────────────────────────────
  {
    id: 'skills-list',
    category: 'skills',
    icon: '🎯',
    title: 'List Skills',
    description: 'Show all available AI skills and which ones are active',
    args: ['skills', 'list'],
  },
  {
    id: 'skills-info',
    category: 'skills',
    icon: 'ℹ️',
    title: 'Skill Info',
    description: 'Show details and requirements for a specific skill',
    args: ['skills', 'info'],
    params: [
      { paramId: 'name', flag: '', label: 'Skill Name', type: 'text', placeholder: 'e.g. web-search', required: true },
    ],
  },
  {
    id: 'skills-check',
    category: 'skills',
    icon: '✅',
    title: 'Check Skills',
    description: 'Summary of ready vs missing skill requirements',
    args: ['skills', 'check'],
  },
  {
    id: 'plugins-list',
    category: 'skills',
    icon: '🔌',
    title: 'List Plugins',
    description: 'Show all installed plugins and their enabled/disabled state',
    args: ['plugins', 'list'],
  },
  {
    id: 'plugins-info',
    category: 'skills',
    icon: 'ℹ️',
    title: 'Plugin Info',
    description: 'Show details for a specific installed plugin',
    args: ['plugins', 'info'],
    params: [
      { paramId: 'id', flag: '', label: 'Plugin ID', type: 'text', placeholder: 'e.g. @openclaw/memory', required: true },
    ],
  },
  {
    id: 'plugins-install',
    category: 'skills',
    icon: '📥',
    title: 'Install Plugin',
    description: 'Install a new plugin or skill by name',
    args: ['plugins', 'install'],
    params: [
      { paramId: 'spec', flag: '', label: 'Plugin Spec', type: 'text', placeholder: 'e.g. @openclaw/memory or /path/to/plugin', required: true },
    ],
  },
  {
    id: 'plugins-enable',
    category: 'skills',
    icon: '✅',
    title: 'Enable Plugin',
    description: 'Enable a previously disabled plugin',
    args: ['plugins', 'enable'],
    params: [
      { paramId: 'id', flag: '', label: 'Plugin ID', type: 'text', placeholder: 'e.g. @openclaw/memory', required: true },
    ],
  },
  {
    id: 'plugins-disable',
    category: 'skills',
    icon: '🚫',
    title: 'Disable Plugin',
    description: 'Disable a plugin without uninstalling it',
    args: ['plugins', 'disable'],
    params: [
      { paramId: 'id', flag: '', label: 'Plugin ID', type: 'text', placeholder: 'e.g. @openclaw/memory', required: true },
    ],
  },
  {
    id: 'plugins-uninstall',
    category: 'skills',
    icon: '🗑️',
    title: 'Uninstall Plugin',
    description: 'Remove an installed plugin completely',
    args: ['plugins', 'uninstall'],
    params: [
      { paramId: 'id', flag: '', label: 'Plugin ID', type: 'text', placeholder: 'e.g. @openclaw/memory', required: true },
    ],
    danger: true,
    dangerMessage: 'This will remove the plugin and its configuration.',
  },
  {
    id: 'plugins-update',
    category: 'skills',
    icon: '⬆️',
    title: 'Update Plugin',
    description: 'Update an installed plugin to the latest version',
    args: ['plugins', 'update'],
    params: [
      { paramId: 'id', flag: '', label: 'Plugin ID (or leave empty for --all)', type: 'text', placeholder: 'e.g. @openclaw/memory', required: false },
    ],
  },
  {
    id: 'plugins-doctor',
    category: 'skills',
    icon: '🩹',
    title: 'Diagnose Plugins',
    description: 'Run diagnostics on installed plugins to find and fix configuration issues',
    args: ['plugins', 'doctor'],
  },

  // ── Agents ────────────────────────────────────────────────────────────────
  {
    id: 'agents-list',
    category: 'agents',
    icon: '🤖',
    title: 'List Agents',
    description: 'Show all configured AI agents and their settings',
    args: ['agents', 'list'],
  },
  {
    id: 'agents-add',
    category: 'agents',
    icon: '➕',
    title: 'Add Agent',
    description: 'Create a new named AI agent with a specific role',
    args: ['agents', 'add'],
    params: [
      { paramId: 'name', flag: '', label: 'Agent Name', type: 'text', placeholder: 'e.g. researcher', required: true },
    ],
  },
  {
    id: 'agents-delete',
    category: 'agents',
    icon: '🗑️',
    title: 'Delete Agent',
    description: 'Remove a configured agent permanently',
    args: ['agents', 'delete'],
    params: [
      { paramId: 'id', flag: '', label: 'Agent ID', type: 'text', placeholder: 'Agent ID to delete', required: true },
    ],
    danger: true,
    dangerMessage: 'This will permanently delete the agent and its configuration.',
  },
  {
    id: 'pairing-list',
    category: 'agents',
    icon: '🔗',
    title: 'Pairing Requests',
    description: 'View pending device and node pairing requests waiting for approval',
    args: ['pairing', 'list'],
  },
  {
    id: 'pairing-approve',
    category: 'agents',
    icon: '✔️',
    title: 'Approve Pairing',
    description: 'Approve a pending device pairing request by ID',
    args: ['pairing', 'approve'],
    params: [
      { paramId: 'id', flag: '--id', label: 'Request ID', type: 'text', placeholder: 'Pairing request ID', required: true },
    ],
  },
  {
    id: 'approvals-get',
    category: 'agents',
    icon: '🛡️',
    title: 'Show Tool Approvals',
    description: 'View current tool execution approval settings and allowlist',
    args: ['approvals', 'get'],
  },
  {
    id: 'approvals-set',
    category: 'agents',
    icon: '⚙️',
    title: 'Configure Approvals',
    description: 'Set tool execution approval requirements and allowlist rules',
    args: ['approvals', 'set'],
  },

  // ── Schedule ──────────────────────────────────────────────────────────────
  {
    id: 'cron-list',
    category: 'schedule',
    icon: '📅',
    title: 'List Cron Jobs',
    description: 'Show all scheduled automation jobs and their next run times',
    args: ['cron', 'list'],
  },
  {
    id: 'cron-status',
    category: 'schedule',
    icon: '⏱️',
    title: 'Scheduler Status',
    description: 'Show whether the cron scheduler is running and healthy',
    args: ['cron', 'status'],
  },
  {
    id: 'cron-runs',
    category: 'schedule',
    icon: '📊',
    title: 'Job Run History',
    description: 'View the execution history and results of past cron job runs',
    args: ['cron', 'runs'],
  },
  {
    id: 'cron-add',
    category: 'schedule',
    icon: '➕',
    title: 'Add Cron Job',
    description: 'Create a new scheduled automation job (interactive)',
    args: ['cron', 'add'],
  },
  {
    id: 'cron-edit',
    category: 'schedule',
    icon: '✏️',
    title: 'Edit Cron Job',
    description: 'Modify an existing scheduled job configuration',
    args: ['cron', 'edit'],
    params: [
      { paramId: 'id', flag: '', label: 'Job ID', type: 'text', placeholder: 'Cron job ID', required: true },
    ],
  },
  {
    id: 'cron-run',
    category: 'schedule',
    icon: '▶️',
    title: 'Run Job Now',
    description: 'Manually trigger a scheduled cron job immediately',
    args: ['cron', 'run'],
    params: [
      { paramId: 'id', flag: '', label: 'Job ID', type: 'text', placeholder: 'Cron job ID', required: true },
    ],
  },
  {
    id: 'cron-enable',
    category: 'schedule',
    icon: '✅',
    title: 'Enable Cron Job',
    description: 'Re-enable a previously disabled scheduled job',
    args: ['cron', 'enable'],
    params: [
      { paramId: 'id', flag: '', label: 'Job ID', type: 'text', placeholder: 'Cron job ID', required: true },
    ],
  },
  {
    id: 'cron-disable',
    category: 'schedule',
    icon: '⏸️',
    title: 'Disable Cron Job',
    description: 'Pause a scheduled job without deleting it',
    args: ['cron', 'disable'],
    params: [
      { paramId: 'id', flag: '', label: 'Job ID', type: 'text', placeholder: 'Cron job ID', required: true },
    ],
  },
  {
    id: 'cron-rm',
    category: 'schedule',
    icon: '🗑️',
    title: 'Delete Cron Job',
    description: 'Permanently remove a scheduled job',
    args: ['cron', 'rm'],
    params: [
      { paramId: 'id', flag: '', label: 'Job ID', type: 'text', placeholder: 'Cron job ID', required: true },
    ],
    danger: true,
    dangerMessage: 'This will permanently delete the scheduled job.',
  },

  // ── Models ────────────────────────────────────────────────────────────────
  {
    id: 'models-list',
    category: 'models',
    icon: '🧠',
    title: 'List Models',
    description: 'Show all available AI models and their configuration',
    args: ['models', 'list'],
  },
  {
    id: 'models-status',
    category: 'models',
    icon: '📊',
    title: 'Models Status',
    description: 'Check connectivity and availability of all configured AI models',
    args: ['models', 'status'],
  },
  {
    id: 'models-scan',
    category: 'models',
    icon: '🔍',
    title: 'Scan for Models',
    description: 'Scan OpenRouter free model catalog and update available models',
    args: ['models', 'scan'],
  },
  {
    id: 'models-set',
    category: 'models',
    icon: '🎯',
    title: 'Set Default Model',
    description: 'Change the default AI model used for agent conversations',
    args: ['models', 'set'],
    params: [
      { paramId: 'model', flag: '', label: 'Model ID', type: 'text', placeholder: 'e.g. claude-opus-4-6', required: true },
    ],
  },
  {
    id: 'models-aliases-list',
    category: 'models',
    icon: '🏷️',
    title: 'List Model Aliases',
    description: 'Show all configured model aliases and what they resolve to',
    args: ['models', 'aliases', 'list'],
  },
  {
    id: 'models-auth-add',
    category: 'models',
    icon: '🔑',
    title: 'Add Model Auth',
    description: 'Register a new authentication profile for a model provider (interactive)',
    args: ['models', 'auth', 'add'],
  },

  // ── Sessions ──────────────────────────────────────────────────────────────
  {
    id: 'sessions-list',
    category: 'sessions',
    icon: '💬',
    title: 'List Sessions',
    description: 'Show all active and recent conversation sessions across channels',
    args: ['sessions'],
  },
  {
    id: 'sessions-cleanup',
    category: 'sessions',
    icon: '🧹',
    title: 'Cleanup Sessions',
    description: 'Prune old sessions and transcripts to reclaim disk space',
    args: ['sessions', 'cleanup'],
  },
  {
    id: 'status',
    category: 'sessions',
    icon: '📶',
    title: 'Show Status',
    description: 'Display current linked session health and connection summary',
    args: ['status'],
  },

  // ── Memory ────────────────────────────────────────────────────────────────
  {
    id: 'memory-status',
    category: 'memory',
    icon: '💾',
    title: 'Memory Status',
    description: 'Show the state of the vector memory index',
    args: ['memory', 'status'],
  },
  {
    id: 'memory-index',
    category: 'memory',
    icon: '📑',
    title: 'Re-index Memory',
    description: 'Rebuild the vector search index from your memory files',
    args: ['memory', 'index'],
  },
  {
    id: 'memory-search',
    category: 'memory',
    icon: '🔍',
    title: 'Search Memory',
    description: 'Perform a semantic search across your memory files',
    args: ['memory', 'search'],
    params: [
      { paramId: 'query', flag: '', label: 'Search Query', type: 'text', placeholder: 'What are you looking for?', required: true },
    ],
  },

  // ── Hooks ─────────────────────────────────────────────────────────────────
  {
    id: 'hooks-list',
    category: 'hooks',
    icon: '🪝',
    title: 'List Hooks',
    description: 'Show all configured automation hooks and their enabled state',
    args: ['hooks', 'list'],
  },
  {
    id: 'hooks-info',
    category: 'hooks',
    icon: 'ℹ️',
    title: 'Hook Info',
    description: 'Show details and requirements for a specific hook',
    args: ['hooks', 'info'],
    params: [
      { paramId: 'name', flag: '', label: 'Hook Name', type: 'text', placeholder: 'e.g. session-memory', required: true },
    ],
  },
  {
    id: 'hooks-check',
    category: 'hooks',
    icon: '✅',
    title: 'Check Hooks',
    description: 'Summary of hook eligibility — how many are ready vs missing requirements',
    args: ['hooks', 'check'],
  },
  {
    id: 'hooks-enable',
    category: 'hooks',
    icon: '✅',
    title: 'Enable Hook',
    description: 'Re-enable a previously disabled automation hook',
    args: ['hooks', 'enable'],
    params: [
      { paramId: 'name', flag: '', label: 'Hook Name', type: 'text', placeholder: 'Hook name', required: true },
    ],
  },
  {
    id: 'hooks-disable',
    category: 'hooks',
    icon: '🚫',
    title: 'Disable Hook',
    description: 'Disable an automation hook without deleting it',
    args: ['hooks', 'disable'],
    params: [
      { paramId: 'name', flag: '', label: 'Hook Name', type: 'text', placeholder: 'Hook name', required: true },
    ],
  },
  {
    id: 'hooks-install',
    category: 'hooks',
    icon: '📥',
    title: 'Install Hook',
    description: 'Install a new automation hook from the registry',
    args: ['hooks', 'install'],
    params: [
      { paramId: 'spec', flag: '', label: 'Hook Spec', type: 'text', placeholder: 'Hook name or path', required: true },
    ],
  },
  {
    id: 'hooks-update',
    category: 'hooks',
    icon: '⬆️',
    title: 'Update Hooks',
    description: 'Update installed hook packs to the latest version',
    args: ['hooks', 'update'],
    params: [
      { paramId: 'id', flag: '', label: 'Hook ID (or leave empty for --all)', type: 'text', placeholder: 'e.g. session-memory', required: false },
    ],
  },

  // ── Browser ───────────────────────────────────────────────────────────────
  {
    id: 'browser-status',
    category: 'browser',
    icon: '🌍',
    title: 'Browser Status',
    description: 'Check whether the controlled browser instance is running',
    args: ['browser', 'status'],
  },
  {
    id: 'browser-tabs',
    category: 'browser',
    icon: '📑',
    title: 'Browser Tabs',
    description: 'List all open tabs in the controlled browser',
    args: ['browser', 'tabs'],
  },
  {
    id: 'browser-start',
    category: 'browser',
    icon: '▶️',
    title: 'Start Browser',
    description: 'Launch the controlled Chrome/Brave browser instance',
    args: ['browser', 'start'],
  },
  {
    id: 'browser-stop',
    category: 'browser',
    icon: '⏹️',
    title: 'Stop Browser',
    description: 'Close the controlled browser instance',
    args: ['browser', 'stop'],
  },
  {
    id: 'browser-open',
    category: 'browser',
    icon: '🔗',
    title: 'Open URL',
    description: 'Navigate the controlled browser to a URL in a new tab',
    args: ['browser', 'open'],
    params: [
      { paramId: 'url', flag: '', label: 'URL', type: 'text', placeholder: 'https://example.com', required: true },
    ],
  },
  {
    id: 'browser-screenshot',
    category: 'browser',
    icon: '📸',
    title: 'Take Screenshot',
    description: 'Capture a screenshot of the current browser page',
    args: ['browser', 'screenshot'],
  },
  {
    id: 'browser-reset-profile',
    category: 'browser',
    icon: '🔁',
    title: 'Reset Browser Profile',
    description: 'Clear browser cookies, cache, and profile data',
    args: ['browser', 'reset-profile'],
    danger: true,
    dangerMessage: 'This will clear all browser cookies and saved login sessions.',
  },
]
