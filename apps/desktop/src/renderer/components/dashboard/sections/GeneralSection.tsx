import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquare, Hash, Clock, Activity, Loader2 } from 'lucide-react'
import { ColorTheme } from '../types'

interface GeneralSectionProps {
  colors: ColorTheme
  status: any
  startOpenClaw: () => Promise<void>
  stopOpenClaw: () => Promise<void>
  setActiveChannel: (channel: string) => void
}

export const GeneralSection: React.FC<GeneralSectionProps> = ({
  colors,
  status,
  startOpenClaw,
  stopOpenClaw,
  setActiveChannel
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
    // Refresh statistics every 10 seconds
    const interval = setInterval(fetchStatistics, 10000)
    return () => clearInterval(interval)
  }, [])
  return (
    <div className="p-8">
      {/* Quick Stats - Discord style */}
      <div className="mb-6">
        <h3
          className="text-2xl font-bold mb-4"
          style={{ color: colors.text.header }}
        >
          {t('general.welcomeTitle')} 👋
        </h3>

        {/* Status Card */}
        <div
          className="rounded-lg p-6 mb-4"
          style={{ backgroundColor: colors.bg.secondary }}
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h4
                className="text-lg font-semibold mb-1"
                style={{ color: colors.text.header }}
              >
                {t('general.assistantStatus')}
              </h4>
              <p
                className="text-sm"
                style={{ color: colors.text.muted }}
              >
                {status.isRunning
                  ? t('general.readyToHelp')
                  : t('general.startToBegin')}
              </p>
            </div>
            <div
              className={`px-4 py-2 rounded-full font-semibold ${
                status.isRunning
                  ? "bg-green-500/20 text-green-400"
                  : "bg-gray-600/20 text-gray-400"
              }`}
            >
              {status.isRunning ? t('common.online') : t('common.offline')}
            </div>
          </div>

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
              className="px-6 py-2 rounded font-medium transition-colors disabled:opacity-50 flex items-center space-x-2"
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
                  await startOpenClaw();
                  // Switch to assistant view after starting
                  setTimeout(() => setActiveChannel("assistant"), 1000);
                } finally {
                  setIsStarting(false)
                }
              }}
              disabled={isStarting}
              className="px-6 py-2 rounded font-medium transition-colors disabled:opacity-50 flex items-center space-x-2"
              style={{
                backgroundColor: colors.accent.brand,
                color: "white",
              }}
            >
              {isStarting && <Loader2 className="h-4 w-4 animate-spin" />}
              <span>{isStarting ? t('common.starting') : t('general.startAssistant')}</span>
            </button>
          )}
        </div>

        {/* Stats Grid */}
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
                    className="text-xs"
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
  )
}