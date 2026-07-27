import type { ITheme } from '@xterm/xterm'
import type { ResolvedTheme } from '../stores/themeStore'

/**
 * xterm color theme for the embedded terminal panes (Onboard wizard,
 * Commands runner). Mirrors the app's warm-cream / deep-navy palette
 * so the console doesn't read as a transplanted VS Code window.
 *
 * Color choices:
 *   - Light: warm off-white background (#fbf6ec, between --background
 *     and --secondary), slate-ink text, dimmed ANSI palette so the
 *     terminal sits comfortably on the cream theme without competing
 *     with the chrome.
 *   - Dark: openclaw.ai bg-surface (#0a0f1a) so the terminal matches
 *     the dashboard's navy depths, off-white slate text. ANSI palette
 *     uses brighter values that pop on navy.
 *
 * Returned object is shaped for xterm.js `Terminal({ theme })` or
 * runtime `term.options.theme = ...` updates.
 */
export function getXtermTheme(mode: ResolvedTheme): ITheme {
  if (mode === 'dark') {
    return {
      background:    '#0a0f1a',  // matches openclaw.ai bg-surface
      foreground:    '#e8e4df',
      cursor:        '#ef4b58',
      cursorAccent:  '#0a0f1a',
      selectionBackground: 'rgba(255, 77, 77, 0.30)',
      selectionForeground: '#ffffff',
      // ANSI palette — bright values for navy background
      black:         '#1e293b',
      red:           '#f87171',
      green:         '#22c55e',
      yellow:        '#fbbf24',
      blue:          '#60a5fa',
      magenta:       '#c084fc',
      cyan:          '#22d3ee',
      white:         '#e2e8f0',
      brightBlack:   '#475569',
      brightRed:     '#fca5a5',
      brightGreen:   '#4ade80',
      brightYellow:  '#fcd34d',
      brightBlue:    '#93c5fd',
      brightMagenta: '#d8b4fe',
      brightCyan:    '#67e8f9',
      brightWhite:   '#f8fafc',
    }
  }

  // Light theme — warm cream surface, slate-ink text.
  return {
    background:    '#fbf6ec',  // between --background (#fdf9f1) and --secondary
    foreground:    '#2d2b28',  // warm near-black (matches body text)
    cursor:        '#c93342',
    cursorAccent:  '#fbf6ec',
    selectionBackground: 'rgba(239, 75, 88, 0.22)',
    selectionForeground: '#1f1d1b',
    // ANSI palette — darker, lower-saturation values for the cream bg
    black:         '#1f1d1b',
    red:           '#b91c1c',
    green:         '#0a6e3a',
    yellow:        '#a16207',
    blue:          '#1d4ed8',
    magenta:       '#7e22ce',
    cyan:          '#0e7490',
    white:         '#4b4940',
    brightBlack:   '#6b6560',
    brightRed:     '#dc2626',
    brightGreen:   '#15803d',
    brightYellow:  '#ca8a04',
    brightBlue:    '#2563eb',
    brightMagenta: '#9333ea',
    brightCyan:    '#0891b2',
    brightWhite:   '#2d2b28',
  }
}
