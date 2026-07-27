import * as React from 'react'
import { cn } from '../../lib/utils'
import { SPACING, FILL_COL } from '../../lib/spacing'

interface SectionShellProps {
  children: React.ReactNode
  /** Use the tighter `p-6` instead of the default `p-8`. */
  tight?: boolean
  /** Make the shell flex-column and fill its parent height. Default true. */
  fill?: boolean
  className?: string
}

/**
 * Standard wrapper for a dashboard section's outer content area.
 * Replaces the ad-hoc mix of `p-8`, `p-8 pb-4`, `p-6 gap-6`,
 * `px-6 pt-4 pb-2`, `p-8 h-full flex flex-col` etc. that had drifted
 * across the 30+ section files.
 *
 * For sections with a sticky header + scrollable body, use this together
 * with <SectionHeader> + an inner scroll container.
 */
export function SectionShell({ children, tight = false, fill = true, className }: SectionShellProps) {
  return (
    <div
      className={cn(
        tight ? SPACING.sectionTight : SPACING.section,
        fill && FILL_COL,
        className,
      )}
    >
      {children}
    </div>
  )
}
