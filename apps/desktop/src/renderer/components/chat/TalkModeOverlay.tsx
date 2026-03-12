import React from 'react'
import { Mic, MicOff, Volume2, X, AlertCircle, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface ColorTheme {
  background: {
    primary: string
    secondary: string
    tertiary: string
    modifier: {
      hover: string
      active: string
      selected: string
    }
  }
  text: {
    normal: string
    muted: string
    header: string
  }
  accent: {
    brand: string
    green: string
    userBubble: string
  }
}

interface TalkModeOverlayProps {
  colors: ColorTheme
  isListening: boolean
  transcript: string
  isSpeaking: boolean
  isStreaming: boolean
  error: string | null
  onToggleListening: () => void
  onClose: () => void
  onGoToVoiceSettings?: () => void
}

export function TalkModeOverlay({
  colors,
  isListening,
  transcript,
  isSpeaking,
  isStreaming,
  error,
  onToggleListening,
  onClose,
  onGoToVoiceSettings,
}: TalkModeOverlayProps) {
  const { t } = useTranslation()
  return (
    <div
      className="flex-shrink-0 px-6 py-3 border-t flex items-center gap-3"
      style={{
        borderColor: colors.background.modifier.hover,
        backgroundColor: error ? '#7f1d1d20' : colors.accent.brand + '15',
      }}
    >
      {/* Mic button */}
      <button
        onClick={onToggleListening}
        className="relative p-3 rounded-full transition-colors flex-shrink-0"
        style={{
          backgroundColor: isListening ? colors.accent.brand : colors.background.tertiary,
          color: isListening ? '#ffffff' : colors.text.muted,
        }}
      >
        {isListening ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
        {/* Pulse animation when listening */}
        {isListening && (
          <span
            className="absolute inset-0 rounded-full animate-ping opacity-30"
            style={{ backgroundColor: colors.accent.brand }}
          />
        )}
      </button>

      {/* Status / transcript / error */}
      <div className="flex-1 min-w-0">
        {error ? (
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0" style={{ color: '#f87171' }} />
            <span className="text-xs" style={{ color: '#f87171' }}>
              {error}
            </span>
            {onGoToVoiceSettings && (
              <button
                onClick={() => { onGoToVoiceSettings(); onClose(); }}
                className="text-xs font-medium px-2 py-0.5 rounded whitespace-nowrap transition-opacity hover:opacity-80"
                style={{ backgroundColor: colors.accent.brand, color: '#ffffff' }}
              >
                {t('chat.openVoiceSettings')}
              </button>
            )}
          </div>
        ) : isListening ? (
          <div>
            <div className="flex items-center gap-2">
              <div className="flex gap-0.5">
                <span className="w-1 h-3 rounded-full animate-pulse" style={{ backgroundColor: colors.accent.brand }} />
                <span className="w-1 h-4 rounded-full animate-pulse" style={{ backgroundColor: colors.accent.brand, animationDelay: '0.15s' }} />
                <span className="w-1 h-2 rounded-full animate-pulse" style={{ backgroundColor: colors.accent.brand, animationDelay: '0.3s' }} />
              </div>
              <span className="text-xs font-medium" style={{ color: colors.accent.brand }}>
                {t('chat.listening')}
              </span>
            </div>
            {transcript && (
              <p className="text-sm mt-1 truncate" style={{ color: colors.text.normal }}>
                {transcript}
              </p>
            )}
          </div>
        ) : isSpeaking ? (
          <div className="flex items-center gap-2">
            <Volume2 className="h-4 w-4" style={{ color: colors.accent.green }} />
            <span className="text-xs" style={{ color: colors.accent.green }}>{t('chat.speaking')}</span>
          </div>
        ) : isStreaming ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" style={{ color: colors.accent.brand }} />
            <span className="text-xs" style={{ color: colors.accent.brand }}>{t('chat.thinking')}</span>
          </div>
        ) : transcript === 'Transcribing...' ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" style={{ color: colors.accent.brand }} />
            <span className="text-xs" style={{ color: colors.accent.brand }}>{t('chat.transcribing')}</span>
          </div>
        ) : (
          <p className="text-xs" style={{ color: colors.text.muted }}>
            {t('chat.tapMicOrSpeak')}
          </p>
        )}
      </div>

      {/* Close button */}
      <button
        onClick={onClose}
        className="p-1.5 rounded transition-colors flex-shrink-0"
        style={{ color: colors.text.muted }}
        title={t('chat.closeTalkMode')}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
