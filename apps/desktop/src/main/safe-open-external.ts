/**
 * Single chokepoint for every `shell.openExternal` call in the desktop
 * main process.
 *
 * Why centralize: `shell.openExternal` happily hands an attacker-
 * controlled URL straight to the OS, which will obey `file://`,
 * `javascript:`, `data:`, custom protocol handlers, and a long tail of
 * URL schemes that map to arbitrary command execution. Every site that
 * calls it MUST validate first.
 *
 * Audit findings (W2 cluster):
 *   - The IPC `system:open-external` validator at index.ts:1595 was
 *     correct but only protected that one handler.
 *   - `setWindowOpenHandler` at index.ts:378 passed `details.url`
 *     straight to `shell.openExternal` with NO validation.
 *   - The deprecated `new-window` handler at index.ts:2287 had the
 *     same gap (and the event itself is removed in Electron 31).
 *   - `model-manager.ts` calls `shell.openExternal` with hard-coded
 *     URLs, which is fine on its face, but the audit flagged that
 *     anything using `shell.openExternal` outside this gate is a future
 *     hazard.
 *
 * Single export. Use it everywhere; never call `shell.openExternal`
 * directly. There is an ESLint-style regression guard test in
 * `safe-open-external.test.ts` that fails CI if a direct call
 * re-appears in `src/main/`.
 */
import { shell } from 'electron'

/**
 * Validates a URL is safe to hand to the OS shell. Returns true iff
 * the URL parses cleanly AND uses http or https.
 *
 * Specifically rejects:
 *   - non-string input
 *   - empty / oversized strings
 *   - URLs that don't parse via the URL constructor (no protocol, etc.)
 *   - `file:`, `javascript:`, `data:`, `vbscript:` (the classic XSS-from-
 *     shell-handoff vectors)
 *   - custom protocols (`ms-cxh:`, `ms-windows-store:`, app-deeplinks)
 *     — those route to arbitrary OS handlers we don't audit.
 *
 * 2048-char ceiling is a sanity cap; browsers vary but no legitimate
 * deep-link URL we open is anywhere near that. Protects log volume +
 * limits the surface for catastrophic regex bombs.
 */
export function isSafeOpenExternalUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false
  if (url.length === 0 || url.length > 2048) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  return true
}

/**
 * Validates `url` and, if safe, invokes `shell.openExternal`. Returns
 * `true` on success, `false` when the URL was rejected by the validator
 * (with a `console.warn` line so the operator can see the block in
 * logs). Catches and logs `shell.openExternal` errors so callers don't
 * need a try/catch at every site.
 */
export async function safeOpenExternal(url: unknown): Promise<boolean> {
  if (!isSafeOpenExternalUrl(url)) {
    console.warn(
      `[safeOpenExternal] Blocked unsafe URL: ${typeof url === 'string' ? url.slice(0, 200) : typeof url}`,
    )
    return false
  }
  try {
    await shell.openExternal(url)
    return true
  } catch (err) {
    console.error('[safeOpenExternal] shell.openExternal threw:', err)
    return false
  }
}
