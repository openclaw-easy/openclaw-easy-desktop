import React from 'react'
import { useTranslation } from 'react-i18next'

interface ColorScheme {
  bg: { secondary: string; tertiary: string }
  text: { normal: string; muted: string; header: string }
  accent: { brand: string; yellow: string }
}

interface UpdateBannerProps {
  latestVersion: string
  releaseDate: string
  onDownload: () => void
  onDismiss: () => void
  colors: ColorScheme
}

export function UpdateBanner({ latestVersion, releaseDate, onDownload, onDismiss, colors }: UpdateBannerProps) {
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
      className="px-4 py-2 flex items-center justify-between text-sm flex-shrink-0"
      style={{
        backgroundColor: colors.accent.yellow + '22',
        borderBottom: `1px solid ${colors.accent.yellow}44`,
      }}
    >
      <span style={{ color: colors.text.normal }}>
        🔔 {t('updateBanner.available', { version: latestVersion })}
        <span style={{ color: colors.text.muted }}> — {t('updateBanner.released', { date: formattedDate })}</span>
      </span>
      <div className="flex items-center gap-3 ml-4 flex-shrink-0">
        <button
          onClick={onDownload}
          className="font-medium hover:underline"
          style={{ color: colors.accent.brand }}
        >
          {t('settings.download')}
        </button>
        <button
          onClick={onDismiss}
          className="hover:underline"
          style={{ color: colors.text.muted }}
        >
          {t('updateBanner.later')}
        </button>
      </div>
    </div>
  )
}
