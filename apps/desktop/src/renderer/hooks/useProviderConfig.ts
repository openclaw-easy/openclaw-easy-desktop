import { useState, useEffect, useCallback } from 'react'

export interface AppProviderConfig {
  aiProvider: 'byok' | 'local'
  byok?: {
    provider: 'google' | 'anthropic' | 'openai' | 'venice' | 'openrouter'
    model: string
    apiKeys?: { google?: string; anthropic?: string; openai?: string; venice?: string; openrouter?: string }
  }
  local?: { model: string }
  stt?: {
    provider: 'local' | 'openai' | 'google'
    openaiApiKey?: string
    googleApiKey?: string
    localEndpoint?: string
    localModel?: string
  }
}

export interface RemoteModel {
  id: string
  name: string
}

export function useProviderConfig() {
  const [config, setConfig] = useState<AppProviderConfig | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [installedModels, setInstalledModels] = useState<string[]>([])

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const appConfig = await window.electronAPI?.getConfig?.()
      setConfig(appConfig || { aiProvider: 'local', local: { model: 'llama3.2:3b' } })

      // Load installed Ollama models (Ollama may not be running — ignore errors)
      try {
        const models = await window.electronAPI?.getInstalledModels?.()
        if (Array.isArray(models)) {
          setInstalledModels(models.map((m: any) => m.id || m.name || String(m)).filter(Boolean))
        }
      } catch {
        // Ollama not running, no installed models to show
      }
    } catch (error) {
      console.error('[useProviderConfig] Failed to load config:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const saveAndApply = useCallback(async (newConfig: AppProviderConfig) => {
    setIsSaving(true)
    setSaveError(null)
    try {
      await window.electronAPI?.saveConfig?.(newConfig)
      setConfig(newConfig)
    } catch (error: any) {
      setSaveError(error.message || 'Failed to save configuration')
      throw error
    } finally {
      setIsSaving(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { config, isLoading, isSaving, saveError, saveAndApply, reload: load, installedModels }
}
