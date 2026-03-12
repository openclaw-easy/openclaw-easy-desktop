#!/usr/bin/env node
/**
 * Fixes the macOS dock tooltip showing "Electron" in dev mode.
 *
 * Root cause: macOS reads the dock tooltip from the .app BUNDLE FOLDER NAME,
 * not from CFBundleName/CFBundleDisplayName in the plist. Since the electron
 * npm package ships as "Electron.app", the dock always shows "Electron".
 *
 * Fix: rename "Electron.app" → "Openclaw Easy.app", update path.txt so the
 * electron package still finds the binary, patch the plist, re-register with
 * LaunchServices, and restart the Dock.
 */
import { execSync } from 'child_process'
import { existsSync, renameSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

if (process.platform !== 'darwin') {
  process.exit(0)
}

const APP_NAME = 'Openclaw Easy'
const distDir = resolve(__dirname, '../node_modules/electron/dist')
const electronApp = resolve(distDir, 'Electron.app')
const renamedApp = resolve(distDir, `${APP_NAME}.app`)
const pathTxt = resolve(__dirname, '../node_modules/electron/path.txt')

// Step 1: rename the .app bundle if not already renamed.
// Track whether we actually performed a rename — if the bundle was already
// renamed from a previous run, we skip the Dock restart (which causes the
// visible dock flicker on every app launch).
let didRename = false
if (existsSync(electronApp)) {
  renameSync(electronApp, renamedApp)
  didRename = true
  console.log(`[patch-plist] Renamed Electron.app → "${APP_NAME}.app"`)
} else if (!existsSync(renamedApp)) {
  console.warn('[patch-plist] Neither Electron.app nor renamed bundle found — skipping')
  process.exit(0)
}

// Step 2: update path.txt so require('electron') still resolves the binary
writeFileSync(pathTxt, `${APP_NAME}.app/Contents/MacOS/Electron`)
console.log('[patch-plist] Updated electron path.txt')

// Step 3: patch the plist inside the renamed bundle
const plist = resolve(renamedApp, 'Contents/Info.plist')
const pb = '/usr/libexec/PlistBuddy'

function set(key, value) {
  try {
    execSync(`${pb} -c "Set ${key} ${value}" "${plist}"`, { stdio: 'pipe' })
  } catch {
    try {
      execSync(`${pb} -c "Add ${key} string ${value}" "${plist}"`, { stdio: 'pipe' })
    } catch (e) {
      console.warn(`[patch-plist] Could not set ${key}:`, e.message)
    }
  }
}

set('CFBundleName', APP_NAME)
set('CFBundleDisplayName', APP_NAME)
console.log(`[patch-plist] Patched Info.plist → "${APP_NAME}"`)

// Step 4: force LaunchServices to re-index the renamed bundle
const lsregister =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
try {
  execSync(`"${lsregister}" -f "${renamedApp}"`, { stdio: 'pipe' })
  console.log('[patch-plist] Re-registered with LaunchServices')
} catch (e) {
  console.warn('[patch-plist] lsregister failed:', e.message)
}

// Step 5: restart the Dock to pick up the new bundle name — but ONLY when we
// actually renamed the bundle. On subsequent launches the bundle is already
// named correctly, so killing the Dock is unnecessary and causes the visible
// dock flicker that users notice on every startup.
if (didRename) {
  try {
    execSync('killall Dock', { stdio: 'pipe' })
    console.log('[patch-plist] Restarted Dock')
  } catch (e) {
    console.warn('[patch-plist] killall Dock failed:', e.message)
  }
} else {
  console.log('[patch-plist] Bundle already patched — skipping Dock restart')
}
