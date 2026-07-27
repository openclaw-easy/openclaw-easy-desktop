import { describe, it, expect, vi, beforeEach } from 'vitest'
import { homedir } from 'os'
import { join } from 'path'

const openPathMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  shell: {
    openPath: openPathMock,
  },
}))

import { isSafeWorkspaceDir, safeOpenWorkspaceDir } from './safe-open-path'

describe('isSafeWorkspaceDir', () => {
  it('accepts an existing directory inside home (home itself)', () => {
    expect(isSafeWorkspaceDir(homedir())).toBe(true)
  })

  it('rejects directories outside home', () => {
    for (const bad of ['/etc', '/', '/usr/bin', '/tmp']) {
      expect(isSafeWorkspaceDir(bad)).toBe(false)
    }
  })

  it('rejects a sibling dir that shares a home prefix (no naive startsWith bypass)', () => {
    // e.g. /Users/alice vs /Users/alice-evil — must not pass.
    expect(isSafeWorkspaceDir(homedir() + '-evil')).toBe(false)
  })

  it('rejects paths that do not exist', () => {
    expect(isSafeWorkspaceDir(join(homedir(), 'definitely-not-a-real-dir-xyz-123'))).toBe(false)
  })

  it('rejects traversal that escapes home', () => {
    expect(isSafeWorkspaceDir(join(homedir(), '..', '..', 'etc'))).toBe(false)
  })

  it('rejects non-string / empty / oversized input', () => {
    for (const bad of [null, undefined, 42, {}, [], true, '']) {
      expect(isSafeWorkspaceDir(bad as unknown)).toBe(false)
    }
    expect(isSafeWorkspaceDir(join(homedir(), 'x'.repeat(4097)))).toBe(false)
  })
})

describe('safeOpenWorkspaceDir', () => {
  beforeEach(() => {
    openPathMock.mockReset()
  })

  it('opens a safe directory and returns success', async () => {
    openPathMock.mockResolvedValueOnce('')
    const result = await safeOpenWorkspaceDir(homedir())
    expect(result.success).toBe(true)
    expect(openPathMock).toHaveBeenCalledWith(homedir())
  })

  it('does NOT call shell.openPath for an unsafe path', async () => {
    const result = await safeOpenWorkspaceDir('/etc')
    expect(result.success).toBe(false)
    expect(openPathMock).not.toHaveBeenCalled()
  })

  it('surfaces the OS error string when openPath fails', async () => {
    openPathMock.mockResolvedValueOnce('No application set to open')
    const result = await safeOpenWorkspaceDir(homedir())
    expect(result.success).toBe(false)
    expect(result.error).toBe('No application set to open')
  })
})
