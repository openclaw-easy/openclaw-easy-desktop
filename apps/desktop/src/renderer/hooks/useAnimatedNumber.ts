import { useEffect, useRef, useState } from 'react'

/**
 * Animate a number from its previous value to the next over `duration` ms.
 * Returns the current displayed (interpolated) value, suitable for piping
 * into `.toFixed()` / formatting in render.
 *
 * Used for the credit balance, daily-spend counters, etc. — small touch
 * that makes the dashboard feel "alive" when balances refresh after a
 * top-up or a chat that just deducted credit.
 *
 *   const display = useAnimatedNumber(balanceCents ?? 0)
 *   <span>{(display / 100).toFixed(2)}</span>
 *
 * Uses requestAnimationFrame so the animation is GPU-vsync-paced and
 * doesn't burn CPU when the tab is backgrounded (rAF is throttled by
 * the browser when the page is hidden).
 *
 * Easing: easeOutQuad — fast at start, slow at end. Feels like the
 * counter is "settling" into its new value.
 */
export function useAnimatedNumber(
  target: number,
  options: { duration?: number; minDelta?: number } = {},
): number {
  const { duration = 600, minDelta = 0.5 } = options
  const [display, setDisplay] = useState(target)
  const fromRef = useRef(target)
  const startRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    // Skip animation for trivial deltas (or first mount) to avoid flicker.
    if (Math.abs(target - display) < minDelta) {
      fromRef.current = target
      setDisplay(target)
      return
    }

    fromRef.current = display
    startRef.current = null

    const tick = (now: number) => {
      if (startRef.current == null) startRef.current = now
      const elapsed = now - startRef.current
      const t = Math.min(1, elapsed / duration)
      // easeOutQuad — t * (2 - t)
      const eased = t * (2 - t)
      const next = fromRef.current + (target - fromRef.current) * eased
      setDisplay(next)
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        rafRef.current = null
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration, minDelta])

  return display
}
