import { useEffect, useRef, useState } from 'react'

/**
 * Smoothly animate a numeric value when it changes. Pure delight — used
 * for stat tiles in Plugins / Hooks / Skills / Cron sections so a freshly-
 * toggled "Enabled: 4 → 5" tweens instead of jump-cutting.
 *
 * Implementation notes:
 *   - RAF-driven so it pauses cleanly when the tab is backgrounded.
 *   - First render returns `value` immediately (no count-up from 0 on
 *     initial mount — that would flash a meaningless "0 → N" sweep
 *     every time you open the section).
 *   - Eases with `1 − (1−t)³` (cubic ease-out) — same family as the
 *     Apple `cubic-bezier(0.16, 1, 0.3, 1)` used elsewhere, just
 *     expressible in JS without a curve library.
 *   - If the value changes mid-animation, the current displayed value
 *     becomes the new `start` and the tween retargets — no jump.
 *
 * @param value     The target value to animate toward.
 * @param duration  Tween duration in ms (default 600).
 */
export function useCountUp(value: number, duration = 600): number {
  const [display, setDisplay] = useState(value)
  const firstRender = useRef(true)
  const rafRef = useRef<number | undefined>(undefined)
  // Retain the latest displayed value across renders without retriggering
  // the effect. `display` in deps would loop.
  const displayRef = useRef(value)
  displayRef.current = display

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      setDisplay(value)
      return
    }

    const start = displayRef.current
    const end = value
    if (start === end) return

    const t0 = performance.now()
    const tick = (now: number) => {
      const elapsed = now - t0
      const t = Math.min(1, elapsed / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      const cur = Math.round(start + (end - start) * eased)
      setDisplay(cur)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
    }
  }, [value, duration])

  return display
}
