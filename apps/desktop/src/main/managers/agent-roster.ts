/**
 * Single canonical accessor for the agent roster in `openclaw.json`.
 *
 * Upstream migrated the roster from a legacy array to a keyed map:
 *
 *   legacy:    agents.list    = [{ id: 'main', ... }]
 *   canonical: agents.entries = { main: { default: true, ... } }
 *
 * (see upstream `src/config/legacy.roster.ts` — "Moved agents.list to keyed
 * agents.entries"). `openclaw doctor --fix` performs the migration, and the
 * desktop runs that automatically on launch, so a build that reads only the
 * legacy shape loses every agent the moment a user upgrades.
 *
 * Rule, per moltbot-easy/CLAUDE.md: **reads tolerate transition, writes only
 * go to the canonical location.** Every read here falls back to `agents.list`
 * so an unmigrated config still works; every write targets `agents.entries`
 * and prunes the legacy key so the two shapes can never disagree.
 *
 * All roster access in the desktop must go through this module — scattering
 * `.find(a => a.id === x)` / `.push()` across managers is what made the
 * upstream rename a silent, app-wide breakage.
 */

/** A roster entry in array form: the keyed-map value plus its id. */
export type AgentEntry = { id: string; [key: string]: any }

function rosterContainer(config: any): any {
  if (!config.agents || typeof config.agents !== 'object') {
    config.agents = {}
  }
  return config.agents
}

/**
 * Reads the roster as an array, newest canonical shape first.
 * Returns a fresh array; mutating it does not write back to the config.
 */
export function listAgents(config: any): AgentEntry[] {
  const agents = config?.agents
  if (!agents || typeof agents !== 'object') return []

  const entries = agents.entries
  if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
    return Object.entries(entries).map(([id, value]) => ({
      ...(value && typeof value === 'object' ? value : {}),
      id,
    }))
  }

  // Transitional: a config that has not been migrated yet.
  if (Array.isArray(agents.list)) {
    return agents.list.filter((entry: any) => entry && typeof entry === 'object')
  }
  return []
}

/** Returns one entry by id, or undefined. */
export function getAgent(config: any, agentId: string): AgentEntry | undefined {
  return listAgents(config).find((entry) => entry.id === agentId)
}

export function hasAgent(config: any, agentId: string): boolean {
  return getAgent(config, agentId) !== undefined
}

/**
 * Ensures `agents.entries` exists and holds the whole roster, migrating a
 * legacy `agents.list` in place and removing it. Returns the entries map so
 * callers can mutate a single agent directly.
 */
export function ensureCanonicalRoster(config: any): Record<string, any> {
  const agents = rosterContainer(config)
  if (!agents.entries || typeof agents.entries !== 'object' || Array.isArray(agents.entries)) {
    agents.entries = {}
  }
  if (Array.isArray(agents.list)) {
    for (const entry of agents.list) {
      if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') continue
      const { id, ...rest } = entry
      // Existing canonical data wins — never let a stale legacy array
      // clobber entries that were already migrated.
      agents.entries[id] = { ...rest, ...(agents.entries[id] ?? {}) }
    }
    delete agents.list
  }
  return agents.entries
}

/**
 * Creates the entry if absent and returns it for mutation. The id lives in the
 * key, so the returned object deliberately has no `id` field.
 */
export function ensureAgent(config: any, agentId: string): Record<string, any> {
  const entries = ensureCanonicalRoster(config)
  if (!entries[agentId] || typeof entries[agentId] !== 'object') {
    entries[agentId] = {}
  }
  return entries[agentId]
}

/** Removes an agent. Returns true when something was actually removed. */
export function deleteAgent(config: any, agentId: string): boolean {
  const entries = ensureCanonicalRoster(config)
  if (!(agentId in entries)) return false
  delete entries[agentId]
  return true
}

/**
 * Replaces the whole roster from an array of `{id, ...}` entries, writing the
 * canonical shape. Entries without a string id are skipped.
 */
export function setAgents(config: any, agents: readonly AgentEntry[]): void {
  const entries = ensureCanonicalRoster(config)
  for (const key of Object.keys(entries)) delete entries[key]
  for (const entry of agents) {
    if (!entry || typeof entry.id !== 'string') continue
    const { id, ...rest } = entry
    entries[id] = rest
  }
}

/** True when the roster holds no agents. */
export function isRosterEmpty(config: any): boolean {
  return listAgents(config).length === 0
}
