/**
 * Tests the eager keychain-rename cleanup.
 *
 * Covers every shape of app-config + safeStorage state we expect on
 * upgrade. The hot path is "stale config, decrypt throws, eager
 * clear" — that's what avoids the recurring error log on every read
 * post-rename.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// Mock electron BEFORE importing the migration module. The migration
// reads `safeStorage.isEncryptionAvailable()` and `safeStorage.decryptString`.
let mockEncryptionAvailable = true
let mockDecryptThrows = true

vi.mock('electron', () => ({
  app: {
    getPath: (_what: string) => '/test-fixture-home',
  },
  safeStorage: {
    isEncryptionAvailable: () => mockEncryptionAvailable,
    decryptString: (_buf: Buffer) => {
      if (mockDecryptThrows) {
        throw new Error('decrypt failed: access group mismatch')
      }
      return 'decrypted-token-value'
    },
  },
}))

// Import AFTER the mock is in place.
import { runKeychainMigration } from './keychain-migration'

describe('runKeychainMigration', () => {
  let tmpDir: string
  let configPath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keychain-migration-'))
    configPath = path.join(tmpDir, 'app-config.json')
    mockEncryptionAvailable = true
    mockDecryptThrows = true
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns config-missing when app-config.json does not exist', () => {
    const result = runKeychainMigration(configPath)
    expect(result).toEqual({ changed: false, outcome: 'config-missing' })
  })

  it('returns no-token when the config has no authTokenEncrypted field', () => {
    fs.writeFileSync(configPath, JSON.stringify({ currentUser: { id: 'u1' } }))
    const result = runKeychainMigration(configPath)
    expect(result).toEqual({ changed: false, outcome: 'no-token' })
    // File unchanged.
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8'))).toEqual({ currentUser: { id: 'u1' } })
  })

  it('returns safe-storage-unavailable without touching the file when safeStorage is offline', () => {
    mockEncryptionAvailable = false
    fs.writeFileSync(configPath, JSON.stringify({ authTokenEncrypted: 'ZGVhZGJlZWY=' }))
    const result = runKeychainMigration(configPath)
    expect(result.outcome).toBe('safe-storage-unavailable')
    expect(result.changed).toBe(false)
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8'))).toEqual({
      authTokenEncrypted: 'ZGVhZGJlZWY=',
    })
  })

  it('returns decrypt-ok and leaves the field intact when decryption succeeds', () => {
    mockDecryptThrows = false
    fs.writeFileSync(configPath, JSON.stringify({ authTokenEncrypted: 'ZGVhZGJlZWY=' }))
    const result = runKeychainMigration(configPath)
    expect(result).toEqual({ changed: false, outcome: 'decrypt-ok' })
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8'))).toEqual({
      authTokenEncrypted: 'ZGVhZGJlZWY=',
    })
  })

  it('clears the stale field, writes a backup, and logs once when decrypt fails', () => {
    const original = { authTokenEncrypted: 'ZGVhZGJlZWY=', otherField: 'preserved' }
    fs.writeFileSync(configPath, JSON.stringify(original))
    const lines: string[] = []
    const result = runKeychainMigration(configPath, { addLog: (l) => lines.push(l) })
    expect(result).toEqual({ changed: true, outcome: 'cleared-stale-token' })
    // Field removed; other fields preserved.
    const after = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    expect(after.authTokenEncrypted).toBeUndefined()
    expect(after.otherField).toBe('preserved')
    // Backup written with the original raw content.
    const backupPath = `${configPath}.pre-keychain-rename.bak`
    expect(fs.existsSync(backupPath)).toBe(true)
    expect(JSON.parse(fs.readFileSync(backupPath, 'utf8'))).toEqual(original)
    // Exactly one log line.
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain('Keychain access group renamed')
  })

  it('is idempotent — re-running after a successful cleanup is a no-op', () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({ authTokenEncrypted: 'ZGVhZGJlZWY=', other: 'x' }),
    )
    const first = runKeychainMigration(configPath)
    expect(first.changed).toBe(true)
    const second = runKeychainMigration(configPath)
    expect(second).toEqual({ changed: false, outcome: 'no-token' })
  })

  it('preserves the FIRST backup across multiple re-runs (do not overwrite)', () => {
    const original = { authTokenEncrypted: 'first-ciphertext', other: 'x' }
    fs.writeFileSync(configPath, JSON.stringify(original))
    runKeychainMigration(configPath)
    // Simulate a future state where another encrypted field appears.
    fs.writeFileSync(
      configPath,
      JSON.stringify({ authTokenEncrypted: 'second-ciphertext', other: 'x' }),
    )
    runKeychainMigration(configPath)
    const backupPath = `${configPath}.pre-keychain-rename.bak`
    // The backup still reflects the ORIGINAL pre-migration state — the
    // contract is "preserve the first snapshot", not "track every wipe".
    expect(JSON.parse(fs.readFileSync(backupPath, 'utf8'))).toEqual(original)
  })

  it('skips unparseable JSON without crashing', () => {
    fs.writeFileSync(configPath, '{not valid json')
    const lines: string[] = []
    const result = runKeychainMigration(configPath, { addLog: (l) => lines.push(l) })
    expect(result.outcome).toBe('config-unreadable')
    expect(result.changed).toBe(false)
    expect(fs.readFileSync(configPath, 'utf8')).toBe('{not valid json')
    expect(lines.some((l) => l.includes('Skipped unreadable'))).toBe(true)
  })

  it('treats a non-string authTokenEncrypted field as no-token (defensive)', () => {
    fs.writeFileSync(configPath, JSON.stringify({ authTokenEncrypted: 42 }))
    const result = runKeychainMigration(configPath)
    expect(result.outcome).toBe('no-token')
  })

  it('logs no migration line when nothing changes (clean tree silence)', () => {
    fs.writeFileSync(configPath, JSON.stringify({ other: 'x' }))
    const lines: string[] = []
    runKeychainMigration(configPath, { addLog: (l) => lines.push(l) })
    expect(lines).toEqual([])
  })
})
