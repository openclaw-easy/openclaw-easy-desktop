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
