import React from 'react'
import lobsterLogo from '../../assets/lobster-3d.png'

/**
 * The Openclaw Easy mark.
 *
 * Single source for the in-app logo. The UI previously rendered a raw 🦞
 * emoji in the splash, sidebar and What's New header, which meant the app
 * showed the OS emoji font rather than our brand mark — and it drifted from
 * the Dock/installer icon, which is this image. Route every in-app logo
 * through this component so a future logo change is one file.
 *
 * Decorative by default: it sits next to the "Openclaw Easy" wordmark in
 * every current placement, so it is aria-hidden unless a caller passes a
 * label.
 */
export function BrandLobster({
  size = 16,
  className,
  label,
}: {
  /** Rendered size in px (square). */
  size?: number
  className?: string
  /** Accessible name. Omit when an adjacent wordmark already names the app. */
  label?: string
}) {
  return (
    <img
      src={lobsterLogo}
      width={size}
      height={size}
      alt={label ?? ''}
      aria-hidden={label ? undefined : 'true'}
      draggable={false}
      className={className}
      style={{ width: size, height: size, objectFit: 'contain', userSelect: 'none' }}
    />
  )
}
