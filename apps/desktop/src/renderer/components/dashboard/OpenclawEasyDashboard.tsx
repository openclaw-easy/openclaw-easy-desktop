import React, { useState, useEffect } from "react";
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
  WhatsAppSection,
  TelegramSection,
  DiscordSection,
  SlackSection,
  FeishuSection,
  LineSection,
  QuickActionsSection,
  MetricsSection,
  SessionsSection,
  CommandsSection,
  WorkspaceSection,
  MemorySection,
  UsageSection,
} from "./sections";
import { CliOnboardingWizard } from "../wizard/CliOnboardingWizard";
import {
  Activity,
  BarChart3,
  Bot,
  Brain,
  Clock,
  FolderOpen,
  Hash,
  Loader2,
  MessageSquare,
  Package,
  Plus,
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

export function OpenclawEasyDashboard() {
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
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const updater = useAppUpdater();

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


  // Openclaw color scheme
  const colors = {
    bg: {
      primary: "#1e2128",
      secondary: "#252830",
      tertiary: "#16181e",
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
    },
  };

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

    // Always show manage-channel option
    connectedChannels.push({ id: "setup", name: t('nav.manageChannel'), type: "text", icon: Plus });

    return connectedChannels;
  };

  const channels = {
    home: [
      { id: "quick-actions", name: t('nav.quickActions'), type: "text", icon: Rocket },
      { id: "metrics",       name: t('nav.metrics'),      type: "text", icon: Activity },
      { id: "usage",         name: t('nav.usage'),        type: "text", icon: BarChart3 },
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
      { id: "memory",    name: t('nav.memory'),      type: "text", icon: Brain,         category: t('nav.categoryManage') },
    ],
    channels: getConnectedChannels(),
    aiconfig: [
      { id: "aiconfig", name: t('nav.aiProvider'),   type: "text", icon: Settings },
      { id: "agents",   name: t('nav.agents'),       type: "text", icon: Bot },
      { id: "workspace", name: t('nav.workspace'),   type: "text", icon: FolderOpen },
      { id: "skills",   name: t('nav.skills'),       type: "text", icon: Package },
      { id: "hooks",    name: t('nav.hooks'),        type: "text", icon: Zap },
      { id: "plugins",  name: t('nav.plugins'),      type: "text", icon: Puzzle },
      { id: "models",   name: t('nav.localModels'),  type: "text", icon: Package },
    ],
  };

  return (
    <ThemeProvider colors={colors}>
    <div
      className="h-screen flex flex-col"
      style={{ backgroundColor: colors.bg.primary }}
    >
      {/* Title Bar - Draggable Area */}
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

      {/* Main Discord Layout */}
      <div className="flex-1 flex overflow-hidden">
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

        {/* Main Content Area */}
        <div
          className="flex-1 min-w-0 flex flex-col overflow-x-hidden"
          style={{ backgroundColor: colors.bg.primary }}
        >
          {/* Channel Header */}
          <div
            className="h-12 px-4 flex items-center justify-between shadow-sm"
            style={{ borderBottom: `1px solid ${colors.bg.tertiary}` }}
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
                  {!isAutoRestarting && status.isRunning && (
                    <div className="flex items-center space-x-1 px-2 py-1 rounded bg-green-500/20">
                      <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
                      <span className="text-xs text-green-400">{t('common.aiActive')}</span>
                    </div>
                  )}
                </>
              )}
            </div>

          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-hidden">
            {activeChannel === "quick-actions" && (
              <QuickActionsSection
                colors={colors}
                status={status}
                startOpenClaw={startOpenClaw}
                stopOpenClaw={stopOpenClaw}
                setSelectedServer={setSelectedServer}
                setActiveChannel={setActiveChannel}
              />
            )}

            {activeChannel === "metrics" && (
              <MetricsSection colors={colors} />
            )}

            {activeChannel === "doctor" && (
              <DoctorSection colors={colors} />
            )}

            {activeChannel === "tools" && (
              <ToolsSection colors={colors} />
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
                    userBubble: '#8B3A12',
                  },
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

            {activeChannel === "memory" && (
              <MemorySection colors={colors} />
            )}

            {activeChannel === "usage" && (
              <UsageSection colors={colors} gatewayPort={gatewayPort} />
            )}

            {activeChannel === "commands" && (
              <CommandsSection colors={colors} />
            )}

            {activeChannel === "cron" && (
              <CronSection colors={colors} />
            )}

            {activeChannel === "activity" && (
              <ActivitySection colors={colors} logs={logs} />
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
                disconnectWhatsApp={disconnectWhatsApp}
                disconnectTelegram={disconnectTelegram}
                disconnectDiscord={disconnectDiscord}
                disconnectSlack={disconnectSlack}
                disconnectFeishu={disconnectFeishu}
                disconnectLine={disconnectLine}
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
