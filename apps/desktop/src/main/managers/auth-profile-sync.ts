/**
 * Auth-profile sync command builder.
 *
 * Since OpenClaw 2026.7.x the gateway resolves provider credentials from the
 * per-agent SQLite auth store (agents/main/agent/openclaw-agent.sqlite), and
 * profiles there OUTRANK `models.providers.<id>.apiKey` in openclaw.json.
 * The legacy JSON files (~/.openclaw/auth-profiles.json, agents/main/auth.json)
 * were one-time-migrated into SQLite (doctor migration receipts) and are never
 * re-read, so writing them is a silent no-op — that dead path left a stale
 * key under `<provider>:default` that the gateway kept sending (HTTP 401 on
 * every reply).
 *
 * The only supported external write path into the SQLite store is the CLI:
 *   openclaw models auth --agent main paste-api-key (provider API keys)
 * It reads the secret from piped stdin when not a TTY, so the secret never
 * appears in argv (visible via `ps`) or spawn diagnostics logs.
 */

/** BYOK: store the user's provider API key. */
export type AuthProfileSyncRequest = { kind: 'byok-api-key'; provider: string; apiKey: string }

export interface AuthProfileSyncCommand {
  args: string[]
  /** Secret piped to the CLI's stdin — must never be placed in args. */
  stdinData: string
}

/**
 * Build the CLI invocation for a credential sync, or null when the request
 * carries no secret (nothing to write).
 *
 * Profile id is always `<provider>:default` — the same id the desktop's old
 * JSON writer used and the id an existing stale profile sits under, so the
 * upsert atomically replaces a wrong credential instead of leaving it ranked
 * first.
 */
export function buildAuthProfileSyncCommand(req: AuthProfileSyncRequest): AuthProfileSyncCommand | null {
  const apiKey = req.apiKey.trim()
  const provider = req.provider.trim()
  if (!apiKey || !provider) return null
  return {
    args: [
      'models', 'auth', '--agent', 'main',
      'paste-api-key', '--provider', provider, '--profile-id', `${provider}:default`,
    ],
    stdinData: apiKey,
  }
}
