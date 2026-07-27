/**
 * Pure path-traversal guards for session-manager.
 *
 * Audit W2.3: `deleteSession` accepted an `agentId` from the renderer
 * IPC and stitched it directly into `path.join(homedir, '.openclaw',
 * 'agents', agentId, 'sessions')` — a value like `../../../etc/passwd`
 * traverses out of the sessions root. The secondary `sessionFile`
 * field is read from the sessions store JSON and passed directly to
 * `fs.unlink`; a tampered store could point it at arbitrary paths.
 *
 * Helpers in this module are pure (no IO) so they're testable in
 * isolation and reusable from other managers that take an agentId.
 */

import * as path from 'path'

/**
 * Validates an agent id. Returns the trimmed id on success, null on
 * failure. The allowed shape mirrors `AgentBindingManager.normalizeAgentId`:
 * `[a-zA-Z0-9_-]{1,64}` with no leading dot.
 *
 * This is a STRICT validator: we never try to sanitize a bad id by
 * stripping characters, because that turns into a normalization
 * mismatch with the rest of the codebase (the routing engine uses
 * the OWN normalizer; we'd produce a different result and end up
 * deleting the wrong agent's data). Better to refuse outright and
 * let the caller surface the error.
 */
export function validateAgentId(id: unknown): string | null {
  if (typeof id !== 'string') return null
  const trimmed = id.trim()
  if (trimmed.length === 0 || trimmed.length > 64) return null
  // Path-traversal stop list.
  if (trimmed.includes('..')) return null
  if (trimmed.includes('/') || trimmed.includes('\\')) return null
  if (trimmed.includes('\0')) return null
  // Leading dot lets shells / globbers hide the dir; refuse outright.
  if (trimmed.startsWith('.')) return null
  // Whitelist character set. Matches the routing engine's path-safe
  // id constraint (AgentBindingManager.normalizeAgentId).
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null
  return trimmed
}

/**
 * Asserts that `candidate` resolves INSIDE `expectedRoot` after both
 * paths are normalized. Returns true if the candidate is safe to
 * delete (or otherwise operate on), false otherwise.
 *
 * Use after computing a path from untrusted input (e.g. a `sessionFile`
 * field read out of a JSON store on disk). DOES NOT walk symlinks —
 * if the caller is worried about TOCTOU via symlink, follow up with
 * `fs.realpath` and re-check. For our delete path, symlink-following
 * isn't a concern because the threat model is "tampered store file
 * points at a different absolute path", not "race between check and
 * unlink".
 */
export function isPathInsideRoot(candidate: string, expectedRoot: string): boolean {
  if (typeof candidate !== 'string' || candidate.length === 0) return false
  if (typeof expectedRoot !== 'string' || expectedRoot.length === 0) return false

  const normalizedRoot = path.resolve(expectedRoot)
  const normalizedCandidate = path.resolve(candidate)

  // On POSIX, the boundary check is straightforward. On Windows, path
  // separators may mix; `path.resolve` normalizes them already.
  // Ensure we treat the root as a directory boundary by appending the
  // separator before the prefix check — without it, `/foo/bar-evil`
  // would match `/foo/bar` as a prefix.
  const rootWithSep = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : normalizedRoot + path.sep

  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(rootWithSep)
  )
}
