/**
 * Agent runtime / harness configuration helpers.
 *
 * Upstream openclaw's zod schema (2026.6+) places per-agent harness pinning
 * under `agents.list.*.models.*.agentRuntime` — keyed by the model ref the
 * harness applies to. Previously the desktop wrote a single top-level
 * `agents.list.*.agentRuntime`. That field is still typed as optional in
 * `types.agents.ts` but `AgentEntrySchema` is strict zod and REJECTS it at
 * config-load time, crashing the gateway with:
 *
 *   agents.list.0: Unrecognized key: "agentRuntime"
 *
 * This module owns:
 *   - {@link setAgentRuntime}     — the only place that writes the canonical location
 *   - {@link getAgentRuntime}     — reads the canonical location, falls back to legacy
 *   - {@link migrateLegacyAgentRuntime} — one-shot idempotent migration that moves
 *                                   any legacy top-level field into the per-model slot
 *
 * All three are pure — no IO. Callers own the IO around them.
 */

export type AgentEntry = Record<string, any>;
export type OpenClawConfig = Record<string, any>;

import { listAgents, ensureAgent } from "./agent-roster";

export interface AgentRuntimeMigrationResult {
  /** True iff the config was structurally modified. */
  changed: boolean;
  /** Human-readable lines describing what moved/dropped, one per entry touched. */
  warnings: string[];
}

/**
 * Write the canonical agent-runtime pin: per-model under
 * `entry.models[modelRef].agentRuntime = { id: harnessId }`.
 *
 * Idempotent — no-op when the slot already holds the same id.
 * Initializes intermediate `models` / `models[modelRef]` objects on demand.
 */
export function setAgentRuntime(
  entry: AgentEntry,
  modelRef: string,
  harnessId: string,
): void {
  if (!entry.models || typeof entry.models !== "object") {
    entry.models = {};
  }
  const slot = entry.models[modelRef];
  if (!slot || typeof slot !== "object") {
    entry.models[modelRef] = { agentRuntime: { id: harnessId } };
    return;
  }
  if (!slot.agentRuntime || slot.agentRuntime.id !== harnessId) {
    slot.agentRuntime = { id: harnessId };
  }
}

/**
 * Read the canonical agent-runtime pin for `modelRef`. Falls back to the
 * legacy top-level `entry.agentRuntime.id` so in-flight reads against a
 * not-yet-migrated config still surface the right harness.
 */
export function getAgentRuntime(
  entry: AgentEntry,
  modelRef: string,
): string | undefined {
  const canonical = entry?.models?.[modelRef]?.agentRuntime?.id;
  if (typeof canonical === "string" && canonical.length > 0) return canonical;
  const legacy = entry?.agentRuntime?.id;
  return typeof legacy === "string" && legacy.length > 0 ? legacy : undefined;
}

/**
 * One-shot idempotent migration. Walks `config.agents.list[]` and for each
 * entry carrying a legacy top-level `agentRuntime`:
 *   - moves it into `entry.models[primary].agentRuntime` where `primary`
 *     is the entry's resolved primary-model ref (falling back to
 *     `agents.defaults.model.primary` when the entry has none), AND
 *   - deletes the legacy field.
 *
 * If no primary model can be resolved for an entry, the legacy field is
 * deleted unconditionally — keeping it would crash the gateway and we have
 * no slot to migrate it under.
 *
 * Returns `{ changed: true, warnings: [...] }` when at least one entry was
 * modified. Safe to call on every gateway-start: a clean config returns
 * `{ changed: false, warnings: [] }`.
 */
export function migrateLegacyAgentRuntime(
  config: OpenClawConfig,
): AgentRuntimeMigrationResult {
  const result: AgentRuntimeMigrationResult = { changed: false, warnings: [] };
  // Roster may still be the legacy array on an unmigrated config; listAgents
  // normalises both shapes, and ensureAgent hands back the live canonical
  // entry so the mutations below land in agents.entries.
  const rosterIds = listAgents(config as any).map((entry) => entry.id);
  if (rosterIds.length === 0) return result;
  const list = rosterIds.map((id) => {
    const live = ensureAgent(config as any, id) as AgentEntry;
    return { id, entry: live };
  });

  const defaultsPrimary: unknown = config?.agents?.defaults?.model?.primary;
  const fallbackPrimary =
    typeof defaultsPrimary === "string" && defaultsPrimary.length > 0
      ? defaultsPrimary
      : undefined;

  for (const { id: entryId, entry } of list) {
    if (!entry || typeof entry !== "object") continue;

    const legacy = entry.agentRuntime?.id;
    const hasLegacyField = entry.agentRuntime !== undefined;
    if (!hasLegacyField) continue;

    if (typeof legacy !== "string" || legacy.length === 0) {
      // Malformed legacy field — strip it, don't migrate. Gateway would reject either way.
      delete entry.agentRuntime;
      result.changed = true;
      result.warnings.push(
        `Removed malformed agents.entries["${entryId}"].agentRuntime (missing id)`,
      );
      continue;
    }

    const modelRef: string | undefined =
      typeof entry?.model?.primary === "string" ? entry.model.primary : fallbackPrimary;

    if (modelRef) {
      setAgentRuntime(entry, modelRef, legacy);
      result.warnings.push(
        `Migrated agents.entries["${entryId}"].agentRuntime { id: "${legacy}" } → models["${modelRef}"].agentRuntime`,
      );
    } else {
      result.warnings.push(
        `Dropped agents.entries["${entryId}"].agentRuntime { id: "${legacy}" } — no primary model to pin under`,
      );
    }

    delete entry.agentRuntime;
    result.changed = true;
  }

  return result;
}
