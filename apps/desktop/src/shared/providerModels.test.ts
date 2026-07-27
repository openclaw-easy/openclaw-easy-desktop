import { describe, it, expect } from 'vitest'
import {
  BYOK_PROVIDER_MODELS,
  byokAgentModelId,
  defaultByokAgentModelId,
} from './providerModels'

// Invariants for the model registries the desktop UI presents to the user.
// The ids here are what get sent to the provider, so a drift between a
// renamed entry and its id produces a 400 ("Model not found") at chat time.

describe('BYOK_PROVIDER_MODELS', () => {
  it('has entries for the four BYOK providers the desktop supports', () => {
    // Anthropic removed 2026-06-15 — direct sk-ant-* keys are not
    // authorized for OpenClaw clients. Claude is still reachable via the
    // OpenRouter aggregator.
    expect(Object.keys(BYOK_PROVIDER_MODELS).sort()).toEqual([
      'google',
      'openai',
      'openrouter',
      'venice',
    ])
  })

  it('every BYOK provider has at least one model', () => {
    for (const [provider, cfg] of Object.entries(BYOK_PROVIDER_MODELS)) {
      expect(cfg.models.length, `${provider}: empty model list`).toBeGreaterThan(0)
    }
  })

  it('every BYOK provider declares an agentPrefix', () => {
    for (const [provider, cfg] of Object.entries(BYOK_PROVIDER_MODELS)) {
      expect(cfg.agentPrefix, `${provider}: missing agentPrefix`).toBeTruthy()
    }
  })

  it('all model slugs within a provider are unique', () => {
    for (const [provider, cfg] of Object.entries(BYOK_PROVIDER_MODELS)) {
      const ids = cfg.models.map((m) => m.id)
      expect(new Set(ids).size, `${provider}: duplicate model id`).toBe(ids.length)
    }
  })
})

describe('byokAgentModelId', () => {
  it('prefixes the agent path with the provider agentPrefix', () => {
    expect(byokAgentModelId('google', 'gemini-2.5-flash')).toBe('google/gemini-2.5-flash')
    expect(byokAgentModelId('openai', 'gpt-5.5')).toBe('openai/gpt-5.5')
  })

  it('falls back to the provider name as prefix for unknown providers', () => {
    // Defensive: if a new provider is added to AppProviderConfig but not
    // BYOK_PROVIDER_MODELS, return something usable rather than undefined.
    expect(byokAgentModelId('mystery-provider', 'mystery-model')).toBe(
      'mystery-provider/mystery-model',
    )
  })
})

describe('defaultByokAgentModelId', () => {
  it('returns the second model (default convention is "not the most expensive")', () => {
    // The convention in this helper is to prefer index 1 over index 0
    // because index 0 is usually the flagship/expensive option.
    const r = defaultByokAgentModelId('openai')
    expect(r).toMatch(/^openai\//)
    expect(r).toBe(`openai/${BYOK_PROVIDER_MODELS.openai.models[1].id}`)
  })

  it('falls back to gpt-5.4-mini for unknown providers', () => {
    // Was claude-sonnet-4-6 before Anthropic was removed as a BYOK provider.
    expect(defaultByokAgentModelId('unknown')).toBe('unknown/gpt-5.4-mini')
  })
})
