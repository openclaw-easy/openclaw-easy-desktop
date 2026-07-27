/**
 * Centralized model definitions for all AI providers.
 *
 * This file is the SINGLE SOURCE OF TRUTH for model lists.
 * It is imported by:
 *   - src/main/managers/config-manager.ts   (writes openclaw.json)
 *   - src/renderer/components/dashboard/sections/AIProviderSection.tsx  (BYOK model picker)
 *   - src/renderer/components/AgentFormModal.tsx  (agent model picker)
 *
 * When adding, removing, or renaming a model — edit ONLY this file.
 */

export interface ModelSpec {
  id: string
  name: string
  reasoning: boolean
  input: string[]
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number }
  contextWindow: number
  maxTokens: number
}

export interface ByokProviderModels {
  /**
   * Gateway provider prefix used in agent model paths.
   * Agent model ID = `${agentPrefix}/${model.id}`
   * e.g. google + gemini-2.5-flash → "google/gemini-2.5-flash"
   */
  agentPrefix: string
  models: ModelSpec[]
}

// ---------------------------------------------------------------------------
// BYOK provider model lists
// ---------------------------------------------------------------------------

// Per-provider catalogs. Curated to current-generation models only.
// Three classes intentionally OMITTED:
//   1. Nano-tier (e.g. gpt-5.4-nano, gpt-4.1-nano): OpenAI rejects most
//      agent tools on these (`Tool 'tool_search' is not supported with
//      gpt-5.4-nano`). The desktop sends the full tool catalog by default,
//      so nano breaks out of the box without `tools.profile=minimal`.
//   2. Legacy generations (gpt-4.1, gpt-4o, claude-opus-4-5, etc.): the
//      previous-gen models exist in the upstream APIs but pushing users
//      toward current generations is the right default. Power users can
//      still set them via `openclaw config set`; the dropdown just won't
//      tempt them.
//   3. Deprecated previews (gemini-3-flash-preview, etc.): upstream has
//      EOL'd them.
//
// Trade-off accepted: a user whose openclaw.json has a legacy model ID
// gets reset to defaults the next time the desktop re-applies the
// provider config (the orphan-repair fires because the ID is no longer
// in providers.X.models[]). They'll see the toast "Model switched"
// and can re-pick if they really want. Per the user's instruction to
// remove the clutter — better than leaving the dropdown 50% historical.
//
// Verified 2026-06-25 against:
//   - OpenAI:     https://developers.openai.com/api/docs/models  (GPT-5.5/5.5 Pro
//                 GA; o-series retired except o4-mini)
//   - Google:     https://ai.google.dev/gemini-api/docs/models   (Gemini 3.5 Flash
//                 GA 2026-05-19; 2.5 dropped — two generations behind)
//   - Venice:     https://api.venice.ai/api/v1/models?type=text  (live)
//   - OpenRouter: https://openrouter.ai/api/v1/models            (live; aggregator.
//                 No meta-llama/* served as of this refresh — Llama dropped)
//
// Anthropic was removed as a BYOK provider on 2026-06-15 — direct
// `sk-ant-*` API keys are not authorized for OpenClaw clients. Users
// still reach Claude via:
//     relationship, slugs like `claude-opus`, `claude-sonnet`, `claude-haiku`)
//   - OpenRouter BYOK (OpenRouter's commercial relationship — see
//     `openrouter.models[]` below for the `anthropic/claude-*` entries)
// Removing direct BYOK Anthropic does NOT affect either of those paths.
export const BYOK_PROVIDER_MODELS: Record<string, ByokProviderModels> = {
  google: {
    agentPrefix: 'google',
    models: [
      // Gemini 3.5 — current flagship (GA 2026-05-19; best agentic/coding).
      { id: 'gemini-3.5-flash',       name: 'Gemini 3.5 Flash',         reasoning: true,  input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 65536 },
      // Gemini 3.1 — strongest pure-reasoning model (GA since Feb 2026).
      { id: 'gemini-3.1-pro',         name: 'Gemini 3.1 Pro',           reasoning: true,  input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 2000000, maxTokens: 65536 },
      { id: 'gemini-3.1-flash-lite',  name: 'Gemini 3.1 Flash Lite',    reasoning: false, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 8192  },
    ],
  },

  openai: {
    agentPrefix: 'openai',
    models: [
      // GPT-5.x — current generation (GPT-5.5 GA 2026-04-23). gpt-5.5 is the
      // recommended default; gpt-5.5-pro is the top flagship (index 0).
      { id: 'gpt-5.5-pro',  name: 'GPT-5.5 Pro',  reasoning: true,  input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 128000 },
      { id: 'gpt-5.5',      name: 'GPT-5.5',      reasoning: true,  input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 128000 },
      { id: 'gpt-5.4',      name: 'GPT-5.4',      reasoning: true,  input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 128000 },
      { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', reasoning: false, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 400000,  maxTokens: 128000 },
      { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex (coding)', reasoning: true, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 400000, maxTokens: 128000 },
      // o4-mini — sole surviving o-series reasoning model (rest retired 2026).
      { id: 'o4-mini',      name: 'o4-mini (reasoning)', reasoning: true, input: ['text', 'image'], cost: { input: 0.0011,  output: 0.0044, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 100000 },
    ],
  },

  venice: {
    agentPrefix: 'venice',
    models: [
      // Top picks verified live against /api/v1/models?type=text on 2026-06-25.
      // Refresh: GLM 5.2 (new flagship), DeepSeek V4 Pro/Flash, Grok 4.3, and
      // Kimi K2.7 Code added — all confirmed in the live API. Removed entries
      // no longer served: qwen-3-7-max (never existed), zai-org-glm-4-7,
      // qwen-3-6-plus, qwen3-6-27b, venice-uncensored-1-2 (superseded by 1.1
      // id e2ee-venice-uncensored-24b-p; dropped rather than chase the rename).
      { id: 'zai-org-glm-5-2',                name: 'GLM 5.2',                  reasoning: true,  input: ['text'],          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 16384 },
      { id: 'zai-org-glm-5-1',                name: 'GLM 5.1',                  reasoning: true,  input: ['text'],          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000,  maxTokens: 16384 },
      { id: 'zai-org-glm-5',                  name: 'GLM 5',                    reasoning: true,  input: ['text'],          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 198000,  maxTokens: 16384 },
      { id: 'qwen-3-7-plus',                  name: 'Qwen 3.7 Plus',            reasoning: true,  input: ['text'],          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 16384 },
      { id: 'deepseek-v4-pro',                name: 'DeepSeek V4 Pro',          reasoning: true,  input: ['text'],          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 16384 },
      { id: 'deepseek-v4-flash',              name: 'DeepSeek V4 Flash',        reasoning: true,  input: ['text'],          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 16384 },
      { id: 'grok-4-3',                       name: 'Grok 4.3',                 reasoning: true,  input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 16384 },
      { id: 'kimi-k2-7-code',                 name: 'Kimi K2.7 Code',           reasoning: true,  input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 256000,  maxTokens: 16384 },
      { id: 'qwen3-235b-a22b-thinking-2507',  name: 'Qwen3 235B Thinking',      reasoning: true,  input: ['text'],          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000,  maxTokens: 16384 },
      { id: 'qwen3-vl-235b-a22b',             name: 'Qwen3 VL 235B',            reasoning: false, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 256000,  maxTokens: 16384 },
      { id: 'qwen3-coder-480b-a35b-instruct-turbo', name: 'Qwen 3 Coder 480B Turbo', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 256000, maxTokens: 16384 },
      { id: 'google-gemma-4-31b-it',          name: 'Gemma 4 31B Instruct',     reasoning: false, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 256000,  maxTokens: 16384 },
    ],
  },

  openrouter: {
    agentPrefix: 'openrouter',
    models: [
      // OpenRouter passes through each upstream provider's model IDs. Flagship
      // ids confirmed live 2026-06-25; opus 4.7→4.8, grok 4→4.3, deepseek
      // v3.2→v4-pro, gemini 2.5→3.5-flash; fable-5 + qwen3.7-max added; Llama
      // dropped (no meta-llama/* served).
      { id: 'anthropic/claude-opus-4.8',         name: 'Claude Opus 4.8',          reasoning: true,  input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 128000 },
      { id: 'anthropic/claude-sonnet-4.6',       name: 'Claude Sonnet 4.6',        reasoning: true,  input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 64000  },
      { id: 'anthropic/claude-fable-5',          name: 'Claude Fable 5',           reasoning: true,  input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 64000  },
      { id: 'anthropic/claude-haiku-4.5',        name: 'Claude Haiku 4.5',         reasoning: false, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000,  maxTokens: 64000  },
      { id: 'openai/gpt-5.5',                    name: 'GPT-5.5',                  reasoning: true,  input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 128000 },
      { id: 'openai/gpt-5.4',                    name: 'GPT-5.4',                  reasoning: true,  input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 128000 },
      { id: 'openai/gpt-5.4-mini',               name: 'GPT-5.4 Mini',             reasoning: false, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 400000,  maxTokens: 128000 },
      { id: 'google/gemini-3.5-flash',           name: 'Gemini 3.5 Flash',         reasoning: true,  input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 65536  },
      { id: 'google/gemini-3.1-pro',             name: 'Gemini 3.1 Pro',           reasoning: true,  input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 2000000, maxTokens: 65536  },
      { id: 'x-ai/grok-4.3',                     name: 'Grok 4.3',                 reasoning: true,  input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 32000  },
      { id: 'deepseek/deepseek-v4-pro',          name: 'DeepSeek V4 Pro',          reasoning: true,  input: ['text'],          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 16384  },
      { id: 'qwen/qwen3.7-max',                  name: 'Qwen 3.7 Max',             reasoning: true,  input: ['text'],          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 16384  },
    ],
  },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the agent model ID for a given BYOK provider + model ID.
 *  e.g. byokProvider="google", modelId="gemini-2.5-flash" → "google/gemini-2.5-flash" */
export function byokAgentModelId(byokProvider: string, modelId: string): string {
  const prefix = BYOK_PROVIDER_MODELS[byokProvider]?.agentPrefix ?? byokProvider
  return `${prefix}/${modelId}`
}

/** Returns the bare default model ID (NO agent prefix) for a given BYOK provider. */
export function defaultByokModelId(byokProvider: string): string {
  const cfg = BYOK_PROVIDER_MODELS[byokProvider]
  // Use second model as default when available (first is usually the most expensive).
  // Fallback last-resort: gpt-5.4-mini (mid-tier OpenAI). Was claude-sonnet-4-6
  // before Anthropic was removed as a BYOK provider on 2026-06-15.
  return cfg?.models[1]?.id ?? cfg?.models[0]?.id ?? 'gpt-5.4-mini'
}

/** Returns the default model ID (with agent prefix) for a given BYOK provider. */
export function defaultByokAgentModelId(byokProvider: string): string {
  return byokAgentModelId(byokProvider, defaultByokModelId(byokProvider))
}
