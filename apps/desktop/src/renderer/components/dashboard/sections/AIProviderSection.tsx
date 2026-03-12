import React, { useState, useEffect, useCallback } from 'react'
import { Bot, Loader2, Mic, Eye, EyeOff, Check, Download, Play, Square, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ColorTheme } from '../types'
import { useProviderConfig, AppProviderConfig } from '../../../hooks/useProviderConfig'
import { useToast } from '../../../contexts/ToastContext'
import { BYOK_PROVIDER_MODELS } from '../../../../shared/providerModels'

interface AIProviderSectionProps {
  colors: ColorTheme
  onGoToSettings?: () => void
  onGoToAgents?: () => void
}

// Derived from shared providerModels.ts — single source of truth.
// Appends a 'Custom...' entry so users can type their own model ID.
const BYOK_MODEL_OPTIONS = Object.fromEntries(
  Object.entries(BYOK_PROVIDER_MODELS).map(([provider, cfg]) => [
    provider,
    [...cfg.models.map(m => ({ id: m.id, name: m.name })), { id: 'custom', name: 'Custom...' }],
  ])
) as Record<string, { id: string; name: string }[]>

// Note: WHISPER_MODELS uses static names; i18n keys are used at render-time
const WHISPER_MODELS = [
  { id: 'tiny', nameKey: 'aiProvider.tinyModel', size: '75 MB' },
  { id: 'base', nameKey: 'aiProvider.baseModel', size: '150 MB' },
  { id: 'small', nameKey: 'aiProvider.smallModel', size: '500 MB' },
  { id: 'medium', nameKey: 'aiProvider.mediumModel', size: '1.5 GB' },
  { id: 'large-v3', nameKey: 'aiProvider.largeModel', size: '3 GB' },
  { id: 'turbo', nameKey: 'aiProvider.turboModel', size: '1.5 GB' },
]

type WhisperServerStatus = 'stopped' | 'installing' | 'starting' | 'running' | 'error'

export const AIProviderSection: React.FC<AIProviderSectionProps> = ({ colors, onGoToSettings, onGoToAgents }) => {
  const { t } = useTranslation()
  const { config, isLoading, isSaving, saveError, saveAndApply, reload, installedModels } = useProviderConfig()
  const { addToast } = useToast()

  // --- Local form state (uncommitted until "Apply & Restart") ---
  const [aiProvider, setAiProvider] = useState<'local' | 'byok'>('local')
  const [byokProvider, setByokProvider] = useState<'google' | 'anthropic' | 'openai' | 'venice' | 'openrouter'>('google')
  const [byokModel, setByokModel] = useState('gemini-flash-latest')
  const [byokCustomModel, setByokCustomModel] = useState('')
  const [byokApiKeys, setByokApiKeys] = useState({ google: '', anthropic: '', openai: '', venice: '', openrouter: '' })
  const [changingKeyFor, setChangingKeyFor] = useState<string | null>(null)
  const [showByokKey, setShowByokKey] = useState(false)
  const [localModel, setLocalModel] = useState('llama3.2:3b')

  // Validation / save status
  const [isValidating, setIsValidating] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  // STT settings state
  const [sttProvider, setSttProvider] = useState<'local' | 'openai' | 'google'>('openai')
  const [sttOpenaiKey, setSttOpenaiKey] = useState('')
  const [sttGoogleKey, setSttGoogleKey] = useState('')
  const [sttLocalEndpoint, setSttLocalEndpoint] = useState('http://localhost:8000')
  const [sttLocalModel, setSttLocalModel] = useState('')
  const [sttShowOpenaiKey, setSttShowOpenaiKey] = useState(false)
  const [sttShowGoogleKey, setSttShowGoogleKey] = useState(false)
  const [sttSaving, setSttSaving] = useState(false)
  const [sttSaved, setSttSaved] = useState(false)

  // Whisper server state
  const [whisperStatus, setWhisperStatus] = useState<WhisperServerStatus>('stopped')
  const [whisperInstalled, setWhisperInstalled] = useState<boolean | null>(null)
  const [whisperCanInstall, setWhisperCanInstall] = useState(false)
  const [whisperInstallerTool, setWhisperInstallerTool] = useState<string | null>(null)
  const [whisperModel, setWhisperModel] = useState('small')
  const [whisperPort, setWhisperPort] = useState(8000)
  const [whisperError, setWhisperError] = useState<string | undefined>()
  const [showVoiceSection, setShowVoiceSection] = useState(false)
  const [whisperShowAdvanced, setWhisperShowAdvanced] = useState(false)
  const [whisperInstalling, setWhisperInstalling] = useState(false)

  // Detect whisper server when Local Whisper is selected
  const detectWhisper = useCallback(async () => {
    try {
      const result = await window.electronAPI?.detectWhisperServer?.()
      if (result) {
        setWhisperInstalled(result.installed)
        setWhisperCanInstall(result.canInstall)
        setWhisperInstallerTool(result.installerTool)
      } else {
        // API unavailable — fall through to not-installed state
        setWhisperInstalled(false)
      }
      const status = await window.electronAPI?.getWhisperServerStatus?.()
      if (status) {
        setWhisperStatus(status.status)
        setWhisperPort(status.port)
        setWhisperModel(status.model)
        setWhisperError(status.error)
      }
    } catch (err) {
      console.error('Failed to detect whisper server:', err)
      setWhisperInstalled(false)
    }
  }, [])

  useEffect(() => {
    if (sttProvider === 'local') {
      // Reset to loading state, then detect
      setWhisperInstalled(null)
      detectWhisper()
    }
  }, [sttProvider, detectWhisper])

  // Subscribe to whisper server status updates
  useEffect(() => {
    const cleanup = window.electronAPI?.onWhisperServerStatus?.((status) => {
      setWhisperStatus(status.status)
      setWhisperPort(status.port)
      setWhisperModel(status.model)
      setWhisperInstalled(status.installed)
      setWhisperError(status.error)
      if (status.status === 'running' || status.status === 'stopped') {
        setWhisperInstalling(false)
      }
    })
    return () => cleanup?.()
  }, [])

  const handleWhisperInstall = async () => {
    setWhisperInstalling(true)
    try {
      const result = await window.electronAPI?.installWhisperServer?.()
      if (result?.success) {
        setWhisperInstalled(true)
        addToast(t('aiProvider.whisperInstalled'), 'success')
      } else {
        addToast(result?.error || t('aiProvider.installFailed'), 'error')
      }
    } catch {
      addToast(t('aiProvider.installFailed'), 'error')
    } finally {
      setWhisperInstalling(false)
    }
  }

  const handleWhisperStart = async () => {
    try {
      const result = await window.electronAPI?.startWhisperServer?.(whisperModel, whisperPort)
      if (!result?.success) {
        addToast(result?.error || t('aiProvider.startFailed'), 'error')
      }
    } catch {
      addToast(t('aiProvider.startFailed'), 'error')
    }
  }

  const handleWhisperStop = async () => {
    try {
      await window.electronAPI?.stopWhisperServer?.()
    } catch {
      addToast(t('aiProvider.stopFailed'), 'error')
    }
  }

  const handleWhisperModelChange = async (newModel: string) => {
    setWhisperModel(newModel)
    // If server is running, restart with new model
    if (whisperStatus === 'running') {
      await window.electronAPI?.stopWhisperServer?.()
      await window.electronAPI?.startWhisperServer?.(newModel, whisperPort)
    }
  }

  // Populate form from loaded config
  useEffect(() => {
    if (!config) {return}
    const loadedProvider = config.aiProvider
    setAiProvider(loadedProvider === 'byok' ? 'byok' : 'local')
setByokProvider((config.byok?.provider as any) || 'google')
    setByokModel(config.byok?.model || 'gemini-flash-latest')
    setByokApiKeys({
      google: config.byok?.apiKeys?.google || '',
      anthropic: config.byok?.apiKeys?.anthropic || '',
      openai: config.byok?.apiKeys?.openai || '',
      venice: config.byok?.apiKeys?.venice || '',
      openrouter: config.byok?.apiKeys?.openrouter || '',
    })
    setLocalModel(config.local?.model || 'llama3.2:3b')

    // Load STT config, pre-fill API keys from BYOK if available
    if (config.stt) {
      // Migrate legacy 'ollama' provider to 'local'
      const provider = (config.stt.provider as string) === 'ollama' ? 'local' : (config.stt.provider || 'openai')
      setSttProvider(provider as 'local' | 'openai' | 'google')
      setSttOpenaiKey(config.stt.openaiApiKey || config.byok?.apiKeys?.openai || '')
      setSttGoogleKey(config.stt.googleApiKey || config.byok?.apiKeys?.google || '')
      setSttLocalEndpoint(config.stt.localEndpoint || 'http://localhost:8000')
      setSttLocalModel(config.stt.localModel || '')
    } else {
      // No STT config yet — pre-fill from BYOK keys
      setSttOpenaiKey(config.byok?.apiKeys?.openai || '')
      setSttGoogleKey(config.byok?.apiKeys?.google || '')
    }
  }, [config])

  // Reset byokModel when byokProvider changes (pick a sane default)
  useEffect(() => {
    const options = BYOK_MODEL_OPTIONS[byokProvider]
    if (options && !options.some(o => o.id === byokModel || (byokModel !== 'custom' && o.id === 'custom'))) {
      setByokModel(options[0].id)
    }
  }, [byokProvider])

  // Surface validation/save errors as floating toasts
  useEffect(() => {
    if (validationError) addToast(validationError, 'error')
  }, [validationError])
  useEffect(() => {
    if (saveError) addToast(saveError, 'error')
  }, [saveError])

  const resolvedByokModel = byokModel === 'custom' ? byokCustomModel.trim() : byokModel

  // Also sync BYOK keys into STT fields when BYOK keys change
  useEffect(() => {
    if (!sttOpenaiKey && byokApiKeys.openai) {
      setSttOpenaiKey(byokApiKeys.openai)
    }
    if (!sttGoogleKey && byokApiKeys.google) {
      setSttGoogleKey(byokApiKeys.google)
    }
  }, [byokApiKeys.openai, byokApiKeys.google])

  // Save STT config to app-config.json
  const handleSaveStt = async () => {
    setSttSaving(true)
    setSttSaved(false)
    try {
      const appConfig = await window.electronAPI?.getConfig?.() || {}
      const updated = {
        ...appConfig,
        stt: {
          provider: sttProvider,
          openaiApiKey: sttOpenaiKey,
          googleApiKey: sttGoogleKey,
          localEndpoint: sttLocalEndpoint,
          localModel: sttLocalModel,
        },
      }
      await window.electronAPI?.saveConfig?.(updated)
      setSttSaved(true)
      addToast(t('aiProvider.voiceSettingsSaved'), 'success')
      setTimeout(() => setSttSaved(false), 2000)
    } catch (error) {
      console.error('Failed to save STT config:', error)
      addToast(t('aiProvider.voiceSettingsFailed'), 'error')
    } finally {
      setSttSaving(false)
    }
  }

  const handleValidateAndSave = async () => {
    setValidationError(null)

    // Validate BYOK key if that's the active provider
    if (aiProvider === 'byok') {
      const activeKey = byokApiKeys[byokProvider]
      if (!activeKey) {
        setValidationError(t('aiProvider.enterApiKeyFor', { provider: byokProvider }))
        return
      }
      if (!resolvedByokModel) {
        setValidationError(t('aiProvider.enterModelId'))
        return
      }

      const validatableProviders = ['google', 'anthropic', 'openai'] as const
      if (validatableProviders.includes(byokProvider as any)) {
        setIsValidating(true)
        try {
          const isValid = await window.electronAPI?.validateApiKey?.(byokProvider as 'google' | 'anthropic' | 'openai', activeKey)
          if (!isValid) {
            setValidationError(t('aiProvider.invalidApiKeyFormat', { provider: byokProvider }))
            setIsValidating(false)
            return
          }
        } catch {
          // validateApiKey failed — still allow saving
        } finally {
          setIsValidating(false)
        }
      }
    }

    const newConfig: AppProviderConfig = {
      ...config,
      aiProvider,
      byok: {
        provider: byokProvider,
        model: resolvedByokModel,
        apiKeys: byokApiKeys,
      },
      local: { model: localModel },
      stt: {
        provider: sttProvider,
        openaiApiKey: sttOpenaiKey,
        googleApiKey: sttGoogleKey,
        localEndpoint: sttLocalEndpoint,
        localModel: sttLocalModel,
      },
    }

    try {
      // Check if provider changed to show reminder
      const providerChanged = config && config.aiProvider !== aiProvider

      await saveAndApply(newConfig)
      // Reload to pick up updated model list written to openclaw.json
      await reload()
      addToast(
        t('aiProvider.configApplied'),
        'success',
        5000
      )

      if (providerChanged) {
        addToast(
          t('aiProvider.reminderAgentConfig'),
          'info',
          10000,
          onGoToAgents ? { label: t('aiProvider.goToAgentManagement'), onClick: onGoToAgents } : undefined
        )
      }
    } catch {
      // saveError is set by the hook
    }
  }

  const maskedKey = (key: string) =>
    key.length > 8 ? `${key.slice(0, 4)}${'•'.repeat(8)}${key.slice(-4)}` : '•'.repeat(key.length || 8)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: colors.text.muted }} />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-8 pb-4">
        <div className="flex items-baseline gap-2">
          <h3 className="text-lg font-bold" style={{ color: colors.text.header }}>
            {t('aiProvider.title')}
          </h3>
          <p className="text-sm" style={{ color: colors.text.muted }}>
            {t('aiProvider.subtitle')}
          </p>
        </div>

        {/* Validation / save errors shown as floating toast */}
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6">

        {/* Provider selection */}
        <div className="rounded-lg px-6 pt-4 pb-2" style={{ backgroundColor: colors.bg.secondary }}>
          <div className="flex items-center space-x-3 mb-2">
            <Bot className="h-5 w-5" style={{ color: colors.accent.purple }} />
            <h4 className="text-lg font-semibold" style={{ color: colors.text.header }}>
              {t('aiProvider.provider')}
            </h4>
          </div>

          <div className="space-y-1">
            {([
              { id: 'local' as const, name: t('aiProvider.localLLM'), desc: t('aiProvider.localLLMDesc') },
              { id: 'byok' as const, name: t('aiProvider.byok'), desc: t('aiProvider.byokDesc') },
            ]).map(p => (
              <label
                key={p.id}
                className="flex items-center py-2 px-3 rounded cursor-pointer transition-colors"
                style={{ backgroundColor: aiProvider === p.id ? colors.bg.active : 'transparent' }}
              >
                <input
                  type="radio"
                  name="ai-provider"
                  value={p.id}
                  checked={aiProvider === p.id}
                  onChange={() => setAiProvider(p.id)}
                  className="mr-3"
                />
                <div className="flex-1 flex items-baseline gap-2">
                  <span className="font-medium" style={{ color: colors.text.header }}>{p.name}</span>
                  <span className="text-sm" style={{ color: colors.text.muted }}>
                    {p.desc}
                  </span>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Local panel */}
        {aiProvider === 'local' && (
          <div className="rounded-lg p-6" style={{ backgroundColor: colors.bg.secondary }}>
            <div className="flex items-center gap-3">
              <h4 className="text-lg font-semibold flex-shrink-0" style={{ color: colors.text.header }}>{t('aiProvider.activeModel')}</h4>
              {installedModels.length > 0 ? (
                <select
                  value={localModel}
                  onChange={e => setLocalModel(e.target.value)}
                  className="flex-1 px-3 py-2 rounded text-sm"
                  style={{ backgroundColor: colors.bg.tertiary, color: colors.text.normal, border: 'none' }}
                >
                  {installedModels.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              ) : (
                <div className="flex-1">
                  <input
                    type="text"
                    value={localModel}
                    onChange={e => setLocalModel(e.target.value)}
                    placeholder="e.g. llama3.2:3b"
                    className="w-full px-3 py-2 rounded text-sm"
                    style={{ backgroundColor: colors.bg.tertiary, color: colors.text.normal, border: 'none' }}
                  />
                </div>
              )}
            </div>
            {installedModels.length === 0 && (
              <p className="text-xs mt-1" style={{ color: colors.text.muted }}
                dangerouslySetInnerHTML={{ __html: t('aiProvider.installModelsHint') }}
              />
            )}
          </div>
        )}

        {/* BYOK panel */}
        {aiProvider === 'byok' && (
          <div className="rounded-lg p-6 space-y-5" style={{ backgroundColor: colors.bg.secondary }}>
            <h4 className="text-lg font-semibold" style={{ color: colors.text.header }}>{t('aiProvider.cloudProvider')}</h4>

            {/* Provider radio */}
            <div className="flex flex-wrap gap-3">
              {([
                { id: 'google', label: 'Google' },
                { id: 'anthropic', label: 'Anthropic' },
                { id: 'openai', label: 'OpenAI' },
                { id: 'venice', label: 'Venice AI' },
                { id: 'openrouter', label: 'OpenRouter' },
              ] as const).map(p => (
                <label key={p.id} className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="radio"
                    name="byok-provider"
                    value={p.id}
                    checked={byokProvider === p.id}
                    onChange={() => { setByokProvider(p.id); setShowByokKey(false) }}
                  />
                  <span className="text-sm" style={{ color: colors.text.normal }}>
                    {p.label}
                  </span>
                </label>
              ))}
            </div>

            {/* API Key */}
            <div>
              {byokApiKeys[byokProvider] && changingKeyFor !== byokProvider ? (
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium flex-shrink-0 whitespace-nowrap" style={{ color: colors.text.header }}>
                    {byokProvider === 'google' ? 'Google' : byokProvider === 'anthropic' ? 'Anthropic' : byokProvider === 'openai' ? 'OpenAI' : byokProvider === 'venice' ? 'Venice AI' : 'OpenRouter'} {t('aiProvider.apiKey')}
                  </label>
                  <span className="flex-1 px-3 py-2 rounded text-sm font-mono"
                    style={{ backgroundColor: colors.bg.tertiary, color: colors.text.muted }}>
                    {showByokKey ? byokApiKeys[byokProvider] : maskedKey(byokApiKeys[byokProvider])}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowByokKey(!showByokKey)}
                    className="p-2 rounded transition-colors"
                    style={{ color: colors.text.muted }}
                  >
                    {showByokKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={() => setChangingKeyFor(byokProvider)}
                    className="px-3 py-2 rounded text-sm transition-colors"
                    style={{ backgroundColor: colors.bg.tertiary, color: colors.text.link }}
                  >
                    {t('aiProvider.changeKey')}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium flex-shrink-0 whitespace-nowrap" style={{ color: colors.text.header }}>
                    {byokProvider === 'google' ? 'Google' : byokProvider === 'anthropic' ? 'Anthropic' : byokProvider === 'openai' ? 'OpenAI' : byokProvider === 'venice' ? 'Venice AI' : 'OpenRouter'} {t('aiProvider.apiKey')}
                  </label>
                  <input
                    type="password"
                    value={byokApiKeys[byokProvider]}
                    onChange={e => setByokApiKeys(prev => ({ ...prev, [byokProvider]: e.target.value }))}
                    placeholder={byokProvider === 'google' ? 'AIza...' : byokProvider === 'anthropic' ? 'sk-ant-...' : byokProvider === 'openrouter' ? 'sk-or-...' : 'sk-...'}
                    className="flex-1 px-3 py-2 rounded text-sm"
                    style={{ backgroundColor: colors.bg.tertiary, color: colors.text.normal, border: 'none' }}
                  />
                  {changingKeyFor === byokProvider && (
                    <button
                      onClick={() => setChangingKeyFor(null)}
                      className="px-3 py-2 rounded text-sm"
                      style={{ backgroundColor: colors.bg.tertiary, color: colors.text.muted }}
                    >
                      {t('common.cancel')}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Model dropdown */}
            <div>
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium flex-shrink-0" style={{ color: colors.text.header }}>{t('aiProvider.model')}</label>
                <select
                  value={byokModel}
                  onChange={e => setByokModel(e.target.value)}
                  className="flex-1 px-3 py-2 rounded text-sm"
                  style={{ backgroundColor: colors.bg.tertiary, color: colors.text.normal, border: 'none' }}
                >
                  {BYOK_MODEL_OPTIONS[byokProvider].map(m => (
                    <option key={m.id} value={m.id}>{m.id === 'custom' ? t('aiProvider.custom') : m.name}</option>
                  ))}
                </select>
              </div>
              {byokModel === 'custom' && (
                <input
                  type="text"
                  value={byokCustomModel}
                  onChange={e => setByokCustomModel(e.target.value)}
                  placeholder={t('aiProvider.customModelPlaceholder')}
                  className="w-full mt-2 px-3 py-2 rounded text-sm"
                  style={{ backgroundColor: colors.bg.tertiary, color: colors.text.normal, border: 'none' }}
                />
              )}
            </div>
          </div>
        )}


        {/* Voice / Speech-to-Text (collapsible) */}
        <div className="rounded-lg p-6" style={{ backgroundColor: colors.bg.secondary }}>
          <div
            className="flex items-center justify-between cursor-pointer"
            onClick={() => setShowVoiceSection(!showVoiceSection)}
          >
            <div className="flex items-center space-x-3">
              <Mic className="h-5 w-5" style={{ color: colors.accent.purple }} />
              <h4 className="text-lg font-semibold" style={{ color: colors.text.header }}>
                {t('aiProvider.voiceStt')}
              </h4>
              {showVoiceSection ? <ChevronUp className="h-4 w-4" style={{ color: colors.text.muted }} /> : <ChevronDown className="h-4 w-4" style={{ color: colors.text.muted }} />}
            </div>
          </div>

          {showVoiceSection && (<div className="mt-4">

          <div className="space-y-4">
            {/* Provider selection + Save button */}
            <div className="flex items-center gap-3">
              <p className="text-sm font-medium flex-shrink-0 whitespace-nowrap" style={{ color: colors.text.header }}>
                {t('aiProvider.sttProvider')}
              </p>
              <div className="flex gap-3 flex-1">
                {([
                  { value: 'openai' as const, label: t('aiProvider.openaiWhisper') },
                  { value: 'local' as const, label: t('aiProvider.localWhisper') },
                  { value: 'google' as const, label: t('aiProvider.googleCloud') },
                ] as const).map((opt) => (
                  <label
                    key={opt.value}
                    className="flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-colors"
                    style={{
                      backgroundColor: sttProvider === opt.value ? colors.bg.active : colors.bg.tertiary,
                      border: sttProvider === opt.value ? `1px solid ${colors.accent.brand}` : `1px solid transparent`,
                    }}
                  >
                    <input
                      type="radio"
                      name="stt-provider"
                      value={opt.value}
                      checked={sttProvider === opt.value}
                      onChange={() => setSttProvider(opt.value)}
                      className="accent-current"
                    />
                    <span className="text-sm" style={{ color: colors.text.normal }}>{opt.label}</span>
                  </label>
                ))}
              </div>
              <button
                onClick={handleSaveStt}
                disabled={sttSaving}
                className="flex items-center gap-1.5 px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50 flex-shrink-0"
                style={{ backgroundColor: sttSaved ? colors.accent.green : colors.accent.brand, color: 'white' }}
              >
                {sttSaving ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> {t('aiProvider.saving')}</>
                ) : sttSaved ? (
                  <><Check className="h-4 w-4" /> {t('aiProvider.saved')}</>
                ) : (
                  t('aiProvider.saveVoiceSettings')
                )}
              </button>
            </div>

            {/* Provider-specific fields */}
            {sttProvider === 'openai' && (
              <div className="p-4 rounded space-y-2" style={{ backgroundColor: colors.bg.tertiary }}>
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium flex-shrink-0 whitespace-nowrap" style={{ color: colors.text.header }}>
                    {t('aiProvider.openaiApiKey')}
                  </label>
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type={sttShowOpenaiKey ? 'text' : 'password'}
                      value={sttOpenaiKey}
                      onChange={(e) => setSttOpenaiKey(e.target.value)}
                      placeholder="sk-..."
                      className="flex-1 px-3 py-2 rounded text-sm"
                      style={{ backgroundColor: colors.bg.primary, color: colors.text.normal, border: `1px solid ${colors.bg.hover}` }}
                    />
                    <button
                      type="button"
                      onClick={() => setSttShowOpenaiKey(!sttShowOpenaiKey)}
                      className="p-2 rounded transition-colors"
                      style={{ color: colors.text.muted }}
                    >
                      {sttShowOpenaiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <p className="text-xs" style={{ color: colors.text.muted }}>
                  {t('aiProvider.whisperApiHint')}
                  {byokApiKeys.openai && ` ${t('aiProvider.prefilledFromByok', { provider: 'OpenAI' })}`}
                </p>
              </div>
            )}

            {sttProvider === 'local' && (
              <div className="p-4 rounded space-y-3" style={{ backgroundColor: colors.bg.tertiary }}>
                {/* Detection loading state */}
                {whisperInstalled === null && (
                  <div className="flex items-center gap-2 py-2">
                    <Loader2 className="h-4 w-4 animate-spin" style={{ color: colors.text.muted }} />
                    <span className="text-sm" style={{ color: colors.text.muted }}>{t('aiProvider.detectingWhisper')}</span>
                  </div>
                )}

                {/* Not installed — install prompt */}
                {whisperInstalled === false && (
                  <div className="space-y-3">
                    <div className="flex items-start gap-2 p-3 rounded" style={{ backgroundColor: colors.bg.primary }}>
                      <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: colors.accent.yellow }} />
                      <div className="flex-1">
                        <p className="text-sm font-medium" style={{ color: colors.text.header }}>
                          {t('aiProvider.whisperNotInstalled')}
                        </p>
                        {whisperCanInstall ? (
                          <p className="text-xs mt-1" style={{ color: colors.text.muted }}>
                            {t('aiProvider.installViaHint', { tool: whisperInstallerTool })}
                          </p>
                        ) : (
                          <p className="text-xs mt-1" style={{ color: colors.text.muted }}>
                            {t('aiProvider.installManualHint')} <code style={{ fontSize: '0.7rem' }}>pipx install faster-whisper-server</code>
                          </p>
                        )}
                      </div>
                    </div>
                    {whisperCanInstall && (
                      <div className="flex gap-2">
                        <button
                          onClick={handleWhisperInstall}
                          disabled={whisperInstalling}
                          className="flex items-center gap-1.5 px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50"
                          style={{ backgroundColor: colors.accent.brand, color: 'white' }}
                        >
                          {whisperInstalling ? (
                            <><Loader2 className="h-4 w-4 animate-spin" /> {t('common.installing')}</>
                          ) : (
                            <><Download className="h-4 w-4" /> {t('aiProvider.installWhisperServer')}</>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Installed — server controls */}
                {whisperInstalled && (
                  <div className="space-y-3">
                    {/* Status indicator */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full"
                          style={{
                            backgroundColor:
                              whisperStatus === 'running' ? colors.accent.green :
                              whisperStatus === 'starting' ? colors.accent.yellow :
                              whisperStatus === 'error' ? (colors.accent as any).red || '#ef4444' :
                              colors.text.muted,
                          }}
                        />
                        <span className="text-sm font-medium" style={{ color: colors.text.header }}>
                          {whisperStatus === 'running' && t('aiProvider.runningOnPort', { port: whisperPort })}
                          {whisperStatus === 'starting' && t('aiProvider.startingDownloading')}
                          {whisperStatus === 'stopped' && t('aiProvider.stopped')}
                          {whisperStatus === 'installing' && t('common.installing')}
                          {whisperStatus === 'error' && (whisperError || t('common.error'))}
                        </span>
                      </div>
                      {/* Start / Stop button */}
                      {whisperStatus === 'running' ? (
                        <button
                          onClick={handleWhisperStop}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors"
                          style={{ backgroundColor: colors.bg.primary, color: colors.text.normal }}
                        >
                          <Square className="h-3.5 w-3.5" /> {t('aiProvider.stop')}
                        </button>
                      ) : whisperStatus === 'starting' ? (
                        <Loader2 className="h-4 w-4 animate-spin" style={{ color: colors.accent.yellow }} />
                      ) : (
                        <button
                          onClick={handleWhisperStart}
                          disabled={whisperStatus === 'installing'}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors disabled:opacity-50"
                          style={{ backgroundColor: colors.accent.green, color: 'white' }}
                        >
                          <Play className="h-3.5 w-3.5" /> {t('aiProvider.start')}
                        </button>
                      )}
                    </div>

                    {/* Model dropdown */}
                    <div className="flex items-center gap-3">
                      <label className="text-sm font-medium flex-shrink-0" style={{ color: colors.text.header }}>
                        {t('aiProvider.model')}
                      </label>
                      <select
                        value={whisperModel}
                        onChange={(e) => handleWhisperModelChange(e.target.value)}
                        className="flex-1 px-3 py-2 rounded text-sm"
                        style={{ backgroundColor: colors.bg.primary, color: colors.text.normal, border: `1px solid ${colors.bg.hover}` }}
                      >
                        {WHISPER_MODELS.map((m) => (
                          <option key={m.id} value={m.id}>{t(m.nameKey)}</option>
                        ))}
                      </select>
                    </div>

                    {/* Advanced section (expandable) */}
                    <div>
                      <button
                        onClick={() => setWhisperShowAdvanced(!whisperShowAdvanced)}
                        className="flex items-center gap-1 text-xs transition-colors"
                        style={{ color: colors.text.muted }}
                      >
                        {whisperShowAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        {t('aiProvider.advanced')}
                      </button>
                      {whisperShowAdvanced && (
                        <div className="mt-2 space-y-2">
                          <div className="flex items-center gap-3">
                            <label className="text-xs font-medium flex-shrink-0 whitespace-nowrap" style={{ color: colors.text.header }}>
                              {t('aiProvider.customEndpoint')}
                            </label>
                            <input
                              type="text"
                              value={sttLocalEndpoint}
                              onChange={(e) => setSttLocalEndpoint(e.target.value)}
                              placeholder="http://localhost:8000"
                              className="flex-1 px-3 py-2 rounded text-sm"
                              style={{ backgroundColor: colors.bg.primary, color: colors.text.normal, border: `1px solid ${colors.bg.hover}` }}
                            />
                          </div>
                          <div className="flex items-center gap-3">
                            <label className="text-xs font-medium flex-shrink-0 whitespace-nowrap" style={{ color: colors.text.header }}>
                              {t('aiProvider.customModelOverride')}
                            </label>
                            <input
                              type="text"
                              value={sttLocalModel}
                              onChange={(e) => setSttLocalModel(e.target.value)}
                              placeholder="e.g. Systran/faster-whisper-large-v3"
                              className="flex-1 px-3 py-2 rounded text-sm"
                              style={{ backgroundColor: colors.bg.primary, color: colors.text.normal, border: `1px solid ${colors.bg.hover}` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {sttProvider === 'google' && (
              <div className="p-4 rounded space-y-2" style={{ backgroundColor: colors.bg.tertiary }}>
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium flex-shrink-0 whitespace-nowrap" style={{ color: colors.text.header }}>
                    {t('aiProvider.googleCloudApiKey')}
                  </label>
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type={sttShowGoogleKey ? 'text' : 'password'}
                      value={sttGoogleKey}
                      onChange={(e) => setSttGoogleKey(e.target.value)}
                      placeholder="AIza..."
                      className="flex-1 px-3 py-2 rounded text-sm"
                      style={{ backgroundColor: colors.bg.primary, color: colors.text.normal, border: `1px solid ${colors.bg.hover}` }}
                    />
                    <button
                      type="button"
                      onClick={() => setSttShowGoogleKey(!sttShowGoogleKey)}
                      className="p-2 rounded transition-colors"
                      style={{ color: colors.text.muted }}
                    >
                      {sttShowGoogleKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <p className="text-xs" style={{ color: colors.text.muted }}>
                  {t('aiProvider.googleSttHint')}
                  {byokApiKeys.google && ` ${t('aiProvider.prefilledFromByok', { provider: 'Google' })}`}
                </p>
              </div>
            )}

          </div>
          </div>)}
        </div>

        {/* Apply button + status */}
        <div className="rounded-lg p-6" style={{ backgroundColor: colors.bg.secondary }}>
          <button
            onClick={handleValidateAndSave}
            disabled={isSaving || isValidating}
            className="w-full py-3 rounded-lg font-semibold transition-colors disabled:opacity-50 flex items-center justify-center space-x-2"
            style={{ backgroundColor: colors.accent.brand, color: '#ffffff' }}
          >
            {(isSaving || isValidating) && <Loader2 className="h-4 w-4 animate-spin" />}
            <span>
              {isValidating ? t('aiProvider.validating') : isSaving ? t('aiProvider.applying') : t('aiProvider.applyChanges')}
            </span>
          </button>
          <p className="text-xs mt-2 text-center" style={{ color: colors.text.muted }}>
            {t('aiProvider.changesAfterRestart')}
          </p>
        </div>

      </div>
    </div>
  )
}
