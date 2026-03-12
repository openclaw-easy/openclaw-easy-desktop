import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CronManager, AddCronJobParams } from './cron-manager'

/** Minimal mock of the OpenClawCommandExecutor injected via constructor. */
function createMockExecutor() {
  return {
    executeCommand: vi.fn<[string[], number?], Promise<string | null>>(),
  }
}

describe('CronManager', () => {
  let executor: ReturnType<typeof createMockExecutor>
  let cron: CronManager

  beforeEach(() => {
    executor = createMockExecutor()
    cron = new CronManager(executor as any)
  })

  // ── listCronJobs ───────────────────────────────────────────────────

  describe('listCronJobs', () => {
    it('should pass correct args to executor', async () => {
      executor.executeCommand.mockResolvedValue(JSON.stringify({ jobs: [] }))
      await cron.listCronJobs()
      expect(executor.executeCommand).toHaveBeenCalledWith(
        ['cron', 'list', '--json', '--all'],
        30000,
      )
    })

    it('should parse JSON response with jobs array', async () => {
      const jobs = [{ id: 'j1', name: 'test-job', enabled: true }]
      executor.executeCommand.mockResolvedValue(JSON.stringify({ jobs }))
      const result = await cron.listCronJobs()
      expect(result.success).toBe(true)
      expect(result.jobs).toEqual(jobs)
    })

    it('should handle top-level array response', async () => {
      const jobs = [{ id: 'j1' }]
      executor.executeCommand.mockResolvedValue(JSON.stringify(jobs))
      const result = await cron.listCronJobs()
      expect(result.success).toBe(true)
      expect(result.jobs).toEqual(jobs)
    })

    it('should handle null response', async () => {
      executor.executeCommand.mockResolvedValue(null)
      const result = await cron.listCronJobs()
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should handle executor errors', async () => {
      executor.executeCommand.mockRejectedValue(new Error('Command failed'))
      const result = await cron.listCronJobs()
      expect(result.success).toBe(false)
      expect(result.error).toContain('Command failed')
    })
  })

  // ── addCronJob ─────────────────────────────────────────────────────

  describe('addCronJob', () => {
    it('should build correct args for "every" schedule with message payload', async () => {
      executor.executeCommand.mockResolvedValue(JSON.stringify({ job: { id: 'j1' } }))
      const params: AddCronJobParams = {
        name: 'daily-check',
        scheduleKind: 'every',
        scheduleValue: '3600000',
        payloadKind: 'message',
        payloadValue: 'Hello world',
      }
      await cron.addCronJob(params)
      expect(executor.executeCommand).toHaveBeenCalledWith(
        ['cron', 'add', '--name', 'daily-check', '--every', '3600000', '--message', 'Hello world', '--json'],
        15000,
      )
    })

    it('should build correct args for "cron" schedule', async () => {
      executor.executeCommand.mockResolvedValue(JSON.stringify({ job: { id: 'j2' } }))
      const params: AddCronJobParams = {
        name: 'hourly',
        scheduleKind: 'cron',
        scheduleValue: '0 * * * *',
        payloadKind: 'message',
        payloadValue: 'check-in',
      }
      await cron.addCronJob(params)
      const args = executor.executeCommand.mock.calls[0][0]
      expect(args).toContain('--cron')
      expect(args).toContain('0 * * * *')
    })

    it('should build correct args for "at" schedule', async () => {
      executor.executeCommand.mockResolvedValue(JSON.stringify({ job: { id: 'j3' } }))
      const params: AddCronJobParams = {
        name: 'once',
        scheduleKind: 'at',
        scheduleValue: '2026-03-01T12:00:00Z',
        payloadKind: 'message',
        payloadValue: 'fire once',
      }
      await cron.addCronJob(params)
      const args = executor.executeCommand.mock.calls[0][0]
      expect(args).toContain('--at')
      expect(args).toContain('2026-03-01T12:00:00Z')
    })

    it('should build correct args for system-event payload', async () => {
      executor.executeCommand.mockResolvedValue(JSON.stringify({ job: { id: 'j4' } }))
      const params: AddCronJobParams = {
        name: 'system-check',
        scheduleKind: 'every',
        scheduleValue: '60000',
        payloadKind: 'system-event',
        payloadValue: 'health-check',
      }
      await cron.addCronJob(params)
      const args = executor.executeCommand.mock.calls[0][0]
      expect(args).toContain('--system-event')
      expect(args).toContain('health-check')
    })

    it('should include --agent flag when agentId is provided', async () => {
      executor.executeCommand.mockResolvedValue(JSON.stringify({ job: { id: 'j5' } }))
      const params: AddCronJobParams = {
        name: 'agent-task',
        scheduleKind: 'every',
        scheduleValue: '60000',
        payloadKind: 'message',
        payloadValue: 'run',
        agentId: 'custom-agent',
      }
      await cron.addCronJob(params)
      const args = executor.executeCommand.mock.calls[0][0]
      expect(args).toContain('--agent')
      expect(args).toContain('custom-agent')
    })

    it('should handle null response from executor', async () => {
      executor.executeCommand.mockResolvedValue(null)
      const params: AddCronJobParams = {
        name: 'test',
        scheduleKind: 'every',
        scheduleValue: '60000',
        payloadKind: 'message',
        payloadValue: 'test',
      }
      const result = await cron.addCronJob(params)
      expect(result.success).toBe(false)
    })
  })

  // ── enableCronJob ──────────────────────────────────────────────────

  describe('enableCronJob', () => {
    it('should pass correct args', async () => {
      executor.executeCommand.mockResolvedValue('')
      await cron.enableCronJob('job-123')
      expect(executor.executeCommand).toHaveBeenCalledWith(
        ['cron', 'enable', 'job-123', '--json'],
        15000,
      )
    })

    it('should return success on successful execution', async () => {
      executor.executeCommand.mockResolvedValue('')
      const result = await cron.enableCronJob('job-123')
      expect(result.success).toBe(true)
    })

    it('should return error on failure', async () => {
      executor.executeCommand.mockRejectedValue(new Error('not found'))
      const result = await cron.enableCronJob('job-123')
      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })
  })

  // ── disableCronJob ─────────────────────────────────────────────────

  describe('disableCronJob', () => {
    it('should pass correct args', async () => {
      executor.executeCommand.mockResolvedValue('')
      await cron.disableCronJob('job-456')
      expect(executor.executeCommand).toHaveBeenCalledWith(
        ['cron', 'disable', 'job-456', '--json'],
        15000,
      )
    })

    it('should return error on failure', async () => {
      executor.executeCommand.mockRejectedValue(new Error('timeout'))
      const result = await cron.disableCronJob('job-456')
      expect(result.success).toBe(false)
    })
  })

  // ── removeCronJob ──────────────────────────────────────────────────

  describe('removeCronJob', () => {
    it('should pass correct args', async () => {
      executor.executeCommand.mockResolvedValue('')
      await cron.removeCronJob('job-789')
      expect(executor.executeCommand).toHaveBeenCalledWith(
        ['cron', 'rm', 'job-789', '--json'],
        15000,
      )
    })
  })

  // ── runCronJob ─────────────────────────────────────────────────────

  describe('runCronJob', () => {
    it('should pass correct args (no --json)', async () => {
      executor.executeCommand.mockResolvedValue('')
      await cron.runCronJob('job-abc')
      expect(executor.executeCommand).toHaveBeenCalledWith(
        ['cron', 'run', 'job-abc'],
        30000,
      )
    })

    it('should return error on failure', async () => {
      executor.executeCommand.mockRejectedValue(new Error('job not found'))
      const result = await cron.runCronJob('job-abc')
      expect(result.success).toBe(false)
      expect(result.error).toContain('job not found')
    })
  })

  // ── getCronRuns ────────────────────────────────────────────────────

  describe('getCronRuns', () => {
    it('should pass correct args with default limit', async () => {
      executor.executeCommand.mockResolvedValue(JSON.stringify({ runs: [] }))
      await cron.getCronRuns('job-xyz')
      expect(executor.executeCommand).toHaveBeenCalledWith(
        ['cron', 'runs', '--id', 'job-xyz', '--limit', '10'],
        15000,
      )
    })

    it('should pass correct args with custom limit', async () => {
      executor.executeCommand.mockResolvedValue(JSON.stringify({ runs: [] }))
      await cron.getCronRuns('job-xyz', 50)
      expect(executor.executeCommand).toHaveBeenCalledWith(
        ['cron', 'runs', '--id', 'job-xyz', '--limit', '50'],
        15000,
      )
    })

    it('should parse runs from response', async () => {
      const runs = [{ id: 'r1', status: 'ok' }, { id: 'r2', status: 'error' }]
      executor.executeCommand.mockResolvedValue(JSON.stringify({ runs }))
      const result = await cron.getCronRuns('job-xyz')
      expect(result.success).toBe(true)
      expect(result.runs).toEqual(runs)
    })

    it('should handle null response', async () => {
      executor.executeCommand.mockResolvedValue(null)
      const result = await cron.getCronRuns('job-xyz')
      expect(result.success).toBe(false)
    })
  })
})
