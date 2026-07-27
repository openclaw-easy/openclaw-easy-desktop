import * as path from 'path'
import * as os from 'os'
import { spawn } from 'child_process'
import { access, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { OpenClawCommandExecutor } from './openclaw-command-executor'
import { ConfigManager } from './config-manager'
import { CLAWHUB_BASE_URL } from '../../shared/constants'

export interface RegistrySkill {
  slug: string
  displayName: string
  summary: string
  downloads: number
  stars: number
  version: string
  url: string
}

// Slug grammar matches the backend (skills-download.ts). Notably excludes
// `.` and `..`, which the previous regex `[a-zA-Z0-9_.-]+` accepted — that
// would have let a malicious `slug = '..'` escape the `~/.openclaw/skills/`
// install root via path-join and write zip contents anywhere under
// `~/.openclaw/`. Lowercase-only matches ClawHub's actual convention.
const SLUG_REGEX = /^[a-z0-9][a-z0-9_-]*$/

/**
 * Verify a resolved path stays inside an expected root directory. Used as
 * a defence-in-depth check on top of `SLUG_REGEX`: even if a malformed slug
 * ever slipped through, this catches the attempted escape.
 */
function isPathInside(child: string, root: string): boolean {
  const rChild = path.resolve(child)
  const rRoot = path.resolve(root)
  // Trailing separator prevents '/foo/skillsX' from passing as a child of '/foo/skills'.
  return rChild === rRoot || rChild.startsWith(rRoot + path.sep)
}

/**
 * SkillsManager - Manages OpenClaw skills
 */
export class SkillsManager {
  private executor: OpenClawCommandExecutor
  private configManager: ConfigManager

  constructor(executor: OpenClawCommandExecutor, configManager: ConfigManager) {
    this.executor = executor
    this.configManager = configManager
  }

  /**
   * `~/.openclaw/skills/` — single source for the install root path. Uses
   * `process.env.HOME || .USERPROFILE` rather than `app.getPath('home')`
   * so the existing skills-manager tests (which mock the env var) keep
   * working without an electron mock change.
   */
  private _skillsDir(): string {
    const home = process.env.HOME || process.env.USERPROFILE || ''
    return path.join(home, '.openclaw', 'skills')
  }

  /**
   * Resolve a user-supplied skill name to its on-disk directory under
   * `~/.openclaw/skills/`. Two lookup strategies:
   *   1. Direct: directory whose name equals `skillName`.
   *   2. By name: scan dirs, match the SKILL.md frontmatter `name:` field.
   * Returns null if nothing matches. Caller is responsible for the
   * SLUG_REGEX check on the input.
   */
  async findSkillDirByName(skillName: string): Promise<string | null> {
    const skillsDir = this._skillsDir()

    // Strategy 1: direct directory match.
    const directDir = path.join(skillsDir, skillName)
    try {
      await access(directDir)
      return directDir
    } catch { /* fall through */ }

    // Strategy 2: scan SKILL.md `name:` fields.
    let entries: import('fs').Dirent[]
    try {
      entries = await readdir(skillsDir, { withFileTypes: true })
    } catch { return null }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        const md = await readFile(path.join(skillsDir, entry.name, 'SKILL.md'), 'utf8')
        const m = md.match(/^name:\s*(.+)$/m)
        if (m && m[1].trim() === skillName) return path.join(skillsDir, entry.name)
      } catch { /* skip unreadable entry */ }
    }
    return null
  }

  async listSkills(): Promise<{ success: boolean; skills?: any[]; error?: string }> {
    try {
      console.log('[SkillsManager] Getting skills list...')
      const result = await this.executor.executeCommand(['skills', 'list', '--json'], 30000) // 30 second timeout for skills

      if (result) {
        const data = JSON.parse(result)
        // Extract the skills array from the response
        const skills = data.skills || []
        return {
          success: true,
          skills
        }
      }

      return {
        success: false,
        error: 'No skills data received'
      }
    } catch (error: any) {
      console.error('[SkillsManager] Error listing skills:', error)
      return {
        success: false,
        error: error.message || 'Failed to list skills'
      }
    }
  }

  /**
   * Run `openclaw skills check --json` against the active agent and return
   * the structured eligibility report. Powers UI surfaces like a
   * "N skills need configuration" badge — the upstream report bucketizes
   * results into eligible / blocked / missing-requirements lists so we
   * don't have to re-derive that from `skills list`. Re-added 2026-06-15
   * after the audit: the previous comment "no callers anywhere" was an
   * artefact of an older Skills UI that scraped the list shape directly.
   */
  async checkSkills(agentId?: string): Promise<{
    success: boolean
    report?: {
      agentId?: string
      workspaceDir?: string
      managedSkillsDir?: string
      summary?: Record<string, number>
      eligible?: any[]
      modelVisible?: any[]
      commandVisible?: any[]
      disabled?: any[]
      blocked?: any[]
      agentFiltered?: any[]
      notInjected?: any[]
      missingRequirements?: any[]
    }
    error?: string
  }> {
    try {
      const args = ['skills', 'check', '--json']
      if (agentId) args.push('--agent', agentId)
      const result = await this.executor.executeCommand(args, 30000)
      if (!result) return { success: false, error: 'No skills check data received' }
      return { success: true, report: JSON.parse(result) }
    } catch (error: any) {
      console.error('[SkillsManager] Error running skills check:', error)
      return { success: false, error: error.message || 'Failed to run skills check' }
    }
  }

  async getSkillInfo(
    skillName: string,
    agentId?: string,
  ): Promise<{ success: boolean; info?: any; error?: string }> {
    try {
      console.log(`[SkillsManager] Getting info for skill: ${skillName}`)
      // Audit 2026-06-15: bumped timeout 10s → 30s for consistency with
      // listSkills and to cover cold-cache cases where the gateway
      // re-scans bundled plugins. Pass `--agent` when supplied so
      // agent-scoped skills resolve correctly upstream.
      const args = ['skills', 'info', skillName, '--json']
      if (agentId) args.push('--agent', agentId)
      const result = await this.executor.executeCommand(args, 30000)

      if (result) {
        const info = JSON.parse(result)
        return {
          success: true,
          info
        }
      }

      return {
        success: false,
        error: 'No skill info received'
      }
    } catch (error: any) {
      console.error(`[SkillsManager] Error getting skill info for ${skillName}:`, error)
      return {
        success: false,
        error: error.message || 'Failed to get skill info'
      }
    }
  }

  /** Credential-like leaf names that require user-provided values and cannot be auto-resolved. */
  private static readonly CREDENTIAL_LEAVES = new Set([
    'token', 'apikey', 'apiKey', 'api_key', 'apisecret', 'apiSecret', 'api_secret',
    'bottoken', 'botToken', 'bot_token', 'password', 'secret', 'webhook',
    'webhookurl', 'webhookUrl', 'webhook_url', 'accesstoken', 'accessToken',
    'access_token', 'refreshtoken', 'refreshToken', 'refresh_token',
    'clientid', 'clientId', 'client_id', 'clientsecret', 'clientSecret', 'client_secret',
    'key', 'apiKeyId', 'privateKey', 'signingKey',
  ])

  /**
   * Check whether a dotted config key is a credential that needs a real user-provided value.
   */
  private _isCredentialKey(dottedKey: string): boolean {
    const lastPart = dottedKey.split('.').pop() || ''
    return SkillsManager.CREDENTIAL_LEAVES.has(lastPart)
  }

  /**
   * Determine the appropriate value to set for a config key.
   * Returns null for credential keys that cannot be auto-resolved.
   * Keys like "channels.X" or "plugins.entries.X" need an object { enabled: true },
   * while leaf keys like "plugins.entries.X.enabled" need a plain true.
   */
  private _configValueForKey(dottedKey: string): any {
    // Credential keys cannot be auto-resolved — they need real user input
    if (this._isCredentialKey(dottedKey)) return null

    const parts = dottedKey.split('.')
    const lastPart = parts[parts.length - 1]

    // If the key already ends with "enabled", set a boolean
    if (lastPart === 'enabled') return true

    // "channels.X" → needs to be an object for zod validation
    if (parts[0] === 'channels' && parts.length === 2) return { enabled: true }

    // "plugins.entries.X" or "skills.entries.X" → needs to be an object
    if ((parts[0] === 'plugins' || parts[0] === 'skills') && parts[1] === 'entries' && parts.length === 3) {
      return { enabled: true }
    }

    // Default: set to true
    return true
  }

  /**
   * Get a value at a dotted config path (e.g. "plugins.entries.voice-call.enabled").
   * Returns undefined if any segment is missing.
   */
  private _getNestedConfigValue(obj: any, dottedKey: string): any {
    const parts = dottedKey.split('.')
    let current = obj
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return undefined
      current = current[part]
    }
    return current
  }

  /**
   * Set a dotted config key (e.g. "plugins.entries.voice-call.enabled") to a value
   * in the OpenClaw config, creating intermediate objects as needed.
   */
  private _setNestedConfigValue(obj: any, dottedKey: string, value: any): void {
    const parts = dottedKey.split('.')
    let current = obj
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
        current[parts[i]] = {}
      }
      current = current[parts[i]]
    }
    current[parts[parts.length - 1]] = value
  }

  async installSkillRequirements(skillName: string): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      console.log(`[SkillsManager] Getting requirements for skill: ${skillName}`)
      const skillInfo = await this.getSkillInfo(skillName)

      if (!skillInfo.success || !skillInfo.info) {
        return {
          success: false,
          error: 'Could not get skill information'
        }
      }

      const missing = skillInfo.info.missing || {}
      const lines: string[] = []
      const autoResolved: string[] = []

      // Auto-resolve missing config keys by setting them in openclaw.json.
      // Credential keys (tokens, passwords, API keys) are skipped — they need real user input.
      const manualConfigKeys: string[] = []
      if (missing.config?.length) {
        try {
          // Single atomic read-modify-write under the config write-lock.
          // Previously this did `loadConfig → mutate → writeConfig` with the
          // read outside the lock; a concurrent `config:save` IPC could
          // land between read and write and get silently clobbered.
          await this.configManager.mutateConfig((config) => {
            let anyResolved = false
            for (const key of missing.config as string[]) {
              // Skip if key already has a value (avoid overwriting existing config).
              const existing = this._getNestedConfigValue(config, key)
              if (existing !== undefined && existing !== null) continue

              const value = this._configValueForKey(key)
              if (value === null) {
                // Credential key — cannot auto-resolve, user must configure manually.
                manualConfigKeys.push(key)
                continue
              }
              this._setNestedConfigValue(config, key, value)
              autoResolved.push(key)
              anyResolved = true
            }
            return anyResolved
          })
          if (autoResolved.length > 0) {
            console.log(`[SkillsManager] Auto-resolved config keys for ${skillName}: ${autoResolved.join(', ')}`)
          }
        } catch (err: any) {
          console.error(`[SkillsManager] Failed to auto-resolve config keys:`, err)
          lines.push(`Required config keys (could not auto-set):\n${(missing.config as string[]).map((k: string) => `  ${k}`).join('\n')}`)
        }
      }

      if (manualConfigKeys.length > 0) {
        lines.push(`Required credentials (set via CLI or config):\n${manualConfigKeys.map(k => `  openclaw config set ${k} <value>`).join('\n')}`)
      }
      if (missing.bins?.length) {
        lines.push(`Required binaries: ${missing.bins.join(', ')}`)
        const brewSuggestions = (missing.bins as string[]).map(bin => `  brew install ${bin}`)
        lines.push(`Install via Homebrew:\n${brewSuggestions.join('\n')}`)
      }
      if (missing.env?.length) {
        lines.push(`Required environment variables:\n${(missing.env as string[]).map(v => `  ${v}`).join('\n')}`)
      }

      if (autoResolved.length > 0) {
        const resolvedMsg = `Auto-configured: ${autoResolved.join(', ')}`
        if (lines.length > 0) {
          // Some requirements still need manual action
          lines.unshift(resolvedMsg + '\n\nRemaining requirements:')
        } else {
          // All requirements resolved automatically
          return { success: true, message: `${resolvedMsg}\n\nRestart the assistant to apply changes.` }
        }
      }

      const message = lines.length > 0
        ? lines.join('\n\n')
        : 'No missing requirements detected. If the skill still shows as missing, check its documentation.'

      return { success: true, message }
    } catch (error: any) {
      console.error(`[SkillsManager] Error getting requirements for ${skillName}:`, error)
      return {
        success: false,
        error: error.message || 'Failed to get skill requirements'
      }
    }
  }

  // Cached top-1000 skills from ClawHub (10-minute TTL)
  private topSkillsCache: { skills: RegistrySkill[]; fetchedAt: number } | null = null
  private readonly TOP_SKILLS_CACHE_TTL_MS = 10 * 60 * 1000

  // ClawHub server-side search results are short-lived. We cache them per
  // query for 2 minutes so rapid keystrokes ("a" → "ap" → "app") don't
  // hammer the API, but stay fresh enough that recent uploads surface
  // in search within a few minutes of publication.
  private searchCache = new Map<string, { skills: RegistrySkill[]; fetchedAt: number }>()
  private readonly SEARCH_CACHE_TTL_MS = 2 * 60 * 1000
  /** Max distinct queries kept in memory before LRU eviction. */
  private readonly SEARCH_CACHE_MAX_ENTRIES = 64

  /**
   * Search skills against the ClawHub registry.
   *
   * Empty query → uses the cached top-1000-by-downloads browse list (fast,
   * already populated from page-1 hydration; matches the catalog view).
   *
   * Non-empty query → hits ClawHub's dedicated `/api/v1/search` endpoint
   * which returns server-ranked results with a relevance `score`. This
   * gives correct rankings for skills outside the top 1000 by downloads
   * and respects ClawHub's own relevance heuristics — neither was
   * possible with the previous client-side substring filter against the
   * cached top-1000 list.
   *
   * Fallbacks: on search-endpoint failure we degrade to filtering the
   * cached browse list (best-effort), then to the S3 mirror, then to
   * stale cache.
   */
  async searchRegistry(query: string): Promise<{
    success: boolean
    skills?: RegistrySkill[]
    total?: number
    error?: string
  }> {
    const trimmed = (query || '').trim()

    // Empty query → browse mode (existing behavior).
    if (!trimmed) {
      try {
        await this._ensureTopSkillsCache()
      } catch (error: any) {
        if (!this.topSkillsCache) {
          return { success: false, error: error.message || 'Failed to load registry' }
        }
        console.log('[SkillsManager] Serving stale browse cache after refresh failure')
      }
      const skills = this.topSkillsCache?.skills ?? []
      return { success: true, skills, total: skills.length }
    }

    // Non-empty query → dedicated search endpoint, cached per query.
    const cacheKey = trimmed.toLowerCase()
    const cached = this.searchCache.get(cacheKey)
    if (cached && Date.now() - cached.fetchedAt < this.SEARCH_CACHE_TTL_MS) {
      return { success: true, skills: cached.skills, total: cached.skills.length }
    }
    try {
      const skills = await this._fetchSearchFromClawHub(trimmed)
      // LRU bookkeeping: drop the oldest entry if we'd exceed the cap.
      if (this.searchCache.size >= this.SEARCH_CACHE_MAX_ENTRIES) {
        const oldest = this.searchCache.keys().next().value
        if (oldest) this.searchCache.delete(oldest)
      }
      this.searchCache.set(cacheKey, { skills, fetchedAt: Date.now() })
      return { success: true, skills, total: skills.length }
    } catch (searchErr: any) {
      console.warn(`[SkillsManager] /api/v1/search failed (${searchErr.message}); falling back to client-side filter`)
      // Best-effort fallback: filter the cached browse list. Misses
      // anything outside the top-1000-by-downloads but better than 0
      // results when the search endpoint is rate-limited.
      try {
        await this._ensureTopSkillsCache()
      } catch (browseErr: any) {
        return { success: false, error: `Search failed: ${searchErr.message}; browse fallback: ${browseErr.message}` }
      }
      const q = trimmed.toLowerCase()
      const skills = (this.topSkillsCache?.skills ?? []).filter(
        (s) =>
          s.slug.toLowerCase().includes(q) ||
          s.displayName.toLowerCase().includes(q) ||
          s.summary.toLowerCase().includes(q),
      )
      return { success: true, skills, total: skills.length }
    }
  }

  /**
   * Hit ClawHub's dedicated search endpoint and map the response to our
   * RegistrySkill shape. The search-endpoint response shape differs from
   * the browse-endpoint shape (no `stats` block, no `latestVersion`
   * nested object), so the mapping is done here rather than inline at
   * the cache layer.
   */
  private async _fetchSearchFromClawHub(query: string): Promise<RegistrySkill[]> {
    const url = new URL(`${CLAWHUB_BASE_URL}/api/v1/search`)
    url.searchParams.set('q', query)
    url.searchParams.set('limit', '100')
    url.searchParams.set('nonSuspiciousOnly', 'true')

    const resp = await this._fetchWithTimeout(url.toString(), 15_000)
    if (resp.status === 429) throw new Error('ClawHub search rate limited')
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      throw new Error(`ClawHub search returned HTTP ${resp.status}: ${body.slice(0, 120)}`)
    }
    const data = (await resp.json()) as {
      results: Array<{
        score?: number
        slug: string
        displayName?: string
        summary?: string
        version?: string
        updatedAt?: number
      }>
    }
    return (data.results || []).map((r) => ({
      slug: r.slug,
      displayName: r.displayName || r.slug,
      summary: r.summary || '',
      // Server-search response does NOT include download/star stats —
      // those are browse-only. Leave zero; the UI uses the relevance
      // ordering anyway when displaying search results.
      downloads: 0,
      stars: 0,
      version: r.version || '',
      url: `${CLAWHUB_BASE_URL}/skills/${r.slug}`,
    }))
  }

  // Optional skills-cache mirror. This build ships no hosted backend, so the
  // fallback is opt-in via env and disabled (empty) by default.
  private static readonly S3_FALLBACK_URL = process.env.OPENCLAW_SKILLS_CACHE_URL || ''

  /**
   * Fetch top skills and populate cache.
   * Strategy: ClawHub API → S3 fallback → stale cache → error.
   */
  private async _ensureTopSkillsCache(): Promise<void> {
    const now = Date.now()
    if (this.topSkillsCache && (now - this.topSkillsCache.fetchedAt) < this.TOP_SKILLS_CACHE_TTL_MS) return

    // Try ClawHub first
    try {
      await this._fetchFromClawHub()
      return
    } catch (err: any) {
      console.warn(`[SkillsManager] ClawHub fetch failed: ${err.message}`)
    }

    // Fall back to S3 cache (our Lambda-populated cache)
    try {
      console.log('[SkillsManager] Trying S3 fallback...')
      await this._fetchFromS3Fallback()
      return
    } catch (err: any) {
      console.warn(`[SkillsManager] S3 fallback failed: ${err.message}`)
    }

    // If we have a stale cache, extend its TTL and keep using it
    if (this.topSkillsCache) {
      console.log('[SkillsManager] Both sources failed — extending stale cache TTL')
      this.topSkillsCache.fetchedAt = now
      return
    }

    throw new Error('All skill sources unavailable (ClawHub + S3 fallback)')
  }

  /** Fetch with timeout — throws on timeout or fetch error. */
  private async _fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetch(url, { signal: controller.signal })
    } catch (err: any) {
      if (err.name === 'AbortError') throw new Error(`Fetch timed out after ${timeoutMs}ms: ${url}`)
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  /** Fetch skills directly from ClawHub API (pages of 100, up to 1000). */
  private async _fetchFromClawHub(): Promise<void> {
    const allItems: Array<{
      slug: string
      displayName: string
      summary: string
      stats: { downloads: number; stars: number }
      latestVersion?: { version: string }
    }> = []
    let cursor: string | null = null
    const PAGE_SIZE = 100
    const MAX_SKILLS = 1000
    const PAGE_TIMEOUT_MS = 15_000

    while (allItems.length < MAX_SKILLS) {
      const url = new URL(`${CLAWHUB_BASE_URL}/api/v1/skills`)
      url.searchParams.set('sort', 'downloads')
      url.searchParams.set('limit', String(PAGE_SIZE))
      if (cursor) url.searchParams.set('cursor', cursor)

      console.log(`[SkillsManager] Fetching ClawHub API page: ${url}`)
      const resp = await this._fetchWithTimeout(url.toString(), PAGE_TIMEOUT_MS)

      if (resp.status === 429) {
        throw new Error('ClawHub API returned HTTP 429')
      }
      if (!resp.ok) {
        const body = await resp.text().catch(() => '')
        if (body.toLowerCase().includes('rate limit')) {
          throw new Error('Rate limit exceeded')
        }
        throw new Error(`ClawHub API returned HTTP ${resp.status}`)
      }

      const data = await resp.json() as {
        items: typeof allItems
        nextCursor: string | null
      }

      allItems.push(...(data.items || []))
      cursor = data.nextCursor
      if (!cursor) break
    }

    if (allItems.length === 0) {
      throw new Error('ClawHub returned 0 skills')
    }

    const skills: RegistrySkill[] = allItems.slice(0, MAX_SKILLS).map(item => ({
      slug: item.slug,
      displayName: item.displayName || item.slug,
      summary: item.summary || '',
      downloads: item.stats?.downloads ?? 0,
      stars: item.stats?.stars ?? 0,
      version: item.latestVersion?.version || '',
      url: `${CLAWHUB_BASE_URL}/skills/${item.slug}`,
    }))

    console.log(`[SkillsManager] Cached ${skills.length} top skills from ClawHub`)
    this.topSkillsCache = { skills, fetchedAt: Date.now() }
  }

  /** Fetch pre-cached skills from our S3-backed API with retry. */
  private async _fetchFromS3Fallback(): Promise<void> {
    const TIMEOUT_MS = 10_000
    const MAX_RETRIES = 2

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        console.log(`[SkillsManager] S3 fallback attempt ${attempt + 1}/${MAX_RETRIES}: ${SkillsManager.S3_FALLBACK_URL}`)
        const resp = await this._fetchWithTimeout(SkillsManager.S3_FALLBACK_URL, TIMEOUT_MS)
        if (!resp.ok) {
          throw new Error(`S3 fallback returned HTTP ${resp.status}`)
        }

        const data = await resp.json() as { skills: RegistrySkill[]; total: number; updatedAt: string }
        const skills = (data.skills || []).slice(0, 1000)

        if (skills.length === 0) {
          throw new Error('S3 fallback returned 0 skills')
        }

        console.log(`[SkillsManager] Cached ${skills.length} skills from S3 fallback (updated: ${data.updatedAt})`)
        this.topSkillsCache = { skills, fetchedAt: Date.now() }
        return
      } catch (err: any) {
        if (attempt < MAX_RETRIES - 1) {
          console.warn(`[SkillsManager] S3 fallback attempt ${attempt + 1} failed: ${err.message}, retrying...`)
          continue
        }
        throw err
      }
    }
  }

  /**
   * Fallback install: download skill zip from our proxy (Lambda IP, separate rate limit),
   * then extract to ~/.openclaw/skills/<slug>/.
   */
  private async _installViaProxy(slug: string): Promise<{ success: boolean; output?: string; error?: string }> {
    // Defence in depth: the slug is already validated by SLUG_REGEX at
    // every public entry point, but if a future caller forgets, fail
    // closed here too. encodeURIComponent in the URL only protects against
    // injection into the request line — it does NOT protect against
    // path-traversal on the local filesystem.
    if (!SLUG_REGEX.test(slug)) {
      return { success: false, error: 'Invalid skill slug' }
    }

    // Optional download proxy — opt-in via env, no hosted default here.
    const proxyBase = process.env.OPENCLAW_SKILLS_PROXY_URL || ''
    const proxyUrl = `${proxyBase}/${encodeURIComponent(slug)}`
    console.log(`[SkillsManager] Proxy install: ${proxyUrl}`)

    const resp = await this._fetchWithTimeout(proxyUrl, 30_000)
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      throw new Error(`Proxy returned HTTP ${resp.status}: ${body.slice(0, 200)}`)
    }

    const data = await resp.json() as { slug: string; version: string; zipBase64: string }
    if (!data.zipBase64) throw new Error('Proxy response missing zipBase64')

    const zipBuffer = Buffer.from(data.zipBase64, 'base64')
    if (zipBuffer.length < 10) throw new Error('Proxy returned empty or corrupt zip')

    const home = process.env.HOME || process.env.USERPROFILE || ''
    const skillsRoot = this._skillsDir()
    const skillDir = path.join(skillsRoot, slug)

    // Last-line defence: even with SLUG_REGEX in place, refuse to extract
    // if the resolved target somehow escapes the skills root.
    if (!isPathInside(skillDir, skillsRoot)) {
      throw new Error(`Refusing to install: target path escapes skills root (slug="${slug}")`)
    }

    await mkdir(skillDir, { recursive: true })

    // Use a private mkdtemp directory so two concurrent installs of the
    // same slug can't corrupt each other's staging zip (previously the
    // tmp path was deterministic: `~/.openclaw/_tmp_<slug>.zip`).
    const tmpDir = await mkdtemp(path.join(home, '.openclaw', '_tmp_skill_'))
    const tmpZip = path.join(tmpDir, 'skill.zip')
    await writeFile(tmpZip, zipBuffer)

    try {
      await this._extractZip(tmpZip, skillDir)
    } finally {
      // Clean up the whole mkdtemp directory (best-effort).
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }

    // Write _meta.json (matches clawhub CLI format)
    const meta = {
      ownerId: '',
      slug,
      version: data.version,
      publishedAt: Date.now(),
    }
    await writeFile(path.join(skillDir, '_meta.json'), JSON.stringify(meta, null, 2))

    // Write .clawhub/origin.json
    const clawhubDir = path.join(skillDir, '.clawhub')
    await mkdir(clawhubDir, { recursive: true })
    const origin = {
      version: 1,
      registry: CLAWHUB_BASE_URL,
      slug,
      installedVersion: data.version,
      installedAt: Date.now(),
    }
    await writeFile(path.join(clawhubDir, 'origin.json'), JSON.stringify(origin, null, 2))

    console.log(`[SkillsManager] Proxy install complete: ${slug}@${data.version} → ${skillDir}`)
    return { success: true, output: `Installed ${slug}@${data.version} via proxy fallback` }
  }

  /** Extract a zip file to a target directory (cross-platform). */
  private async _extractZip(zipPath: string, targetDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const isWindows = process.platform === 'win32'
      const child = isWindows
        ? spawn('powershell', ['-NoProfile', '-Command',
            `Expand-Archive -Path '${zipPath}' -DestinationPath '${targetDir}' -Force`],
            { windowsHide: true, cwd: targetDir })
        : spawn('unzip', ['-o', zipPath, '-d', targetDir],
            { windowsHide: true, cwd: targetDir })

      const timer = setTimeout(() => {
        child.kill()
        reject(new Error('Zip extraction timed out after 30s'))
      }, 30_000)

      child.on('error', (err) => { clearTimeout(timer); reject(err) })
      child.on('close', code => {
        clearTimeout(timer)
        if (code === 0) resolve()
        else reject(new Error(`Zip extraction exited with code ${code}`))
      })
    })
  }

  /**
   * Install a skill from the registry.
   *
   * Primary path: `openclaw skills install <slug> --force` via the shared
   *   command executor (the same path used by `doctor`, `plugins list`,
   *   etc.). Executor resolves to a system openclaw if installed (Node
   *   runtime, has node:sqlite, matches the documented contract), or
   *   falls back to bundled bun + openclaw.mjs in production. Both honor
   *   the documented `openclaw skills install` CLI surface.
   *
   *   Was previously `bun x clawhub@latest install <slug>` — the
   *   separately-shipped clawhub CLI. That path still works but spawns a
   *   bun + npm download on first use (cold install was ~5s vs ~200ms now)
   *   and diverges from the documented command name.
   *
   * Fallback: backend S3 proxy (`_installViaProxy`). Catches rate-limit
   * cases, network failures, and "Skill not found" stays definitive
   * (no point trying the proxy for a slug ClawHub itself rejected).
   *
   * Slug validation matches the backend (see SLUG_REGEX). Accepts both
   * bare slugs ("gifgrep") and owner-prefixed ("steipete/gifgrep").
   */
  async installFromRegistry(slug: string): Promise<{
    success: boolean
    output?: string
    error?: string
  }> {
    const slugParts = slug.split('/')
    if (slugParts.length > 2 || slugParts.some((p) => !SLUG_REGEX.test(p))) {
      return { success: false, error: 'Invalid skill slug' }
    }

    // Sentinel detection — output substrings that should short-circuit
    // (success-on-output OR definitive-failure-don't-retry). Lifted to a
    // helper because we need to inspect both stdout (when executor
    // resolves) and the error message (when executor throws on non-zero
    // exit) for the same patterns.
    const sniffSentinels = (raw: string): {
      hitRateLimit: boolean
      isSkillNotFound: boolean
    } => {
      const s = raw.toLowerCase()
      return {
        hitRateLimit: s.includes('rate limit exceeded'),
        isSkillNotFound: s.includes('skill not found'),
      }
    }

    let cliOutput = ''
    try {
      // 90s timeout matches the previous bun-spawn budget — installs can
      // include git clones for some skills.
      const result = await this.executor.executeCommand(
        ['skills', 'install', slug, '--force'],
        90_000,
      )
      cliOutput = (result ?? '').trim()
      const { hitRateLimit, isSkillNotFound } = sniffSentinels(cliOutput)

      // "Skill not found" is definitive — don't retry via proxy (the
      // proxy hits the same registry and would also fail).
      if (isSkillNotFound) {
        return {
          success: false,
          output: cliOutput,
          error: `Skill "${slug}" not found in the ClawHub registry.`,
        }
      }
      // Clean exit-0, real output, no rate-limit warning → done.
      if (cliOutput && !hitRateLimit) {
        return { success: true, output: cliOutput }
      }
      // Empty output OR rate-limit warning OR ambiguous → try proxy.
      console.log(
        `[SkillsManager] openclaw skills install ${slug} did not complete cleanly; trying proxy fallback`,
      )
    } catch (cliErr: any) {
      const errMsg = cliErr?.message || ''
      const { isSkillNotFound } = sniffSentinels(errMsg)
      if (isSkillNotFound) {
        // CLI exited non-zero AND signalled "skill not found" — definitive.
        return {
          success: false,
          error: `Skill "${slug}" not found in the ClawHub registry.`,
        }
      }
      console.log(
        `[SkillsManager] openclaw skills install ${slug} threw (${errMsg}); trying proxy fallback`,
      )
      cliOutput = errMsg
    }

    try {
      return await this._installViaProxy(slug)
    } catch (proxyErr: any) {
      return {
        success: false,
        output: cliOutput,
        error: `Install failed + proxy fallback failed: ${proxyErr.message}`,
      }
    }
  }

  /**
   * Parse SKILL.md frontmatter (YAML between --- markers, or line-based key: value).
   * Returns a flat Record<string, string> of all frontmatter fields.
   */
  private _parseFrontmatter(md: string): Record<string, string> {
    const result: Record<string, string> = {}
    // Try YAML-style frontmatter (between --- markers)
    const yamlMatch = md.match(/^---\s*\n([\s\S]*?)\n---/)
    const block = yamlMatch ? yamlMatch[1] : md

    for (const line of block.split('\n')) {
      const m = line.match(/^([a-zA-Z_-]+)\s*:\s*(.+)$/)
      if (m) {
        let value = m[2].trim()
        // Strip surrounding quotes (YAML strings may be quoted)
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        result[m[1].trim()] = value
      }
    }
    return result
  }

  /**
   * Extract OpenClaw metadata from the frontmatter `metadata` field.
   * The metadata field contains a JSON5-like block with an `openclaw` key.
   */
  private _parseOpenClawMetadata(frontmatter: Record<string, string>): {
    emoji?: string
    requires?: { bins?: string[]; anyBins?: string[]; env?: string[]; config?: string[] }
    homepage?: string
  } {
    const raw = frontmatter.metadata
    if (!raw) return {}
    try {
      // The metadata value is JSON (or JSON5-ish); parse it. Some
      // skills nest under an `openclaw` key; older ones inline at the
      // top level.
      const parsed = JSON.parse(raw)
      const oc = parsed?.openclaw || parsed
      return {
        emoji: oc.emoji,
        requires: oc.requires,
        homepage: oc.homepage || frontmatter.homepage,
      }
    } catch {
      return { homepage: frontmatter.homepage }
    }
  }

  /**
   * Read version from _meta.json (written by clawhub install or proxy install).
   */
  private async _readSkillVersion(skillDir: string): Promise<string> {
    try {
      const raw = await readFile(path.join(skillDir, '_meta.json'), 'utf8')
      const meta = JSON.parse(raw)
      return meta.version || ''
    } catch {
      return ''
    }
  }

  /**
   * List skills installed in ~/.openclaw/skills/ directly from the filesystem.
   * Parses full SKILL.md frontmatter for rich metadata (name, description, emoji,
   * homepage, requirements) so manually placed skills get the same treatment as
   * registry-installed ones.
   */
  async listWorkspaceSkills(): Promise<{
    success: boolean
    skills?: Array<{
      dir: string
      name: string
      description: string
      emoji: string
      homepage: string
      version: string
      enabled: boolean
      requires?: { bins?: string[]; anyBins?: string[]; env?: string[]; config?: string[] }
    }>
    error?: string
  }> {
    try {
      const skillsDir = this._skillsDir()

      let entries: import('fs').Dirent[]
      try {
        entries = await readdir(skillsDir, { withFileTypes: true })
      } catch (err: any) {
        if (err.code === 'ENOENT') return { success: true, skills: [] }
        throw err
      }

      const dirs = entries.filter(e => e.isDirectory()).map(e => e.name)

      // Read config once so we can check per-skill enabled state and satisfied requirements
      let fullConfig: any = {}
      let skillEntries: Record<string, { enabled?: boolean }> = {}
      try {
        fullConfig = await this.configManager.loadConfig()
        skillEntries = fullConfig?.skills?.entries || {}
      } catch {
        // Config unreadable — assume all enabled
      }

      const skills = await Promise.all(dirs.map(async dir => {
        const dirPath = path.join(skillsDir, dir)
        let name = dir
        let description = ''
        let emoji = ''
        let homepage = ''
        let requires: { bins?: string[]; anyBins?: string[]; env?: string[]; config?: string[] } | undefined

        try {
          const md = await readFile(path.join(dirPath, 'SKILL.md'), 'utf8')
          const frontmatter = this._parseFrontmatter(md)
          const ocMeta = this._parseOpenClawMetadata(frontmatter)

          name = frontmatter.name || dir
          description = frontmatter.description || ''
          emoji = ocMeta.emoji || ''
          homepage = ocMeta.homepage || frontmatter.homepage || ''
          requires = ocMeta.requires
        } catch {
          // No SKILL.md or unreadable — keep defaults
        }

        // Filter out config requirements that are already satisfied or are credential keys
        // (credential keys need user input and shouldn't block the Install button forever)
        if (requires?.config?.length) {
          const unsatisfied = requires.config.filter(key => {
            // Already set in config — satisfied
            if (this._getNestedConfigValue(fullConfig, key)) return false
            // Credential key — can't be auto-resolved, don't count as "missing"
            if (this._isCredentialKey(key)) return false
            return true
          })
          requires = { ...requires, config: unsatisfied }
        }

        const version = await this._readSkillVersion(dirPath)

        // Check config for enabled state (by both name and dir slug)
        const configEntry = skillEntries[name] || skillEntries[dir]
        const enabled = configEntry?.enabled !== false

        return { dir, name, description, emoji, homepage, version, enabled, requires }
      }))

      return { success: true, skills }
    } catch (error: any) {
      console.error('[SkillsManager] Error listing workspace skills:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * Remove a locally installed skill by deleting its folder from ~/.openclaw/skills/.
   * Looks up the directory by name first, then falls back to scanning SKILL.md name: fields
   * (the directory slug often differs from the skill name).
   */
  /**
   * Resolve a skill name to a folder path the user can open. Tries the
   * three lookup strategies the `skills:open-folder` IPC handler used to
   * implement inline:
   *   1. `~/.openclaw/skills/<name>/`
   *   2. `~/.openclaw/skills/<dir>/` where SKILL.md `name:` matches
   *   3. `<OPENCLAW_BUNDLED_PLUGINS_DIR>/skills/<name>/` (bundled skill)
   *
   * Returns the absolute path on hit, or null if no source has it. The
   * IPC handler is the only caller (it then `shell.openPath`s the result).
   */
  async resolveSkillFolderPath(skillName: string): Promise<string | null> {
    if (!SLUG_REGEX.test(skillName)) return null

    // Workspace lookups (1 + 2) share with findSkillDirByName.
    const workspaceDir = await this.findSkillDirByName(skillName)
    if (workspaceDir) return workspaceDir

    // 3. Bundled extensions dir — a different root that lives outside
    // ~/.openclaw/. Validate the resolved target stays under it as defence
    // in depth (SLUG_REGEX already rejects traversal-ish names).
    const extDir = process.env.OPENCLAW_BUNDLED_PLUGINS_DIR
    if (extDir) {
      const extPath = path.join(extDir, 'skills', skillName)
      if (!isPathInside(extPath, extDir)) return null
      try {
        await access(extPath)
        return extPath
      } catch { /* not bundled */ }
    }
    return null
  }

  async removeSkill(skillName: string): Promise<{ success: boolean; error?: string }> {
    if (!skillName || !SLUG_REGEX.test(skillName)) {
      return { success: false, error: 'Invalid skill name' }
    }
    try {
      const dir = await this.findSkillDirByName(skillName)
      if (!dir) {
        return {
          success: false,
          error: `"${skillName}" is a bundled skill and cannot be removed here. Only workspace-installed skills (via clawhub install) can be deleted.`,
        }
      }
      console.log(`[SkillsManager] Removing skill folder: ${dir}`)
      await rm(dir, { recursive: true })
      return { success: true }
    } catch (error: any) {
      console.error(`[SkillsManager] Error removing skill ${skillName}:`, error)
      return { success: false, error: error.message || 'Failed to remove skill' }
    }
  }

  /**
   * Clear cached skillsSnapshot from all session entries so the gateway
   * rebuilds the snapshot (picking up newly installed/removed skills)
   * on the next message.
   *
   * KNOWN LIMITATION: sessions.json is co-owned by the gateway. A true
   * concurrent-writer fix requires an IPC ("ask the gateway to drop
   * snapshots") rather than the desktop mutating gateway-owned state;
   * that's an upstream OpenClaw change and out of scope here. The
   * tmp-file + rename below is a partial mitigation — it prevents a
   * half-written sessions.json from ever being observed if the desktop
   * is killed mid-write, but it does NOT eliminate the lost-update race
   * with concurrent gateway writes. Acceptable because the gateway
   * rebuilds the snapshot lazily anyway; the worst case from a lost
   * write is "snapshot not cleared this round, will clear next session boot."
   */
  async clearSkillsSnapshots(): Promise<void> {
    try {
      const agentsDir = path.join(os.homedir(), '.openclaw', 'agents')
      let agentDirs: string[]
      try {
        agentDirs = (await readdir(agentsDir, { withFileTypes: true }))
          .filter(e => e.isDirectory())
          .map(e => e.name)
      } catch {
        return // no agents dir yet
      }

      for (const agentId of agentDirs) {
        const storePath = path.join(agentsDir, agentId, 'sessions', 'sessions.json')
        try {
          const raw = await readFile(storePath, 'utf8')
          const store = JSON.parse(raw)
          let changed = false
          for (const key of Object.keys(store)) {
            if (store[key]?.skillsSnapshot) {
              delete store[key].skillsSnapshot
              changed = true
            }
          }
          if (changed) {
            // Atomic-replace pattern: write to a sibling tmp file then
            // rename onto the canonical path. rename(2) is atomic within
            // a filesystem on POSIX, and node's fs.rename does the same
            // on Windows for files on the same volume. Readers always
            // see either the old or new file, never a partial one.
            const tmpPath = `${storePath}.tmp-${process.pid}-${Date.now()}`
            await writeFile(tmpPath, JSON.stringify(store, null, 2), 'utf8')
            await rename(tmpPath, storePath)
            console.log(`[SkillsManager] Cleared skillsSnapshot from ${storePath}`)
          }
        } catch {
          // session store doesn't exist or isn't readable — skip
        }
      }
    } catch (error) {
      console.warn('[SkillsManager] Failed to clear skills snapshots:', error)
    }
  }

  /**
   * Run `openclaw skills update --all` to refresh every ClawHub-installed
   * skill in place. Streams the CLI output back so the Skills page can
   * surface "skill X updated to version Y" lines without us re-parsing.
   * 5-minute timeout — updates can be sizeable on machines with many
   * skills, and the upstream command does its own per-skill timing.
   */
  async updateAllSkills(): Promise<{
    success: boolean
    output?: string
    error?: string
  }> {
    try {
      console.log('[SkillsManager] Running skills update --all')
      const result = await this.executor.executeCommand(['skills', 'update', '--all'], 300_000)
      if (result === null || result === undefined) {
        return { success: false, error: 'No output from skills update' }
      }
      return { success: true, output: result }
    } catch (error: any) {
      console.error('[SkillsManager] Error updating skills:', error)
      return { success: false, error: error.message || 'Failed to update skills' }
    }
  }

  /**
   * Enable or disable a skill by writing to ~/.openclaw/openclaw.json.
   * Setting enabled=false prevents the skill from loading even if bundled.
   */
  async setSkillEnabled(skillName: string, enabled: boolean): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`[SkillsManager] Setting skill "${skillName}" enabled=${enabled}`)
      // Single atomic RMW under the config write-lock. Previously this
      // did load+mutate+write outside the lock — a concurrent
      // `config:save` IPC between read and write would clobber this update.
      await this.configManager.mutateConfig((config) => {
        if (!config.skills) config.skills = {}
        if (!config.skills.entries) config.skills.entries = {}
        if (!config.skills.entries[skillName]) config.skills.entries[skillName] = {}
        if (config.skills.entries[skillName].enabled === enabled) return false  // no-op
        config.skills.entries[skillName].enabled = enabled
        return true
      })
      console.log(`[SkillsManager] Skill "${skillName}" enabled=${enabled} saved to config`)
      return { success: true }
    } catch (error: any) {
      console.error(`[SkillsManager] Error setting skill enabled for ${skillName}:`, error)
      return { success: false, error: error.message || 'Failed to update skill' }
    }
  }
}
