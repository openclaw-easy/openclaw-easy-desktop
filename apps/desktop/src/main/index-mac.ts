/**
 * index-mac.ts — macOS-specific IPC handlers and app behaviours
 *
 * Called from index.ts only when process.platform === 'darwin'.
 * No Windows-specific code lives here.
 */

import { ipcMain, shell, systemPreferences, nativeImage, app } from 'electron'
import type { BrowserWindow } from 'electron'

export function registerMacHandlers(getMainWindow: () => BrowserWindow | null): void {
  // ── Permissions ───────────────────────────────────────────────────────────

  ipcMain.handle('permissions:check-all', async () => {
    return {
      microphone:    systemPreferences.getMediaAccessStatus('microphone'),
      camera:        systemPreferences.getMediaAccessStatus('camera'),
      screen:        systemPreferences.getMediaAccessStatus('screen'),
      accessibility: systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'not-determined',
    }
  })

  ipcMain.handle('permissions:request', async (_, type: 'microphone' | 'camera') => {
    return await systemPreferences.askForMediaAccess(type)
  })

  ipcMain.handle('permissions:open-system-settings', async (_, type: string) => {
    const urls: Record<string, string> = {
      microphone:    'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
      camera:        'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
      screen:        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      automation:    'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
    }
    const url = urls[type]
    if (url) { await shell.openExternal(url); return true }
    return false
  })
}

/**
 * Sets the macOS dock icon in development mode.
 * In production the icon is baked into the .app bundle — setting at runtime
 * would cause a visible flicker as macOS updates the dock entry.
 */
export function setupMacDockIcon(lobsterDockIconPath: string): void {
  if (!app.isReady()) { return }
  const dockNativeImage = nativeImage.createFromPath(lobsterDockIconPath)
  if (!dockNativeImage.isEmpty()) {
    app.dock.setIcon(dockNativeImage)
  }
}
