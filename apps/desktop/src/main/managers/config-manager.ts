import * as path from 'path'
import { app, safeStorage } from 'electron'
import { existsSync, readdirSync, statSync, rmSync } from 'fs'
import { readFile, writeFile, mkdir, copyFile, rename, unlink } from 'fs/promises'
import { Logger } from './logger'
import { BYOK_PROVIDER_MODELS, defaultByokModelId } from '../../shared/providerModels'
import { DEFAULT_GATEWAY_PORT } from '../../shared/constants'
import { getVendoredCoreRoot } from '../vendored-core-root'
import { migrateLegacyAgentRuntime } from './agent-runtime-config'
import { listAgents, ensureAgent, isRosterEmpty } from './agent-roster'
import { buildAuthProfileSyncCommand, type AuthProfileSyncRequest } from './auth-profile-sync'

// ─── BYOK provider table ──────────────────────────────────────────────
// Single source of truth for everything `applyProviderToOpenClaw` writes
// to `models.providers.<id>` for each BYOK provider. The model catalog
// itself lives in shared/providerModels.ts; this table layers the
// per-provider connection settings on top.
// Anthropic dropped from BYOK 2026-06-15 — direct sk-ant-* keys are not
// authorized for OpenClaw clients. OpenRouter still exposes
// anthropic/claude-* under its own aggregator key, which does not use
// the user's Anthropic API key.
type ByokProviderId = 'google' | 'openai' | 'venice' | 'openrouter'

interface ByokProviderDef {
  /** Upstream API base URL written to `providers.<id>.baseUrl`. */
  baseUrl: string
  /** Gateway api-kind discriminator. */
  api: 'google-generative-ai' | 'openai-responses'
  /** Optional extra headers built from the apiKey (Google uses X-goog-api-key). */
  buildHeaders?: (apiKey: string) => Record<string, string>
  /**
   * Bare aliases NOT in the catalog but accepted by the validation gate.
   */
  extraAllowedModelIds?: readonly string[]
  /**
   * If set, the model id must start with this prefix to even be considered.
   * Google enforces 'gemini' so a stray 'claude-...' value triggers the
   * fallback path immediately.
   */
  modelIdPrefix?: string
  /** If true, write a fallback correction back to app-config.json so it survives restarts. */
  persistFallback?: boolean
  /** If true, validate model against the catalog allowlist. Aggregators (venice, openrouter) opt out. */
  validateModel?: boolean
}

const BYOK_PROVIDER_DEFS: Record<ByokProviderId, ByokProviderDef> = {
  google: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    api: 'google-generative-ai',
    buildHeaders: (apiKey) => ({ 'X-goog-api-key': apiKey }),
    modelIdPrefix: 'gemini',
    validateModel: true,
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    api: 'openai-responses',
    validateModel: true,
  },
  venice: {
    baseUrl: 'https://api.venice.ai/api/v1',
    api: 'openai-responses',
    // Aggregator-style catalog — no allowlist; trust whatever the UI picks.
    validateModel: false,
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    api: 'openai-responses',
    validateModel: false,
  },
}

export interface AppProviderConfig {
  aiProvider: 'byok' | 'local'
  byok?: {
    // Anthropic removed 2026-06-15 — see top of file.
    provider: 'google' | 'openai' | 'venice' | 'openrouter'
    model: string  // e.g. 'gemini-2.5-flash', 'gpt-5.4-mini'
    apiKeys?: {
      google?: string
      openai?: string
      venice?: string
      openrouter?: string
      /**
       * Legacy slot retained so callers reading old app-config.json files
       * don't crash when this field is still present. Not written by the
       * desktop UI — the BYOK Anthropic option was removed 2026-06-15.
       */
      anthropic?: string
    }
  }
  local?: {
    model: string  // e.g. 'llama3.2:3b', 'qwen3:latest'
  }
  stt?: {
    provider: 'local' | 'openai' | 'google'
    openaiApiKey?: string
    googleApiKey?: string
    localEndpoint?: string  // e.g. 'http://localhost:8000'
    localModel?: string     // e.g. 'Systran/faster-whisper-large-v3'
  }
}

export class ConfigManager {
  private logger?: Logger
  private configPath: string
  private appConfigPath: string
  // Serializes all writes to openclaw.json so concurrent IPC handlers
  // (e.g. config:save and auth:sync-remote-backend) never interleave writes
  // and corrupt the file.
  private writeLock: Promise<void> = Promise.resolve()
  // Runs `openclaw models auth paste-*` for credential syncs into the
  // per-agent SQLite auth store. Wired by the owner (OpenClawManager /
  // desktop app init) right after construction.
  private commandExecutor: {
    executeCommand(args: string[], timeoutMs?: number, opts?: { stdinData?: string }): Promise<string | null>
  } | null = null

  constructor(logger?: Logger) {
    this.logger = logger
    this.configPath = this.getConfigPath()
    this.appConfigPath = this.getAppConfigPath()
  }

  setCommandExecutor(executor: {
    executeCommand(args: string[], timeoutMs?: number, opts?: { stdinData?: string }): Promise<string | null>
  }): void {
    this.commandExecutor = executor
  }

  private withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeLock.then(fn)
    // Keep the lock chain alive even if fn throws, so subsequent callers still run
    this.writeLock = next.then(() => {}, () => {})
    return next
  }

  /**
   * Atomic read-modify-write of openclaw.json under the write lock.
   *
   * The mutator runs on the freshly-loaded config and returns `true` if it
   * changed anything. When it returns `false` (or `undefined`) we skip the
   * write entirely — no backup, no I/O — which matters because every other
   * method on this class is allowed to call us at startup whether or not it
   * actually needs to mutate.
   *
   * The whole sequence (load → mutate → backup → validate → write) happens
   * inside `withWriteLock`, so a concurrent `config:save` IPC cannot land
   * between our read and write and get silently clobbered.
   *
   * NOTE: this is the right tool for ANY load-modify-write path EXCEPT
   * `repairGatewayRejections`, which deliberately skips
   * `validateAndRepairConfig` to honor its "no defaults injected" contract
   * (it runs in external gateway mode where the desktop must not augment
   * the system-owned config).
   *
   * Public so adjacent managers (SkillsManager, ChannelManager, etc.) can
   * adopt the locked RMW path instead of repeating the lost-update race.
   */
  mutateConfig(mutator: (config: any) => boolean | Promise<boolean> | void | Promise<void>): Promise<boolean> {
    return this.withWriteLock(async () => {
      const config = await this.loadConfig()
      const result = await mutator(config)
      const changed = result === undefined ? true : result
      if (!changed) return false

      await this.backupConfig()
      const { config: validated, warnings } = this.validateAndRepairConfig(config)
      if (warnings.length > 0) {
        console.warn('[ConfigManager] Config validation warnings:', warnings)
        warnings.forEach(w => this.logger?.addLog(`⚠️ Config: ${w}`))
      }
      await this.writeConfigAtomic(validated)
      return true
    })
  }

  /**
   * Navigate a dotted path into `obj`, creating intermediate plain objects
   * for any segment that is missing/null. Returns the leaf object so the
   * caller can read or assign keys on it. Does NOT overwrite existing
   * non-null values (an empty `{}` is preserved).
   *
   * Replaces the
   *   `if (!config.agents) config.agents = {}; if (!config.agents.defaults) ...`
   * boilerplate that appears in nearly every method.
   */
  private static ensurePath(obj: any, dotPath: string): any {
    const parts = dotPath.split('.')
    let cur = obj
    for (const p of parts) {
      if (cur[p] == null) cur[p] = {}
      cur = cur[p]
    }
    return cur
  }

  getAppConfigPath(): string {
    const userHome = app.getPath('home')
    // Desktop app-specific config (auth token, UI preferences, etc.)
    // Separate from OpenClaw's main config
    return path.join(userHome, '.config', 'openclaw-desktop', 'app-config.json')
  }

  getConfigPath(): string {
    return path.join(this.getOpenClawDir(), 'openclaw.json')
  }

  /**
   * Root of the OpenClaw user data directory (~/.openclaw). All path
   * resolution inside ConfigManager goes through this helper so tests
   * that mock `electron.app.getPath('home')` see a consistent root —
   * previously some call sites used `os.homedir()` directly and bypassed
   * the mock, picking up the real `$HOME` and reading prod state during
   * tests.
   */
  private getOpenClawDir(): string {
    return path.join(app.getPath('home'), '.openclaw')
  }

  /**
   * Atomically persist openclaw.json: write a temp file then rename over the
   * target. rename() is atomic on the same filesystem, so a crash/power loss
   * mid-write can never leave a truncated openclaw.json that loadConfig would
   * misread as "{}" and then overwrite with defaults.
   */
  private async writeConfigAtomic(config: any): Promise<void> {
    // UNIQUE temp name per write. A fixed name races under concurrent writers:
    // A renames its temp into place, then B's rename hits ENOENT because the
    // shared temp is already gone. Unique names make each write independent.
    const tmp = `${this.configPath}.tmp-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
    try {
      await writeFile(tmp, JSON.stringify(config, null, 2), 'utf-8')
      await rename(tmp, this.configPath)
    } catch (err) {
      // Don't leave an orphan temp behind if the write/rename failed.
      try { await unlink(tmp) } catch { /* already gone */ }
      throw err
    }
  }

  async loadConfig(): Promise<any> {
    let content: string
    try {
      content = await readFile(this.configPath, 'utf8')
    } catch {
      return {} // No config yet (fresh install) — a legitimately empty state.
    }
    try {
      return JSON.parse(content)
    } catch (error) {
      // The file exists but doesn't parse (e.g. a torn legacy write). Returning
      // {} here would let validateAndRepairConfig overwrite the user's real
      // channels/providers/agents with defaults — silent, unrecoverable loss.
      // Recover from the most recent backup that parses instead.
      console.error('[ConfigManager] openclaw.json is corrupt; attempting backup recovery:', error)
      for (const suffix of ['.bak', '.bak2', '.bak3']) {
        const bak = `${this.configPath}${suffix}`
        try {
          const parsed = JSON.parse(await readFile(bak, 'utf8'))
          console.warn(`[ConfigManager] Recovered config from ${suffix}`)
          // Re-heal the primary (atomic) so the next read is clean.
          await this.writeConfigAtomic(parsed).catch(() => {})
          return parsed
        } catch {
          // Try the next backup.
        }
      }
      console.error('[ConfigManager] No usable config backup; returning empty config')
      return {}
    }
  }

  async getAppConfig(): Promise<any | null> {
    try {
      if (!existsSync(this.appConfigPath)) {
        return null
      }
      const configData = await readFile(this.appConfigPath, 'utf-8')
      const config = JSON.parse(configData)
      // An app-config written by a build that offered a hosted provider names
      // one this build cannot authenticate to. Left as-is it matches no case
      // in applyProviderToOpenClaw, so the stale hosted baseUrl in
      // openclaw.json is never re-projected and the gateway keeps calling a
      // backend we have no credential for. Normalizing to BYOK makes the
      // provider projection run and overwrite that routing.
      if (config?.aiProvider && config.aiProvider !== 'byok' && config.aiProvider !== 'local') {
        console.log(`[ConfigManager] Unsupported aiProvider "${config.aiProvider}" in app-config — treating as byok`)
        config.aiProvider = 'byok'
      }
      return config
    } catch (error) {
      console.error('Failed to read app config:', error)
      return null
    }
  }

  async saveAppConfig(config: any): Promise<void> {
    try {
      const configDir = path.dirname(this.appConfigPath)
      if (!existsSync(configDir)) {
        await mkdir(configDir, { recursive: true })
      }
      await writeFile(this.appConfigPath, JSON.stringify(config, null, 2), 'utf-8')
      console.log('App config saved:', this.appConfigPath)
    } catch (error) {
      console.error('Failed to save app config:', error)
      throw error
    }
  }

  /**
   * Validate config before writing to catch issues early
   * Returns validated config with auto-repairs applied
   */
  private validateAndRepairConfig(config: any): { config: any; warnings: string[] } {
    const warnings: string[] = []
    const repaired = { ...config }

    // ── Agents ──
    if (!repaired.agents) {
      repaired.agents = {}
      warnings.push('Created missing agents structure')
    }
    if (isRosterEmpty(repaired)) {
      ensureAgent(repaired, 'main')
      warnings.push('Created missing agents.entries with default "main" agent')
    }
    if (!repaired.agents.defaults) {
      repaired.agents.defaults = {}
      warnings.push('Created missing agents.defaults structure')
    }
    if (!repaired.agents.defaults.model) {
      repaired.agents.defaults.model = {}
      warnings.push('Created missing agents.defaults.model structure')
    }
    if (!repaired.agents.defaults.model.primary) {
      warnings.push('WARNING: agents.defaults.model.primary is not set - agent may not work correctly')
    }

    // Detect and repair mismatched provider/model combinations
    const primaryModel = repaired.agents.defaults.model.primary
    if (primaryModel && typeof primaryModel === 'string') {
      const [provider, modelId] = primaryModel.split('/')
      if (provider && modelId) {
        let fixedModel = primaryModel
        if (modelId.startsWith('gemini') && provider !== 'google') {
          fixedModel = `google/${modelId}`
        } else if (modelId.startsWith('claude') && provider !== 'openrouter') {
          // OpenRouter is the only BYOK path to Claude here — direct
          // Anthropic keys were removed 2026-06-15 and OpenAI does not
          // serve Claude, so re-prefixing to `openai/` would produce a
          // model the provider rejects. OpenRouter passes through the
          // upstream id, hence the `anthropic/` namespace.
          fixedModel = `openrouter/anthropic/${modelId}`
        } else if ((modelId.startsWith('gpt') || modelId.startsWith('o')) && provider !== 'openai') {
          fixedModel = `openai/${modelId}`
        }
        if (fixedModel !== primaryModel) {
          repaired.agents.defaults.model.primary = fixedModel
          warnings.push(`🔧 Fixed mismatched model: "${primaryModel}" → "${fixedModel}"`)
        }
      }
    }

    // Detect and repair orphaned models — agent primary points to a model
    // that is NOT in its provider's models[] list. Happens when a config
    // outlives the catalog it was written against (provider switch, model
    // retired upstream). The chat path would otherwise send the orphaned id
    // and get a 400 "Model not found" back.
    const isModelOrphaned = (modelPath: unknown): boolean => {
      if (!modelPath || typeof modelPath !== 'string') return false
      const slashIdx = modelPath.indexOf('/')
      if (slashIdx <= 0 || slashIdx === modelPath.length - 1) return false
      const providerName = modelPath.slice(0, slashIdx)
      const modelId = modelPath.slice(slashIdx + 1)
      const provider = repaired.models?.providers?.[providerName]
      // No provider entry at all → treat as orphan
      if (!provider) return true
      // No models[] list to validate against → trust it (some providers don't list models)
      if (!Array.isArray(provider.models) || provider.models.length === 0) return false
      return !provider.models.some((m: any) => m?.id === modelId)
    }

    const pickReplacementModel = (): string | undefined => {
      // Prefer defaults.primary if it is itself valid
      const def = repaired.agents.defaults.model.primary
      if (def && typeof def === 'string' && !isModelOrphaned(def)) return def
      // Else, fall back to first provider+first model
      const providers = repaired.models?.providers
      if (providers && typeof providers === 'object') {
        for (const [name, p] of Object.entries(providers)) {
          const models = (p as any)?.models
          if (Array.isArray(models) && models.length > 0 && models[0]?.id) {
            return `${name}/${models[0].id}`
          }
        }
      }
      return undefined
    }

    // Repair defaults.model.primary if orphaned
    if (isModelOrphaned(repaired.agents.defaults.model.primary)) {
      const replacement = pickReplacementModel()
      if (replacement && replacement !== repaired.agents.defaults.model.primary) {
        warnings.push(`🔧 Fixed orphaned default model "${repaired.agents.defaults.model.primary}" → "${replacement}"`)
        repaired.agents.defaults.model.primary = replacement
      }
    }

    // Repair each roster entry whose primary is orphaned
    if (!isRosterEmpty(repaired)) {
      const replacement = pickReplacementModel()
      for (const { id: agentId } of listAgents(repaired)) {
        const agent = ensureAgent(repaired, agentId)
        const original = agent?.model?.primary
        if (typeof original !== 'string') continue
        if (isModelOrphaned(original) && replacement && replacement !== original) {
          if (!agent.model) agent.model = {}
          agent.model.primary = replacement
          warnings.push(`🔧 Fixed orphaned agent "${agent.id ?? '?'}" model "${original}" → "${replacement}"`)
        }
      }
    }

    // ── Gateway — only repair fields within an existing section, never create from scratch.
    // The gateway config is owned by the system OpenClaw; creating defaults here could
    // overwrite the actual port/settings used by the LaunchAgent/service.
    if (repaired.gateway) {
      if (!repaired.gateway.mode) {
        repaired.gateway.mode = 'local'
        warnings.push('Set gateway.mode to default "local"')
      }
    }

    // ── Channels — each entry must be an object; credential fields must be non-empty strings ──
    // The gateway zod validator rejects non-object channel entries and non-string tokens.
    if (repaired.channels && typeof repaired.channels === 'object') {
      const credentialFields = ['token', 'apiKey', 'apiSecret', 'webhook', 'botToken', 'signingSecret', 'appToken']
      for (const [channelName, channelConfig] of Object.entries(repaired.channels)) {
        // Channel entry must be an object (e.g. { token: "...", ... }).
        // Non-object values like `true`, `false`, `"string"`, `null` are invalid.
        if (!channelConfig || typeof channelConfig !== 'object' || Array.isArray(channelConfig)) {
          delete (repaired.channels as any)[channelName]
          warnings.push(`🔧 Removed invalid channels.${channelName} (expected object, got ${channelConfig === null ? 'null' : typeof channelConfig})`)
          continue
        }
        for (const field of credentialFields) {
          const value = (channelConfig as any)[field]
          if (value === undefined) continue
          if (typeof value !== 'string') {
            delete (channelConfig as any)[field]
            warnings.push(`🔧 Removed invalid channels.${channelName}.${field} (expected string, got ${typeof value})`)
          } else if (value.trim() === '') {
            delete (channelConfig as any)[field]
            warnings.push(`🔧 Removed empty channels.${channelName}.${field}`)
          }
        }
      }
    }

    // ── Plugins — each entry must be an object; enabled must be boolean ──
    if (repaired.plugins?.entries && typeof repaired.plugins.entries === 'object') {
      for (const [pluginId, entry] of Object.entries(repaired.plugins.entries)) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          delete repaired.plugins.entries[pluginId]
          warnings.push(`🔧 Removed invalid plugins.entries.${pluginId} (expected object, got ${entry === null ? 'null' : typeof entry})`)
          continue
        }
        const enabled = (entry as any).enabled
        if (enabled !== undefined && typeof enabled !== 'boolean') {
          // Coerce truthy string values ("true", "1") to boolean, remove anything else
          if (enabled === 'true' || enabled === '1') {
            (entry as any).enabled = true
          } else if (enabled === 'false' || enabled === '0') {
            (entry as any).enabled = false
          } else {
            delete (entry as any).enabled
            warnings.push(`🔧 Removed invalid plugins.entries.${pluginId}.enabled (expected boolean, got ${typeof enabled})`)
          }
        }
      }
    }

    // ── Skills — each entry must be an object; enabled must be boolean ──
    if (repaired.skills?.entries && typeof repaired.skills.entries === 'object') {
      for (const [skillName, entry] of Object.entries(repaired.skills.entries)) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          delete repaired.skills.entries[skillName]
          warnings.push(`🔧 Removed invalid skills.entries.${skillName} (expected object, got ${entry === null ? 'null' : typeof entry})`)
          continue
        }
        const enabled = (entry as any).enabled
        if (enabled !== undefined && typeof enabled !== 'boolean') {
          if (enabled === 'true' || enabled === '1') {
            (entry as any).enabled = true
          } else if (enabled === 'false' || enabled === '0') {
            (entry as any).enabled = false
          } else {
            delete (entry as any).enabled
            warnings.push(`🔧 Removed invalid skills.entries.${skillName}.enabled (expected boolean, got ${typeof enabled})`)
          }
        }
      }
    }

    // ── Models — provider configs must have string apiKey/baseUrl, and every
    // models[].compat field must satisfy the gateway zod schema (strict mode +
    // narrow enums) or the gateway rejects the whole config at startup and
    // enters a supervisor crash-loop. Sanitize known-bad shapes so user-added
    // providers (e.g. custom OpenAI proxies) can't brick the Assistant.
    if (repaired.models?.providers && typeof repaired.models.providers === 'object') {
      for (const [providerName, providerConfig] of Object.entries(repaired.models.providers)) {
        if (!providerConfig || typeof providerConfig !== 'object') continue
        for (const field of ['apiKey', 'baseUrl']) {
          const value = (providerConfig as any)[field]
          if (value !== undefined && typeof value !== 'string') {
            delete (providerConfig as any)[field]
            warnings.push(`🔧 Removed invalid models.providers.${providerName}.${field} (expected string, got ${typeof value})`)
          }
        }
        this.sanitizeProviderCompatFields(providerName, providerConfig as any, warnings)
      }
    }

    return { config: repaired, warnings }
  }

  /**
   * Repair models[].compat shapes the gateway zod schema would reject.
   *
   * Why this exists: the gateway schema (src/config/zod-schema.core.ts) is
   * .strict() and validates several compat keys as narrow enums or
   * specifically-typed primitives/arrays. A single bad value anywhere
   * under models.providers.*.models[].compat aborts gateway startup and
   * the supervisor restarts it every ~3 seconds forever — the Assistant
   * never comes up. `openclaw doctor --fix` doesn't repair this class of
   * corruption either (it only migrates known retired keys).
   *
   * For each model we:
   *   • coerce a bad maxTokensField to the API-correct default, or delete it
   *   • drop a bad thinkingFormat enum value
   *   • drop boolean-typed compat flags that aren't booleans
   *   • drop array-typed compat fields whose values aren't string-arrays
   *
   * We deliberately do NOT strip unknown keys: a newer gateway may add
   * fields the desktop bundle doesn't know yet. The forward-compat cost is
   * accepted: if a future gateway version legitimately introduces e.g.
   * `maxTokensField: "max_output_tokens"`, this code would coerce it back
   * — a known trade-off vs. crash-loop resilience today. The desktop app
   * ships paired with a specific gateway version so this is bounded.
   */
  private sanitizeProviderCompatFields(
    providerName: string,
    providerConfig: { api?: unknown; models?: unknown },
    warnings: string[],
  ): void {
    const models = providerConfig.models
    if (!Array.isArray(models)) return

    const validMaxTokensField = new Set(['max_completion_tokens', 'max_tokens'])
    // From src/config/types.models.ts MODEL_APIS — these use the newer
    // /v1/responses payload shape and expect "max_completion_tokens".
    const responsesApis = new Set([
      'openai-responses',
      'openai-codex-responses',
      'azure-openai-responses',
    ])
    const validThinkingFormat = new Set([
      'openai',
      'openrouter',
      'deepseek',
      'qwen',
      'qwen-chat-template',
      'zai',
    ])
    const api = typeof providerConfig.api === 'string' ? providerConfig.api : undefined
    const booleanCompatFields = [
      'supportsStore',
      'supportsPromptCacheKey',
      'supportsDeveloperRole',
      'supportsReasoningEffort',
      'supportsUsageInStreaming',
      'supportsTools',
      'supportsStrictMode',
      'requiresStringContent',
      'strictMessageKeys',
      'requiresToolResultName',
      'requiresAssistantAfterToolResult',
      'requiresThinkingAsText',
      'nativeWebSearchTool',
      'requiresMistralToolIds',
      'requiresOpenAiAnthropicToolPayload',
    ] as const
    // zod.array(z.string().min(1)) in the gateway schema — non-empty string elements only.
    const stringArrayCompatFields = [
      'visibleReasoningDetailTypes',
      'supportedReasoningEfforts',
      'unsupportedToolSchemaKeywords',
    ] as const

    const isCleanStringArray = (v: unknown): v is string[] =>
      Array.isArray(v) && v.every((e) => typeof e === 'string' && e.length > 0)

    models.forEach((model, idx) => {
      if (!model || typeof model !== 'object') return
      const compat = (model as any).compat
      if (compat === undefined || compat === null) return

      // Non-object compat (e.g. string, number, array) — drop it entirely.
      if (typeof compat !== 'object' || Array.isArray(compat)) {
        delete (model as any).compat
        warnings.push(
          `🔧 Removed invalid models.providers.${providerName}.models[${idx}].compat (expected object, got ${Array.isArray(compat) ? 'array' : typeof compat})`,
        )
        return
      }

      // maxTokensField: must be one of the two enum literals, else coerce or drop.
      const mtf = (compat as any).maxTokensField
      if (mtf !== undefined && !(typeof mtf === 'string' && validMaxTokensField.has(mtf))) {
        let replacement: 'max_tokens' | 'max_completion_tokens' | undefined
        if (api === 'openai-completions') {
          replacement = 'max_tokens'
        } else if (api && responsesApis.has(api)) {
          replacement = 'max_completion_tokens'
        }
        if (replacement) {
          (compat as any).maxTokensField = replacement
          warnings.push(
            `🔧 Coerced invalid models.providers.${providerName}.models[${idx}].compat.maxTokensField (was ${JSON.stringify(mtf)}) → "${replacement}"`,
          )
        } else {
          delete (compat as any).maxTokensField
          warnings.push(
            `🔧 Removed invalid models.providers.${providerName}.models[${idx}].compat.maxTokensField (was ${JSON.stringify(mtf)}; no safe default for api=${JSON.stringify(api)})`,
          )
        }
      }

      // thinkingFormat: strict enum; no safe defaulting (depends on upstream model
      // behavior we can't infer), so we delete on invalid.
      const tf = (compat as any).thinkingFormat
      if (tf !== undefined && !(typeof tf === 'string' && validThinkingFormat.has(tf))) {
        delete (compat as any).thinkingFormat
        warnings.push(
          `🔧 Removed invalid models.providers.${providerName}.models[${idx}].compat.thinkingFormat (was ${JSON.stringify(tf)})`,
        )
      }

      // Boolean compat flags: anything non-boolean would fail zod.boolean() — drop it.
      for (const field of booleanCompatFields) {
        const value = (compat as any)[field]
        if (value !== undefined && typeof value !== 'boolean') {
          delete (compat as any)[field]
          warnings.push(
            `🔧 Removed non-boolean models.providers.${providerName}.models[${idx}].compat.${field} (got ${typeof value})`,
          )
        }
      }

      // Array-of-non-empty-string compat fields.
      for (const field of stringArrayCompatFields) {
        const value = (compat as any)[field]
        if (value !== undefined && !isCleanStringArray(value)) {
          delete (compat as any)[field]
          warnings.push(
            `🔧 Removed invalid models.providers.${providerName}.models[${idx}].compat.${field} (expected non-empty string array)`,
          )
        }
      }

      // reasoningEffortMap: z.record(z.string().min(1), z.string().min(1))
      const remap = (compat as any).reasoningEffortMap
      if (remap !== undefined) {
        const valid =
          remap !== null &&
          typeof remap === 'object' &&
          !Array.isArray(remap) &&
          Object.entries(remap as Record<string, unknown>).every(
            ([k, v]) => k.length > 0 && typeof v === 'string' && v.length > 0,
          )
        if (!valid) {
          delete (compat as any).reasoningEffortMap
          warnings.push(
            `🔧 Removed invalid models.providers.${providerName}.models[${idx}].compat.reasoningEffortMap (expected Record<string, string> with non-empty values)`,
          )
        }
      }
    })
  }

  /**
   * Pure-corruption repair pass. Removes/repairs ONLY fields the gateway zod
   * schema rejects — no defaults, no augmentation. Safe to run before
   * spawning a gateway in any mode (bundled, system, OR external), because
   * leaving a known-rejected value in place guarantees a crash loop and
   * also breaks every `openclaw …` CLI invocation (cron, hooks, etc.)
   * because the CLI re-validates the same config at startup.
   *
   * Returns true if the on-disk config was modified.
   */
  async repairGatewayRejections(): Promise<boolean> {
    // Enumerate plugin sources OUTSIDE the lock — pure read, no shared state.
    const known = await this.getKnownPluginIds()

    // Read + repair + write all happen under the write lock so a concurrent
    // `config:save` (IPC handler) can't land between our read and write and
    // get silently clobbered by our stale snapshot.
    return this.withWriteLock(async () => {
      const config = await this.loadConfig()
      if (!config || typeof config !== 'object' || Object.keys(config).length === 0) {
        return false
      }
      const warnings: string[] = []
      // (1) Walk providers and sanitize compat fields + apiKey/baseUrl types in-place.
      if (config.models?.providers && typeof config.models.providers === 'object') {
        for (const [providerName, providerConfig] of Object.entries(config.models.providers)) {
          if (!providerConfig || typeof providerConfig !== 'object') continue
          for (const field of ['apiKey', 'baseUrl']) {
            const value = (providerConfig as any)[field]
            if (value !== undefined && typeof value !== 'string') {
              delete (providerConfig as any)[field]
              warnings.push(`🔧 Removed invalid models.providers.${providerName}.${field} (expected string, got ${typeof value})`)
            }
          }
          this.sanitizeProviderCompatFields(providerName, providerConfig as any, warnings)
        }
      }
      // (2) Dangling plugins.entries — entries that name a plugin not present on
      // disk in any install source. The gateway loader resolves each entry to
      // setup-entry.js / index.js paths; an entry with no on-disk plugin makes
      // every CLI invocation fail validation. We only delete entries we can
      // PROVE are dangling — if we can't enumerate any install source, we do
      // nothing rather than risk removing a legitimate entry on a fresh setup.
      if (known && config.plugins?.entries && typeof config.plugins.entries === 'object') {
        for (const id of Object.keys(config.plugins.entries)) {
          if (!known.has(id)) {
            delete config.plugins.entries[id]
            warnings.push(`🔧 Removed dangling plugins.entries.${id} (no plugin found in installs.json or ~/.openclaw/extensions/)`)
          }
        }
        if (Object.keys(config.plugins.entries).length === 0) {
          delete config.plugins.entries
        }
      }
      // (3) Migrate legacy `agents.list[].agentRuntime` to the canonical
      // per-model location. Upstream's AgentEntrySchema is strict zod
      // (>= 2026.6) and rejects the top-level field with "Unrecognized key:
      // agentRuntime" — which crashes the gateway at startup. The desktop
      // used to write that field directly; the writer has been moved to
      // `setAgentRuntime()` and this pass cleans up any stale data left by
      // older builds. Idempotent — no warnings on a clean config.
      const runtimeMigration = migrateLegacyAgentRuntime(config)
      if (runtimeMigration.changed) {
        warnings.push(...runtimeMigration.warnings.map((w) => `🔧 ${w}`))
      }
      if (warnings.length === 0) return false
      console.warn('[ConfigManager] repairGatewayRejections found issues, writing repairs:', warnings)
      warnings.forEach(w => this.logger?.addLog(`⚠️ Config: ${w}`))
      // Write directly INSIDE the held lock — `writeConfig` would deadlock
      // by trying to re-acquire it. We also deliberately skip
      // `validateAndRepairConfig` here: this method's contract is "remove
      // only what crashes the gateway, never inject defaults" so external
      // gateway setups don't get surprise mutations to agents.list etc.
      await this.backupConfig()
      await this.writeConfigAtomic(config)
      return true
    })
  }

  /**
   * Enumerate plugin ids known to be present on disk in any standard install
   * source. Returns null if NO source could be inspected (so callers can
   * conservatively skip the dangling-entry sweep on truly fresh setups
   * rather than nuke legitimate entries).
   *
   * Sources, in priority order:
   *   1. ~/.openclaw/plugins/installs.json — canonical registry written by the
   *      gateway on startup; lists every plugin it can load (bundled + user).
   *   2. ~/.openclaw/extensions/<id>/ — user-installed plugin directories.
   */
  private async getKnownPluginIds(): Promise<Set<string> | null> {
    const ids = new Set<string>()
    let foundAnySource = false
    const openclawDir = this.getOpenClawDir()

    const installsPath = path.join(openclawDir, 'plugins', 'installs.json')
    try {
      if (existsSync(installsPath)) {
        const reg = JSON.parse(await readFile(installsPath, 'utf8'))
        // Defence-in-depth: only trust this source if it's clearly a real,
        // populated registry. A half-written or migration-in-progress file
        // can show `plugins: []` (or no plugins key at all), and treating
        // that as authoritative would nuke every legitimate entry in
        // openclaw.json. We require both the array marker AND at least one
        // valid plugin id — gateway registries always carry the core
        // bundled plugins, so a non-empty list is the steady state.
        if (Array.isArray(reg?.plugins) && reg.plugins.length > 0) {
          let collectedAny = false
          for (const p of reg.plugins) {
            if (p && typeof p.pluginId === 'string') {
              ids.add(p.pluginId)
              collectedAny = true
            }
          }
          if (collectedAny) foundAnySource = true
        }
      }
    } catch {
      // Unreadable / malformed — fall through to filesystem check.
    }

    try {
      const extDir = path.join(openclawDir, 'extensions')
      if (existsSync(extDir)) {
        for (const name of readdirSync(extDir)) {
          try {
            if (statSync(path.join(extDir, name)).isDirectory()) {
              ids.add(name)
            }
          } catch {
            // Per-entry stat failures (broken symlinks etc.) — ignore.
          }
        }
        foundAnySource = true
      }
    } catch {
      // Directory unreadable — skip.
    }

    return foundAnySource ? ids : null
  }

  /**
   * Load config and validate/repair it. Use this before gateway startup
   * to catch corruption from external processes (CLI, gateway doctor, etc.).
   * Only writes back to disk if repairs were actually needed.
   */
  async loadAndValidateConfig(): Promise<any> {
    const config = await this.loadConfig()
    const { config: repaired, warnings } = this.validateAndRepairConfig(config)

    if (warnings.length > 0) {
      const hasRepairs = warnings.some(w => w.startsWith('🔧'))
      if (hasRepairs) {
        console.warn('[ConfigManager] Startup validation found issues, writing repairs:', warnings)
        warnings.forEach(w => this.logger?.addLog(`⚠️ Config: ${w}`))
        await this.writeConfig(repaired)
      }
    }

    return repaired
  }

  /**
   * Create a backup of the current config before making changes
   * Keeps the last 3 backups (openclaw.json.bak, .bak2, .bak3)
   */
  private async backupConfig(): Promise<void> {
    try {
      if (!existsSync(this.configPath)) {
        return // No config to backup
      }

      // Never rotate a corrupt primary into the backup chain — that would push
      // the last-good copy out toward .bak3 and eventually off the end,
      // destroying the only recovery source. Only back up a config that parses.
      try {
        JSON.parse(await readFile(this.configPath, 'utf8'))
      } catch {
        console.warn('[ConfigManager] Skipping backup — current config does not parse (preserving existing backups)')
        return
      }

      // Rotate backups: .bak2 -> .bak3, .bak -> .bak2
      const backup3 = `${this.configPath}.bak3`
      const backup2 = `${this.configPath}.bak2`
      const backup1 = `${this.configPath}.bak`

      if (existsSync(backup2)) {
        await copyFile(backup2, backup3)
      }
      if (existsSync(backup1)) {
        await copyFile(backup1, backup2)
      }

      // Create new backup
      await copyFile(this.configPath, backup1)
      console.log('[ConfigManager] Config backed up successfully')
    } catch (error) {
      console.error('[ConfigManager] Failed to backup config:', error)
      // Don't fail the whole operation if backup fails
    }
  }

  async writeConfig(config: any): Promise<void> {
    return this.withWriteLock(async () => {
      // Backup existing config before writing
      await this.backupConfig()

      // Validate and repair config before writing
      const { config: validatedConfig, warnings } = this.validateAndRepairConfig(config)

      // Log warnings if any issues were found and repaired
      if (warnings.length > 0) {
        console.warn('[ConfigManager] Config validation warnings:', warnings)
        warnings.forEach(warning => this.logger?.addLog(`⚠️ Config: ${warning}`))
      }

      await this.writeConfigAtomic(validatedConfig)
    })
  }

  async configExists(): Promise<boolean> {
    return existsSync(this.configPath)
  }

  async validateApiKey(provider: string, apiKey: string): Promise<boolean> {
    try {
      // Anthropic BYOK was removed 2026-06-15. If an upgraded install
      // still routes an 'anthropic' validate call through here (e.g. a
      // stale cached UI), reject regardless of key prefix so the user is
      // forced to repick a current provider.
      if (provider === 'anthropic') {
        return false
      }
      if (provider === 'openai' && !apiKey.startsWith('sk-')) {
        return false
      }
      return true
    } catch (error) {
      console.error('[ConfigManager] API key validation error:', error)
      return false
    }
  }

  async generateConfig(config: any, gatewayPort: number): Promise<void> {
    console.log('[ConfigManager] Generating config:', JSON.stringify(config, null, 2))

    try {
      const configDir = path.dirname(this.configPath)

      if (!existsSync(configDir)) {
        await mkdir(configDir, { recursive: true })
      }

      let existingConfig = {}
      try {
        if (existsSync(this.configPath)) {
          const configContent = await readFile(this.configPath, 'utf8')
          existingConfig = JSON.parse(configContent)
        }
      } catch (error) {
        console.log('[ConfigManager] Could not read existing config, creating new:', error)
      }

      const openclawConfig: any = {
        ...existingConfig,
        gateway: {
          ...(existingConfig as any).gateway,
          mode: 'local',
          port: gatewayPort || DEFAULT_GATEWAY_PORT,  // Use official OpenClaw default port
          bind: 'loopback',
          auth: {
            token: 'openclaw-easy-local-dev-token'
          }
        },
        agents: {
          defaults: {
            ...(existingConfig as any).agents?.defaults,
            model: {
              primary: config.model || 'ollama/qwen3:latest',  // Use Qwen3 which supports web_fetch
              fallbacks: config.fallbacks || []
            },
            timeoutSeconds: 600,  // Default agent timeout (10 minutes) per OpenClaw docs
            compaction: {
              mode: 'safeguard'
            },
            maxConcurrent: 4,
            subagents: {
              maxConcurrent: 8
            }
          },
          entries: this.ensureAgentsWithToolsEntries(existingConfig)
        },
        // Preserve existing plugin config. Do NOT hardcode plugins.entries here —
        // channel plugins are auto-discovered by the gateway from extensions/ (dev)
        // or the bundled plugins dir (prod). Adding them here causes "duplicate
        // plugin id" warnings. Use channel-manager.ensurePluginEnabled() when a
        // specific channel operation needs a plugin enabled on demand.
        plugins: {
          ...(existingConfig as any).plugins,
        },
        tools: {
          ...(existingConfig as any).tools,
          web: {
            search: {
              enabled: true
            },
            fetch: {
              enabled: true
            }
          }
        }
      }

      delete openclawConfig.agent
      delete openclawConfig.providers

      await this.writeConfig(openclawConfig)
      this.logger?.addLog('✅ Configuration saved successfully')

    } catch (error: any) {
      console.error('[ConfigManager] Config generation error:', error)
      throw error
    }
  }

  async createDefaultConfig(gatewayPort: number): Promise<void> {
    const defaultConfig = {
      provider: 'ollama',  // Use Ollama with Qwen3 for better web_fetch support
      apiKey: '',
      model: 'ollama/qwen3:latest'  // Use Qwen3 which we discovered works with web_fetch
    }

    await this.generateConfig(defaultConfig, gatewayPort)

    // Ensure tools are configured after creating default config
    await this.ensureToolsConfigured()
  }

  /**
   * Ensure all agents (existing and new) have comprehensive tools configuration.
   * This applies the full toolset to every agent, so users can create any agent
   * and have access to all available OpenClaw capabilities without API keys.
   *
   * IMPORTANT: Only include actual OpenClaw agent tools here. Do NOT include:
   * - Shell commands (those go in exec-approvals.json allowlist)
   * - Non-existent tools like 'glob', 'grep', 'read', 'write'
   *   (OpenClaw uses tool groups like 'group:fs' for file operations)
   * - Experimental/disabled tools like 'apply_patch' (requires explicit enablement)
   */
  private ensureAgentsWithTools(existingAgentsList: any[]): any[] {
    // Comprehensive tools list for all agents (based on OpenClaw official documentation)
    // Using tool groups for better maintainability and avoiding unknown tool errors
    const fullToolsSet = [
      'web_fetch',        // Extract readable content from URLs (no API key required)
      'group:runtime',    // exec, bash, process
      'group:fs',         // read, write, edit (NOT apply_patch - requires explicit config)
      'group:sessions',   // sessions_list, sessions_history, sessions_send, sessions_spawn, session_status
      'group:ui',         // browser, canvas
      'group:automation', // cron, gateway
      'group:messaging',  // message
      'nodes',            // Discover/target paired nodes, send notifications, capture media
      'image',            // Analyze images using configured image model
      'agents_list'       // List available agents for spawning sessions
      // Note: Excluding 'web_search' to avoid API key requirements
      // Note: Excluding 'apply_patch' (experimental, OpenAI-only, requires tools.exec.applyPatch.enabled)
      // Note: NOT including individual tools like 'exec', 'read', 'write' - use groups instead
      // Note: NEVER include shell commands like 'grep', 'glob' - those go in exec-approvals.json
    ]

    const updatedAgents = existingAgentsList.map(agent => ({
      ...agent,
      tools: {
        allow: fullToolsSet
      }
    }))

    // Ensure main agent exists
    const hasMainAgent = updatedAgents.some(agent => agent.id === 'main')
    if (!hasMainAgent) {
      updatedAgents.push({
        id: 'main',
        tools: {
          allow: fullToolsSet
        }
      })
    }

    return updatedAgents
  }

  /**
   * Same policy as ensureAgentsWithTools, emitted in the canonical keyed shape
   * (`agents.entries`) instead of the retired `agents.list` array. Reads the
   * existing roster through the shared accessor so an unmigrated config is
   * still picked up.
   */
  private ensureAgentsWithToolsEntries(existingConfig: unknown): Record<string, any> {
    const withTools = this.ensureAgentsWithTools(listAgents(existingConfig as any))
    const entries: Record<string, any> = {}
    for (const agent of withTools) {
      const { id, ...rest } = agent
      if (typeof id !== 'string') continue
      entries[id] = rest
    }
    return entries
  }

  async ensureGatewayConfigured(gatewayPort: number): Promise<void> {
    try {
      // Allow WebSocket connections from the Electron desktop app in both dev and prod.
      // Dev: renderer origin is http://localhost:5173; prod: file:// (or null).
      const requiredOrigins = ['http://localhost:5173', 'http://localhost:5174', 'file://', 'null']

      const changed = await this.mutateConfig((config) => {
        const gateway = ConfigManager.ensurePath(config, 'gateway')
        let hasChanges = false

        // Always: mode='local', bind='loopback' for the desktop app.
        if (gateway.mode !== 'local')      { gateway.mode = 'local';      hasChanges = true; console.log('[ConfigManager] Set gateway mode to local') }
        if (gateway.bind !== 'loopback')   { gateway.bind = 'loopback';   hasChanges = true }

        // Port: only set if missing. Existing port belongs to the LaunchAgent service.
        if (!gateway.port) {
          gateway.port = gatewayPort
          hasChanges = true
          console.log(`[ConfigManager] Set gateway port to ${gatewayPort}`)
        }

        // controlUi.allowedOrigins: ensure the required dev/prod origins are present.
        if (!gateway.controlUi) {
          gateway.controlUi = { allowedOrigins: requiredOrigins }
          hasChanges = true
        } else {
          const existing: string[] = gateway.controlUi.allowedOrigins || []
          const missing = requiredOrigins.filter(o => !existing.includes(o))
          if (missing.length > 0) {
            gateway.controlUi.allowedOrigins = [...existing, ...missing]
            hasChanges = true
          }
        }

        // auth: the gateway is loopback-bound and locally owned, so a fixed
        // local token is the only credential it needs.
        if (!gateway.auth || !gateway.auth.token) {
          gateway.auth = { mode: 'token', token: 'openclaw-easy-local-dev-token' }
          console.log('[ConfigManager] Set gateway auth to local dev token')
          this.logger?.addLog('🔐 Set gateway auth to local dev token')
          hasChanges = true
        }
        return hasChanges
      })

      if (changed) this.logger?.addLog('🔧 Gateway configuration updated')
    } catch (error: any) {
      console.error(`[ConfigManager] Failed to ensure gateway configured: ${error.message}`)
      this.logger?.addLog(`⚠️ Failed to configure gateway automatically: ${error.message}`)
    }
  }

  async ensureToolsConfigured(): Promise<void> {
    try {
      // Dev-mode duplicate-plugin cleanup. Done BEFORE the lock because
      // it touches `~/.openclaw/extensions/<id>/` directories on disk
      // independently of openclaw.json — no need to hold the config
      // write-lock while doing filesystem I/O.
      const bundledPlugins = this.collectBundledPluginIds()
      this.removeDuplicateUserExtensionDirs(bundledPlugins)

      const changed = await this.mutateConfig((config) => {
        let hasChanges = false

        // Web search + fetch tools.
        const tools = ConfigManager.ensurePath(config, 'tools')
        const web = ConfigManager.ensurePath(tools, 'web')
        if (web.search?.enabled !== true) { web.search = { enabled: true }; hasChanges = true }
        if (web.fetch?.enabled !== true)  { web.fetch  = { enabled: true }; hasChanges = true }

        // commands.bash: required for image handling, code execution, etc.
        const commands = ConfigManager.ensurePath(config, 'commands')
        if (commands.bash !== true) {
          commands.bash = true
          hasChanges = true
          this.logger?.addLog('🔧 Enabled commands.bash for shell command support')
        }

        // tools.elevated: sandbox/image support.
        if (!tools.elevated || tools.elevated.enabled !== true) {
          tools.elevated = { enabled: true }
          hasChanges = true
          this.logger?.addLog('🔧 Enabled tools.elevated for sandbox/image support')
        }

        // plugins.entries is the CLI's persisted enable/disable state
        // (upstream `plugins enable/disable` writes entries.<id>.enabled) —
        // never wipe it. The "duplicate plugin id detected" warning comes
        // from two discovered MANIFESTS, which the installs cleanup below
        // and removeDuplicateUserExtensionDirs() handle; dangling entries
        // are pruned surgically by repairGatewayRejections().

        // Dev mode: drop config entries for plugins also present as bundled
        // sources, so the gateway loader doesn't see two manifests.
        if (bundledPlugins.size > 0 && config.plugins?.installs) {
          for (const id of Object.keys(config.plugins.installs)) {
            if (bundledPlugins.has(id)) {
              delete config.plugins.installs[id]
              hasChanges = true
            }
          }
          if (Object.keys(config.plugins.installs).length === 0) {
            delete config.plugins.installs
          }
        }

        // Agent default timeout — prevents infinite loops on stuck calls.
        const defaults = ConfigManager.ensurePath(config, 'agents.defaults')
        if (!defaults.timeoutSeconds) {
          defaults.timeoutSeconds = 600
          hasChanges = true
          this.logger?.addLog('🔧 Set timeoutSeconds=600 (default per OpenClaw docs)')
        }

        return hasChanges
      })

      if (changed) {
        this.logger?.addLog('🔧 Automatically configured tools and agent limits')
        console.log('[ConfigManager] Tools configuration updated automatically')
      } else {
        this.logger?.addLog('✅ Tools configuration is up to date')
      }
    } catch (error: any) {
      console.error(`[ConfigManager] Failed to ensure tools configured: ${error.message}`)
      this.logger?.addLog(`⚠️ Failed to configure tools automatically: ${error.message}`)
    }
  }

  /** Returns the set of plugin ids present as bundled sources (dev only). */
  private collectBundledPluginIds(): Set<string> {
    const ids = new Set<string>()
    try {
      const extensionsDir = path.join(getVendoredCoreRoot(), 'extensions')
      if (!existsSync(extensionsDir)) return ids
      for (const name of readdirSync(extensionsDir)) {
        try {
          if (statSync(path.join(extensionsDir, name)).isDirectory()) ids.add(name)
        } catch { /* ignore individual entry errors */ }
      }
    } catch {
      // Not in dev mode or extensions dir missing — empty set is fine.
    }
    return ids
  }

  /**
   * Dev-only: drop user-installed plugin directories that duplicate
   * bundled sources. The gateway would otherwise discover both
   * `~/.openclaw/extensions/<id>` AND the source `extensions/<id>`,
   * producing "duplicate plugin id" warnings.
   */
  private removeDuplicateUserExtensionDirs(bundledPlugins: Set<string>): void {
    if (bundledPlugins.size === 0) return
    try {
      const userExtDir = path.join(this.getOpenClawDir(), 'extensions')
      if (!existsSync(userExtDir)) return
      for (const name of readdirSync(userExtDir)) {
        if (!bundledPlugins.has(name)) continue
        const dupDir = path.join(userExtDir, name)
        try {
          rmSync(dupDir, { recursive: true, force: true })
          console.log(`[ConfigManager] Removed duplicate plugin dir: ${dupDir}`)
        } catch (e: any) {
          console.warn(`[ConfigManager] Failed to remove ${dupDir}: ${e.message}`)
        }
      }
    } catch {
      // Directory unreadable — skip silently.
    }
  }

  /**
   * Clean up invalid tool names from agent configurations.
   * Removes tool names that don't exist in OpenClaw's tool registry:
   * - 'glob', 'grep' (shell commands, not agent tools)
   * - Individual tool names that should be in groups (read, write, edit, exec, etc.)
   *
   * Replaces them with proper tool groups.
   */
  async cleanupInvalidToolNames(): Promise<void> {
    try {
      if (!existsSync(this.configPath)) return

      // Shell aliases that don't exist as agent tools — they belong in
      // exec-approvals.json, not in agents.list[].tools.allow.
      const invalidTools = new Set(['glob', 'grep'])
      // Individual tools that should be expressed via groups instead.
      const fsTools = new Set(['read', 'write', 'edit'])
      const runtimeTools = new Set(['exec', 'bash', 'process'])

      // Apply a single "remove from allow / merge into group" pass and
      // report whether anything changed. Mutates `tools` in place.
      const replaceGroup = (allow: string[], individuals: Set<string>, groupName: string): { changed: boolean; allow: string[] } => {
        if (!allow.some(t => individuals.has(t))) return { changed: false, allow }
        const filtered = allow.filter(t => !individuals.has(t))
        if (!filtered.includes(groupName)) filtered.push(groupName)
        return { changed: filtered.length !== allow.length || filtered !== allow, allow: filtered }
      }

      const changed = await this.mutateConfig((config) => {
        const roster = listAgents(config)
        if (roster.length === 0) return false
        let hasChanges = false

        for (const { id: agentId } of roster) {
          const agent = ensureAgent(config, agentId)
          const allow = agent?.tools?.allow
          if (!Array.isArray(allow)) continue
          const originalLength = allow.length

          // 1. Drop invalid tools (glob, grep, apply_patch).
          let next = allow.filter((t: string) => !invalidTools.has(t) && t !== 'apply_patch')
          if (allow.includes('apply_patch')) {
            console.log(`[ConfigManager] Removed 'apply_patch' from agent ${agent.id} (experimental, OpenAI-only)`)
          }

          // 2. Collapse individual fs / runtime tools into their groups.
          const fsRes = replaceGroup(next, fsTools, 'group:fs')
          next = fsRes.allow
          const runtimeRes = replaceGroup(next, runtimeTools, 'group:runtime')
          next = runtimeRes.allow

          if (next.length !== originalLength || next.some((t, i) => t !== allow[i])) {
            agent.tools.allow = next
            hasChanges = true
            console.log(`[ConfigManager] Cleaned up invalid tools for agent ${agent.id}`)
          }
        }
        return hasChanges
      })

      if (changed) {
        this.logger?.addLog('🔧 Cleaned up invalid tool names from configuration')
        console.log('[ConfigManager] Invalid tool names cleaned up successfully')
      }
    } catch (error: any) {
      console.error(`[ConfigManager] Failed to cleanup invalid tool names: ${error.message}`)
      this.logger?.addLog(`⚠️ Failed to cleanup tool configuration: ${error.message}`)
    }
  }

  async updateGatewayPort(port: number): Promise<void> {
    try {
      await this.mutateConfig((config) => {
        const gateway = ConfigManager.ensurePath(config, 'gateway')
        gateway.port = port
        gateway.mode = 'local'
        return true
      })
      console.log(`[ConfigManager] Updated config with gateway port ${port}`)
    } catch (error: any) {
      console.error(`[ConfigManager] Failed to update gateway port: ${error.message}`)
    }
  }

  /**
   * Apply the user's provider/model/key selection from AppProviderConfig to openclaw.json.
   * This is the single source-of-truth write path called from config:save IPC.
   * Preserves gateway, tools, agents.list, and plugins — only touches provider and model fields.
   */
  async applyProviderToOpenClaw(appConfig: AppProviderConfig): Promise<void> {
    await this.mutateConfig((config) => {
      ConfigManager.ensurePath(config, 'models.providers')
      ConfigManager.ensurePath(config, 'agents.defaults.model')

      switch (appConfig.aiProvider) {
        case 'byok': {
          const byok = appConfig.byok
          if (!byok) break
          const def = BYOK_PROVIDER_DEFS[byok.provider]
          if (!def) break  // unknown provider id — defensive guard, types prevent normally

          const apiKey = byok.apiKeys?.[byok.provider] || config.models.providers[byok.provider]?.apiKey || ''
          const validatedModel = this.validateByokModel(byok.provider, byok.model, def)

          if (validatedModel !== byok.model && def.persistFallback) {
            // Persist the corrected model back to app-config so it
            // survives restarts. Fire-and-forget; failure is not fatal.
            byok.model = validatedModel
            this.saveAppConfig(appConfig).catch(e =>
              console.warn('[ConfigManager] Failed to persist corrected model:', e),
            )
          }

          const providerEntry: any = {
            baseUrl: def.baseUrl,
            api: def.api,
            apiKey,
            models: BYOK_PROVIDER_MODELS[byok.provider].models,
          }
          if (def.buildHeaders) providerEntry.headers = def.buildHeaders(apiKey)
          config.models.providers[byok.provider] = providerEntry
          config.agents.defaults.model.primary = `${BYOK_PROVIDER_MODELS[byok.provider].agentPrefix}/${validatedModel}`
          break
        }

        case 'local': {
          const model = appConfig.local?.model || 'llama3.2:3b'
          config.models.providers.ollama = {
            baseUrl: 'http://127.0.0.1:11434/v1',
            apiKey: 'ollama-local',
            api: 'openai-responses',
            models: [
              {
                id: model,
                name: model.replace(/[-_:]/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
                reasoning: false,
                input: ['text'],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 32768,
                maxTokens: 4096,
              },
            ],
          }
          config.agents.defaults.model.primary = `ollama/${model}`
          break
        }
      }

      // Sync per-agent model overrides whose provider prefix changed.
      // Without this, agents.list[].model.primary keeps the OLD
      // provider/model and the gateway uses that stale value instead of
      // agents.defaults.model.primary. We only touch agents on a
      // DIFFERENT provider — within the same provider we preserve
      // intentional per-agent choices (e.g. gemini-2.5-flash vs -pro).
      //
      // This silently destroys explicit per-agent pins when the user
      // switches global provider; we surface a warning to the UI log so
      // the operator can see what happened and re-pin if desired.
      const newPrimary: string = config.agents.defaults.model.primary
      const newProvider = newPrimary?.split('/')[0]
      if (newProvider && !isRosterEmpty(config)) {
        for (const { id: agentId } of listAgents(config)) {
          // Live entry — the assignment below must land in agents.entries.
          const agent = ensureAgent(config, agentId)
          const agentPrimary: string = agent.model?.primary || ''
          const agentProvider = agentPrimary.split('/')[0]
          if (agentPrimary && agentProvider !== newProvider) {
            console.warn(`[ConfigManager] Provider switch overwriting agent "${agentId}" model: ${agentPrimary} → ${newPrimary}`)
            this.logger?.addLog(
              `⚠️ Agent "${agentId}" was pinned to ${agentPrimary}; provider switch reassigned it to ${newPrimary}. Re-pin via Agent Manager if needed.`,
            )
            agent.model.primary = newPrimary
          }
        }
      }

      // Privacy: zero out apiKey fields on every INACTIVE provider in
      // openclaw.json. Switching e.g. anthropic→google would otherwise
      // leave the user's anthropic key sitting in cleartext on disk.
      // The desktop app-config retains per-provider keys under
      // byok.apiKeys.<provider> so the user can switch back without
      // re-entering; this clear only affects the openclaw.json
      // projection the gateway reads at startup.
      if (newProvider && config.models?.providers) {
        for (const provName of Object.keys(config.models.providers)) {
          if (provName === newProvider) continue
          const entry = config.models.providers[provName]
          if (entry && typeof entry === 'object' && 'apiKey' in entry) {
            delete entry.apiKey
          }
        }
      }

      return true
    })

    console.log(`[ConfigManager] Applied provider=${appConfig.aiProvider} to openclaw.json`)

    // Keep the SQLite auth store in sync with whichever provider is now
    // active — its profiles outrank the config apiKey written above.
    if (appConfig.aiProvider === 'byok' && appConfig.byok) {
      const { provider, apiKeys } = appConfig.byok
      const apiKey = apiKeys?.[provider as keyof typeof apiKeys] || ''
      if (apiKey) {
        await this._syncAuthProfiles({ kind: 'byok-api-key', provider, apiKey })
      }
    }
  }

  /**
   * Re-project the user's selected AI provider (from app-config) into
   * openclaw.json at startup so the gateway's provider catalog can never
   * drift from what the UI shows. Idempotent: on a healthy config it
   * re-writes the same shape; on a drifted one it self-heals.
   *
   * Why this exists: app-config (aiProvider/model) and openclaw.json
   * (providers + agents.*.model) are two files. A provider switch only
   * rewrote openclaw.json on the config:save IPC, so a config that was
   * last written for a different provider — e.g. BYOK-Google selected in
   * the UI while openclaw.json still held the BYOK-OpenAI catalog —
   * survived across restarts, and the orphan-repair then "fixed" the model
   * to match the stale catalog. Re-projecting on every owned-spawn launch
   * closes that gap without a manual doctor step. No-op when no provider
   * is set.
   */
  async reconcileActiveProvider(): Promise<void> {
    const appConfig = await this.getAppConfig()
    if (!appConfig?.aiProvider) return
    // Only re-project on genuine drift. A healthy config must stay byte-for-
    // byte untouched — applyProviderToOpenClaw also runs a privacy-clear that
    // strips apiKeys from inactive providers (incl. user-added custom ones),
    // so running it unconditionally on every boot would churn backups and
    // wipe keys the app doesn't manage.
    const config = await this.loadConfig()
    if (!this.isProviderProjectionDrifted(appConfig, config)) return
    try {
      console.log(`[ConfigManager] Provider projection drifted for "${appConfig.aiProvider}"; re-projecting`)
      this.logger?.addLog(`🔧 openclaw.json provider catalog was out of sync with "${appConfig.aiProvider}"; re-syncing`)
      await this.applyProviderToOpenClaw(appConfig)
    } catch (err: any) {
      // Never block gateway boot on a reconcile failure; the existing
      // openclaw.json (already validated/repaired) is still serviceable.
      console.warn('[ConfigManager] reconcileActiveProvider failed:', err?.message ?? err)
      this.logger?.addLog(`⚠️ Provider reconcile skipped: ${err?.message ?? err}`)
    }
  }

  /**
   * True when openclaw.json's provider catalog no longer matches the
   * provider the user selected in app-config. Detected by the routing
   * baseUrl, so a stale catalog shows up as the wrong baseUrl for the
   * active mode.
   */
  private isProviderProjectionDrifted(appConfig: any, config: any): boolean {
    const providers = config?.models?.providers ?? {}
    switch (appConfig.aiProvider) {
      case 'byok': {
        const id = appConfig.byok?.provider
        const def = id ? BYOK_PROVIDER_DEFS[id as ByokProviderId] : undefined
        if (!def) return false
        return providers[id]?.baseUrl !== def.baseUrl
      }
      case 'local':
        return !providers.ollama
      default:
        return false
    }
  }

  /**
   * Validate a BYOK model id and return either the original (if it passes)
   * or the catalog's default fallback id. Aggregator providers (venice,
   * openrouter) opt out and pass through the user's pick unchanged.
   */
  private validateByokModel(provider: ByokProviderId, model: string, def: ByokProviderDef): string {
    if (!def.validateModel) return model
    if (def.modelIdPrefix && !model.startsWith(def.modelIdPrefix)) {
      return this.reportFallback(provider, model)
    }
    const allowed = new Set<string>([
      ...BYOK_PROVIDER_MODELS[provider].models.map(m => m.id),
      ...(def.extraAllowedModelIds ?? []),
    ])
    if (!allowed.has(model)) return this.reportFallback(provider, model)
    return model
  }

  private reportFallback(provider: ByokProviderId, badModel: string): string {
    const fallback = defaultByokModelId(provider)
    console.warn(`[ConfigManager] Invalid ${provider} model "${badModel}" - using ${fallback} as fallback`)
    this.logger?.addLog(`⚠️ Invalid ${provider} model "${badModel}" detected - switching to ${fallback}`)
    return fallback
  }

  /**
   * Sync a provider credential into the gateway's canonical auth store —
   * the per-agent SQLite database (agents/main/agent/openclaw-agent.sqlite).
   *
   * Profiles there OUTRANK `models.providers.<id>.apiKey` in openclaw.json,
   * so a stale `<provider>:default` profile (e.g. an old OpenAI key after
   * switching to Google) silently hijacks auth until overwritten
   * here. The write goes through the OpenClaw CLI (`models auth paste-token`
   * / `paste-api-key`) with the secret piped via stdin — the only supported
   * external write path; the CLI owns the store lock, updates the config's
   * `auth.profiles` declaration, and pings a running gateway to refresh.
   *
   * The pre-2026.7 JSON files (~/.openclaw/auth-profiles.json et al.) were
   * one-time-migrated into SQLite and are never re-read; writing them was a
   * silent no-op, which is exactly how the stale-key 401 bug survived.
   */
  private async _syncAuthProfiles(request: AuthProfileSyncRequest): Promise<void> {
    const command = buildAuthProfileSyncCommand(request)
    if (!command) return
    if (!this.commandExecutor) {
      // Credentials that never reach the SQLite store fail later as
      // misleading provider 401s — surface the wiring bug immediately.
      throw new Error('[ConfigManager] Cannot sync auth profile: no command executor wired')
    }
    // Serialize with our own openclaw.json writes — the CLI also does a
    // read-modify-write of openclaw.json (auth.profiles declaration).
    await this.withWriteLock(async () => {
      await this.commandExecutor!.executeCommand(command.args, 30000, { stdinData: command.stdinData })
    })
    const label = `${request.provider} (api key)`
    console.log(`[ConfigManager] Synced ${label} credential into the agent auth store`)
  }

  /**
   * Sync per-agent model overrides with the global default provider.
   * Safe to call on every app startup — no-ops when all agents already match.
   *
   * Fixes: when user switches AI provider (e.g. OpenAI → Google), only
   * agents.defaults.model.primary was updated. Per-agent overrides in agents.list[]
   * kept the old provider/model, causing the gateway to use stale values.
   */
  async syncAgentModelsWithDefault(): Promise<void> {
    try {
      const changed = await this.mutateConfig((config) => {
        const defaultPrimary: string = config?.agents?.defaults?.model?.primary || ''
        if (!defaultPrimary) return false

        // Roster access goes through agent-roster: reading `agents.list`
        // directly made this repair a silent no-op once upstream renamed the
        // roster to the keyed `agents.entries`, so a provider switch left every
        // agent pinned to the old provider's model. listAgents reads both
        // shapes; ensureAgent hands back the live entry so the write lands.
        const defaultProvider = defaultPrimary.split('/')[0]
        let hasChanges = false

        for (const agent of listAgents(config)) {
          const agentPrimary: string = agent.model?.primary || ''
          if (!agentPrimary) continue
          const agentProvider = agentPrimary.split('/')[0]
          // If the agent's provider doesn't match the global default, it's stale.
          if (agentProvider !== defaultProvider) {
            console.log(`[ConfigManager] Fixing stale agent "${agent.id}" model: ${agentPrimary} → ${defaultPrimary}`)
            ensureAgent(config, agent.id).model.primary = defaultPrimary
            hasChanges = true
          }
        }
        return hasChanges
      })
      if (changed) console.log('[ConfigManager] Synced stale per-agent models with global default')
    } catch (error) {
      console.error('[ConfigManager] Failed to sync agent models:', error)
    }
  }

}
