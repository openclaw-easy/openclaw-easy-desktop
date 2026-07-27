import path from 'path'

/**
 * Absolute path to the vendored OpenClaw core checked in at the repo root.
 *
 * Compiled main-process code runs from `apps/desktop/out/main`, so the repo
 * root is four levels up and the core sits in `openclaw/` beneath it.
 *
 * Kept in one place because three separate callers (dev spawn, extensions
 * lookup, bundled-plugin scan) each need it: when they hardcoded the hop
 * count individually they silently resolved to a directory outside the repo
 * and failed as "not found" rather than as a path bug.
 *
 * Dev-mode only. The packaged app installs the core under
 * `~/.openclaw-easy/app` and must not use this.
 */
export function getVendoredCoreRoot(): string {
  return path.resolve(__dirname, '..', '..', '..', '..', 'openclaw')
}
