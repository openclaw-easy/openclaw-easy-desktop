import { create } from 'zustand'

export type ThemeMode = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

interface ThemeState {
  mode: ThemeMode
  resolved: ResolvedTheme
  systemPrefersDark: boolean
  setMode: (mode: ThemeMode) => Promise<void>
  loadFromSettings: () => Promise<void>
  applyToDocument: () => void
  initSystemWatcher: () => () => void
}

function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return systemPrefersDark ? 'dark' : 'light'
  return mode
}

function applyResolved(resolved: ResolvedTheme) {
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.dataset.theme = resolved
}

const electron = (): any => (typeof window !== 'undefined' ? (window as any).electronAPI : undefined)

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: 'system',
  resolved: 'light',
  systemPrefersDark: typeof window !== 'undefined'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false,

  setMode: async (mode) => {
    const resolved = resolveTheme(mode, get().systemPrefersDark)
    set({ mode, resolved })
    applyResolved(resolved)
    try {
      await electron()?.updateSettings?.({ theme: mode })
    } catch (e) {
      // Persistence is best-effort; theme still applies in-memory.
      console.warn('[themeStore] persist failed', e)
    }
  },

  loadFromSettings: async () => {
    try {
      const settings = await electron()?.getSettings?.()
      const saved = (settings?.theme as ThemeMode | undefined) ?? 'system'
      const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      const resolved = resolveTheme(saved, systemPrefersDark)
      set({ mode: saved, resolved, systemPrefersDark })
      applyResolved(resolved)
    } catch {
      // No settings yet — apply system default.
      get().applyToDocument()
    }
  },

  applyToDocument: () => {
    applyResolved(get().resolved)
  },

  initSystemWatcher: () => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {}
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => {
      const systemPrefersDark = e.matches
      const { mode } = get()
      const resolved = resolveTheme(mode, systemPrefersDark)
      set({ systemPrefersDark, resolved })
      applyResolved(resolved)
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  },
}))
