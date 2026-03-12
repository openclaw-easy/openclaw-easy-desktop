import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { sanitizeConfigForBundled } from './config-sanitizer'

/** Create a real temp directory for each test — no fs mocking needed. */
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'config-sanitizer-test-'))
}

describe('sanitizeConfigForBundled', () => {
  let tmpDir: string
  let configPath: string
  let bundledDir: string

  beforeEach(() => {
    tmpDir = makeTempDir()
    configPath = path.join(tmpDir, 'openclaw.json')
    bundledDir = path.join(tmpDir, 'bundled')
    fs.mkdirSync(bundledDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // Helper: create a bundled plugin directory
  function addBundledPlugin(name: string) {
    fs.mkdirSync(path.join(bundledDir, name), { recursive: true })
  }

  // Helper: write config JSON
  function writeConfig(config: object) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
  }

  // Helper: read config JSON back
  function readConfig(): any {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'))
  }

  // ── Early exit ──────────────────────────────────────────────────────

  it('should return early when config file does not exist', async () => {
    // configPath not written — does not exist
    addBundledPlugin('telegram')
    await sanitizeConfigForBundled(configPath, bundledDir)
    expect(fs.existsSync(configPath)).toBe(false)
  })

  it('should return early when bundled dir does not exist', async () => {
    writeConfig({ plugins: { entries: { telegram: {} } } })
    const missingDir = path.join(tmpDir, 'nonexistent')
    await sanitizeConfigForBundled(configPath, missingDir)
    // Config should be untouched
    const config = readConfig()
    expect(config.plugins.entries.telegram).toBeDefined()
  })

  it('should return early when both paths are missing', async () => {
    const missingConfig = path.join(tmpDir, 'nope.json')
    const missingDir = path.join(tmpDir, 'nonexistent')
    await sanitizeConfigForBundled(missingConfig, missingDir)
    // No crash, no side effects
  })

  // ── Plugin entries ──────────────────────────────────────────────────

  it('should remove unavailable plugin entries', async () => {
    addBundledPlugin('telegram')
    writeConfig({
      plugins: {
        entries: {
          telegram: { enabled: true },
          matrix: { enabled: true },
          msteams: { enabled: true },
        },
      },
    })

    await sanitizeConfigForBundled(configPath, bundledDir)
    const config = readConfig()
    expect(config.plugins.entries).toEqual({ telegram: { enabled: true } })
  })

  it('should keep all entries when all plugins are available', async () => {
    addBundledPlugin('telegram')
    addBundledPlugin('discord')
    writeConfig({
      plugins: {
        entries: {
          telegram: { enabled: true },
          discord: { enabled: true },
        },
      },
    })

    await sanitizeConfigForBundled(configPath, bundledDir)
    const config = readConfig()
    expect(Object.keys(config.plugins.entries)).toEqual(['telegram', 'discord'])
  })

  it('should delete entries key when all entries are removed', async () => {
    writeConfig({
      plugins: {
        entries: { matrix: { enabled: true } },
      },
    })

    await sanitizeConfigForBundled(configPath, bundledDir)
    const config = readConfig()
    expect(config.plugins?.entries).toBeUndefined()
  })

  // ── Allow list ──────────────────────────────────────────────────────

  it('should filter allow list to available plugins', async () => {
    addBundledPlugin('telegram')
    writeConfig({
      plugins: {
        allow: ['telegram', 'matrix', 'msteams'],
      },
    })

    await sanitizeConfigForBundled(configPath, bundledDir)
    const config = readConfig()
    expect(config.plugins.allow).toEqual(['telegram'])
  })

  it('should remove allow list when empty after filtering', async () => {
    writeConfig({
      plugins: {
        allow: ['matrix', 'msteams'],
      },
    })

    await sanitizeConfigForBundled(configPath, bundledDir)
    const config = readConfig()
    expect(config.plugins?.allow).toBeUndefined()
  })

  // ── Deny list ──────────────────────────────────────────────────────

  it('should filter deny list to available plugins', async () => {
    addBundledPlugin('telegram')
    addBundledPlugin('discord')
    writeConfig({
      plugins: {
        deny: ['telegram', 'matrix'],
      },
    })

    await sanitizeConfigForBundled(configPath, bundledDir)
    const config = readConfig()
    expect(config.plugins.deny).toEqual(['telegram'])
  })

  it('should remove deny list when empty after filtering', async () => {
    writeConfig({
      plugins: {
        deny: ['matrix'],
      },
    })

    await sanitizeConfigForBundled(configPath, bundledDir)
    const config = readConfig()
    expect(config.plugins?.deny).toBeUndefined()
  })

  // ── Memory slot (THE REGRESSION) ───────────────────────────────────

  it('should set memory slot to "none" when memory-core is NOT bundled and slot is unset', async () => {
    addBundledPlugin('telegram')
    writeConfig({
      plugins: {
        entries: { telegram: {} },
      },
    })

    await sanitizeConfigForBundled(configPath, bundledDir)
    const config = readConfig()
    expect(config.plugins.slots.memory).toBe('none')
  })

  it('should set memory slot to "none" when memory-core is NOT bundled and slot is explicitly "memory-core"', async () => {
    addBundledPlugin('telegram')
    writeConfig({
      plugins: {
        entries: { telegram: {} },
        slots: { memory: 'memory-core' },
      },
    })

    await sanitizeConfigForBundled(configPath, bundledDir)
    const config = readConfig()
    expect(config.plugins.slots.memory).toBe('none')
  })

  it('should preserve memory slot when memory-core IS bundled', async () => {
    addBundledPlugin('memory-core')
    addBundledPlugin('telegram')
    writeConfig({
      plugins: {
        entries: { telegram: {}, 'memory-core': {} },
        slots: { memory: 'memory-core' },
      },
    })

    await sanitizeConfigForBundled(configPath, bundledDir)
    const config = readConfig()
    expect(config.plugins.slots.memory).toBe('memory-core')
  })

  it('should NOT override memory slot when it is a custom value and memory-core is not bundled', async () => {
    addBundledPlugin('telegram')
    addBundledPlugin('memory-custom')
    writeConfig({
      plugins: {
        entries: { telegram: {} },
        slots: { memory: 'memory-custom' },
      },
    })

    await sanitizeConfigForBundled(configPath, bundledDir)
    const config = readConfig()
    // memory-custom is available so it's kept; memory-core default override doesn't apply
    expect(config.plugins.slots.memory).toBe('memory-custom')
  })

  it('should remove memory slot pointing to unavailable plugin, then set "none" because memory-core is also not bundled', async () => {
    addBundledPlugin('telegram')
    writeConfig({
      plugins: {
        entries: { telegram: {} },
        slots: { memory: 'memory-custom' },
      },
    })

    await sanitizeConfigForBundled(configPath, bundledDir)
    const config = readConfig()
    // First: memory-custom is removed (not available)
    // Then: memory-core not bundled → set to "none"
    expect(config.plugins.slots.memory).toBe('none')
  })

  it('should handle empty config.plugins gracefully', async () => {
    addBundledPlugin('telegram')
    writeConfig({ plugins: {} })

    await sanitizeConfigForBundled(configPath, bundledDir)
    const config = readConfig()
    // memory-core not bundled → needs "none"
    expect(config.plugins.slots.memory).toBe('none')
  })

  it('should handle config with no plugins key', async () => {
    addBundledPlugin('telegram')
    writeConfig({ gateway: { port: 18800 } })

    await sanitizeConfigForBundled(configPath, bundledDir)
    const config = readConfig()
    expect(config.plugins.slots.memory).toBe('none')
    // gateway should be preserved
    expect(config.gateway.port).toBe(18800)
  })

  // ── Write behavior ─────────────────────────────────────────────────

  it('should NOT write config when nothing changed and memory-core IS bundled', async () => {
    addBundledPlugin('telegram')
    addBundledPlugin('memory-core')
    writeConfig({
      plugins: {
        entries: { telegram: {} },
      },
    })

    const mtimeBefore = fs.statSync(configPath).mtimeMs

    // Small delay to ensure mtime would change if file was rewritten
    await new Promise(r => setTimeout(r, 50))
    await sanitizeConfigForBundled(configPath, bundledDir)

    const mtimeAfter = fs.statSync(configPath).mtimeMs
    expect(mtimeAfter).toBe(mtimeBefore)
  })

  it('should produce valid JSON output after sanitization', async () => {
    addBundledPlugin('telegram')
    writeConfig({
      gateway: { port: 18800 },
      plugins: {
        entries: { matrix: {}, telegram: {} },
        allow: ['matrix', 'telegram'],
        deny: ['msteams'],
        slots: { memory: 'memory-core' },
      },
      agents: { list: [{ id: 'main' }] },
    })

    await sanitizeConfigForBundled(configPath, bundledDir)

    // Should not throw when re-parsed
    const config = readConfig()
    expect(config.gateway.port).toBe(18800)
    expect(config.agents.list).toHaveLength(1)
  })

  // ── Complex scenario ───────────────────────────────────────────────

  it('should handle a complex real-world config', async () => {
    addBundledPlugin('telegram')
    addBundledPlugin('discord')
    writeConfig({
      gateway: { mode: 'local', port: 18800 },
      plugins: {
        entries: {
          telegram: { enabled: true },
          discord: { enabled: true },
          matrix: { enabled: true },
          msteams: { enabled: true },
          zalo: { enabled: false },
        },
        allow: ['telegram', 'discord', 'matrix', 'zalo'],
        deny: ['msteams', 'zalo'],
        slots: { memory: 'memory-core' },
      },
      agents: {
        defaults: { model: { primary: 'google/gemini-2.5-flash' } },
        list: [{ id: 'main' }],
      },
    })

    const logs: string[] = []
    await sanitizeConfigForBundled(configPath, bundledDir, (msg) => logs.push(msg))

    const config = readConfig()

    // Entries: only telegram + discord kept
    expect(Object.keys(config.plugins.entries)).toEqual(['telegram', 'discord'])

    // Allow: only telegram + discord kept
    expect(config.plugins.allow).toEqual(['telegram', 'discord'])

    // Deny: all removed (msteams + zalo not available)
    expect(config.plugins.deny).toBeUndefined()

    // Memory slot: set to "none" (memory-core not bundled)
    expect(config.plugins.slots.memory).toBe('none')

    // Non-plugin config preserved
    expect(config.gateway.mode).toBe('local')
    expect(config.agents.defaults.model.primary).toBe('google/gemini-2.5-flash')

    // Log messages emitted
    expect(logs.some(l => l.includes('unavailable plugin'))).toBe(true)
    expect(logs.some(l => l.includes('memory-core not bundled'))).toBe(true)
  })

  it('should ignore non-directory entries in bundled dir', async () => {
    addBundledPlugin('telegram')
    // Create a file (not a directory) in the bundled dir
    fs.writeFileSync(path.join(bundledDir, 'readme.txt'), 'not a plugin')

    writeConfig({
      plugins: {
        entries: { telegram: {} },
      },
    })

    await sanitizeConfigForBundled(configPath, bundledDir)
    const config = readConfig()
    // telegram kept, readme.txt not treated as a plugin
    expect(config.plugins.entries.telegram).toBeDefined()
  })

  it('should call onLog with failure message on invalid JSON config', async () => {
    addBundledPlugin('telegram')
    fs.writeFileSync(configPath, '{ invalid json }}}')

    const logs: string[] = []
    await sanitizeConfigForBundled(configPath, bundledDir, (msg) => logs.push(msg))

    expect(logs.some(l => l.includes('Failed to sanitize config'))).toBe(true)
  })

  it('should handle empty bundled directory (no plugins available)', async () => {
    writeConfig({
      plugins: {
        entries: { telegram: {}, discord: {} },
        allow: ['telegram'],
        slots: { memory: 'memory-core' },
      },
    })

    await sanitizeConfigForBundled(configPath, bundledDir)
    const config = readConfig()

    // All entries removed, allow removed, memory set to "none"
    expect(config.plugins?.entries).toBeUndefined()
    expect(config.plugins?.allow).toBeUndefined()
    expect(config.plugins.slots.memory).toBe('none')
  })
})
