import type { LogEntry } from './types'

/**
 * Activity events power the live right-side rail on the home page.
 *
 * The gateway log stream is noisy (every config reload, every webchat
 * tick, every liveness warning). The rail filters that down to events a
 * non-technical user would actually care to *watch* their bot do —
 * messages in, replies out, channel connections, model switches, errors
 * worth surfacing.
 *
 * This module is pure and free of React imports so it's easy to unit
 * test. The component just renders whatever this returns.
 */

export type ActivityChannel =
  | 'telegram'
  | 'whatsapp'
  | 'discord'
  | 'slack'
  | 'feishu'
  | 'line'

export type ActivityKind =
  | 'inbound'
  | 'outbound'
  | 'status'
  | 'system'
  | 'cron'
  | 'error'

export type ActivityTone = 'positive' | 'neutral' | 'warning' | 'error'

export interface ActivityEvent {
  id: string
  /** When the event happened — best-effort, parsed from the log timestamp. */
  timestamp: Date
  channel?: ActivityChannel
  kind: ActivityKind
  /** Short, single-line title. Always present. */
  title: string
  /** Optional secondary text (truncated by the renderer). */
  detail?: string
  tone: ActivityTone
  /** When the user clicks the row, where to navigate. */
  goto?: { server: string; channel: string }
}

const CHANNELS: ActivityChannel[] = [
  'telegram',
  'whatsapp',
  'discord',
  'slack',
  'feishu',
  'line',
]

function logText(log: LogEntry): string {
  if (typeof log === 'string') return log
  return log?.message || log?.fullEntry || ''
}

function parseTimestamp(text: string): Date | null {
  const m = text.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:\d{2}|Z)?)/)
  if (!m) return null
  const d = new Date(m[1])
  return Number.isNaN(d.getTime()) ? null : d
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function formatHandle(raw: string, channel: ActivityChannel): string {
  const trimmed = raw.trim()
  if (channel === 'telegram') {
    return trimmed.startsWith('@') ? trimmed : `@${trimmed}`
  }
  if (channel === 'whatsapp') {
    // Whatsapp handles are E.164-ish; keep as-is.
    return trimmed
  }
  return trimmed
}

function gotoForChannel(channel: ActivityChannel): { server: string; channel: string } {
  // Channels other than telegram have a "-channel" suffix in the
  // dashboard's activeChannel registry (see OpenclawEasyDashboard).
  // Telegram and whatsapp use the bare channel id; the rest get suffixed.
  const id =
    channel === 'telegram' || channel === 'whatsapp'
      ? channel
      : `${channel}-channel`
  return { server: 'channels', channel: id }
}

/**
 * Parse one log line into an ActivityEvent, or null if it should be
 * filtered out. Patterns are tried in priority order — first match wins.
 *
 * Exported separately so tests can hit it directly.
 */
export function parseActivityLine(text: string, fallbackTs: Date, idSeq: number): ActivityEvent | null {
  if (!text || typeof text !== 'string') return null
  const ts = parseTimestamp(text) ?? fallbackTs

  // ── Channel: inbound/outbound message ─────────────────────────────
  // Two log shapes exist in the wild:
  //   1. [telegram] Inbound message from @user (...)        — has "from"
  //   2. [whatsapp] Inbound message +1555... -> +44...      — no "from", arrow-separated
  // Try shape 1 first; if it fails for a known channel, try shape 2.
  for (const ch of CHANNELS) {
    const inboundFrom = text.match(
      new RegExp(`\\[${ch}\\]\\s+Inbound message.*?from\\s+([@+\\w\\d\\-:.]+)`, 'i'),
    )
    if (inboundFrom) {
      return {
        id: `act-${idSeq}`,
        timestamp: ts,
        channel: ch,
        kind: 'inbound',
        tone: 'neutral',
        title: `${formatHandle(inboundFrom[1], ch)} sent a message`,
        detail: capitalize(ch),
        goto: gotoForChannel(ch),
      }
    }

    const inboundArrow = text.match(
      new RegExp(`\\[${ch}\\]\\s+Inbound message\\s+([@+\\w\\d\\-:.]+)\\s*->`, 'i'),
    )
    if (inboundArrow) {
      return {
        id: `act-${idSeq}`,
        timestamp: ts,
        channel: ch,
        kind: 'inbound',
        tone: 'neutral',
        title: `${formatHandle(inboundArrow[1], ch)} sent a message`,
        detail: capitalize(ch),
        goto: gotoForChannel(ch),
      }
    }

    const outboundTo = text.match(
      new RegExp(`\\[${ch}\\]\\s+(?:Outbound|Sent|Sending|Auto-replied)[^\\n]*?(?:to\\s+)([@+\\w\\d\\-:.]+)`, 'i'),
    )
    if (outboundTo) {
      return {
        id: `act-${idSeq}`,
        timestamp: ts,
        channel: ch,
        kind: 'outbound',
        tone: 'positive',
        title: `Replied to ${formatHandle(outboundTo[1], ch)}`,
        detail: capitalize(ch),
        goto: gotoForChannel(ch),
      }
    }

    // Outbound arrow-form (whatsapp): [whatsapp] Outbound message +X -> +Y
    const outboundArrow = text.match(
      new RegExp(`\\[${ch}\\]\\s+Outbound message\\s+[@+\\w\\d\\-:.]+\\s*->\\s*([@+\\w\\d\\-:.]+)`, 'i'),
    )
    if (outboundArrow) {
      return {
        id: `act-${idSeq}`,
        timestamp: ts,
        channel: ch,
        kind: 'outbound',
        tone: 'positive',
        title: `Replied to ${formatHandle(outboundArrow[1], ch)}`,
        detail: capitalize(ch),
        goto: gotoForChannel(ch),
      }
    }
  }

  // ── Channel start ────────────────────────────────────────────────
  const channelStart = text.match(
    /\[(\w+)\]\s+\[([^\]]+)\]\s+starting provider(?:\s*\(([^)]+)\))?/i,
  )
  if (channelStart) {
    const ch = channelStart[1].toLowerCase() as ActivityChannel
    if (CHANNELS.includes(ch)) {
      return {
        id: `act-${idSeq}`,
        timestamp: ts,
        channel: ch,
        kind: 'status',
        tone: 'positive',
        title: `${capitalize(ch)} connecting`,
        detail: channelStart[3] || channelStart[2],
        goto: gotoForChannel(ch),
      }
    }
  }

  // ── Gateway lifecycle ────────────────────────────────────────────
  if (/\[gateway\]\s+ready\b/i.test(text)) {
    return {
      id: `act-${idSeq}`,
      timestamp: ts,
      kind: 'status',
      tone: 'positive',
      title: 'Gateway online',
    }
  }
  if (/\[shutdown\]\s+started/i.test(text)) {
    return {
      id: `act-${idSeq}`,
      timestamp: ts,
      kind: 'status',
      tone: 'warning',
      title: 'Gateway shutting down',
    }
  }

  // ── Model switch ────────────────────────────────────────────────
  const modelSwitch = text.match(/\[gateway\]\s+agent model:\s+([^\s(]+)/i)
  if (modelSwitch) {
    return {
      id: `act-${idSeq}`,
      timestamp: ts,
      kind: 'system',
      tone: 'neutral',
      title: `Using model ${modelSwitch[1]}`,
    }
  }

  // ── Cron firing ─────────────────────────────────────────────────
  const cronFire = text.match(/\[cron:([^\]]+)\]\s+(?:firing|fired|executing|delivered)/i)
  if (cronFire) {
    return {
      id: `act-${idSeq}`,
      timestamp: ts,
      kind: 'cron',
      tone: 'positive',
      title: 'Cron job ran',
      detail: cronFire[1].slice(0, 16),
      goto: { server: 'main', channel: 'cron' },
    }
  }

  // ── Cron failure (chat not found etc.) ───────────────────────────
  const cronFail = text.match(/\[cron:[^\]]+\]\s+delivery (?:failed|payload failed)[^:]*:\s+(.+)/i)
  if (cronFail) {
    return {
      id: `act-${idSeq}`,
      timestamp: ts,
      kind: 'error',
      tone: 'error',
      title: 'Cron delivery failed',
      detail: cronFail[1].slice(0, 80),
      goto: { server: 'main', channel: 'cron' },
    }
  }

  // ── Embedded agent failure ──────────────────────────────────────
  const agentErr = text.match(
    /embedded run agent end[^\n]*?isError=true[^\n]*?error=([^\n]+?)(?:\s+rawError=|$)/i,
  )
  if (agentErr) {
    return {
      id: `act-${idSeq}`,
      timestamp: ts,
      kind: 'error',
      tone: 'error',
      title: 'Reply failed',
      detail: agentErr[1].slice(0, 80),
    }
  }

  // ── Channel dispatch failure ─────────────────────────────────────
  const dispatchFail = text.match(/\[(\w+)\]\s+dispatch failed:\s+(.+)/i)
  if (dispatchFail) {
    const ch = dispatchFail[1].toLowerCase() as ActivityChannel
    if (CHANNELS.includes(ch)) {
      return {
        id: `act-${idSeq}`,
        timestamp: ts,
        channel: ch,
        kind: 'error',
        tone: 'error',
        title: `${capitalize(ch)} dispatch failed`,
        detail: dispatchFail[2].slice(0, 80),
        goto: gotoForChannel(ch),
      }
    }
  }

  // ── Telegram polling conflict (the "another bot is polling" 409) ─
  // Real-world shapes seen in production logs:
  //   [telegram] Polling stall detected (no getUpdates for 912.35s)
  //   [telegram][diag] polling cycle error reason=getUpdates conflict
  //   [telegram] Telegram getUpdates conflict: terminated by other getUpdates request
  // The bracketed prefix can be just [telegram] or glued [telegram][diag].
  if (/\[telegram\](?:\[\w+\])?\s+.*?(?:Polling stall|getUpdates conflict|polling cycle error[^\n]*conflict|terminated by other getUpdates)/i.test(text)) {
    return {
      id: `act-${idSeq}`,
      timestamp: ts,
      channel: 'telegram',
      kind: 'error',
      tone: 'error',
      title: 'Telegram polling conflict',
      detail: 'Another instance may be polling this bot',
      goto: gotoForChannel('telegram'),
    }
  }

  // ── Generic fallback ─────────────────────────────────────────────
  // Anything that didn't match a specific pattern still becomes a
  // system row. The user wants every gateway log line to appear, just
  // dressed up — pills, icons, tone colors — so the log reads like a
  // designed timeline instead of raw plaintext. No filtering here on
  // purpose; the grouping/visuals do the readability work.
  const stripped = text.replace(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:\d{2}|Z)?\s*/,
    '',
  )
  const tagMatch = stripped.match(/^\[([^\]]+)\]\s*(.*)$/)
  const subsystem = tagMatch ? tagMatch[1] : null
  const body = (tagMatch ? tagMatch[2] : stripped).trim()
  if (!body) return null

  // Heuristic tone from the body text.
  const tone: ActivityTone =
    /\b(error|fail|failed|exception|timeout|timed out|denied|rejected)\b/i.test(body)
      ? 'error'
      : /\b(warn|warning|deprecated|stale)\b/i.test(body)
        ? 'warning'
        : 'neutral'

  return {
    id: `act-${idSeq}`,
    timestamp: ts,
    kind: tone === 'error' ? 'error' : 'system',
    tone,
    title: body.length > 200 ? body.slice(0, 200) + '…' : body,
    detail: subsystem || undefined,
  }
}

/**
 * Parse the full log array into a newest-first list of activity events.
 * Caps to `limit` (default 100) so the rail stays performant on long
 * sessions where the gateway log can grow into thousands of entries.
 */
export function parseActivityEvents(
  logs: LogEntry[],
  limit: number = 100,
): ActivityEvent[] {
  const out: ActivityEvent[] = []
  const fallbackTs = new Date()
  let seq = 0
  for (const log of logs) {
    const text = logText(log)
    const ev = parseActivityLine(text, fallbackTs, seq++)
    if (ev) out.push(ev)
  }
  // Newest-first
  out.reverse()
  return out.slice(0, limit)
}
