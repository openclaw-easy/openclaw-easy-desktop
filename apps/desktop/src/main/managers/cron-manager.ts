import { OpenClawCommandExecutor } from './openclaw-command-executor'

export interface CronJobSchedule {
  kind: 'every' | 'cron' | 'at'
  everyMs?: number
  expr?: string
  tz?: string
  at?: string
}

export interface CronJobPayload {
  kind: 'message' | 'system-event'
  message?: string
  event?: string
}

export interface CronJob {
  id: string
  name: string
  description?: string
  enabled: boolean
  schedule: CronJobSchedule
  sessionTarget: 'main' | 'isolated'
  payload: CronJobPayload
  agentId?: string
  state: {
    nextRunAtMs?: number
    lastRunAtMs?: number
    lastStatus?: 'ok' | 'error' | 'skipped'
    lastError?: string
    lastDurationMs?: number
  }
  createdAtMs: number
}

export interface AddCronJobParams {
  name: string
  scheduleKind: 'every' | 'cron' | 'at'
  scheduleValue: string
  payloadKind: 'message' | 'system-event'
  payloadValue: string
  agentId?: string
}

/**
 * CronManager - Manages OpenClaw cron jobs (scheduled automation)
 */
export class CronManager {
  private executor: OpenClawCommandExecutor

  constructor(executor: OpenClawCommandExecutor) {
    this.executor = executor
  }

  async listCronJobs(): Promise<{ success: boolean; jobs?: CronJob[]; error?: string }> {
    try {
      console.log('[CronManager] Getting cron jobs list...')
      const result = await this.executor.executeCommand(['cron', 'list', '--json', '--all'], 30000)

      if (result) {
        const data = JSON.parse(result)
        const jobs = data.jobs || data || []
        return { success: true, jobs: Array.isArray(jobs) ? jobs : [] }
      }

      return { success: false, error: 'No cron jobs data received' }
    } catch (error: any) {
      console.error('[CronManager] Error listing cron jobs:', error)
      return { success: false, error: error.message || 'Failed to list cron jobs' }
    }
  }

  async addCronJob(params: AddCronJobParams): Promise<{ success: boolean; job?: CronJob; error?: string }> {
    try {
      console.log('[CronManager] Adding cron job:', params.name)

      const args = ['cron', 'add', '--name', params.name]

      // Schedule flag
      if (params.scheduleKind === 'every') {
        args.push('--every', params.scheduleValue)
      } else if (params.scheduleKind === 'cron') {
        args.push('--cron', params.scheduleValue)
      } else if (params.scheduleKind === 'at') {
        args.push('--at', params.scheduleValue)
      }

      // Payload flag
      if (params.payloadKind === 'message') {
        args.push('--message', params.payloadValue)
      } else if (params.payloadKind === 'system-event') {
        args.push('--system-event', params.payloadValue)
      }

      // Optional agent ID
      if (params.agentId) {
        args.push('--agent', params.agentId)
      }

      args.push('--json')

      const result = await this.executor.executeCommand(args, 15000)

      if (result) {
        const data = JSON.parse(result)
        return { success: true, job: data.job || data }
      }

      return { success: false, error: 'No response from cron add command' }
    } catch (error: any) {
      console.error('[CronManager] Error adding cron job:', error)
      return { success: false, error: error.message || 'Failed to add cron job' }
    }
  }

  async enableCronJob(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`[CronManager] Enabling cron job: ${id}`)
      await this.executor.executeCommand(['cron', 'enable', id, '--json'], 15000)
      return { success: true }
    } catch (error: any) {
      console.error(`[CronManager] Error enabling cron job ${id}:`, error)
      return { success: false, error: error.message || 'Failed to enable cron job' }
    }
  }

  async disableCronJob(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`[CronManager] Disabling cron job: ${id}`)
      await this.executor.executeCommand(['cron', 'disable', id, '--json'], 15000)
      return { success: true }
    } catch (error: any) {
      console.error(`[CronManager] Error disabling cron job ${id}:`, error)
      return { success: false, error: error.message || 'Failed to disable cron job' }
    }
  }

  async removeCronJob(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`[CronManager] Removing cron job: ${id}`)
      await this.executor.executeCommand(['cron', 'rm', id, '--json'], 15000)
      return { success: true }
    } catch (error: any) {
      console.error(`[CronManager] Error removing cron job ${id}:`, error)
      return { success: false, error: error.message || 'Failed to remove cron job' }
    }
  }

  async runCronJob(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`[CronManager] Running cron job: ${id}`)
      await this.executor.executeCommand(['cron', 'run', id], 30000)
      return { success: true }
    } catch (error: any) {
      console.error(`[CronManager] Error running cron job ${id}:`, error)
      return { success: false, error: error.message || 'Failed to run cron job' }
    }
  }

  async getCronRuns(id: string, limit: number = 10): Promise<{ success: boolean; runs?: any[]; error?: string }> {
    try {
      console.log(`[CronManager] Getting runs for cron job: ${id}`)
      const result = await this.executor.executeCommand(
        ['cron', 'runs', '--id', id, '--limit', String(limit)],
        15000
      )

      if (result) {
        const data = JSON.parse(result)
        const runs = data.runs || data || []
        return { success: true, runs: Array.isArray(runs) ? runs : [] }
      }

      return { success: false, error: 'No runs data received' }
    } catch (error: any) {
      console.error(`[CronManager] Error getting runs for cron job ${id}:`, error)
      return { success: false, error: error.message || 'Failed to get cron job runs' }
    }
  }
}
