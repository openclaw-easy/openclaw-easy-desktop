import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { BrowserManager } from './browser-manager'

function makeManager(outputs: Record<string, string | Error> = {}, browserConfig?: any) {
  const store: any = browserConfig !== undefined ? { browser: browserConfig } : {}
  const configManager = {
    mutateConfig: vi.fn(async (mutator: (c: any) => boolean) => mutator(store) === true),
  }
  const executor = {
    executeCommand: vi.fn(async (args: string[]) => {
      const key = args.slice(0, 2).join(' ')
      const out = outputs[key]
      if (out instanceof Error) throw out
      return out ?? ''
    }),
  }
  return { mgr: new BrowserManager(configManager as any, executor), store, configManager }
}

describe('BrowserManager', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-manager-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('parses status JSON', async () => {
    const { mgr } = makeManager({
      'browser status': JSON.stringify({
        enabled: true, running: false, profile: 'openclaw',
        detectedBrowser: 'chrome', detectedExecutablePath: '/Applications/Chrome.app', pid: null,
      }),
    })
    const res = await mgr.getStatus()
    expect(res.success).toBe(true)
    expect(res.status).toMatchObject({ enabled: true, running: false, profile: 'openclaw', detectedBrowser: 'chrome' })
  })

  it('writes browser.enabled preserving other config keys, and is idempotent', async () => {
    const { mgr, store } = makeManager({}, { enabled: true, profile: 'custom' })
    await mgr.setEnabled(false)
    expect(store.browser).toEqual({ enabled: false, profile: 'custom' })
    const again = await mgr.setEnabled(false)
    expect(again.success).toBe(true)
    expect(store.browser).toEqual({ enabled: false, profile: 'custom' })
  })

  it('extracts the screenshot path and inlines the image as a data URL', async () => {
    const shotPath = path.join(tmp, 'shot.png')
    fs.writeFileSync(shotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const { mgr } = makeManager({ 'browser screenshot': `Saved screenshot\n${shotPath}\n` })
    const res = await mgr.screenshot()
    expect(res.success).toBe(true)
    expect(res.path).toBe(shotPath)
    expect(res.dataUrl).toMatch(/^data:image\/png;base64,/)
  })

  it('recognizes the Windows path the CLI prints there', async () => {
    // Regression: a POSIX-only "starts with /" check never matched "C:\…", so
    // the screenshot panel was dead on every Windows build. Asserted with a
    // literal Windows path so the test is meaningful on POSIX CI too.
    const { mgr } = makeManager({
      'browser screenshot': 'Saved screenshot\nC:\\Users\\alice\\AppData\\shot.png\n',
    })
    const res = await mgr.screenshot()
    // stat() on that path fails on POSIX; the point is that it got PAST
    // path extraction instead of reporting "produced no file path".
    expect(res.error).not.toMatch(/produced no file path/)
  })

  it('fails cleanly when the screenshot output has no path', async () => {
    const { mgr } = makeManager({ 'browser screenshot': 'nothing useful' })
    const res = await mgr.screenshot()
    expect(res.success).toBe(false)
  })
})
