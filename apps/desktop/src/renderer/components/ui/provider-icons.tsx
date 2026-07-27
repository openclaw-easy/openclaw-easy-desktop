import * as React from 'react'

/**
 * AI provider brand marks. Inline SVG so the renderer ships zero extra
 * assets and the icons can use currentColor / inherit text color in
 * disabled states.
 *
 * These are the providers' OWN brand marks — not Openclaw's. Used only
 * to make the BYOK provider radio identifiable at a glance ("which one
 * is which") rather than text-only.
 *
 * If a provider rebrands, swap the SVG body inside the matching
 * component once. Sizing is via the `size` prop; default 20px is sized
 * to match the Lucide icons used elsewhere on the screen.
 */

interface IconProps {
  size?: number
  className?: string
}

/** Anthropic mark — solid square with the Claude angle slice. */
export function AnthropicIcon({ size = 20, className }: IconProps) {
  return (
    <svg viewBox="0 0 256 256" width={size} height={size} className={className} aria-label="Anthropic">
      <rect width="256" height="256" rx="48" fill="#181818" />
      <path
        d="M88.6 71.6h28.8l52.5 113.6h-28.6l-10.7-23.9h-55.2l-10.7 23.9H36.1l52.5-113.6Zm32 65.5L102.7 96l-17.9 41.1h35.8Z"
        fill="#D77757"
      />
      <path d="M139.4 71.6h28.6l52.4 113.6H192l-52.6-113.6Z" fill="#D77757" />
    </svg>
  )
}

/** OpenAI mark — the hexagonal knot. */
export function OpenAIIcon({ size = 20, className }: IconProps) {
  return (
    <svg viewBox="0 0 256 256" width={size} height={size} className={className} aria-label="OpenAI">
      <rect width="256" height="256" rx="48" fill="#fff" />
      <path
        fill="#000"
        d="M205.4 116.5a51.7 51.7 0 0 0-4.4-42.4 52.2 52.2 0 0 0-56.3-25 52 52 0 0 0-39.2-17.5c-22.6 0-42.7 14.6-49.7 36a51.9 51.9 0 0 0-34.8 25.1 52.3 52.3 0 0 0 6.4 61.4 51.7 51.7 0 0 0 4.4 42.5 52.2 52.2 0 0 0 56.3 25 52 52 0 0 0 39.2 17.5c22.7 0 42.7-14.6 49.7-36a51.9 51.9 0 0 0 34.8-25.2 52.3 52.3 0 0 0-6.4-61.4Zm-77.7 108.7a38.7 38.7 0 0 1-24.9-9l1.2-.7 41.4-23.9a6.8 6.8 0 0 0 3.4-5.9V128l17.5 10.1.2.2v48.4a38.9 38.9 0 0 1-38.8 38.5Zm-83.5-35.7a38.7 38.7 0 0 1-4.6-26l1.2.7 41.4 24a6.7 6.7 0 0 0 6.8 0l50.6-29.2v20.2a.7.7 0 0 1-.3.5l-41.8 24.2a38.9 38.9 0 0 1-53.2-14.4Zm-10.9-90.6a38.6 38.6 0 0 1 20.2-17v49.3a6.7 6.7 0 0 0 3.4 5.9l50.4 29-17.5 10.1a.7.7 0 0 1-.6 0l-41.9-24.2a38.9 38.9 0 0 1-14-53.1Zm143.7 33.4-50.4-29.3 17.4-10a.7.7 0 0 1 .7 0l41.9 24.1a38.9 38.9 0 0 1-6 70.2v-49.2a6.7 6.7 0 0 0-3.6-5.8Zm17.4-26.1-1.2-.7-41.3-24a6.7 6.7 0 0 0-6.8 0L94.4 110.7V90.5a.7.7 0 0 1 .3-.5l41.8-24.1a38.9 38.9 0 0 1 57.7 40.3Zm-109.4 36 -17.4-10.1a.7.7 0 0 1-.3-.5V83.4a38.9 38.9 0 0 1 63.8-29.9l-1.2.7L88.6 78a6.8 6.8 0 0 0-3.4 5.9Zm9.5-20.4 22.5-13 22.6 13v26l-22.5 13-22.5-13Z"
      />
    </svg>
  )
}

/** Google Gemini mark — the four-pointed star. */
export function GoogleGeminiIcon({ size = 20, className }: IconProps) {
  return (
    <svg viewBox="0 0 256 256" width={size} height={size} className={className} aria-label="Google Gemini">
      <rect width="256" height="256" rx="48" fill="#fff" />
      <defs>
        <linearGradient id="gemini-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4796E3" />
          <stop offset="50%" stopColor="#9168C0" />
          <stop offset="100%" stopColor="#FF6363" />
        </linearGradient>
      </defs>
      <path
        d="M128 40 C128 88 88 128 40 128 C88 128 128 168 128 216 C128 168 168 128 216 128 C168 128 128 88 128 40 Z"
        fill="url(#gemini-grad)"
      />
    </svg>
  )
}

/** Venice AI mark — circular V monogram. Venice's public brand color is #DCAB6B. */
export function VeniceIcon({ size = 20, className }: IconProps) {
  return (
    <svg viewBox="0 0 256 256" width={size} height={size} className={className} aria-label="Venice AI">
      <rect width="256" height="256" rx="48" fill="#0C0E12" />
      <path
        d="M64 72 L128 192 L192 72 L168 72 L128 148 L88 72 Z"
        fill="#DCAB6B"
      />
    </svg>
  )
}

/** OpenRouter mark — directional arrow on dark. */
export function OpenRouterIcon({ size = 20, className }: IconProps) {
  return (
    <svg viewBox="0 0 256 256" width={size} height={size} className={className} aria-label="OpenRouter">
      <rect width="256" height="256" rx="48" fill="#0F1117" />
      <circle cx="80" cy="128" r="20" fill="none" stroke="#9CA3AF" strokeWidth="10" />
      <circle cx="176" cy="80" r="14" fill="#fff" />
      <circle cx="176" cy="176" r="14" fill="#fff" />
      <path d="M98 119 L162 84" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
      <path d="M98 137 L162 172" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
    </svg>
  )
}

/** Resolves a provider id to its icon component. */
export function ProviderIcon({
  provider,
  size = 20,
  className,
}: {
  provider: string
  size?: number
  className?: string
}) {
  switch (provider) {
    case 'anthropic':
      return <AnthropicIcon size={size} className={className} />
    case 'openai':
      return <OpenAIIcon size={size} className={className} />
    case 'google':
      return <GoogleGeminiIcon size={size} className={className} />
    case 'venice':
      return <VeniceIcon size={size} className={className} />
    case 'openrouter':
      return <OpenRouterIcon size={size} className={className} />
    default:
      return null
  }
}
