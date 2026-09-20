import { describe, it, expect, vi, beforeEach } from 'vitest'

const autoUpdaterMock = vi.hoisted(() => ({
  autoDownload: true,
  autoInstallOnAppQuit: true,
  logger: {} as unknown,
  on: vi.fn(),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn(),
}))

vi.mock('electron-updater', () => ({ autoUpdater: autoUpdaterMock }))

import { AppUpdater, isNewerSemver } from './app-updater'

const makeDeps = (over: Partial<Parameters<typeof AppUpdater.prototype.constructor>[0]> = {}) => ({
  getWindow: () => null,
  isEnabled: async () => true,
  isPackaged: true,
  currentVersion: '2026.9.12',
  ...over,
})

beforeEach(() => {
  autoUpdaterMock.autoDownload = true
  autoUpdaterMock.autoInstallOnAppQuit = true
  autoUpdaterMock.on.mockReset()
  autoUpdaterMock.checkForUpdates.mockReset()
  autoUpdaterMock.downloadUpdate.mockReset()
  autoUpdaterMock.quitAndInstall.mockReset()
})

describe('isNewerSemver', () => {
  it('compares date-based versions numerically, not as strings', () => {
    // The bug a string compare produces: "2026.9.9" > "2026.9.20".
    expect(isNewerSemver('2026.9.20', '2026.9.9')).toBe(true)
    expect(isNewerSemver('2026.9.9', '2026.9.20')).toBe(false)
  })

  it('detects a newer release across each segment', () => {
    expect(isNewerSemver('2026.9.20', '2026.9.12')).toBe(true)
    expect(isNewerSemver('2026.10.1', '2026.9.30')).toBe(true)
    expect(isNewerSemver('2027.1.1', '2026.12.31')).toBe(true)
  })

  it('treats the same version as not newer', () => {
    expect(isNewerSemver('2026.9.20', '2026.9.20')).toBe(false)
  })

  it('tolerates a v prefix and a prerelease suffix', () => {
    expect(isNewerSemver('v2026.9.20', '2026.9.12')).toBe(true)
    expect(isNewerSemver('2026.9.20-beta.1', '2026.9.12')).toBe(true)
  })

  it('handles missing segments without claiming a downgrade is newer', () => {
    expect(isNewerSemver('2026.9', '2026.9.1')).toBe(false)
    expect(isNewerSemver('2026.10', '2026.9.1')).toBe(true)
  })
})

describe('AppUpdater consent guarantees', () => {
  it('disables automatic download and install-on-quit', () => {
    new AppUpdater(makeDeps() as never).init()
    expect(autoUpdaterMock.autoDownload).toBe(false)
    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(false)
  })

  it('never downloads when the user has turned updates off', async () => {
    const updater = new AppUpdater(makeDeps({ isEnabled: async () => false }) as never)
    const result = await updater.check()
    expect(result.hasUpdate).toBe(false)
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
  })

  it('does nothing in an unpackaged build, where there is no feed', async () => {
    const updater = new AppUpdater(makeDeps({ isPackaged: false }) as never)
    await updater.check()
    await updater.download()
    updater.install()
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
    expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled()
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
  })

  it('reports no update when the feed offers the same or an older version', async () => {
    autoUpdaterMock.checkForUpdates.mockResolvedValue({ updateInfo: { version: '2026.9.12' } })
    const result = await new AppUpdater(makeDeps() as never).check()
    expect(result.hasUpdate).toBe(false)
  })

  it('reports an update when the feed offers a newer version', async () => {
    autoUpdaterMock.checkForUpdates.mockResolvedValue({ updateInfo: { version: '2026.9.20' } })
    const result = await new AppUpdater(makeDeps() as never).check()
    expect(result).toEqual({ hasUpdate: true, latestVersion: '2026.9.20' })
  })

  it('refuses to install before a download has completed', () => {
    const updater = new AppUpdater(makeDeps() as never)
    updater.init()
    updater.install()
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
  })

  it('wires listeners only once across repeated init calls', () => {
    const updater = new AppUpdater(makeDeps() as never)
    updater.init()
    const first = autoUpdaterMock.on.mock.calls.length
    updater.init()
    expect(autoUpdaterMock.on.mock.calls.length).toBe(first)
  })

  it('surfaces a download failure instead of leaving the UI stuck', async () => {
    autoUpdaterMock.downloadUpdate.mockRejectedValue(new Error('network down'))
    const updater = new AppUpdater(makeDeps() as never)
    await expect(updater.download()).rejects.toThrow('network down')
  })
})
