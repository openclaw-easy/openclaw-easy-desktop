import { useEffect } from 'react'
import { Command } from 'cmdk'
import { ChevronRight } from 'lucide-react'
import type { ColorTheme } from './dashboard/types'

/**
 * A palette action either navigates the dashboard to a section or runs a
 * function (start gateway, run doctor, …). Keep this discriminated union
 * narrow — anything fancier should compose two simpler actions instead.
 */
export type PaletteAction =
  | {
      kind: 'navigate'
      id: string
      title: string
      icon: React.ReactNode
      group: string
      /** Dashboard's selectedServer value (home | main | channels | aiconfig) */
      server: string
      /** Dashboard's activeChannel value */
      channel: string
      /** Extra space-separated terms cmdk's matcher will index. */
      keywords?: string
      /** Optional one-liner shown below the title. */
      hint?: string
    }
  | {
      kind: 'run'
      id: string
      title: string
      icon: React.ReactNode
      group: string
      perform: () => void | Promise<void>
      keywords?: string
      hint?: string
      /** Tints the row red — use for stop/restart/destructive items. */
      danger?: boolean
    }

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  actions: PaletteAction[]
  colors: ColorTheme
  /** Called for navigate actions. Caller updates server + channel. */
  onNavigate: (server: string, channel: string) => void
}

/**
 * Group preserves the order the caller provided so heading order is
 * deterministic — we don't sort actions alphabetically. cmdk handles
 * fuzzy filtering inside each group on its own.
 *
 * Exported for tests.
 */
export function groupActions(actions: PaletteAction[]) {
  const seen = new Map<string, PaletteAction[]>()
  for (const a of actions) {
    const list = seen.get(a.group) ?? []
    list.push(a)
    seen.set(a.group, list)
  }
  return Array.from(seen, ([label, items]) => ({ label, items }))
}

export function CommandPalette({
  open,
  onOpenChange,
  actions,
  colors,
  onNavigate,
}: CommandPaletteProps) {
  // Esc is handled by cmdk natively. We only need to clear the search
  // value when the palette closes so a stale query doesn't flash on
  // re-open. The Command component manages its own state; controlling
  // the input would force re-renders for every keystroke.
  useEffect(() => {
    if (!open) {
      // Tiny delay so the close animation can finish before reset.
      const t = setTimeout(() => {
        const inp = document.querySelector<HTMLInputElement>(
          '[cmdk-input]',
        )
        if (inp) inp.value = ''
      }, 200)
      return () => clearTimeout(t)
    }
  }, [open])

  const groups = groupActions(actions)

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command menu"
      shouldFilter
      // The default cmdk matcher does case-insensitive substring + fuzzy
      // ordering by score. That's the right default for a small action
      // catalog; we'd only override for >1k items.
      className="cmdk-root"
    >
      <div
        className="cmdk-shell glass-strong"
        style={{
          // `glass-strong` provides the surface (theme-aware, high
          // opacity with backdrop blur). Border + radius from the
          // .cmdk-shell rule.
          borderColor: colors.bg.hover,
        }}
      >
        <div
          className="cmdk-input-wrapper"
          style={{ borderColor: colors.bg.hover }}
        >
          <SearchIcon color={colors.text.muted} />
          <Command.Input
            placeholder="Type a command or search…"
            autoFocus
            className="cmdk-input-el"
            style={{ color: colors.text.normal }}
          />
          <kbd
            className="cmdk-kbd"
            style={{
              backgroundColor: colors.bg.tertiary,
              color: colors.text.muted,
              borderColor: colors.bg.hover,
            }}
          >
            Esc
          </kbd>
        </div>

        <Command.List className="cmdk-list">
          <Command.Empty
            className="cmdk-empty"
            style={{ color: colors.text.muted }}
          >
            No matches. Try different keywords.
          </Command.Empty>

          {groups.map((g) => (
            <Command.Group
              key={g.label}
              heading={g.label}
              className="cmdk-group"
            >
              {g.items.map((action) => {
                const isDanger = action.kind === 'run' && action.danger
                return (
                  <Command.Item
                    key={action.id}
                    // Including keywords in `value` makes cmdk's fuzzy
                    // matcher index them — this is how "automation"
                    // finds "Cron Jobs", etc.
                    value={`${action.title} ${action.keywords ?? ''}`}
                    onSelect={async () => {
                      onOpenChange(false)
                      if (action.kind === 'navigate') {
                        onNavigate(action.server, action.channel)
                      } else {
                        try {
                          await action.perform()
                        } catch (err) {
                          console.error(
                            `[CommandPalette] action ${action.id} failed:`,
                            err,
                          )
                        }
                      }
                    }}
                    className="cmdk-item"
                  >
                    <span
                      className="cmdk-item-icon"
                      style={{
                        color: isDanger
                          ? colors.accent.red
                          : colors.text.muted,
                      }}
                    >
                      {action.icon}
                    </span>
                    <span className="cmdk-item-body">
                      <span
                        className="cmdk-item-title"
                        style={{
                          color: isDanger
                            ? colors.accent.red
                            : colors.text.header,
                        }}
                      >
                        {action.title}
                      </span>
                      {action.hint && (
                        <span
                          className="cmdk-item-hint"
                          style={{ color: colors.text.muted }}
                        >
                          {action.hint}
                        </span>
                      )}
                    </span>
                    <ChevronRight
                      className="cmdk-item-chev"
                      size={14}
                      style={{ color: colors.text.muted }}
                    />
                  </Command.Item>
                )
              })}
            </Command.Group>
          ))}
        </Command.List>

        <div
          className="cmdk-footer"
          style={{
            backgroundColor: colors.bg.tertiary,
            borderColor: colors.bg.hover,
            color: colors.text.muted,
          }}
        >
          <FooterHint label="Navigate" keys={['↑', '↓']} colors={colors} />
          <FooterHint label="Select" keys={['↵']} colors={colors} />
          <FooterHint label="Close" keys={['Esc']} colors={colors} />
        </div>
      </div>
    </Command.Dialog>
  )
}

function FooterHint({
  label,
  keys,
  colors,
}: {
  label: string
  keys: string[]
  colors: ColorTheme
}) {
  return (
    <span className="cmdk-footer-hint">
      <span>{label}</span>
      {keys.map((k) => (
        <kbd
          key={k}
          className="cmdk-footer-kbd"
          style={{
            backgroundColor: colors.bg.secondary,
            color: colors.text.normal,
            borderColor: colors.bg.hover,
          }}
        >
          {k}
        </kbd>
      ))}
    </span>
  )
}

function SearchIcon({ color }: { color: string }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
      aria-hidden
    >
      <circle cx={11} cy={11} r={8} />
      <path d="m21 21-4.35-4.35" />
    </svg>
  )
}
