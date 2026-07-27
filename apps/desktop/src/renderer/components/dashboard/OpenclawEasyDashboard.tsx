import React, { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivitySection,
  AddNewChannelSection,
  AgentManager,
  AgentRoutingSection,
  AIProviderSection,
  ChatSection,
  DoctorSection,
  ModelsSection,
  SkillsSection,
  HooksSection,
  PluginsSection,
  CronSection,
  ToolsSection,
  AccessControlSection,
  BrowserSection,
  MemorySection,
  WhatsAppSection,
  TelegramSection,
  DiscordSection,
  SlackSection,
  FeishuSection,
  LineSection,
  QuickActionsSection,
  SessionsSection,
  CommandsSection,
  WorkspaceSection,
} from "./sections";
import { CliOnboardingWizard } from "../wizard/CliOnboardingWizard";
import {
  Activity,
  Bot,
  Brain,
  Clock,
  Database,
  ExternalLink,
  FolderOpen,
  Globe,
  Shield,
  Hash,
  Loader2,
  MessageSquare,
  Package,
  Play,
  Plus,
  Power,
  RefreshCw,
  Rocket,
  Send,
  Settings,
  Stethoscope,
  Users,
  Wrench,
  List,
  Puzzle,
  Terminal,
  Zap,
} from "lucide-react";
import { CommandPalette, type PaletteAction } from "../CommandPalette";
import { useAppBridge } from "../../hooks/useAppBridge";
import { useModelManager } from "../../hooks/useModelManager";
import { useChannelManager } from "../../hooks/useChannelManager";
import OllamaInstallPopup from "../OllamaInstallPopup";
import { ServerBar } from "./ServerBar";
import { ChannelSidebar } from "./ChannelSidebar";
import { ChannelSetupModals } from "./ChannelSetupModals";
import { SettingsContent } from "./SettingsContent";
import { UpdateBanner } from "./UpdateBanner";
import { useAppUpdater } from "../../hooks/useAppUpdater";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { useToast } from "../../contexts/ToastContext";
import { DEFAULT_GATEWAY_PORT } from "../../../shared/constants";
import { Sidebar as GlassSidebar } from "./glass/Sidebar";
import { glassColorsLight, glassColorsDark } from "./glass/glassColors";
import { useThemeStore } from "../../stores/themeStore";

export type DashboardUiMode = 'classic' | 'glass';

export function OpenclawEasyDashboard({ uiMode = 'classic' }: { uiMode?: DashboardUiMode } = {}) {
  const { t } = useTranslation();
  // Custom hooks
  const { status, logs, startOpenClaw, stopOpenClaw, isAutoRestarting } = useAppBridge();
  const { ollamaInstallState, installOllama } = useModelManager();
  const {
    channels: channelStates,
    connectionError,
    activeSetup,
    qrCode,
    qrLoadingTimedOut,
    isCheckingStatus,
    isConnecting,
    isDisconnecting,
    startWhatsAppSetup,
    startTelegramSetup,
    startDiscordSetup,
    startSlackSetup,
    startFeishuSetup,
    startLineSetup,
    startWeixinSetup,
    connectTelegramBot,
    connectDiscordBot,
    connectSlackBot,
    connectFeishuBot,
    connectLineBot,
    disconnectWhatsApp,
    disconnectTelegram,
    disconnectDiscord,
    disconnectSlack,
    disconnectFeishu,
    disconnectLine,
    disconnectWeixin,
    cancelSetup,
  } = useChannelManager();
  const { addToast } = useToast();
  // Show channel connection errors as toasts
  useEffect(() => {
    if (connectionError) {
      addToast(connectionError, 'error');
    }
  }, [connectionError, addToast]);

  // Local component state (only orchestration state)
  const [activeChannel, setActiveChannel] = useState<string>("quick-actions");

  // Listen for gateway restart suggestions after channel connect/disconnect
  useEffect(() => {
    if (!window.electronAPI?.onGatewayRestartSuggested) return;
    const cleanup = window.electronAPI.onGatewayRestartSuggested(() => {
      addToast(
        t('toast.restartAssistant', 'Restart the assistant to apply channel changes.'),
        'info',
        15000,
        {
          label: t('toast.goToHome', 'Go to Home'),
          onClick: () => setActiveChannel('quick-actions'),
        }
      );
    });
    return cleanup;
  }, [addToast, t, setActiveChannel]);

  // Background gateway-restart progress pill — fires after a provider
  // switch or agent model change instead of blocking the modal.
  // Lives at the dashboard level so it's visible regardless of which
  // tab the user navigates to during the restart.
  const [restartStatus, setRestartStatus] = useState<{ status: 'queued' | 'restarting' | 'ready' | 'failed'; reason: string } | null>(null);
  useEffect(() => {
    if (!window.electronAPI?.onGatewayRestartStatus) return;
    const cleanup = window.electronAPI.onGatewayRestartStatus((event) => {
      setRestartStatus(event);
      if (event.status === 'ready' || event.status === 'failed') {
        // Clear the pill after a beat so the result is visible.
        setTimeout(() => setRestartStatus(null), 2500);
      }
    });
    return cleanup;
  }, []);
  const [selectedServer, setSelectedServer] = useState<string>("home");
  const [telegramToken, setTelegramToken] = useState("");
  const [discordToken, setDiscordToken] = useState("");
  const [discordServerId, setDiscordServerId] = useState("");
  const [slackBotToken, setSlackBotToken] = useState("");
  const [slackAppToken, setSlackAppToken] = useState("");
  const [feishuAppId, setFeishuAppId] = useState("");
  const [feishuAppSecret, setFeishuAppSecret] = useState("");
  const [feishuBotName, setFeishuBotName] = useState("");
  const [lineChannelAccessToken, setLineChannelAccessToken] = useState("");
  const [lineChannelSecret, setLineChannelSecret] = useState("");
  const [ollamaPopupOpen, setOllamaPopupOpen] = useState(false);
  const [gatewayPort, setGatewayPort] = useState<number>(DEFAULT_GATEWAY_PORT);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [glassSidebarCollapsed, setGlassSidebarCollapsed] = useState(false);
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const updater = useAppUpdater();

  // Global Cmd+K / Ctrl+K binding to toggle the command palette. Captured
  // at window level so it works from any focused element. We only swallow
  // the event when modifier+K is the exact combo — bare K stays free for
  // text inputs, and other K-shortcuts (Cmd+Shift+K, Cmd+Alt+K) are not
  // intercepted.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isPaletteKey = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k';
      if (isPaletteKey) {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Load gateway port from Electron on mount and when status changes
  React.useEffect(() => {
    const loadGatewayPort = async () => {
      try {
        const gatewayInfo = await window.electronAPI?.getGatewayInfo?.();
        const port = gatewayInfo?.port || DEFAULT_GATEWAY_PORT;
        // Only log when port changes to reduce noise
        if (port !== gatewayPort) {
          console.log(`[OpenclawEasyDashboard] Gateway port changed: ${port}`);
        }
        setGatewayPort(port);
      } catch (error) {
        console.error("[OpenclawEasyDashboard] Failed to get gateway port:", error);
      }
    };
    loadGatewayPort();
    // Refresh gateway port when status changes
    const interval = setInterval(loadGatewayPort, 5000);
    return () => clearInterval(interval);
  }, [status]);


  // Openclaw color scheme.
  // tertiary is intentionally soft (~4 RGB units darker than primary
  // rather than the 8+ units of a true near-black). It's used as both
  // the outer frame fill (title bar, server bar) and as inset/border
  // accents — keeping them on the same value gives the app a calmer,
  // more uniform feel without losing visual hierarchy.
  const classicColors = {
    bg: {
      primary: "#1e2128",
      secondary: "#252830",
      tertiary: "#1a1d23",
      hover: "#2a2d36",
      active: "#2d3040",
    },
    text: {
      normal: "#dcddde",
      muted: "#96989d",
      header: "#ffffff",
      link: "#60a5fa",
      danger: "#ed4245",
    },
    accent: {
      brand: "#D4581F",
      green: "#3ba55d",
      yellow: "#faa81a",
      red: "#ed4245",
      purple: "#9a59f2",
      indigo: "#6366f1",
      blue: "#3b82f6",
    },
    // Classic (Discord-style) theme keeps its terracotta as the primary
    // CTA so the look stays cohesive in this mode — only the glass theme
    // tracks openclaw.ai coral. ColorTheme requires this field.
    button: {
      primary: "#D4581F",
      primaryFg: "#ffffff",
      destructive: "#ed4245",
      destructiveFg: "#ffffff",
    },
  };

  // Glass mode pulls its palette from the warm/terracotta tokens so
  // every existing section that consumes `colors` automatically picks
  // up the new look. Resolves against the active theme (light/dark).
  const resolvedTheme = useThemeStore((s) => s.resolved);
  const colors = uiMode === 'glass'
    ? (resolvedTheme === 'dark' ? glassColorsDark : glassColorsLight)
    : classicColors;

  const servers = [
    { id: "main", name: t('nav.agent'), icon: <Bot className="h-6 w-6" />, color: "#c2410c" },
    { id: "channels", name: t('nav.channels'), icon: <MessageSquare className="h-6 w-6" />, color: "#16a34a" },
    { id: "aiconfig", name: t('nav.aiConfig'), icon: <Brain className="h-6 w-6" />, color: "#2563eb" },
  ];

  // Dynamic channels based on connection status
  const getConnectedChannels = () => {
    const connectedChannels = [];

    // Add WhatsApp if connected
    if (channelStates.whatsapp?.status === 'connected') {
      connectedChannels.push({
        id: "whatsapp",
        name: "whatsapp",
        type: "text",
        icon: MessageSquare,
        status: "connected",
      });
    }

    // Add Telegram if connected
    if (channelStates.telegram?.status === 'connected') {
      connectedChannels.push({
        id: "telegram",
        name: "telegram",
        type: "text",
        icon: Send,
        status: "connected",
      });
    }

    // Add Discord if connected
    if (channelStates.discord?.status === 'connected') {
      connectedChannels.push({
        id: "discord-channel",
        name: "discord",
        type: "text",
        icon: Users,
        status: "connected",
      });
    }

    // Add Slack if connected
    if (channelStates.slack?.status === 'connected') {
      connectedChannels.push({
        id: "slack-channel",
        name: "slack",
        type: "text",
        icon: MessageSquare,
        status: "connected",
      });
    }

    // Add Feishu if connected
    if (channelStates.feishu?.status === 'connected') {
      connectedChannels.push({
        id: "feishu-channel",
        name: "feishu",
        type: "text",
        icon: MessageSquare,
        status: "connected",
      });
    }

    // Add LINE if connected
    if (channelStates.line?.status === 'connected') {
      connectedChannels.push({
        id: "line-channel",
        name: "line",
        type: "text",
        icon: MessageSquare,
        status: "connected",
      });
    }

    // Access control applies across all connected channels.
    connectedChannels.push({ id: "access", name: t('nav.access', 'Access Control'), type: "text", icon: Shield });

    // Always show manage-channel option
    connectedChannels.push({ id: "setup", name: t('nav.manageChannel'), type: "text", icon: Plus });

    return connectedChannels;
  };

  const channels = {
    home: [
      { id: "quick-actions", name: t('nav.quickActions'), type: "text", icon: Rocket },
      { id: "sessions",      name: t('nav.sessions'),     type: "text", icon: List },
      { id: "activity",      name: t('nav.activityLog'),  type: "text", icon: Activity },
    ],
    main: [
      { id: "chat",      name: t('nav.chat'),        type: "text", icon: MessageSquare, category: t('nav.categoryChat') },
      { id: "cron",      name: t('nav.cronJobs'),    type: "text", icon: Clock,         category: t('nav.categorySystem') },
      { id: "onboard",   name: t('nav.onboard'),     type: "text", icon: Rocket,        category: t('nav.categorySystem') },
      { id: "doctor",    name: t('nav.doctor'),      type: "text", icon: Stethoscope,   category: t('nav.categorySystem') },
      { id: "commands",  name: t('nav.commands'),    type: "text", icon: Terminal,       category: t('nav.categorySystem') },
      { id: "tools",     name: t('nav.permissions'), type: "text", icon: Wrench,        category: t('nav.categoryManage') },
    ],
    channels: getConnectedChannels(),
    aiconfig: [
      { id: "aiconfig", name: t('nav.aiProvider'),   type: "text", icon: Settings },
      { id: "agents",   name: t('nav.agents'),       type: "text", icon: Bot },
      { id: "workspace", name: t('nav.workspace'),   type: "text", icon: FolderOpen },
      { id: "skills",   name: t('nav.skills'),       type: "text", icon: Package },
      { id: "hooks",    name: t('nav.hooks'),        type: "text", icon: Zap },
      { id: "plugins",  name: t('nav.plugins'),      type: "text", icon: Puzzle },
      { id: "browser",  name: t('nav.browser', 'Browser'), type: "text", icon: Globe },
      { id: "memory",   name: t('nav.memory', 'Memory'),   type: "text", icon: Database },
      { id: "models",   name: t('nav.localModels'),  type: "text", icon: Package },
    ],
  };

  // Cmd+K palette action catalog. Built from the same channel registry so
  // it stays in sync — every nav item users can reach by clicking is also
  // reachable by typing. Gateway control + a couple deep-link shortcuts
  // round it out. Memoized to keep cmdk from re-filtering on every render.
  const paletteActions: PaletteAction[] = useMemo(() => {
    const iconCls = 'h-4 w-4';
    const list: PaletteAction[] = [
      // Navigate — Home
      { kind: 'navigate', id: 'nav-quick-actions', group: 'Navigate', server: 'home', channel: 'quick-actions', title: t('nav.quickActions'), icon: <Rocket className={iconCls} />, keywords: 'home start dashboard' },
      { kind: 'navigate', id: 'nav-sessions',      group: 'Navigate', server: 'home', channel: 'sessions',      title: t('nav.sessions'),     icon: <List className={iconCls} />,    keywords: 'history conversations' },
      { kind: 'navigate', id: 'nav-activity',      group: 'Navigate', server: 'home', channel: 'activity',      title: t('nav.activityLog'),  icon: <Activity className={iconCls} />, keywords: 'log events stream' },
      // Navigate — Agent
      { kind: 'navigate', id: 'nav-chat',          group: 'Navigate', server: 'main', channel: 'chat',          title: t('nav.chat'),         icon: <MessageSquare className={iconCls} />, keywords: 'talk message ask' },
      { kind: 'navigate', id: 'nav-cron',          group: 'Navigate', server: 'main', channel: 'cron',          title: t('nav.cronJobs'),     icon: <Clock className={iconCls} />,    keywords: 'schedule task automation reminder' },
      { kind: 'navigate', id: 'nav-onboard',       group: 'Navigate', server: 'main', channel: 'onboard',       title: t('nav.onboard'),      icon: <Rocket className={iconCls} />,   keywords: 'setup wizard getting started' },
      { kind: 'navigate', id: 'nav-doctor',        group: 'Navigate', server: 'main', channel: 'doctor',        title: t('nav.doctor'),       icon: <Stethoscope className={iconCls} />, keywords: 'health diagnose fix repair' },
      { kind: 'navigate', id: 'nav-commands',      group: 'Navigate', server: 'main', channel: 'commands',      title: t('nav.commands'),     icon: <Terminal className={iconCls} />, keywords: 'cli terminal run' },
      { kind: 'navigate', id: 'nav-permissions',   group: 'Navigate', server: 'main', channel: 'tools',         title: t('nav.permissions'),  icon: <Wrench className={iconCls} />,   keywords: 'security tools allow' },
      // Navigate — AI / Config
      { kind: 'navigate', id: 'nav-ai-provider',   group: 'AI & Config', server: 'aiconfig', channel: 'aiconfig',  title: t('nav.aiProvider'),   icon: <Settings className={iconCls} />,  keywords: 'model openai anthropic byok claude' },
      { kind: 'navigate', id: 'nav-agents',        group: 'AI & Config', server: 'aiconfig', channel: 'agents',    title: t('nav.agents'),       icon: <Bot className={iconCls} />,       keywords: 'agent persona system prompt' },
      { kind: 'navigate', id: 'nav-workspace',     group: 'AI & Config', server: 'aiconfig', channel: 'workspace', title: t('nav.workspace'),    icon: <FolderOpen className={iconCls} />, keywords: 'files folder' },
      { kind: 'navigate', id: 'nav-skills',        group: 'AI & Config', server: 'aiconfig', channel: 'skills',    title: t('nav.skills'),       icon: <Package className={iconCls} />,    keywords: 'plugins extensions' },
      { kind: 'navigate', id: 'nav-hooks',         group: 'AI & Config', server: 'aiconfig', channel: 'hooks',     title: t('nav.hooks'),        icon: <Zap className={iconCls} />,        keywords: 'lifecycle automation' },
      { kind: 'navigate', id: 'nav-plugins',       group: 'AI & Config', server: 'aiconfig', channel: 'plugins',   title: t('nav.plugins'),      icon: <Puzzle className={iconCls} />,     keywords: 'extensions install' },
      { kind: 'navigate', id: 'nav-models',        group: 'AI & Config', server: 'aiconfig', channel: 'models',    title: t('nav.localModels'),  icon: <Package className={iconCls} />,    keywords: 'ollama local lm-studio' },
      { kind: 'navigate', id: 'nav-access',        group: 'AI & Config', server: 'channels', channel: 'access',    title: t('nav.access', 'Access Control'), icon: <Shield className={iconCls} />, keywords: 'security allowlist pairing dm group who can message' },
      { kind: 'navigate', id: 'nav-browser',       group: 'AI & Config', server: 'aiconfig', channel: 'browser',   title: t('nav.browser', 'Browser'),       icon: <Globe className={iconCls} />,  keywords: 'web automation chrome screenshot browse' },
      { kind: 'navigate', id: 'nav-memory',        group: 'AI & Config', server: 'aiconfig', channel: 'memory',    title: t('nav.memory', 'Memory'),         icon: <Database className={iconCls} />, keywords: 'remember context forget knowledge' },
      // Navigate — Channels
      { kind: 'navigate', id: 'nav-add-channel',   group: 'Channels', server: 'channels', channel: 'setup',         title: t('nav.manageChannel'), icon: <Plus className={iconCls} />,    keywords: 'add connect telegram whatsapp discord slack feishu line' },
      // App
      { kind: 'navigate', id: 'nav-settings',      group: 'App', server: 'main', channel: 'settings', title: t('nav.appSettings'),  icon: <Settings className={iconCls} />,  keywords: 'preferences configuration account' },
      // Gateway runtime control
      ...(status.isRunning
        ? [
            { kind: 'run' as const, id: 'gateway-stop',    group: 'Gateway', title: 'Stop assistant',    icon: <Power className={iconCls} />,   keywords: 'kill shutdown gateway',  perform: stopOpenClaw,  danger: true },
            { kind: 'run' as const, id: 'gateway-restart', group: 'Gateway', title: 'Restart assistant', icon: <RefreshCw className={iconCls} />, keywords: 'reload reboot gateway', perform: async () => { await stopOpenClaw(); await new Promise(r => setTimeout(r, 600)); await startOpenClaw(); } },
          ]
        : [
            { kind: 'run' as const, id: 'gateway-start', group: 'Gateway', title: 'Launch assistant', icon: <Play className={iconCls} />, keywords: 'start run gateway online', perform: startOpenClaw },
          ]),
      { kind: 'run', id: 'gateway-web-ui', group: 'Gateway', title: 'Open Web UI', icon: <Globe className={iconCls} />, keywords: 'browser localhost', perform: () => window.electronAPI?.openExternal?.(`http://127.0.0.1:${gatewayPort}`) },
      // Help
      { kind: 'run', id: 'help-docs', group: 'Help', title: 'Open documentation', icon: <ExternalLink className={iconCls} />, keywords: 'docs guide manual readme', perform: () => window.electronAPI?.openExternal?.('https://openclaw-easy.com') },
    ];
    return list;
  }, [t, status.isRunning, startOpenClaw, stopOpenClaw, gatewayPort]);

  const handlePaletteNavigate = (server: string, channel: string) => {
    setSelectedServer(server);
    setActiveChannel(channel);
  };

  return (
    <ThemeProvider colors={colors}>
    <CommandPalette
      open={paletteOpen}
      onOpenChange={setPaletteOpen}
      actions={paletteActions}
      colors={colors}
      onNavigate={handlePaletteNavigate}
    />
    <div
      className="h-screen flex flex-col"
      style={
        uiMode === 'glass'
          // The body frame (the `m-3` strip around the glass card) is the
          // window's "titlebar surrogate" — flagged as drag so the user
          // can grab the window from any edge. Interactive elements
          // inside the card opt back into `no-drag` below.
          ? ({ WebkitAppRegion: 'drag' } as React.CSSProperties)
          : { backgroundColor: colors.bg.primary }
      }
    >
      {/* Title Bar - Draggable Area. Hidden in glass mode (the new
          Sidebar reserves space for native macOS traffic lights and
          provides a drag region itself). */}
      {uiMode !== 'glass' && (
      <div
        className={`h-12 flex items-center justify-between ${
          isMac ? "pl-20" : "px-3"
        }`}
        style={
          {
            backgroundColor: colors.bg.tertiary,
            WebkitAppRegion: "drag",
          } as any
        }
      >
        <div className="flex items-center space-x-2">
          {!isMac && (
            <>
              <div className="w-3 h-3 bg-indigo-600 rounded" />
              <span
                className="text-xs font-medium"
                style={{ color: colors.text.muted }}
              >
                OpenClaw
              </span>
            </>
          )}
        </div>
        {!isMac && (
          <div
            className="flex items-center"
            style={{ WebkitAppRegion: "no-drag" } as any}
          >
            <button
              onClick={() => window.electronAPI?.windowMinimize?.()}
              className="w-11 h-8 flex items-center justify-center hover:bg-gray-600 transition-colors"
              title={t('common.minimize')}
            >
              <span className="text-xs" style={{ color: colors.text.muted }}>&#x2500;</span>
            </button>
            <button
              onClick={() => window.electronAPI?.windowMaximize?.()}
              className="w-11 h-8 flex items-center justify-center hover:bg-gray-600 transition-colors"
              title={t('common.maximize')}
            >
              <span className="text-xs" style={{ color: colors.text.muted }}>&#x25A1;</span>
            </button>
            <button
              onClick={() => window.electronAPI?.windowClose?.()}
              className="w-11 h-8 flex items-center justify-center hover:bg-red-600 transition-colors"
              title={t('common.close')}
            >
              <span className="text-xs" style={{ color: colors.text.muted }}>&#x2715;</span>
            </button>
          </div>
        )}
      </div>
      )}

      {/* Update notification banner */}
      {updater.hasUpdate && updater.updateInfo && (
        <UpdateBanner
          latestVersion={updater.updateInfo.latestVersion}
          releaseDate={updater.updateInfo.releaseDate}
          onDownload={updater.downloadUpdate}
          onDismiss={updater.dismissUpdate}
          colors={colors}
        />
      )}

      {/* Main Layout. Glass mode wraps the Sidebar + content area in a
          single shared glass-card so they read as one unified surface
          (with a subtle divider between), rather than two floating
          panels with a gap. Classic mode keeps the original Discord-
          style two-column chrome. */}
      <div
        className={uiMode === 'glass' ? "flex-1 flex overflow-hidden glass-card glass-sheen rounded-none" : "flex-1 flex overflow-hidden"}
        // The card and everything inside it is interactive — opt back
        // out of the parent's drag region so clicks work normally.
        // The brand row + channel header re-enable drag below for the
        // window's titlebar-surrogate areas.
        style={uiMode === 'glass' ? ({ WebkitAppRegion: 'no-drag' } as React.CSSProperties) : undefined}
      >
        {uiMode === 'glass' ? (
          <GlassSidebar
            collapsed={glassSidebarCollapsed}
            onToggleCollapsed={() => setGlassSidebarCollapsed((v) => !v)}
            activeChannel={activeChannel}
            onSelect={(id, legacyServer) => {
              if (legacyServer) setSelectedServer(legacyServer);
              setActiveChannel(id);
            }}
            connectedChannels={new Set(
              Object.entries(channelStates)
                .filter(([, state]) => state?.status === 'connected')
                .map(([id]) => id)
            )}
          />
        ) : (
          <>
            {/* Discord-style Server Bar */}
            <ServerBar
              colors={colors}
              servers={servers}
              selectedServer={selectedServer}
              activeChannel={activeChannel}
              setSelectedServer={setSelectedServer}
              setActiveChannel={setActiveChannel}
              isMac={isMac}
            />

            {/* Channel Sidebar */}
            <ChannelSidebar
              colors={colors}
              selectedServer={selectedServer}
              activeChannel={activeChannel}
              channels={channels}
              servers={servers}
              setActiveChannel={setActiveChannel}
            />
          </>
        )}

        {/* Main Content Area. In glass mode the glass-card lives on the
            parent flex container (sidebar + content share one surface),
            so the content area here is just a transparent flex column. */}
        <div
          className={
            uiMode === 'glass'
              ? "flex-1 min-w-0 flex flex-col overflow-hidden"
              : "flex-1 min-w-0 flex flex-col overflow-x-hidden"
          }
          style={uiMode === 'glass' ? undefined : { backgroundColor: colors.bg.primary }}
        >
          {/* Channel Header — also serves as a drag handle in glass mode
              so the window can be moved from the top of the content
              pane (the natural "titlebar" location). */}
          <div
            className="h-12 px-4 flex items-center justify-between shadow-sm"
            style={{
              borderBottom: `1px solid ${colors.bg.tertiary}`,
              ...(uiMode === 'glass' ? { WebkitAppRegion: 'drag' } : {}),
            } as React.CSSProperties}
          >
            <div className="flex items-center space-x-3">
              {(() => {
                const activeInfo = (Object.values(channels) as any[]).flat().find((c: any) => c.id === activeChannel);
                const Icon = activeChannel === "settings" ? Settings : (activeInfo?.icon ?? Hash);
                return <Icon className="h-5 w-5" style={{ color: colors.text.muted }} />;
              })()}
              <span
                className="font-semibold"
                style={{ color: colors.text.header }}
              >
                {selectedServer === "home"
                  ? channels.home?.find((c) => c.id === activeChannel)?.name || t('nav.dashboard')
                  : channels[selectedServer]?.find((c) => c.id === activeChannel)
                    ?.name || (activeChannel === "settings" ? t('nav.appSettings') : t('nav.aiAssistant'))}
              </span>
              {activeChannel === "chat" && (
                <>
                  {isAutoRestarting && (
                    <div className="flex items-center space-x-1 px-2 py-1 rounded bg-yellow-500/20">
                      <Loader2 className="h-3 w-3 text-yellow-400 animate-spin" />
                      <span className="text-xs text-yellow-400">{t('common.restarting')}</span>
                    </div>
                  )}
                  {!isAutoRestarting && restartStatus && (
                    <div
                      className="flex items-center space-x-1 px-2 py-1 rounded"
                      style={{
                        backgroundColor:
                          restartStatus.status === 'failed' ? 'rgba(239, 68, 68, 0.2)'
                          : restartStatus.status === 'ready'  ? 'rgba(34, 197, 94, 0.2)'
                          : 'rgba(255, 107, 71, 0.2)',
                        color:
                          restartStatus.status === 'failed' ? '#fca5a5'
                          : restartStatus.status === 'ready'  ? '#86efac'
                          : '#FF6B47',
                      }}
                      title={restartStatus.reason}
                    >
                      {restartStatus.status === 'queued' && <Loader2 className="h-3 w-3 animate-spin" />}
                      {restartStatus.status === 'restarting' && <Loader2 className="h-3 w-3 animate-spin" />}
                      <span className="text-xs">
                        {restartStatus.status === 'queued' && 'Applying changes…'}
                        {restartStatus.status === 'restarting' && 'Restarting gateway…'}
                        {restartStatus.status === 'ready' && '✓ Changes applied'}
                        {restartStatus.status === 'failed' && '✗ Restart failed'}
                      </span>
                    </div>
                  )}
                  {!isAutoRestarting && !restartStatus && status.isRunning && (
                    <div className="flex items-center space-x-1 px-2 py-1 rounded bg-green-500/20">
                      <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
                      <span className="text-xs text-green-400">{t('common.aiActive')}</span>
                    </div>
                  )}
                </>
              )}
            </div>

          </div>

          {/* Content Area — keyed on activeChannel so React tears down + remounts
              on tab switch. The wrapper div applies a quick fade-up so content
              feels like it slides in instead of popping. ChatSection is
              specifically excluded from this (rendered always-mounted below) so
              chat history isn't lost on navigation. */}
          <div
            key={activeChannel}
            className={`flex-1 overflow-hidden ${uiMode === 'glass' ? 'animate-page-glass' : 'animate-page-fade'}`}
          >
            {activeChannel === "quick-actions" && (
              <QuickActionsSection
                colors={colors}
                status={status}
                startOpenClaw={startOpenClaw}
                stopOpenClaw={stopOpenClaw}
                setSelectedServer={setSelectedServer}
                setActiveChannel={setActiveChannel}
                onOpenCommandPalette={() => setPaletteOpen(true)}
              />
            )}

            {activeChannel === "doctor" && (
              <DoctorSection colors={colors} />
            )}

            {activeChannel === "tools" && (
              <ToolsSection colors={colors} />
            )}

            {activeChannel === "access" && (
              <AccessControlSection colors={colors} />
            )}

            {activeChannel === "browser" && (
              <BrowserSection colors={colors} />
            )}

            {activeChannel === "memory" && (
              <MemorySection colors={colors} />
            )}

            {/* ChatSection is always mounted to preserve message history across navigation */}
            <div style={{ display: activeChannel === "chat" ? "flex" : "none", height: "100%", flexDirection: "column" }}>
              <ChatSection
                colors={{
                  background: {
                    primary: colors.bg.primary,
                    secondary: colors.bg.secondary,
                    tertiary: colors.bg.tertiary,
                    modifier: {
                      hover: colors.bg.hover,
                      active: colors.bg.active,
                      selected: colors.bg.active,
                    },
                  },
                  text: colors.text,
                  accent: {
                    ...colors.accent,
                    // User bubble: in glass mode use a soft brand wash
                    // (~10% coral on the section bg) so long messages
                    // don't blast the reader with saturated red; in
                    // classic Discord-style keep the dark terracotta
                    // brown that pairs with the dark chrome.
                    userBubble:
                      uiMode === 'glass'
                        ? (resolvedTheme === 'dark'
                            ? 'rgba(255, 77, 77, 0.12)'
                            : 'rgba(239, 75, 88, 0.10)')
                        : '#8B3A12',
                  },
                  // Pass the button namespace through — ChatSection's Stop
                  // button reads `colors.button.destructive` for the coral
                  // CTA / destructive split. Without this, the inline
                  // colors object would be missing the field and crash
                  // with "Cannot read properties of undefined (reading
                  // 'destructive')" on render.
                  button: colors.button,
                }}
                sessionKey="agent:main:main"
                gatewayPort={gatewayPort}
                isGatewayRunning={status.isRunning}
                isActive={activeChannel === "chat"}
                onGoToVoiceSettings={() => setActiveChannel("aiconfig")}
              />
            </div>

            {activeChannel === "onboard" && (
              <CliOnboardingWizard
                colors={colors}
                onComplete={() => setActiveChannel("quick-actions")}
                onCancel={() => setActiveChannel("quick-actions")}
              />
            )}

            {activeChannel === "sessions" && (
              <SessionsSection colors={colors} />
            )}

            {activeChannel === "workspace" && (
              <WorkspaceSection colors={colors} />
            )}

            {activeChannel === "commands" && (
              <CommandsSection colors={colors} />
            )}

            {activeChannel === "cron" && (
              <CronSection colors={colors} />
            )}

            {activeChannel === "activity" && (
              <ActivitySection
                colors={colors}
                logs={logs}
                onJump={(server, channel) => {
                  setSelectedServer(server)
                  setActiveChannel(channel)
                }}
              />
            )}

            {activeChannel === "whatsapp" && (
              <WhatsAppSection colors={colors} logs={logs} />
            )}

            {activeChannel === "telegram" && (
              <TelegramSection colors={colors} logs={logs} />
            )}

            {activeChannel === "discord-channel" && (
              <DiscordSection colors={colors} logs={logs} />
            )}

            {activeChannel === "slack-channel" && (
              <SlackSection colors={colors} logs={logs} />
            )}

            {activeChannel === "feishu-channel" && (
              <FeishuSection colors={colors} logs={logs} />
            )}

            {activeChannel === "line-channel" && (
              <LineSection colors={colors} logs={logs} />
            )}

            {/* Channel Setup */}
            {activeChannel === "setup" && (
              <AddNewChannelSection
                colors={colors}
                channels={channelStates}
                startWhatsAppSetup={startWhatsAppSetup}
                startTelegramSetup={startTelegramSetup}
                startDiscordSetup={startDiscordSetup}
                startSlackSetup={startSlackSetup}
                startFeishuSetup={startFeishuSetup}
                startLineSetup={startLineSetup}
                startWeixinSetup={startWeixinSetup}
                disconnectWhatsApp={disconnectWhatsApp}
                disconnectTelegram={disconnectTelegram}
                disconnectDiscord={disconnectDiscord}
                disconnectSlack={disconnectSlack}
                disconnectFeishu={disconnectFeishu}
                disconnectLine={disconnectLine}
                disconnectWeixin={disconnectWeixin}
                isConnecting={isConnecting}
                isDisconnecting={isDisconnecting}
              />
            )}

            {/* Agents Page */}
            {activeChannel === "agents" && (
              <div className="flex flex-col h-full">
                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto px-8 py-8 space-y-8">
                  <AgentManager colors={colors} onNavigateToLocalModels={() => setActiveChannel("models")} />
                  <AgentRoutingSection colors={colors} />
                </div>
              </div>
            )}

            {/* AI Provider Page */}
            {activeChannel === "aiconfig" && (
              <AIProviderSection
                colors={colors}
                onGoToSettings={() => {
                  setSelectedServer('main');
                  setActiveChannel('settings');
                }}
                onGoToAgents={() => {
                  setSelectedServer('aiconfig');
                  setActiveChannel('agents');
                }}
              />
            )}

            {/* Models Page */}
            {activeChannel === "models" && <ModelsSection colors={colors} />}

            {/* Skills Page */}
            {activeChannel === "skills" && <SkillsSection colors={colors} />}

            {/* Hooks Page */}
            {activeChannel === "hooks" && <HooksSection colors={colors} />}

            {/* Plugins Page */}
            {activeChannel === "plugins" && <PluginsSection colors={colors} />}

            {/* Settings Page */}
            {activeChannel === "settings" && (
              <SettingsContent
                colors={colors}
                setSelectedServer={setSelectedServer}
                setActiveChannel={setActiveChannel}
              />
            )}
          </div>
        </div>
      </div>

      {/* Channel Setup Modals */}
      <ChannelSetupModals
        colors={colors}
        activeSetup={activeSetup}
        qrCode={qrCode}
        qrLoadingTimedOut={qrLoadingTimedOut}
        isCheckingStatus={isCheckingStatus}
        isConnecting={isConnecting}
        telegramToken={telegramToken}
        discordToken={discordToken}
        discordServerId={discordServerId}
        slackBotToken={slackBotToken}
        slackAppToken={slackAppToken}
        feishuAppId={feishuAppId}
        feishuAppSecret={feishuAppSecret}
        feishuBotName={feishuBotName}
        lineChannelAccessToken={lineChannelAccessToken}
        lineChannelSecret={lineChannelSecret}
        setTelegramToken={setTelegramToken}
        setDiscordToken={setDiscordToken}
        setDiscordServerId={setDiscordServerId}
        setSlackBotToken={setSlackBotToken}
        setSlackAppToken={setSlackAppToken}
        setFeishuAppId={setFeishuAppId}
        setFeishuAppSecret={setFeishuAppSecret}
        setFeishuBotName={setFeishuBotName}
        setLineChannelAccessToken={setLineChannelAccessToken}
        setLineChannelSecret={setLineChannelSecret}
        connectTelegramBot={connectTelegramBot}
        connectDiscordBot={connectDiscordBot}
        connectSlackBot={connectSlackBot}
        connectFeishuBot={connectFeishuBot}
        connectLineBot={connectLineBot}
        disconnectWhatsApp={disconnectWhatsApp}
        disconnectWeixin={disconnectWeixin}
        cancelSetup={cancelSetup}
      />

      {/* Ollama Installation Popup */}
      <OllamaInstallPopup
        isOpen={ollamaPopupOpen}
        onClose={() => {
          setOllamaPopupOpen(false);
        }}
        onInstall={installOllama}
        installState={ollamaInstallState}
        modelName={undefined}
      />
    </div>
    </ThemeProvider>
  );
}
