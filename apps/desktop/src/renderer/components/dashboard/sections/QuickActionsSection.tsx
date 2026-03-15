import React from "react";
import { useTranslation } from 'react-i18next';
import { MessageSquare, Settings, Wrench, Hash, Loader2, Rocket, Clock, Terminal, Bot } from "lucide-react";
import { DEFAULT_GATEWAY_PORT } from '../../../../shared/constants';

interface ColorScheme {
  bg: {
    primary: string;
    secondary: string;
    tertiary: string;
    hover: string;
    active: string;
  };
  text: {
    normal: string;
    muted: string;
    header: string;
    link: string;
    danger: string;
  };
  accent: {
    brand: string;
    green: string;
    yellow: string;
    red: string;
    purple: string;
  };
}

interface AppStatus {
  isRunning: boolean;
  port?: number;
  pid?: number | string;
  uptime?: number;
  version?: string;
}

interface QuickActionsSectionProps {
  colors: ColorScheme;
  status: AppStatus;
  startOpenClaw: () => Promise<void>;
  stopOpenClaw: () => Promise<void>;
  setSelectedServer: (server: string) => void;
  setActiveChannel: (channel: string) => void;
}

export function QuickActionsSection({
                                      colors,
                                      status,
                                      startOpenClaw,
                                      stopOpenClaw,
                                      setSelectedServer,
                                      setActiveChannel,
                                    }: QuickActionsSectionProps) {
  const { t } = useTranslation();
  const [isLaunching, setIsLaunching] = React.useState(false);
  const [isStopping, setIsStopping] = React.useState(false);
  const launchRequestedRef = React.useRef(false);

  // Clear launching state once the gateway actually comes online, not when the
  // IPC call returns — startOpenClaw() resolves as soon as the process starts,
  // but the gateway takes several more seconds to become ready.
  React.useEffect(() => {
    if (status.isRunning && launchRequestedRef.current) {
      launchRequestedRef.current = false;
      setIsLaunching(false);
    }
  }, [status.isRunning]);

  const handleStop = async () => {
    setIsStopping(true);
    try {
      await stopOpenClaw();
    } finally {
      setIsStopping(false);
    }
  };

  const handleStart = async () => {
    setIsLaunching(true);
    launchRequestedRef.current = true;
    try {
      await startOpenClaw();
      // isLaunching stays true — the useEffect above will clear it once
      // status.isRunning becomes true (gateway is actually ready).
    } catch (error) {
      console.error("❌ [QuickActions] startOpenClaw failed:", error);
      setIsLaunching(false);
      launchRequestedRef.current = false;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-4 pb-2">
        <div className="flex items-baseline gap-2">
          <h3
            className="text-lg font-bold"
            style={{ color: colors.text.header }}
          >
            {t('quickActions.title')}
          </h3>
          <p className="text-xs" style={{ color: colors.text.muted }}>
            {t('quickActions.subtitle')}
          </p>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-3 space-y-3">
        {/* Assistant Status Card */}
        <div
          className="rounded-lg p-4"
          style={{ backgroundColor: colors.bg.secondary }}
        >
          <div className="flex items-center justify-between mb-3">
            <h4
              className="text-base font-semibold"
              style={{ color: colors.text.header }}
            >
              {t('quickActions.assistantStatus')}
            </h4>
            <div className="flex items-center space-x-3">
              {/* Online Status */}
              {status.isRunning && (
                <div className="flex items-center space-x-2 px-3 py-1 rounded bg-green-500/20">
                  <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-xs text-green-400">{t('common.online')}</span>
                </div>
              )}
            </div>
          </div>

          {status.isRunning ? (
            <div className="space-y-3">
              {/* Gateway Info */}
              <div
                className="rounded-lg p-3"
                style={{ backgroundColor: colors.bg.tertiary }}
              >
                <div className="flex items-center space-x-2 mb-2">
                  <div className="h-2.5 w-2.5 bg-green-500 rounded-full animate-pulse" />
                  <span
                    className="text-xs font-semibold"
                    style={{ color: colors.accent.green }}
                  >
                    {t('quickActions.gatewayActive')}
                  </span>
                </div>
                <div
                  className="flex items-center gap-4 text-xs"
                  style={{ color: colors.text.muted }}
                >
                  <span>✅ {t('quickActions.gatewayPort', { port: status.port || DEFAULT_GATEWAY_PORT })}</span>
                  <span>✅ {t('quickActions.processId', { pid: status.pid || "Active" })}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2">
                <button
                  onClick={handleStop}
                  disabled={isStopping}
                  className="flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-center space-x-2"
                  style={{
                    backgroundColor: colors.accent.red,
                    color: "white",
                    opacity: isStopping ? 0.6 : 1
                  }}
                >
                  {isStopping && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  <span>{isStopping ? t('common.stopping') : t('quickActions.stopAssistant')}</span>
                </button>
                <button
                  onClick={() => {
                    setSelectedServer("main");
                    setActiveChannel("chat");
                  }}
                  className="flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all hover:scale-105"
                  style={{
                    backgroundColor: colors.accent.brand,
                    color: "white"
                  }}
                >
                  {t('quickActions.openChat')}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs" style={{ color: colors.text.muted }}>
                {t('quickActions.assistantOffline')}
              </p>
              <button
                onClick={handleStart}
                disabled={isLaunching}
                className="w-full px-3 py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-center space-x-2"
                style={{
                  backgroundColor: colors.accent.green,
                  color: "white",
                  opacity: isLaunching ? 0.6 : 1
                }}
              >
                {isLaunching && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                <span>{isLaunching ? t('common.launching') : t('quickActions.launchAssistant')}</span>
              </button>
            </div>
          )}
        </div>

        {/* Navigation Cards */}
        <div
          className="rounded-lg p-4"
          style={{ backgroundColor: colors.bg.secondary }}
        >
          <h4
            className="text-base font-semibold mb-3"
            style={{ color: colors.text.header }}
          >
            {t('quickActions.navigation')}
          </h4>
          <div className="grid grid-cols-2 gap-3">
            {/* Onboard */}
            <button
              onClick={() => {
                setSelectedServer("main");
                setActiveChannel("onboard");
              }}
              className="p-3 rounded-lg transition-all hover:scale-105 text-left"
              style={{ backgroundColor: colors.bg.tertiary }}
            >
              <Rocket className="h-5 w-5 mb-1.5" style={{ color: "#f97316" }} />
              <div
                className="font-medium text-xs mb-0.5"
                style={{ color: colors.text.header }}
              >
                {t('quickActions.onboard')}
              </div>
              <div
                className="text-[10px] leading-tight"
                style={{ color: colors.text.muted }}
              >
                {t('quickActions.onboardDesc')}
              </div>
            </button>

            {/* Chat with AI */}
            <button
              onClick={() => {
                setSelectedServer("main");
                setActiveChannel("chat");
              }}
              className="p-3 rounded-lg transition-all hover:scale-105 text-left"
              style={{ backgroundColor: colors.bg.tertiary }}
            >
              <MessageSquare
                className="h-5 w-5 mb-1.5"
                style={{ color: colors.accent.brand }}
              />
              <div
                className="font-medium text-xs mb-0.5"
                style={{ color: colors.text.header }}
              >
                {t('quickActions.chatWithAI')}
              </div>
              <div
                className="text-[10px] leading-tight"
                style={{ color: colors.text.muted }}
              >
                {t('quickActions.chatWithAIDesc')}
              </div>
            </button>

            {/* Manage Channels */}
            <button
              onClick={() => {
                setSelectedServer("channels");
                setActiveChannel("setup");
              }}
              className="p-3 rounded-lg transition-all hover:scale-105 text-left"
              style={{ backgroundColor: colors.bg.tertiary }}
            >
              <Hash
                className="h-5 w-5 mb-1.5"
                style={{ color: colors.accent.green }}
              />
              <div
                className="font-medium text-xs mb-0.5"
                style={{ color: colors.text.header }}
              >
                {t('quickActions.manageChannels')}
              </div>
              <div
                className="text-[10px] leading-tight"
                style={{ color: colors.text.muted }}
              >
                {t('quickActions.manageChannelsDesc')}
              </div>
            </button>

            {/* AI Configuration */}
            <button
              onClick={() => {
                setSelectedServer("aiconfig");
                setActiveChannel("aiconfig");
              }}
              className="p-3 rounded-lg transition-all hover:scale-105 text-left"
              style={{ backgroundColor: colors.bg.tertiary }}
            >
              <Settings
                className="h-5 w-5 mb-1.5"
                style={{ color: colors.accent.purple }}
              />
              <div
                className="font-medium text-xs mb-0.5"
                style={{ color: colors.text.header }}
              >
                {t('quickActions.aiConfiguration')}
              </div>
              <div
                className="text-[10px] leading-tight"
                style={{ color: colors.text.muted }}
              >
                {t('quickActions.aiConfigurationDesc')}
              </div>
            </button>

            {/* Configure Agent */}
            <button
              onClick={() => {
                setSelectedServer("aiconfig");
                setActiveChannel("agents");
              }}
              className="p-3 rounded-lg transition-all hover:scale-105 text-left"
              style={{ backgroundColor: colors.bg.tertiary }}
            >
              <Bot
                className="h-5 w-5 mb-1.5"
                style={{ color: colors.accent.purple }}
              />
              <div
                className="font-medium text-xs mb-0.5"
                style={{ color: colors.text.header }}
              >
                {t('quickActions.configureAgent')}
              </div>
              <div
                className="text-[10px] leading-tight"
                style={{ color: colors.text.muted }}
              >
                {t('quickActions.configureAgentDesc')}
              </div>
            </button>

            {/* Commands */}
            <button
              onClick={() => {
                setSelectedServer("main");
                setActiveChannel("commands");
              }}
              className="p-3 rounded-lg transition-all hover:scale-105 text-left"
              style={{ backgroundColor: colors.bg.tertiary }}
            >
              <Terminal
                className="h-5 w-5 mb-1.5"
                style={{ color: colors.accent.brand }}
              />
              <div
                className="font-medium text-xs mb-0.5"
                style={{ color: colors.text.header }}
              >
                {t('quickActions.commandsLabel')}
              </div>
              <div
                className="text-[10px] leading-tight"
                style={{ color: colors.text.muted }}
              >
                {t('quickActions.commandsDesc')}
              </div>
            </button>

            {/* Cron Jobs */}
            <button
              onClick={() => {
                setSelectedServer("main");
                setActiveChannel("cron");
              }}
              className="p-3 rounded-lg transition-all hover:scale-105 text-left"
              style={{ backgroundColor: colors.bg.tertiary }}
            >
              <Clock
                className="h-5 w-5 mb-1.5"
                style={{ color: colors.accent.green }}
              />
              <div
                className="font-medium text-xs mb-0.5"
                style={{ color: colors.text.header }}
              >
                {t('quickActions.cronJobs')}
              </div>
              <div
                className="text-[10px] leading-tight"
                style={{ color: colors.text.muted }}
              >
                {t('quickActions.cronJobsDesc')}
              </div>
            </button>

            {/* Tools & Permissions */}
            <button
              onClick={() => {
                setSelectedServer("main");
                setActiveChannel("tools");
              }}
              className="p-3 rounded-lg transition-all hover:scale-105 text-left"
              style={{ backgroundColor: colors.bg.tertiary }}
            >
              <Wrench
                className="h-5 w-5 mb-1.5"
                style={{ color: colors.accent.yellow }}
              />
              <div
                className="font-medium text-xs mb-0.5"
                style={{ color: colors.text.header }}
              >
                {t('quickActions.toolsPermissions')}
              </div>
              <div
                className="text-[10px] leading-tight"
                style={{ color: colors.text.muted }}
              >
                {t('quickActions.toolsPermissionsDesc')}
              </div>
            </button>
          </div>
        </div>

        {/* Web Dashboard */}
        <div
          className="rounded-lg p-4"
          style={{ backgroundColor: colors.bg.secondary }}
        >
          <h4
            className="text-base font-semibold mb-3"
            style={{ color: colors.text.header }}
          >
            {t('quickActions.webDashboard')}
          </h4>
          <button
            onClick={async () => {
              if (!status.isRunning) {
                return;
              }
              try {
                const [token, port] = await Promise.all([
                  window.electronAPI?.getGatewayToken?.(),
                  window.electronAPI?.getGatewayPort?.()
                ]);
                const gatewayPort = port || DEFAULT_GATEWAY_PORT;
                const url = token
                  ? `http://localhost:${gatewayPort}?token=${encodeURIComponent(token)}`
                  : `http://localhost:${gatewayPort}`;
                console.log("[QuickActions] Opening OpenClaw Web UI:", url);
                window.electronAPI?.openExternal?.(url);
              } catch (error) {
                console.error(
                  "[QuickActions] Failed to get gateway info:",
                  error
                );
                window.electronAPI?.openExternal?.(`http://localhost:${DEFAULT_GATEWAY_PORT}`);
              }
            }}
            disabled={!status.isRunning}
            className="w-full px-3 py-2 rounded-lg text-sm font-medium transition-all text-left flex items-center space-x-2 disabled:cursor-not-allowed hover:enabled:scale-[1.02]"
            style={{
              backgroundColor: status.isRunning
                ? "#4752C4"
                : colors.bg.tertiary,
              color: status.isRunning ? "white" : colors.text.muted,
              opacity: status.isRunning ? 1 : 0.6
            }}
          >
            <span className="text-lg">🌐</span>
            <div>
              <div className="font-medium text-sm">{t('quickActions.webUI')}</div>
              <div className="text-[10px] opacity-80">
                {status.isRunning
                  ? t('quickActions.accessViaBrowser')
                  : t('quickActions.startToAccess')}
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
