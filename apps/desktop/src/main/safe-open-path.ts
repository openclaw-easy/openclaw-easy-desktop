/**
 * Single chokepoint for `shell.openPath` on local directories (the
 * "Open folder" button on the Agent Workspace page).
 *
 * Why centralize: `shell.openPath` hands a path to the OS file manager.
 * Unlike `shell.openExternal` it does not run URL-scheme handlers, so the
 * blast radius is smaller — but a renderer-influenced path could still try
 * to reveal arbitrary locations. Every agent workspace lives under the
 * user's home dir (`~/.openclaw/workspace`, `~/.openclaw/workspace-<id>`,
 * or a configured path under home), so we only ever open an EXISTING
 * directory that resolves inside home. Mirrors `safe-open-external.ts`;
 * there is a regression-guard test in `safe-open-path.test.ts`.
 */
import { shell } from 'electron'
import { homedir } from 'os'
import { resolve, sep } from 'path'
import { statSync } from 'fs'

/**
 * True iff `dir` is a string naming an existing directory that resolves
 * within the user's home directory. Rejects:
 *   - non-string / empty / oversized input
 *   - paths that resolve outside `~` (traversal, absolute system paths)
 *   - paths that don't exist or aren't directories
 */
export function isSafeWorkspaceDir(dir: unknown): dir is string {
  if (typeof dir !== 'string') return false
  if (dir.length === 0 || dir.length > 4096) return false
  const resolved = resolve(dir)
  const home = resolve(homedir())
  // Inside home (or home itself). `home + sep` prevents a sibling like
  // `/Users/xinru-evil` from passing a naive prefix check.
  if (resolved !== home && !resolved.startsWith(home + sep)) return false
  try {
    return statSync(resolved).isDirectory()
  } catch {
    return false
  }
}

/**
 * Reveal a workspace directory in the OS file manager. Returns a
 * `{ success }` result rather than throwing so IPC callers can surface a
 * toast. Never opens anything that fails `isSafeWorkspaceDir`.
 */
export async function safeOpenWorkspaceDir(
  dir: unknown,
): Promise<{ success: boolean; error?: string }> {
  if (!isSafeWorkspaceDir(dir)) {
    return {
      success: false,
      error: 'Refusing to open path — must be an existing directory inside your home folder.',
    }
  }
  // shell.openPath resolves to '' on success, or an OS error string.
  const err = await shell.openPath(resolve(dir))
  if (err) return { success: false, error: err }
  return { success: true }
}
