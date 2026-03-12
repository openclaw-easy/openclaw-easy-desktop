import { vi } from 'vitest'

// Mock the 'electron' module globally — many main-process modules import from it.
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'home') return '/mock-home'
      if (name === 'userData') return '/mock-home/.config/openclaw-desktop'
      return `/mock-home/${name}`
    }),
    isPackaged: false,
    getName: vi.fn(() => 'Openclaw Easy'),
    getVersion: vi.fn(() => '1.0.0-test'),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn((s: string) => Buffer.from(s)),
    decryptString: vi.fn((b: Buffer) => b.toString()),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  shell: {
    openExternal: vi.fn(),
  },
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn(),
  },
}))
