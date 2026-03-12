import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SttManager, type SttConfig } from './stt-manager'

// Stub global fetch — restored after each test
const originalFetch = globalThis.fetch

describe('SttManager', () => {
  let mgr: SttManager
  const dummyAudio = Buffer.from('fake-audio-data')

  beforeEach(() => {
    mgr = new SttManager()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = originalFetch
  })

  // ── Provider routing ────────────────────────────────────────────

  describe('transcribe', () => {
    it('should return error for unknown provider', async () => {
      const result = await mgr.transcribe(dummyAudio, { provider: 'unknown' as any })
      expect(result.success).toBe(false)
      expect(result.error).toContain('Unknown STT provider')
    })

    it('should return error when OpenAI key is missing', async () => {
      const result = await mgr.transcribe(dummyAudio, { provider: 'openai' })
      expect(result.success).toBe(false)
      expect(result.error).toContain('API key not configured')
    })

    it('should return error when Google key is missing', async () => {
      const result = await mgr.transcribe(dummyAudio, { provider: 'google' })
      expect(result.success).toBe(false)
      expect(result.error).toContain('API key not configured')
    })
  })

  // ── OpenAI transcription ────────────────────────────────────────

  describe('transcribeOpenAI', () => {
    const config: SttConfig = { provider: 'openai', openaiApiKey: 'sk-test-key' }

    it('should return transcript on success', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('  Hello world  '),
      })

      const result = await mgr.transcribe(dummyAudio, config)
      expect(result.success).toBe(true)
      expect(result.transcript).toBe('Hello world')
    })

    it('should return error on non-ok response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      })

      const result = await mgr.transcribe(dummyAudio, config)
      expect(result.success).toBe(false)
      expect(result.error).toContain('401')
    })

    it('should pass abort signal to fetch', async () => {
      let capturedSignal: AbortSignal | undefined
      globalThis.fetch = vi.fn().mockImplementation((_url: string, opts: any) => {
        capturedSignal = opts?.signal
        return Promise.resolve({ ok: true, text: () => Promise.resolve('ok') })
      })

      await mgr.transcribe(dummyAudio, config)
      expect(capturedSignal).toBeInstanceOf(AbortSignal)
    })

    it('should return timeout error when fetch is aborted', async () => {
      const abortError = new DOMException('The operation was aborted', 'AbortError')
      globalThis.fetch = vi.fn().mockRejectedValue(abortError)

      const result = await mgr.transcribe(dummyAudio, config)
      expect(result.success).toBe(false)
      expect(result.error).toContain('timed out after 30 seconds')
    })

    it('should return generic error for non-abort failures', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))

      const result = await mgr.transcribe(dummyAudio, config)
      expect(result.success).toBe(false)
      expect(result.error).toContain('ECONNREFUSED')
    })
  })

  // ── Google transcription ────────────────────────────────────────

  describe('transcribeGoogle', () => {
    const config: SttConfig = { provider: 'google', googleApiKey: 'AIzaSy-test-key' }

    it('should return transcript on success', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          results: [
            { alternatives: [{ transcript: 'Hello from Google' }] },
          ],
        }),
      })

      const result = await mgr.transcribe(dummyAudio, config)
      expect(result.success).toBe(true)
      expect(result.transcript).toBe('Hello from Google')
    })

    it('should join multiple result segments', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          results: [
            { alternatives: [{ transcript: 'Hello' }] },
            { alternatives: [{ transcript: 'world' }] },
          ],
        }),
      })

      const result = await mgr.transcribe(dummyAudio, config)
      expect(result.success).toBe(true)
      expect(result.transcript).toBe('Hello world')
    })

    it('should return empty transcript when no results', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      })

      const result = await mgr.transcribe(dummyAudio, config)
      expect(result.success).toBe(true)
      expect(result.transcript).toBe('')
    })

    it('should return error on non-ok response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Bad Request'),
      })

      const result = await mgr.transcribe(dummyAudio, config)
      expect(result.success).toBe(false)
      expect(result.error).toContain('400')
    })

    it('should return specific error for SERVICE_DISABLED', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('SERVICE_DISABLED: Cloud Speech-to-Text API has not been enabled'),
      })

      const result = await mgr.transcribe(dummyAudio, config)
      expect(result.success).toBe(false)
      expect(result.error).toContain('not enabled')
    })

    it('should return specific error for 403 without SERVICE_DISABLED', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden'),
      })

      const result = await mgr.transcribe(dummyAudio, config)
      expect(result.success).toBe(false)
      expect(result.error).toContain('lacks permission')
    })

    it('should pass abort signal to fetch', async () => {
      let capturedSignal: AbortSignal | undefined
      globalThis.fetch = vi.fn().mockImplementation((_url: string, opts: any) => {
        capturedSignal = opts?.signal
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ results: [] }),
        })
      })

      await mgr.transcribe(dummyAudio, config)
      expect(capturedSignal).toBeInstanceOf(AbortSignal)
    })

    it('should return timeout error when fetch is aborted', async () => {
      const abortError = new DOMException('The operation was aborted', 'AbortError')
      globalThis.fetch = vi.fn().mockRejectedValue(abortError)

      const result = await mgr.transcribe(dummyAudio, config)
      expect(result.success).toBe(false)
      expect(result.error).toContain('timed out after 30 seconds')
    })
  })

  // ── Local Whisper transcription ─────────────────────────────────

  describe('transcribeLocal', () => {
    const config: SttConfig = { provider: 'local', localEndpoint: 'http://127.0.0.1:8000' }

    it('should return transcript on success', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: '  Local transcript  ' }),
      })

      const result = await mgr.transcribe(dummyAudio, config)
      expect(result.success).toBe(true)
      expect(result.transcript).toBe('Local transcript')
    })

    it('should use default endpoint when not specified', async () => {
      let capturedUrl: string | undefined
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        capturedUrl = url
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ text: 'ok' }),
        })
      })

      await mgr.transcribe(dummyAudio, { provider: 'local' })
      expect(capturedUrl).toContain('127.0.0.1:8000')
    })

    it('should replace localhost with 127.0.0.1', async () => {
      let capturedUrl: string | undefined
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        capturedUrl = url
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ text: 'ok' }),
        })
      })

      await mgr.transcribe(dummyAudio, { provider: 'local', localEndpoint: 'http://localhost:9000' })
      expect(capturedUrl).toContain('127.0.0.1:9000')
      expect(capturedUrl).not.toContain('localhost')
    })

    it('should return ECONNREFUSED-specific error', async () => {
      const err = new Error('fetch failed')
      ;(err as any).code = 'ECONNREFUSED'
      globalThis.fetch = vi.fn().mockRejectedValue(err)

      const result = await mgr.transcribe(dummyAudio, config)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Cannot connect to Whisper server')
    })

    it('should return ECONNREFUSED-specific error via cause', async () => {
      const cause = new Error('connect ECONNREFUSED')
      ;(cause as any).code = 'ECONNREFUSED'
      const err = new Error('fetch failed')
      ;(err as any).cause = cause
      globalThis.fetch = vi.fn().mockRejectedValue(err)

      const result = await mgr.transcribe(dummyAudio, config)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Cannot connect to Whisper server')
    })
  })
})
