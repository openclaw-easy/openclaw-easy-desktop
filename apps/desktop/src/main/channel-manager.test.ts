import { describe, it, expect } from 'vitest'
import { stripAnsi, extractWhatsAppQr, listWeixinAccountIds } from './channel-manager'

describe('stripAnsi', () => {
  it('returns input unchanged when no escape codes are present', () => {
    expect(stripAnsi('hello world')).toBe('hello world')
  })

  it('strips CSI color codes (the form openclaw CLI uses for QR rows)', () => {
    const ESC = String.fromCharCode(27)
    const colored = `${ESC}[47m${ESC}[30m ▄▄▄▄ ${ESC}[0m`
    expect(stripAnsi(colored)).toBe(' ▄▄▄▄ ')
  })

  it('strips multi-line ANSI without eating real newlines', () => {
    const ESC = String.fromCharCode(27)
    const input = `${ESC}[47m line1 ${ESC}[0m\n${ESC}[47m line2 ${ESC}[0m`
    expect(stripAnsi(input)).toBe(' line1 \n line2 ')
  })

  it('strips OSC sequences', () => {
    const ESC = String.fromCharCode(27)
    const BEL = String.fromCharCode(7)
    const input = `${ESC}]0;Tab Title${BEL}plain text`
    // Implementation uses a permissive match; it must remove the OSC envelope.
    expect(stripAnsi(input).includes('Tab Title')).toBe(false)
    expect(stripAnsi(input).includes('plain text')).toBe(true)
  })
})

describe('extractWhatsAppQr', () => {
  // Real captured WhatsApp QR fragment with the openclaw CLI's wrapping
  // codes (ESC[47m ESC[30m ... ESC[0m). Used to prove end-to-end extraction
  // including ANSI strip.
  const ESC = String.fromCharCode(27)
  const wrap = (s: string) => `${ESC}[47m${ESC}[30m${s}${ESC}[0m`

  const realQr = [
    wrap(' ▄▄▄▄▄▄▄  ▄▄       ▄    ▄    ▄ ▄▄     ▄ ▄ ▄▄▄▄  ▄   ▄▄ ▄▄▄▄▄▄▄ '),
    wrap(' █ ▄▄▄ █ ▄▀     ▀ ▄▄▀  ▄▄ ▄▀▀█ ▄▄ ▀▄▄▀▄▄█▀▄█  ▀▄  ▀▄██ █ ▄▄▄ █ '),
    wrap(' █ ███ █ █▀  ▄ █▄▀ ▄█  ██▀█ ▀▄█▄▄▄▄  █▄ ▄ ▄▄▀   ██▄█▄▀ █ ███ █ '),
    wrap(' █▄▄▄▄▄█ █ ▄▀▄ ▄▀█ █ █▀▄▀▄ ▄▀█ ▄ █ █ █ █ ▄ █▀█▀█▀█▀█ ▄ █▄▄▄▄▄█ '),
    wrap(' ▄ ▄▄▄▄▄ ▀ ▀ ▄█▀▄ █ ▄▄█▄▄▄▄▀▀█▄▄▄█▀▀▀▄▀█▄▀▄ █ ▀▄▀▄  ▄▀ ▄▄▄▄▄   '),
    wrap('  ▀ ▀  ▄ ▀▄ █  █    █▄   ▄▀▀█▀ ▄▄  ▄▀▀█▄▄ ▀██▀▄▄▀▀▀▄▄▄█▀ ▄▀ ▀▄ '),
    wrap('  ▀▄██ ▄████▄█▀██▀██  ▄█▄  ▀▄▄▀▀ ██ ▀▄█ ▀▀██▄▀█ ▄██▄▀▀▀█▄ ▀▄█  '),
    wrap('  ▀▄██▀▄▄▄█▄█▀▄ ▄▄  █████▄▀▀█▀▀▀█▀▄  ▀▄▄▄▀███▀▀▄▀ ▀▄▄ ▄▀▄▀  ▄▄ '),
    wrap('  ▄▄ ▄▀▄▄▀▄▄ █▀█    █▄▀▀▀ ▄▀▄▄▄▀ █ ▄▄█▀▄▀▀ ▄▀▀█▀▄▄  ▀▀ ▀▀▀▄▄▄▄ '),
    wrap('  ▄▄▀▀█▄ ▀▀▄▀ █▀ ▀ ▄ ▀▄▀▄  ▀ ▄█▄▄ ▄ ▀▄▀ ██▀█▀█▀▄▀ █▄▄ ▀▀▄ █▄▀▄ '),
    wrap(' █▄▄▀█▄▄▀▀█▀ ▀▄▄█  █▄▀██▀▄▀  ▄▄▀▀▀▀▄▀▄▄▄▀▀ ▀▄▀▀▄▄█▄ ▀███▄▀▄ █▀ '),
    wrap(' █▄██▀▀▄▄▄▄▄ ▀▄▀▄██ █▀█ ▀▀▀   ▀ ▄ ▄  ▀▀▄▀██▀██▀▄▀▄▄▄█▄▀█ ▄  █▄ '),
    wrap(' █▄▄▄▄▀▄▄▀█▀ ▀██▄▄▀▄▀█▀█▄█▄ ▀ ▀▄ ▀ ▀█▄▄▀▀▀█▀▄▀▄ ▄▄█▄█ █ ▄  ▄▄█ '),
    wrap(' ██ ▄ ▄▄██▀▄ █▀▄▀▄██▀█▀ ▄█▀▄█▄▀▀▄▄█ ▀▀█ ▄ ▀█▀▄  ▄█▀  ▄█▀▀▀ ▀██ '),
    wrap(' ▀█▄▀█▄▄█▄▄▀  ██▀██▄▄▄▀  ▀ ▀ ▄██▄█  ▄██▄ ▀▄ ▄ ▀▀▄█▀▄▀▄██▄▄█▄▄█ '),
    wrap('  ▀▀▀█ ▄ █  ▄▄▄▄▀ ▄▀  ▀▀▀▀█▀▄█ ▄ █▀▄▀▀▀  ▀▀█ █▀▄▄▄▀▄ █ ▄ █▄ ▄▄ '),
    wrap(' ▀█▄▄█▄▄▄█▀▄▄▀▀  ▄█▄▀▄█▀█▀  ▄█ '),
  ].join('\n')

  it('extracts QR from a single buffer with ANSI codes stripped', () => {
    const result = extractWhatsAppQr(realQr)
    expect(result).not.toBeNull()
    // Must not contain raw ANSI escape codes after extraction
    expect(result!.includes(ESC)).toBe(false)
    // Must contain the QR glyphs
    expect(result!).toMatch(/[▄▀█]/)
    // Should be at least 16 lines (real QR is ~17)
    expect(result!.split('\n').length).toBeGreaterThanOrEqual(16)
  })

  it('extracts QR even when buffer is split across two stdout chunks', () => {
    // The original bug: detector required `█` AND `▄` in the SAME chunk.
    // Now we buffer everything; split point shouldn't matter.
    const split = Math.floor(realQr.length / 2)
    const part1 = realQr.slice(0, split)
    const part2 = realQr.slice(split)
    const buffer = part1 + part2 // simulates buffered stdout
    const result = extractWhatsAppQr(buffer)
    expect(result).not.toBeNull()
    expect(result!.split('\n').length).toBeGreaterThanOrEqual(16)
  })

  it('returns null when buffer has no QR-glyph block', () => {
    expect(extractWhatsAppQr('hello world\nno qr here')).toBeNull()
  })

  it('returns null when QR-glyph rows are too few (false-positive guard)', () => {
    const tinyBlock = [
      ' ▄▄ ',
      ' ██ ',
      ' ▀▀ ',
    ].join('\n')
    expect(extractWhatsAppQr(tinyBlock)).toBeNull()
  })

  it('extracts QR from a buffer that also contains preamble log lines', () => {
    const buffer = [
      'Building TypeScript (dist is stale)...',
      'Waiting for WhatsApp connection...',
      'Open the WhatsApp app, go to Linked Devices, then scan this QR:',
      realQr,
      'Press Ctrl-C to cancel',
    ].join('\n')
    const result = extractWhatsAppQr(buffer)
    expect(result).not.toBeNull()
    // Must NOT include the preamble or trailing prompt
    expect(result).not.toContain('Building TypeScript')
    expect(result).not.toContain('Press Ctrl-C')
  })
})

describe('listWeixinAccountIds', () => {
  // Regression: checkWeixinStatus probed ~/.openclaw/credentials/<channel>/ —
  // the WhatsApp layout. Weixin writes accounts to ~/.openclaw/openclaw-weixin/,
  // so a completed QR login reported "not connected" forever and the app
  // looked like the scan had done nothing.
  const makeHome = async () => {
    const { mkdtemp, realpath } = await import('fs/promises')
    const { tmpdir } = await import('os')
    const { join } = await import('path')
    // realpath: macOS tmpdir is a /var -> /private/var symlink.
    return realpath(await mkdtemp(join(tmpdir(), 'weixin-')))
  }

  it('reads ids from accounts.json when present', async () => {
    const { mkdir, writeFile } = await import('fs/promises')
    const { join } = await import('path')
    const home = await makeHome()
    const stateDir = join(home, '.openclaw', 'openclaw-weixin')
    await mkdir(stateDir, { recursive: true })
    await writeFile(join(stateDir, 'accounts.json'), JSON.stringify(['acct-1', 'acct-2']))
    expect(await listWeixinAccountIds(home)).toEqual(['acct-1', 'acct-2'])
  })

  it('falls back to the accounts dir and ignores sidecar files', async () => {
    const { mkdir, writeFile } = await import('fs/promises')
    const { join } = await import('path')
    const home = await makeHome()
    const accounts = join(home, '.openclaw', 'openclaw-weixin', 'accounts')
    await mkdir(accounts, { recursive: true })
    // Exactly the shape the plugin writes for one logged-in account.
    await writeFile(join(accounts, '3686375334e9-im-bot.json'), '{}')
    await writeFile(join(accounts, '3686375334e9-im-bot.sync.json'), '{}')
    await writeFile(join(accounts, '3686375334e9-im-bot.context-tokens.json'), '{}')
    expect(await listWeixinAccountIds(home)).toEqual(['3686375334e9-im-bot'])
  })

  it('returns nothing when the plugin has never logged in', async () => {
    expect(await listWeixinAccountIds(await makeHome())).toEqual([])
  })

  it('ignores a malformed registry rather than throwing', async () => {
    const { mkdir, writeFile } = await import('fs/promises')
    const { join } = await import('path')
    const home = await makeHome()
    const stateDir = join(home, '.openclaw', 'openclaw-weixin')
    await mkdir(stateDir, { recursive: true })
    await writeFile(join(stateDir, 'accounts.json'), 'not json')
    expect(await listWeixinAccountIds(home)).toEqual([])
  })

  it('drops non-string entries from the registry', async () => {
    const { mkdir, writeFile } = await import('fs/promises')
    const { join } = await import('path')
    const home = await makeHome()
    const stateDir = join(home, '.openclaw', 'openclaw-weixin')
    await mkdir(stateDir, { recursive: true })
    await writeFile(join(stateDir, 'accounts.json'), JSON.stringify(['ok', null, 42, '']))
    expect(await listWeixinAccountIds(home)).toEqual(['ok'])
  })
})
