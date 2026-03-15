import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_GATEWAY_PORT } from "../../../shared/constants";
import {
  Activity,
  AlertCircle,
  BarChart3,
  Bot,
  CheckCircle,
  Clock,
  Globe,
  Hash,
  MessageCircle,
  Play,
  RotateCcw,
  Settings,
  Smartphone,
  Square,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";

interface OpenClawDashboardProps {
  colors: any;
  onBack?: () => void;
}

interface GatewayStatus {
  status: "running" | "stopped" | "starting" | "error";
  port?: number;
  version?: string;
  uptime?: string;
  requests?: number;
  channels?: ChannelInfo[];
  agents?: AgentInfo[];
}

interface ChannelInfo {
  id: string;
  type: "whatsapp" | "telegram" | "discord" | "signal" | "slack";
  name: string;
  status: "connected" | "disconnected" | "connecting" | "error";
  lastActivity?: string;
  messageCount?: number;
}

interface AgentInfo {
  id: string;
  name: string;
  status: "active" | "idle" | "busy";
  model: string;
  provider: string;
  sessionCount: number;
  tokensUsed: number;
}

export function OpenClawDashboard({ colors, onBack }: OpenClawDashboardProps) {
  const { t } = useTranslation();
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus>({
    status: "stopped",
    channels: [],
    agents: [],
  });
  const [activeTab, setActiveTab] = useState<
    "overview" | "channels" | "agents" | "logs" | "settings"
  >("overview");
  const [logs, setLogs] = useState<string[]>([]);
  const [isConnectingWhatsApp, setIsConnectingWhatsApp] = useState(false);
  const [whatsAppLogs, setWhatsAppLogs] = useState<string[]>([]);

  // Load gateway status and data
  useEffect(() => {
    loadGatewayData();
    const interval = setInterval(loadGatewayData, 2000); // Refresh every 2 seconds
    return () => clearInterval(interval);
  }, []);

  const loadGatewayData = async () => {
    try {
      const status = await window.electronAPI?.getStatus?.();
      const gatewayInfo = await window.electronAPI?.getGatewayInfo?.();
      const realChannels = await window.electronAPI?.listChannels?.();
      const channelStatus = await window.electronAPI?.getChannelStatus?.();
      const gatewayLogs = await window.electronAPI?.getOpenClawLogs?.();

      // Process real channel data from OpenClaw
      const processedChannels: ChannelInfo[] = [];

      // For WhatsApp, use the same precise status detection as our custom UI
      let whatsappStatus = "disconnected";
      if (window.electronAPI?.checkWhatsAppStatus) {
        try {
          const whatsappCheck = await window.electronAPI.checkWhatsAppStatus();
          whatsappStatus = whatsappCheck.connected
            ? "connected"
            : "disconnected";
        } catch (error) {
          console.error(
            "[OpenClawDashboard] Failed to check WhatsApp status:",
            error,
          );
        }
      }

      if (realChannels && Array.isArray(realChannels)) {
        realChannels.forEach((channel: any) => {
          // Use the same status logic as our custom UI for consistency
          let channelStatus = "disconnected";

          if (channel.channel === "whatsapp") {
            // Use the precise WhatsApp status we just checked
            channelStatus = whatsappStatus;
          } else {
            // For other channels, use simple status check
            channelStatus =
              channel.status === "connected" ? "connected" : "disconnected";
          }

          processedChannels.push({
            id: channel.account || `${channel.channel}-default`,
            type: channel.channel,
            name:
              channel.name ||
              `${channel.channel.charAt(0).toUpperCase()}${channel.channel.slice(1)}`,
            status: channelStatus,
            messageCount: channel.messageCount || 0,
            lastActivity: channel.lastActivity,
          });
        });
      }

      // Add default WhatsApp entry if none exists
      if (!processedChannels.some((c) => c.type === "whatsapp")) {
        processedChannels.push({
          id: "whatsapp-default",
          type: "whatsapp",
          name: "WhatsApp",
          status: whatsappStatus, // Use the precise status we just checked
          messageCount: 0,
        });
      }

      const mockAgents: AgentInfo[] = [
        {
          id: "agent-1",
          name: "Primary Assistant",
          status: status === "running" ? "idle" : "active",
          model: "claude-3-sonnet",
          provider: "anthropic",
          sessionCount: 0,
          tokensUsed: 0,
        },
      ];

      setGatewayStatus({
        status: status || "stopped",
        port: gatewayInfo?.port || DEFAULT_GATEWAY_PORT,
        version: gatewayInfo?.version || "2026.1.30 (Embedded)",
        uptime: status === "running" ? "5m 32s" : "0s",
        requests: 0,
        channels: processedChannels,
        agents: mockAgents,
      });

      if (gatewayLogs) {
        setLogs(gatewayLogs.slice(-50)); // Keep last 50 logs
      }
    } catch (error) {
      console.error("[OpenClawDashboard] Failed to load gateway data:", error);
    }
  };

  const handleGatewayControl = async (action: "start" | "stop" | "restart") => {
    try {
      switch (action) {
        case "start":
          await window.electronAPI?.startOpenClaw?.();
          break;
        case "stop":
          await window.electronAPI?.stopOpenClaw?.();
          break;
        case "restart":
          await window.electronAPI?.stopOpenClaw?.();
          setTimeout(() => window.electronAPI?.startOpenClaw?.(), 1000);
          break;
      }
      // Refresh data after action
      setTimeout(loadGatewayData, 500);
    } catch (error) {
      console.error(`[OpenClawDashboard] Gateway ${action} failed:`, error);
    }
  };

  const handleWhatsAppConnection = async () => {
    if (isConnectingWhatsApp) {return;}

    try {
      setIsConnectingWhatsApp(true);
      setWhatsAppLogs(["🔗 Starting WhatsApp connection..."]);

      // First add WhatsApp channel if it doesn't exist
      const addResult =
        await window.electronAPI?.addWhatsAppChannel?.("WhatsApp");
      if (!addResult) {
        setWhatsAppLogs((prev) => [
          ...prev,
          "❌ Failed to add WhatsApp channel",
        ]);
        return;
      }

      setWhatsAppLogs((prev) => [...prev, "✅ WhatsApp channel added"]);

      // Then start the login process
      const loginResult = await window.electronAPI?.loginWhatsApp?.();
      if (loginResult?.logs) {
        setWhatsAppLogs((prev) => [...prev, ...loginResult.logs]);
      }

      if (loginResult?.success) {
        setWhatsAppLogs((prev) => [
          ...prev,
          "✅ WhatsApp connected successfully!",
        ]);
        setTimeout(loadGatewayData, 1000); // Refresh channels
      } else {
        setWhatsAppLogs((prev) => [...prev, "❌ WhatsApp connection failed"]);
      }
    } catch (error) {
      console.error("[OpenClawDashboard] WhatsApp connection failed:", error);
      setWhatsAppLogs((prev) => [...prev, `❌ Error: ${error instanceof Error ? error.message : String(error)}`]);
    } finally {
      setIsConnectingWhatsApp(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "running":
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case "starting":
        return <Clock className="h-5 w-5 text-yellow-500" />;
      case "error":
        return <AlertCircle className="h-5 w-5 text-red-500" />;
      default:
        return <AlertCircle className="h-5 w-5 text-gray-500" />;
    }
  };

  const getChannelIcon = (type: string) => {
    switch (type) {
      case "whatsapp":
        return <Smartphone className="h-5 w-5" />;
      case "telegram":
        return <MessageCircle className="h-5 w-5" />;
      case "discord":
        return <Hash className="h-5 w-5" />;
      default:
        return <Globe className="h-5 w-5" />;
    }
  };

  const renderOverview = () => (
    <div className="space-y-6">
      {/* Gateway Status Card */}
      <div
        className="rounded-lg p-6"
        style={{ backgroundColor: colors.bg.secondary }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            {getStatusIcon(gatewayStatus.status)}
            <div>
              <h3
                className="text-lg font-semibold"
                style={{ color: colors.text.header }}
              >
                {t('nav.gatewayStatus')}
              </h3>
              <p className="text-sm" style={{ color: colors.text.muted }}>
                {gatewayStatus.status === "running"
                  ? t('nav.onlineReady')
                  : t('common.offline')}
              </p>
            </div>
          </div>

          <div className="flex space-x-2">
            <button
              onClick={() => handleGatewayControl("start")}
              disabled={gatewayStatus.status === "running"}
              className="p-2 rounded-md transition-colors disabled:opacity-50"
              style={{
                backgroundColor: colors.accent.green + "20",
                color: colors.accent.green,
              }}
            >
              <Play className="h-4 w-4" />
            </button>
            <button
              onClick={() => handleGatewayControl("stop")}
              disabled={gatewayStatus.status === "stopped"}
              className="p-2 rounded-md transition-colors disabled:opacity-50"
              style={{
                backgroundColor: colors.accent.red + "20",
                color: colors.accent.red,
              }}
            >
              <Square className="h-4 w-4" />
            </button>
            <button
              onClick={() => handleGatewayControl("restart")}
              className="p-2 rounded-md transition-colors"
              style={{
                backgroundColor: colors.accent.yellow + "20",
                color: colors.accent.yellow,
              }}
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>
        </div>

        {gatewayStatus.status === "running" && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p style={{ color: colors.text.muted }}>{t('nav.port')}</p>
              <p style={{ color: colors.text.normal }}>{gatewayStatus.port}</p>
            </div>
            <div>
              <p style={{ color: colors.text.muted }}>{t('nav.version')}</p>
              <p style={{ color: colors.text.normal }}>
                {gatewayStatus.version}
              </p>
            </div>
            <div>
              <p style={{ color: colors.text.muted }}>{t('nav.uptime')}</p>
              <p style={{ color: colors.text.normal }}>
                {gatewayStatus.uptime}
              </p>
            </div>
            <div>
              <p style={{ color: colors.text.muted }}>{t('nav.requests')}</p>
              <p style={{ color: colors.text.normal }}>
                {gatewayStatus.requests}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div
          className="rounded-lg p-4"
          style={{ backgroundColor: colors.bg.secondary }}
        >
          <div className="flex items-center space-x-3">
            <div
              className="p-2 rounded-md"
              style={{ backgroundColor: colors.accent.brand + "20" }}
            >
              <MessageCircle
                className="h-5 w-5"
                style={{ color: colors.accent.brand }}
              />
            </div>
            <div>
              <p className="text-sm" style={{ color: colors.text.muted }}>
                {t('nav.activeChannels')}
              </p>
              <p
                className="text-xl font-semibold"
                style={{ color: colors.text.header }}
              >
                {gatewayStatus.channels?.filter((c) => c.status === "connected")
                  .length || 0}
              </p>
            </div>
          </div>
        </div>

        <div
          className="rounded-lg p-4"
          style={{ backgroundColor: colors.bg.secondary }}
        >
          <div className="flex items-center space-x-3">
            <div
              className="p-2 rounded-md"
              style={{ backgroundColor: colors.accent.green + "20" }}
            >
              <Bot className="h-5 w-5" style={{ color: colors.accent.green }} />
            </div>
            <div>
              <p className="text-sm" style={{ color: colors.text.muted }}>
                {t('nav.activeAgents')}
              </p>
              <p
                className="text-xl font-semibold"
                style={{ color: colors.text.header }}
              >
                {gatewayStatus.agents?.filter((a) => a.status !== "idle")
                  .length || 0}
              </p>
            </div>
          </div>
        </div>

        <div
          className="rounded-lg p-4"
          style={{ backgroundColor: colors.bg.secondary }}
        >
          <div className="flex items-center space-x-3">
            <div
              className="p-2 rounded-md"
              style={{ backgroundColor: colors.accent.purple + "20" }}
            >
              <BarChart3
                className="h-5 w-5"
                style={{ color: colors.accent.purple }}
              />
            </div>
            <div>
              <p className="text-sm" style={{ color: colors.text.muted }}>
                {t('nav.totalSessions')}
              </p>
              <p
                className="text-xl font-semibold"
                style={{ color: colors.text.header }}
              >
                {gatewayStatus.agents?.reduce(
                  (sum, a) => sum + a.sessionCount,
                  0,
                ) || 0}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderChannels = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3
          className="text-lg font-semibold"
          style={{ color: colors.text.header }}
        >
          {t('nav.communicationChannels')}
        </h3>
        <button
          onClick={handleWhatsAppConnection}
          disabled={isConnectingWhatsApp}
          className="px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
          style={{
            backgroundColor: colors.accent.green,
            color: "white",
          }}
        >
          {isConnectingWhatsApp ? "🔗 Connecting..." : "📱 Connect WhatsApp"}
        </button>
      </div>

      {/* WhatsApp Connection Logs */}
      {whatsAppLogs.length > 0 && (
        <div
          className="rounded-lg p-4"
          style={{ backgroundColor: colors.bg.secondary }}
        >
          <h4
            className="text-sm font-medium mb-2"
            style={{ color: colors.text.header }}
          >
            WhatsApp Connection Log:
          </h4>
          <div className="max-h-32 overflow-y-auto font-mono text-xs space-y-1">
            {whatsAppLogs.map((log, index) => (
              <div key={index} style={{ color: colors.text.muted }}>
                {log}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {gatewayStatus.channels?.map((channel) => (
          <div
            key={channel.id}
            className="rounded-lg p-4"
            style={{ backgroundColor: colors.bg.secondary }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div
                  className="p-2 rounded-md"
                  style={{ backgroundColor: colors.bg.tertiary }}
                >
                  {getChannelIcon(channel.type)}
                </div>
                <div>
                  <h4
                    className="font-medium"
                    style={{ color: colors.text.header }}
                  >
                    {channel.name}
                  </h4>
                  <p className="text-sm" style={{ color: colors.text.muted }}>
                    {channel.type.charAt(0).toUpperCase() +
                      channel.type.slice(1)}
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-4">
                <div className="text-right text-sm">
                  <p style={{ color: colors.text.muted }}>Messages</p>
                  <p style={{ color: colors.text.normal }}>
                    {channel.messageCount}
                  </p>
                </div>
                <div className="flex items-center space-x-1">
                  {channel.status === "connected" ? (
                    <Wifi className="h-4 w-4 text-green-500" />
                  ) : (
                    <WifiOff className="h-4 w-4 text-gray-500" />
                  )}
                  <span
                    className="text-sm"
                    style={{
                      color:
                        channel.status === "connected"
                          ? colors.accent.green
                          : colors.text.muted,
                    }}
                  >
                    {channel.status}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}

        {(!gatewayStatus.channels || gatewayStatus.channels.length === 0) && (
          <div
            className="text-center py-8"
            style={{ color: colors.text.muted }}
          >
            <MessageCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>{t('nav.noChannelsConfigured')}</p>
            <p className="text-sm">
              {t('nav.addFirstChannel')}
            </p>
          </div>
        )}
      </div>
    </div>
  );

  const renderLogs = () => (
    <div className="space-y-4">
      <h3
        className="text-lg font-semibold"
        style={{ color: colors.text.header }}
      >
        {t('nav.gatewayLogs')}
      </h3>

      <div
        className="rounded-lg p-4 h-96 overflow-y-auto font-mono text-sm"
        style={{ backgroundColor: colors.bg.secondary }}
      >
        {logs.length > 0 ? (
          logs.map((log, index) => (
            <div
              key={index}
              className="mb-1 whitespace-pre-wrap"
              style={{ color: colors.text.muted }}
            >
              {log}
            </div>
          ))
        ) : (
          <div style={{ color: colors.text.muted }}>{t('nav.noLogsAvailable')}</div>
        )}
      </div>
    </div>
  );

  const tabs = [
    { id: "overview", label: t('nav.overview'), icon: Activity },
    { id: "channels", label: t('nav.channels'), icon: MessageCircle },
    { id: "agents", label: t('nav.agents'), icon: Bot },
    { id: "logs", label: t('nav.logs'), icon: Settings },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div
        className="flex items-center justify-between p-6 border-b"
        style={{ borderColor: colors.border }}
      >
        <div className="flex items-center space-x-3">
          <div
            className="p-2 rounded-md"
            style={{ backgroundColor: colors.accent.green + "20" }}
          >
            <Zap className="h-6 w-6" style={{ color: colors.accent.green }} />
          </div>
          <div>
            <h2
              className="text-xl font-bold"
              style={{ color: colors.text.header }}
            >
              {t('nav.openClawDashboard')}
            </h2>
            <p className="text-sm" style={{ color: colors.text.muted }}>
              {t('nav.embeddedGateway')}
            </p>
          </div>
        </div>

        {onBack && (
          <button
            onClick={onBack}
            className="px-4 py-2 rounded-md text-sm"
            style={{
              backgroundColor: colors.bg.secondary,
              color: colors.text.normal,
            }}
          >
            {t('nav.backToMain')}
          </button>
        )}
      </div>

      {/* Navigation Tabs */}
      <div
        className="flex space-x-1 p-4 border-b"
        style={{ borderColor: colors.border }}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center space-x-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive ? "" : "hover:opacity-80"
              }`}
              style={{
                backgroundColor: isActive
                  ? colors.accent.brand
                  : "transparent",
                color: isActive ? "white" : colors.text.normal,
              }}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {activeTab === "overview" && renderOverview()}
        {activeTab === "channels" && renderChannels()}
        {activeTab === "logs" && renderLogs()}
        {activeTab === "agents" && (
          <div
            className="text-center py-8"
            style={{ color: colors.text.muted }}
          >
            <Bot className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>{t('nav.agentComingSoon')}</p>
          </div>
        )}
      </div>
    </div>
  );
}