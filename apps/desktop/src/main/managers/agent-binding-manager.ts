import type { ConfigManager } from './config-manager'
import { listAgents } from './agent-roster'

/**
 * AgentBindingManager - Manages agent bindings and routing.
 *
 * Audit context (W1.7): pre-2026-06-16 every write here called
 * `readFile` + `writeFile` directly on `~/.openclaw/openclaw.json`,
 * bypassing `ConfigManager.withWriteLock`. A concurrent IPC handler
 * (e.g. `config:save`, `auth:sync-remote-backend`, or another binding
 * mutation from a different tab) would race the binding write and
 * silently lose either side's changes — last writer wins.
 *
 * Current contract: EVERY write goes through `configManager.mutateConfig`
 * which serialises load → mutate → backup → validate → write under the
 * shared lock. Reads still load directly because the read path doesn't
 * need the lock (a stale snapshot is fine for a list / test-routing
 * call; the next write under the lock will resolve any divergence).
 */
export class AgentBindingManager {
  constructor(private readonly configManager: ConfigManager) {}

  async listAgentBindings(): Promise<any> {
    try {
      const config = await this.configManager.loadConfig()

      const bindings = Array.isArray(config.bindings) ? config.bindings : []
      const enrichedBindings = bindings.map((binding: any) => ({
        ...binding,
        description: this.describeBinding(binding),
        normalizedAgentId: this.normalizeAgentId(binding.agentId),
      }))

      return { success: true, bindings: enrichedBindings }
    } catch (error: any) {
      console.error('[AgentBindingManager] Error listing agent bindings:', error)
      return { success: false, error: error.message, bindings: [] }
    }
  }

  async addAgentBinding(binding: any): Promise<any> {
    try {
      // Capture validation/conflict outcome from inside the mutator so
      // we can return it to the caller after the locked write commits.
      let outcome: { added: any[]; skipped: any[]; conflicts: any[] } | null = null
      let earlyError: string | null = null

      await this.configManager.mutateConfig((config: any) => {
        // Validate agent exists
        const agents = listAgents(config)
        const agentExists = agents.some(
          (agent: any) =>
            this.normalizeAgentId(agent.id) === this.normalizeAgentId(binding.agentId),
        )
        if (!agentExists) {
          earlyError = `Agent '${binding.agentId}' does not exist. Create the agent first.`
          return false // no write
        }

        if (!Array.isArray(config.bindings)) {
          config.bindings = []
        }

        const result = this.applyAgentBindings(config, [binding])
        if (result.conflicts.length > 0) {
          outcome = { added: [], skipped: [], conflicts: result.conflicts }
          return false // no write — surface conflict to caller
        }

        // Mutate the config in place — applyAgentBindings returned a new
        // bindings array; copy it onto the locked config object.
        config.bindings = result.config.bindings
        outcome = { added: result.added, skipped: result.skipped, conflicts: [] }
        return true
      })

      if (earlyError) {
        return { success: false, error: earlyError }
      }
      if (outcome && outcome.conflicts.length > 0) {
        return {
          success: false,
          error: `Binding conflict: ${outcome.conflicts[0].existingAgentId} already bound to this channel/account`,
          conflicts: outcome.conflicts,
        }
      }
      return {
        success: true,
        added: outcome?.added ?? [],
        skipped: outcome?.skipped ?? [],
      }
    } catch (error: any) {
      console.error('[AgentBindingManager] Error adding agent binding:', error)
      return { success: false, error: error.message }
    }
  }

  async removeAgentBinding(agentId: string, channel: string): Promise<any> {
    try {
      let removedCount = 0
      await this.configManager.mutateConfig((config: any) => {
        if (!Array.isArray(config.bindings)) {
          return false
        }
        const before = config.bindings.length
        const normalizedTarget = this.normalizeAgentId(agentId)
        config.bindings = config.bindings.filter((b: any) => {
          return !(
            this.normalizeAgentId(b.agentId) === normalizedTarget &&
            b.match?.channel === channel
          )
        })
        removedCount = before - config.bindings.length
        return removedCount > 0
      })
      return { success: true, removed: removedCount }
    } catch (error: any) {
      console.error('[AgentBindingManager] Error removing agent binding:', error)
      return { success: false, error: error.message }
    }
  }

  async updateAgentBindings(bindings: any[]): Promise<any> {
    try {
      let outcome: { added: any[]; skipped: any[]; conflicts: any[] } | null = null
      let earlyError: string | null = null

      await this.configManager.mutateConfig((config: any) => {
        // Validate all agents exist
        const agents = listAgents(config)
        const agentIds = new Set(
          agents.map((agent: any) => this.normalizeAgentId(agent.id)),
        )
        for (const binding of bindings) {
          if (!agentIds.has(this.normalizeAgentId(binding.agentId))) {
            earlyError = `Agent '${binding.agentId}' does not exist`
            return false
          }
        }

        // Apply all bindings to a CLEARED bindings array (this method
        // replaces the whole set, not appends).
        const result = this.applyAgentBindings({ ...config, bindings: [] }, bindings)
        config.bindings = result.config.bindings
        outcome = {
          added: result.added,
          skipped: result.skipped,
          conflicts: result.conflicts,
        }
        return true
      })

      if (earlyError) {
        return { success: false, error: earlyError }
      }
      return {
        success: true,
        added: outcome?.added ?? [],
        skipped: outcome?.skipped ?? [],
        conflicts: outcome?.conflicts ?? [],
      }
    } catch (error: any) {
      console.error('[AgentBindingManager] Error updating agent bindings:', error)
      return { success: false, error: error.message }
    }
  }

  async testAgentRouting(params: any): Promise<any> {
    try {
      const config = await this.configManager.loadConfig()

      const route = this.resolveAgentRoute({
        cfg: config,
        channel: params.channel,
        accountId: params.accountId || null,
        peer: params.peerId
          ? { kind: params.peerKind || 'dm', id: params.peerId }
          : null,
        parentPeer: params.parentPeerId
          ? { kind: params.parentPeerKind || 'dm', id: params.parentPeerId }
          : null,
        guildId: params.guildId || null,
        teamId: params.teamId || null,
        memberRoleIds: params.memberRoleIds || [],
      })

      return { success: true, route }
    } catch (error: any) {
      console.error('[AgentBindingManager] Error testing agent routing:', error)
      return { success: false, error: error.message }
    }
  }

  async getSessionConfig(): Promise<any> {
    try {
      const config = await this.configManager.loadConfig()
      return {
        success: true,
        config: config.session || {
          dmScope: 'main',
          identityLinks: {},
        },
      }
    } catch (error: any) {
      console.error('[AgentBindingManager] Error getting session config:', error)
      return { success: false, error: error.message }
    }
  }

  async updateSessionConfig(sessionConfig: any): Promise<any> {
    try {
      await this.configManager.mutateConfig((config: any) => {
        config.session = sessionConfig
        return true
      })
      return { success: true }
    } catch (error: any) {
      console.error('[AgentBindingManager] Error updating session config:', error)
      return { success: false, error: error.message }
    }
  }

  // Helper methods
  private describeBinding(binding: any): string {
    const match = binding.match
    const parts = [match.channel]
    if (match.accountId) {
      parts.push(`accountId=${match.accountId}`)
    }
    if (match.peer) {
      parts.push(`peer=${match.peer.kind}:${match.peer.id}`)
    }
    if (match.guildId) {
      parts.push(`guild=${match.guildId}`)
    }
    if (match.teamId) {
      parts.push(`team=${match.teamId}`)
    }
    return parts.join(' ')
  }

  private normalizeAgentId(value?: string): string {
    const trimmed = (value ?? '').trim()
    if (!trimmed) {
      return 'main'
    }
    // Keep it path-safe + shell-friendly.
    const validIdRe = /^[a-z0-9][a-z0-9_-]{0,63}$/i
    if (validIdRe.test(trimmed)) {
      return trimmed.toLowerCase()
    }
    // Best-effort fallback: collapse invalid characters to "-"
    const invalidCharsRe = /[^a-z0-9_-]+/g
    const leadingDashRe = /^-+/
    const trailingDashRe = /-+$/

    return (
      trimmed
        .toLowerCase()
        .replace(invalidCharsRe, '-')
        .replace(leadingDashRe, '')
        .replace(trailingDashRe, '')
        .slice(0, 64) || 'main'
    )
  }

  private applyAgentBindings(config: any, bindings: any[]): any {
    const existing = config.bindings ?? []
    const existingMatchMap = new Map<string, string>()

    for (const binding of existing) {
      const key = this.bindingMatchKey(binding.match)
      if (!existingMatchMap.has(key)) {
        existingMatchMap.set(key, this.normalizeAgentId(binding.agentId))
      }
    }

    const added: any[] = []
    const skipped: any[] = []
    const conflicts: Array<{ binding: any; existingAgentId: string }> = []

    for (const binding of bindings) {
      const agentId = this.normalizeAgentId(binding.agentId)
      const key = this.bindingMatchKey(binding.match)
      const existingAgentId = existingMatchMap.get(key)

      if (existingAgentId) {
        if (existingAgentId === agentId) {
          skipped.push(binding)
        } else {
          conflicts.push({ binding, existingAgentId })
        }
        continue
      }

      existingMatchMap.set(key, agentId)
      added.push({ ...binding, agentId })
    }

    if (added.length === 0) {
      return { config, added, skipped, conflicts }
    }

    return {
      config: {
        ...config,
        bindings: [...existing, ...added],
      },
      added,
      skipped,
      conflicts,
    }
  }

  private bindingMatchKey(match: any): string {
    const accountId = match.accountId?.trim() || 'default'
    return [
      match.channel,
      accountId,
      match.peer?.kind ?? '',
      match.peer?.id ?? '',
      match.guildId ?? '',
      match.teamId ?? '',
    ].join('|')
  }

  /**
   * Matches the core routing engine's 7-tier priority order from
   * src/routing/resolve-route.ts. Used by the "Test Routing" UI.
   */
  private resolveAgentRoute(input: any): any {
    const { cfg, channel, accountId, peer, parentPeer, guildId, teamId, memberRoleIds } = input
    const bindings = Array.isArray(cfg.bindings) ? cfg.bindings : []

    // Normalize accountId: empty/missing → "default" (matches core normalizeAccountId)
    const normalizedAccountId = (accountId || 'default').trim().toLowerCase() || 'default'

    // Filter bindings for this channel (matching account, default, or wildcard)
    const candidates = bindings.filter((b: any) => {
      if (b.match?.channel !== channel) return false
      const ba = (b.match.accountId ?? '').trim()
      if (ba === '*') return true
      // Empty accountId in binding means "default"
      const normalizedBa = ba || 'default'
      return normalizedBa === normalizedAccountId
    })

    const buildResult = (agentId: string, matchedBy: string) => {
      const resolved = this.normalizeAgentId(agentId)
      const peerPart = peer ? `:${peer.kind}:${peer.id}` : ''
      return {
        agentId: resolved,
        accountId: normalizedAccountId,
        sessionKey: `agent:${resolved}:${channel}:${normalizedAccountId}${peerPart}`,
        matchedBy,
      }
    }

    // Tier 1: binding.peer — exact peer match
    if (peer) {
      const match = candidates.find(
        (b: any) =>
          b.match.peer &&
          this.peerKindMatches(b.match.peer.kind, peer.kind) &&
          b.match.peer.id === peer.id,
      )
      if (match) return buildResult(match.agentId, 'binding.peer')
    }

    // Tier 2: binding.peer.parent — thread parent inheritance
    if (parentPeer?.id) {
      const match = candidates.find(
        (b: any) =>
          b.match.peer &&
          this.peerKindMatches(b.match.peer.kind, parentPeer.kind) &&
          b.match.peer.id === parentPeer.id,
      )
      if (match) return buildResult(match.agentId, 'binding.peer.parent')
    }

    // Tier 3: binding.guild+roles — Discord guild + role IDs
    if (guildId && memberRoleIds?.length > 0) {
      const roleSet = new Set(memberRoleIds)
      const match = candidates.find(
        (b: any) =>
          b.match.guildId === guildId &&
          Array.isArray(b.match.roles) &&
          b.match.roles.some((r: string) => roleSet.has(r)),
      )
      if (match) return buildResult(match.agentId, 'binding.guild+roles')
    }

    // Tier 4: binding.guild — Discord guild (no roles)
    if (guildId) {
      const match = candidates.find(
        (b: any) => b.match.guildId === guildId && !Array.isArray(b.match.roles),
      )
      if (match) return buildResult(match.agentId, 'binding.guild')
    }

    // Tier 5: binding.team — Slack workspace
    if (teamId) {
      const match = candidates.find((b: any) => b.match.teamId === teamId)
      if (match) return buildResult(match.agentId, 'binding.team')
    }

    // Tier 6: binding.account — account-scoped (non-wildcard, no peer/guild/team)
    const accountMatch = candidates.find((b: any) => {
      const ba = (b.match.accountId ?? '').trim()
      return ba !== '*' && !b.match.peer && !b.match.guildId && !b.match.teamId
    })
    if (accountMatch) return buildResult(accountMatch.agentId, 'binding.account')

    // Tier 7: binding.channel — channel-wide wildcard
    const channelMatch = candidates.find((b: any) => {
      const ba = (b.match.accountId ?? '').trim()
      return ba === '*' && !b.match.peer && !b.match.guildId && !b.match.teamId
    })
    if (channelMatch) return buildResult(channelMatch.agentId, 'binding.channel')

    // Fallback: default agent
    const defaultAgentId = this.getDefaultAgentId(cfg)
    return {
      agentId: defaultAgentId,
      accountId: normalizedAccountId,
      sessionKey: `agent:${defaultAgentId}:main`,
      matchedBy: 'default',
    }
  }

  /** Matches core peerKindMatches: "dm"/"direct" are equivalent, "group"/"channel" are interchangeable. */
  private peerKindMatches(bindingKind: string, scopeKind: string): boolean {
    const normalize = (k: string) => (k === 'dm' ? 'direct' : k)
    const a = normalize(bindingKind)
    const b = normalize(scopeKind)
    if (a === b) return true
    // group and channel are interchangeable in the core router
    const both = new Set([a, b])
    return both.has('group') && both.has('channel')
  }

  private getDefaultAgentId(config: any): string {
    const agents = listAgents(config)
    const defaultAgent = agents.find((agent: any) => agent.default)
    return this.normalizeAgentId(defaultAgent?.id || 'main')
  }
}
