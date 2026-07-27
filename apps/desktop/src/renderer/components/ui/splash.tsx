import * as React from 'react'
import { BRAND } from '../../lib/brand'
import { BrandLobster } from './brand-lobster'


interface SplashProps {
  /** Optional caption (default: "Loading Openclaw Easy..."). */
  message?: React.ReactNode
}

/**
 * Branded launch / loading splash. Replaces the generic centered spinner
 * App.tsx used to show. Sets the emotional tone of the app — first thing
 * every user sees on every launch.
 *
 * Keeps the lobster mark as the focal element (users know this
 * app by the lobster) but presents it with brand-grade polish: deep-ocean
 * gradient background, pulsing coral glow, gentle bob animation, gradient
 * wordmark.
 *
 * Pure CSS animations — no Lottie/external runtime, no asset bundling.
 */
export function Splash({ message = 'Loading Openclaw Easy...' }: SplashProps) {
  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden"
      style={{ background: BRAND.splashGradient }}
      role="status"
      aria-label="Application loading"
    >
      {/* Soft radial glow behind the lobster */}
      <div
        className="absolute animate-splash-glow"
        style={{
          width: 480,
          height: 480,
          background: `radial-gradient(circle, ${BRAND.coral}40 0%, transparent 60%)`,
          filter: 'blur(20px)',
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      />

      {/* Lobster emoji — bobbing. Keeps brand continuity with current icon. */}
      <div
        className="relative animate-splash-enter animate-mascot-bob select-none"
        style={{
          filter: 'drop-shadow(0 8px 24px rgba(212, 88, 31, 0.45))',
        }}
        aria-hidden="true"
      >
        <BrandLobster size={140} />
      </div>

      {/* Wordmark + tagline */}
      <div
        className="mt-8 text-center animate-splash-enter"
        style={{ animationDelay: '120ms' }}
      >
        <h1
          className="font-display text-3xl font-bold tracking-tight"
          style={{
            background: BRAND.gradient,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          Openclaw Easy
        </h1>
        <p className="mt-3 text-sm" style={{ color: '#8892b0' }}>
          {message}
        </p>
      </div>

      {/* Dotted progress strip */}
      <div
        className="mt-8 flex gap-2 animate-splash-enter"
        style={{ animationDelay: '300ms' }}
        aria-hidden="true"
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="block h-1.5 w-1.5 rounded-full"
            style={{
              background: BRAND.coral,
              opacity: 0.35,
              animation: `splash-glow-pulse 1.4s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  )
}
