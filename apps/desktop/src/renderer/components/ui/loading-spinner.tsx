import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { ColorTheme } from '../dashboard/types'

interface LoadingSpinnerProps {
  /** "sm" → 16px, "md" → 24px (default), "lg" → 40px. */
  size?: 'sm' | 'md' | 'lg'
  /** Optional caption rendered to the right (or below if `stack`). */
  label?: React.ReactNode
  /** Stack the label below the spinner (centered). Default: inline. */
  stack?: boolean
  /** Center the whole thing inside the parent (flex centered). */
  center?: boolean
  /** Theme — used to color spinner + label. */
  colors?: ColorTheme
  className?: string
}

const PX = { sm: 16, md: 24, lg: 40 } as const

/**
 * One canonical loading indicator. Replaces the `<RefreshCw className="animate-spin" />`
 * and `<div className="w-X h-X border-Y border-blue-500 ..." />` snippets that
 * had been reimplemented in 6+ section files.
 *
 * Uses Loader2 from lucide-react — it's already a dependency and produces
 * a smoother spin than spinning a refresh icon.
 */
export function LoadingSpinner({
  size = 'md',
  label,
  stack = false,
  center = false,
  colors,
  className,
}: LoadingSpinnerProps) {
  const px = PX[size]
  const spinner = (
    <Loader2
      className="animate-spin"
      size={px}
      style={colors ? { color: colors.text.muted } : undefined}
      aria-hidden="true"
    />
  )

  const content = (
    <div
      className={cn(
        'flex',
        stack ? 'flex-col items-center gap-2' : 'items-center gap-2',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      {spinner}
      {label && (
        <span
          className={cn('text-sm', stack && 'text-center')}
          style={colors ? { color: colors.text.muted } : undefined}
        >
          {label}
        </span>
      )}
    </div>
  )

  if (!center) return content
  return <div className="flex items-center justify-center w-full h-full">{content}</div>
}
