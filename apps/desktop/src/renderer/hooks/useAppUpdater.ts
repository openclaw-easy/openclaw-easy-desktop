import { useState, useEffect } from 'react'
import { UpdateInfo } from '../types/electron'

export function useAppUpdater() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [checking, setChecking] = useState(false)

  // Listen for update event pushed from main process on startup
  useEffect(() => {
    const cleanup = window.electronAPI?.onUpdateAvailable?.((data) => {
      setUpdateInfo(data)
    })
    return () => {
      cleanup?.()
    }
  }, [])

  const checkForUpdates = async (): Promise<UpdateInfo | null> => {
    setChecking(true)
    try {
      const result = await window.electronAPI?.checkForUpdates?.()
      if (result?.hasUpdate) {
        setUpdateInfo(result)
      }
      return result ?? null
    } finally {
      setChecking(false)
    }
  }

  const downloadUpdate = async () => {
    if (!updateInfo?.downloads) return
    let url: string | undefined = updateInfo.downloads['win-x64']
    try {
      const sysInfo = await window.electronAPI?.getSystemInfo?.()
      if (sysInfo?.platform === 'darwin') {
        url = sysInfo.arch === 'arm64'
          ? updateInfo.downloads['mac-arm64']
          : updateInfo.downloads['mac-x64']
      } else if (sysInfo?.platform === 'linux') {
        url = updateInfo.downloads['linux-x64']
      }
    } catch {
      // fallback: check navigator.platform for mac, use x64
      if (navigator.platform.toLowerCase().includes('mac')) {
        url = updateInfo.downloads['mac-x64']
      }
    }
    if (url) {
      window.electronAPI?.openExternal?.(url)
    }
  }

  return {
    hasUpdate: (updateInfo?.hasUpdate ?? false) && !dismissed,
    updateInfo,
    dismissed,
    checking,
    checkForUpdates,
    downloadUpdate,
    dismissUpdate: () => setDismissed(true),
  }
}
