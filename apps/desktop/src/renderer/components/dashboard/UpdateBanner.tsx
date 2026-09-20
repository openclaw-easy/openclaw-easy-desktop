import React from 'react'
import { useTranslation } from 'react-i18next'
import type { ColorTheme } from './types'

// Local alias for back-compat with the prop name. Was a duplicated
// interface declaration until the 2026-06-15 ColorTheme dedup pass.
type ColorScheme = ColorTheme

interface UpdateBannerProps {
  latestVersion: string
  releaseDate: string
  onDownload: () => void
  onDismiss: () => void
  colors: ColorScheme
  /** Consented update flow state; omitted by callers that only notify. */
  phase?: 'idle' | 'available' | 'downloading' | 'downloaded' | 'error'
  percent?: number
  error?: string | null
  onInstall?: () => void
}

export function UpdateBanner({
  latestVersion,
  releaseDate,
  onDownload,
  onDismiss,
  colors,
  phase = 'available',
  percent = 0,
  error = null,
  onInstall,
}: UpdateBannerProps) {
  const { t } = useTranslation()
  const formattedDate = (() => {
    try {
      return new Date(releaseDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    } catch {
      return releaseDate
    }
  })()

  return (
    <div
      className="animate-fade-up px-4 py-2 flex items-center justify-between text-sm flex-shrink-0"
      style={{
        backgroundColor: colors.accent.yellow + '22',
        borderBottom: `1px solid ${colors.accent.yellow}44`,
      }}
    >
      <span style={{ color: colors.text.normal }}>
        🔔 {t('updateBanner.available', { version: latestVersion })}
        <span style={{ color: colors.text.muted }}> — {t('updateBanner.released', { date: formattedDate })}</span>
      </span>
      <div className="flex items-center gap-2 ml-4 flex-shrink-0">
        {/* Nothing downloads or installs without one of these clicks. */}
        {phase === 'downloading' && (
          <span className="text-xs tabular-nums" style={{ color: colors.text.muted }}>
            {t('updateBanner.downloading', 'Downloading… {{percent}}%', { percent })}
          </span>
        )}
        {phase === 'error' && (
          <span className="text-xs truncate max-w-[22rem]" title={error ?? undefined} style={{ color: colors.accent.yellow }}>
            {t('updateBanner.failed', 'Update failed — {{message}}', { message: error ?? '' })}
          </span>
        )}
        {phase === 'downloaded' && onInstall ? (
          <button
            onClick={onInstall}
            className="press-pulse ripple-glow px-3 py-1 rounded-md text-xs font-medium transition-all hover:-translate-y-px hover:shadow-glow active:translate-y-0"
            style={{ backgroundColor: colors.accent.brand, color: colors.button.primaryFg }}
          >
            {t('updateBanner.restartToInstall', 'Restart to install')}
          </button>
        ) : (
          phase !== 'downloading' && (
            <button
              onClick={onDownload}
              className="press-pulse ripple-glow px-3 py-1 rounded-md text-xs font-medium transition-all hover:-translate-y-px hover:shadow-glow active:translate-y-0"
              style={{ backgroundColor: colors.accent.brand, color: colors.button.primaryFg }}
            >
              {phase === 'error'
                ? t('updateBanner.retry', 'Retry')
                : t('settings.download')}
            </button>
          )
        )}
        <button
          onClick={onDismiss}
          className="press-pulse px-3 py-1 rounded-md text-xs transition-colors hover:bg-white/10"
          style={{ color: colors.text.muted }}
        >
          {t('updateBanner.later')}
        </button>
      </div>
    </div>
  )
}
