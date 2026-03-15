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

describe('ConfigManager', () => {
  let tmpDir: string
  let configDir: string
  let configPath: string
  let logger: Logger
  let mgr: ConfigManager

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-manager-test-'))
    mockHome = tmpDir
    configDir = path.join(tmpDir, '.openclaw')
    configPath = path.join(configDir, 'openclaw.json')
    fs.mkdirSync(configDir, { recursive: true })

    logger = new Logger()
    mgr = new ConfigManager(logger)
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
      expect(config.agents.list).toEqual([{ id: 'main' }])
      expect(config.agents.defaults).toBeDefined()
      expect(config.agents.defaults.model).toBeDefined()
    })

    it('should ensure default "main" agent in empty agents.list', async () => {
      await mgr.writeConfig({ agents: { list: [] } })
      const config = readConfig()
      expect(config.agents.list).toEqual([{ id: 'main' }])
    })

    it('should preserve existing agents.list', async () => {
      await mgr.writeConfig({
        agents: {
          list: [{ id: 'custom-agent', tools: { allow: ['web_fetch'] } }],
          defaults: { model: { primary: 'google/gemini-2.5-flash' } },
        },
      })
      const config = readConfig()
      expect(config.agents.list).toHaveLength(1)
      expect(config.agents.list[0].id).toBe('custom-agent')
    })

    // ── Provider/model mismatch repair ─────────────────────────────

    it('should fix Gemini model with wrong provider (anthropic/gemini → google/gemini)', async () => {
      await mgr.writeConfig({
        agents: {
          defaults: { model: { primary: 'anthropic/gemini-flash-latest' } },
        },
      })
      const config = readConfig()
      expect(config.agents.defaults.model.primary).toBe('google/gemini-flash-latest')
    })

    it('should fix Claude model with wrong provider (google/claude → anthropic/claude)', async () => {
      await mgr.writeConfig({
        agents: {
          defaults: { model: { primary: 'google/claude-sonnet-4-5' } },
        },
      })
      const config = readConfig()
      expect(config.agents.defaults.model.primary).toBe('anthropic/claude-sonnet-4-5')
    })

    it('should fix GPT model with wrong provider (anthropic/gpt → openai/gpt)', async () => {
      await mgr.writeConfig({
        agents: {
          defaults: { model: { primary: 'anthropic/gpt-4o' } },
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

    it('should repair gateway.mode when gateway exists but mode missing', async () => {
      await mgr.writeConfig({ gateway: { port: 18800 } })
      const config = readConfig()
      expect(config.gateway.mode).toBe('local')
      expect(config.gateway.port).toBe(18800)
    })
  })

  // ── validateApiKey ─────────────────────────────────────────────────

  describe('validateApiKey', () => {
    it('should reject Anthropic key without sk-ant- prefix', async () => {
      expect(await mgr.validateApiKey('anthropic', 'invalid-key-123')).toBe(false)
    })

    it('should accept valid Anthropic key', async () => {
      expect(await mgr.validateApiKey('anthropic', 'sk-ant-abcdef123456')).toBe(true)
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

    it('should remove plugins.entries to prevent duplicates', async () => {
      writeConfig({
        plugins: {
          entries: { telegram: { enabled: true } },
        },
      })
      await mgr.ensureToolsConfigured()
      const config = readConfig()
      expect(config.plugins?.entries).toBeUndefined()
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
      const tools = config.agents.list[0].tools.allow
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
      const tools = config.agents.list[0].tools.allow
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
      const tools = config.agents.list[0].tools.allow
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
      const tools = config.agents.list[0].tools.allow
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
      const tools = config.agents.list[0].tools.allow
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
})
