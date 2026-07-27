import * as path from 'path'
import * as fs from 'fs'
import { getVendoredCoreRoot } from './vendored-core-root'

/**
 * Dev-mode (non-packaged) OpenClaw spawn target.
 *
 * The gateway needs node:sqlite from first boot (upstream 2026.7 made SQLite
 * mandatory for config health-state writes); bun provides no node:sqlite, so
 * the old `bun src/index.ts` dev spawn dies instantly. Dev now runs the built
 * CLI under Node. This is the single owner of that decision; every dev-mode
 * spawn site must use it so a runtime change never has to touch seven
 * copy-pasted branches again.
 *
 * Requires a prior root `pnpm run build` (dist/ is gitignored). Unlike
 * upstream's `pnpm dev` watcher this does NOT rebuild — after editing
 * upstream src/, rebuild or the spawn silently runs the older dist.
 */
export interface DevOpenClawSpawn {
  /** Runtime binary — resolved from PATH; dev shells always have node. */
  runtime: string
  /** Absolute path to the built CLI entry (repo-root dist/entry.js). */
  entry: string
  /** Repo root — the CLI resolves plugins/config relative to it. */
  cwd: string
}

export function getDevOpenClawSpawn(): DevOpenClawSpawn {
  const repoRoot = getVendoredCoreRoot()
  // openclaw.mjs (the repo bin) accepts either build output name — mirror it.
  for (const name of ['entry.js', 'entry.mjs']) {
    const entry = path.join(repoRoot, 'dist', name)
    if (fs.existsSync(entry)) {
      return { runtime: 'node', entry, cwd: repoRoot }
    }
  }
  throw new Error(
    `Dev OpenClaw build missing: ${path.join(repoRoot, 'dist', 'entry.js')} — run "pnpm run build" at the repo root first.`
  )
}

/**
 * True when `runtime` is a bare PATH-resolved name ('node') rather than an
 * absolute/relative file path — existence diagnostics must skip those.
 */
export function isPathResolvedRuntime(runtime: string): boolean {
  return !runtime.includes(path.sep)
}
