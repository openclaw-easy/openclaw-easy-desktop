/**
 * index-windows.ts — Windows-specific IPC handlers and app behaviours
 *
 * Called from index.ts only when process.platform === 'win32'.
 * No macOS-specific code lives here.
 */

import { ipcMain, shell } from 'electron'
import type { BrowserWindow } from 'electron'

export function registerWindowsHandlers(getMainWindow: () => BrowserWindow | null): void {
  // ── Permissions ───────────────────────────────────────────────────────────
  // Windows does not use Electron's systemPreferences API.
  // Permission state is read in the renderer via the Web Permissions API (navigator.permissions).
  // "Open Settings" deep-links to the Windows Settings privacy pages.

  ipcMain.handle('permissions:check-all', async () => {
    // Return null — the renderer's WindowsPermissionsSection uses navigator.permissions directly
    return null
  })

  ipcMain.handle('permissions:request', async () => {
    // Not applicable on Windows — return true to avoid blocking callers
    return true
  })

  ipcMain.handle('permissions:open-system-settings', async (_, type: string) => {
    const urls: Record<string, string> = {
      microphone: 'ms-settings:privacy-microphone',
      camera:     'ms-settings:privacy-webcam',
    }
    const url = urls[type]
    if (url) { await shell.openExternal(url); return true }
    return false
  })

  // ── Window controls (frameless window) ───────────────────────────────────
  ipcMain.handle('window:minimize', () => {
    getMainWindow()?.minimize()
  })

  ipcMain.handle('window:maximize', () => {
    const win = getMainWindow()
    if (!win) return
    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
  })

  ipcMain.handle('window:close', () => {
    getMainWindow()?.close()
  })

}
