#!/usr/bin/env node
/**
 * Ensure the vendored OpenClaw core has its control-UI assets built.
 *
 * Wired as a `predev` / `prebuild` hook in package.json. Idempotent:
 * exits in <50ms once the assets exist.
 *
 * The gateway serves `dist/control-ui` for the desktop's "Open Web UI"
 * button. It resolves that path once at startup and caches a negative
 * result, so assets missing at boot mean every later click 404s until the
 * gateway restarts — building them up front avoids that entirely.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
// scripts/ → desktop/ → apps/ → repo root; the core is vendored under openclaw/.
const repoRoot = path.resolve(here, '..', '..', '..')
const coreRoot = path.join(repoRoot, 'openclaw')
const indexPath = path.join(coreRoot, 'dist', 'control-ui', 'index.html')

if (fs.existsSync(indexPath)) {
  process.exit(0)
}

if (!fs.existsSync(path.join(coreRoot, 'package.json'))) {
  console.error(`[ensure-control-ui] vendored core not found at ${coreRoot}`)
  process.exit(1)
}

console.log('[ensure-control-ui] dist/control-ui not built — running pnpm ui:build…')
console.log(`[ensure-control-ui] cwd: ${coreRoot}`)
const result = spawnSync('pnpm', ['ui:build'], {
  cwd: coreRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (result.status !== 0) {
  console.error('[ensure-control-ui] pnpm ui:build failed.')
  console.error(`  cd ${coreRoot} && pnpm ui:build`)
  process.exit(result.status ?? 1)
}
if (!fs.existsSync(indexPath)) {
  console.error('[ensure-control-ui] ui:build completed but', indexPath, 'is still missing.')
  process.exit(1)
}
console.log('[ensure-control-ui] dist/control-ui built ✓')
process.exit(0)
