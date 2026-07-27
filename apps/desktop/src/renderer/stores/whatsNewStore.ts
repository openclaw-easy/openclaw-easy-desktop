import { create } from 'zustand'

const electron = (): any => (typeof window !== 'undefined' ? (window as any).electronAPI : undefined)

interface WhatsNewState {
  /** Modal visibility. */
  open: boolean
  /** Current app version, loaded once at init. */
  version: string
  /**
   * Gate: show the modal exactly once per version, and only on UPGRADES.
   * A fresh install (no lastSeenWhatsNewVersion yet) records the current
   * version silently — the onboarding wizard owns the first-run moment,
   * and stacking a second dialog on top of it would bury both.
   */
  init: () => Promise<void>
  /** Reopen manually (sidebar version badge). */
  show: () => void
  /** Dismiss and record the version so it never auto-shows again. */
  dismiss: () => void
}

export const useWhatsNewStore = create<WhatsNewState>((set, get) => ({
  open: false,
  version: '',

  init: async () => {
    const api = electron()
    if (!api?.getAppVersion || !api?.getSettings) return
    try {
      const [version, settings] = await Promise.all([api.getAppVersion(), api.getSettings()])
      if (!version) return
      set({ version })
      const lastSeen = settings?.lastSeenWhatsNewVersion
      if (!lastSeen) {
        // Fresh install — record silently, no modal.
        await api.updateSettings?.({ lastSeenWhatsNewVersion: version })
        return
      }
      if (lastSeen !== version) {
        set({ open: true })
      }
    } catch (err) {
      console.warn('[WhatsNew] init failed:', err)
    }
  },

  show: () => set({ open: true }),

  dismiss: () => {
    const { version } = get()
    set({ open: false })
    if (version) {
      void electron()?.updateSettings?.({ lastSeenWhatsNewVersion: version })
    }
  },
}))
