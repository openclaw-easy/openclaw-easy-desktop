import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { WhisperServerManager } from './whisper-server-manager'

// Stub global fetch
const originalFetch = globalThis.fetch

/**
 * Access private members for testing.
 * The manager's health-check logic is fully encapsulated, so we reach in via
 * the same pattern the existing test suite uses (cast to `any`).
 */
function getPrivate(mgr: WhisperServerManager) {
  return mgr as any as {
    process: EventEmitter | null
    status: string
    lastError: string | undefined
    port: number
    installed: boolean
    healthPollTimer: ReturnType<typeof setInterval> | null
    waitForHealth: () => Promise<void>
    setStatus: (status: string, error?: string) => void
    stopHealthPoll: () => void
    mainWindow: any
  }
}

describe('WhisperServerManager', () => {
  let mgr: WhisperServerManager
  let priv: ReturnType<typeof getPrivate>

  beforeEach(() => {
    mgr = new WhisperServerManager()
    priv = getPrivate(mgr)
    // Silence console output in tests
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    // Clean up any leftover intervals
    priv.stopHealthPoll()
    vi.restoreAllMocks()
  })

  // ── getStatus / isRunning ───────────────────────────────────────

  describe('getStatus', () => {
    it('should return initial status as stopped', () => {
      const info = mgr.getStatus()
      expect(info.status).toBe('stopped')
      expect(info.installed).toBe(false)
    })

    it('should reflect status changes', () => {
      priv.setStatus('running')
      expect(mgr.getStatus().status).toBe('running')
      expect(mgr.isRunning()).toBe(true)
    })

    it('should include error message', () => {
      priv.setStatus('error', 'Something broke')
      const info = mgr.getStatus()
      expect(info.status).toBe('error')
      expect(info.error).toBe('Something broke')
    })
  })

  // ── waitForHealth ───────────────────────────────────────────────

  describe('waitForHealth', () => {
    it('should resolve when health endpoint returns ok', async () => {
      // Simulate a running process
      priv.process = new EventEmitter()
      priv.port = 9999

      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true })

      // waitForHealth uses setInterval; run with real timers but short poll
      const promise = priv.waitForHealth()
      await promise

      // waitForHealth() only resolves when /health returns ok — it does NOT
      // set status to 'running' (that happens later in start(), after probeModelReady).
      // Just verify it resolved without error.
    })

    it('should reject when process exits before becoming healthy', async () => {
      const fakeProcess = new EventEmitter()
      priv.process = fakeProcess
      priv.port = 9999

      // fetch always fails (server not ready)
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))

      const promise = priv.waitForHealth()

      // Simulate process crash after a short delay
      setTimeout(() => {
        fakeProcess.emit('close', 1)
      }, 100)

      await expect(promise).rejects.toThrow('Server process exited with code 1 before becoming healthy')
    })

    it('should not resolve or reject twice when process exits after health ok', async () => {
      const fakeProcess = new EventEmitter()
      priv.process = fakeProcess
      priv.port = 9999

      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true })

      const promise = priv.waitForHealth()
      await promise

      // Process exits after already settled — should not throw
      fakeProcess.emit('close', 0)
      // If settle guard failed, the reject would have thrown. Give a tick to verify.
      await new Promise(r => setTimeout(r, 50))
    })

    it('should clean up process close listener after health ok', async () => {
      const fakeProcess = new EventEmitter()
      priv.process = fakeProcess
      priv.port = 9999

      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true })

      await priv.waitForHealth()

      // The 'close' listener added by waitForHealth should have been removed
      expect(fakeProcess.listenerCount('close')).toBe(0)
    })

    it('should clean up process close listener after process exit', async () => {
      const fakeProcess = new EventEmitter()
      priv.process = fakeProcess
      priv.port = 9999

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))

      const promise = priv.waitForHealth()

      setTimeout(() => fakeProcess.emit('close', 1), 50)

      await expect(promise).rejects.toThrow()

      // Listener should be cleaned up
      expect(fakeProcess.listenerCount('close')).toBe(0)
    })

    it('should stop health poll timer on resolution', async () => {
      priv.process = new EventEmitter()
      priv.port = 9999

      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true })

      await priv.waitForHealth()

      expect(priv.healthPollTimer).toBeNull()
    })

    it('should handle null process gracefully (no close listener attached)', async () => {
      priv.process = null
      priv.port = 9999

      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true })

      // Should resolve without error even though there's no process to listen on
      await priv.waitForHealth()
    })
  })

  // ── stop ────────────────────────────────────────────────────────

  describe('stop', () => {
    it('should set status to stopped when no process exists', async () => {
      priv.process = null
      await mgr.stop()
      expect(mgr.getStatus().status).toBe('stopped')
    })
  })

  // ── getActivePort ───────────────────────────────────────────────

  describe('getActivePort', () => {
    it('should return default port initially', () => {
      expect(mgr.getActivePort()).toBe(8000)
    })

    it('should return updated port', () => {
      priv.port = 8001
      expect(mgr.getActivePort()).toBe(8001)
    })
  })
})
