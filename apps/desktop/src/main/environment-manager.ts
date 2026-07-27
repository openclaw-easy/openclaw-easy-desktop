import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execFile } from 'child_process'
import { SHELL_RC_BLOCK_START, removeShellRcBlock } from './env-shell-escape'

/**
 * Retires the legacy practice of persisting provider credentials
 * (`OPENAI_API_KEY`, `OPENAI_BASE_URL`, `GEMINI_API_KEY`, `OLLAMA_*`) into
 * the *global* shell environment — both the sentinel-fenced managed block
 * in `~/.zshrc` / `~/.bash_profile` and the macOS `launchctl setenv` /
 * Windows `HKCU\Environment` domain.
 *
 * Why this was removed (the bug it caused):
 *   The gateway's openai path resolves the key as
 *   `config.apiKey || OPENAI_API_KEY-from-env`. When a user had ever
 *   configured BYOK-OpenAI, we wrote their `sk-...` key into the global
 *   env. After switching providers that stale key stayed put, the
 *   launchd/system gateway inherited it, and it OVERRODE the credential
 *   in openclaw.json — so the gateway kept sending the old key and the
 *   provider rejected it.
 *
 *   Credentials belong in openclaw.json (read by the gateway) and are
 *   passed to desktop-spawned gateways per-child via OpenClawEnvironment.
 *   No global, machine-wide copy is needed — so we remove any copy a
 *   previous version left behind.
 *
 * OWNERSHIP SAFETY: the persistent stores (launchctl domain, Windows
 * registry) are NOT sentinel-marked, so we cannot tell an app-written
 * value apart from one the user set for their own tooling by location
 * alone. We therefore only clear a persistent var when its current value
 * matches a credential the app itself stores in app-config (the value the
 * old code would have written). A user's own OPENAI_API_KEY /
 * GEMINI_API_KEY is never touched. The shell-rc block, by contrast, IS
 * sentinel-fenced, so it is always safe to splice out.
 *
 * Runs on every startup and config change; idempotent.
 */

// Persisted-secret env vars previous versions wrote, paired with the
// (non-secret) companion var the same provider branch also wrote. We only
// clear a companion when its paired secret is cleared.
const SECRET_ENV_KEYS = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'OLLAMA_API_KEY'] as const
const COMPANION_ENV_KEYS: Record<string, string[]> = {
  OPENAI_API_KEY: ['OPENAI_BASE_URL'],
  OLLAMA_API_KEY: ['OLLAMA_HOST'],
}
// Everything we drop from THIS process's env (process-local, non-destructive).
const ALL_MANAGED_ENV_KEYS = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'GEMINI_API_KEY', 'OLLAMA_HOST', 'OLLAMA_API_KEY'] as const

const SHELL_RC_FILES = ['.zshrc', '.bash_profile', '.bashrc', '.profile']

export class EnvironmentManager {
  /**
   * Startup hook. Removes any leaked global provider-credential env so the
   * gateway resolves credentials from openclaw.json.
   */
  async initializeEnvironment(): Promise<void> {
    await this.cleanupGlobalProviderEnv()
  }

  /** Config-change hook — same idempotent cleanup. */
  async updateEnvironmentVariables(): Promise<void> {
    await this.cleanupGlobalProviderEnv()
  }

  private async cleanupGlobalProviderEnv(): Promise<void> {
    try {
      const removedBlock = this.removeManagedShellRcBlocks()
      const unset = await this.unsetOwnedGlobalProviderVars()
      // Drop from THIS process too (process-local, non-destructive) so a
      // gateway we spawn next does not re-inherit a stale value before the
      // user re-applies a provider.
      for (const key of ALL_MANAGED_ENV_KEYS) delete process.env[key]
      if (removedBlock || unset) {
        console.log('[EnvironmentManager] Removed legacy app-written global provider env; gateway now uses openclaw.json credentials.')
      }
    } catch (error) {
      console.error('[EnvironmentManager] Error cleaning up global provider env:', error)
    }
  }

  /**
   * Splice out the sentinel-fenced managed block from every shell-rc file.
   * Only touches our own block; user-authored lines are left untouched.
   * Returns true if any file changed.
   */
  private removeManagedShellRcBlocks(): boolean {
    const homeDir = os.homedir()
    let changed = false
    for (const profile of SHELL_RC_FILES) {
      const profilePath = path.join(homeDir, profile)
      try {
        if (!fs.existsSync(profilePath)) continue
        const existing = fs.readFileSync(profilePath, 'utf-8')
        if (!existing.includes(SHELL_RC_BLOCK_START)) continue
        const next = removeShellRcBlock(existing)
        if (next !== existing) {
          fs.writeFileSync(profilePath, next)
          changed = true
          console.log(`[EnvironmentManager] Removed managed env block from ${profile}`)
        }
      } catch (error) {
        console.error(`[EnvironmentManager] Error updating ${profile}:`, error)
      }
    }
    return changed
  }

  /**
   * Clear the launchd-session / Windows-registry copies of provider secrets
   * the app itself wrote — identified by value-match against the credentials
   * the app stores in app-config. Never removes a value the app doesn't own.
   * Returns true if anything was cleared.
   */
  private async unsetOwnedGlobalProviderVars(): Promise<boolean> {
    const platform = process.platform
    if (platform !== 'darwin' && platform !== 'win32') return false // Linux: shell-rc block only
    const owned = this.readAppManagedSecretValues()
    if (owned.size === 0) return false

    let changed = false
    for (const key of SECRET_ENV_KEYS) {
      const current = await this.getGlobalValue(key)
      if (!current || !owned.has(current)) continue // unset/absent or user-owned → leave it
      await this.unsetGlobalValue(key)
      changed = true
      // The provider branch that wrote this secret also wrote its companion
      // (e.g. OPENAI_BASE_URL); clear it too now that we've confirmed ownership.
      for (const companion of COMPANION_ENV_KEYS[key] ?? []) {
        await this.unsetGlobalValue(companion)
      }
    }
    return changed
  }

  /**
   * The plaintext provider secrets the app currently stores (app-config
   * retains per-provider BYOK keys across provider switches, so this covers
   * a key written under a now-inactive provider too).
   */
  private readAppManagedSecretValues(): Set<string> {
    const out = new Set<string>()
    try {
      const p = path.join(os.homedir(), '.config', 'openclaw-desktop', 'app-config.json')
      if (!fs.existsSync(p)) return out
      const cfg = JSON.parse(fs.readFileSync(p, 'utf-8'))
      const add = (v: unknown) => { if (typeof v === 'string' && v.trim()) out.add(v) }
      const byokKeys = cfg?.byok?.apiKeys
      if (byokKeys && typeof byokKeys === 'object') for (const v of Object.values(byokKeys)) add(v)
      const topKeys = cfg?.apiKeys
      if (topKeys && typeof topKeys === 'object') for (const v of Object.values(topKeys)) add(v)
      add(cfg?.stt?.openaiApiKey)
      add(cfg?.stt?.googleApiKey)
    } catch {
      // Unreadable app-config → empty set → cleanup is a safe no-op.
    }
    return out
  }

  /** Read a global env var's current value (empty string if unset). */
  private async getGlobalValue(key: string): Promise<string> {
    try {
      if (process.platform === 'darwin') {
        return (await this.runExecFile('launchctl', ['getenv', key])).trim()
      }
      // Windows: `reg query` prints `    NAME    REG_SZ    value`; absent → non-zero exit.
      const out = await this.runExecFile('reg', ['query', 'HKCU\\Environment', '/v', key])
      const m = out.match(new RegExp(`${key}\\s+REG_[A-Z_]+\\s+(.*)`))
      return m ? m[1].trim() : ''
    } catch {
      return '' // not set / tool unavailable
    }
  }

  /** Remove a global env var (launchd session on macOS, HKCU on Windows). */
  private async unsetGlobalValue(key: string): Promise<void> {
    try {
      if (process.platform === 'darwin') {
        await this.runExecFile('launchctl', ['unsetenv', key])
        console.log(`[EnvironmentManager] Cleared app-written launchctl var: ${key}`)
      } else if (process.platform === 'win32') {
        await this.runExecFile('reg', ['delete', 'HKCU\\Environment', '/v', key, '/f'])
        console.log(`[EnvironmentManager] Cleared app-written registry var: ${key}`)
      }
    } catch {
      // Best-effort; already gone or tool unavailable.
    }
  }

  /**
   * Run a command via `execFile` with an explicit arg array — never via
   * the shell, so values are never re-parsed.
   */
  private runExecFile(bin: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(bin, args, { windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`Command failed: ${bin}\nStderr: ${stderr}`))
          return
        }
        resolve(stdout)
      })
    })
  }
}
