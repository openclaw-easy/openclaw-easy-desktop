/**
 * One-shot keychain-rename migration.
 *
 * 2026-06-17 — the macOS entitlement `keychain-access-groups` was
 * renamed from the previous brand's app id to
 * `com.openclaw-easy.app` (matches `electron-builder.yml`'s
 * `appId`). The OS Keychain ties safeStorage ciphertext to the access
 * group that encrypted it; an existing install upgrading to a build
 * with the renamed entitlement CANNOT decrypt its old `authTokenEncrypted`
 * ciphertext because the running app no longer has access to the old
 * group's key.
 *
 * Functional impact: user must sign in once after upgrade.
 *
 * `ConfigManager.getAppConfig` already handles a decrypt failure by
 * discarding the field, so the lazy path works. This module adds an
 * EAGER pass at launch that:
 *
 *   1. Detects the stale field.
 *   2. Tries to decrypt — if it works (rare; only on an upgrade path
 *      where the entitlement happens to still match — e.g. a dev who
 *      hasn't rebuilt yet, or a future build that declares dual groups),
 *      DON'T touch anything. getAppConfig will use it normally.
 *   3. If decrypt fails, clear `authTokenEncrypted` eagerly + log a
 *      single clear `[KeychainMigration]` line so the operator can
 *      correlate "I had to re-login" with the entitlement rename. This
 *      avoids the noisy `getAppConfig` error log on EVERY subsequent
 *      `app-config` read.
 *
 * Idempotent. Returns silently on a clean tree (no token, or V2-style
 * future field present).
 *
 * Wired in `openclaw-manager.ts::start()` alongside
 * `runOpenaiCodexLegacyMigration`. Pattern mirrors the openai-codex
 * migration in the same dir (backup → atomic write → idempotent guard).
 */

import * as fs from 'fs'
import * as path from 'path'
import { app, safeStorage } from 'electron'

export interface KeychainMigrationLogger {
  addLog(line: string): void
}

export interface KeychainMigrationResult {
  /** True iff the on-disk app-config.json was modified. */
  changed: boolean
  /** What action was taken; for tests + audit. */
  outcome: 'no-token' | 'decrypt-ok' | 'cleared-stale-token' | 'config-missing' | 'config-unreadable' | 'safe-storage-unavailable'
}

/**
 * Resolves the desktop app's `app-config.json` path. Separated so
 * tests can override.
 */
export function getDefaultAppConfigPath(): string {
  return path.join(app.getPath('home'), '.config', 'openclaw-desktop', 'app-config.json')
}

/**
 * Public entry point. Runs the rename-aware keychain check + cleanup.
 *
 * @param appConfigPath Override for tests.
 * @param logger Optional logger; we emit at most one line per run.
 */
export function runKeychainMigration(
  appConfigPath: string = getDefaultAppConfigPath(),
  logger?: KeychainMigrationLogger,
): KeychainMigrationResult {
  if (!fs.existsSync(appConfigPath)) {
    return { changed: false, outcome: 'config-missing' }
  }

  // Read + parse the config file. Unreadable / unparseable → silent
  // no-op (ConfigManager has its own recovery path).
  let raw: string
  let parsed: any
  try {
    raw = fs.readFileSync(appConfigPath, 'utf8')
    parsed = JSON.parse(raw)
  } catch (err) {
    logger?.addLog(`[KeychainMigration] Skipped unreadable ${appConfigPath}: ${(err as Error).message}`)
    return { changed: false, outcome: 'config-unreadable' }
  }

  // Nothing to do if no stale field is present.
  const legacy = typeof parsed?.authTokenEncrypted === 'string' ? parsed.authTokenEncrypted : null
  if (!legacy) {
    return { changed: false, outcome: 'no-token' }
  }

  // Without safeStorage we can't make any decision about the ciphertext.
  // Leave it alone — the next normal app-config read will surface the
  // failure if/when safeStorage comes back online. (Treat as no-op.)
  if (!safeStorage.isEncryptionAvailable()) {
    return { changed: false, outcome: 'safe-storage-unavailable' }
  }

  // Try to decrypt. Success → we're on a build whose entitlement still
  // matches the ciphertext's access group; leave it untouched.
  try {
    safeStorage.decryptString(Buffer.from(legacy, 'base64'))
    return { changed: false, outcome: 'decrypt-ok' }
  } catch (_err) {
    // Decryption failed — almost certainly because the entitlement
    // rename invalidated the ciphertext. Clear the field so
    // `getAppConfig` stops logging a recurring error, and surface a
    // single clear migration line.
  }

  // Eager cleanup: drop `authTokenEncrypted`, back up the original,
  // atomic write.
  const backupPath = `${appConfigPath}.pre-keychain-rename.bak`
  try {
    if (!fs.existsSync(backupPath)) {
      fs.writeFileSync(backupPath, raw, 'utf8')
    }
  } catch (err) {
    logger?.addLog(`[KeychainMigration] Could not back up ${appConfigPath}: ${(err as Error).message} — leaving stale field in place.`)
    return { changed: false, outcome: 'config-unreadable' }
  }

  delete parsed.authTokenEncrypted
  const next = JSON.stringify(parsed, null, 2)
  try {
    const tmpPath = `${appConfigPath}.keychain-fix.tmp`
    fs.writeFileSync(tmpPath, next, 'utf8')
    fs.renameSync(tmpPath, appConfigPath)
  } catch (err) {
    logger?.addLog(`[KeychainMigration] Failed atomic write of ${appConfigPath}: ${(err as Error).message}`)
    return { changed: false, outcome: 'config-unreadable' }
  }

  logger?.addLog(
    '🔧 Keychain access group renamed — cleared stale encrypted auth token. ' +
      'User will be prompted to sign in once. See keychain-migration.ts for context.',
  )
  return { changed: true, outcome: 'cleared-stale-token' }
}
