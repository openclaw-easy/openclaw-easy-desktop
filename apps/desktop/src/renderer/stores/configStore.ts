import { create } from 'zustand'

// NOTE: This store is legacy/compat-only for wizard components.
// AI provider state is now managed by useProviderConfig hook + app-config.json.
// Do not add new AI-provider-related state here.
export interface AppConfig {
  apiProvider?: string
  apiKey?: string
  model?: string
  channels?: any
  [key: string]: any
}

interface ConfigState {
  config: AppConfig
  loadConfig: () => Promise<void>
  saveConfig: (config: AppConfig) => Promise<void>
  updateConfig: (partial: Partial<AppConfig>) => void
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: {},

  loadConfig: async () => {
    try {
      const loaded = await window.electronAPI?.getConfig?.()
      if (loaded) {
        set({ config: loaded })
      }
    } catch (error) {
      console.error('[ConfigStore] Failed to load config:', error)
    }
  },

  saveConfig: async (config: AppConfig) => {
    try {
      await window.electronAPI?.saveConfig?.(config)
      set({ config })
    } catch (error) {
      console.error('[ConfigStore] Failed to save config:', error)
    }
  },

  updateConfig: (partial: Partial<AppConfig>) => {
    set(state => ({ config: { ...state.config, ...partial } }))
  },
}))
