import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare, Hash, Zap, CheckCircle, TrendingUp, TrendingDown, Calendar, Users, Database, CalendarDays } from 'lucide-react';

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

interface MetricsSectionProps {
  colors: ColorScheme;
}

interface Metric {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  iconColor: string;
  trend?: number;
  trendLabel?: string;
}

export function MetricsSection({ colors }: MetricsSectionProps) {
  const { t } = useTranslation();
  const [metrics, setMetrics] = useState<Metric[]>([
    {
      label: t('metrics.messagesToday'),
      value: '...',
      icon: MessageSquare,
      iconColor: colors.accent.brand,
      trend: 0,
      trendLabel: t('metrics.daily'),
    },
    {
      label: t('metrics.messagesThisWeek'),
      value: '...',
      icon: CalendarDays,
      iconColor: colors.accent.purple,
      trend: 0,
      trendLabel: t('metrics.weekly'),
    },
    {
      label: t('metrics.activeChannels'),
      value: '...',
      icon: Hash,
      iconColor: colors.accent.green,
      trend: 0,
      trendLabel: t('common.connected'),
    },
    {
      label: t('metrics.totalSessions'),
      value: '...',
      icon: Users,
      iconColor: colors.accent.brand,
      trend: 0,
      trendLabel: t('metrics.allTime'),
    },
    {
      label: t('metrics.activeSessions'),
      value: '...',
      icon: Calendar,
      iconColor: colors.accent.yellow,
      trend: 0,
      trendLabel: t('metrics.today'),
    },
    {
      label: t('metrics.totalTokens'),
      value: '...',
      icon: Database,
      iconColor: colors.accent.purple,
      trend: 0,
      trendLabel: 'Usage',
    },
    {
      label: t('metrics.responseTime'),
      value: '...',
      icon: Zap,
      iconColor: colors.accent.yellow,
      trend: 0,
      trendLabel: t('metrics.speed'),
    },
    {
      label: t('metrics.uptime'),
      value: '...',
      icon: CheckCircle,
      iconColor: colors.accent.green,
      trend: 0,
      trendLabel: t('metrics.reliability'),
    },
  ]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadMetrics = async () => {
      try {
        console.log('[MetricsSection] Loading metrics...');
        const stats = await window.electronAPI?.getDashboardStatistics?.();
        console.log('[MetricsSection] Stats received:', stats);

        if (stats?.success && stats.statistics) {
          setMetrics([
            {
              label: t('metrics.messagesToday'),
              value: stats.statistics.messagesToday.toLocaleString(),
              icon: MessageSquare,
              iconColor: colors.accent.brand,
              trend: stats.statistics.trend.messagesToday,
              trendLabel: t('metrics.daily'),
            },
            {
              label: t('metrics.messagesThisWeek'),
              value: stats.statistics.messagesThisWeek.toLocaleString(),
              icon: CalendarDays,
              iconColor: colors.accent.purple,
              trend: stats.statistics.trend.messagesThisWeek,
              trendLabel: t('metrics.weekly'),
            },
            {
              label: t('metrics.activeChannels'),
              value: stats.statistics.activeChannels,
              icon: Hash,
              iconColor: colors.accent.green,
              trend: stats.statistics.trend.activeChannels,
              trendLabel: t('common.connected'),
            },
            {
              label: t('metrics.totalSessions'),
              value: stats.statistics.totalSessions.toLocaleString(),
              icon: Users,
              iconColor: colors.accent.brand,
              trend: stats.statistics.trend.totalSessions,
              trendLabel: t('metrics.allTime'),
            },
            {
              label: t('metrics.activeSessions'),
              value: stats.statistics.activeSessions.toLocaleString(),
              icon: Calendar,
              iconColor: colors.accent.yellow,
              trend: stats.statistics.trend.activeSessions,
              trendLabel: t('metrics.today'),
            },
            {
              label: t('metrics.totalTokens'),
              value: (stats.statistics.totalTokens / 1000).toFixed(1) + 'K',
              icon: Database,
              iconColor: colors.accent.purple,
              trend: stats.statistics.trend.totalTokens,
              trendLabel: 'Usage',
            },
            {
              label: t('metrics.responseTime'),
              value: stats.statistics.responseTime,
              icon: Zap,
              iconColor: colors.accent.yellow,
              trend: stats.statistics.trend.responseTime,
              trendLabel: t('metrics.speed'),
            },
            {
              label: t('metrics.uptime'),
              value: stats.statistics.uptime,
              icon: CheckCircle,
              iconColor: colors.accent.green,
              trend: stats.statistics.trend.uptime,
              trendLabel: t('metrics.reliability'),
            },
          ]);
        } else {
          console.warn('[MetricsSection] No statistics data received');
        }
      } catch (error) {
        console.error('[MetricsSection] Failed to load metrics:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadMetrics();
    // Refresh metrics every 30 seconds
    const interval = setInterval(loadMetrics, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-4 pb-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-lg font-bold" style={{ color: colors.text.header }}>
            {t('metrics.title')}
          </h3>
          <p className="text-xs" style={{ color: colors.text.muted }}>
            {t('metrics.subtitle')}
          </p>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-3">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {metrics.map((metric, index) => (
            <div
              key={index}
              className="rounded-lg px-4 py-6"
              style={{ backgroundColor: colors.bg.secondary }}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2">
                  <metric.icon className="h-4 w-4" style={{ color: metric.iconColor }} />
                  <span className="text-xs font-medium" style={{ color: colors.text.muted }}>
                    {metric.label}
                  </span>
                </div>
                {metric.trend !== undefined && (
                  <div className="flex items-center space-x-1">
                    {metric.trend >= 0 ? (
                      <TrendingUp className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <TrendingDown className="h-3.5 w-3.5 text-red-500" />
                    )}
                    <span
                      className="text-[10px] font-medium"
                      style={{ color: metric.trend >= 0 ? '#22c55e' : '#ef4444' }}
                    >
                      {metric.trend > 0 ? '+' : ''}{metric.trend}%
                    </span>
                  </div>
                )}
              </div>

              {/* Value */}
              <div className="mb-2">
                <div className="text-3xl font-bold" style={{ color: colors.text.header }}>
                  {metric.value}
                </div>
              </div>

              {/* Trend Label */}
              {metric.trendLabel && (
                <div className="flex items-center space-x-2">
                  <div
                    className="h-1 flex-1 rounded-full"
                    style={{ backgroundColor: colors.bg.tertiary }}
                  >
                    <div
                      className="h-1 rounded-full transition-all"
                      style={{
                        backgroundColor: metric.iconColor,
                        width: `${Math.min(Math.abs(metric.trend || 0) * 10, 100)}%`,
                      }}
                    />
                  </div>
                  <span className="text-[10px]" style={{ color: colors.text.muted }}>
                    {metric.trendLabel}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Additional Info */}
        <div
          className="mt-3 rounded-lg p-2"
          style={{ backgroundColor: colors.bg.secondary }}
        >
          <p className="text-[9px] text-center" style={{ color: colors.text.muted }}>
            {t('metrics.updatedEvery')} • Last updated: {new Date().toLocaleTimeString()}
          </p>
        </div>
      </div>
    </div>
  );
}
