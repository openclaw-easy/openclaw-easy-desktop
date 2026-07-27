import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Cpu,
  MessageSquare,
} from 'lucide-react'
import { ColorTheme, LogEntry } from '../types'
import {
  parseActivityEvents,
  type ActivityEvent,
  type ActivityKind,
  type ActivityTone,
  type ActivityChannel,
} from '../activity-events'
import { BrandLobster } from '../../ui/brand-lobster'

interface ActivitySectionProps {
  colors: ColorTheme
  logs: LogEntry[]
  /**
   * Optional navigation callback. When set, rows with a `goto` target
   * become clickable and jump the user to the relevant channel page.
   * Threaded down from the dashboard so this section stays decoupled
   * from the layout shell.
   */
  onJump?: (server: string, channel: string) => void
}

type FilterId = 'all' | 'messages' | 'system' | 'errors'

const FILTERS: ReadonlyArray<{ id: FilterId; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'messages', label: 'Messages' },
  { id: 'system', label: 'System' },
  { id: 'errors', label: 'Errors' },
]

/** Channel brand colors used for the channel pill on each row. */
const CHANNEL_BADGE: Record<ActivityChannel, { bg: string; fg: string; label: string }> = {
  telegram: { bg: '#229ED915', fg: '#229ED9', label: 'Telegram' },
  whatsapp: { bg: '#25D36615', fg: '#25D366', label: 'WhatsApp' },
  discord:  { bg: '#5865F215', fg: '#7B83F5', label: 'Discord'  },
  slack:    { bg: '#ECB22E15', fg: '#ECB22E', label: 'Slack'    },
  feishu:   { bg: '#00B1B015', fg: '#00B1B0', label: 'Feishu'   },
  line:     { bg: '#06C75515', fg: '#06C755', label: 'LINE'     },
}

export const ActivitySection: React.FC<ActivitySectionProps> = ({
  colors,
  logs,
  onJump,
}) => {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [filter, setFilter] = useState<FilterId>('all')

  const allEvents = useMemo(() => parseActivityEvents(logs, 200), [logs])

  // Per-filter counts so chips can show "Messages 12" without re-walking
  // the array per chip.
  const counts = useMemo(() => {
    const c = { all: allEvents.length, messages: 0, system: 0, errors: 0 }
    for (const e of allEvents) {
      if (e.kind === 'inbound' || e.kind === 'outbound') c.messages++
      else if (e.tone === 'error' || e.kind === 'error') c.errors++
      else c.system++
    }
    return c
  }, [allEvents])

  const events = useMemo(() => {
    if (filter === 'all') return allEvents
    if (filter === 'messages')
      return allEvents.filter((e) => e.kind === 'inbound' || e.kind === 'outbound')
    if (filter === 'errors')
      return allEvents.filter((e) => e.tone === 'error' || e.kind === 'error')
    // system: everything else (status, system, cron when not erroring)
    return allEvents.filter(
      (e) =>
        e.kind !== 'inbound' &&
        e.kind !== 'outbound' &&
        e.tone !== 'error' &&
        e.kind !== 'error',
    )
  }, [allEvents, filter])

  // Group events by their relative-time "bucket" so the timeline reads
  // like a chat history: "Just now", "Earlier today", etc., with the
  // newest bucket at the top.
  const grouped = useMemo(() => groupByTimeBucket(events), [events])

  // Auto-scroll to top when a new event arrives, but only if the user
  // is already near the top — preserves their scroll position when
  // they're reading older entries.
  useEffect(() => {
    const c = scrollRef.current
    if (!c) return
    if (c.scrollTop < 50) c.scrollTop = 0
  }, [events.length])

  return (
    <div className="p-8 h-full flex flex-col">
      <div
        className="rounded-lg flex-1 flex flex-col min-h-0"
        style={{ backgroundColor: colors.bg.secondary }}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 flex-shrink-0">
          <div className="flex items-baseline gap-3">
            <h3
              className="text-lg font-semibold"
              style={{ color: colors.text.header }}
            >
              {t('activity.title', 'Activity Log')}
            </h3>
            <span className="text-sm" style={{ color: colors.text.muted }}>
              {t('activity.subtitle', 'Real-time events from your assistant')}
            </span>
          </div>

          {/* Filter chips */}
          <div className="mt-4 flex flex-wrap gap-2">
            {FILTERS.map((f) => {
              const active = filter === f.id
              const count = counts[f.id]
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className="text-xs px-2.5 py-1.5 rounded-full border transition-colors flex items-center gap-1.5"
                  style={{
                    backgroundColor: active ? colors.accent.brand : colors.bg.tertiary,
                    color: active ? '#ffffff' : colors.text.normal,
                    borderColor: active ? colors.accent.brand : colors.bg.hover,
                  }}
                >
                  {f.label}
                  <span
                    className="tabular-nums text-[10px] px-1 rounded"
                    style={{
                      color: active ? '#ffffff' : colors.text.muted,
                      opacity: 0.85,
                    }}
                  >
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 px-6 pb-6 min-h-0">
          <div
            className="rounded-lg relative h-full"
            style={{ backgroundColor: colors.bg.primary }}
          >
            <div
              ref={scrollRef}
              className="absolute inset-0 overflow-y-auto activity-section-scroll px-4 py-3 scroll-smooth"
            >
              {events.length === 0 ? (
                <ActivityEmptyState colors={colors} filter={filter} />
              ) : (
                <div className="space-y-4">
                  {grouped.map((group) => (
                    <section key={group.bucket}>
                      <div
                        className="flex items-center gap-3 mb-1.5 px-1"
                      >
                        <span
                          className="text-[10px] uppercase tracking-[0.18em] font-semibold whitespace-nowrap"
                          style={{ color: colors.text.muted }}
                        >
                          {group.bucket}
                        </span>
                        <div
                          className="flex-1 h-px"
                          style={{ backgroundColor: colors.bg.tertiary, opacity: 0.5 }}
                        />
                      </div>
                      <ul>
                        {group.items.map((ev) => (
                          <ActivityRow
                            key={ev.id}
                            event={ev}
                            colors={colors}
                            onJump={onJump}
                          />
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Row ─────────────────────────────────────────────────────────────

function ActivityRow({
  event,
  colors,
  onJump,
}: {
  event: ActivityEvent
  colors: ColorTheme
  onJump?: (server: string, channel: string) => void
}) {
  const tint = toneToColor(event.tone, colors)
  const Icon = iconFor(event.kind, event.tone)
  const clickable = !!event.goto && !!onJump
  const badge = event.channel ? CHANNEL_BADGE[event.channel] : null
  return (
    <li
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={() => {
        if (event.goto && onJump) onJump(event.goto.server, event.goto.channel)
      }}
      onKeyDown={(e) => {
        if (event.goto && onJump && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onJump(event.goto.server, event.goto.channel)
        }
      }}
      className={`activity-section-row ${clickable ? 'activity-section-row-clickable' : ''} animate-rail-in`}
    >
      <span className="activity-section-icon" style={{ color: tint }}>
        <Icon size={15} strokeWidth={2.2} />
      </span>
      {badge ? (
        <span
          className="activity-section-pill"
          style={{ backgroundColor: badge.bg, color: badge.fg }}
        >
          {badge.label}
        </span>
      ) : (
        <span
          className="activity-section-pill"
          style={{ backgroundColor: colors.bg.tertiary, color: colors.text.muted }}
        >
          {event.kind === 'cron' ? 'Cron' : event.kind === 'system' ? 'System' : 'Gateway'}
        </span>
      )}
      <div className="activity-section-body">
        <div
          className="activity-section-title"
          style={{ color: colors.text.normal }}
        >
          {event.title}
        </div>
        {event.detail && (
          <div
            className="activity-section-detail"
            style={{ color: colors.text.muted }}
          >
            {event.detail}
          </div>
        )}
      </div>
      <span
        className="activity-section-time tabular-nums"
        style={{ color: colors.text.muted }}
        title={event.timestamp.toLocaleString()}
      >
        {formatRelative(event.timestamp)}
      </span>
    </li>
  )
}

function ActivityEmptyState({
  colors,
  filter,
}: {
  colors: ColorTheme
  filter: FilterId
}) {
  const messages: Record<FilterId, { title: string; sub: string }> = {
    all:      { title: 'No activity yet',         sub: 'Send your bot a message — replies, channel events, and errors all show up here.' },
    messages: { title: 'No messages yet',         sub: 'Inbound and outbound messages from any connected channel will appear here.' },
    errors:   { title: 'No errors. Nice work.',   sub: 'When something goes wrong, it shows up here so you can fix it fast.' },
    system:   { title: 'Nothing system-y yet',    sub: 'Gateway lifecycle, model switches, and cron firings appear here.' },
  }
  const m = messages[filter]
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6 py-8">
      <div className="select-none mb-3" aria-hidden>
        <BrandLobster size={56} />
      </div>
      <div
        className="text-base font-medium mb-1"
        style={{ color: colors.text.normal }}
      >
        {m.title}
      </div>
      <div
        className="text-sm max-w-md leading-relaxed"
        style={{ color: colors.text.muted }}
      >
        {m.sub}
      </div>
    </div>
  )
}

// ── helpers ─────────────────────────────────────────────────────────

function iconFor(kind: ActivityKind, tone: ActivityTone) {
  if (tone === 'error') return AlertTriangle
  if (kind === 'inbound') return ArrowDownLeft
  if (kind === 'outbound') return ArrowUpRight
  if (kind === 'cron') return Clock
  if (kind === 'system') return Cpu
  if (kind === 'status' && tone === 'positive') return CheckCircle2
  if (kind === 'status') return Activity
  return MessageSquare
}

function toneToColor(tone: ActivityTone, colors: ColorTheme): string {
  switch (tone) {
    case 'positive':
      return colors.accent.green
    case 'warning':
      return colors.accent.yellow
    case 'error':
      return colors.accent.red
    default:
      return colors.text.muted
  }
}

function formatRelative(d: Date): string {
  const diff = Date.now() - d.getTime()
  if (diff < 5_000) return 'now'
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

/**
 * Group events by relative-time bucket so the timeline reads like a chat
 * thread. Buckets are coarse on purpose — we want a calm timeline, not a
 * minute-by-minute breakdown that fragments related events.
 */
function groupByTimeBucket(
  events: ActivityEvent[],
): Array<{ bucket: string; items: ActivityEvent[] }> {
  const out: Array<{ bucket: string; items: ActivityEvent[] }> = []
  for (const e of events) {
    const bucket = bucketFor(e.timestamp)
    const last = out[out.length - 1]
    if (last && last.bucket === bucket) {
      last.items.push(e)
    } else {
      out.push({ bucket, items: [e] })
    }
  }
  return out
}

function bucketFor(d: Date): string {
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return 'Just now'
  if (diff < 5 * 60_000) return 'Last few minutes'
  if (diff < 60 * 60_000) return 'Past hour'
  if (diff < 6 * 60 * 60_000) return 'Earlier today'
  if (diff < 24 * 60 * 60_000) return 'Today'
  if (diff < 2 * 24 * 60 * 60_000) return 'Yesterday'
  return 'Earlier'
}
