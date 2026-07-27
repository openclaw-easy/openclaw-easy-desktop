/**
 * Brand color tokens for Openclaw Easy.
 *
 * Aligned with the official openclaw.ai marketing site (May 2026 rebrand):
 *   - Coral #ef4b58 / #ff4d4d as primary
 *   - Cool deep navy (#050810 / #0a0f1a) for splash background
 *   - Hero gradient: coral-dark → coral-bright (#c93342 → #f04d5a)
 *
 * Surfaces that need a single static brand color (splash, primary CTA,
 * window-launch tint) read from here. Semantic theme tokens (via the
 * CSS variables in globals.css) handle everything else.
 */
export const BRAND = {
  /** Primary brand color — coral-bright. */
  brand: '#ef4b58',
  /** Lifted coral for the dark-mode primary. */
  brandDark: '#ff4d4d',
  /** Hero gradient start (coral-dark). */
  coralDark: '#c93342',
  /** Hero gradient end (coral-mid). */
  coral: '#f04d5a',
  /** Deep navy — splash bg base. */
  deepOcean: '#050810',
  /** Mid navy — splash gradient mid stop. */
  midOcean: '#0a0f1a',

  /** The signature primary-CTA gradient (matches openclaw.ai hero title). */
  gradient: 'linear-gradient(135deg, #c93342 0%, #f04d5a 100%)',
  /** Reverse direction for hover/pressed states. */
  gradientReverse: 'linear-gradient(135deg, #b8202f 0%, #de3f4d 100%)',
  /** Splash background gradient — navy depths with a warm coral hint at bottom. */
  splashGradient: 'linear-gradient(180deg, #050810 0%, #0a0f1a 60%, #1c0e14 100%)',

  /** Low-alpha brand fill for soft active/hover states. */
  brandSoft: 'rgba(239, 75, 88, 0.12)',
  /** Slightly stronger soft for clear active states. */
  brandSoftStrong: 'rgba(239, 75, 88, 0.22)',

  /** Glow shadow for primary CTAs / focus rings. */
  glowShadow: '0 0 0 3px rgba(239, 75, 88, 0.30), 0 4px 16px rgba(239, 75, 88, 0.40)',
  /** Subtle elevation shadow for cards. */
  cardShadow: '0 1px 3px rgba(11, 18, 32, 0.30), 0 1px 2px rgba(11, 18, 32, 0.20)',
  /** Stronger lift for hovered cards. */
  cardShadowHover: '0 8px 24px rgba(11, 18, 32, 0.35), 0 2px 6px rgba(11, 18, 32, 0.25)',
} as const
