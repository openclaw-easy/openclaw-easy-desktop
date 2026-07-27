import * as React from 'react'
import { useCountUp } from '../../hooks/useCountUp'

interface AnimatedNumberProps {
  /** Target value to display + animate to. */
  value: number
  /** Tween duration in ms (default 600). */
  duration?: number
}

/**
 * Renders a number that smoothly tweens whenever the input value
 * changes. First render shows the value instantly (no "0 → N" sweep on
 * mount). Drop in anywhere a static `{stats.foo}` was rendered:
 *
 *   <span ...><AnimatedNumber value={pluginStats.enabled} /></span>
 */
export function AnimatedNumber({ value, duration = 600 }: AnimatedNumberProps) {
  const v = useCountUp(value, duration)
  return <>{v}</>
}
