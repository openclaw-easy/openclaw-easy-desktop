/**
 * One-shot legacy migration: openai-codex → openai.
 *
 * Upstream openclaw 2026.6 folded the standalone "openai-codex" provider
 * into "openai". The codex harness now whitelists only `{codex, openai}`
 * and rejects any model id whose provider portion is `openai-codex`:
 *
 *   Requested agent harness "codex" does not support openai-codex/gpt-5.5
 *   (provider is not one of: codex, openai).
 *
 * Two on-disk artifacts produced by pre-2026.6 openclaw still carry the
 * legacy provider id and trip this validation for upgraded users:
 *
 *   1. ~/.openclaw/agents/<id>/agent/auth-profiles.json
 *      — keyed `openai-codex:<email>` with `provider: "openai-codex"`
 *        and (sometimes) `oauthRef.provider: "openai-codex"`.
 *      — when present, the codex harness preferentially binds to this
 *        OAuth profile and synthesises `openai-codex/<model>` for the
 *        run, which fails the harness's own provider whitelist.
 *
 *   2. ~/.openclaw/agents/<id>/agent/plugins/openai/catalog.json
 *      — `providers["openai-codex"]` published as a SEPARATE provider
 *        alongside `providers["openai"]`, both listing the same models.
 *      — kept current by the *old* openai plugin; the post-fold plugin
 *        emits only `providers["openai"]`, but the stale entry survives
 *        on disk and gets resolved during routing.
 *
 * Upstream `openclaw doctor --fix` ships a migration that handles both
 * (see src/commands/doctor-auth.ts +
 * src/commands/doctor/shared/legacy-config-migrations.runtime.providers.ts),
 * but the desktop's DoctorManager strips `--fix` for safety, so the
 * migration never fires automatically on upgrade. This module narrowly
 * mirrors just those two repairs and runs them on every gateway start.
 *
 * Idempotent: a clean tree returns `{ changed: false }` and is silent.
 *
 * Why not just call `openclaw doctor --fix`?
 *   - `--fix` is broad and can rewrite parts of the config we don't want
 *     touched (skill enablement, plugin slots, default models). The
 *     desktop's existing DoctorManager intentionally strips `--fix` for
 *     this reason. A scoped migration trades breadth for auditability.
 *   - It also avoids the bundled doctor's `node:sqlite` dependency, which
 *     blows up on older runtimes.
 *
 * Removal: when the bundled openclaw is recent enough that fresh installs
 * never produce `openai-codex:*` artifacts AND we're confident no user is
 * still upgrading from a pre-2026.6 install, delete this module.
 */

import * as fs from 'fs'
import * as path from 'path'

const LEGACY_PROVIDER = 'openai-codex'
const CANONICAL_PROVIDER = 'openai'

export interface MigrationOutcome {
  /** True iff the file/object was structurally modified. */
  changed: boolean
  /** Short, user-presentable summary lines (one per repair). */
  warnings: string[]
}

export interface OpenaiCodexLegacyMigrationResult {
  authProfilesMigrated: number
  authProfilesScanned: number
  catalogEntriesRemoved: number
  catalogsScanned: number
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Pure helpers (no IO) — exhaustively tested in the *.test.ts sibling.
// ---------------------------------------------------------------------------

type AuthProfilesObject = Record<string, unknown>

/**
 * Rename every legacy `openai-codex:<suffix>` profile key under
 * `obj.profiles` (or directly under `obj` for legacy flat shape) to
 * `openai:<suffix>` and rewrite the inner `provider` /
 * `oauthRef.provider` fields. Returns a structural-change flag and
 * one warning line per profile touched.
 *
 * Conflict policy: if both `openai-codex:<suffix>` AND `openai:<suffix>`
 * already exist, the legacy one is dropped (the canonical wins). We
 * surface this in the warnings — losing OAuth state should be visible.
 *
 * Pure. Mutates the input. Idempotent.
 */
export function migrateAuthProfilesObject(obj: unknown): MigrationOutcome {
  const warnings: string[] = []
  let changed = false
  if (!isPlainObject(obj)) return { changed, warnings }

  // Flat shape: keys directly on `obj`. Nested shape: keys under `obj.profiles`.
  // Both have shipped at various points; handle both rather than guess.
  const container = isPlainObject(obj.profiles)
    ? (obj.profiles as AuthProfilesObject)
    : (obj as AuthProfilesObject)

  const legacyKeys = Object.keys(container).filter((k) =>
    k.startsWith(`${LEGACY_PROVIDER}:`),
  )

  for (const legacyKey of legacyKeys) {
    const suffix = legacyKey.slice(LEGACY_PROVIDER.length + 1)
    const canonicalKey = `${CANONICAL_PROVIDER}:${suffix}`
    const profile = container[legacyKey]

    if (canonicalKey in container) {
      // Canonical already present — drop legacy to avoid duplicate auth.
      // Surface loudly: the user may have meant the legacy profile.
      delete container[legacyKey]
      warnings.push(
        `Dropped duplicate legacy auth profile "${legacyKey}" — canonical "${canonicalKey}" already present.`,
      )
      changed = true
      continue
    }

    if (isPlainObject(profile)) {
      if (profile.provider === LEGACY_PROVIDER) {
        profile.provider = CANONICAL_PROVIDER
      }
      const oauthRef = profile.oauthRef
      if (isPlainObject(oauthRef) && oauthRef.provider === LEGACY_PROVIDER) {
        oauthRef.provider = CANONICAL_PROVIDER
      }
    }

    container[canonicalKey] = profile
    delete container[legacyKey]
    warnings.push(`Renamed auth profile "${legacyKey}" → "${canonicalKey}"`)
    changed = true
  }

  return { changed, warnings }
}

type CatalogObject = { providers?: Record<string, unknown>; [k: string]: unknown }

/**
 * Strip the legacy `providers["openai-codex"]` entry from a plugin
 * catalog. The post-fold openai plugin no longer emits this entry; any
 * surviving instance is leftover from a pre-fold install.
 *
 * Pure. Mutates the input. Idempotent.
 */
export function migrateOpenaiCatalogObject(obj: unknown): MigrationOutcome {
  const warnings: string[] = []
  let changed = false
  if (!isPlainObject(obj)) return { changed, warnings }
  const providers = (obj as CatalogObject).providers
  if (!isPlainObject(providers)) return { changed, warnings }
  if (LEGACY_PROVIDER in providers) {
    delete (providers as Record<string, unknown>)[LEGACY_PROVIDER]
    warnings.push(
      `Removed legacy "providers.${LEGACY_PROVIDER}" entry from openai plugin catalog.`,
    )
    changed = true
  }
  return { changed, warnings }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// ---------------------------------------------------------------------------
// IO wrapper — callers should run this on every gateway start.
// ---------------------------------------------------------------------------

export interface MigrationLogger {
  addLog(line: string): void
}

/**
 * Walk every per-agent dir under ~/.openclaw/agents and migrate both
 * `auth-profiles.json` and the openai plugin's `catalog.json` in place.
 *
 * Each touched file is backed up to `<file>.pre-openai-codex-fix.bak`
 * before the rewrite. Backup is overwritten on subsequent runs only if
 * we'd produce a different rewrite — idempotent runs skip the backup
 * entirely (we early-out via the `changed` flag from the pure helpers).
 *
 * Returns a summary so callers can log a single concise line.
 */
export async function runOpenaiCodexLegacyMigration(
  openClawHome: string,
  logger?: MigrationLogger,
): Promise<OpenaiCodexLegacyMigrationResult> {
  const summary: OpenaiCodexLegacyMigrationResult = {
    authProfilesMigrated: 0,
    authProfilesScanned: 0,
    catalogEntriesRemoved: 0,
    catalogsScanned: 0,
    warnings: [],
  }

  const agentsDir = path.join(openClawHome, 'agents')
  if (!fs.existsSync(agentsDir)) return summary

  let agentIds: string[]
  try {
    agentIds = fs
      .readdirSync(agentsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch (err) {
    logger?.addLog(
      `[openai-codex migration] Failed to read ${agentsDir}: ${(err as Error).message}`,
    )
    return summary
  }

  for (const agentId of agentIds) {
    const authPath = path.join(agentsDir, agentId, 'agent', 'auth-profiles.json')
    if (fs.existsSync(authPath)) {
      summary.authProfilesScanned += 1
      const result = migrateJsonFile(authPath, migrateAuthProfilesObject, logger)
      if (result?.changed) {
        summary.authProfilesMigrated += 1
        summary.warnings.push(...result.warnings)
      }
    }

    const catalogPath = path.join(
      agentsDir,
      agentId,
      'agent',
      'plugins',
      'openai',
      'catalog.json',
    )
    if (fs.existsSync(catalogPath)) {
      summary.catalogsScanned += 1
      const result = migrateJsonFile(catalogPath, migrateOpenaiCatalogObject, logger)
      if (result?.changed) {
        summary.catalogEntriesRemoved += 1
        summary.warnings.push(...result.warnings)
      }
    }
  }

  if (summary.authProfilesMigrated > 0 || summary.catalogEntriesRemoved > 0) {
    logger?.addLog(
      `🔧 openai-codex → openai legacy migration applied (` +
        `auth=${summary.authProfilesMigrated}, ` +
        `catalogs=${summary.catalogEntriesRemoved})`,
    )
    for (const w of summary.warnings) {
      logger?.addLog(`  • ${w}`)
    }
  }

  return summary
}

/**
 * Read a JSON file, run a pure migration, atomically write the result if
 * the migration reports changes. Backs up the original to `<file>.bak`
 * before overwriting so the user can recover if something went wrong.
 *
 * Returns the migration outcome or null when the file was unreadable /
 * unparseable (we leave broken files alone — recovery is a doctor job).
 */
function migrateJsonFile(
  filePath: string,
  migrate: (obj: unknown) => MigrationOutcome,
  logger?: MigrationLogger,
): MigrationOutcome | null {
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf8')
  } catch (err) {
    logger?.addLog(
      `[openai-codex migration] Skipped unreadable ${filePath}: ${(err as Error).message}`,
    )
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    logger?.addLog(
      `[openai-codex migration] Skipped unparseable ${filePath}: ${(err as Error).message}`,
    )
    return null
  }

  const outcome = migrate(parsed)
  if (!outcome.changed) return outcome

  const backupPath = `${filePath}.pre-openai-codex-fix.bak`
  try {
    // Only create the backup once — preserve the FIRST pre-migration
    // state, not the most recent. If we'd overwrite an existing backup,
    // skip silently: it means this migration ran earlier and we'd just
    // clobber the original state with a partially-already-migrated one.
    if (!fs.existsSync(backupPath)) {
      fs.writeFileSync(backupPath, raw, 'utf8')
    }
  } catch (err) {
    logger?.addLog(
      `[openai-codex migration] Could not back up ${filePath}: ${(err as Error).message} — aborting this file.`,
    )
    return null
  }

  const nextRaw = JSON.stringify(parsed, null, 2)
  try {
    const tmpPath = `${filePath}.openai-codex-fix.tmp`
    fs.writeFileSync(tmpPath, nextRaw, 'utf8')
    fs.renameSync(tmpPath, filePath)
  } catch (err) {
    logger?.addLog(
      `[openai-codex migration] Failed atomic write of ${filePath}: ${(err as Error).message}`,
    )
    return null
  }

  return outcome
}
