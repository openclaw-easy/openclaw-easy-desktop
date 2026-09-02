import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// Mock electron's app.getPath to point to our temp dir
let mockHome: string
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'home') return mockHome
      return path.join(mockHome, name)
    }),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn((s: string) => Buffer.from(s)),
    decryptString: vi.fn((b: Buffer) => b.toString()),
  },
}))

import { ConfigManager } from './config-manager'
import { Logger } from './logger'

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


describe('ConfigManager', () => {
  let tmpDir: string
  let configDir: string
  let configPath: string
  let logger: Logger
  let mgr: ConfigManager
  // Credential syncs shell out to `openclaw models auth paste-*`; tests
  // capture the invocation instead of spawning the CLI.
  let execCalls: Array<{ args: string[]; stdinData?: string }>

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-manager-test-'))
    mockHome = tmpDir
    configDir = path.join(tmpDir, '.openclaw')
    configPath = path.join(configDir, 'openclaw.json')
    fs.mkdirSync(configDir, { recursive: true })

    logger = new Logger()
    mgr = new ConfigManager(logger)
    execCalls = []
    mgr.setCommandExecutor({
      executeCommand: async (args: string[], _timeoutMs?: number, opts?: { stdinData?: string }) => {
        execCalls.push({ args, stdinData: opts?.stdinData })
        return ''
      },
    })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeConfig(config: object) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
  }

  function readConfig(): any {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'))
  }

  // ── loadConfig ─────────────────────────────────────────────────────

  describe('loadConfig', () => {
    it('should return empty object when config file does not exist', async () => {
      const config = await mgr.loadConfig()
      expect(config).toEqual({})
    })

    it('should parse existing config file', async () => {
      writeConfig({ gateway: { port: 18800 } })
      const config = await mgr.loadConfig()
      expect(config.gateway.port).toBe(18800)
    })
  })

  // ── configExists ───────────────────────────────────────────────────

  describe('configExists', () => {
    it('should return false when config does not exist', async () => {
      expect(await mgr.configExists()).toBe(false)
    })

    it('should return true when config exists', async () => {
      writeConfig({})
      expect(await mgr.configExists()).toBe(true)
    })
  })

  // ── validateAndRepairConfig (via writeConfig) ──────────────────────

  describe('validateAndRepairConfig (invoked through writeConfig)', () => {
    it('should create missing agents structure', async () => {
      await mgr.writeConfig({ gateway: { port: 18800 } })
      const config = readConfig()
      expect(config.agents).toBeDefined()
      expect(rosterEntries(config)).toEqual([{ id: 'main' }])
      expect(config.agents.defaults).toBeDefined()
      expect(config.agents.defaults.model).toBeDefined()
    })

    it('should ensure default "main" agent in empty agents.list', async () => {
      await mgr.writeConfig({ agents: { list: [] } })
      const config = readConfig()
      expect(rosterEntries(config)).toEqual([{ id: 'main' }])
    })

    it('should preserve existing agents.list', async () => {
      await mgr.writeConfig({
        agents: {
          list: [{ id: 'custom-agent', tools: { allow: ['web_fetch'] } }],
          defaults: { model: { primary: 'google/gemini-2.5-flash' } },
        },
      })
      const config = readConfig()
      expect(rosterEntries(config)).toHaveLength(1)
      expect(agentAt(config, 0).id).toBe('custom-agent')
    })

    // ── Provider/model mismatch repair ─────────────────────────────

    it('should fix Gemini model with wrong provider (openrouter/gemini → google/gemini)', async () => {
      await mgr.writeConfig({
        agents: {
          defaults: { model: { primary: 'openrouter/gemini-flash-latest' } },
        },
      })
      const config = readConfig()
      expect(config.agents.defaults.model.primary).toBe('google/gemini-flash-latest')
    })

    it('should fix Claude model with wrong provider (google/claude → openrouter/anthropic/claude)', async () => {
      // Was `→ anthropic/claude` before Anthropic was removed as a BYOK
      // provider on 2026-06-15. OpenRouter is the only remaining path to
      // Claude, and it passes through the upstream `anthropic/` id.
      await mgr.writeConfig({
        agents: {
          defaults: { model: { primary: 'google/claude-sonnet-4-5' } },
        },
      })
      const config = readConfig()
      expect(config.agents.defaults.model.primary).toBe('openrouter/anthropic/claude-sonnet-4-5')
    })

    it('should fix GPT model with wrong provider (openrouter/gpt → openai/gpt)', async () => {
      await mgr.writeConfig({
        agents: {
          defaults: { model: { primary: 'openrouter/gpt-4o' } },
        },
      })
      const config = readConfig()
      expect(config.agents.defaults.model.primary).toBe('openai/gpt-4o')
    })

    it('should fix o-model with wrong provider (google/o3 → openai/o3)', async () => {
      await mgr.writeConfig({
        agents: {
          defaults: { model: { primary: 'google/o3' } },
        },
      })
      const config = readConfig()
      expect(config.agents.defaults.model.primary).toBe('openai/o3')
    })

    it('should NOT change correctly-matched model/provider', async () => {
      await mgr.writeConfig({
        agents: {
          defaults: { model: { primary: 'google/gemini-2.5-flash' } },
        },
      })
      const config = readConfig()
      expect(config.agents.defaults.model.primary).toBe('google/gemini-2.5-flash')
    })

    it('should NOT create gateway from scratch when missing', async () => {
      await mgr.writeConfig({})
      const config = readConfig()
      expect(config.gateway).toBeUndefined()
    })

    // ── Orphaned model repair ─────────────────────────────────────────
    // An agent can keep pointing at a model that is no longer in its
    // provider's models[] — the catalog was rewritten by a provider switch,
    // or the model was retired upstream. Those refs 400 at the provider and
    // lock the user out of chat, so repair must reset orphans to the
    // configured default (or a valid provider/model fallback).

    it('should repair orphaned default model (gpt-4.1 not in the catalog)', async () => {
      await mgr.writeConfig({
        models: {
          providers: {
            openai: {
              baseUrl: 'https://api.openai.com/v1',
              api: 'openai-responses',
              apiKey: 'sk-byok-key',
              models: [
                { id: 'gpt-5.5-pro' },
                { id: 'gpt-5.5' },
              ],
            },
          },
        },
        agents: {
          defaults: { model: { primary: 'openai/gpt-4.1' } },
        },
      })
      const config = readConfig()
      // Default should be repaired to first valid provider model
      expect(config.agents.defaults.model.primary).toBe('openai/gpt-5.5-pro')
    })

    it('should repair orphaned per-agent model and prefer valid default', async () => {
      await mgr.writeConfig({
        models: {
          providers: {
            openai: {
              baseUrl: 'https://api.openai.com/v1',
              api: 'openai-responses',
              apiKey: 'sk-byok-key',
              models: [
                { id: 'gpt-5.5-pro' },
                { id: 'gpt-5.5' },
              ],
            },
          },
        },
        agents: {
          defaults: { model: { primary: 'openai/gpt-5.5-pro' } },
          list: [
            { id: 'main', model: { primary: 'openai/gpt-4.1' } }, // orphan
            { id: 'helper', model: { primary: 'openai/gpt-5.5' } }, // valid
          ],
        },
      })
      const config = readConfig()
      // Orphaned 'main' should fall back to defaults primary (better than first model)
      expect(agentAt(config, 0).model.primary).toBe('openai/gpt-5.5-pro')
      // Valid 'helper' must NOT be touched
      expect(agentAt(config, 1).model.primary).toBe('openai/gpt-5.5')
    })

    it('should not touch agent model when provider has no models[] list', async () => {
      // Some providers (e.g. moltbot-easy or gateway-managed) don't list models
      await mgr.writeConfig({
        models: {
          providers: {
            'moltbot-easy': { baseUrl: 'http://localhost:3002', apiKey: 'tok' },
          },
        },
        agents: {
          defaults: { model: { primary: 'moltbot-easy/anything-goes' } },
        },
      })
      const config = readConfig()
      expect(config.agents.defaults.model.primary).toBe('moltbot-easy/anything-goes')
    })

    it('should repair orphaned model when provider does not exist at all', async () => {
      await mgr.writeConfig({
        models: {
          providers: {
            openai: {
              baseUrl: 'https://api.openai.com/v1',
              apiKey: 'sk-byok-key',
              models: [{ id: 'gpt-5.5-pro' }],
            },
          },
        },
        agents: {
          defaults: { model: { primary: 'openai/gpt-5.5-pro' } },
          list: [{ id: 'ghost', model: { primary: 'venice/llama-3.3-70b' } }],
        },
      })
      const config = readConfig()
      // venice provider doesn't exist → 'ghost' agent gets defaults
      expect(agentAt(config, 0).model.primary).toBe('openai/gpt-5.5-pro')
    })

    // Reproduces a real broken state: the default model is valid but
    // agents.list[0] ("main") still holds a stranded openai/gpt-4.1 the
    // provider rejects. Exercises the REAL startup path
    // (loadAndValidateConfig), which is what the desktop runs at app
    // launch — proving the repair self-heals an existing broken config
    // without any user action.
    it('END-TO-END: loadAndValidateConfig self-heals a broken config on startup', async () => {
      // Write the broken config directly to disk (skipping writeConfig so
      // no auto-repair runs at write time — we want to prove repair fires
      // at load time too, mimicking the desktop startup sequence).
      writeConfig({
        meta: { lastTouchedVersion: '2026.5.8' },
        models: {
          providers: {
            openai: {
              baseUrl: 'https://api.openai.com/v1',
              api: 'openai-responses',
              apiKey: 'sk-byok-key',
              models: [
                { id: 'gpt-5.5-pro', name: 'GPT-5.5 Pro' },
                { id: 'gpt-5.5', name: 'GPT-5.5' },
                { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini' },
              ],
            },
          },
        },
        agents: {
          defaults: { model: { primary: 'openai/gpt-5.5-pro' } },
          list: [
            // ORPHAN — production bug.
            { id: 'main', model: { primary: 'openai/gpt-4.1' } },
            // Valid — must NOT be touched.
            { id: 'helper', model: { primary: 'openai/gpt-5.5' } },
          ],
        },
      })

      // This is the exact call the desktop makes at startup
      // (src/main/index.ts → openClawManager.start() → loadAndValidateConfig).
      const repaired = await mgr.loadAndValidateConfig()

      // Returned object reflects the repair
      expect(repaired.agents.defaults.model.primary).toBe('openai/gpt-5.5-pro')
      const main = rosterEntries(repaired).find((a: any) => a.id === 'main')
      const helper = rosterEntries(repaired).find((a: any) => a.id === 'helper')
      expect(main.model.primary).toBe('openai/gpt-5.5-pro')
      expect(helper.model.primary).toBe('openai/gpt-5.5')

      // And the persisted config on disk reflects it (next startup is a no-op).
      const persisted = readConfig()
      expect(persisted.agents.defaults.model.primary).toBe('openai/gpt-5.5-pro')
      expect(rosterEntries(persisted).find((a: any) => a.id === 'main').model.primary).toBe('openai/gpt-5.5-pro')
      expect(rosterEntries(persisted).find((a: any) => a.id === 'helper').model.primary).toBe('openai/gpt-5.5')
    })

    it('should leave config untouched when default and all agents are valid', async () => {
      await mgr.writeConfig({
        models: {
          providers: {
            openai: {
              baseUrl: 'https://api.openai.com/v1',
              apiKey: 'sk-byok-key',
              models: [
                { id: 'gpt-5.5-pro' },
                { id: 'gpt-5.5' },
              ],
            },
          },
        },
        agents: {
          defaults: { model: { primary: 'openai/gpt-5.5' } },
          list: [
            { id: 'a', model: { primary: 'openai/gpt-5.5-pro' } },
            { id: 'b', model: { primary: 'openai/gpt-5.5' } },
          ],
        },
      })
      const config = readConfig()
      expect(config.agents.defaults.model.primary).toBe('openai/gpt-5.5')
      expect(agentAt(config, 0).model.primary).toBe('openai/gpt-5.5-pro')
      expect(agentAt(config, 1).model.primary).toBe('openai/gpt-5.5')
    })

    it('should repair gateway.mode when gateway exists but mode missing', async () => {
      await mgr.writeConfig({ gateway: { port: 18800 } })
      const config = readConfig()
      expect(config.gateway.mode).toBe('local')
      expect(config.gateway.port).toBe(18800)
    })

    // ── compat.* sanitization — prevents the gateway crash-loop seen in
    // the field when a user-added provider has a bad maxTokensField value
    // (e.g. a numeric string "100000" instead of the required enum
    // "max_tokens" / "max_completion_tokens"). The gateway zod schema
    // rejects the whole config and the supervisor restarts it every ~3s
    // forever — the Assistant never comes up.

    it('coerces bad compat.maxTokensField to "max_tokens" for openai-completions providers', async () => {
      await mgr.writeConfig({
        models: {
          providers: {
            'cpa-gpt4': {
              baseUrl: 'https://cpa-gpt4.example/v1',
              api: 'openai-completions',
              models: [{
                id: 'gpt-4',
                compat: { maxTokensField: '100000' },
              }],
            },
          },
        },
      })
      const config = readConfig()
      expect(config.models.providers['cpa-gpt4'].models[0].compat.maxTokensField).toBe('max_tokens')
    })

    it('coerces bad compat.maxTokensField to "max_completion_tokens" for responses-API providers', async () => {
      await mgr.writeConfig({
        models: {
          providers: {
            custom: {
              baseUrl: 'https://example/v1',
              api: 'openai-responses',
              models: [{
                id: 'gpt-5.5',
                compat: { maxTokensField: 'maxtokens' },
              }],
            },
          },
        },
      })
      const config = readConfig()
      expect(config.models.providers.custom.models[0].compat.maxTokensField).toBe('max_completion_tokens')
    })

    it('removes compat.maxTokensField when api is unknown (no safe default)', async () => {
      await mgr.writeConfig({
        models: {
          providers: {
            mystery: {
              baseUrl: 'https://example/v1',
              // No api field → can't safely guess
              models: [{
                id: 'whatever',
                compat: { maxTokensField: 42 as any },
              }],
            },
          },
        },
      })
      const config = readConfig()
      expect(config.models.providers.mystery.models[0].compat.maxTokensField).toBeUndefined()
    })

    it('leaves a valid compat.maxTokensField untouched', async () => {
      await mgr.writeConfig({
        models: {
          providers: {
            custom: {
              baseUrl: 'https://example/v1',
              api: 'openai-completions',
              models: [{
                id: 'gpt-4',
                compat: { maxTokensField: 'max_tokens' },
              }],
            },
          },
        },
      })
      const config = readConfig()
      expect(config.models.providers.custom.models[0].compat.maxTokensField).toBe('max_tokens')
    })

    it('drops non-boolean values from boolean compat flags', async () => {
      await mgr.writeConfig({
        models: {
          providers: {
            custom: {
              baseUrl: 'https://example/v1',
              api: 'openai-completions',
              models: [{
                id: 'gpt-4',
                compat: {
                  supportsReasoningEffort: 'false' as any,
                  supportsUsageInStreaming: 0 as any,
                  supportsTools: true,
                },
              }],
            },
          },
        },
      })
      const compat = readConfig().models.providers.custom.models[0].compat
      expect(compat.supportsReasoningEffort).toBeUndefined()
      expect(compat.supportsUsageInStreaming).toBeUndefined()
      expect(compat.supportsTools).toBe(true)
    })

    it('drops compat entirely when it is not an object', async () => {
      await mgr.writeConfig({
        models: {
          providers: {
            custom: {
              baseUrl: 'https://example/v1',
              api: 'openai-completions',
              models: [{
                id: 'gpt-4',
                compat: 'oops' as any,
              }],
            },
          },
        },
      })
      const config = readConfig()
      expect(config.models.providers.custom.models[0].compat).toBeUndefined()
    })
  })

  // ── applyProviderToOpenClaw — provider/model projection into openclaw.json ──

  describe('applyProviderToOpenClaw', () => {
    it('syncs the active BYOK key into the agent auth store via paste-api-key', async () => {
      writeConfig({})
      await mgr.applyProviderToOpenClaw({
        aiProvider: 'byok',
        byok: { provider: 'google', model: 'gemini-2.5-flash', apiKeys: { google: 'AIza-test-key' } },
      } as any)
      expect(execCalls).toHaveLength(1)
      expect(execCalls[0].args).toEqual([
        'models', 'auth', '--agent', 'main',
        'paste-api-key', '--provider', 'google', '--profile-id', 'google:default',
      ])
      // The secret travels via stdin, never argv.
      expect(execCalls[0].stdinData).toBe('AIza-test-key')
    })

    it('does not invoke the CLI when the selected provider has no key', async () => {
      writeConfig({})
      await mgr.applyProviderToOpenClaw({
        aiProvider: 'byok',
        byok: { provider: 'google', model: 'gemini-2.5-flash', apiKeys: {} },
      } as any)
      expect(execCalls).toHaveLength(0)
    })

    // The SQLite auth store is authoritative since 2026.7.x; the legacy JSON
    // files are never re-read, so writing them would be a silent no-op.
    it('does not write legacy JSON auth-profile files', async () => {
      writeConfig({})
      await mgr.applyProviderToOpenClaw({
        aiProvider: 'byok',
        byok: { provider: 'google', model: 'gemini-2.5-flash', apiKeys: { google: 'AIza-test-key' } },
      } as any)
      expect(fs.existsSync(path.join(configDir, 'auth-profiles.json'))).toBe(false)
      expect(fs.existsSync(path.join(configDir, 'agents', 'main', 'auth.json'))).toBe(false)
    })
  })

  describe('reconcileActiveProvider (startup self-heal)', () => {
    // END-TO-END regression: app-config says BYOK-Google, but openclaw.json
    // was last written for BYOK-OpenAI (stale catalog + gpt-5.5-pro agents).
    // Startup reconcile must re-project so the two files agree — without it,
    // the UI shows Google while Agent Management runs openai/gpt-5.5-pro.
    it('heals openclaw.json drifted to BYOK-OpenAI while app-config selects BYOK-Google', async () => {
      await mgr.saveAppConfig({
        aiProvider: 'byok',
        byok: { provider: 'google', model: 'gemini-3.5-flash', apiKeys: { google: 'AIza-test-key' } },
      })
      writeConfig({
        models: {
          providers: {
            openai: {
              baseUrl: 'https://api.openai.com/v1',
              api: 'openai-responses',
              apiKey: 'sk-byok-real-key',
              models: [{ id: 'gpt-5.5-pro' }, { id: 'gpt-5.5' }],
            },
          },
        },
        agents: {
          defaults: { model: { primary: 'openai/gpt-5.5-pro' } },
          list: [{ id: 'main', model: { primary: 'openai/gpt-5.5-pro' } }],
        },
      })

      await mgr.reconcileActiveProvider()

      const config = readConfig()
      expect(config.models.providers.google.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta')
      expect(config.agents.defaults.model.primary).toBe('google/gemini-3.5-flash')
      expect(agentAt(config, 0).model.primary).toBe('google/gemini-3.5-flash')
    })

    it('is a no-op when no provider is selected in app-config', async () => {
      writeConfig({ gateway: { port: 18800, mode: 'local' } })
      await mgr.reconcileActiveProvider()
      const config = readConfig()
      expect(config.gateway.port).toBe(18800)
      expect(config.models?.providers).toBeUndefined()
    })

    it('does NOT touch a healthy config (preserves user-added custom provider keys)', async () => {
      await mgr.saveAppConfig({
        aiProvider: 'byok',
        byok: { provider: 'google', model: 'gemini-3.5-flash', apiKeys: { google: 'AIza-test-key' } },
      })
      // Already-correct projection + a custom provider the app does not
      // manage. Reconcile must skip entirely so the privacy-clear never
      // strips the custom key.
      writeConfig({
        models: {
          providers: {
            google: {
              baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
              api: 'google-generative-ai',
              apiKey: 'AIza-test-key',
              models: [{ id: 'gemini-3.5-flash' }],
            },
            'cpa-gpt4': { baseUrl: 'https://cpa-gpt4.example/v1', apiKey: 'custom-secret', models: [{ id: 'gpt-4' }] },
          },
        },
        agents: {
          defaults: { model: { primary: 'google/gemini-3.5-flash' } },
          list: [{ id: 'main', model: { primary: 'google/gemini-3.5-flash' } }],
        },
      })

      await mgr.reconcileActiveProvider()

      const config = readConfig()
      expect(config.models.providers['cpa-gpt4'].apiKey).toBe('custom-secret')
      expect(config.models.providers.google.apiKey).toBe('AIza-test-key')
    })
  })

  // ── repairGatewayRejections — corruption-only repair, safe for external mode ──

  describe('repairGatewayRejections', () => {
    it('repairs bad compat.maxTokensField and reports change', async () => {
      // Skip the auto-repair on initial write by writing raw JSON.
      writeConfig({
        models: {
          providers: {
            'cpa-gpt4': {
              baseUrl: 'https://cpa-gpt4.example/v1',
              api: 'openai-completions',
              models: [{
                id: 'gpt-4',
                compat: { maxTokensField: '100000' },
              }],
            },
          },
        },
      })
      const changed = await mgr.repairGatewayRejections()
      expect(changed).toBe(true)
      const config = readConfig()
      expect(config.models.providers['cpa-gpt4'].models[0].compat.maxTokensField).toBe('max_tokens')
    })

    it('returns false and does NOT add defaults when nothing is corrupt', async () => {
      // External-mode safety: the repair must not inject agents.list,
      // gateway.mode, or any other "default" the broader validator adds.
      // External openclaw owns those — we only touch fields that crash the gateway.
      writeConfig({
        models: {
          providers: {
            custom: {
              baseUrl: 'https://example/v1',
              api: 'openai-completions',
              models: [{ id: 'gpt-4', compat: { maxTokensField: 'max_tokens' } }],
            },
          },
        },
      })
      const before = JSON.stringify(readConfig())
      const changed = await mgr.repairGatewayRejections()
      expect(changed).toBe(false)
      expect(JSON.stringify(readConfig())).toBe(before)
    })

    it('returns false on missing config without creating it', async () => {
      const changed = await mgr.repairGatewayRejections()
      expect(changed).toBe(false)
      expect(fs.existsSync(configPath)).toBe(false)
    })

    // ── Dangling plugins.entries — the qqbot incident. A user-added or
    // CLI-added plugin entry whose plugin code isn't on disk crashes every
    // `openclaw …` CLI invocation (cron list, hooks, plugins page), so the
    // desktop UI shows "OpenClaw must be running" even when the gateway is.

    it('removes plugins.entries pointing at plugins not present on disk', async () => {
      // Source 1: write an installs.json registry listing only `telegram`.
      const pluginsDir = path.join(configDir, 'plugins')
      fs.mkdirSync(pluginsDir, { recursive: true })
      fs.writeFileSync(
        path.join(pluginsDir, 'installs.json'),
        JSON.stringify({ plugins: [{ pluginId: 'telegram' }] }),
      )
      writeConfig({
        plugins: {
          entries: {
            telegram: { enabled: true },           // known → keep
            qqbot: { enabled: true },              // dangling → remove
            'ghost-plugin': { enabled: false },    // dangling → remove
          },
        },
      })
      const changed = await mgr.repairGatewayRejections()
      expect(changed).toBe(true)
      const config = readConfig()
      expect(config.plugins.entries.telegram).toEqual({ enabled: true })
      expect(config.plugins.entries.qqbot).toBeUndefined()
      expect(config.plugins.entries['ghost-plugin']).toBeUndefined()
    })

    it('deletes the entries map entirely when every entry was dangling', async () => {
      const pluginsDir = path.join(configDir, 'plugins')
      fs.mkdirSync(pluginsDir, { recursive: true })
      fs.writeFileSync(
        path.join(pluginsDir, 'installs.json'),
        JSON.stringify({ plugins: [{ pluginId: 'telegram' }] }),
      )
      writeConfig({ plugins: { entries: { qqbot: { enabled: true } } } })
      await mgr.repairGatewayRejections()
      const config = readConfig()
      expect(config.plugins?.entries).toBeUndefined()
    })

    it('treats ~/.openclaw/extensions/<id>/ as a valid plugin source', async () => {
      // No installs.json — only the extensions dir. The dir-based source
      // must keep `discord` while still removing `qqbot`.
      const extDir = path.join(configDir, 'extensions', 'discord')
      fs.mkdirSync(extDir, { recursive: true })
      writeConfig({
        plugins: {
          entries: {
            discord: { enabled: true },
            qqbot: { enabled: true },
          },
        },
      })
      await mgr.repairGatewayRejections()
      const config = readConfig()
      expect(config.plugins.entries.discord).toEqual({ enabled: true })
      expect(config.plugins.entries.qqbot).toBeUndefined()
    })

    it('does NOT touch plugins.entries when no install source can be enumerated', async () => {
      // Fresh setup: no installs.json AND no extensions dir. We have no way
      // to tell legitimate entries from dangling ones — leave them alone
      // rather than delete user data.
      writeConfig({
        plugins: { entries: { qqbot: { enabled: true } } },
      })
      const changed = await mgr.repairGatewayRejections()
      expect(changed).toBe(false)
      const config = readConfig()
      expect(config.plugins.entries.qqbot).toEqual({ enabled: true })
    })

    // ── installs.json edge cases caught in independent review ──

    it('treats empty plugins[] in installs.json as untrustworthy (does NOT nuke entries)', async () => {
      // Half-written / migration-in-progress registries can show plugins: [].
      // Trusting that as authoritative would delete every legitimate entry.
      const pluginsDir = path.join(configDir, 'plugins')
      fs.mkdirSync(pluginsDir, { recursive: true })
      fs.writeFileSync(path.join(pluginsDir, 'installs.json'), JSON.stringify({ plugins: [] }))
      writeConfig({
        plugins: { entries: { telegram: { enabled: true }, discord: { enabled: true } } },
      })
      const changed = await mgr.repairGatewayRejections()
      expect(changed).toBe(false)
      const config = readConfig()
      expect(config.plugins.entries.telegram).toEqual({ enabled: true })
      expect(config.plugins.entries.discord).toEqual({ enabled: true })
    })

    it('treats installs.json without a plugins[] array as untrustworthy', async () => {
      const pluginsDir = path.join(configDir, 'plugins')
      fs.mkdirSync(pluginsDir, { recursive: true })
      // Truncated / weird shape — should NOT delete entries.
      fs.writeFileSync(path.join(pluginsDir, 'installs.json'), JSON.stringify({ version: 1 }))
      writeConfig({ plugins: { entries: { telegram: { enabled: true } } } })
      const changed = await mgr.repairGatewayRejections()
      expect(changed).toBe(false)
      expect(readConfig().plugins.entries.telegram).toEqual({ enabled: true })
    })

    it('serializes against concurrent writeConfig (no lost-update race)', async () => {
      // Set up a config that needs repair AND fire a concurrent writeConfig.
      // The expected steady state: BOTH updates land — neither silently
      // clobbers the other. (Previously repairGatewayRejections did the
      // read outside the lock, opening a lost-update window.)
      writeConfig({
        models: {
          providers: {
            'cpa-gpt4': {
              api: 'openai-completions',
              models: [{ id: 'gpt-4', compat: { maxTokensField: '100000' } }],
            },
          },
        },
      })
      const concurrent = mgr.writeConfig({
        models: { providers: { newone: { api: 'openai-responses', apiKey: 'k' } } },
        gateway: { port: 31337 },
      })
      const repair = mgr.repairGatewayRejections()
      await Promise.all([concurrent, repair])
      const final = readConfig()
      // The concurrent write's gateway.port is preserved (not clobbered by
      // repair writing a stale snapshot).
      expect(final.gateway.port).toBe(31337)
    })

    // ── thinkingFormat enum (independent review HIGH-finding gap) ──

    it('removes invalid compat.thinkingFormat enum values', async () => {
      await mgr.writeConfig({
        models: {
          providers: {
            custom: {
              api: 'openai-completions',
              models: [{
                id: 'm',
                compat: { thinkingFormat: 'claude-style' as any },
              }],
            },
          },
        },
      })
      expect(readConfig().models.providers.custom.models[0].compat.thinkingFormat).toBeUndefined()
    })

    it('preserves a valid compat.thinkingFormat', async () => {
      await mgr.writeConfig({
        models: {
          providers: {
            custom: {
              api: 'openai-completions',
              models: [{ id: 'm', compat: { thinkingFormat: 'deepseek' } }],
            },
          },
        },
      })
      expect(readConfig().models.providers.custom.models[0].compat.thinkingFormat).toBe('deepseek')
    })

    // ── string-array compat fields ──

    it('drops compat.visibleReasoningDetailTypes when not a clean string array', async () => {
      await mgr.writeConfig({
        models: {
          providers: {
            custom: {
              api: 'openai-completions',
              models: [{
                id: 'm',
                compat: {
                  visibleReasoningDetailTypes: ['ok', '', 5 as any],
                  supportedReasoningEfforts: 'not-an-array' as any,
                },
              }],
            },
          },
        },
      })
      const compat = readConfig().models.providers.custom.models[0].compat
      expect(compat.visibleReasoningDetailTypes).toBeUndefined()
      expect(compat.supportedReasoningEfforts).toBeUndefined()
    })

    it('preserves a clean string-array compat field', async () => {
      await mgr.writeConfig({
        models: {
          providers: {
            custom: {
              api: 'openai-completions',
              models: [{
                id: 'm',
                compat: { supportedReasoningEfforts: ['low', 'high'] },
              }],
            },
          },
        },
      })
      expect(readConfig().models.providers.custom.models[0].compat.supportedReasoningEfforts).toEqual(['low', 'high'])
    })

    it('drops compat.reasoningEffortMap when shape is wrong', async () => {
      await mgr.writeConfig({
        models: {
          providers: {
            custom: {
              api: 'openai-completions',
              models: [{
                id: 'm',
                compat: { reasoningEffortMap: { low: 'minimal', high: 42 as any } },
              }],
            },
          },
        },
      })
      expect(readConfig().models.providers.custom.models[0].compat.reasoningEffortMap).toBeUndefined()
    })

    // ── repairGatewayRejections "no defaults" contract (independent review concern) ──

    it('repairGatewayRejections fixes corruption WITHOUT injecting agents.list defaults', async () => {
      // Customer reported the desktop quietly adding agents.list = [{id:'main'}]
      // to externally-managed configs. The corruption-only path must NOT do that.
      writeConfig({
        models: {
          providers: {
            'cpa-gpt4': {
              api: 'openai-completions',
              models: [{ id: 'gpt-4', compat: { maxTokensField: '100000' } }],
            },
          },
        },
      })
      expect(readConfig().agents).toBeUndefined()
      const changed = await mgr.repairGatewayRejections()
      expect(changed).toBe(true)
      const after = readConfig()
      // Repair landed
      expect(after.models.providers['cpa-gpt4'].models[0].compat.maxTokensField).toBe('max_tokens')
      // No agents.list injected
      expect(after.agents).toBeUndefined()
    })

    it('combined sweep: repairs both compat field and dangling plugin in one write', async () => {
      const pluginsDir = path.join(configDir, 'plugins')
      fs.mkdirSync(pluginsDir, { recursive: true })
      fs.writeFileSync(
        path.join(pluginsDir, 'installs.json'),
        JSON.stringify({ plugins: [{ pluginId: 'telegram' }] }),
      )
      writeConfig({
        models: {
          providers: {
            'cpa-gpt4': {
              api: 'openai-completions',
              models: [{ id: 'gpt-4', compat: { maxTokensField: '100000' } }],
            },
          },
        },
        plugins: {
          entries: {
            telegram: { enabled: true },
            qqbot: { enabled: true },
          },
        },
      })
      const changed = await mgr.repairGatewayRejections()
      expect(changed).toBe(true)
      const config = readConfig()
      expect(config.models.providers['cpa-gpt4'].models[0].compat.maxTokensField).toBe('max_tokens')
      expect(config.plugins.entries.qqbot).toBeUndefined()
      expect(config.plugins.entries.telegram).toEqual({ enabled: true })
    })
  })

  // ── validateApiKey ─────────────────────────────────────────────────

  describe('validateApiKey', () => {
    it('rejects any Anthropic call now that BYOK Anthropic was removed (2026-06-15)', async () => {
      // Stale UI cache may still try to validate an `anthropic` key; the
      // main process refuses regardless of prefix so the user is forced
      // to repick a current provider. Was: accept-when-sk-ant-prefixed.
      expect(await mgr.validateApiKey('anthropic', 'sk-ant-abcdef123456')).toBe(false)
      expect(await mgr.validateApiKey('anthropic', 'invalid-key-123')).toBe(false)
    })

    it('should reject OpenAI key without sk- prefix', async () => {
      expect(await mgr.validateApiKey('openai', 'invalid-key-123')).toBe(false)
    })

    it('should accept valid OpenAI key', async () => {
      expect(await mgr.validateApiKey('openai', 'sk-proj-abcdef123456')).toBe(true)
    })

    it('should accept Google keys (no format check)', async () => {
      expect(await mgr.validateApiKey('google', 'AIzaSyAbcdef123456')).toBe(true)
    })
  })

  // ── ensureGatewayConfigured ────────────────────────────────────────

  describe('ensureGatewayConfigured', () => {
    it('should create gateway config from scratch', async () => {
      writeConfig({})
      await mgr.ensureGatewayConfigured(18802)
      const config = readConfig()
      expect(config.gateway.mode).toBe('local')
      expect(config.gateway.bind).toBe('loopback')
      expect(config.gateway.port).toBe(18802)
    })

    it('should NOT override existing port', async () => {
      writeConfig({ gateway: { mode: 'local', port: 18800, bind: 'loopback' } })
      await mgr.ensureGatewayConfigured(18805)
      const config = readConfig()
      expect(config.gateway.port).toBe(18800)
    })

    it('should set controlUi allowedOrigins', async () => {
      writeConfig({})
      await mgr.ensureGatewayConfigured(18800)
      const config = readConfig()
      expect(config.gateway.controlUi.allowedOrigins).toContain('http://localhost:5173')
      expect(config.gateway.controlUi.allowedOrigins).toContain('file://')
    })

    it('should set auth token when missing', async () => {
      writeConfig({})
      await mgr.ensureGatewayConfigured(18800)
      const config = readConfig()
      expect(config.gateway.auth).toBeDefined()
      expect(config.gateway.auth.token).toBeDefined()
    })

    it('should NOT overwrite existing complete gateway config', async () => {
      writeConfig({
        gateway: {
          mode: 'local',
          port: 18800,
          bind: 'loopback',
          auth: { mode: 'token', token: 'my-token' },
          controlUi: {
            allowedOrigins: ['http://localhost:5173', 'http://localhost:5174', 'file://', 'null'],
          },
        },
      })
      const before = readConfig()
      await mgr.ensureGatewayConfigured(18800)
      const after = readConfig()
      expect(after.gateway.auth.token).toBe('my-token')
    })
  })

  // ── ensureToolsConfigured ──────────────────────────────────────────

  describe('ensureToolsConfigured', () => {
    it('should enable web search and fetch when missing', async () => {
      writeConfig({})
      await mgr.ensureToolsConfigured()
      const config = readConfig()
      expect(config.tools.web.search.enabled).toBe(true)
      expect(config.tools.web.fetch.enabled).toBe(true)
    })

    it('should enable bash command', async () => {
      writeConfig({})
      await mgr.ensureToolsConfigured()
      const config = readConfig()
      expect(config.commands.bash).toBe(true)
    })

    it('should enable elevated tools', async () => {
      writeConfig({})
      await mgr.ensureToolsConfigured()
      const config = readConfig()
      expect(config.tools.elevated.enabled).toBe(true)
    })

    it('should set agent timeout to 600s (10 min per OpenClaw docs)', async () => {
      writeConfig({})
      await mgr.ensureToolsConfigured()
      const config = readConfig()
      expect(config.agents.defaults.timeoutSeconds).toBe(600)
    })

    it('preserves plugins.entries — the CLI persists enable/disable state there', async () => {
      writeConfig({
        plugins: {
          entries: { telegram: { enabled: true }, discord: { enabled: false } },
        },
      })
      await mgr.ensureToolsConfigured()
      const config = readConfig()
      expect(config.plugins.entries.telegram).toEqual({ enabled: true })
      expect(config.plugins.entries.discord).toEqual({ enabled: false })
    })
  })

  // ── cleanupInvalidToolNames ────────────────────────────────────────

  describe('cleanupInvalidToolNames', () => {
    it('should remove invalid tools (glob, grep)', async () => {
      writeConfig({
        agents: {
          list: [
            {
              id: 'main',
              tools: { allow: ['web_fetch', 'glob', 'grep', 'group:fs'] },
            },
          ],
        },
      })
      await mgr.cleanupInvalidToolNames()
      const config = readConfig()
      const tools = agentAt(config, 0).tools.allow
      expect(tools).not.toContain('glob')
      expect(tools).not.toContain('grep')
      expect(tools).toContain('web_fetch')
      expect(tools).toContain('group:fs')
    })

    it('should consolidate individual fs tools to group:fs', async () => {
      writeConfig({
        agents: {
          list: [
            {
              id: 'main',
              tools: { allow: ['read', 'write', 'edit', 'web_fetch'] },
            },
          ],
        },
      })
      await mgr.cleanupInvalidToolNames()
      const config = readConfig()
      const tools = agentAt(config, 0).tools.allow
      expect(tools).not.toContain('read')
      expect(tools).not.toContain('write')
      expect(tools).not.toContain('edit')
      expect(tools).toContain('group:fs')
    })

    it('should consolidate individual runtime tools to group:runtime', async () => {
      writeConfig({
        agents: {
          list: [
            {
              id: 'main',
              tools: { allow: ['exec', 'bash', 'process', 'web_fetch'] },
            },
          ],
        },
      })
      await mgr.cleanupInvalidToolNames()
      const config = readConfig()
      const tools = agentAt(config, 0).tools.allow
      expect(tools).not.toContain('exec')
      expect(tools).not.toContain('bash')
      expect(tools).not.toContain('process')
      expect(tools).toContain('group:runtime')
    })

    it('should remove apply_patch', async () => {
      writeConfig({
        agents: {
          list: [
            {
              id: 'main',
              tools: { allow: ['web_fetch', 'apply_patch'] },
            },
          ],
        },
      })
      await mgr.cleanupInvalidToolNames()
      const config = readConfig()
      const tools = agentAt(config, 0).tools.allow
      expect(tools).not.toContain('apply_patch')
    })

    it('should not duplicate group:fs when already present', async () => {
      writeConfig({
        agents: {
          list: [
            {
              id: 'main',
              tools: { allow: ['read', 'group:fs'] },
            },
          ],
        },
      })
      await mgr.cleanupInvalidToolNames()
      const config = readConfig()
      const tools = agentAt(config, 0).tools.allow
      const fsGroupCount = tools.filter((t: string) => t === 'group:fs').length
      expect(fsGroupCount).toBe(1)
    })

    it('should do nothing when no invalid tools', async () => {
      writeConfig({
        agents: {
          list: [
            {
              id: 'main',
              tools: { allow: ['web_fetch', 'group:fs', 'group:runtime'] },
            },
          ],
        },
      })
      const mtimeBefore = fs.statSync(configPath).mtimeMs
      await new Promise(r => setTimeout(r, 50))
      await mgr.cleanupInvalidToolNames()
      const mtimeAfter = fs.statSync(configPath).mtimeMs
      expect(mtimeAfter).toBe(mtimeBefore)
    })

    it('should handle config without agents.list', async () => {
      writeConfig({ gateway: { port: 18800 } })
      // Should not throw
      await mgr.cleanupInvalidToolNames()
    })
  })

  // ── Write-lock serialization ───────────────────────────────────────

  describe('write-lock serialization', () => {
    it('should serialize concurrent writeConfig calls', async () => {
      // Track write order
      const writeOrder: number[] = []
      const original = fs.writeFileSync.bind(fs)

      // First writeConfig triggers slow operation, second should wait
      const p1 = mgr.writeConfig({ agents: { defaults: { model: { primary: 'google/gemini-2.5-flash' } } } })
        .then(() => writeOrder.push(1))
      const p2 = mgr.writeConfig({ agents: { defaults: { model: { primary: 'openai/gpt-4o' } } } })
        .then(() => writeOrder.push(2))

      await Promise.all([p1, p2])

      // Both should complete (order is guaranteed by the lock)
      expect(writeOrder).toEqual([1, 2])
    })
  })

  // ── createDefaultConfig ────────────────────────────────────────────

  describe('createDefaultConfig', () => {
    it('should create a valid default config', async () => {
      await mgr.createDefaultConfig(18800)
      expect(fs.existsSync(configPath)).toBe(true)
      const config = readConfig()
      expect(config.gateway).toBeDefined()
      expect(config.gateway.port).toBe(18800)
      expect(config.agents).toBeDefined()
    })
  })

  // ── updateGatewayPort ──────────────────────────────────────────────

  describe('updateGatewayPort', () => {
    it('should update gateway port in existing config', async () => {
      writeConfig({ gateway: { port: 18800, mode: 'local' }, agents: { list: [{ id: 'main' }] } })
      await mgr.updateGatewayPort(18805)
      const config = readConfig()
      expect(config.gateway.port).toBe(18805)
      expect(config.gateway.mode).toBe('local')
    })

    it('should create gateway section when missing', async () => {
      writeConfig({ agents: { list: [{ id: 'main' }] } })
      await mgr.updateGatewayPort(18802)
      const config = readConfig()
      expect(config.gateway.port).toBe(18802)
    })
  })

  // ── app-config auth persistence ────────────────────────────────────

  describe('syncAgentModelsWithDefault', () => {
    // Regression: this repair read `agents.list` directly, so once upstream
    // renamed the roster to the keyed `agents.entries` it exited immediately
    // and every agent stayed pinned to the previous provider's model after a
    // provider switch — a silent no-op with no visible failure.
    it('repoints a stale agent on the canonical keyed roster', async () => {
      writeConfig({
        agents: {
          defaults: { model: { primary: 'google/gemini-3-pro' } },
          entries: { main: { model: { primary: 'openai/gpt-5.5-pro' } } },
        },
      })

      await mgr.syncAgentModelsWithDefault()

      expect(readConfig().agents.entries.main.model.primary).toBe('google/gemini-3-pro')
    })

    it('still repairs an unmigrated legacy roster', async () => {
      writeConfig({
        agents: {
          defaults: { model: { primary: 'google/gemini-3-pro' } },
          list: [{ id: 'main', model: { primary: 'openai/gpt-5.5-pro' } }],
        },
      })

      await mgr.syncAgentModelsWithDefault()

      const roster = rosterEntries(readConfig())
      expect(roster.find((a: any) => a.id === 'main').model.primary).toBe('google/gemini-3-pro')
    })

    it('leaves agents that already match the default provider alone', async () => {
      writeConfig({
        agents: {
          defaults: { model: { primary: 'google/gemini-3-pro' } },
          entries: { main: { model: { primary: 'google/gemini-3-flash' } } },
        },
      })

      await mgr.syncAgentModelsWithDefault()

      // Same provider — a different model on that provider is a deliberate
      // per-agent choice, not drift.
      expect(readConfig().agents.entries.main.model.primary).toBe('google/gemini-3-flash')
    })
  })
})
