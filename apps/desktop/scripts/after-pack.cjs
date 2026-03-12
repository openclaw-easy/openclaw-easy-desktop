/**
 * electron-builder afterPack hook.
 *
 * Fixes execute permissions on native binaries that lose their +x bit
 * when electron-builder unpacks them from the asar archive.
 *
 * Currently fixes:
 *   - node-pty's `spawn-helper` binary (required for pty creation)
 */
const fs = require('fs')
const path = require('path')

function findFiles(dir, name, results = []) {
  if (!fs.existsSync(dir)) return results
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      findFiles(fullPath, name, results)
    } else if (entry.name === name) {
      results.push(fullPath)
    }
  }
  return results
}

exports.default = async function afterPack(context) {
  const appName = context.packager.appInfo.productFilename
  const platform = context.electronPlatformName

  let unpackedDir
  if (platform === 'darwin') {
    unpackedDir = path.join(
      context.appOutDir,
      `${appName}.app`,
      'Contents',
      'Resources',
      'app.asar.unpacked'
    )
  } else {
    // Windows / Linux
    unpackedDir = path.join(context.appOutDir, 'resources', 'app.asar.unpacked')
  }

  if (!fs.existsSync(unpackedDir)) {
    console.log('[afterPack] No app.asar.unpacked directory found, skipping')
    return
  }

  // Fix spawn-helper (node-pty)
  const helpers = findFiles(unpackedDir, 'spawn-helper')
  for (const helper of helpers) {
    fs.chmodSync(helper, 0o755)
    console.log(`[afterPack] Fixed execute permission: ${helper}`)
  }

  if (helpers.length === 0) {
    console.log('[afterPack] No spawn-helper files found (node-pty may not be installed)')
  }
}
