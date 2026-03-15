import React, { useState, useEffect, useCallback } from 'react'
import { BarChart3, Loader2, RefreshCw, AlertCircle, Zap, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_GATEWAY_PORT } from '../../../../shared/constants'

interface ColorScheme {
  bg: {
    primary: string
    secondary: string
    tertiary: string
    hover: string
    active: string
  }
  text: {
    normal: string
    muted: string
    header: string
    link: string
    danger: string
  }
  accent: {
    brand: string
    green: string
    yellow: string
    red: string
    purple: string
  }
}

interface UsageSectionProps {
  colors: ColorScheme
  gatewayPort?: number
}

interface UsageStats {
  totalInputTokens: number
  totalOutputTokens: number
  totalSessions: number
  estimatedCost: number
  models: { name: string; inputTokens: number; outputTokens: number }[]
}

export function UsageSection({ colors, gatewayPort = DEFAULT_GATEWAY_PORT }: UsageSectionProps) {
  const { t } = useTranslation()
  const [stats, setStats] = useState<UsageStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Attempt to gather usage data from the gateway via sessions list
  const fetchUsage = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      // Use the electronAPI to get session data, which includes token counts
      const result = await window.electronAPI?.listSessions?.()

      if (result?.success && result.sessions) {
        const sessions = result.sessions as any[]
        let totalInput = 0
        let totalOutput = 0
        const modelMap = new Map<string, { inputTokens: number; outputTokens: number }>()

        for (const session of sessions) {
          const inp = session.inputTokens || 0
          const out = session.outputTokens || 0
          totalInput += inp
          totalOutput += out

          // Aggregate by model if available
          const model = session.model || 'unknown'
          const existing = modelMap.get(model) || { inputTokens: 0, outputTokens: 0 }
          existing.inputTokens += inp
          existing.outputTokens += out
          modelMap.set(model, existing)
        }

        const models = Array.from(modelMap.entries())
          .map(([name, data]) => ({ name, ...data }))
          .filter((m) => m.inputTokens > 0 || m.outputTokens > 0)
          .sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens))

        // Rough cost estimate: ~$3/1M input, ~$15/1M output (Claude Sonnet pricing)
        const estimatedCost = (totalInput / 1_000_000) * 3 + (totalOutput / 1_000_000) * 15

        setStats({
          totalInputTokens: totalInput,
          totalOutputTokens: totalOutput,
          totalSessions: sessions.length,
          estimatedCost,
          models,
        })
      } else {
        // Graceful fallback — gateway may not support usage data yet
        setStats(null)
        setError('Usage data is not available. Make sure the gateway is running.')
      }
    } catch (err: any) {
      setStats(null)
      setError(err.message || 'Failed to fetch usage data')
    } finally {
      setLoading(false)
    }
  }, [gatewayPort])

  useEffect(() => {
    fetchUsage()
  }, [fetchUsage])

  const formatTokens = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return n.toLocaleString()
  }

  const formatCost = (n: number): string => {
    if (n < 0.01) return '< $0.01'
    return `$${n.toFixed(2)}`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: colors.text.muted }} />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div
        className="flex-shrink-0 px-6 py-4 border-b flex items-center justify-between"
        style={{ borderColor: colors.bg.tertiary, backgroundColor: colors.bg.secondary }}
      >
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-bold" style={{ color: colors.text.header }}>
            {t('usage.title')}
          </h2>
          <p className="text-sm" style={{ color: colors.text.muted }}>
            {t('usage.subtitle')}
          </p>
        </div>
        <button
          onClick={fetchUsage}
          className="p-2 rounded-lg transition-colors"
          style={{ color: colors.text.muted }}
          title={t('common.refresh')}
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Error state */}
      {error && !stats && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md px-6">
            <AlertCircle className="h-10 w-10 mx-auto mb-3" style={{ color: colors.text.muted }} />
            <h3 className="text-base font-semibold mb-2" style={{ color: colors.text.header }}>
              {t('usage.unavailable')}
            </h3>
            <p className="text-sm" style={{ color: colors.text.muted }}>
              {error}
            </p>
            <button
              onClick={fetchUsage}
              className="mt-4 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              style={{ backgroundColor: colors.accent.brand, color: '#ffffff' }}
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Stats content */}
      {stats && (
        <div className="px-6 py-6 space-y-6">
          {/* Stat cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              colors={colors}
              icon={<Zap className="h-5 w-5" />}
              iconColor={colors.accent.yellow}
              label={t('usage.inputTokens')}
              value={formatTokens(stats.totalInputTokens)}
            />
            <StatCard
              colors={colors}
              icon={<Zap className="h-5 w-5" />}
              iconColor={colors.accent.green}
              label={t('usage.outputTokens')}
              value={formatTokens(stats.totalOutputTokens)}
            />
            <StatCard
              colors={colors}
              icon={<MessageSquare className="h-5 w-5" />}
              iconColor={colors.accent.purple}
              label={t('usage.sessions')}
              value={stats.totalSessions.toLocaleString()}
            />
            <StatCard
              colors={colors}
              icon={<BarChart3 className="h-5 w-5" />}
              iconColor={colors.accent.brand}
              label={t('usage.estCost')}
              value={formatCost(stats.estimatedCost)}
            />
          </div>

          {/* Model breakdown */}
          {stats.models.length > 0 && (
            <div
              className="rounded-lg border"
              style={{ borderColor: colors.bg.tertiary, backgroundColor: colors.bg.secondary }}
            >
              <div className="px-4 py-3 border-b" style={{ borderColor: colors.bg.tertiary }}>
                <h3 className="text-sm font-semibold" style={{ color: colors.text.header }}>
                  {t('usage.perModel')}
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${colors.bg.tertiary}` }}>
                      <th className="text-left px-4 py-2 font-medium" style={{ color: colors.text.muted }}>
                        {t('usage.model')}
                      </th>
                      <th className="text-right px-4 py-2 font-medium" style={{ color: colors.text.muted }}>
                        {t('usage.inputTokens')}
                      </th>
                      <th className="text-right px-4 py-2 font-medium" style={{ color: colors.text.muted }}>
                        {t('usage.outputTokens')}
                      </th>
                      <th className="text-right px-4 py-2 font-medium" style={{ color: colors.text.muted }}>
                        {t('usage.total')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.models.map((model) => (
                      <tr
                        key={model.name}
                        style={{ borderBottom: `1px solid ${colors.bg.tertiary}` }}
                      >
                        <td className="px-4 py-2.5 font-mono text-xs" style={{ color: colors.text.normal }}>
                          {model.name}
                        </td>
                        <td className="px-4 py-2.5 text-right" style={{ color: colors.text.normal }}>
                          {formatTokens(model.inputTokens)}
                        </td>
                        <td className="px-4 py-2.5 text-right" style={{ color: colors.text.normal }}>
                          {formatTokens(model.outputTokens)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium" style={{ color: colors.text.header }}>
                          {formatTokens(model.inputTokens + model.outputTokens)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Token breakdown bar */}
          {(stats.totalInputTokens > 0 || stats.totalOutputTokens > 0) && (
            <div
              className="rounded-lg border p-4"
              style={{ borderColor: colors.bg.tertiary, backgroundColor: colors.bg.secondary }}
            >
              <h3 className="text-sm font-semibold mb-3" style={{ color: colors.text.header }}>
                {t('usage.tokenDistribution')}
              </h3>
              <div className="h-4 rounded-full overflow-hidden flex" style={{ backgroundColor: colors.bg.tertiary }}>
                {stats.totalInputTokens > 0 && (
                  <div
                    className="h-full"
                    style={{
                      width: `${(stats.totalInputTokens / (stats.totalInputTokens + stats.totalOutputTokens)) * 100}%`,
                      backgroundColor: colors.accent.yellow,
                    }}
                  />
                )}
                {stats.totalOutputTokens > 0 && (
                  <div
                    className="h-full"
                    style={{
                      width: `${(stats.totalOutputTokens / (stats.totalInputTokens + stats.totalOutputTokens)) * 100}%`,
                      backgroundColor: colors.accent.green,
                    }}
                  />
                )}
              </div>
              <div className="flex items-center gap-4 mt-2 text-xs" style={{ color: colors.text.muted }}>
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded" style={{ backgroundColor: colors.accent.yellow }} />
                  <span>Input ({formatTokens(stats.totalInputTokens)})</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded" style={{ backgroundColor: colors.accent.green }} />
                  <span>Output ({formatTokens(stats.totalOutputTokens)})</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatCard({
  colors,
  icon,
  iconColor,
  label,
  value,
}: {
  colors: any
  icon: React.ReactNode
  iconColor: string
  label: string
  value: string
}) {
  return (
    <div
      className="rounded-lg border p-4"
      style={{ borderColor: colors.bg.tertiary, backgroundColor: colors.bg.secondary }}
    >
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg" style={{ backgroundColor: iconColor + '20', color: iconColor }}>
          {icon}
        </div>
        <div>
          <p className="text-xs" style={{ color: colors.text.muted }}>
            {label}
          </p>
          <p className="text-xl font-bold" style={{ color: colors.text.header }}>
            {value}
          </p>
        </div>
      </div>
    </div>
  )
}
