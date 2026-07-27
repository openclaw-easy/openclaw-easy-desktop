/**
 * Tests for resolveAgentHarness + the exec-policy compatibility check.
 *
 * Specifically pins the regression that broke chat on 2026-06-17: the
 * desktop pinned the `codex` harness for openai/gpt-5.5, but the user's
 * config had tools.exec.security="allowlist", which the upstream codex
 * app-server REJECTS at startup. Result: every chat attempt threw
 * "Codex app-server local execution is not available when
 * tools.exec.mode=allowlist" before the first byte of response.
 *
 * The fix: resolveAgentHarness now takes the exec context and falls
 * back to `pi` (which has no exec-policy requirement) when codex would
 * refuse to start.
 */
import { describe, it, expect } from 'vitest'
import {
  resolveAgentHarness,
  isCodexAppServerCompatible,
  readExecContextForAgent,
} from './agent-harness'

describe('isCodexAppServerCompatible', () => {
  it('returns true for an empty / undefined exec config (defaults to full)', () => {
    expect(isCodexAppServerCompatible(undefined)).toBe(true)
    expect(isCodexAppServerCompatible({})).toBe(true)
  })

  it('returns true when explicit mode is full / auto / ask', () => {
    expect(isCodexAppServerCompatible({ mode: 'full' })).toBe(true)
    expect(isCodexAppServerCompatible({ mode: 'auto' })).toBe(true)
    expect(isCodexAppServerCompatible({ mode: 'ask' })).toBe(true)
  })

  it('returns false when explicit mode is deny or allowlist', () => {
    expect(isCodexAppServerCompatible({ mode: 'deny' })).toBe(false)
    expect(isCodexAppServerCompatible({ mode: 'allowlist' })).toBe(false)
  })

  it('mirrors upstream resolveOpenClawExecModeFromPolicy for security="deny"', () => {
    // security=deny → mode=deny → REJECTED
    expect(isCodexAppServerCompatible({ security: 'deny' })).toBe(false)
    expect(isCodexAppServerCompatible({ security: 'deny', ask: 'off' })).toBe(false)
    expect(isCodexAppServerCompatible({ security: 'deny', ask: 'always' })).toBe(false)
  })

  it('mirrors upstream for security="allowlist" + ask="off" (the user\'s case)', () => {
    // The audit bug: this is the AUDIT-RECOMMENDED secure default, and
    // the desktop's old harness resolver pinned codex anyway.
    expect(isCodexAppServerCompatible({ security: 'allowlist', ask: 'off' })).toBe(false)
    expect(isCodexAppServerCompatible({ security: 'allowlist' })).toBe(false) // ask defaults to off
  })

  it('mirrors upstream for security="allowlist" + ask="on-miss" or "always" → mode=ask, compatible', () => {
    expect(isCodexAppServerCompatible({ security: 'allowlist', ask: 'on-miss' })).toBe(true)
    expect(isCodexAppServerCompatible({ security: 'allowlist', ask: 'always' })).toBe(true)
  })

  it('mirrors upstream for security="full" with various ask settings', () => {
    expect(isCodexAppServerCompatible({ security: 'full' })).toBe(true) // mode=full
    expect(isCodexAppServerCompatible({ security: 'full', ask: 'off' })).toBe(true) // mode=full
    expect(isCodexAppServerCompatible({ security: 'full', ask: 'on-miss' })).toBe(true) // mode=full
    expect(isCodexAppServerCompatible({ security: 'full', ask: 'always' })).toBe(true) // mode=ask
  })

  it('explicit mode wins over security/ask combination', () => {
    // Even with security=full, explicit mode=allowlist trips the check.
    expect(isCodexAppServerCompatible({ mode: 'allowlist', security: 'full', ask: 'off' })).toBe(
      false,
    )
  })
})

describe('resolveAgentHarness', () => {
  it('defaults to pi for empty / unknown input', () => {
    expect(resolveAgentHarness(undefined)).toBe('pi')
    expect(resolveAgentHarness('')).toBe('pi')
    expect(resolveAgentHarness(null as any)).toBe('pi')
  })

  it('picks pi for non-GPT models', () => {
    for (const model of [
      'ollama/llama3.2:3b',
      'google/gemini-3.1-pro',
      'anthropic/claude-opus-4',
      'openai/claude-haiku',
      'venice/zai-org-glm-5',
    ]) {
      expect(resolveAgentHarness(model)).toBe('pi')
    }
  })

  it('picks codex for GPT / o-series models when exec is permissive (default)', () => {
    expect(resolveAgentHarness('openai/gpt-5.5')).toBe('codex')
    expect(resolveAgentHarness('openai/gpt-5.4-mini')).toBe('codex')
    expect(resolveAgentHarness('openai/gpt-oss-120b')).toBe('codex')
    expect(resolveAgentHarness('openai/o3')).toBe('codex')
    expect(resolveAgentHarness('openai/o4-mini')).toBe('codex')
    expect(resolveAgentHarness('codex')).toBe('codex')
  })

  it('falls back to pi when codex would refuse the exec policy (the regression)', () => {
    // Exact shape from the user's broken config: security="allowlist"
    // with no ask (defaults to off) → upstream maps to mode=allowlist →
    // codex rejects.
    expect(
      resolveAgentHarness('openai/gpt-5.5', { security: 'allowlist' }),
    ).toBe('pi')
    // And with the secondary fields set explicitly.
    expect(
      resolveAgentHarness('openai/gpt-5.5', { security: 'allowlist', ask: 'off' }),
    ).toBe('pi')
    expect(
      resolveAgentHarness('openai/gpt-5.5', { security: 'deny' }),
    ).toBe('pi')
    expect(
      resolveAgentHarness('openai/gpt-5.5', { mode: 'allowlist' }),
    ).toBe('pi')
  })

  it('still picks codex when exec policy is restrictive but with ask=on-miss/always (mode=ask)', () => {
    // mode=ask is codex-compatible.
    expect(
      resolveAgentHarness('openai/gpt-5.5', { security: 'allowlist', ask: 'on-miss' }),
    ).toBe('codex')
    expect(
      resolveAgentHarness('openai/gpt-5.5', { security: 'allowlist', ask: 'always' }),
    ).toBe('codex')
  })

  it('does not let exec policy upgrade pi to codex', () => {
    // Restrictive exec on a non-GPT model is still pi (no change in behavior).
    expect(resolveAgentHarness('ollama/llama3.2:3b', { security: 'allowlist' })).toBe('pi')
    expect(resolveAgentHarness('anthropic/claude-opus-4', { mode: 'allowlist' })).toBe('pi')
  })
})

describe('readExecContextForAgent', () => {
  const baseConfig = () => ({
    tools: { exec: { security: 'allowlist' } },
    agents: {
      list: [
        { id: 'main', tools: { exec: { security: 'allowlist' } } },
        { id: 'sandbox', tools: { exec: { security: 'full' } } },
        { id: 'no-override' },
      ],
    },
  })

  it('returns undefined when neither global nor agent-level exec is set', () => {
    expect(readExecContextForAgent({}, 'main')).toBeUndefined()
    expect(readExecContextForAgent({ agents: { list: [] } }, 'main')).toBeUndefined()
  })

  it('returns the global tools.exec when agent has no override', () => {
    const cfg = baseConfig()
    const ctx = readExecContextForAgent(cfg, 'no-override')
    expect(ctx).toEqual({ security: 'allowlist' })
  })

  it('lets the agent layer override the global (matches user config)', () => {
    // User's prod config has both global tools.exec AND
    // agents.list[0].tools.exec, both with security=allowlist. After
    // merge: still allowlist. Codex still refuses.
    const cfg = baseConfig()
    const ctx = readExecContextForAgent(cfg, 'main')
    expect(ctx).toEqual({ security: 'allowlist' })
  })

  it('honors a per-agent loosened policy', () => {
    const cfg = baseConfig()
    const ctx = readExecContextForAgent(cfg, 'sandbox')
    expect(ctx).toEqual({ security: 'full' })
  })

  it('drops security/ask when agent layer sets explicit mode (schema exclusivity)', () => {
    const cfg = {
      tools: { exec: { security: 'full', ask: 'off' } },
      agents: { list: [{ id: 'main', tools: { exec: { mode: 'allowlist' } } }] },
    }
    const ctx = readExecContextForAgent(cfg, 'main')
    expect(ctx).toEqual({ mode: 'allowlist' })
  })

  it('tolerates missing / malformed structure without throwing', () => {
    expect(readExecContextForAgent(null, 'main')).toBeUndefined()
    expect(readExecContextForAgent(undefined as any, 'main')).toBeUndefined()
    expect(readExecContextForAgent({ tools: 'not-an-object' }, 'main')).toBeUndefined()
    expect(
      readExecContextForAgent({ agents: { list: [{ id: 'main', tools: 42 }] } }, 'main'),
    ).toBeUndefined()
  })
})

describe('end-to-end: the user-config bug (audit 2026-06-17)', () => {
  it('reproduces the bug and confirms the fix', () => {
    // Exact prod config from the audit:
    //   tools.exec: { host: "gateway", security: "allowlist" }
    //   agents.list[0].tools.exec: { host: "gateway", security: "allowlist" }
    //   agents.list[0].id: "main", model.primary: "openai/gpt-5.5"
    const cfg = {
      tools: { exec: { host: 'gateway', security: 'allowlist' } },
      agents: {
        list: [
          {
            id: 'main',
            tools: { exec: { host: 'gateway', security: 'allowlist' } },
            model: { primary: 'openai/gpt-5.5' },
          },
        ],
      },
    }
    const ctx = readExecContextForAgent(cfg, 'main')
    expect(ctx).toEqual({ host: 'gateway', security: 'allowlist' })
    // BEFORE the fix, resolveAgentHarness returned 'codex' here →
    // codex app-server refused → chat broken.
    expect(resolveAgentHarness('openai/gpt-5.5', ctx)).toBe('pi')
  })
})
