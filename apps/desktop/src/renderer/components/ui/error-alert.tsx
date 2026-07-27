import * as React from 'react'
import { AlertCircle } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { ColorTheme } from '../dashboard/types'

interface ErrorAlertProps {
  /** Short title (default: "Something went wrong"). */
  title?: React.ReactNode
  /** Detail message — typically the error.message string. */
  message: React.ReactNode
  /** Optional action (e.g., a Retry button). */
  action?: React.ReactNode
  /** Theme — colors text + uses accent.red for the border. */
  colors?: ColorTheme
  /** "danger" (default) for errors, "warn" for warnings. */
  variant?: 'danger' | 'warn'
  className?: string
}

/**
 * Standard error/warning alert. Replaces the raw `<p style={{color: red}}>`
 * and various ad-hoc `border rounded p-4 bg-red-500/10` snippets.
 *
 * Uses theme tokens so the alert matches the active palette instead of
 * leaking hardcoded Tailwind reds.
 */
export function ErrorAlert({
  title = 'Something went wrong',
  message,
  action,
  colors,
  variant = 'danger',
  className,
}: ErrorAlertProps) {
  const accent = variant === 'warn'
    ? colors?.accent.yellow ?? '#f59e0b'
    : colors?.accent.red ?? '#ef4444'
  return (
    <div
      role="alert"
      className={cn('flex items-start gap-3 rounded-lg border p-4', className)}
      style={{
        borderColor: accent,
        backgroundColor: `${accent}1a`, // ~10% alpha
      }}
    >
      <AlertCircle
        size={20}
        className="flex-shrink-0 mt-0.5"
        style={{ color: accent }}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <p
          className="text-sm font-semibold"
          style={colors ? { color: colors.text.normal } : { color: accent }}
        >
          {title}
        </p>
        <p
          className="text-sm mt-1 break-words"
          style={colors ? { color: colors.text.muted } : undefined}
        >
          {message}
        </p>
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  )
}
