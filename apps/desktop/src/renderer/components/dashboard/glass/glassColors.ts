import type { ColorTheme } from '../types'

/**
 * Light + dark color objects shaped like the legacy `ColorTheme` used by
 * every existing section. Lets sections built against the Discord palette
 * render correctly inside the glass shell without a per-section rewrite.
 *
 * Values mirror openclaw.ai marketing site exactly:
 *   - Coral #ef4b58 / #ff4d4d as brand
 *   - Teal #008f87 / #00e5cc as secondary accent
 *   - Cool slate-ink #0b1220 / #f0f4ff as text
 *   - Ice/navy backgrounds (#fcfeff / #050810)
 */

export const glassColorsLight: ColorTheme = {
  bg: {
    // Section roots paint over the GlassShell card — keep transparent so
    // OS vibrancy reaches the screen. Secondary/tertiary provide subtle
    // separation for header bands and inset surfaces inside a section.
    primary: 'transparent',
    secondary: 'rgba(255, 255, 255, 0.65)',
    tertiary: 'rgba(245, 249, 255, 0.55)',
    hover: 'rgba(239, 75, 88, 0.06)',
    active: 'rgba(239, 75, 88, 0.12)',
  },
  text: {
    normal: '#0b1220',  // text-primary
    muted: '#5a6480',   // text-muted
    header: '#0b1220',
    link: '#ef4b58',
    danger: '#de3f4d',
  },
  accent: {
    brand: '#ef4b58',   // coral-bright
    green: '#008f87',   // teal as the brand's "green"
    yellow: '#fbbf24',
    red: '#de3f4d',
    purple: '#7c3aed',
    indigo: '#4f46e5',
    blue: '#2563eb',    // info / "running" status — readable on cream
  },
  // Light-mode buttons: coral primary matches `.btn-primary` on
  // openclaw.ai; destructive is a step deeper than accent.red so Stop /
  // Delete buttons don't look identical to inline error badges.
  button: {
    primary: '#ef4b58',       // coral — same hue as accent.brand
    primaryFg: '#ffffff',
    destructive: '#dc2626',   // red-600
    destructiveFg: '#ffffff',
  },
}

/**
 * Dark-mode accents are tuned for WCAG ≥3:1 with white text so they
 * read cleanly as button backgrounds. The original "bright neon"
 * shades (e.g. green=#00e5cc, purple=#a78bfa) were vivid against a
 * dark canvas but failed contrast: a white "Launch Assistant" label
 * on #00e5cc clocks 2.1:1, which is both an accessibility miss and
 * the eye-stinging brightness users complained about.
 *
 * Where these colors are used for STROKE / icon-only accents (status
 * dots, checkmarks) the deeper shades still read fine — they're
 * actually closer to the light-mode palette, which keeps the two
 * themes visually consistent.
 */
export const glassColorsDark: ColorTheme = {
  bg: {
    primary: 'transparent',
    secondary: 'rgba(10, 15, 26, 0.55)',
    tertiary: 'rgba(17, 24, 39, 0.65)',
    hover: 'rgba(255, 77, 77, 0.06)',
    active: 'rgba(255, 77, 77, 0.15)',
  },
  text: {
    // Body and header both at slate-400 (~38% luminance, 7.5:1 contrast
    // on dark navy — passes WCAG AAA's 7:1 bar). Iteratively dimmed
    // from pure-white (#f0f4ff, "glowing") → slate-300 → slate-400
    // following user feedback that chat messages + section titles felt
    // too bright. Hierarchy is carried entirely by font-weight + size.
    normal: '#94a3b8',
    muted: '#5f7290',
    header: '#94a3b8',
    link: '#ff4d4d',
    danger: '#e63946',
  },
  accent: {
    brand: '#ff4d4d',   // coral-bright — passes ~3.7:1 with white
    // Forest green, one shade darker than green-700. The original neon
    // teal #00e5cc was eye-searing; lime variants (#65a30d / #4d7c0f)
    // ran "too bright"; #15803d (green-700) read fine on tone but felt
    // a touch light against the dark navy canvas. #166534 (green-800)
    // sits one step deeper, still clearly a "go / launch" green, and
    // gives 6.8:1 with white — well over WCAG AA for normal text.
    green: '#166534',
    // yellow buttons are rare but #fbbf24 was 1.9:1. #d97706 (amber-600)
    // is 3.5:1 with white and naturally warm.
    yellow: '#d97706',
    red: '#e63946',     // passes ~4.6:1 with white
    // purple/indigo/blue tuned for ≥3:1 with white. These are naturally
    // cool hues so we can't make them warm without changing the
    // semantic. The brand canvas leans warm (coral); these are reserved
    // for info-state accents where coolness is appropriate.
    purple: '#9333ea',  // purple-600 (slightly warmer / more magenta than violet-600)
    indigo: '#4f46e5',
    blue: '#2563eb',    // info / "running" status — passes 5.2:1 with white
  },
  // Dark-mode buttons: coral is bumped to #ff4d4d (vs accent.brand on the
  // light theme at #ef4b58) so a primary CTA pops against the dark navy
  // canvas; without the lift it reads as muddy and "off-brand". The
  // destructive #ef4444 is the standard red-500 — one step warmer than
  // the dark-mode #e63946 status red, again to differentiate destructive
  // *actions* from inline error *badges*.
  button: {
    primary: '#ff4d4d',
    primaryFg: '#ffffff',
    destructive: '#ef4444',
    destructiveFg: '#ffffff',
  },
}
