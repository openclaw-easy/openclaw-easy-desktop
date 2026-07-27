import * as React from 'react'
import { cn } from '../../lib/utils'

/**
 * Skeleton row — placeholder block while content loads. Uses the coral
 * shimmer keyframe defined in globals.css and a subtle base tint so it
 * works in both light and dark themes without a `colors` prop.
 *
 * Use as building blocks: stack/grid several to scaffold the shape of
 * the real content (avatar circle, title bar, two body lines, etc.).
 *
 * Variants:
 *   - default: 16px-tall bar, full width
 *   - `circle`: square ratio with full radius (for avatars)
 *   - `text`: stack of fading lines for paragraph placeholders
 */
interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Render a circular skeleton (e.g., avatar). Sets aspect-square + rounded-full. */
  circle?: boolean
}

export function Skeleton({ className, circle, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'relative overflow-hidden',
        'bg-foreground/[0.06] dark:bg-foreground/[0.04]',
        circle ? 'rounded-full aspect-square' : 'rounded-md',
        'animate-shimmer',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Convenience: stack of N text-line skeletons with the typical
 * tapering width (last line shorter). Use for paragraph placeholders.
 */
export function SkeletonText({
  lines = 3,
  className,
}: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => {
        const isLast = i === lines - 1
        return (
          <Skeleton
            key={i}
            className={cn('h-3.5', isLast ? 'w-2/3' : 'w-full')}
          />
        )
      })}
    </div>
  )
}

/**
 * Card-shaped skeleton: header line + 3 body lines, padded inside a
 * rounded outline. Drop-in for sections that fetch a list of items.
 */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border/40 bg-card/40 p-4 space-y-3',
        className,
      )}
      aria-hidden
    >
      <div className="flex items-center gap-3">
        <Skeleton circle className="h-9 w-9" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-1/3" />
          <Skeleton className="h-3 w-1/5" />
        </div>
      </div>
      <SkeletonText lines={3} />
    </div>
  )
}
