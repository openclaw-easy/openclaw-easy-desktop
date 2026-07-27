import { describe, it, expect } from 'vitest'
import { parseActivityEvents, parseActivityLine } from './activity-events'

const T = '2026-05-10T20:30:15.123+02:00'

describe('parseActivityLine', () => {
  it('parses a Telegram inbound message into an activity event', () => {
    const ev = parseActivityLine(
      `${T} [telegram] Inbound message from @xinru (chat=12345, 42 chars)`,
      new Date(),
      0,
    )
    expect(ev).not.toBeNull()
    expect(ev?.channel).toBe('telegram')
    expect(ev?.kind).toBe('inbound')
    expect(ev?.title).toContain('@xinru')
    expect(ev?.goto).toEqual({ server: 'channels', channel: 'telegram' })
    expect(ev?.timestamp.toISOString()).toBe('2026-05-10T18:30:15.123Z')
  })

  it('parses a Telegram outbound reply', () => {
    const ev = parseActivityLine(
      `${T} [telegram] Outbound message to @xinru (text, 88 chars)`,
      new Date(),
      0,
    )
    expect(ev?.kind).toBe('outbound')
    expect(ev?.tone).toBe('positive')
    expect(ev?.title).toContain('@xinru')
  })

  it('parses Auto-replied lines too (legacy outbound shape)', () => {
    const ev = parseActivityLine(
      `${T} [telegram] Auto-replied to @xinru with bot response`,
      new Date(),
      0,
    )
    expect(ev?.kind).toBe('outbound')
  })

  it('parses WhatsApp inbound with E.164 number', () => {
    const ev = parseActivityLine(
      `${T} [whatsapp] Inbound message +15551234567 -> +442011112222 (direct, 12 chars)`,
      new Date(),
      0,
    )
    expect(ev?.channel).toBe('whatsapp')
    expect(ev?.kind).toBe('inbound')
    expect(ev?.title).toContain('+15551234567')
  })

  it('parses gateway ready as a positive status', () => {
    const ev = parseActivityLine(`${T} [gateway] ready`, new Date(), 0)
    expect(ev?.kind).toBe('status')
    expect(ev?.tone).toBe('positive')
    expect(ev?.title).toMatch(/online|ready/i)
  })

  it('parses model switch lines', () => {
    const ev = parseActivityLine(
      `${T} [gateway] agent model: openai/claude-opus (thinking=medium, fast=off)`,
      new Date(),
      0,
    )
    expect(ev?.kind).toBe('system')
    expect(ev?.title).toMatch(/openai\/claude-opus/)
  })

  it('parses agent embedded-run failures as errors', () => {
    const ev = parseActivityLine(
      `${T} [agent/embedded] embedded run agent end: runId=abc isError=true model=claude-opus provider=openai error=500 Streaming failed rawError=500 Streaming failed`,
      new Date(),
      0,
    )
    expect(ev?.kind).toBe('error')
    expect(ev?.tone).toBe('error')
    expect(ev?.title).toMatch(/Reply failed/i)
    expect(ev?.detail).toContain('500 Streaming failed')
  })

  it('parses telegram dispatch failures', () => {
    const ev = parseActivityLine(
      `${T} [telegram] dispatch failed: Error [ERR_MODULE_NOT_FOUND]: Cannot find module ...`,
      new Date(),
      0,
    )
    expect(ev?.kind).toBe('error')
    expect(ev?.channel).toBe('telegram')
    expect(ev?.title).toMatch(/dispatch failed/i)
  })

  it('parses telegram polling conflict (the 409 case)', () => {
    const ev = parseActivityLine(
      `${T} [telegram][diag] polling cycle error reason=getUpdates conflict ... terminated by other getUpdates request`,
      new Date(),
      0,
    )
    expect(ev?.kind).toBe('error')
    expect(ev?.channel).toBe('telegram')
    expect(ev?.title).toMatch(/polling conflict/i)
  })

  it('parses cron failure with detail', () => {
    const ev = parseActivityLine(
      `${T} [cron:abc-123] delivery payload failed (bestEffort): Telegram send failed: chat not found (chat_id=5569069502)`,
      new Date(),
      0,
    )
    expect(ev?.kind).toBe('error')
    expect(ev?.title).toMatch(/Cron delivery failed/i)
    expect(ev?.detail).toContain('chat not found')
    expect(ev?.goto).toEqual({ server: 'main', channel: 'cron' })
  })

  it('returns a generic event for log lines that do not match a specific pattern', () => {
    // The activity log shows EVERY gateway log line, just dressed up.
    // Lines that do not match a curated pattern fall through to the
    // generic system row with the bracketed subsystem tag as the pill.
    const ws = parseActivityLine(`${T} [ws] webchat connected conn=abc`, new Date(), 0)
    expect(ws?.kind).toBe('system')
    expect(ws?.detail).toBe('ws')
    expect(ws?.title).toMatch(/webchat connected/)

    const reload = parseActivityLine(`${T} [reload] config change detected`, new Date(), 0)
    expect(reload?.kind).toBe('system')
    expect(reload?.detail).toBe('reload')
  })

  it('returns null only for empty / whitespace input', () => {
    expect(parseActivityLine('', new Date(), 0)).toBeNull()
    expect(parseActivityLine('   ', new Date(), 0)).toBeNull()
  })

  it('detects error / warning tone in the body of generic lines', () => {
    const err = parseActivityLine(
      `${T} [agent] something failed with timeout`,
      new Date(),
      0,
    )
    expect(err?.tone).toBe('error')

    const warn = parseActivityLine(
      `${T} [config] using deprecated key`,
      new Date(),
      0,
    )
    expect(warn?.tone).toBe('warning')
  })

  it('falls back to provided timestamp when log line has none', () => {
    const fb = new Date('2026-01-01T00:00:00Z')
    const ev = parseActivityLine(
      `[telegram] Inbound message from @x (chat=1, 10 chars)`,
      fb,
      0,
    )
    expect(ev?.timestamp).toBe(fb)
  })
})

describe('parseActivityEvents', () => {
  it('returns events newest-first', () => {
    const logs = [
      `2026-05-10T10:00:00Z [telegram] Inbound message from @first (1, 5 chars)`,
      `2026-05-10T10:01:00Z [telegram] Inbound message from @second (1, 5 chars)`,
      `2026-05-10T10:02:00Z [telegram] Inbound message from @third (1, 5 chars)`,
    ]
    const events = parseActivityEvents(logs)
    expect(events).toHaveLength(3)
    expect(events[0].title).toContain('@third')
    expect(events[2].title).toContain('@first')
  })

  it('caps to the configured limit', () => {
    const logs = Array.from({ length: 250 }, (_, i) =>
      `2026-05-10T10:00:0${i % 10}Z [telegram] Inbound message from @u${i} (chat=1, 1 chars)`,
    )
    const events = parseActivityEvents(logs, 50)
    expect(events).toHaveLength(50)
  })

  it('keeps every non-empty log line as an event (curated or generic fallback)', () => {
    const logs = [
      `[ws] webchat connected`,
      `[reload] config change detected`,
      `[telegram] Inbound message from @real (chat=1, 5 chars)`,
      `[diagnostic] liveness warning`,
    ]
    const events = parseActivityEvents(logs)
    // All 4 lines produce events. The curated telegram match gets the
    // rich treatment; the other 3 fall through to the generic system row.
    expect(events).toHaveLength(4)
    const realMsg = events.find((e) => e.title.includes('@real'))
    expect(realMsg?.kind).toBe('inbound')
    expect(realMsg?.channel).toBe('telegram')
  })

  it('drops only completely empty lines', () => {
    const logs = ['', '   ', '\n', `[gateway] starting`]
    const events = parseActivityEvents(logs)
    expect(events).toHaveLength(1)
  })
})
