import { create } from 'zustand'

export type AIProvider = 'local' | 'openclaw-premium' | 'byok'

interface ProviderState {
  selectedProvider: AIProvider
  setProvider: (provider: AIProvider) => void
}

// NOTE: This store is legacy/compat-only. AI provider selection is now managed
// by useProviderConfig hook + app-config.json. Do not add new usage here.
export const useProviderStore = create<ProviderState>((set) => ({
  selectedProvider: 'local',
  setProvider: (selectedProvider) => set({ selectedProvider }),
}))
