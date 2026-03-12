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

export const BYOK_PROVIDER_MODELS: Record<string, ByokProviderModels> = {
  google: {
    agentPrefix: 'google',
    models: [
      { id: 'gemini-2.5-flash',       name: 'Gemini 2.5 Flash',         reasoning: false, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 8192  },
      { id: 'gemini-2.5-flash-lite',  name: 'Gemini 2.5 Flash Lite',    reasoning: false, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 8192  },
      { id: 'gemini-2.5-pro',         name: 'Gemini 2.5 Pro',           reasoning: true,  input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 65536 },
      { id: 'gemini-3-flash-preview',  name: 'Gemini 3 Flash (Preview)', reasoning: false, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 8192  },
      { id: 'gemini-3-pro-preview',   name: 'Gemini 3 Pro (Preview)',   reasoning: true,  input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 65536 },
    ],
  },

  anthropic: {
    agentPrefix: 'anthropic',
    models: [
      { id: 'claude-opus-4-6',   name: 'Claude Opus 4.6',   reasoning: true, input: ['text', 'image'], cost: { input: 0.005,  output: 0.025,  cacheRead: 0.0005,  cacheWrite: 0.00125 }, contextWindow: 200000, maxTokens: 128000 },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', reasoning: true, input: ['text', 'image'], cost: { input: 0.003,  output: 0.015,  cacheRead: 0.0003,  cacheWrite: 0.00075 }, contextWindow: 200000, maxTokens: 64000  },
      { id: 'claude-haiku-4-5',  name: 'Claude Haiku 4.5',  reasoning: true, input: ['text', 'image'], cost: { input: 0.001,  output: 0.005,  cacheRead: 0.0001,  cacheWrite: 0.00025 }, contextWindow: 200000, maxTokens: 64000  },
    ],
  },

  openai: {
    agentPrefix: 'openai',
    models: [
      { id: 'gpt-4.1',      name: 'GPT-4.1',      reasoning: false, input: ['text', 'image'], cost: { input: 0.002,   output: 0.008,  cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 32768  },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', reasoning: false, input: ['text', 'image'], cost: { input: 0.0004,  output: 0.0016, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 32768  },
      { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', reasoning: false, input: ['text', 'image'], cost: { input: 0.0001,  output: 0.0004, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 32768  },
      { id: 'o3',           name: 'o3',            reasoning: true,  input: ['text', 'image'], cost: { input: 0.01,    output: 0.04,   cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000,  maxTokens: 100000 },
      { id: 'o4-mini',      name: 'o4-mini',       reasoning: true,  input: ['text', 'image'], cost: { input: 0.0011,  output: 0.0044, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000,  maxTokens: 100000 },
      { id: 'gpt-4o',       name: 'GPT-4o',        reasoning: false, input: ['text', 'image'], cost: { input: 0.0025,  output: 0.01,   cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000,  maxTokens: 16384  },
      { id: 'gpt-4o-mini',  name: 'GPT-4o Mini',   reasoning: false, input: ['text', 'image'], cost: { input: 0.00015, output: 0.0006, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000,  maxTokens: 16384  },
    ],
  },

  venice: {
    agentPrefix: 'venice',
    models: [
      { id: 'llama-3.3-70b',                 name: 'Llama 3.3 70B',    reasoning: false, input: ['text'],          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 16384 },
      { id: 'mistral-31-24b',                name: 'Mistral 3.1 24B',  reasoning: false, input: ['text'],          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 16384 },
      { id: 'hermes-3-llama-3.1-405b',       name: 'Llama 3.1 405B',   reasoning: false, input: ['text'],          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 16384 },
      { id: 'qwen3-235b-a22b-instruct-2507', name: 'Qwen3 235B',       reasoning: false, input: ['text'],          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 16384 },
      { id: 'qwen3-vl-235b-a22b',            name: 'Qwen3 VL 235B',    reasoning: false, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 16384 },
      { id: 'deepseek-v3.2',                 name: 'DeepSeek V3.2',    reasoning: false, input: ['text'],          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 16384 },
    ],
  },

  openrouter: {
    agentPrefix: 'openrouter',
    models: [
      { id: 'anthropic/claude-opus-4-6',         name: 'Claude Opus 4.6',   reasoning: false, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000,  maxTokens: 32000 },
      { id: 'anthropic/claude-sonnet-4-6',       name: 'Claude Sonnet 4.6', reasoning: false, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000,  maxTokens: 32000 },
      { id: 'openai/gpt-4.1',                    name: 'GPT-4.1',           reasoning: false, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 32768 },
      { id: 'openai/gpt-4o',                     name: 'GPT-4o',            reasoning: false, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000,  maxTokens: 16384 },
      { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B',    reasoning: false, input: ['text'],          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000,  maxTokens: 16384 },
      { id: 'google/gemini-2.5-flash',            name: 'Gemini 2.5 Flash', reasoning: false, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 8192  },
    ],
  },
}

// ---------------------------------------------------------------------------
// Openclaw Premium model list (AWS Bedrock — enabled models only)
// ---------------------------------------------------------------------------

export const PREMIUM_MODELS: ModelSpec[] = [
  { id: 'claude-opus',   name: 'Claude 4.6 Opus',    reasoning: false, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 8192 },
  { id: 'claude-sonnet', name: 'Claude 4.5 Sonnet',  reasoning: false, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 8192 },
  { id: 'claude-haiku',  name: 'Claude 4.5 Haiku',   reasoning: false, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 8192 },
  { id: 'nova-pro',      name: 'Amazon Nova Pro',     reasoning: false, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 300000, maxTokens: 5120 },
  { id: 'llama-3-3-70b', name: 'Meta Llama 3.3 70B', reasoning: false, input: ['text'],          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 8192 },
  { id: 'deepseek-r1',   name: 'DeepSeek R1',        reasoning: true,  input: ['text'],          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 64000,  maxTokens: 8192 },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the agent model ID for a given BYOK provider + model ID.
 *  e.g. byokProvider="google", modelId="gemini-2.5-flash" → "google/gemini-2.5-flash" */
export function byokAgentModelId(byokProvider: string, modelId: string): string {
  const prefix = BYOK_PROVIDER_MODELS[byokProvider]?.agentPrefix ?? byokProvider
  return `${prefix}/${modelId}`
}

/** Returns the default model ID (with agent prefix) for a given BYOK provider. */
export function defaultByokAgentModelId(byokProvider: string): string {
  const cfg = BYOK_PROVIDER_MODELS[byokProvider]
  // Use second model as default when available (first is usually the most expensive)
  const modelId = cfg?.models[1]?.id ?? cfg?.models[0]?.id ?? 'claude-sonnet-4-6'
  return byokAgentModelId(byokProvider, modelId)
}
