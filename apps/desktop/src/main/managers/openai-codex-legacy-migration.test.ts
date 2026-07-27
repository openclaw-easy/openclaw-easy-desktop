/**
 * Exhaustive tests for the pure migration helpers.
 *
 * Every shape we've seen in the wild (or expect to encounter on legacy
 * installs) gets an explicit case. The IO wrapper has its own integration
 * tests below using a tmp dir.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  migrateAuthProfilesObject,
  migrateOpenaiCatalogObject,
  runOpenaiCodexLegacyMigration,
} from './openai-codex-legacy-migration'

// ---------------------------------------------------------------------------
// migrateAuthProfilesObject — pure
// ---------------------------------------------------------------------------

describe('migrateAuthProfilesObject', () => {
  it('returns no change on null / non-object input', () => {
    for (const input of [null, undefined, 42, 'string', true, [1, 2]]) {
      const result = migrateAuthProfilesObject(input as unknown)
      expect(result.changed).toBe(false)
      expect(result.warnings).toEqual([])
    }
  })

  it('returns no change on empty object', () => {
    const obj = {}
    const result = migrateAuthProfilesObject(obj)
    expect(result.changed).toBe(false)
    expect(obj).toEqual({})
  })

  it('returns no change when no openai-codex keys present (flat shape)', () => {
    const obj = {
      'openai:default': { provider: 'openai', type: 'api_key', key: 'sk-xxx' },
      'google:default': { provider: 'google', type: 'api_key', key: 'AIza-xxx' },
    }
    const result = migrateAuthProfilesObject(obj)
    expect(result.changed).toBe(false)
    expect(obj['openai:default']).toEqual({ provider: 'openai', type: 'api_key', key: 'sk-xxx' })
  })

  it('renames flat-shape openai-codex:<email> to openai:<email> with provider rewrite', () => {
    const obj = {
      'openai-codex:user@example.com': {
        type: 'oauth',
        provider: 'openai-codex',
        email: 'user@example.com',
      },
    }
    const result = migrateAuthProfilesObject(obj)
    expect(result.changed).toBe(true)
    expect(obj).toEqual({
      'openai:user@example.com': {
        type: 'oauth',
        provider: 'openai',
        email: 'user@example.com',
      },
    })
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('openai-codex:user@example.com')
    expect(result.warnings[0]).toContain('openai:user@example.com')
  })

  it('rewrites oauthRef.provider when present', () => {
    const obj = {
      'openai-codex:u@e.com': {
        type: 'oauth',
        provider: 'openai-codex',
        oauthRef: {
          source: 'openclaw-credentials',
          provider: 'openai-codex',
          id: 'abc123',
        },
      },
    }
    migrateAuthProfilesObject(obj)
    expect(obj).toMatchObject({
      'openai:u@e.com': {
        provider: 'openai',
        oauthRef: { provider: 'openai', id: 'abc123', source: 'openclaw-credentials' },
      },
    })
  })

  it('handles nested-shape (keys under obj.profiles)', () => {
    const obj = {
      version: 2,
      profiles: {
        'openai-codex:u@e.com': { type: 'oauth', provider: 'openai-codex' },
        'openai:default': { provider: 'openai', type: 'api_key' },
      },
    }
    const result = migrateAuthProfilesObject(obj)
    expect(result.changed).toBe(true)
    expect((obj.profiles as any)['openai-codex:u@e.com']).toBeUndefined()
    expect((obj.profiles as any)['openai:u@e.com']).toEqual({
      type: 'oauth',
      provider: 'openai',
    })
    // Other profiles untouched.
    expect((obj.profiles as any)['openai:default']).toEqual({
      provider: 'openai',
      type: 'api_key',
    })
    // version field untouched.
    expect(obj.version).toBe(2)
  })

  it('drops legacy profile when canonical key with same suffix already exists', () => {
    const obj = {
      'openai-codex:u@e.com': { type: 'oauth', provider: 'openai-codex' },
      'openai:u@e.com': { type: 'api_key', provider: 'openai', key: 'sk-already-here' },
    }
    const result = migrateAuthProfilesObject(obj)
    expect(result.changed).toBe(true)
    expect((obj as any)['openai-codex:u@e.com']).toBeUndefined()
    // Canonical stayed intact — wasn't clobbered.
    expect(obj['openai:u@e.com']).toEqual({
      type: 'api_key',
      provider: 'openai',
      key: 'sk-already-here',
    })
    expect(result.warnings[0]).toContain('duplicate')
  })

  it('is idempotent — re-running on clean state is a no-op', () => {
    const obj = {
      'openai:u@e.com': { type: 'oauth', provider: 'openai' },
    }
    const first = migrateAuthProfilesObject(obj)
    const snapshot = JSON.stringify(obj)
    const second = migrateAuthProfilesObject(obj)
    expect(first.changed).toBe(false)
    expect(second.changed).toBe(false)
    expect(JSON.stringify(obj)).toBe(snapshot)
  })

  it('is idempotent — re-running on already-migrated state is a no-op', () => {
    const obj = {
      'openai-codex:u@e.com': { type: 'oauth', provider: 'openai-codex' },
    }
    migrateAuthProfilesObject(obj)
    const snapshotAfterFirst = JSON.stringify(obj)
    const second = migrateAuthProfilesObject(obj)
    expect(second.changed).toBe(false)
    expect(JSON.stringify(obj)).toBe(snapshotAfterFirst)
  })

  it('migrates multiple legacy profiles in one pass', () => {
    const obj = {
      'openai-codex:a@e.com': { provider: 'openai-codex', type: 'oauth' },
      'openai-codex:b@e.com': { provider: 'openai-codex', type: 'oauth' },
      'openai:c@e.com': { provider: 'openai', type: 'api_key' },
    }
    const result = migrateAuthProfilesObject(obj)
    expect(result.changed).toBe(true)
    expect(result.warnings).toHaveLength(2)
    expect((obj as any)['openai-codex:a@e.com']).toBeUndefined()
    expect((obj as any)['openai-codex:b@e.com']).toBeUndefined()
    expect((obj as any)['openai:a@e.com']).toBeDefined()
    expect((obj as any)['openai:b@e.com']).toBeDefined()
    expect((obj as any)['openai:c@e.com']).toBeDefined()
  })

  it('tolerates profile with missing provider field', () => {
    const obj = {
      'openai-codex:u@e.com': { type: 'oauth' /* no provider */ },
    }
    const result = migrateAuthProfilesObject(obj)
    expect(result.changed).toBe(true)
    expect((obj as any)['openai:u@e.com']).toEqual({ type: 'oauth' })
  })

  it('tolerates profile that is not a plain object', () => {
    const obj = {
      'openai-codex:u@e.com': 'malformed-string-value',
    }
    const result = migrateAuthProfilesObject(obj)
    // Still renamed even when payload is junk — the key is what trips the harness.
    expect(result.changed).toBe(true)
    expect((obj as any)['openai-codex:u@e.com']).toBeUndefined()
    expect((obj as any)['openai:u@e.com']).toBe('malformed-string-value')
  })

  it('does not touch keys that just CONTAIN openai-codex as a substring', () => {
    const obj = {
      'fake-openai-codex:u@e.com': { provider: 'fake' },
      'openai-codex': { provider: 'openai-codex' }, // No `:` separator → not migrated
    }
    const result = migrateAuthProfilesObject(obj)
    expect(result.changed).toBe(false)
    expect((obj as any)['fake-openai-codex:u@e.com']).toBeDefined()
    expect((obj as any)['openai-codex']).toBeDefined()
  })

  it('does not rewrite provider when it is some other value (defensive)', () => {
    const obj = {
      'openai-codex:u@e.com': {
        provider: 'someone-else', // Already pointing somewhere unexpected.
        type: 'oauth',
      },
    }
    migrateAuthProfilesObject(obj)
    // Key renamed; provider field left alone — we only rewrite the legacy value.
    expect((obj as any)['openai:u@e.com'].provider).toBe('someone-else')
  })

  it('returns a stable warnings count matching the keys migrated', () => {
    const obj = {
      'openai-codex:a@e.com': { provider: 'openai-codex' },
      'openai-codex:b@e.com': { provider: 'openai-codex' },
      'openai-codex:c@e.com': { provider: 'openai-codex' },
    }
    const result = migrateAuthProfilesObject(obj)
    expect(result.warnings).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// migrateOpenaiCatalogObject — pure
// ---------------------------------------------------------------------------

describe('migrateOpenaiCatalogObject', () => {
  it('returns no change on null / non-object input', () => {
    for (const input of [null, undefined, 'str', 42, [1]]) {
      const result = migrateOpenaiCatalogObject(input as unknown)
      expect(result.changed).toBe(false)
    }
  })

  it('returns no change when providers key absent', () => {
    const obj = { generatedBy: 'openclaw-plugin-model-catalog-v1' }
    const result = migrateOpenaiCatalogObject(obj)
    expect(result.changed).toBe(false)
    expect(obj).toEqual({ generatedBy: 'openclaw-plugin-model-catalog-v1' })
  })

  it('returns no change when providers is not a plain object', () => {
    const obj = { providers: ['openai', 'openai-codex'] /* array, not object */ }
    const result = migrateOpenaiCatalogObject(obj)
    expect(result.changed).toBe(false)
  })

  it('returns no change when providers.openai-codex is absent', () => {
    const obj = {
      providers: { openai: { api: 'openai-responses', models: [{ id: 'gpt-5.5' }] } },
    }
    const result = migrateOpenaiCatalogObject(obj)
    expect(result.changed).toBe(false)
    expect(obj.providers.openai).toBeDefined()
  })

  it('removes providers.openai-codex when present alongside providers.openai', () => {
    const obj = {
      providers: {
        openai: { api: 'openai-responses', models: [{ id: 'gpt-5.5' }] },
        'openai-codex': { api: 'openai-codex-responses', models: [{ id: 'gpt-5.5' }] },
      },
    }
    const result = migrateOpenaiCatalogObject(obj)
    expect(result.changed).toBe(true)
    expect(obj.providers).toEqual({
      openai: { api: 'openai-responses', models: [{ id: 'gpt-5.5' }] },
    })
    expect(result.warnings).toHaveLength(1)
  })

  it('removes providers.openai-codex even when providers.openai missing (defensive)', () => {
    const obj = { providers: { 'openai-codex': { api: 'openai-codex-responses' } } }
    const result = migrateOpenaiCatalogObject(obj)
    expect(result.changed).toBe(true)
    expect(obj.providers).toEqual({})
  })

  it('leaves other unrelated provider entries alone', () => {
    const obj = {
      providers: {
        openai: { api: 'openai-responses' },
        'openai-codex': { api: 'openai-codex-responses' },
        google: { api: 'google-generative-ai' },
        ollama: { api: 'openai-responses', baseUrl: 'http://127.0.0.1:11434/v1' },
      },
    }
    migrateOpenaiCatalogObject(obj)
    expect(Object.keys(obj.providers).sort()).toEqual(['google', 'ollama', 'openai'])
  })

  it('is idempotent — re-running on clean state is a no-op', () => {
    const obj = { providers: { openai: { api: 'openai-responses' } } }
    const first = migrateOpenaiCatalogObject(obj)
    const second = migrateOpenaiCatalogObject(obj)
    expect(first.changed).toBe(false)
    expect(second.changed).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// runOpenaiCodexLegacyMigration — IO wrapper
// ---------------------------------------------------------------------------

describe('runOpenaiCodexLegacyMigration (IO)', () => {
  let tmpHome: string

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-migration-'))
  })

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  function seedAgent(agentId: string, files: { authProfiles?: any; openaiCatalog?: any }) {
    const agentDir = path.join(tmpHome, 'agents', agentId, 'agent')
    fs.mkdirSync(agentDir, { recursive: true })
    if (files.authProfiles !== undefined) {
      fs.writeFileSync(
        path.join(agentDir, 'auth-profiles.json'),
        JSON.stringify(files.authProfiles, null, 2),
        'utf8',
      )
    }
    if (files.openaiCatalog !== undefined) {
      const catalogDir = path.join(agentDir, 'plugins', 'openai')
      fs.mkdirSync(catalogDir, { recursive: true })
      fs.writeFileSync(
        path.join(catalogDir, 'catalog.json'),
        JSON.stringify(files.openaiCatalog, null, 2),
        'utf8',
      )
    }
  }

  it('returns zero counts when no agents dir exists', async () => {
    const summary = await runOpenaiCodexLegacyMigration(tmpHome)
    expect(summary.authProfilesMigrated).toBe(0)
    expect(summary.catalogEntriesRemoved).toBe(0)
  })

  it('returns zero counts when agents dir is empty', async () => {
    fs.mkdirSync(path.join(tmpHome, 'agents'), { recursive: true })
    const summary = await runOpenaiCodexLegacyMigration(tmpHome)
    expect(summary.authProfilesScanned).toBe(0)
    expect(summary.catalogsScanned).toBe(0)
  })

  it('migrates an auth-profiles.json with a legacy key', async () => {
    seedAgent('main', {
      authProfiles: {
        'openai-codex:u@e.com': { provider: 'openai-codex', type: 'oauth' },
        'openai:default': { provider: 'openai', type: 'api_key' },
      },
    })
    const summary = await runOpenaiCodexLegacyMigration(tmpHome)
    expect(summary.authProfilesMigrated).toBe(1)
    expect(summary.authProfilesScanned).toBe(1)
    const after = JSON.parse(
      fs.readFileSync(path.join(tmpHome, 'agents', 'main', 'agent', 'auth-profiles.json'), 'utf8'),
    )
    expect(after['openai-codex:u@e.com']).toBeUndefined()
    expect(after['openai:u@e.com']).toEqual({ provider: 'openai', type: 'oauth' })
    expect(after['openai:default']).toBeDefined()
  })

  it('writes a backup before rewriting', async () => {
    const original = {
      'openai-codex:u@e.com': { provider: 'openai-codex', type: 'oauth' },
    }
    seedAgent('main', { authProfiles: original })
    await runOpenaiCodexLegacyMigration(tmpHome)
    const backupPath = path.join(
      tmpHome,
      'agents',
      'main',
      'agent',
      'auth-profiles.json.pre-openai-codex-fix.bak',
    )
    expect(fs.existsSync(backupPath)).toBe(true)
    expect(JSON.parse(fs.readFileSync(backupPath, 'utf8'))).toEqual(original)
  })

  it('removes openai-codex provider from openai catalog.json', async () => {
    seedAgent('main', {
      openaiCatalog: {
        generatedBy: 'openclaw-plugin-model-catalog-v1',
        providers: {
          openai: { api: 'openai-responses', models: [{ id: 'gpt-5.5' }] },
          'openai-codex': { api: 'openai-codex-responses', models: [{ id: 'gpt-5.5' }] },
        },
      },
    })
    const summary = await runOpenaiCodexLegacyMigration(tmpHome)
    expect(summary.catalogEntriesRemoved).toBe(1)
    const after = JSON.parse(
      fs.readFileSync(
        path.join(tmpHome, 'agents', 'main', 'agent', 'plugins', 'openai', 'catalog.json'),
        'utf8',
      ),
    )
    expect(after.providers['openai-codex']).toBeUndefined()
    expect(after.providers['openai']).toBeDefined()
  })

  it('handles multiple agents in one pass', async () => {
    seedAgent('main', {
      authProfiles: { 'openai-codex:a@e.com': { provider: 'openai-codex' } },
      openaiCatalog: { providers: { 'openai-codex': {} } },
    })
    seedAgent('bed-time', {
      authProfiles: { 'openai-codex:b@e.com': { provider: 'openai-codex' } },
    })
    seedAgent('clean-agent', {
      authProfiles: { 'openai:c@e.com': { provider: 'openai' } },
    })
    const summary = await runOpenaiCodexLegacyMigration(tmpHome)
    expect(summary.authProfilesScanned).toBe(3)
    expect(summary.authProfilesMigrated).toBe(2)
    expect(summary.catalogsScanned).toBe(1)
    expect(summary.catalogEntriesRemoved).toBe(1)
  })

  it('is idempotent on a clean tree — zero changes second run', async () => {
    seedAgent('main', {
      authProfiles: { 'openai-codex:u@e.com': { provider: 'openai-codex' } },
      openaiCatalog: { providers: { 'openai-codex': {}, openai: {} } },
    })
    const first = await runOpenaiCodexLegacyMigration(tmpHome)
    expect(first.authProfilesMigrated).toBe(1)
    expect(first.catalogEntriesRemoved).toBe(1)
    const second = await runOpenaiCodexLegacyMigration(tmpHome)
    expect(second.authProfilesMigrated).toBe(0)
    expect(second.catalogEntriesRemoved).toBe(0)
  })

  it('leaves unreadable JSON files alone (no crash)', async () => {
    const agentDir = path.join(tmpHome, 'agents', 'main', 'agent')
    fs.mkdirSync(agentDir, { recursive: true })
    fs.writeFileSync(path.join(agentDir, 'auth-profiles.json'), '{not valid json', 'utf8')
    const summary = await runOpenaiCodexLegacyMigration(tmpHome)
    expect(summary.authProfilesScanned).toBe(1)
    expect(summary.authProfilesMigrated).toBe(0)
    // Original file untouched.
    expect(fs.readFileSync(path.join(agentDir, 'auth-profiles.json'), 'utf8')).toBe('{not valid json')
  })

  it('does not back up an already-clean file', async () => {
    seedAgent('main', {
      authProfiles: { 'openai:default': { provider: 'openai', type: 'api_key' } },
    })
    await runOpenaiCodexLegacyMigration(tmpHome)
    const backupPath = path.join(
      tmpHome,
      'agents',
      'main',
      'agent',
      'auth-profiles.json.pre-openai-codex-fix.bak',
    )
    expect(fs.existsSync(backupPath)).toBe(false)
  })

  it('preserves first-run backup across multiple migrations', async () => {
    const original = {
      'openai-codex:u@e.com': { provider: 'openai-codex', type: 'oauth' },
    }
    seedAgent('main', { authProfiles: original })
    await runOpenaiCodexLegacyMigration(tmpHome)

    // Now write a SECOND legacy profile and re-run.
    const filePath = path.join(tmpHome, 'agents', 'main', 'agent', 'auth-profiles.json')
    const current = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    current['openai-codex:second@e.com'] = { provider: 'openai-codex' }
    fs.writeFileSync(filePath, JSON.stringify(current, null, 2), 'utf8')

    await runOpenaiCodexLegacyMigration(tmpHome)

    // Backup should STILL be the original — not the post-first-run state.
    const backupPath = `${filePath}.pre-openai-codex-fix.bak`
    expect(JSON.parse(fs.readFileSync(backupPath, 'utf8'))).toEqual(original)
  })

  it('calls logger.addLog with a summary line when something is migrated', async () => {
    seedAgent('main', {
      authProfiles: { 'openai-codex:u@e.com': { provider: 'openai-codex' } },
    })
    const lines: string[] = []
    await runOpenaiCodexLegacyMigration(tmpHome, { addLog: (l) => lines.push(l) })
    expect(lines.some((l) => l.includes('openai-codex → openai legacy migration applied'))).toBe(
      true,
    )
  })

  it('does not call logger.addLog when nothing changes', async () => {
    seedAgent('main', {
      authProfiles: { 'openai:default': { provider: 'openai', type: 'api_key' } },
    })
    const lines: string[] = []
    await runOpenaiCodexLegacyMigration(tmpHome, { addLog: (l) => lines.push(l) })
    expect(lines).toEqual([])
  })
})
