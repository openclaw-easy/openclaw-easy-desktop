import React from "react";
import { useTranslation } from 'react-i18next';
import { MessageSquare, Settings, Wrench, Hash, Loader2, Rocket, Clock, Terminal, Bot, Info } from "lucide-react";
import { SectionHeader } from '../../ui/section-header';
import { MascotIllustration } from '../../ui/mascot-illustration';
import { DEFAULT_GATEWAY_PORT } from '../../../../shared/constants';
import type { ColorTheme } from '../types';

// Local alias for back-compat with the prop name. Was a duplicated
// interface declaration until the 2026-06-15 ColorTheme dedup pass.
type ColorScheme = ColorTheme;

interface AppStatus {
  isRunning: boolean;
  /**
   * Explicit lifecycle status from the main process. Renderer needs
   * this to distinguish 'error' (failed to start / gave up restarting)
   * from 'stopped' (clean stop) — the legacy isRunning boolean collapsed
   * both into "not running" and the Launch button would spin forever.
   */
  status?: 'stopped' | 'starting' | 'running' | 'error';
  port?: number;
  pid?: number | null;
  gatewayMode?: 'external' | 'system' | 'bundled';
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
  /** Open the Cmd+K command palette. Drives the small hint chip in the
   *  section header so users discover the shortcut. */
  onOpenCommandPalette?: () => void;
}

export function QuickActionsSection({
                                      colors,
                                      status,
                                      startOpenClaw,
                                      stopOpenClaw,
                                      setSelectedServer,
                                      setActiveChannel,
                                      onOpenCommandPalette,
                                    }: QuickActionsSectionProps) {
  const { t } = useTranslation();
  const [isLaunching, setIsLaunching] = React.useState(false);
  const [isStopping, setIsStopping] = React.useState(false);
  const launchRequestedRef = React.useRef(false);
  const watchdogRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLaunching = React.useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    launchRequestedRef.current = false;
    setIsLaunching(false);
  }, []);

  // Clear launching state once the gateway actually comes online, not when the
  // IPC call returns — startOpenClaw() resolves as soon as the process starts,
  // but the gateway takes several more seconds to become ready. Also clear
  // when the main process reports 'error' (failed to start, gave up
  // auto-restarting) — otherwise the button stays disabled forever.
  React.useEffect(() => {
    if (!launchRequestedRef.current) return;
    if (status.isRunning || status.status === 'error') {
      clearLaunching();
    }
  }, [status.isRunning, status.status, clearLaunching]);

  // Belt-and-suspenders watchdog. If the IPC promise resolved but the
  // gateway never reached 'running' AND never reported 'error' (e.g.
  // main process crashed mid-start, status snapshot stale), recover
  // the UI after 90s. 60s is the in-main start budget; +30s slack.
  React.useEffect(() => () => {
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
  }, []);

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
    // Watchdog: if neither status.isRunning nor status.status==='error'
    // settles within 90s, force-clear the button so the user can retry.
    // Without this, a stale main-process state can pin the button to
    // "Launching..." indefinitely.
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    watchdogRef.current = setTimeout(() => {
      console.warn("[QuickActions] Launch watchdog fired after 90s — clearing button state");
      clearLaunching();
    }, 90_000);

    try {
      await startOpenClaw();
      // isLaunching stays true — the useEffect above will clear it once
      // status.isRunning becomes true (gateway is actually ready) or
      // status.status becomes 'error'.
    } catch (error) {
      console.error("❌ [QuickActions] startOpenClaw failed:", error);
      clearLaunching();
    }
  };

  // Detect the right modifier key glyph for the platform. Mac shows ⌘,
  // Windows/Linux show Ctrl. Stable for the lifetime of the renderer.
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
  const modifier = isMac ? '⌘' : 'Ctrl'

  return (
    <div className="flex flex-col h-full">
      <SectionHeader
        title={t('quickActions.title')}
        subtitle={t('quickActions.subtitle')}
        colors={colors}
        border={false}
        actions={
          onOpenCommandPalette ? (
            <button
              type="button"
              onClick={onOpenCommandPalette}
              className="press-pulse ripple-glow flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors hover:bg-white/5"
              style={{ color: colors.text.muted }}
              title={`Press ${modifier}K to search and run any command`}
              aria-label="Open command palette"
            >
              <Info size={12} />
              <span>Tip</span>
              <kbd
                className="px-1.5 py-0.5 rounded text-[10px] font-mono leading-none"
                style={{
                  backgroundColor: colors.bg.tertiary,
                  color: colors.text.normal,
                  border: `1px solid ${colors.bg.hover}`,
                }}
              >
                {modifier}K
              </kbd>
            </button>
          ) : undefined
        }
      />

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-4">
        {/* Assistant Status Card — the hero of the first screen. */}
        <div
          className="rounded-xl p-5 shadow-sm ring-1 ring-black/[0.04] dark:ring-white/[0.06]"
          style={{ backgroundColor: colors.bg.secondary }}
        >
          <div className="flex items-center justify-between mb-3">
            <h4
              className="font-display text-base font-semibold tracking-tight"
              style={{ color: colors.text.header }}
            >
              {t('quickActions.assistantStatus')}
            </h4>
            <div className="flex items-center space-x-3">
              {/* Online Status — same pill language as the chat header. */}
              {status.isRunning && (
                <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/10 ring-1 ring-green-500/20">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-40" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                  </span>
                  <span className="text-xs font-medium text-green-700 dark:text-green-400">{t('common.online')}</span>
                </div>
              )}
            </div>
          </div>

          {status.isRunning ? (
            <div className="space-y-3">
              {/* Gateway Info */}
              <div
                className="rounded-lg p-3 ring-1 ring-black/[0.03] dark:ring-white/[0.04]"
                style={{ backgroundColor: colors.bg.tertiary }}
              >
                <div className="flex items-center space-x-2 mb-2.5">
                  <div className="h-2.5 w-2.5 bg-green-500 rounded-full animate-pulse" />
                  <span
                    className="text-xs font-semibold"
                    style={{ color: colors.accent.green }}
                  >
                    {t('quickActions.gatewayActive')}
                  </span>
                </div>
                <div
                  className="flex items-center flex-wrap gap-2 text-xs"
                  style={{ color: colors.text.muted }}
                >
                  <span className="px-2 py-0.5 rounded-md font-mono text-[11px] bg-black/[0.04] dark:bg-white/[0.05]">
                    {t('quickActions.gatewayPort', { port: status.port || DEFAULT_GATEWAY_PORT })}
                  </span>
                  {/* Show the real PID when we own the process. In external
                      mode the gateway is launchd-managed (or already running)
                      so we don't have a PID handle — say "External" instead
                      of fabricating a placeholder. */}
                  {typeof status.pid === 'number' ? (
                    <span className="px-2 py-0.5 rounded-md font-mono text-[11px] bg-black/[0.04] dark:bg-white/[0.05]">
                      {t('quickActions.processId', { pid: status.pid })}
                    </span>
                  ) : status.gatewayMode === 'external' ? (
                    <span className="px-2 py-0.5 rounded-md font-mono text-[11px] bg-black/[0.04] dark:bg-white/[0.05]">
                      External gateway
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2">
                <button
                  onClick={handleStop}
                  disabled={isStopping}
                  className="press-pulse ripple-glow flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all hover:-translate-y-px hover:shadow-[0_0_18px_rgba(220,38,38,0.35)] active:translate-y-0 flex items-center justify-center space-x-2"
                  style={{
                    backgroundColor: colors.button.destructive,
                    color: colors.button.destructiveFg,
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
                  className="press-pulse ripple-glow flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all hover:-translate-y-px hover:shadow-glow active:translate-y-0"
                  style={{
                    backgroundColor: colors.button.primary,
                    color: colors.button.primaryFg
                  }}
                >
                  {t('quickActions.openChat')}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <MascotIllustration size={40} mood={isLaunching ? 'thinking' : 'napping'} />
                <p className="text-xs" style={{ color: colors.text.muted }}>
                  {t('quickActions.assistantOffline')}
                </p>
              </div>
              <button
                onClick={handleStart}
                disabled={isLaunching}
                className="press-pulse ripple-glow w-full px-3 py-2.5 rounded-xl text-sm font-semibold transition-all hover:-translate-y-px hover:shadow-glow active:translate-y-0 flex items-center justify-center space-x-2"
                style={{
                  backgroundColor: colors.button.primary,
                  color: colors.button.primaryFg,
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
          className="rounded-xl p-5 shadow-sm ring-1 ring-black/[0.04] dark:ring-white/[0.06]"
          style={{ backgroundColor: colors.bg.secondary }}
        >
          <h4
            className="font-display text-base font-semibold mb-3 tracking-tight"
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
              className="press-pulse ripple-glow p-3 rounded-lg transition-all hover:-translate-y-0.5 hover:shadow-glow text-left border border-transparent hover:border-brand-400/30"
              style={{ backgroundColor: colors.bg.tertiary }}
            >
              <Rocket className="h-5 w-5 mb-1.5" style={{ color: colors.accent.yellow }} />
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
              className="press-pulse ripple-glow p-3 rounded-lg transition-all hover:-translate-y-0.5 hover:shadow-glow text-left border border-transparent hover:border-brand-400/30"
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
              className="press-pulse ripple-glow p-3 rounded-lg transition-all hover:-translate-y-0.5 hover:shadow-glow text-left border border-transparent hover:border-brand-400/30"
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
              className="press-pulse ripple-glow p-3 rounded-lg transition-all hover:-translate-y-0.5 hover:shadow-glow text-left border border-transparent hover:border-brand-400/30"
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
              className="press-pulse ripple-glow p-3 rounded-lg transition-all hover:-translate-y-0.5 hover:shadow-glow text-left border border-transparent hover:border-brand-400/30"
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
              className="press-pulse ripple-glow p-3 rounded-lg transition-all hover:-translate-y-0.5 hover:shadow-glow text-left border border-transparent hover:border-brand-400/30"
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
              className="press-pulse ripple-glow p-3 rounded-lg transition-all hover:-translate-y-0.5 hover:shadow-glow text-left border border-transparent hover:border-brand-400/30"
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
              className="press-pulse ripple-glow p-3 rounded-lg transition-all hover:-translate-y-0.5 hover:shadow-glow text-left border border-transparent hover:border-brand-400/30"
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
          className="rounded-xl p-5 shadow-sm ring-1 ring-black/[0.04] dark:ring-white/[0.06]"
          style={{ backgroundColor: colors.bg.secondary }}
        >
          <h4
            className="font-display text-base font-semibold mb-3 tracking-tight"
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
            className="press-pulse ripple-glow w-full px-3 py-2 rounded-lg text-sm font-medium transition-all text-left flex items-center space-x-2 disabled:cursor-not-allowed hover:enabled:-translate-y-px hover:enabled:shadow-glow active:enabled:translate-y-0"
            style={{
              backgroundColor: status.isRunning
                ? colors.accent.indigo || colors.accent.purple
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
