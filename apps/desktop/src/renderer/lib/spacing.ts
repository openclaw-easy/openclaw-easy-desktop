/**
 * Shared spacing scale for the desktop renderer.
 *
 * Each value is a Tailwind class string. Use these instead of inline
 * `p-8` / `px-6 pt-4 pb-2` / `p-6 gap-6` etc. — the dashboard sections
 * had drifted to 8+ different padding combos before this module was
 * introduced (pre-2026.5.10), making the UI feel patchy across tabs.
 *
 * If you find yourself reaching for an inline padding class, add a
 * named entry here instead so the next person sees the system.
 *
 * Naming convention:
 *   section*    — outer wrapper of a whole tab/page content area
 *   header*     — a sticky strip row at the top of a section
 *   card*       — a Card or panel within a section
 *   gap*        — spacing between siblings
 *   stack*      — spacing between vertical sections within a single page
 */
export const SPACING = {
  // ── Section wrappers (whole tab content) ──────────────────────────────
  /** Default content padding for a full-tab section. */
  section: 'p-8',
  /** Tighter padding for sections with dense content (e.g. lists, settings). */
  sectionTight: 'p-6',

  // ── Header strips inside a section ────────────────────────────────────
  /** A sticky header row at the top of a section (with bottom border). */
  sectionHeader: 'px-6 py-4',
  /** A subheader row below a sticky header (no border). */
  sectionSubheader: 'px-6 py-3',

  // ── Cards / panels ────────────────────────────────────────────────────
  /** Compact card body padding. */
  card: 'p-4',
  /** Standard card body padding. */
  cardLg: 'p-6',

  // ── Gaps ──────────────────────────────────────────────────────────────
  /** Gap between top-level cards in a section. */
  sectionGap: 'gap-6',
  /** Gap between rows inside a card. */
  cardGap: 'gap-4',
  /** Gap between inline elements (icon + label, etc.). */
  inlineGap: 'gap-2',

  // ── Vertical stacks ───────────────────────────────────────────────────
  /** Vertical stack inside a section (space-y). */
  stack: 'space-y-6',
  /** Tight vertical stack (form rows, list items). */
  stackTight: 'space-y-3',
} as const

/**
 * Common Flex-column "fill the parent" pattern used by sections that have
 * a sticky header + scrollable body. Avoids `h-full flex flex-col` repeats.
 */
export const FILL_COL = 'h-full flex flex-col'
