import * as path from 'path'
import * as os from 'os'
import { spawn } from 'child_process'
import { OpenClawCommandExecutor } from './openclaw-command-executor'
import { ConfigManager } from './config-manager'

export interface RegistrySkill {
  slug: string
  displayName: string
  summary: string
  downloads: number
  stars: number
  version: string
  url: string
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

  async checkSkills(): Promise<{ success: boolean; status?: any; error?: string }> {
    try {
      console.log('[SkillsManager] Checking skills status...')
      const result = await this.executor.executeCommand(['skills', 'check', '--json'], 30000) // 30 second timeout for skills

      if (result) {
        const status = JSON.parse(result)
        return {
          success: true,
          status
        }
      }

      return {
        success: false,
        error: 'No skills status data received'
      }
    } catch (error: any) {
      console.error('[SkillsManager] Error checking skills:', error)
      return {
        success: false,
        error: error.message || 'Failed to check skills'
      }
    }
  }

  async getSkillInfo(skillName: string): Promise<{ success: boolean; info?: any; error?: string }> {
    try {
      console.log(`[SkillsManager] Getting info for skill: ${skillName}`)
      const result = await this.executor.executeCommand(['skills', 'info', skillName, '--json'])

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

      // Auto-resolve missing config keys by setting them in openclaw.json
      // Credential keys (tokens, passwords, API keys) are skipped — they need real user input.
      const manualConfigKeys: string[] = []
      if (missing.config?.length) {
        try {
          const config = await this.configManager.loadConfig()
          for (const key of missing.config as string[]) {
            // Skip if key already has a value (avoid overwriting existing config)
            const existing = this._getNestedConfigValue(config, key)
            if (existing !== undefined && existing !== null) continue

            const value = this._configValueForKey(key)
            if (value === null) {
              // Credential key — cannot auto-resolve, user must configure manually
              manualConfigKeys.push(key)
              continue
            }
            this._setNestedConfigValue(config, key, value)
            autoResolved.push(key)
          }
          if (autoResolved.length > 0) {
            await this.configManager.writeConfig(config)
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

  // Cached top-600 skills from ClawHub (10-minute TTL)
  private topSkillsCache: { skills: RegistrySkill[]; fetchedAt: number } | null = null
  private readonly TOP_SKILLS_CACHE_TTL_MS = 10 * 60 * 1000

  /**
   * Search skills from the ClawHub API.
   * Fetches the top 600 skills by downloads (cached 10 min), then filters client-side by query.
   * If both ClawHub and S3 fallback fail, serves stale cache (if available).
   */
  async searchRegistry(query: string): Promise<{
    success: boolean
    skills?: RegistrySkill[]
    total?: number
    error?: string
  }> {
    try {
      await this._ensureTopSkillsCache()
    } catch (error: any) {
      console.error('[SkillsManager] All skill sources failed:', error)
      // If we have a stale cache, serve it rather than failing
      if (this.topSkillsCache) {
        console.log('[SkillsManager] Serving stale cache despite refresh failure')
      } else {
        return { success: false, error: error.message || 'Failed to search registry' }
      }
    }

    if (!this.topSkillsCache) {
      return { success: false, error: 'Failed to load skills from ClawHub' }
    }

    let skills = this.topSkillsCache.skills
    if (query && query.trim()) {
      const q = query.trim().toLowerCase()
      skills = skills.filter(s =>
        s.slug.toLowerCase().includes(q) ||
        s.displayName.toLowerCase().includes(q) ||
        s.summary.toLowerCase().includes(q)
      )
    }

    return { success: true, skills, total: skills.length }
  }

  // Skills cache fallback URL — uses the ClawHub cache proxy.
  // Can be overridden via OPENCLAW_SKILLS_CACHE_URL env var.
  private static readonly S3_FALLBACK_URL =
    process.env.OPENCLAW_SKILLS_CACHE_URL || ''

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

  /** Fetch skills directly from ClawHub API (pages of 100, up to 600). */
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
    const MAX_SKILLS = 600
    const PAGE_TIMEOUT_MS = 15_000

    while (allItems.length < MAX_SKILLS) {
      const url = new URL('https://clawhub.ai/api/v1/skills')
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
      url: `https://clawhub.ai/skills/${item.slug}`,
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
        const skills = (data.skills || []).slice(0, 600)

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
    // Skills download proxy — can be overridden via OPENCLAW_SKILLS_PROXY_URL env var.
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

    const { mkdir, writeFile, rm } = await import('fs/promises')

    const home = process.env.HOME || process.env.USERPROFILE || ''
    const skillDir = path.join(home, '.openclaw', 'skills', slug)
    await mkdir(skillDir, { recursive: true })

    const tmpZip = path.join(home, '.openclaw', `_tmp_${slug}.zip`)
    await writeFile(tmpZip, zipBuffer)

    try {
      await this._extractZip(tmpZip, skillDir)
    } finally {
      await rm(tmpZip, { force: true }).catch(() => {})
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
      registry: 'https://clawhub.ai',
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
   * Install a skill from the registry using the bundled bun binary.
   * Runs: bun x clawhub@latest install <slug>
   * Slug is validated before use — no shell injection possible (args array, no shell:true).
   */
  async installFromRegistry(slug: string): Promise<{
    success: boolean
    output?: string
    error?: string
  }> {
    // Accept "skill-name" or "author/skill-name" — each part must be safe
    const slugParts = slug.split('/')
    if (slugParts.length > 2 || slugParts.some(p => !/^[a-zA-Z0-9_.-]+$/.test(p))) {
      return { success: false, error: 'Invalid skill slug' }
    }

    try {
      const { app } = await import('electron')
      const isWindows = process.platform === 'win32'
      const home = process.env.HOME || process.env.USERPROFILE || ''
      const pathSep = isWindows ? ';' : ':'

      let bunBinary: string
      let env: NodeJS.ProcessEnv

      const skillsWorkdir = path.join(home, '.openclaw')

      if (app.isPackaged) {
        const bunBinaryName = isWindows
          ? 'bun-windows.exe'
          : `bun-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
        bunBinary = path.join(process.resourcesPath, 'bun', bunBinaryName)
        const bundledBunDir = path.join(process.resourcesPath, 'bun')
        const expandedPath = isWindows
          ? [bundledBunDir, process.env.PATH || ''].join(pathSep)
          : [bundledBunDir, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', process.env.PATH || ''].join(pathSep)
        env = { ...process.env, PATH: expandedPath, CLAWHUB_WORKDIR: skillsWorkdir }
      } else {
        bunBinary = 'bun'
        const bunPath = path.join(home, '.bun', 'bin')
        env = { ...process.env, PATH: `${bunPath}${pathSep}${process.env.PATH || ''}`, CLAWHUB_WORKDIR: skillsWorkdir }
      }

      const args = ['x', 'clawhub@latest', 'install', '--force', slug]
      console.log(`[SkillsManager] Installing from registry: ${bunBinary} ${args.join(' ')} (cwd: ${skillsWorkdir})`)

      return new Promise((resolve) => {
        const child = spawn(bunBinary, args, { env, cwd: skillsWorkdir, windowsHide: true })

        const stdoutChunks: Buffer[] = []
        const stderrChunks: Buffer[] = []
        child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
        child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

        child.on('error', (err: any) => {
          // Spawn failed entirely (e.g. bun binary not found) — try proxy
          console.log(`[SkillsManager] Spawn error: ${err.message}, trying proxy fallback for "${slug}"`)
          this._installViaProxy(slug).then(
            proxyResult => resolve(proxyResult),
            proxyErr => resolve({ success: false, error: `Spawn failed (${err.message}) + proxy fallback failed: ${proxyErr.message}` })
          )
        })

        const timeout = setTimeout(() => {
          child.kill()
          console.log(`[SkillsManager] clawhub install timed out, trying proxy fallback for "${slug}"`)
          this._installViaProxy(slug).then(
            proxyResult => resolve(proxyResult),
            proxyErr => resolve({ success: false, error: `Install timed out + proxy fallback failed: ${proxyErr.message}` })
          )
        }, 90000)

        child.on('close', (code) => {
          clearTimeout(timeout)
          const stdout = Buffer.concat(stdoutChunks).toString('utf8')
          const stderr = Buffer.concat(stderrChunks).toString('utf8')
          const output = [stdout, stderr].filter(Boolean).join('\n').trim()

          const outputLower = output.toLowerCase()

          // clawhub can exit 0 but print "Rate limit exceeded" when the
          // install actually failed — fall through to proxy in that case.
          const hitRateLimit = outputLower.includes('rate limit exceeded')
          if (code === 0 && !hitRateLimit) {
            resolve({ success: true, output })
            return
          }

          // "Skill not found" is a definitive answer — don't fallback
          if (outputLower.includes('skill not found')) {
            resolve({ success: false, output, error: `Skill "${slug}" not found in the ClawHub registry.` })
            return
          }

          // For any other failure (rate limit, module errors, network issues),
          // try installing via our proxy before giving up
          console.log(`[SkillsManager] clawhub install failed (code ${code}), trying proxy fallback for "${slug}"`)
          this._installViaProxy(slug).then(
            proxyResult => resolve(proxyResult),
            proxyErr => resolve({ success: false, output, error: `Install failed + proxy fallback failed: ${proxyErr.message}` })
          )
        })
      })
    } catch (error: any) {
      console.error(`[SkillsManager] Error installing from registry: ${slug}`, error)
      return { success: false, error: error.message || 'Failed to install skill' }
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
      // The metadata value is JSON (or JSON5-ish); parse it
      const parsed = JSON.parse(raw)
      const oc = parsed?.openclaw || parsed?.clawdbot || parsed
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
      const { readFile } = await import('fs/promises')
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
      const { readdir, readFile } = await import('fs/promises')
      const home = process.env.HOME || process.env.USERPROFILE || ''
      const skillsDir = path.join(home, '.openclaw', 'skills')

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
  async removeSkill(skillName: string): Promise<{ success: boolean; error?: string }> {
    if (!skillName || !/^[a-zA-Z0-9_.-]+$/.test(skillName)) {
      return { success: false, error: 'Invalid skill name' }
    }
    try {
      const { rm, access, readdir, readFile } = await import('fs/promises')
      const home = process.env.HOME || process.env.USERPROFILE || ''
      const skillsDir = path.join(home, '.openclaw', 'skills')

      // 1. Direct match: directory name equals skill name
      const directDir = path.join(skillsDir, skillName)
      try {
        await access(directDir)
        console.log(`[SkillsManager] Removing skill folder: ${directDir}`)
        await rm(directDir, { recursive: true })
        return { success: true }
      } catch {}

      // 2. Scan directories and match by SKILL.md name: field
      try {
        const entries = await readdir(skillsDir, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          try {
            const md = await readFile(path.join(skillsDir, entry.name, 'SKILL.md'), 'utf8')
            const m = md.match(/^name:\s*(.+)$/m)
            if (m && m[1].trim() === skillName) {
              const matchedDir = path.join(skillsDir, entry.name)
              console.log(`[SkillsManager] Removing skill folder: ${matchedDir} (matched by name: ${skillName})`)
              await rm(matchedDir, { recursive: true })
              return { success: true }
            }
          } catch {}
        }
      } catch {}

      return { success: false, error: `"${skillName}" is a bundled skill and cannot be removed here. Only workspace-installed skills (via clawhub install) can be deleted.` }
    } catch (error: any) {
      console.error(`[SkillsManager] Error removing skill ${skillName}:`, error)
      return { success: false, error: error.message || 'Failed to remove skill' }
    }
  }

  /**
   * Clear cached skillsSnapshot from all session entries so the gateway
   * rebuilds the snapshot (picking up newly installed/removed skills)
   * on the next message.
   */
  async clearSkillsSnapshots(): Promise<void> {
    try {
      const { readdir, readFile, writeFile } = await import('fs/promises')
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
            await writeFile(storePath, JSON.stringify(store, null, 2), 'utf8')
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
   * Enable or disable a skill by writing to ~/.openclaw/openclaw.json.
   * Setting enabled=false prevents the skill from loading even if bundled.
   */
  async setSkillEnabled(skillName: string, enabled: boolean): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`[SkillsManager] Setting skill "${skillName}" enabled=${enabled}`)
      const config = await this.configManager.loadConfig()

      if (!config.skills) {config.skills = {}}
      if (!config.skills.entries) {config.skills.entries = {}}
      if (!config.skills.entries[skillName]) {config.skills.entries[skillName] = {}}

      config.skills.entries[skillName].enabled = enabled

      await this.configManager.writeConfig(config)
      console.log(`[SkillsManager] Skill "${skillName}" enabled=${enabled} saved to config`)
      return { success: true }
    } catch (error: any) {
      console.error(`[SkillsManager] Error setting skill enabled for ${skillName}:`, error)
      return {
        success: false,
        error: error.message || 'Failed to update skill'
      }
    }
  }
}
