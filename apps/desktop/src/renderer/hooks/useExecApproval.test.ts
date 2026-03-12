import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  parseExecApprovalRequested,
  parseExecApprovalResolved,
  pruneExecApprovalQueue,
  addExecApproval,
  removeExecApproval,
  type ExecApprovalRequest,
} from './useExecApproval'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(
  id: string,
  command = 'echo hello',
  overrides: Partial<ExecApprovalRequest> = {},
): ExecApprovalRequest {
  return {
    id,
    request: {
      command,
      cwd: '/tmp',
      host: 'localhost',
      security: null,
      ask: null,
      agentId: null,
      resolvedPath: null,
      sessionKey: null,
    },
    createdAtMs: Date.now(),
    expiresAtMs: Date.now() + 30_000,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// parseExecApprovalRequested
// ---------------------------------------------------------------------------

describe('parseExecApprovalRequested', () => {
  it('parses a valid payload', () => {
    const payload = {
      id: 'abc-123',
      request: {
        command: 'rm -rf /tmp/test',
        cwd: '/home/user',
        host: 'desktop',
        security: 'sandbox',
        ask: 'always',
        agentId: 'agent-1',
        resolvedPath: '/usr/bin/rm',
        sessionKey: 'sess-1',
      },
      createdAtMs: 1000,
      expiresAtMs: 31000,
    }

    const result = parseExecApprovalRequested(payload)
    expect(result).not.toBeNull()
    expect(result!.id).toBe('abc-123')
    expect(result!.request.command).toBe('rm -rf /tmp/test')
    expect(result!.request.cwd).toBe('/home/user')
    expect(result!.request.host).toBe('desktop')
    expect(result!.request.security).toBe('sandbox')
    expect(result!.request.ask).toBe('always')
    expect(result!.request.agentId).toBe('agent-1')
    expect(result!.request.resolvedPath).toBe('/usr/bin/rm')
    expect(result!.request.sessionKey).toBe('sess-1')
    expect(result!.createdAtMs).toBe(1000)
    expect(result!.expiresAtMs).toBe(31000)
  })

  it('returns null for non-object payloads', () => {
    expect(parseExecApprovalRequested(null)).toBeNull()
    expect(parseExecApprovalRequested(undefined)).toBeNull()
    expect(parseExecApprovalRequested('string')).toBeNull()
    expect(parseExecApprovalRequested(42)).toBeNull()
  })

  it('returns null when id is missing or empty', () => {
    expect(parseExecApprovalRequested({
      request: { command: 'ls' },
      createdAtMs: 1000,
      expiresAtMs: 2000,
    })).toBeNull()

    expect(parseExecApprovalRequested({
      id: '   ',
      request: { command: 'ls' },
      createdAtMs: 1000,
      expiresAtMs: 2000,
    })).toBeNull()
  })

  it('returns null when request is not an object', () => {
    expect(parseExecApprovalRequested({
      id: 'abc',
      request: 'not-an-object',
      createdAtMs: 1000,
      expiresAtMs: 2000,
    })).toBeNull()
  })

  it('returns null when command is missing or empty', () => {
    expect(parseExecApprovalRequested({
      id: 'abc',
      request: { command: '' },
      createdAtMs: 1000,
      expiresAtMs: 2000,
    })).toBeNull()

    expect(parseExecApprovalRequested({
      id: 'abc',
      request: { command: '   ' },
      createdAtMs: 1000,
      expiresAtMs: 2000,
    })).toBeNull()

    expect(parseExecApprovalRequested({
      id: 'abc',
      request: {},
      createdAtMs: 1000,
      expiresAtMs: 2000,
    })).toBeNull()
  })

  it('returns null when timestamps are zero or missing', () => {
    expect(parseExecApprovalRequested({
      id: 'abc',
      request: { command: 'ls' },
      createdAtMs: 0,
      expiresAtMs: 2000,
    })).toBeNull()

    expect(parseExecApprovalRequested({
      id: 'abc',
      request: { command: 'ls' },
      createdAtMs: 1000,
      expiresAtMs: 0,
    })).toBeNull()

    expect(parseExecApprovalRequested({
      id: 'abc',
      request: { command: 'ls' },
    })).toBeNull()
  })

  it('trims id and command', () => {
    const result = parseExecApprovalRequested({
      id: '  abc  ',
      request: { command: '  ls -la  ' },
      createdAtMs: 1000,
      expiresAtMs: 2000,
    })
    expect(result!.id).toBe('abc')
    expect(result!.request.command).toBe('ls -la')
  })

  it('sets optional string fields to null when missing or wrong type', () => {
    const result = parseExecApprovalRequested({
      id: 'abc',
      request: { command: 'ls', cwd: 123, host: true },
      createdAtMs: 1000,
      expiresAtMs: 2000,
    })
    expect(result!.request.cwd).toBeNull()
    expect(result!.request.host).toBeNull()
    expect(result!.request.security).toBeNull()
    expect(result!.request.agentId).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// parseExecApprovalResolved
// ---------------------------------------------------------------------------

describe('parseExecApprovalResolved', () => {
  it('parses a valid payload', () => {
    const result = parseExecApprovalResolved({
      id: 'abc-123',
      decision: 'allow-once',
      resolvedBy: 'user',
      ts: 12345,
    })
    expect(result).not.toBeNull()
    expect(result!.id).toBe('abc-123')
    expect(result!.decision).toBe('allow-once')
    expect(result!.resolvedBy).toBe('user')
    expect(result!.ts).toBe(12345)
  })

  it('returns null for non-object payloads', () => {
    expect(parseExecApprovalResolved(null)).toBeNull()
    expect(parseExecApprovalResolved(undefined)).toBeNull()
    expect(parseExecApprovalResolved('string')).toBeNull()
  })

  it('returns null when id is missing or empty', () => {
    expect(parseExecApprovalResolved({})).toBeNull()
    expect(parseExecApprovalResolved({ id: '' })).toBeNull()
    expect(parseExecApprovalResolved({ id: '   ' })).toBeNull()
  })

  it('sets optional fields to null when wrong type', () => {
    const result = parseExecApprovalResolved({
      id: 'abc',
      decision: 123,
      resolvedBy: true,
      ts: 'not-a-number',
    })
    expect(result!.decision).toBeNull()
    expect(result!.resolvedBy).toBeNull()
    expect(result!.ts).toBeNull()
  })

  it('accepts minimal payload with just id', () => {
    const result = parseExecApprovalResolved({ id: 'abc' })
    expect(result).not.toBeNull()
    expect(result!.id).toBe('abc')
    expect(result!.decision).toBeNull()
    expect(result!.resolvedBy).toBeNull()
    expect(result!.ts).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// pruneExecApprovalQueue
// ---------------------------------------------------------------------------

describe('pruneExecApprovalQueue', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('removes expired entries', () => {
    vi.setSystemTime(10_000)
    const expired = makeEntry('a', 'echo a', { expiresAtMs: 5_000 })
    const alive = makeEntry('b', 'echo b', { expiresAtMs: 20_000 })

    const result = pruneExecApprovalQueue([expired, alive])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('b')
  })

  it('returns empty array when all expired', () => {
    vi.setSystemTime(100_000)
    const a = makeEntry('a', 'echo a', { expiresAtMs: 5_000 })
    const b = makeEntry('b', 'echo b', { expiresAtMs: 10_000 })

    expect(pruneExecApprovalQueue([a, b])).toEqual([])
  })

  it('keeps all entries when none are expired', () => {
    vi.setSystemTime(1_000)
    const a = makeEntry('a', 'echo a', { expiresAtMs: 50_000 })
    const b = makeEntry('b', 'echo b', { expiresAtMs: 60_000 })

    expect(pruneExecApprovalQueue([a, b])).toHaveLength(2)
  })

  it('handles empty queue', () => {
    expect(pruneExecApprovalQueue([])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// addExecApproval
// ---------------------------------------------------------------------------

describe('addExecApproval', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('adds an entry to an empty queue', () => {
    vi.setSystemTime(1_000)
    const entry = makeEntry('a')
    const result = addExecApproval([], entry)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('a')
  })

  it('replaces an existing entry with the same id', () => {
    vi.setSystemTime(1_000)
    const old = makeEntry('a', 'echo old')
    const updated = makeEntry('a', 'echo new')

    const result = addExecApproval([old], updated)
    expect(result).toHaveLength(1)
    expect(result[0].request.command).toBe('echo new')
  })

  it('appends when id is different', () => {
    vi.setSystemTime(1_000)
    const a = makeEntry('a', 'echo a')
    const b = makeEntry('b', 'echo b')

    const result = addExecApproval([a], b)
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('a')
    expect(result[1].id).toBe('b')
  })

  it('prunes expired entries when adding', () => {
    vi.setSystemTime(10_000)
    const expired = makeEntry('old', 'echo old', { expiresAtMs: 5_000 })
    const fresh = makeEntry('new', 'echo new', { expiresAtMs: 60_000 })

    const result = addExecApproval([expired], fresh)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('new')
  })
})

// ---------------------------------------------------------------------------
// removeExecApproval
// ---------------------------------------------------------------------------

describe('removeExecApproval', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('removes the entry with the given id', () => {
    vi.setSystemTime(1_000)
    const a = makeEntry('a', 'echo a')
    const b = makeEntry('b', 'echo b')

    const result = removeExecApproval([a, b], 'a')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('b')
  })

  it('returns same queue when id not found', () => {
    vi.setSystemTime(1_000)
    const a = makeEntry('a')
    const result = removeExecApproval([a], 'nonexistent')
    expect(result).toHaveLength(1)
  })

  it('handles empty queue', () => {
    expect(removeExecApproval([], 'a')).toEqual([])
  })

  it('also prunes expired entries while removing', () => {
    vi.setSystemTime(10_000)
    const expired = makeEntry('expired', 'echo old', { expiresAtMs: 5_000 })
    const alive = makeEntry('alive', 'echo alive', { expiresAtMs: 60_000 })
    const target = makeEntry('target', 'echo target', { expiresAtMs: 60_000 })

    const result = removeExecApproval([expired, alive, target], 'target')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('alive')
  })
})
