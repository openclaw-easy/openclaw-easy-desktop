import { useState, useRef, useCallback, useEffect } from 'react'

interface TalkModeState {
  isSupported: boolean
  isActive: boolean
  isListening: boolean
  isSpeaking: boolean
  transcript: string
  /** Set once transcription succeeds; consumed (cleared) by the caller after sending. */
  pendingTranscript: string | null
  error: string | null
  setActive: (active: boolean) => void
  startListening: () => void
  stopListening: () => void
  /** Clear pendingTranscript after it has been consumed (e.g. sent as a message). */
  clearPendingTranscript: () => void
  speak: (text: string) => void
  stopSpeaking: () => void
}

// Silence detection: stop recording after this many ms of silence
const SILENCE_TIMEOUT_MS = 1500
// Minimum audio level (RMS) to count as speech
const SILENCE_THRESHOLD = 0.01
// Don't auto-stop for silence in the first N ms (avoids stopping before user starts speaking)
const MIN_RECORDING_MS = 1000
// Hard limit on recording length to prevent unbounded memory growth
const MAX_RECORDING_MS = 120_000

export function useTalkMode(): TalkModeState {
  const [isActive, setIsActive] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [pendingTranscript, setPendingTranscript] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioStreamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const maxRecordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number | null>(null)
  const synthRef = useRef<SpeechSynthesis | null>(null)

  // MediaRecorder + IPC are available in Electron (no webkitSpeechRecognition needed)
  const isSupported = typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    !!window.electronAPI?.transcribeAudio

  // Initialize synth ref
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      synthRef.current = window.speechSynthesis
    }
  }, [])

  // Clean up everything when talk mode is deactivated
  const cleanup = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
    if (maxRecordTimerRef.current) {
      clearTimeout(maxRecordTimerRef.current)
      maxRecordTimerRef.current = null
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    mediaRecorderRef.current = null
    analyserRef.current = null
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(t => t.stop())
      audioStreamRef.current = null
    }
  }, [])

  const doStartListening = useCallback(async () => {
    // Prevent duplicate recording sessions (e.g. two effects both calling startListening)
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      return
    }

    setError(null)
    setTranscript('')
    setPendingTranscript(null)

    let audioCtx: AudioContext | null = null

    try {
      // On macOS, Electron requires an explicit permission request before getUserMedia works.
      // Without this, getUserMedia hangs forever with no system dialog.
      if (window.electronAPI?.requestPermission) {
        const granted = await window.electronAPI.requestPermission('microphone')
        if (!granted) {
          setError('Microphone access denied. Go to System Settings > Privacy & Security > Microphone to allow access.')
          setIsListening(false)
          return
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioStreamRef.current = stream

      // Set up analyser for silence detection
      audioCtx = new AudioContext()
      audioCtxRef.current = audioCtx
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)
      analyserRef.current = analyser

      // Choose the best supported format — prefer webm/opus, fall back to webm, then wav
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/wav'

      const recorder = new MediaRecorder(stream, { mimeType })
      const chunks: Blob[] = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }

      recorder.onstop = async () => {
        // Stop silence detection loop
        if (animFrameRef.current) {
          cancelAnimationFrame(animFrameRef.current)
          animFrameRef.current = null
        }
        if (maxRecordTimerRef.current) {
          clearTimeout(maxRecordTimerRef.current)
          maxRecordTimerRef.current = null
        }
        if (audioCtxRef.current) {
          audioCtxRef.current.close().catch(() => {})
          audioCtxRef.current = null
        }

        if (chunks.length === 0) {
          setIsListening(false)
          return
        }

        const blob = new Blob(chunks, { type: mimeType })
        // Convert to base64 for IPC — use FileReader to avoid slow string concatenation
        const arrayBuffer = await blob.arrayBuffer()
        const bytes = new Uint8Array(arrayBuffer)
        let binary = ''
        const chunkSize = 8192
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
        }
        const base64 = btoa(binary)

        setTranscript('Transcribing...')
        try {
          const result = await window.electronAPI.transcribeAudio(base64)
          if (result.success && result.transcript) {
            setTranscript(result.transcript)
            setPendingTranscript(result.transcript)
          } else {
            setError(result.error || 'Transcription returned empty result')
            setTranscript('')
          }
        } catch (err: any) {
          console.error('[TalkMode] IPC transcription error:', err)
          setError(err.message || 'Failed to transcribe audio')
          setTranscript('')
        }
        setIsListening(false)
      }

      recorder.onerror = (e: any) => {
        console.error('[TalkMode] MediaRecorder error:', e)
        setError('Recording failed')
        setIsListening(false)
      }

      mediaRecorderRef.current = recorder
      recorder.start()
      setIsListening(true)

      const recordingStart = Date.now()

      // Hard limit: auto-stop after MAX_RECORDING_MS to prevent unbounded memory growth
      maxRecordTimerRef.current = setTimeout(() => {
        maxRecordTimerRef.current = null
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop()
        }
      }, MAX_RECORDING_MS)

      // Silence detection loop
      const dataArray = new Float32Array(analyser.fftSize)
      const checkSilence = () => {
        if (!analyserRef.current || !mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') {
          return
        }

        // Don't auto-stop for silence in the first MIN_RECORDING_MS —
        // gives the user time to start speaking in a quiet environment.
        if (Date.now() - recordingStart < MIN_RECORDING_MS) {
          animFrameRef.current = requestAnimationFrame(checkSilence)
          return
        }

        analyserRef.current.getFloatTimeDomainData(dataArray)
        // Compute RMS
        let sum = 0
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i] * dataArray[i]
        }
        const rms = Math.sqrt(sum / dataArray.length)

        if (rms < SILENCE_THRESHOLD) {
          // Silence — start/continue the timer
          if (!silenceTimerRef.current) {
            silenceTimerRef.current = setTimeout(() => {
              // Auto-stop after silence
              if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                mediaRecorderRef.current.stop()
              }
            }, SILENCE_TIMEOUT_MS)
          }
        } else {
          // Speech detected — reset timer
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current)
            silenceTimerRef.current = null
          }
        }

        animFrameRef.current = requestAnimationFrame(checkSilence)
      }
      checkSilence()
    } catch (err: any) {
      console.error('[TalkMode] Microphone access error:', err)
      // Close AudioContext if it was created before the error
      if (audioCtx) {
        audioCtx.close().catch(() => {})
        audioCtxRef.current = null
      }
      setError('Microphone access denied. Check System Preferences > Privacy > Microphone.')
      setIsListening(false)
    }
  }, [])

  // Auto-start listening when talk mode is activated; clean up on deactivation
  useEffect(() => {
    if (isActive) {
      doStartListening()
    } else {
      cleanup()
      setIsListening(false)
      setTranscript('')
      setPendingTranscript(null)
      if (synthRef.current?.speaking) {
        synthRef.current.cancel()
      }
      setIsSpeaking(false)
      setError(null)
    }
  }, [isActive, doStartListening, cleanup])

  const startListening = useCallback(() => {
    if (!isActive || !isSupported) return
    doStartListening()
  }, [isActive, isSupported, doStartListening])

  const stopListening = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  const speak = useCallback((text: string) => {
    if (!synthRef.current || !isActive) return

    // Cancel current speech
    synthRef.current.cancel()

    // Strip markdown syntax for cleaner speech
    const cleanText = text
      .replace(/```[\s\S]*?```/g, 'code block')
      .replace(/`[^`]+`/g, (m) => m.replace(/`/g, ''))
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[#*_~>]/g, '')
      .replace(/\n{2,}/g, '. ')
      .replace(/\n/g, ' ')
      .trim()

    if (!cleanText) return

    // Split long text into chunks for reliability
    const sentences = cleanText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [cleanText]

    setIsSpeaking(true)

    const speakNext = (index: number) => {
      if (index >= sentences.length || !synthRef.current) {
        setIsSpeaking(false)
        return
      }

      const utterance = new SpeechSynthesisUtterance(sentences[index].trim())
      utterance.rate = 1.0
      utterance.pitch = 1.0

      utterance.onend = () => speakNext(index + 1)
      utterance.onerror = () => {
        setIsSpeaking(false)
      }

      synthRef.current.speak(utterance)
    }

    speakNext(0)
  }, [isActive])

  const stopSpeaking = useCallback(() => {
    if (synthRef.current?.speaking) {
      synthRef.current.cancel()
    }
    setIsSpeaking(false)
  }, [])

  const clearPendingTranscript = useCallback(() => {
    setPendingTranscript(null)
  }, [])

  const setActive = useCallback((active: boolean) => {
    setIsActive(active)
  }, [])

  return {
    isSupported,
    isActive,
    isListening,
    isSpeaking,
    transcript,
    pendingTranscript,
    error,
    setActive,
    startListening,
    stopListening,
    clearPendingTranscript,
    speak,
    stopSpeaking,
  }
}
