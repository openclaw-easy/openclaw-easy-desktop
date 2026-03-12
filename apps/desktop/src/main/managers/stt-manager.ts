export interface SttConfig {
  provider: 'local' | 'openai' | 'google'
  openaiApiKey?: string
  googleApiKey?: string
  localEndpoint?: string  // e.g. 'http://localhost:8000'
  localModel?: string     // e.g. 'Systran/faster-whisper-large-v3'
}

interface TranscribeResult {
  success: boolean
  transcript?: string
  error?: string
}

const DEFAULT_LOCAL_ENDPOINT = 'http://localhost:8000'

/**
 * Speech-to-Text manager that sends audio to configurable backends.
 * Runs in the main process to avoid CORS and keep API keys secure.
 */
export class SttManager {
  async transcribe(audioBuffer: Buffer, config: SttConfig): Promise<TranscribeResult> {
    switch (config.provider) {
      case 'openai':
        return this.transcribeOpenAI(audioBuffer, config.openaiApiKey)
      case 'google':
        return this.transcribeGoogle(audioBuffer, config.googleApiKey)
      case 'local':
        return this.transcribeLocal(audioBuffer, config.localEndpoint, config.localModel)
      default:
        return { success: false, error: `Unknown STT provider: ${config.provider}` }
    }
  }

  /**
   * OpenAI Whisper API — POST multipart form to /v1/audio/transcriptions
   */
  private async transcribeOpenAI(audioBuffer: Buffer, apiKey?: string): Promise<TranscribeResult> {
    if (!apiKey) {
      return { success: false, error: 'OpenAI API key not configured. Set it up in AI Config > Voice.' }
    }

    try {
      const boundary = `----FormBoundary${Date.now()}`
      const parts: Buffer[] = []

      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.webm"\r\nContent-Type: audio/webm\r\n\r\n`
      ))
      parts.push(audioBuffer)
      parts.push(Buffer.from('\r\n'))

      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`
      ))

      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\ntext\r\n`
      ))

      parts.push(Buffer.from(`--${boundary}--\r\n`))

      const body = Buffer.concat(parts)

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30_000)

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[SttManager] OpenAI error:', response.status, errorText)
        return { success: false, error: `OpenAI API error (${response.status}): ${errorText}` }
      }

      const transcript = (await response.text()).trim()
      return { success: true, transcript }
    } catch (err: any) {
      console.error('[SttManager] OpenAI transcription failed:', err)
      if (err.name === 'AbortError') {
        return { success: false, error: 'OpenAI API request timed out after 30 seconds' }
      }
      return { success: false, error: err.message || 'Failed to reach OpenAI API' }
    }
  }

  /**
   * Google Cloud Speech-to-Text v1 — POST base64-encoded audio
   */
  private async transcribeGoogle(audioBuffer: Buffer, apiKey?: string): Promise<TranscribeResult> {
    if (!apiKey) {
      return { success: false, error: 'Google Cloud API key not configured. Set it up in AI Config > Voice.' }
    }

    try {
      const body = JSON.stringify({
        config: {
          encoding: 'WEBM_OPUS',
          sampleRateHertz: 48000,
          languageCode: 'en-US',
          enableAutomaticPunctuation: true,
        },
        audio: {
          content: audioBuffer.toString('base64'),
        },
      })

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30_000)

      const response = await fetch(
        `https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        }
      )
      clearTimeout(timeout)

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[SttManager] Google error:', response.status, errorText)
        if (response.status === 403 && errorText.includes('SERVICE_DISABLED')) {
          return { success: false, error: 'Google Cloud Speech-to-Text API is not enabled. Enable it in your GCP Console and retry.' }
        }
        if (response.status === 403) {
          return { success: false, error: 'Google API key lacks permission for Speech-to-Text. Check your GCP project settings.' }
        }
        return { success: false, error: `Google API error (${response.status}): ${errorText.slice(0, 200)}` }
      }

      const json = await response.json() as any
      const transcript = json.results
        ?.map((r: any) => r.alternatives?.[0]?.transcript)
        .filter(Boolean)
        .join(' ')
        .trim() || ''

      return { success: true, transcript }
    } catch (err: any) {
      console.error('[SttManager] Google transcription failed:', err)
      if (err.name === 'AbortError') {
        return { success: false, error: 'Google Speech API request timed out after 30 seconds' }
      }
      return { success: false, error: err.message || 'Failed to reach Google Speech API' }
    }
  }

  /**
   * Local Whisper server with OpenAI-compatible /v1/audio/transcriptions endpoint.
   * Works with faster-whisper-server, whisper.cpp, LocalAI, etc.
   */
  private async transcribeLocal(audioBuffer: Buffer, endpoint?: string, model?: string): Promise<TranscribeResult> {
    // Node fetch resolves "localhost" to ::1 (IPv6) first, but most local servers
    // only bind to 0.0.0.0 (IPv4). Replace localhost with 127.0.0.1 to avoid ECONNREFUSED.
    const baseUrl = (endpoint || DEFAULT_LOCAL_ENDPOINT).replace(/\/+$/, '').replace('://localhost', '://127.0.0.1')
    const url = `${baseUrl}/v1/audio/transcriptions`

    try {
      const boundary = `----FormBoundary${Date.now()}`
      const parts: Buffer[] = []

      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.webm"\r\nContent-Type: audio/webm\r\n\r\n`
      ))
      parts.push(audioBuffer)
      parts.push(Buffer.from('\r\n'))

      if (model) {
        parts.push(Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}\r\n`
        ))
      }

      parts.push(Buffer.from(`--${boundary}--\r\n`))

      const body = Buffer.concat(parts)

      console.log(`[SttManager] Sending ${body.length} bytes to ${url}`)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30_000)

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[SttManager] Local Whisper error:', response.status, errorText)
        return { success: false, error: `Local Whisper error (${response.status}): ${errorText.slice(0, 200)}` }
      }

      const json = await response.json() as any
      console.log('[SttManager] Local Whisper response:', JSON.stringify(json))
      const transcript = (json.text || '').trim()
      return { success: true, transcript }
    } catch (err: any) {
      console.error('[SttManager] Local Whisper transcription failed:', err)
      if (err.code === 'ECONNREFUSED' || err.cause?.code === 'ECONNREFUSED') {
        return { success: false, error: `Cannot connect to Whisper server at ${baseUrl}. Make sure it is running.` }
      }
      return { success: false, error: err.message || `Failed to reach Whisper server at ${baseUrl}` }
    }
  }
}
