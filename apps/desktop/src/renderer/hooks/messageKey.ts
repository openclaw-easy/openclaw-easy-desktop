// Module-scoped monotonic counter — guarantees globally-unique React
// keys for chat messages, regardless of whether upstream sources
// (gateway history-load, server-issued message ids, multi-event chat
// streams) occasionally emit colliding `id` values.
//
// The bug this prevents: prior code used `msg.id || \`${Date.now()}\``
// as a React key. When the gateway issued bare-timestamp ids, two
// messages arriving in the same millisecond produced duplicate keys
// and React's reconciler logged
//   "Encountered two children with the same key, `1778685233440`"
// then collapsed both into one rendered bubble.
//
// The counter resets on page reload — fine because React keys only
// need to be unique within a single render tree's lifetime.

let messageKeySeq = 0

/**
 * Build a globally-unique React key for a chat message.
 *
 * @param prefix      Short tag describing the message origin
 *                    (`msg`, `usr`, `err`, `timeout`, `hist`, …).
 *                    Used only for human-readable debugging — uniqueness
 *                    comes from the monotonic counter.
 * @param upstreamId  Optional id provided by the gateway or history
 *                    payload. Preserved in the key for traceability,
 *                    never relied upon for uniqueness.
 *
 * Examples:
 *   nextMessageKey('usr')                → "usr-1778685233440-42"
 *   nextMessageKey('hist', 1778685233440) → "hist-1778685233440-43"
 *   nextMessageKey('hist', 1778685233440) → "hist-1778685233440-44"  ← still unique
 */
export function nextMessageKey(prefix = 'msg', upstreamId?: string | number | null): string {
  const seq = ++messageKeySeq
  if (upstreamId !== undefined && upstreamId !== null && upstreamId !== '') {
    return `${prefix}-${upstreamId}-${seq}`
  }
  return `${prefix}-${Date.now()}-${seq}`
}
