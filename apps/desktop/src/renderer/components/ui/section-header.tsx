import * as React from 'react'
import { cn } from '../../lib/utils'
import { SPACING } from '../../lib/spacing'
import type { ColorTheme } from '../dashboard/types'

interface SectionHeaderProps {
  title: React.ReactNode
  /** Optional subtitle / description below the title. */
  subtitle?: React.ReactNode
  /** Optional element rendered on the right (e.g. action buttons). */
  actions?: React.ReactNode
  /** Optional icon rendered before the title. */
  icon?: React.ReactNode
  /** Theme — passes border-color so the strip matches the active palette. */
  colors?: ColorTheme
  /** Render a bottom border (default true for sticky-header pattern). */
  border?: boolean
  className?: string
}

/**
 * Sticky header strip for a section (title + optional actions on the
 * right). Pair with <SectionShell> for the full section layout.
 *
 * Standardizes:
 *   - padding (`px-6 py-4`)
 *   - title typography (`text-lg font-semibold`)
 *   - subtitle (`text-xs text-muted`)
 *   - bottom border (uses theme `bg.tertiary`)
 *   - flex layout (icon + title on left, actions on right)
 */
export function SectionHeader({
  title,
  subtitle,
  actions,
  icon,
  colors,
  border = true,
  className,
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        SPACING.sectionHeader,
        'flex items-center justify-between flex-shrink-0',
        className,
      )}
      style={border && colors ? { borderBottom: `1px solid ${colors.bg.tertiary}` } : undefined}
    >
      <div className="flex items-center gap-3 min-w-0">
        {icon && <div className="flex-shrink-0">{icon}</div>}
        <div className="min-w-0">
          <h2
            className="font-display text-lg font-semibold leading-tight truncate tracking-tight"
            style={colors ? { color: colors.text.header } : undefined}
          >
            {title}
          </h2>
          {subtitle && (
            <p
              className="text-xs mt-0.5 truncate"
              style={colors ? { color: colors.text.muted } : undefined}
            >
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  )
}
