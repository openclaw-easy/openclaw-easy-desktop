/**
 * EnvironmentManager is a self-healing cleanup that retires the legacy
 * global provider-credential persistence (the cause of the "403
 * Invalid or expired token" hijack — a stale BYOK OPENAI_API_KEY in the
 * global env overrode the configured credential). It:
 *  - always splices out the sentinel-fenced managed shell-rc block, and
 *  - clears launchctl/registry copies ONLY when the value matches a
 *    credential the app itself stores (ownership check) — never a value
 *    the user set for their own tooling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

let tmpHome: string

// Shared mutable state for the child_process mock (hoisted so the mock
// factory can close over it). `globalEnv` simulates the launchctl domain.
const h = vi.hoisted(() => ({
  calls: [] as Array<{ bin: string; args: string[] }>,
  globalEnv: {} as Record<string, string>,
}))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => tmpHome }
})

vi.mock('child_process', () => ({
  execFile: (bin: string, args: string[], _opts: any, cb: any) => {
    h.calls.push({ bin, args })
    if (bin === 'launchctl' && args[0] === 'getenv') {
      cb(null, (h.globalEnv[args[1]] ?? '') + '\n', '')
      return
    }
    if (bin === 'launchctl' && args[0] === 'unsetenv') {
      delete h.globalEnv[args[1]]
      cb(null, '', '')
      return
    }
    cb(null, '', '')
  },
}))

import { EnvironmentManager } from './environment-manager'
import { buildShellRcBlock, SHELL_RC_BLOCK_START } from './env-shell-escape'

function writeAppConfig(obj: unknown) {
  const dir = path.join(tmpHome, '.config', 'openclaw-desktop')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'app-config.json'), JSON.stringify(obj))
}
const unsetKeys = () => h.calls.filter(c => c.bin === 'launchctl' && c.args[0] === 'unsetenv').map(c => c.args[1])

describe('EnvironmentManager.initializeEnvironment (legacy env cleanup)', () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'envmgr-test-'))
    h.calls.length = 0
    h.globalEnv = {}
  })
  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  const zshrc = () => path.join(tmpHome, '.zshrc')

  it('removes the managed block (stale BYOK key) but keeps user lines', async () => {
    const block = buildShellRcBlock({
      OPENAI_API_KEY: 'sk-byok-stale',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
    })
    fs.writeFileSync(zshrc(), `export PATH=/usr/bin\n\n${block}\n\nalias g=git\n`)

    await new EnvironmentManager().initializeEnvironment()

    const after = fs.readFileSync(zshrc(), 'utf-8')
    expect(after).not.toContain(SHELL_RC_BLOCK_START)
    expect(after).not.toContain('sk-byok-stale')
    expect(after).toContain('export PATH=/usr/bin')
    expect(after).toContain('alias g=git')
  })

  it('clears an APP-OWNED launchctl var (value matches app-config) + its companion', async () => {
    if (process.platform !== 'darwin') return
    writeAppConfig({ byok: { apiKeys: { openai: 'sk-app-owned-123' } } })
    h.globalEnv = { OPENAI_API_KEY: 'sk-app-owned-123', OPENAI_BASE_URL: 'https://api.openai.com/v1' }

    await new EnvironmentManager().initializeEnvironment()

    expect(unsetKeys()).toContain('OPENAI_API_KEY')
    expect(unsetKeys()).toContain('OPENAI_BASE_URL') // companion cleared with its secret
  })

  it('does NOT clear a USER-OWNED launchctl var (value not in app-config)', async () => {
    if (process.platform !== 'darwin') return
    writeAppConfig({ byok: { apiKeys: { openai: 'sk-app-owned-123' } } })
    // The user's own global key — different from anything the app stores.
    h.globalEnv = { OPENAI_API_KEY: 'sk-the-users-personal-key' }

    await new EnvironmentManager().initializeEnvironment()

    expect(unsetKeys()).not.toContain('OPENAI_API_KEY')
    expect(unsetKeys()).not.toContain('OPENAI_BASE_URL')
    // And the user's value is untouched in our simulated domain.
    expect(h.globalEnv.OPENAI_API_KEY).toBe('sk-the-users-personal-key')
  })

  it('never touches ANTHROPIC_API_KEY (the app never wrote it)', async () => {
    if (process.platform !== 'darwin') return
    writeAppConfig({ byok: { apiKeys: { openai: 'sk-app-owned-123' } } })
    h.globalEnv = { ANTHROPIC_API_KEY: 'sk-ant-user' }

    await new EnvironmentManager().initializeEnvironment()

    expect(unsetKeys()).not.toContain('ANTHROPIC_API_KEY')
  })

  it('drops the vars from the current process env (process-local, safe)', async () => {
    process.env.OPENAI_API_KEY = 'sk-leaked'
    fs.writeFileSync(zshrc(), `${buildShellRcBlock({ OPENAI_API_KEY: 'x' })}\n`)

    await new EnvironmentManager().initializeEnvironment()

    expect(process.env.OPENAI_API_KEY).toBeUndefined()
  })

  it('is a no-op (no file write) when there is no managed block', async () => {
    const original = `export OPENAI_API_KEY="sk-user-own"\n`
    fs.writeFileSync(zshrc(), original)

    await new EnvironmentManager().initializeEnvironment()

    expect(fs.readFileSync(zshrc(), 'utf-8')).toBe(original)
  })

  it('is idempotent across repeated runs', async () => {
    fs.writeFileSync(zshrc(), `keep\n${buildShellRcBlock({ OPENAI_API_KEY: 'x' })}\nkeep2\n`)
    const mgr = new EnvironmentManager()
    await mgr.initializeEnvironment()
    const once = fs.readFileSync(zshrc(), 'utf-8')
    await mgr.updateEnvironmentVariables()
    expect(fs.readFileSync(zshrc(), 'utf-8')).toBe(once)
  })
})
