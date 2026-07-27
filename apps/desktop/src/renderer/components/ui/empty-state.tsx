import * as React from 'react'
import { cn } from '../../lib/utils'
import type { ColorTheme } from '../dashboard/types'

interface EmptyStateProps {
  /** Lucide icon component (or any node). Used when no `illustration`. */
  icon?: React.ReactNode
  /**
   * Larger illustration slot — overrides `icon` when set. Use for mascot
   * variants ("napping", "thinking", "lost") in branded empty states.
   * Sized at ~140px by default; pass a sized React element to override.
   */
  illustration?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  /** Optional action element (a Button) rendered below the description. */
  action?: React.ReactNode
  /** Theme — colors title/description text. */
  colors?: ColorTheme
  /** Make the empty state fill its parent vertically (centered). */
  fill?: boolean
  className?: string
}

/**
 * Standard "no data yet" placeholder. Replaces the mix of bare text,
 * icon-only, and ad-hoc `<div className="text-center text-muted">No X</div>`
 * patterns used across SessionsSection / UsageSection / ChannelLogs.
 */
export function EmptyState({
  icon,
  illustration,
  title,
  description,
  action,
  colors,
  fill = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center px-6 py-12 gap-3',
        // Slide-up-fade on mount so empty placeholders feel like a
        // surface arriving with intent — matches the chat-message and
        // section-tab vocabulary. Mount-only (won't re-fire on parent
        // re-render unless the EmptyState itself unmounts).
        'animate-fade-up',
        fill && 'h-full',
        className,
      )}
    >
      {illustration ? (
        <div className="mb-2" aria-hidden="true">
          {illustration}
        </div>
      ) : icon ? (
        <div
          className="opacity-50"
          style={colors ? { color: colors.text.muted } : undefined}
          aria-hidden="true"
        >
          {icon}
        </div>
      ) : null}
      <h3
        className="text-base font-medium"
        style={colors ? { color: colors.text.normal } : undefined}
      >
        {title}
      </h3>
      {description && (
        <p
          className="text-sm max-w-sm"
          style={colors ? { color: colors.text.muted } : undefined}
        >
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
