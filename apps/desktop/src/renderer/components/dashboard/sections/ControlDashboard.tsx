import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquare, Hash, Clock, Activity, Loader2, Zap, Settings } from 'lucide-react'
import { ColorTheme } from '../types'

interface ControlDashboardProps {
  colors: ColorTheme
  status: any
  startOpenClaw: () => Promise<void>
  stopOpenClaw: () => Promise<void>
  setActiveChannel: (channel: string) => void
  setSelectedServer: (server: string) => void
}

export const ControlDashboard: React.FC<ControlDashboardProps> = ({
  colors,
  status,
  startOpenClaw,
  stopOpenClaw,
  setActiveChannel,
  setSelectedServer
}) => {
  const { t } = useTranslation()
  const [isStarting, setIsStarting] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const [statistics, setStatistics] = useState({
    messagesToday: 0,
    activeChannels: 0,
    responseTime: '0ms',
    uptime: '0%',
    trend: {
      messagesToday: 0,
      activeChannels: 0,
      responseTime: 0,
      uptime: 0
    }
  })
  const [loadingStats, setLoadingStats] = useState(true)

  const fetchStatistics = async () => {
    try {
      const result = await window.electronAPI.getDashboardStatistics()
      if (result.success && result.statistics) {
        setStatistics(result.statistics)
      }
    } catch (error) {
      console.error('Failed to fetch dashboard statistics:', error)
    } finally {
      setLoadingStats(false)
    }
  }

  useEffect(() => {
    fetchStatistics()
    const interval = setInterval(fetchStatistics, 10000)
    return () => clearInterval(interval)
  }, [])

  const quickActions = [
    {
      label: t('quickActions.chatWithAI'),
      icon: MessageSquare,
      color: colors.accent.brand,
      onClick: () => {
        setSelectedServer("main")
        setActiveChannel("assistant")
      },
      description: t('quickActions.chatWithAIDesc')
    },
    {
      label: t('quickActions.manageChannels'),
      icon: Hash,
      color: colors.accent.green,
      onClick: () => {
        setSelectedServer("channels")
        setActiveChannel("whatsapp")
      },
      description: t('quickActions.manageChannelsDesc')
    },
    {
      label: t('quickActions.aiConfiguration'),
      icon: Settings,
      color: colors.accent.purple,
      onClick: () => {
        setSelectedServer("aiconfig")
        setActiveChannel("aiconfig")
      },
      description: t('quickActions.aiConfigurationDesc')
    }
  ]

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mb-6">
        <h2
          className="text-3xl font-bold mb-2 flex items-center gap-3"
          style={{ color: colors.text.header }}
        >
          <Zap className="h-8 w-8" style={{ color: colors.accent.brand }} />
          {t('controlDashboard.title')}
        </h2>
        <p
          className="text-lg mb-6"
          style={{ color: colors.text.muted }}
        >
          {t('controlDashboard.subtitle')}
        </p>

        {/* Primary Control Panel */}
        <div
          className="rounded-lg p-6 mb-6"
          style={{ backgroundColor: colors.bg.secondary }}
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3
                className="text-xl font-semibold mb-1 flex items-center gap-2"
                style={{ color: colors.text.header }}
              >
                <div
                  className={`h-3 w-3 rounded-full ${
                    status.isRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-500'
                  }`}
                />
                {t('controlDashboard.assistantStatus')}
              </h3>
              <p
                className="text-sm"
                style={{ color: colors.text.muted }}
              >
                {status.isRunning
                  ? t('controlDashboard.onlineReady')
                  : t('controlDashboard.offlineClick')}
              </p>
            </div>
            <div
              className={`px-4 py-2 rounded-full font-semibold text-sm ${
                status.isRunning
                  ? "bg-green-500/20 text-green-400"
                  : "bg-gray-600/20 text-gray-400"
              }`}
            >
              {status.isRunning ? t('common.online') : t('common.offline')}
            </div>
          </div>

          <div className="flex gap-3">
            {status.isRunning ? (
              <button
                onClick={async () => {
                  setIsStopping(true)
                  try {
                    await stopOpenClaw()
                  } finally {
                    setIsStopping(false)
                  }
                }}
                disabled={isStopping}
                className="px-6 py-3 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center space-x-2"
                style={{
                  backgroundColor: colors.accent.red,
                  color: "white",
                }}
              >
                {isStopping && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>{isStopping ? t('common.stopping') : t('general.stopAssistant')}</span>
              </button>
            ) : (
              <button
                onClick={async () => {
                  setIsStarting(true)
                  try {
                    await startOpenClaw()
                    setTimeout(() => {
                      setSelectedServer("main")
                      setActiveChannel("assistant")
                    }, 1000)
                  } finally {
                    setIsStarting(false)
                  }
                }}
                disabled={isStarting}
                className="px-6 py-3 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center space-x-2"
                style={{
                  backgroundColor: colors.accent.brand,
                  color: "white",
                }}
              >
                {isStarting && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>{isStarting ? t('common.starting') : t('general.startAssistant')}</span>
              </button>
            )}

            {status.isRunning && (
              <button
                onClick={() => {
                  setSelectedServer("main")
                  setActiveChannel("chat")
                }}
                className="px-6 py-3 rounded-lg font-medium transition-colors border"
                style={{
                  borderColor: colors.accent.brand,
                  color: colors.accent.brand,
                  backgroundColor: 'transparent'
                }}
              >
                {t('quickActions.openChat')}
              </button>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="mb-6">
          <h3
            className="text-lg font-semibold mb-4"
            style={{ color: colors.text.header }}
          >
            {t('quickActions.title')}
          </h3>
          <div className="grid grid-cols-3 gap-4">
            {quickActions.map((action, i) => (
              <button
                key={i}
                onClick={action.onClick}
                className="p-4 rounded-lg transition-all hover:scale-105 text-left"
                style={{ backgroundColor: colors.bg.secondary }}
              >
                <action.icon
                  className="h-6 w-6 mb-3"
                  style={{ color: action.color }}
                />
                <div
                  className="font-medium mb-1"
                  style={{ color: colors.text.header }}
                >
                  {action.label}
                </div>
                <div
                  className="text-sm"
                  style={{ color: colors.text.muted }}
                >
                  {action.description}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Performance Metrics */}
        <div>
          <h3
            className="text-lg font-semibold mb-4"
            style={{ color: colors.text.header }}
          >
            {t('metrics.title')}
          </h3>
          <div className="grid grid-cols-4 gap-4">
            {[
              {
                label: t('metrics.messagesToday'),
                value: loadingStats ? "..." : statistics.messagesToday.toString(),
                icon: MessageSquare,
                color: colors.accent.brand,
                trend: statistics.trend.messagesToday
              },
              {
                label: t('metrics.activeChannels'),
                value: loadingStats ? "..." : statistics.activeChannels.toString(),
                icon: Hash,
                color: colors.accent.green,
                trend: statistics.trend.activeChannels
              },
              {
                label: t('metrics.responseTime'),
                value: loadingStats ? "..." : statistics.responseTime,
                icon: Clock,
                color: colors.accent.purple,
                trend: statistics.trend.responseTime
              },
              {
                label: t('metrics.uptime'),
                value: loadingStats ? "..." : statistics.uptime,
                icon: Activity,
                color: colors.accent.yellow,
                trend: statistics.trend.uptime
              },
            ].map((stat, i) => (
              <div
                key={i}
                className="rounded-lg p-4 transition-transform hover:scale-105"
                style={{ backgroundColor: colors.bg.secondary }}
              >
                <div className="flex items-center justify-between mb-2">
                  <stat.icon
                    className="h-5 w-5"
                    style={{ color: stat.color }}
                  />
                  {!loadingStats && (
                    <span
                      className="text-xs font-medium"
                      style={{
                        color: stat.trend >= 0 ? colors.accent.green : colors.accent.red
                      }}
                    >
                      {stat.trend >= 0 ? '↑' : '↓'} {Math.abs(stat.trend)}%
                    </span>
                  )}
                </div>
                <div
                  className="text-2xl font-bold mb-1"
                  style={{ color: colors.text.header }}
                >
                  {stat.value}
                </div>
                <div
                  className="text-xs"
                  style={{ color: colors.text.muted }}
                >
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}