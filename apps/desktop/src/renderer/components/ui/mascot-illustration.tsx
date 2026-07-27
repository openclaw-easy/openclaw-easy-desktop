import * as React from 'react'
import { BrandLobster } from './brand-lobster'


/**
 * Lobster mascot illustrations for empty states.
 *
 * Same brand mark we use on the splash + the page tray icon, sized
 * and animated to suggest different "moods" without needing custom
 * artwork. Pure CSS animations from globals.css — no JS runtime.
 *
 * Use as the `illustration` prop on <EmptyState>.
 */

interface MascotProps {
  /** px size of the emoji. Default 80. */
  size?: number
  /** Mood — drives the animation + tilt. */
  mood?: 'idle' | 'napping' | 'waving' | 'thinking'
  className?: string
}

export function MascotIllustration({
  size = 80,
  mood = 'idle',
  className,
}: MascotProps) {
  const animClass =
    mood === 'idle' ? 'animate-mascot-bob' :
    mood === 'waving' ? 'animate-mascot-wave' :
    'animate-mascot-bob'

  // "napping" = slight tilt + slowed bob (no extra keyframe; opacity hint).
  // "thinking" = same idle bob but with a subtle drop shadow + tilt.
  const transform =
    mood === 'napping' ? 'rotate(20deg)' :
    mood === 'thinking' ? 'rotate(-8deg)' :
    undefined

  return (
    <div
      className={`select-none ${animClass} ${className ?? ''}`}
      style={{
        transform,
        opacity: mood === 'napping' ? 0.7 : 1,
        filter: 'drop-shadow(0 6px 16px rgba(212, 88, 31, 0.25))',
      }}
      aria-hidden="true"
    >
      <BrandLobster size={size} />
    </div>
  )
}
