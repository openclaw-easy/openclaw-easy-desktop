/**
 * Pure helpers for safely handling environment variable names + values
 * that originate from user-edited config (provider names, API base URLs,
 * API keys) and are about to land on disk or get passed to `setenv` /
 * `setx`.
 *
 * Two trust boundaries to defend:
 *
 *   1. We pass values to system tools (`launchctl`, `setx`). Even when
 *      we use `execFile` with an explicit arg array (no shell), the
 *      receiving tool may itself interpret special characters. Strict
 *      validation of name + value is the belt-and-braces guard.
 *
 *   2. We write `export NAME="value"` lines into `~/.zshrc`,
 *      `~/.bash_profile`, etc. — files the user's shell reads at every
 *      session start. A value containing an unescaped `"`, backtick, or
 *      `$` BREAKS OUT of the double-quoted string and runs as code.
 *
 * The pre-2026-06-16 implementation did neither: it interpolated raw
 * values into `execCommand` shell strings AND into rc-file exports,
 * which audit W1.1 flagged as a critical persistent-command-injection
 * cluster.
 *
 * All helpers are pure (no IO, no globals). The caller decides whether
 * to throw or fall back to a safe default on validation failure.
 */

/**
 * Allowed environment variable names: POSIX rule plus leading-letter
 * requirement. Same as IEEE Std 1003.1 `name`: [a-zA-Z_][a-zA-Z0-9_]*.
 * We also forbid empty / null-byte / Unicode lookalikes by virtue of
 * the regex.
 */
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Returns true iff `name` is a safe POSIX environment variable name.
 *
 * Callers should reject if false rather than try to sanitize — there's
 * no recoverable transform for an attacker-controlled name. The set of
 * names we want to set is finite and known (`OPENAI_API_KEY`,
 * `OLLAMA_HOST`, etc.); a name outside that set means the config has
 * been tampered with and we should bail.
 */
export function validateEnvVarName(name: unknown): name is string {
  if (typeof name !== 'string') return false
  if (name.length === 0 || name.length > 256) return false
  return ENV_NAME_RE.test(name)
}

/**
 * Returns true iff `value` is safe to embed (after proper escaping) in
 * either a `launchctl setenv` invocation or a shell-rc `export` line.
 *
 * Specifically rejects:
 *   - non-string input
 *   - empty values (no legitimate use case in our codepath)
 *   - newlines / CR — these CANNOT be safely embedded inside a
 *     double-quoted shell value, they always end the `export` line
 *     and the next line becomes a fresh shell statement.
 *   - NUL bytes — argv truncation surface on every shell
 *   - lengths > 4096 — sanity ceiling, prevents disk-bloat-via-shell-rc.
 *
 * Characters that LOOK dangerous (`$`, backtick, `"`, `\`) are NOT
 * rejected here — they're handled by {@link escapePosixShellDoubleQuoted}.
 * Rejecting them outright would block legitimate API base URLs and
 * tokens that contain them.
 */
export function validateEnvVarValue(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0) return false
  if (value.length > 4096) return false
  if (value.includes('\n')) return false
  if (value.includes('\r')) return false
  if (value.includes('\0')) return false
  return true
}

/**
 * Escapes a string so it can be safely interpolated INSIDE a POSIX
 * shell double-quoted context. Use as:
 *
 *   export KEY="${escapePosixShellDoubleQuoted(value)}"
 *
 * Inside `"..."`, the shell only interprets `$`, backtick, and `\`
 * (when followed by `$`, backtick, `"`, `\`, or newline). Everything
 * else — including `;`, `&&`, `|`, `(`, `)` — is literal. So our job
 * is to backslash-escape exactly those four characters.
 *
 * `"` itself must also be backslashed otherwise it closes the quote.
 *
 * Callers MUST gate inputs through {@link validateEnvVarValue} first;
 * this helper does NOT handle newlines (they end the export line and
 * no amount of escaping fixes that).
 */
export function escapePosixShellDoubleQuoted(value: string): string {
  if (typeof value !== 'string') {
    throw new TypeError('escapePosixShellDoubleQuoted requires a string')
  }
  // Order matters — backslash MUST come first or we re-escape the
  // backslashes we add for the other characters.
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')
    .replace(/"/g, '\\"')
}

/**
 * Builds a shell-rc block bounded by sentinel comments. Any previous
 * block (matched by the same sentinels) gets replaced atomically;
 * surrounding user content is preserved verbatim.
 *
 * This is the SAFE way to manage a set of `export` lines in a file the
 * user owns: we never append-then-grow, never partial-update, never
 * leave half-written lines on disk. The whole managed block is rewritten
 * from a validated set of key/value pairs.
 *
 * Returns the new file contents — caller writes to disk atomically.
 *
 * Throws if any key/value fails validation (the caller should catch and
 * surface; we will NOT smuggle invalid values into a shell-rc file).
 */
export const SHELL_RC_BLOCK_START = '# >>> openclaw-easy env (managed - do not edit) >>>'
export const SHELL_RC_BLOCK_END = '# <<< openclaw-easy env (managed - do not edit) <<<'

export function buildShellRcBlock(vars: Record<string, string>): string {
  const lines: string[] = [SHELL_RC_BLOCK_START]
  // Sort keys for deterministic output (idempotency-friendly).
  const sortedKeys = Object.keys(vars).sort()
  for (const key of sortedKeys) {
    if (!validateEnvVarName(key)) {
      throw new Error(`Refusing to write malformed env var name to shell rc: ${JSON.stringify(key)}`)
    }
    const value = vars[key]
    if (!validateEnvVarValue(value)) {
      throw new Error(`Refusing to write malformed env var value for ${key} to shell rc`)
    }
    lines.push(`export ${key}="${escapePosixShellDoubleQuoted(value)}"`)
  }
  lines.push(SHELL_RC_BLOCK_END)
  return lines.join('\n')
}

/**
 * Replaces (or inserts) the managed block in `existingContent`. If a
 * managed block already exists, the WHOLE block is replaced with
 * `newBlock`. If no managed block exists, `newBlock` is appended with a
 * blank-line separator.
 *
 * Pure — returns the new file contents. Caller writes to disk.
 *
 * Idempotent: passing the same `existingContent` + same `vars` twice
 * yields the same output both times.
 */
export function spliceShellRcBlock(existingContent: string, newBlock: string): string {
  // Match the managed block from start sentinel through end sentinel,
  // allowing any content between (including newlines). Anchored so we
  // only ever touch ONE block — a tampered file with multiple blocks
  // would have its FIRST block replaced and a warning logged by the
  // caller; we don't try to be clever.
  const blockRe = new RegExp(
    `${escapeRegExp(SHELL_RC_BLOCK_START)}[\\s\\S]*?${escapeRegExp(SHELL_RC_BLOCK_END)}`,
  )
  if (blockRe.test(existingContent)) {
    return existingContent.replace(blockRe, newBlock)
  }
  // Append with a blank-line separator if the file is non-empty.
  if (existingContent.length === 0) return newBlock + '\n'
  const sep = existingContent.endsWith('\n') ? '\n' : '\n\n'
  return existingContent + sep + newBlock + '\n'
}

/**
 * Removes the managed block (and the blank lines hugging it) from
 * `existingContent`. Returns the content unchanged when no managed block
 * is present. Pure — caller writes to disk.
 *
 * Used to retire the legacy practice of persisting provider API keys into
 * shell-rc files: the gateway reads credentials from openclaw.json, and a
 * stray global OPENAI_API_KEY silently overrides the configured
 * credential. Removing the block lets the gateway fall back to config.
 */
export function removeShellRcBlock(existingContent: string): string {
  const blockRe = new RegExp(
    `\\n*${escapeRegExp(SHELL_RC_BLOCK_START)}[\\s\\S]*?${escapeRegExp(SHELL_RC_BLOCK_END)}\\n*`,
  )
  if (!blockRe.test(existingContent)) return existingContent
  // Replace the block plus its surrounding blank lines with a single
  // newline so we neither glue neighboring lines together nor leave a
  // widening gap on repeated runs (idempotent).
  const next = existingContent.replace(blockRe, '\n')
  // A block that sat at the very top leaves a leading newline; trim it.
  return next.startsWith('\n') && !existingContent.startsWith('\n') ? next.slice(1) : next
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
