import { describe, it, expect } from 'vitest'
import { validateAgentId, isPathInsideRoot } from './session-manager.helpers'

describe('validateAgentId', () => {
  it('accepts normal agent ids', () => {
    for (const id of ['main', 'bed-time', 'support', 'agent_1', 'AgentA', 'a', 'A1']) {
      expect(validateAgentId(id)).toBe(id)
    }
  })

  it('trims surrounding whitespace', () => {
    expect(validateAgentId('  main  ')).toBe('main')
  })

  it('rejects empty / whitespace-only / oversized', () => {
    expect(validateAgentId('')).toBeNull()
    expect(validateAgentId('   ')).toBeNull()
    expect(validateAgentId('a'.repeat(65))).toBeNull()
    expect(validateAgentId('a'.repeat(64))).toBe('a'.repeat(64))
  })

  it('rejects directory-traversal sequences', () => {
    expect(validateAgentId('..')).toBeNull()
    expect(validateAgentId('../etc')).toBeNull()
    expect(validateAgentId('../../etc/passwd')).toBeNull()
    expect(validateAgentId('foo/../bar')).toBeNull()
  })

  it('rejects path separators (both POSIX and Windows)', () => {
    expect(validateAgentId('foo/bar')).toBeNull()
    expect(validateAgentId('foo\\bar')).toBeNull()
  })

  it('rejects NUL bytes', () => {
    expect(validateAgentId('main\0evil')).toBeNull()
  })

  it('rejects leading dot (hidden-file vector)', () => {
    expect(validateAgentId('.hidden')).toBeNull()
    expect(validateAgentId('.')).toBeNull()
  })

  it('rejects shell metacharacters', () => {
    for (const bad of ['foo;rm', 'foo|cat', 'foo`cat`', 'foo$X', 'foo&&bar', 'foo bar', 'foo\nbar']) {
      expect(validateAgentId(bad)).toBeNull()
    }
  })

  it('rejects non-string input', () => {
    for (const bad of [null, undefined, 42, {}, [], true]) {
      expect(validateAgentId(bad)).toBeNull()
    }
  })

  it('rejects unicode characters outside the whitelist', () => {
    expect(validateAgentId('agent-é')).toBeNull()
    expect(validateAgentId('агент')).toBeNull() // Cyrillic
  })
})

describe('isPathInsideRoot', () => {
  it('accepts paths under the root', () => {
    expect(isPathInsideRoot('/var/data/agents/main/sessions/foo.json', '/var/data/agents/main')).toBe(true)
    expect(isPathInsideRoot('/var/data/agents/main', '/var/data/agents/main')).toBe(true)
  })

  it('rejects paths outside the root', () => {
    expect(isPathInsideRoot('/etc/passwd', '/var/data/agents/main')).toBe(false)
    expect(isPathInsideRoot('/var/data/agents/other/sessions/foo.json', '/var/data/agents/main')).toBe(false)
  })

  it('rejects traversal that resolves outside the root', () => {
    expect(
      isPathInsideRoot('/var/data/agents/main/../other/sessions/foo.json', '/var/data/agents/main'),
    ).toBe(false)
  })

  it('does NOT confuse a sibling whose name STARTS with the root path', () => {
    // The classic "prefix matches without separator" attack: `main-evil`
    // shares the prefix `main` with `main` but is NOT a child of it.
    expect(
      isPathInsideRoot(
        '/var/data/agents/main-evil/sessions/foo.json',
        '/var/data/agents/main',
      ),
    ).toBe(false)
  })

  it('handles trailing separators on the root gracefully', () => {
    expect(
      isPathInsideRoot('/var/data/agents/main/sessions/foo.json', '/var/data/agents/main/'),
    ).toBe(true)
  })

  it('rejects empty / non-string inputs', () => {
    expect(isPathInsideRoot('', '/root')).toBe(false)
    expect(isPathInsideRoot('/x', '')).toBe(false)
    expect(isPathInsideRoot(null as any, '/root')).toBe(false)
    expect(isPathInsideRoot('/x', null as any)).toBe(false)
  })

  it('normalises redundant path elements before comparing', () => {
    expect(
      isPathInsideRoot('/var/data//agents/main/sessions/./foo.json', '/var/data/agents/main'),
    ).toBe(true)
  })
})
