import { describe, it, expect } from "vitest";
import {
  setAgentRuntime,
  getAgentRuntime,
  migrateLegacyAgentRuntime,
} from "./agent-runtime-config";

/**
 * Roster reader for assertions. Production code now writes the canonical keyed
 * map `agents.entries` (upstream retired the `agents.list` array), while these
 * fixtures still seed the legacy shape on purpose so the transitional read path
 * stays covered. Object key order preserves insertion order, so index access
 * matches the order entries were migrated in.
 */
function rosterEntries(cfg: any): any[] {
  const entries = cfg?.agents?.entries
  if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
    return Object.entries(entries).map(([id, value]: any) => ({ id, ...(value as any) }))
  }
  return Array.isArray(cfg?.agents?.list) ? cfg.agents.list : []
}
const agentAt = (cfg: any, index: number): any => rosterEntries(cfg)[index]

describe("setAgentRuntime", () => {
  it("creates models record and per-model slot when missing", () => {
    const entry: any = { id: "main" };
    setAgentRuntime(entry, "openai/gpt-5", "codex");
    expect(entry.models["openai/gpt-5"].agentRuntime).toEqual({ id: "codex" });
  });

  it("is idempotent when the same id is written twice", () => {
    const entry: any = { id: "main", models: { "openai/gpt-5": { agentRuntime: { id: "codex" } } } };
    const before = entry.models["openai/gpt-5"].agentRuntime;
    setAgentRuntime(entry, "openai/gpt-5", "codex");
    // Should not allocate a new object on no-op write.
    expect(entry.models["openai/gpt-5"].agentRuntime).toBe(before);
  });

  it("overwrites an existing different id", () => {
    const entry: any = { id: "main", models: { "openai/gpt-5": { agentRuntime: { id: "codex" } } } };
    setAgentRuntime(entry, "openai/gpt-5", "pi");
    expect(entry.models["openai/gpt-5"].agentRuntime).toEqual({ id: "pi" });
  });

  it("does not clobber unrelated keys on the per-model slot", () => {
    const entry: any = {
      id: "main",
      models: { "openai/gpt-5": { agentRuntime: { id: "codex" }, customField: 42 } },
    };
    setAgentRuntime(entry, "openai/gpt-5", "pi");
    expect(entry.models["openai/gpt-5"].customField).toBe(42);
  });
});

describe("getAgentRuntime", () => {
  it("returns canonical per-model value when present", () => {
    const entry: any = { models: { "openai/gpt-5": { agentRuntime: { id: "codex" } } } };
    expect(getAgentRuntime(entry, "openai/gpt-5")).toBe("codex");
  });

  it("falls back to legacy top-level field", () => {
    const entry: any = { agentRuntime: { id: "codex-legacy" } };
    expect(getAgentRuntime(entry, "openai/gpt-5")).toBe("codex-legacy");
  });

  it("prefers canonical over legacy when both are set", () => {
    const entry: any = {
      agentRuntime: { id: "legacy-stale" },
      models: { "openai/gpt-5": { agentRuntime: { id: "canonical" } } },
    };
    expect(getAgentRuntime(entry, "openai/gpt-5")).toBe("canonical");
  });

  it("returns undefined when neither is set", () => {
    expect(getAgentRuntime({}, "openai/gpt-5")).toBeUndefined();
  });
});

describe("migrateLegacyAgentRuntime", () => {
  it("returns { changed: false } on a clean config", () => {
    const config: any = { agents: { list: [{ id: "main", model: { primary: "openai/gpt-5" } }] } };
    const result = migrateLegacyAgentRuntime(config);
    expect(result.changed).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it("moves legacy agentRuntime to per-model slot using entry primary", () => {
    const config: any = {
      agents: {
        list: [
          { id: "main", model: { primary: "openai/gpt-5" }, agentRuntime: { id: "codex" } },
        ],
      },
    };
    const result = migrateLegacyAgentRuntime(config);
    expect(result.changed).toBe(true);
    expect(agentAt(config, 0).agentRuntime).toBeUndefined();
    expect(agentAt(config, 0).models["openai/gpt-5"].agentRuntime).toEqual({ id: "codex" });
  });

  it("falls back to defaults.model.primary when entry has no primary", () => {
    const config: any = {
      agents: {
        defaults: { model: { primary: "anthropic/claude-3" } },
        list: [{ id: "main", agentRuntime: { id: "pi" } }],
      },
    };
    const result = migrateLegacyAgentRuntime(config);
    expect(result.changed).toBe(true);
    expect(agentAt(config, 0).models["anthropic/claude-3"].agentRuntime).toEqual({ id: "pi" });
  });

  it("drops legacy field when no primary model is available", () => {
    const config: any = {
      agents: { list: [{ id: "main", agentRuntime: { id: "codex" } }] },
    };
    const result = migrateLegacyAgentRuntime(config);
    expect(result.changed).toBe(true);
    expect(agentAt(config, 0).agentRuntime).toBeUndefined();
    expect(result.warnings[0]).toMatch(/no primary model/i);
  });

  it("strips malformed legacy field (missing id) without migrating", () => {
    const config: any = {
      agents: { list: [{ id: "main", model: { primary: "openai/gpt-5" }, agentRuntime: {} }] },
    };
    const result = migrateLegacyAgentRuntime(config);
    expect(result.changed).toBe(true);
    expect(agentAt(config, 0).agentRuntime).toBeUndefined();
    expect(agentAt(config, 0).models?.["openai/gpt-5"]?.agentRuntime).toBeUndefined();
    expect(result.warnings[0]).toMatch(/malformed/i);
  });

  it("is idempotent — second call on the same config is a no-op", () => {
    const config: any = {
      agents: {
        list: [
          { id: "main", model: { primary: "openai/gpt-5" }, agentRuntime: { id: "codex" } },
        ],
      },
    };
    const first = migrateLegacyAgentRuntime(config);
    const second = migrateLegacyAgentRuntime(config);
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
  });

  it("preserves other agent entry fields", () => {
    const config: any = {
      agents: {
        list: [
          {
            id: "main",
            name: "Main agent",
            workspace: "/path/to/ws",
            model: { primary: "openai/gpt-5" },
            agentRuntime: { id: "codex" },
            experimental: { localModelLean: true },
          },
        ],
      },
    };
    migrateLegacyAgentRuntime(config);
    expect(agentAt(config, 0).name).toBe("Main agent");
    expect(agentAt(config, 0).workspace).toBe("/path/to/ws");
    expect(agentAt(config, 0).experimental).toEqual({ localModelLean: true });
  });

  it("returns no-op on empty / missing agent list", () => {
    expect(migrateLegacyAgentRuntime({})).toEqual({ changed: false, warnings: [] });
    expect(migrateLegacyAgentRuntime({ agents: {} })).toEqual({ changed: false, warnings: [] });
    expect(migrateLegacyAgentRuntime({ agents: { list: [] } })).toEqual({ changed: false, warnings: [] });
  });

  it("handles multiple agents in one pass", () => {
    const config: any = {
      agents: {
        list: [
          { id: "main", model: { primary: "openai/gpt-5" }, agentRuntime: { id: "codex" } },
          { id: "helper", model: { primary: "anthropic/claude-3" }, agentRuntime: { id: "pi" } },
        ],
      },
    };
    const result = migrateLegacyAgentRuntime(config);
    expect(result.changed).toBe(true);
    expect(agentAt(config, 0).models["openai/gpt-5"].agentRuntime.id).toBe("codex");
    expect(agentAt(config, 1).models["anthropic/claude-3"].agentRuntime.id).toBe("pi");
    expect(result.warnings).toHaveLength(2);
  });
});
