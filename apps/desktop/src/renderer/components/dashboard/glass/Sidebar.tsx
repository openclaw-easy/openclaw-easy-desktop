import React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronsLeft, ChevronsRight, ChevronDown, Moon, Sun, Monitor, Settings } from 'lucide-react'
import { sidebarGroups, pinnedTopItems, type SidebarItemDef, type SidebarGroupDef } from './sidebarNav'
import { useThemeStore, type ThemeMode } from '../../../stores/themeStore'
import { useWhatsNewStore } from '../../../stores/whatsNewStore'
import { BrandLobster } from '../../ui/brand-lobster'


/** Resolve an item or group's display label. Translates via t() when a
 *  labelKey is provided, falls back to the static `label` (used for
 *  brand-name channel items that aren't translated). */
function useLabel() {
  const { t } = useTranslation()
  return (entry: { labelKey?: string; label: string }) =>
    entry.labelKey ? t(entry.labelKey, entry.label) : entry.label
}

interface SidebarProps {
  collapsed: boolean
  onToggleCollapsed: () => void
  activeChannel: string
  onSelect: (id: string, legacyServer?: 'home' | 'main' | 'channels' | 'aiconfig') => void
  /**
   * Set of channel-id strings that are currently connected (whatsapp,
   * telegram, etc). Channel-group items not in this set are hidden —
   * matching the legacy ChannelSidebar behavior where only live
   * channels showed up. The 'setup' (Add channel) item is always
   * kept so the user can connect more.
   */
  connectedChannels: Set<string>
}

function groupContainingChannel(channelId: string): string | undefined {
  return sidebarGroups.find((g) => g.items.some((i) => i.id === channelId))?.id
}

export function Sidebar({ collapsed, onToggleCollapsed, activeChannel, onSelect, connectedChannels }: SidebarProps) {
  const themeMode = useThemeStore((s) => s.mode)
  const setMode = useThemeStore((s) => s.setMode)
  const { t } = useTranslation()

  // Track which groups are open. Default state is "all closed" except the
  // group that already contains the active item — so a fresh launch
  // doesn't drop the user into an empty sidebar with the current page
  // hidden inside a folded group.
  const [expandedGroups, setExpandedGroups] = React.useState<Set<string>>(() => {
    const initial = groupContainingChannel(activeChannel)
    return new Set(initial ? [initial] : [])
  })

  // When navigation jumps into a collapsed group (e.g., via Cmd+K or a
  // programmatic redirect), expand that group so the active row is
  // visible. We never auto-collapse — user-opened groups stay open.
  React.useEffect(() => {
    const ownerId = groupContainingChannel(activeChannel)
    if (ownerId && !expandedGroups.has(ownerId)) {
      setExpandedGroups((prev) => new Set(prev).add(ownerId))
    }
    // expandedGroups intentionally omitted from deps — including it would
    // re-fire the effect after we set the new state and infinite-loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChannel])

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  const themeOptions = [
    { id: 'system' as ThemeMode, Icon: Monitor, label: t('settings.themeSystem', 'System') },
    { id: 'light'  as ThemeMode, Icon: Sun,     label: t('settings.themeLight', 'Light') },
    { id: 'dark'   as ThemeMode, Icon: Moon,    label: t('settings.themeDark', 'Dark') },
  ]

  return (
    <aside
      className={[
        'flex flex-col shrink-0 h-full',
        // Apple-style smooth-out curve — same one the rest of the app
        // uses for page/modal/ripple transitions. The slightly longer
        // 280ms (vs the old 200ms ease-out) gives the width animation
        // room to breathe so it reads as a surface gliding rather than
        // snapping.
        'transition-[width] duration-300 ease-apple',
        // Sidebar is a transparent slice of the shared glass-card now;
        // only a subtle divider separates it from the content pane.
        'border-r border-black/[0.06] dark:border-white/[0.06]',
        // Widened from 240 → 264 so the brand row has comfortable room
        // for the macOS traffic-light reservation + logo + label +
        // collapse button without anything feeling cramped.
        collapsed ? 'w-[64px]' : 'w-[264px]',
      ].join(' ')}
      style={{
        // Reserve room for hiddenInset traffic lights at the top.
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
    >
      {/* Brand row.
          Expanded: 56px row with 92px left reservation for the macOS
          traffic lights, brand label centered, chevron pinned right.
          Collapsed: taller 80px row with the chevron pushed to the
          bottom (below y≈32 where macOS traffic lights end) so it
          doesn't visually collide with the OS buttons. */}
      <div
        className={[
          'select-none',
          collapsed
            ? 'h-20 flex flex-col items-center justify-end pb-2 px-1'
            : 'h-14 flex items-center justify-between pl-[92px] pr-4',
        ].join(' ')}
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {!collapsed && (
          // Lobster emoji + brand wordmark. Hardcoded coral so the brand
          // colour stays constant across light/dark mode (the previous
          // `text-foreground` rendered as off-white on dark, which lost
          // brand recognition). `whitespace-nowrap` + text-sm keep
          // "Openclaw Easy" on one line inside the ~108px the row has
          // after the macOS traffic-light reservation; the old text-base
          // wrapped to two lines when the locale or font stack widened
          // the wordmark by a few px.
          <div className="flex items-center gap-1.5 min-w-0">
            <BrandLobster size={18} className="shrink-0" />
            <span
              className="font-display text-sm font-bold tracking-tight whitespace-nowrap"
              style={{ color: '#ef4b58' }}
            >
              Openclaw <span className="font-medium opacity-70">Easy</span>
            </span>
          </div>
        )}
        <button
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={[
            'press-pulse ripple-glow rounded-lg transition-colors',
            'p-2 ml-2 text-muted-foreground hover:text-foreground',
            'hover:bg-white/10 dark:hover:bg-white/5',
          ].join(' ')}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {collapsed
            ? <ChevronsRight className="h-5 w-5" />
            : <ChevronsLeft  className="h-5 w-5" />}
        </button>
      </div>

      {/* Pinned top items + Groups */}
      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
        {/* Pinned-top: rendered above all groups so high-frequency
            destinations (Quick Actions = default landing page) are
            always one click away. No group header, no collapse. */}
        {pinnedTopItems.length > 0 && (
          <div className="space-y-0.5 mt-1 mb-2">
            {pinnedTopItems.map((item) => (
              <SidebarItem
                key={item.id}
                item={item}
                active={activeChannel === item.id}
                collapsed={collapsed}
                onClick={() => onSelect(item.id, item.legacyServer)}
              />
            ))}
          </div>
        )}

        {sidebarGroups.map((group) => {
          // Channel group: only show a channel row if it is currently
          // connected. 'setup' (Add channel) is always preserved so
          // the user can add more. Other groups pass through unchanged.
          const filteredItems =
            group.id === 'channels'
              ? group.items.filter((i) => i.id === 'setup' || connectedChannels.has(i.id))
              : group.items
          return (
            <SidebarGroup
              key={group.id}
              group={{ ...group, items: filteredItems }}
              collapsed={collapsed}
              expanded={expandedGroups.has(group.id)}
              activeChannel={activeChannel}
              onToggle={() => toggleGroup(group.id)}
              onSelect={onSelect}
            />
          )
        })}
      </div>

      {/* Footer — Settings (pinned, always visible) + theme toggle. */}
      <div className="border-t border-black/[0.06] dark:border-white/[0.06] p-2 space-y-0.5">
        {(() => {
          const settingsActive = activeChannel === 'settings'
          return (
            <button
              onClick={() => onSelect('settings', 'main')}
              title={collapsed ? t('nav.appSettings', 'Settings') : undefined}
              className={[
                'press-pulse ripple-glow w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[15px] font-medium transition-colors',
                settingsActive
                  ? 'bg-brand-400/10 text-foreground glow-ambient'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/10 dark:hover:bg-white/5',
              ].join(' ')}
            >
              <Settings className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{t('nav.appSettings', 'Settings')}</span>}
            </button>
          )
        })()}
        {/* Theme picker — segmented bar with all 3 modes always visible
            (System / Light / Dark). Click any to switch directly; no
            cycling. Works in both expanded and collapsed sidebar
            states; in collapsed mode the icons stack into the rail. */}
        <div
          role="group"
          aria-label="Theme"
          className={[
            'flex items-center gap-0.5 p-0.5 rounded-lg',
            'bg-black/[0.04] dark:bg-white/[0.04]',
            collapsed ? 'flex-col' : 'flex-row',
          ].join(' ')}
        >
          {themeOptions.map(({ id, Icon, label }) => {
            const active = themeMode === id
            return (
              <button
                key={id}
                onClick={() => void setMode(id)}
                aria-pressed={active}
                aria-label={label}
                title={label}
                className={[
                  'press-pulse',
                  collapsed
                    ? 'w-full flex items-center justify-center py-1.5 rounded-md'
                    : 'flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md',
                  'text-xs font-medium transition-colors',
                  active
                    ? 'bg-brand-400/15 text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-white/10 dark:hover:bg-white/[0.04]',
                ].join(' ')}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {!collapsed && <span className="hidden xl:inline">{label}</span>}
              </button>
            )
          })}
        </div>
        {/* Version badge — reopens the "What's new" dialog on demand.
            Hidden in the collapsed rail; the tray menu also shows the
            version, so nothing is lost. */}
        {!collapsed && <VersionBadge />}
      </div>
    </aside>
  )
}

function VersionBadge() {
  const { t } = useTranslation()
  const version = useWhatsNewStore((s) => s.version)
  const show = useWhatsNewStore((s) => s.show)
  if (!version) return null
  return (
    <button
      onClick={show}
      title={t('whatsNew.badgeTitle', "See what's new in this version")}
      className="w-full px-3 py-1 text-left text-[11px] font-medium text-muted-foreground/70 hover:text-muted-foreground transition-colors"
    >
      v{version}
    </button>
  )
}

function SidebarGroup({
  group,
  collapsed,
  expanded,
  activeChannel,
  onToggle,
  onSelect,
}: {
  group: SidebarGroupDef
  /** Outer sidebar collapsed state (icon-rail when true). */
  collapsed: boolean
  /** This group's open/closed state (only matters when sidebar is expanded). */
  expanded: boolean
  activeChannel: string
  onToggle: () => void
  onSelect: (id: string, legacyServer?: 'home' | 'main' | 'channels' | 'aiconfig') => void
}) {
  const resolveLabel = useLabel()
  const containsActive = group.items.some((i) => i.id === activeChannel)
  // When the outer sidebar is collapsed (icon rail), groups don't apply —
  // all items show as icons. When the sidebar is expanded, items are
  // visible only when their group is open.
  const itemsVisible = collapsed || expanded

  return (
    <div>
      {!collapsed && (
        <button
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={`sb-group-${group.id}`}
          // py-1.5 enlarges the click target to ~34px tall (was ~22px) so
          // the whole row reads as a single tap surface, not "the small
          // chevron at the end". Hover background bumped from white/5 to
          // white/10 so a hover/focus is unambiguous.
          className="press-pulse w-full flex items-center justify-between gap-2 px-3 py-1.5 mt-3 mb-0.5 rounded-md text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 hover:text-foreground hover:bg-white/10 dark:hover:bg-white/[0.06] transition-colors"
        >
          <span className="flex items-center gap-1.5">
            {resolveLabel(group)}
            {/* Pulsing brand dot when the active row lives inside a
                collapsed group — so the user can still spot where
                they are without having to open everything. */}
            {!expanded && containsActive && (
              <span className="h-1.5 w-1.5 rounded-full bg-brand-400 dark:bg-brand-500 animate-pulse" />
            )}
          </span>
          {/* Chevron grows 12 → 16px and rotates on an Apple-spring curve
              that overshoots ~6° past target before settling, giving the
              toggle the same tactile flip the rest of the app uses for
              press-pulse. */}
          <ChevronDown
            className={[
              'h-4 w-4 shrink-0 transition-transform duration-300 ease-apple-spring',
              expanded ? 'rotate-0' : '-rotate-90',
            ].join(' ')}
          />
        </button>
      )}

      {/* Animated body. The `grid-template-rows: 0fr → 1fr` trick lets
          us animate from auto-height to zero without knowing the
          measured height. Inner div needs `overflow: hidden` so content
          clips during the transition. Apple curve matches the rest of
          the app's surface-materialising motion. */}
      <div
        id={`sb-group-${group.id}`}
        className={[
          'grid transition-[grid-template-rows] duration-300 ease-apple',
          itemsVisible ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        ].join(' ')}
      >
        <div className="overflow-hidden">
          <div className="space-y-0.5">
            {group.items.map((item, idx) => (
              // Wrapper handles the stagger: each item fades + drops 2px
              // into place with a 25ms cascade delay when the group
              // opens. On close, delay is 0 so all items fade together
              // and the surface collapses crisply.
              <div
                key={item.id}
                className="transition-[opacity,transform] duration-300 ease-apple"
                style={{
                  opacity: itemsVisible ? 1 : 0,
                  transform: itemsVisible ? 'translateY(0)' : 'translateY(-2px)',
                  transitionDelay: itemsVisible ? `${idx * 25}ms` : '0ms',
                }}
              >
                <SidebarItem
                  item={item}
                  active={activeChannel === item.id}
                  collapsed={collapsed}
                  onClick={() => onSelect(item.id, item.legacyServer)}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function SidebarItem({
  item,
  active,
  collapsed,
  onClick,
}: {
  item: SidebarItemDef
  active: boolean
  collapsed: boolean
  onClick: () => void
}) {
  const Icon = item.icon
  const resolveLabel = useLabel()
  const label = resolveLabel(item)
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-label={label}
      className={[
        // press-pulse: tactile scale + coral glow on click.
        // ripple-glow: one-shot radial glow centered on the click.
        // glow-ambient (when active): soft pulsing inset glow.
        'group relative w-full flex items-center gap-3 rounded-lg px-3 py-2 text-[15px] font-medium',
        'press-pulse ripple-glow transition-colors',
        active
          ? 'bg-brand-400/10 text-foreground glow-ambient'
          : 'text-muted-foreground hover:text-foreground hover:bg-white/10 dark:hover:bg-white/5',
      ].join(' ')}
    >
      {/* Active indicator bar. Keeps a fixed h-6 footprint and grows
          out from the row's midline via scaleY 0→1 — visually it
          "materialises" rather than fading in. Apple curve matches
          the rest of the sidebar motion. Tailwind composes the
          -translate-y-1/2 with scale-y on a single transform, so both
          stay in lockstep. */}
      <span
        className={[
          'absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full bg-brand-400 dark:bg-brand-500',
          'origin-center transition-transform duration-300 ease-apple',
          active ? 'scale-y-100' : 'scale-y-0',
        ].join(' ')}
        aria-hidden
      />
      <Icon className="h-4 w-4 shrink-0" />
      <span
        className={[
          'truncate transition-opacity duration-150',
          collapsed ? 'opacity-0 w-0 pointer-events-none' : 'opacity-100',
        ].join(' ')}
      >
        {label}
      </span>
    </button>
  )
}
