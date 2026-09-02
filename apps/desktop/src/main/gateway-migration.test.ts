import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  findLegacyAuthCredentialFiles,
  isMigrationRequiredGatewayFailure,
  GATEWAY_EXIT_CONFIG_ERROR
} from './gateway-migration'

describe('isMigrationRequiredGatewayFailure', () => {
  it('matches the config-error exit code regardless of output', () => {
    expect(isMigrationRequiredGatewayFailure(GATEWAY_EXIT_CONFIG_ERROR, '')).toBe(true)
  })

  it('matches the auth-profile migration error message (exit code lost)', () => {
    const msg =
      'AuthProfileMigrationRequiredError: Auth profile store ~/.openclaw/agents/main/agent/openclaw-agent.sqlite requires legacy credential migration; run openclaw doctor --fix.'
    expect(isMigrationRequiredGatewayFailure(1, msg)).toBe(true)
  })

  it('matches the agent-DB media migration message', () => {
    const msg =
      'OpenClaw agent database ~/.openclaw/agents/main/agent/openclaw-agent.sqlite uses schema version 15; run openclaw doctor --fix to migrate persisted media before using it.'
    expect(isMigrationRequiredGatewayFailure(1, msg)).toBe(true)
  })

  it('matches the daemon preflight hint with backticks', () => {
    expect(isMigrationRequiredGatewayFailure(1, 'Run `openclaw doctor --fix`, then retry this command.')).toBe(true)
    // Upstream's config-validation gate double-quotes the command (observed
    // 2026-08-31 on `gateway.tailscale.resetOnExit` after the Aug-31 sync).
    expect(
      isMigrationRequiredGatewayFailure(
        1,
        'openclaw.json:580 - gateway.tailscale: Unrecognized key: "resetOnExit"\nRun "openclaw doctor --fix" to repair, then retry.'
      )
    ).toBe(true)
  })

  it('does not match ordinary crashes', () => {
    expect(isMigrationRequiredGatewayFailure(1, 'Error: listen EADDRINUSE :::18789')).toBe(false)
    expect(isMigrationRequiredGatewayFailure(null, '')).toBe(false)
    expect(isMigrationRequiredGatewayFailure(0, '')).toBe(false)
  })
})

describe('findLegacyAuthCredentialFiles', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.promises.realpath(await fs.promises.mkdtemp(path.join(os.tmpdir(), 'oc-migration-')))
  })

  afterEach(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true })
  })

  it('returns empty for a clean state dir', () => {
    expect(findLegacyAuthCredentialFiles(dir)).toEqual([])
  })

  it('returns empty when the openclaw dir does not exist at all', () => {
    expect(findLegacyAuthCredentialFiles(path.join(dir, 'nope'))).toEqual([])
  })

  it('ignores a root-level auth-profiles.json — upstream only gates per-agent files', () => {
    fs.writeFileSync(path.join(dir, 'auth-profiles.json'), '{}')
    expect(findLegacyAuthCredentialFiles(dir)).toEqual([])
  })

  it('finds per-agent retired files across multiple agents', () => {
    const a = path.join(dir, 'agents', 'main', 'agent')
    const b = path.join(dir, 'agents', 'work', 'agent')
    fs.mkdirSync(a, { recursive: true })
    fs.mkdirSync(b, { recursive: true })
    fs.writeFileSync(path.join(a, 'auth-profiles.json'), '{}')
    fs.writeFileSync(path.join(b, 'auth.json'), '{}')
    expect(findLegacyAuthCredentialFiles(dir).toSorted()).toEqual(
      [path.join(a, 'auth-profiles.json'), path.join(b, 'auth.json')].toSorted()
    )
  })

  it('ignores non-credential siblings and already-migrated backups', () => {
    const a = path.join(dir, 'agents', 'main', 'agent')
    fs.mkdirSync(a, { recursive: true })
    fs.writeFileSync(path.join(a, 'auth-state.json'), '{}')
    fs.writeFileSync(path.join(a, 'auth-profiles.json.migrated-2026-07-31'), '{}')
    fs.writeFileSync(path.join(a, 'models.json'), '{}')
    expect(findLegacyAuthCredentialFiles(dir)).toEqual([])
  })

  it('ignores directories that shadow the retired filenames', () => {
    fs.mkdirSync(path.join(dir, 'auth-profiles.json'), { recursive: true })
    expect(findLegacyAuthCredentialFiles(dir)).toEqual([])
  })
})
