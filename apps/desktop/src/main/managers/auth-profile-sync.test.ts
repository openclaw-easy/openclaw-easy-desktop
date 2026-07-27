import { describe, it, expect } from 'vitest'
import { buildAuthProfileSyncCommand } from './auth-profile-sync'

describe('buildAuthProfileSyncCommand', () => {
  it('builds paste-api-key targeting <provider>:default for BYOK keys', () => {
    const cmd = buildAuthProfileSyncCommand({ kind: 'byok-api-key', provider: 'google', apiKey: 'AIza-key' })
    expect(cmd).toEqual({
      args: [
        'models', 'auth', '--agent', 'main',
        'paste-api-key', '--provider', 'google', '--profile-id', 'google:default',
      ],
      stdinData: 'AIza-key',
    })
  })

  // Spawning the CLI with an empty stdin secret would fail its "Required"
  // validation — an empty credential means there is nothing to sync.
  it('returns null for empty or whitespace-only secrets', () => {
    expect(buildAuthProfileSyncCommand({ kind: 'byok-api-key', provider: 'google', apiKey: '' })).toBeNull()
    expect(buildAuthProfileSyncCommand({ kind: 'byok-api-key', provider: ' ', apiKey: 'k' })).toBeNull()
  })
})
