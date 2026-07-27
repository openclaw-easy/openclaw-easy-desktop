import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as realOs from 'os'

let mockHome: string

// Mock electron
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
}))

// Mock os so homedir() returns our temp dir
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  return {
    ...actual,
    default: { ...actual, homedir: () => mockHome },
    homedir: () => mockHome,
  }
})

import { SkillsManager } from './skills-manager'

describe('SkillsManager', () => {
  let tmpDir: string
  let skillsDir: string
  let agentsDir: string
  let mgr: SkillsManager
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(realOs.tmpdir(), 'skills-manager-test-'))
    skillsDir = path.join(tmpDir, '.openclaw', 'skills')
    agentsDir = path.join(tmpDir, '.openclaw', 'agents')
    fs.mkdirSync(skillsDir, { recursive: true })

    mockHome = tmpDir
    process.env.HOME = tmpDir

    // Create manager with mocked deps
    const mockExecutor = { executeCommand: vi.fn() } as any
    const mockConfigManager = { loadConfig: vi.fn(), saveConfig: vi.fn() } as any
    mgr = new SkillsManager(mockExecutor, mockConfigManager)
  })

  // ── checkSkills / updateAllSkills (CLI delegates) ────────────────────
  // These were added after the 2026-06-15 ClawHub-docs audit so the
  // desktop matches the documented CLI surface (`skills check`,
  // `skills update --all`).
  describe('checkSkills', () => {
    it('runs `skills check --json` and parses the report', async () => {
      const fakeReport = {
        agentId: 'main',
        workspaceDir: '/x',
        summary: { eligible: 5, blocked: 1 },
        eligible: ['a', 'b'],
        blocked: ['c'],
        missingRequirements: [],
      }
      const exec = (mgr as any).executor.executeCommand as any
      exec.mockResolvedValue(JSON.stringify(fakeReport))
      const result = await mgr.checkSkills()
      expect(exec).toHaveBeenCalledWith(['skills', 'check', '--json'], 30000)
      expect(result.success).toBe(true)
      expect(result.report).toEqual(fakeReport)
    })

    it('passes --agent when supplied so agent-scoped skills resolve', async () => {
      const exec = (mgr as any).executor.executeCommand as any
      exec.mockResolvedValue('{}')
      await mgr.checkSkills('helper')
      expect(exec).toHaveBeenCalledWith(['skills', 'check', '--json', '--agent', 'helper'], 30000)
    })

    it('returns success:false with the error message when the CLI throws', async () => {
      const exec = (mgr as any).executor.executeCommand as any
      exec.mockRejectedValue(new Error('gateway down'))
      const result = await mgr.checkSkills()
      expect(result.success).toBe(false)
      expect(result.error).toBe('gateway down')
    })
  })

  describe('updateAllSkills', () => {
    it('runs `skills update --all` and returns the captured output', async () => {
      const exec = (mgr as any).executor.executeCommand as any
      exec.mockResolvedValue('Updated 3 skills')
      const result = await mgr.updateAllSkills()
      expect(exec).toHaveBeenCalledWith(['skills', 'update', '--all'], 300_000)
      expect(result).toEqual({ success: true, output: 'Updated 3 skills' })
    })

    it('returns success:false when the CLI produces no output (null/undefined)', async () => {
      const exec = (mgr as any).executor.executeCommand as any
      exec.mockResolvedValue(null)
      const result = await mgr.updateAllSkills()
      expect(result.success).toBe(false)
    })
  })

  // ── getSkillInfo timeout + --agent flag (audit fixes) ───────────────
  describe('getSkillInfo', () => {
    it('uses a 30s timeout (was 10s default, bumped to match listSkills)', async () => {
      const exec = (mgr as any).executor.executeCommand as any
      exec.mockResolvedValue('{}')
      await mgr.getSkillInfo('foo')
      expect(exec).toHaveBeenCalledWith(['skills', 'info', 'foo', '--json'], 30000)
    })

    it('passes --agent when supplied', async () => {
      const exec = (mgr as any).executor.executeCommand as any
      exec.mockResolvedValue('{}')
      await mgr.getSkillInfo('foo', 'main')
      expect(exec).toHaveBeenCalledWith(
        ['skills', 'info', 'foo', '--json', '--agent', 'main'],
        30000,
      )
    })
  })

  // ── installFromRegistry now uses `openclaw skills install` ──────────
  // The previous implementation spawned `bun x clawhub@latest install`
  // which works but diverges from the documented CLI and pays a cold-
  // start tax. The new path delegates to the shared executor; failures
  // still fall through to the backend S3 proxy.
  describe('installFromRegistry', () => {
    it('rejects an invalid slug before calling the executor', async () => {
      const exec = (mgr as any).executor.executeCommand as any
      const result = await mgr.installFromRegistry('../etc/passwd')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid skill slug')
      expect(exec).not.toHaveBeenCalled()
    })

    it('runs `skills install <slug> --force` and returns success on clean output', async () => {
      const exec = (mgr as any).executor.executeCommand as any
      exec.mockResolvedValue('Installed gifgrep@1.2.3')
      const result = await mgr.installFromRegistry('gifgrep')
      expect(exec).toHaveBeenCalledWith(['skills', 'install', 'gifgrep', '--force'], 90_000)
      expect(result).toEqual({ success: true, output: 'Installed gifgrep@1.2.3' })
    })

    it('returns the "Skill not found" sentinel without falling through to the proxy', async () => {
      const exec = (mgr as any).executor.executeCommand as any
      exec.mockResolvedValue('Error: Skill not found in the registry')
      const proxySpy = vi.spyOn(mgr as any, '_installViaProxy')
      const result = await mgr.installFromRegistry('nonexistent')
      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
      expect(proxySpy).not.toHaveBeenCalled()
      proxySpy.mockRestore()
    })

    it('accepts owner-prefixed slugs (e.g. "steipete/gifgrep")', async () => {
      const exec = (mgr as any).executor.executeCommand as any
      exec.mockResolvedValue('Installed')
      const result = await mgr.installFromRegistry('steipete/gifgrep')
      expect(exec).toHaveBeenCalledWith(
        ['skills', 'install', 'steipete/gifgrep', '--force'],
        90_000,
      )
      expect(result.success).toBe(true)
    })

    it('falls through to the proxy when CLI output includes "rate limit exceeded"', async () => {
      const exec = (mgr as any).executor.executeCommand as any
      exec.mockResolvedValue('Rate limit exceeded — retry later')
      const proxySpy = vi
        .spyOn(mgr as any, '_installViaProxy')
        .mockResolvedValue({ success: true, output: 'Installed via proxy' })
      const result = await mgr.installFromRegistry('gifgrep')
      expect(proxySpy).toHaveBeenCalledWith('gifgrep')
      expect(result).toEqual({ success: true, output: 'Installed via proxy' })
      proxySpy.mockRestore()
    })
  })

  // ── searchRegistry now uses /api/v1/search for non-empty queries ────
  describe('searchRegistry', () => {
    afterEach(() => vi.restoreAllMocks())

    it('hits /api/v1/search?q=<query> when given a non-empty query', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            { slug: 'gifgrep', displayName: 'GifGrep', summary: 'find gifs', version: '1.0.0' },
          ],
        }),
      } as any)
      const result = await mgr.searchRegistry('gif')
      expect(result.success).toBe(true)
      expect(result.skills).toHaveLength(1)
      expect(result.skills?.[0].slug).toBe('gifgrep')
      const calledUrl = String((fetchSpy.mock.calls[0] || [])[0] || '')
      expect(calledUrl).toContain('/api/v1/search')
      expect(calledUrl).toContain('q=gif')
    })

    it('caches identical queries within the 2-minute TTL (single fetch for two calls)', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ results: [{ slug: 'a', displayName: 'A', summary: '' }] }),
      } as any)
      await mgr.searchRegistry('xyz')
      await mgr.searchRegistry('xyz')
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('handles 429 from the search endpoint by throwing and falling back to filtered browse cache', async () => {
      // First fetch (search) returns 429. Second fetch (browse) succeeds.
      let call = 0
      vi.spyOn(global, 'fetch').mockImplementation(async () => {
        call++
        if (call === 1) {
          return { ok: false, status: 429, text: async () => 'rate limit' } as any
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                slug: 'gifgrep',
                displayName: 'GifGrep',
                summary: 'find gifs',
                stats: { downloads: 100, stars: 5 },
                latestVersion: { version: '1.0.0' },
              },
            ],
            nextCursor: null,
          }),
        } as any
      })
      const result = await mgr.searchRegistry('gif')
      expect(result.success).toBe(true)
      expect(result.skills?.[0].slug).toBe('gifgrep')
    })

    it('empty query → browse mode (calls /api/v1/skills, not /api/v1/search)', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ items: [], nextCursor: null }),
      } as any)
      await mgr.searchRegistry('')
      const calledUrl = String((fetchSpy.mock.calls[0] || [])[0] || '')
      expect(calledUrl).toContain('/api/v1/skills')
      expect(calledUrl).not.toContain('/api/v1/search')
    })
  })

  afterEach(() => {
    process.env.HOME = originalHome
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ── removeSkill ─────────────────────────────────────────────────────

  describe('removeSkill', () => {
    it('should reject invalid skill names', async () => {
      const result = await mgr.removeSkill('')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid skill name')
    })

    it('should reject names with path traversal characters', async () => {
      const result = await mgr.removeSkill('../etc')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid skill name')
    })

    // SLUG_REGEX tightening (matches backend skills-download.ts). The old
    // regex `[a-zA-Z0-9_.-]+` accepted `..` and `.`, letting a malicious
    // slug escape `~/.openclaw/skills/` via path.join.
    it.each([
      ['..',          'bare double-dot'],
      ['.',           'bare dot'],
      ['foo.bar',     'dot in the middle'],
      ['-leading',    'leading hyphen'],
      ['_leading',    'leading underscore'],
      ['Mixed-Case',  'uppercase letter'],
      ['has spaces',  'space character'],
    ])('should reject slug %s (%s)', async (badSlug) => {
      const result = await mgr.removeSkill(badSlug)
      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid skill name')
    })

    it('should remove skill by direct directory name match', async () => {
      const dir = path.join(skillsDir, 'my-skill')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'SKILL.md'), 'name: my-skill\n')

      const result = await mgr.removeSkill('my-skill')
      expect(result.success).toBe(true)
      expect(fs.existsSync(dir)).toBe(false)
    })

    it('should remove skill by SKILL.md name: field when directory slug differs', async () => {
      // Directory is "youtube-api-skill" but SKILL.md says name: youtube
      const dir = path.join(skillsDir, 'youtube-api-skill')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'SKILL.md'), 'name: youtube\ndescription: YouTube API\n')

      const result = await mgr.removeSkill('youtube')
      expect(result.success).toBe(true)
      expect(fs.existsSync(dir)).toBe(false)
    })

    it('should not remove other skills when scanning by name', async () => {
      const keepDir = path.join(skillsDir, 'other-skill')
      fs.mkdirSync(keepDir, { recursive: true })
      fs.writeFileSync(path.join(keepDir, 'SKILL.md'), 'name: other\n')

      const targetDir = path.join(skillsDir, 'target-slug')
      fs.mkdirSync(targetDir, { recursive: true })
      fs.writeFileSync(path.join(targetDir, 'SKILL.md'), 'name: target\n')

      const result = await mgr.removeSkill('target')
      expect(result.success).toBe(true)
      expect(fs.existsSync(targetDir)).toBe(false)
      expect(fs.existsSync(keepDir)).toBe(true)
    })

    it('should return error for bundled/missing skills', async () => {
      const result = await mgr.removeSkill('nonexistent-skill')
      expect(result.success).toBe(false)
      expect(result.error).toContain('bundled skill')
    })
  })

  // ── clearSkillsSnapshots ────────────────────────────────────────────

  describe('clearSkillsSnapshots', () => {
    it('should clear skillsSnapshot from all session entries', async () => {
      const sessionsDir = path.join(agentsDir, 'main', 'sessions')
      fs.mkdirSync(sessionsDir, { recursive: true })
      const storePath = path.join(sessionsDir, 'sessions.json')

      const store = {
        'session-1': { skillsSnapshot: { version: '1.0' }, other: 'data' },
        'session-2': { skillsSnapshot: { version: '1.0' } },
        'session-3': { noSnapshot: true },
      }
      fs.writeFileSync(storePath, JSON.stringify(store))

      await mgr.clearSkillsSnapshots()

      const updated = JSON.parse(fs.readFileSync(storePath, 'utf8'))
      expect(updated['session-1'].skillsSnapshot).toBeUndefined()
      expect(updated['session-1'].other).toBe('data')
      expect(updated['session-2'].skillsSnapshot).toBeUndefined()
      expect(updated['session-3'].noSnapshot).toBe(true)
    })

    it('should not crash when agents directory does not exist', async () => {
      // agentsDir not created — should silently return
      await expect(mgr.clearSkillsSnapshots()).resolves.toBeUndefined()
    })

    it('should skip agents with no sessions.json', async () => {
      const agentDir = path.join(agentsDir, 'main', 'sessions')
      fs.mkdirSync(agentDir, { recursive: true })
      // No sessions.json file
      await expect(mgr.clearSkillsSnapshots()).resolves.toBeUndefined()
    })

    it('should handle multiple agent directories', async () => {
      for (const agentId of ['agent-a', 'agent-b']) {
        const sessionsDir = path.join(agentsDir, agentId, 'sessions')
        fs.mkdirSync(sessionsDir, { recursive: true })
        fs.writeFileSync(
          path.join(sessionsDir, 'sessions.json'),
          JSON.stringify({ s1: { skillsSnapshot: { v: 1 } } })
        )
      }

      await mgr.clearSkillsSnapshots()

      for (const agentId of ['agent-a', 'agent-b']) {
        const data = JSON.parse(
          fs.readFileSync(path.join(agentsDir, agentId, 'sessions', 'sessions.json'), 'utf8')
        )
        expect(data.s1.skillsSnapshot).toBeUndefined()
      }
    })
  })
})
