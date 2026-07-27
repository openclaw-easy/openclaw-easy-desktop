import { describe, it, expect, vi } from 'vitest'
import { AccessControlManager, normalizeAccessPatch } from './access-control-manager'

function makeManager(config: any, execOutput: string | Error = '[]') {
  const store = { channels: config }
  const configManager = {
    loadConfig: vi.fn(async () => JSON.parse(JSON.stringify(store))),
    mutateConfig: vi.fn(async (mutator: (c: any) => boolean) => {
      const result = mutator(store)
      return result === true
    }),
  }
  const calls: string[][] = []
  const executor = {
    executeCommand: vi.fn(async (args: string[]) => {
      calls.push(args)
      if (execOutput instanceof Error) throw execOutput
      return execOutput
    }),
  }
  return { mgr: new AccessControlManager(configManager as any, executor), store, calls, configManager }
}

describe('normalizeAccessPatch', () => {
  it('accepts valid policies and normalizes id lists', () => {
    expect(
      normalizeAccessPatch({ dmPolicy: 'allowlist', allowFrom: [' +49123 ', '', 42 as any] }),
    ).toEqual({ dmPolicy: 'allowlist', allowFrom: ['+49123', '42'] })
  })

  it('rejects unknown policy values and empty patches', () => {
    expect(normalizeAccessPatch({ dmPolicy: 'yolo' as any })).toBeNull()
    expect(normalizeAccessPatch({ groupPolicy: 'pairing' as any })).toBeNull()
    expect(normalizeAccessPatch({})).toBeNull()
  })
})

describe('AccessControlManager', () => {
  it('projects configured channels with their access fields', async () => {
    const { mgr } = makeManager({
      whatsapp: { enabled: true, dmPolicy: 'pairing', groupPolicy: 'allowlist' },
      telegram: { enabled: false, dmPolicy: 'open', allowFrom: ['*'] },
      'openclaw-weixin': { enabled: true },
    })
    const res = await mgr.getChannelAccess()
    expect(res.success).toBe(true)
    const byId = Object.fromEntries(res.channels!.map((c) => [c.channelId, c]))
    expect(byId.whatsapp).toMatchObject({ dmPolicy: 'pairing', groupPolicy: 'allowlist', enabled: true })
    expect(byId.telegram).toMatchObject({ dmPolicy: 'open', allowFrom: ['*'], enabled: false })
    // No explicit policy → undefined, so the UI can show the schema default.
    expect(byId['openclaw-weixin'].dmPolicy).toBeUndefined()
  })

  it('writes a valid patch onto the channel entry', async () => {
    const { mgr, store } = makeManager({ telegram: { enabled: true, dmPolicy: 'open', allowFrom: ['*'] } })
    const res = await mgr.setChannelAccess('telegram', {
      dmPolicy: 'allowlist',
      allowFrom: ['12345'],
      groupPolicy: 'disabled',
    })
    expect(res.success).toBe(true)
    expect(store.channels.telegram).toMatchObject({
      dmPolicy: 'allowlist',
      allowFrom: ['12345'],
      groupPolicy: 'disabled',
    })
  })

  it('refuses unknown channels and invalid patches', async () => {
    const { mgr, store } = makeManager({ telegram: { enabled: true } })
    expect((await mgr.setChannelAccess('signal', { dmPolicy: 'open' })).success).toBe(false)
    expect((await mgr.setChannelAccess('telegram', { dmPolicy: 'bogus' as any })).success).toBe(false)
    expect(store.channels.telegram.dmPolicy).toBeUndefined()
  })

  it('treats "no pairing channels configured" as an empty pairing list', async () => {
    const { mgr } = makeManager({}, new Error('No chat DM pairing channels are configured.'))
    const res = await mgr.listPairingRequests()
    expect(res).toEqual({ success: true, requests: [] })
  })

  it('approves pairing via the CLI with channel and code', async () => {
    const { mgr, calls } = makeManager({}, '')
    const res = await mgr.approvePairing('whatsapp', 'ABC123')
    expect(res.success).toBe(true)
    expect(calls[0]).toEqual(['pairing', 'approve', 'whatsapp', 'ABC123'])
  })
})
