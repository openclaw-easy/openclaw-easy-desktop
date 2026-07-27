/**
 * Tests for OpenClawBundle.syncAssets — the copy from the packaged app
 * Resources into ~/.openclaw-easy/app.
 *
 * Pins the regression shipped in 2026.7.27: syncAssets copied a hardcoded
 * allowlist (dist/docs/extensions/skills + openclaw.mjs/package.json), so when
 * the build started vendoring workspace deps into `vendor/` and rewriting the
 * shipped package.json deps to `file:./vendor/<name>`, the vendor payload never
 * reached the install dir. `bun install` then failed outright
 * ("@openclaw/media-core@file:./vendor/openclaw-media-core failed to resolve"),
 * leaving no node_modules and a bundled runtime that died at import time.
 *
 * The fix mirrors every top-level entry the bundle ships, so the build script
 * stays the single source of truth for the payload.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { OpenClawBundle } from './openclaw-bundle'

// syncAssets is private; these tests exercise it directly because it is the
// unit that drifted from the build script.
type SyncAssets = (installDir: string, resourceDir: string, prune?: boolean) => void

let tmp: string
let resourceDir: string
let installDir: string
let syncAssets: SyncAssets

const write = (file: string, body: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, body)
}

beforeEach(() => {
  // realpath: macOS os.tmpdir() is a /var -> /private/var symlink.
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ocbundle-')))
  resourceDir = path.join(tmp, 'Resources', 'openclaw')
  installDir = path.join(tmp, 'home', '.openclaw-easy', 'app')
  fs.mkdirSync(installDir, { recursive: true })

  // A realistic shipped payload, including the vendored workspace deps.
  write(path.join(resourceDir, 'package.json'), '{"name":"openclaw"}')
  write(path.join(resourceDir, 'openclaw.mjs'), '// entry')
  write(path.join(resourceDir, 'bundle-stamp.json'), '{"commitShort":"abc1234"}')
  write(path.join(resourceDir, 'dist', 'entry.js'), '// dist')
  write(path.join(resourceDir, 'extensions', 'telegram', 'manifest.json'), '{}')
  write(path.join(resourceDir, 'skills', 'demo', 'SKILL.md'), '# demo')
  write(path.join(resourceDir, 'vendor', 'openclaw-media-core', 'package.json'), '{"name":"@openclaw/media-core"}')
  write(path.join(resourceDir, 'vendor', 'openclaw-media-core', 'dist', 'index.js'), '// media-core')

  const bundle = new OpenClawBundle(path.join(tmp, 'Resources'))
  syncAssets = (
    bundle as unknown as { syncAssets: SyncAssets }
  ).syncAssets.bind(bundle)
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('OpenClawBundle.syncAssets', () => {
  it('copies the vendored workspace deps the rewritten package.json points at', () => {
    syncAssets(installDir, resourceDir)

    const vendored = path.join(installDir, 'vendor', 'openclaw-media-core')
    expect(fs.existsSync(path.join(vendored, 'package.json'))).toBe(true)
    expect(fs.existsSync(path.join(vendored, 'dist', 'index.js'))).toBe(true)
  })

  it('copies every top-level entry the bundle ships, not a fixed allowlist', () => {
    syncAssets(installDir, resourceDir)

    const shipped = fs.readdirSync(resourceDir).sort()
    const installed = fs.readdirSync(installDir).sort()
    expect(installed).toEqual(shipped)
  })

  it('picks up a payload entry the build starts emitting without a code change', () => {
    write(path.join(resourceDir, 'brand-new-payload', 'data.bin'), 'x')

    syncAssets(installDir, resourceDir)

    expect(fs.existsSync(path.join(installDir, 'brand-new-payload', 'data.bin'))).toBe(true)
  })

  it('is idempotent — a second sync leaves the same tree', () => {
    syncAssets(installDir, resourceDir)
    const first = fs.readdirSync(installDir).sort()

    syncAssets(installDir, resourceDir)

    expect(fs.readdirSync(installDir).sort()).toEqual(first)
    expect(fs.readFileSync(path.join(installDir, 'openclaw.mjs'), 'utf8')).toBe('// entry')
  })

  it('removes lockfiles so a stale one cannot drive the install', () => {
    write(path.join(installDir, 'bun.lock'), 'stale')
    write(path.join(installDir, 'bun.lockb'), 'stale')
    write(path.join(installDir, 'pnpm-lock.yaml'), 'stale')

    syncAssets(installDir, resourceDir)

    expect(fs.existsSync(path.join(installDir, 'bun.lock'))).toBe(false)
    expect(fs.existsSync(path.join(installDir, 'bun.lockb'))).toBe(false)
    expect(fs.existsSync(path.join(installDir, 'pnpm-lock.yaml'))).toBe(false)
  })

  describe('upgrade (prune)', () => {
    it('drops files the new bundle no longer ships', () => {
      write(path.join(installDir, 'extensions', 'retired', 'manifest.json'), '{}')

      syncAssets(installDir, resourceDir, true)

      expect(fs.existsSync(path.join(installDir, 'extensions', 'retired'))).toBe(false)
      expect(fs.existsSync(path.join(installDir, 'extensions', 'telegram', 'manifest.json'))).toBe(true)
    })

    it('drops a whole top-level payload dir the new bundle dropped', () => {
      write(path.join(installDir, 'legacy-payload', 'old.js'), '// old')

      syncAssets(installDir, resourceDir, true)

      expect(fs.existsSync(path.join(installDir, 'legacy-payload'))).toBe(false)
    })

    it('keeps dotfile tool state the bundle does not own', () => {
      write(path.join(installDir, '.bun-install-stamp'), 'x')

      syncAssets(installDir, resourceDir, true)

      expect(fs.existsSync(path.join(installDir, '.bun-install-stamp'))).toBe(true)
    })

    it('keeps installer-owned state so the mirror does not wipe node_modules', () => {
      write(path.join(installDir, 'node_modules', 'zod', 'index.js'), '// dep')
      write(path.join(installDir, '.package-hash'), 'deadbeef')

      syncAssets(installDir, resourceDir, true)

      expect(fs.existsSync(path.join(installDir, 'node_modules', 'zod', 'index.js'))).toBe(true)
      expect(fs.readFileSync(path.join(installDir, '.package-hash'), 'utf8')).toBe('deadbeef')
    })

    it('refreshes vendored deps on upgrade instead of overlaying them', () => {
      write(
        path.join(installDir, 'vendor', 'openclaw-media-core', 'dist', 'removed-upstream.js'),
        '// orphan',
      )

      syncAssets(installDir, resourceDir, true)

      expect(
        fs.existsSync(path.join(installDir, 'vendor', 'openclaw-media-core', 'dist', 'removed-upstream.js')),
      ).toBe(false)
      expect(
        fs.existsSync(path.join(installDir, 'vendor', 'openclaw-media-core', 'dist', 'index.js')),
      ).toBe(true)
    })
  })
})
