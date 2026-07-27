import React, { useCallback, useEffect, useState } from 'react'
import { Camera, Globe, Loader2, Play, Power, RefreshCw, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../../contexts/ToastContext'
import type { ColorTheme } from '../types'

/**
 * Surface for OpenClaw's dedicated browser (the agent `browser` tool):
 * status, enable/disable, start/stop, and a screenshot smoke test so
 * users can see the assistant's browser actually works.
 */

interface BrowserStatus {
  enabled: boolean
  running: boolean
  profile?: string
  detectedBrowser?: string | null
  detectedExecutablePath?: string | null
  chosenBrowser?: string | null
  headless?: boolean
  cdpPort?: number
  pid?: number | null
}

interface Props {
  colors: ColorTheme
}

export function BrowserSection({ colors }: Props) {
  const { t } = useTranslation()
  const { addToast } = useToast()
  const [status, setStatus] = useState<BrowserStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'toggle' | 'start' | 'stop' | 'screenshot' | null>(null)
  const [shot, setShot] = useState<{ path: string; dataUrl?: string } | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const res = await window.electronAPI?.getBrowserStatus?.()
      if (res?.success && res.status) {
        setStatus(res.status)
      } else if (res?.error) {
        addToast(res.error, 'error')
      }
    } finally {
      setLoading(false)
    }
  }, [addToast])

  useEffect(() => {
    load()
  }, [load])

  const run = async (
    kind: 'toggle' | 'start' | 'stop' | 'screenshot',
    fn: () => Promise<{ success: boolean; error?: string } | undefined>,
    successMsg?: string,
  ) => {
    setBusy(kind)
    try {
      const res = await fn()
      if (res?.success) {
        if (successMsg) addToast(successMsg, 'success')
        await load(true)
      } else {
        addToast(res?.error || t('browser.actionFailed', 'Browser action failed'), 'error')
      }
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: colors.text.muted }} />
      </div>
    )
  }

  const statusRow = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-4 text-sm">
      <span style={{ color: colors.text.muted }}>{label}</span>
      <span className="text-right" style={{ color: colors.text.normal }}>{value}</span>
    </div>
  )

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 font-display text-lg font-bold tracking-tight" style={{ color: colors.text.header }}>
            <Globe className="h-5 w-5" />
            {t('browser.title', 'Assistant Browser')}
          </h2>
          <p className="text-sm" style={{ color: colors.text.muted }}>
            {t('browser.subtitle', 'Your assistant can browse the web in its own dedicated browser — fill forms, read pages, take screenshots.')}
          </p>
        </div>
        <button
          onClick={() => load()}
          className="rounded p-2 hover:opacity-80"
          style={{ backgroundColor: colors.bg.tertiary, color: colors.text.normal }}
          aria-label={t('common.refresh', 'Refresh')}
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-4 rounded-lg border p-4" style={{ borderColor: colors.bg.tertiary, backgroundColor: colors.bg.secondary }}>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: status?.running ? colors.accent.green : colors.text.muted }}
            />
            <span className="text-sm font-semibold" style={{ color: colors.text.header }}>
              {status?.running
                ? t('browser.running', 'Running')
                : t('browser.stopped', 'Stopped')}
            </span>
          </div>
          <button
            onClick={() =>
              run('toggle', () => window.electronAPI?.setBrowserEnabled?.(!(status?.enabled ?? true)),
                status?.enabled
                  ? t('browser.disabledToast', 'Browser tool disabled')
                  : t('browser.enabledToast', 'Browser tool enabled'))
            }
            disabled={busy !== null}
            className="flex items-center gap-1 rounded px-3 py-1 text-xs font-medium hover:opacity-80 disabled:opacity-50"
            style={
              status?.enabled
                ? { backgroundColor: colors.button.destructive, color: colors.button.destructiveFg }
                : { backgroundColor: colors.button.primary, color: colors.button.primaryFg }
            }
          >
            <Power className="h-3.5 w-3.5" />
            {status?.enabled
              ? t('browser.disable', 'Disable tool')
              : t('browser.enable', 'Enable tool')}
          </button>
        </div>

        <div className="space-y-1.5">
          {statusRow(
            t('browser.detected', 'Detected browser'),
            status?.detectedBrowser
              ? `${status.detectedBrowser}${status.detectedExecutablePath ? ` (${status.detectedExecutablePath})` : ''}`
              : t('browser.noneDetected', 'None detected'),
          )}
          {statusRow(t('browser.profile', 'Profile'), status?.profile || '—')}
          {status?.running && statusRow('PID', status?.pid ?? '—')}
        </div>
      </div>

      <div className="mb-4 flex gap-2">
        <button
          onClick={() => run('start', () => window.electronAPI?.startBrowser?.(), t('browser.started', 'Browser started'))}
          disabled={busy !== null || status?.running === true || status?.enabled === false}
          className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium hover:opacity-80 disabled:opacity-50"
          style={{ backgroundColor: colors.button.primary, color: colors.button.primaryFg }}
        >
          {busy === 'start' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {t('browser.start', 'Start')}
        </button>
        <button
          onClick={() => run('stop', () => window.electronAPI?.stopBrowser?.(), t('browser.stoppedToast', 'Browser stopped'))}
          disabled={busy !== null || status?.running !== true}
          className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium hover:opacity-80 disabled:opacity-50"
          style={{ backgroundColor: colors.button.destructive, color: colors.button.destructiveFg }}
        >
          {busy === 'stop' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
          {t('browser.stop', 'Stop')}
        </button>
        <button
          onClick={() =>
            run('screenshot', async () => {
              const res = await window.electronAPI?.captureBrowserScreenshot?.()
              if (res?.success && res.path) setShot({ path: res.path, dataUrl: res.dataUrl })
              return res
            })
          }
          disabled={busy !== null || status?.running !== true}
          className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium hover:opacity-80 disabled:opacity-50"
          style={{ backgroundColor: colors.bg.tertiary, color: colors.text.normal }}
        >
          {busy === 'screenshot' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          {t('browser.screenshot', 'Take screenshot')}
        </button>
      </div>

      {status?.enabled === false && (
        <p className="mb-4 text-sm" style={{ color: colors.text.muted }}>
          {t('browser.disabledHint', 'The browser tool is disabled — your assistant cannot browse until you enable it.')}
        </p>
      )}

      {shot && (
        <div className="rounded-lg border p-3" style={{ borderColor: colors.bg.tertiary, backgroundColor: colors.bg.secondary }}>
          <p className="mb-2 break-all font-mono text-xs" style={{ color: colors.text.muted }}>{shot.path}</p>
          {shot.dataUrl && (
            <img src={shot.dataUrl} alt="Browser screenshot" className="max-h-96 w-full rounded object-contain" />
          )}
        </div>
      )}
    </div>
  )
}
