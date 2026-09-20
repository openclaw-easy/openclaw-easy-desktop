import { useState, useEffect, useCallback } from 'react'
import { UpdateInfo } from '../types/electron'

/** Mirrors `UpdatePhase` in main/managers/app-updater.ts. */
export type UpdatePhase = 'idle' | 'available' | 'downloading' | 'downloaded' | 'error'

/**
 * Consented update flow: detect → user downloads → user restarts.
 *
 * Packaged builds download through electron-updater and install in place.
 * Unpackaged dev builds have no update feed, so `downloadUpdate` falls back
 * to opening the download page — which is what every build did before
 * in-app updates existed.
 */
export function useAppUpdater() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [checking, setChecking] = useState(false)
  const [phase, setPhase] = useState<UpdatePhase>('idle')
  const [percent, setPercent] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const offAvailable = window.electronAPI?.onUpdateAvailable?.((data) => {
      setUpdateInfo(data)
      setPhase('available')
    })
    const offProgress = window.electronAPI?.onUpdateDownloadProgress?.((p) => {
      setPhase('downloading')
      setPercent(p.percent)
    })
    const offDownloaded = window.electronAPI?.onUpdateDownloaded?.(() => {
      setPhase('downloaded')
      setPercent(100)
    })
    const offError = window.electronAPI?.onUpdateError?.((e) => {
      setPhase('error')
      setError(e.message)
    })
    return () => {
      offAvailable?.()
      offProgress?.()
      offDownloaded?.()
      offError?.()
    }
  }, [])

  const checkForUpdates = useCallback(async (): Promise<UpdateInfo | null> => {
    setChecking(true)
    setError(null)
    try {
      const result = await window.electronAPI?.checkForUpdates?.()
      if (result?.hasUpdate) {
        setUpdateInfo(result)
        setPhase('available')
      }
      return result ?? null
    } finally {
      setChecking(false)
    }
  }, [])

  /** User pressed "Download update". */
  const downloadUpdate = useCallback(async () => {
    setError(null)
    // Dev builds (and anything without a feed) still carry per-platform URLs;
    // send those to the browser rather than failing silently.
    if (updateInfo?.downloads && Object.keys(updateInfo.downloads).length > 0) {
      let url: string | undefined = updateInfo.downloads['win-x64']
      try {
        const sysInfo = await window.electronAPI?.getSystemInfo?.()
        if (sysInfo?.platform === 'darwin') {
          url =
            sysInfo.arch === 'arm64'
              ? updateInfo.downloads['mac-arm64']
              : updateInfo.downloads['mac-x64']
        } else if (sysInfo?.platform === 'linux') {
          url = updateInfo.downloads['linux-x64']
        }
      } catch {
        if (navigator.platform.toLowerCase().includes('mac')) {
          url = updateInfo.downloads['mac-x64']
        }
      }
      if (url) {
        window.electronAPI?.openExternal?.(url)
        return
      }
    }
    setPhase('downloading')
    const result = await window.electronAPI?.downloadUpdate?.()
    if (result && !result.ok) {
      setPhase('error')
      setError(result.error ?? 'Download failed')
    }
  }, [updateInfo])

  /** User pressed "Restart to install". */
  const installUpdate = useCallback(async () => {
    await window.electronAPI?.installUpdate?.()
  }, [])

  return {
    hasUpdate: (updateInfo?.hasUpdate ?? false) && !dismissed,
    updateInfo,
    dismissed,
    checking,
    phase,
    percent,
    error,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    dismissUpdate: () => setDismissed(true),
  }
}
