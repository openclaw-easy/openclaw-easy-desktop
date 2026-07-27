import { listAgents } from './managers/agent-roster'
/**
 * Agent harness resolver.
 *
 * openclaw separates two concepts:
 *
 *   - **Model** — the LLM that does inference (claude-sonnet, deepseek-r1,
 *     gpt-5, …). Routed by provider config.
 *   - **Harness** — the CLI runtime that drives the conversation, owns
 *     the system prompt, and shapes tool-calling style (codex, pi, …).
 *
 * The desktop UI lets the user pick a MODEL but never a harness. If we
 * don't set the harness explicitly, openclaw's auto-selection picks
 * codex for anything routed under provider "openai" — including all
 * models routed via the openclaw-easy.com backend (which uses the
 * openai-responses API shape for Claude, DeepSeek, etc.). The codex
 * harness then injects a hardcoded "I am Codex / GPT-5" persona-latch
 * system prompt (see `src/agents/gpt5-prompt-overlay.ts:GPT5_BEHAVIOR_
 * CONTRACT`), so the assistant misidentifies itself regardless of the
 * underlying model.
 *
 * Fix: every time the desktop writes an agent's model, we also write
 * `agentRuntime.id` to force the correct harness. The codex harness is
 * appropriate ONLY for true OpenAI Codex/GPT/o-series models running
 * against the official OpenAI API. Everything else gets the model-
 * agnostic embedded `pi` harness, which respects the model's own
 * identity and doesn't inject the GPT-5 persona-latch.
 *
 * Exec-policy compatibility (audit 2026-06-17): the upstream codex
 * app-server REJECTS startup when `tools.exec.mode` resolves to `"deny"`
 * or `"allowlist"` — see `extensions/codex/src/app-server/config.ts`
 * `assertCodexAppServerAllowedForOpenClawExecMode`. Recommended security
 * configs (from `src/security/audit.ts:812`) use exactly that
 * `security="allowlist"` setting, so picking codex for those agents
 * makes chat throw immediately with "Codex app-server local execution
 * is not available when tools.exec.mode=allowlist". We mirror the
 * upstream policy→mode mapping in `isCodexAppServerCompatible()` and
 * fall back to `pi` when codex would reject.
 */

/** Valid openclaw harness ids (subset — the routing code accepts these). */
export type AgentHarnessId = 'codex' | 'pi';

/**
 * Subset of the OpenClaw `tools.exec` config we need to decide whether
 * the codex app-server will accept this agent. Pass the GLOBAL
 * `tools.exec` merged with the per-agent `tools.exec` override (the
 * agent layer wins — matches the upstream resolver's behaviour).
 */
export interface ExecPolicyContext {
  security?: 'deny' | 'allowlist' | 'full' | string
  ask?: 'off' | 'on-miss' | 'always' | string
  /** Explicit `tools.exec.mode` override. Mutually exclusive with
   *  `security`+`ask` per the zod schema, but accept it defensively. */
  mode?: 'deny' | 'allowlist' | 'ask' | 'auto' | 'full' | string
}

/**
 * Returns true iff the codex app-server harness will accept this exec
 * config. Mirrors upstream
 * `extensions/codex/src/app-server/config.ts::assertCodexAppServerAllowedForOpenClawExecMode`
 * and `resolveOpenClawExecModeFromPolicy`. Keep these two in sync — if
 * upstream relaxes the codex restriction (e.g. allows allowlist with
 * an explicit reviewer), update here.
 *
 * Pure — safe to call from anywhere.
 */
export function isCodexAppServerCompatible(exec?: ExecPolicyContext): boolean {
  if (!exec) return true // empty config → defaults to mode=full, which codex accepts

  // Explicit `mode` overrides security/ask per the schema's exclusivity rule.
  if (typeof exec.mode === 'string' && exec.mode.length > 0) {
    return exec.mode !== 'deny' && exec.mode !== 'allowlist'
  }

  const security = (exec.security ?? 'full') as string
  const ask = (exec.ask ?? 'off') as string

  // Mirror upstream resolveOpenClawExecModeFromPolicy
  let derivedMode: string
  if (security === 'deny') {
    derivedMode = 'deny'
  } else if (security === 'allowlist' && ask === 'off') {
    derivedMode = 'allowlist'
  } else if (security === 'full' && ask !== 'always') {
    derivedMode = 'full'
  } else {
    derivedMode = 'ask'
  }
  return derivedMode !== 'deny' && derivedMode !== 'allowlist'
}

/**
 * Decide which harness should drive an agent for a given model id.
 *
 * Accepts both bare ids (`gpt-5`, `claude-sonnet`) and provider-qualified
 * ones (`openai/gpt-5`, `openai/claude-sonnet`, `anthropic/claude-opus-4`,
 * `ollama/llama3.2:3b`, …).
 *
 * @param modelId  Model reference string. Empty or unknown → `pi` (safe
 *                 default: pi runs anything OpenAI-compatible without
 *                 baking in an identity).
 * @param execContext  Effective `tools.exec` for THIS agent (global
 *                 layer merged with per-agent layer). When the codex
 *                 app-server would reject this config (security="deny"
 *                 or security="allowlist"+ask="off"), fall back to `pi`
 *                 — even for GPT models — because codex won't start.
 */
export function resolveAgentHarness(
  modelId: string | undefined,
  execContext?: ExecPolicyContext,
): AgentHarnessId {
  if (!modelId || typeof modelId !== 'string') return 'pi';

  // Strip the provider prefix (`openai/gpt-5` → `gpt-5`).
  const slash = modelId.indexOf('/');
  const bare = (slash >= 0 ? modelId.slice(slash + 1) : modelId).trim().toLowerCase();

  // Codex harness ships with the GPT-5 persona-latch system prompt; it
  // only makes sense for actual OpenAI Codex / GPT / o-series models.
  // Everything else (Claude variants routed via openai-responses,
  // DeepSeek, Gemini, local Ollama, …) goes to the embedded pi harness.
  const wantsCodex =
    bare === 'gpt-5' ||
    bare.startsWith('gpt-') ||
    bare.startsWith('codex-') ||
    bare.startsWith('codex/') ||
    bare === 'codex' ||
    /^o\d/.test(bare); // o1, o3, o4, …

  if (!wantsCodex) return 'pi';

  // Codex would be the ideal harness — but the upstream app-server
  // rejects deny/allowlist exec policies. Fall back to pi when codex
  // wouldn't start; the user keeps their security posture, and pi
  // handles BYOK OpenAI just fine via the openai-responses API.
  if (!isCodexAppServerCompatible(execContext)) {
    return 'pi';
  }
  return 'codex';
}

/**
 * Resolves the effective `tools.exec` context for a specific agent
 * given an OpenClaw config object. The agent-level config wins over
 * the global `tools.exec` (per upstream `applyOpenClawExecPolicyLayer`
 * semantics).
 *
 * Pure — does not load files. Caller passes the already-loaded config.
 */
export function readExecContextForAgent(
  config: any,
  agentId: string,
): ExecPolicyContext | undefined {
  if (!config || typeof config !== 'object') return undefined
  const global = isPlainObject(config?.tools?.exec) ? config.tools.exec : undefined
  const agents = listAgents(config)
  const agentEntry = agents.find((e: any) => e && e.id === agentId)
  const agentExec = isPlainObject(agentEntry?.tools?.exec) ? agentEntry.tools.exec : undefined

  // Merge: agent overrides win. Mirrors upstream applyOpenClawExecPolicyLayer
  // (later layer overrides earlier), respecting the schema's mode vs
  // security/ask exclusivity.
  if (!global && !agentExec) return undefined
  const layered: ExecPolicyContext = { ...(global ?? {}), ...(agentExec ?? {}) }
  // If the agent layer set `mode`, drop security/ask from the merged
  // context per the zod schema's exclusivity rule.
  if (agentExec && typeof agentExec.mode === 'string' && agentExec.mode.length > 0) {
    return { mode: agentExec.mode }
  }
  return layered
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
