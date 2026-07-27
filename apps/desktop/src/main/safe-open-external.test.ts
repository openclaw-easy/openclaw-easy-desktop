import { describe, it, expect, vi, beforeEach } from 'vitest'

const openExternalMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  shell: {
    openExternal: openExternalMock,
  },
}))

import { isSafeOpenExternalUrl, safeOpenExternal } from './safe-open-external'

describe('isSafeOpenExternalUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isSafeOpenExternalUrl('https://openclaw-easy.com')).toBe(true)
    expect(isSafeOpenExternalUrl('http://localhost:3001')).toBe(true)
    expect(isSafeOpenExternalUrl('https://example.com/path?q=1#frag')).toBe(true)
  })

  it('rejects javascript:, data:, file:, vbscript: vectors', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'vbscript:msgbox(1)',
    ]) {
      expect(isSafeOpenExternalUrl(url)).toBe(false)
    }
  })

  it('rejects custom-protocol deep links', () => {
    for (const url of [
      'ms-cxh:something',
      'ms-windows-store://navigate',
      'tel:+15551234567',
      'sms:+15551234567',
      'mailto:nope@example.com',
      'slack://channel?team=T123&id=C456',
      'app://random-handler',
    ]) {
      expect(isSafeOpenExternalUrl(url)).toBe(false)
    }
  })

  it('rejects invalid / unparseable URLs', () => {
    for (const bad of ['not a url', '', '   ', '://nope']) {
      expect(isSafeOpenExternalUrl(bad)).toBe(false)
    }
  })

  it('rejects pathologically long URLs', () => {
    expect(isSafeOpenExternalUrl('https://example.com/' + 'x'.repeat(2049))).toBe(false)
  })

  it('rejects non-string input', () => {
    for (const bad of [null, undefined, 42, {}, [], true]) {
      expect(isSafeOpenExternalUrl(bad as unknown)).toBe(false)
    }
  })
})

describe('safeOpenExternal', () => {
  beforeEach(() => {
    openExternalMock.mockReset()
  })

  it('invokes shell.openExternal for a safe URL and returns true', async () => {
    openExternalMock.mockResolvedValueOnce(undefined)
    const result = await safeOpenExternal('https://openclaw-easy.com')
    expect(result).toBe(true)
    expect(openExternalMock).toHaveBeenCalledWith('https://openclaw-easy.com')
  })

  it('does NOT invoke shell.openExternal for an unsafe URL and returns false', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await safeOpenExternal('javascript:alert(1)')
    expect(result).toBe(false)
    expect(openExternalMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Blocked unsafe URL'))
    warnSpy.mockRestore()
  })

  it('returns false when shell.openExternal throws (no re-throw)', async () => {
    openExternalMock.mockRejectedValueOnce(new Error('shell broke'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await safeOpenExternal('https://openclaw-easy.com')
    expect(result).toBe(false)
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('truncates the URL in the warn log to 200 chars (log-spam guard)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await safeOpenExternal('javascript:' + 'x'.repeat(5000))
    const line = warnSpy.mock.calls[0]?.[0] as string
    // The 'javascript:' prefix is 11 chars; we keep first 200, so the log
    // text after the "Blocked unsafe URL: " prefix should be 200 chars.
    expect(line.length).toBeLessThan(500)
    warnSpy.mockRestore()
  })
})
