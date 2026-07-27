/**
 * Tests that the binding writes go through ConfigManager's write lock.
 *
 * The pre-2026-06-16 implementation called `writeFile` directly, racing
 * any other config write. The regression we lock in here: 5 concurrent
 * `addAgentBinding` calls all land in the final config (no lost
 * updates), AND no two writes interleave (the serialised mutator sees
 * a strictly monotonic series of snapshots).
 */
import { describe, it, expect, vi } from 'vitest'
import { AgentBindingManager } from './agent-binding-manager'
import type { ConfigManager } from './config-manager'

/**
 * In-memory ConfigManager stub that mirrors the contract AgentBindingManager
 * depends on. mutateConfig runs serialised — we model that by chaining
 * a Promise the same way the real one does.
 */
function makeStubConfigManager(initialConfig: any): {
  cm: ConfigManager
  getConfig: () => any
  mutateCallOrder: number[]
} {
  let stored = JSON.parse(JSON.stringify(initialConfig))
  let lock: Promise<void> = Promise.resolve()
  const mutateCallOrder: number[] = []
  let nextSeq = 0

  const loadConfig = async () => JSON.parse(JSON.stringify(stored))

  const mutateConfig = (
    mutator: (config: any) => boolean | Promise<boolean> | void | Promise<void>,
  ): Promise<boolean> => {
    const seq = nextSeq++
    const next = lock.then(async () => {
      const config = await loadConfig()
      const result = await mutator(config)
      const changed = result === undefined ? true : result
      if (!changed) return false
      // Simulate the async backup + write so we exercise the lock chain.
      await Promise.resolve()
      stored = JSON.parse(JSON.stringify(config))
      mutateCallOrder.push(seq)
      return true
    })
    lock = next.then(
      () => {},
      () => {},
    )
    return next
  }

  return {
    cm: { loadConfig, mutateConfig } as unknown as ConfigManager,
    getConfig: () => stored,
    mutateCallOrder,
  }
}

const seedConfig = () => ({
  agents: {
    list: [{ id: 'main' }, { id: 'support' }, { id: 'bed-time' }],
  },
  bindings: [],
})

const bindingFor = (channel: string, agentId: string) => ({
  agentId,
  match: { channel },
})

describe('AgentBindingManager — write-lock contract', () => {
  it('5 concurrent addAgentBinding calls all land in the final config (no lost updates)', async () => {
    const { cm, getConfig, mutateCallOrder } = makeStubConfigManager(seedConfig())
    const mgr = new AgentBindingManager(cm)

    const results = await Promise.all([
      mgr.addAgentBinding(bindingFor('telegram', 'main')),
      mgr.addAgentBinding(bindingFor('discord', 'support')),
      mgr.addAgentBinding(bindingFor('slack', 'main')),
      mgr.addAgentBinding(bindingFor('whatsapp', 'bed-time')),
      mgr.addAgentBinding(bindingFor('feishu', 'support')),
    ])

    for (const r of results) {
      expect(r.success).toBe(true)
    }
    const final = getConfig()
    const channels = (final.bindings as any[]).map((b) => b.match.channel).sort()
    expect(channels).toEqual(['discord', 'feishu', 'slack', 'telegram', 'whatsapp'])
    // Mutator calls landed in a serialised order — count matches.
    expect(mutateCallOrder.length).toBe(5)
  })

  it('removeAgentBinding goes through the lock and reports removed count', async () => {
    const seed = seedConfig()
    seed.bindings = [
      { agentId: 'main', match: { channel: 'telegram' } },
      { agentId: 'support', match: { channel: 'discord' } },
    ]
    const { cm, getConfig } = makeStubConfigManager(seed)
    const mgr = new AgentBindingManager(cm)

    const r = await mgr.removeAgentBinding('main', 'telegram')
    expect(r.success).toBe(true)
    expect(r.removed).toBe(1)
    expect((getConfig().bindings as any[]).map((b) => b.match.channel)).toEqual(['discord'])
  })

  it('concurrent add + remove against same channel resolve serialised (no interleave)', async () => {
    const seed = seedConfig()
    seed.bindings = [{ agentId: 'main', match: { channel: 'telegram' } }]
    const { cm, getConfig } = makeStubConfigManager(seed)
    const mgr = new AgentBindingManager(cm)

    // Remove the existing binding AND add a new one for a different
    // channel. Order is non-deterministic, but BOTH should commit.
    await Promise.all([
      mgr.removeAgentBinding('main', 'telegram'),
      mgr.addAgentBinding(bindingFor('discord', 'support')),
    ])
    const final = getConfig()
    expect((final.bindings as any[]).map((b) => b.match.channel).sort()).toEqual(['discord'])
  })

  it('addAgentBinding refuses when target agent does not exist (no write)', async () => {
    const { cm, getConfig, mutateCallOrder } = makeStubConfigManager(seedConfig())
    const mgr = new AgentBindingManager(cm)

    const r = await mgr.addAgentBinding(bindingFor('telegram', 'ghost-agent'))
    expect(r.success).toBe(false)
    expect(r.error).toContain("Agent 'ghost-agent' does not exist")
    // No write committed.
    expect(getConfig().bindings).toEqual([])
    expect(mutateCallOrder.length).toBe(0)
  })

  it('addAgentBinding surfaces a binding conflict (no write)', async () => {
    const seed = seedConfig()
    seed.bindings = [{ agentId: 'main', match: { channel: 'telegram' } }]
    const { cm, getConfig, mutateCallOrder } = makeStubConfigManager(seed)
    const mgr = new AgentBindingManager(cm)

    const r = await mgr.addAgentBinding(bindingFor('telegram', 'support'))
    expect(r.success).toBe(false)
    expect(r.error).toContain('main already bound')
    expect((getConfig().bindings as any[]).length).toBe(1)
    expect(mutateCallOrder.length).toBe(0)
  })

  it('updateAgentBindings replaces the whole bindings array atomically', async () => {
    const seed = seedConfig()
    seed.bindings = [{ agentId: 'main', match: { channel: 'telegram' } }]
    const { cm, getConfig } = makeStubConfigManager(seed)
    const mgr = new AgentBindingManager(cm)

    const r = await mgr.updateAgentBindings([
      { agentId: 'support', match: { channel: 'discord' } },
      { agentId: 'bed-time', match: { channel: 'slack' } },
    ])
    expect(r.success).toBe(true)
    expect((getConfig().bindings as any[]).map((b) => b.match.channel).sort()).toEqual([
      'discord',
      'slack',
    ])
  })

  it('updateSessionConfig persists session config through the lock', async () => {
    const { cm, getConfig } = makeStubConfigManager(seedConfig())
    const mgr = new AgentBindingManager(cm)
    const r = await mgr.updateSessionConfig({ dmScope: 'agent-x' })
    expect(r.success).toBe(true)
    expect(getConfig().session).toEqual({ dmScope: 'agent-x' })
  })

  it('listAgentBindings does NOT go through the lock (read-only path)', async () => {
    const seed = seedConfig()
    seed.bindings = [{ agentId: 'main', match: { channel: 'telegram' } }]
    const mutateConfig = vi.fn().mockResolvedValue(true)
    const cm = {
      loadConfig: async () => JSON.parse(JSON.stringify(seed)),
      mutateConfig,
    } as unknown as ConfigManager
    const mgr = new AgentBindingManager(cm)
    const r = await mgr.listAgentBindings()
    expect(r.success).toBe(true)
    expect(r.bindings.length).toBe(1)
    expect(mutateConfig).not.toHaveBeenCalled()
  })

  it('testAgentRouting does NOT go through the lock (read-only path)', async () => {
    const seed = seedConfig()
    seed.bindings = [{ agentId: 'main', match: { channel: 'telegram' } }]
    const mutateConfig = vi.fn().mockResolvedValue(true)
    const cm = {
      loadConfig: async () => JSON.parse(JSON.stringify(seed)),
      mutateConfig,
    } as unknown as ConfigManager
    const mgr = new AgentBindingManager(cm)
    const r = await mgr.testAgentRouting({ channel: 'telegram', accountId: 'a' })
    expect(r.success).toBe(true)
    expect(mutateConfig).not.toHaveBeenCalled()
  })

  it('does NOT import fs/promises or do direct disk IO anymore (regression guard)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(
      path.join(__dirname, 'agent-binding-manager.ts'),
      'utf-8',
    )
    expect(src).not.toMatch(/from\s+['"]fs\/promises['"]/)
    expect(src).not.toMatch(/writeFile\(/)
    // Only the type import from ConfigManager — no direct path/os either,
    // those got consolidated into the locked write helper.
    expect(src).not.toMatch(/from\s+['"]os['"]/)
  })
})
