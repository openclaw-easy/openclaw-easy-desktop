import { describe, it, expect } from 'vitest'
import { groupActions, type PaletteAction } from './CommandPalette'

// React node placeholder — these tests don't render, they only check the
// pure grouping logic, so the icon shape doesn't matter.
const ICON: any = null

const navigate = (id: string, group: string): PaletteAction => ({
  kind: 'navigate',
  id,
  group,
  title: id,
  icon: ICON,
  server: 'main',
  channel: id,
})

const run = (id: string, group: string, danger = false): PaletteAction => ({
  kind: 'run',
  id,
  group,
  title: id,
  icon: ICON,
  perform: () => {},
  danger,
})

describe('groupActions', () => {
  it('returns one entry per group, preserving first-appearance order', () => {
    const groups = groupActions([
      navigate('a', 'Navigate'),
      run('b', 'Gateway'),
      navigate('c', 'Navigate'),
      run('d', 'Help'),
      run('e', 'Gateway'),
    ])
    // Group order matches first-appearance order: Navigate, Gateway, Help.
    // This is load-bearing for the palette UX — users learn where to
    // expect each section, so we don't want filtering to reshuffle them.
    expect(groups.map((g) => g.label)).toEqual(['Navigate', 'Gateway', 'Help'])
  })

  it('keeps within-group order stable', () => {
    const groups = groupActions([
      navigate('first', 'Navigate'),
      navigate('second', 'Navigate'),
      navigate('third', 'Navigate'),
    ])
    expect(groups[0].items.map((a) => a.id)).toEqual(['first', 'second', 'third'])
  })

  it('handles empty input', () => {
    expect(groupActions([])).toEqual([])
  })

  it('handles a single group', () => {
    const groups = groupActions([
      run('alpha', 'Gateway'),
      run('beta', 'Gateway'),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Gateway')
    expect(groups[0].items).toHaveLength(2)
  })

  it('keeps both navigate and run actions in the same group when they share a label', () => {
    // Edge case: caller might mix kinds within a group (e.g. "Navigate"
    // header containing both "Go to chat" and "Run doctor"). Should
    // still cluster correctly.
    const groups = groupActions([
      navigate('go', 'Mixed'),
      run('do', 'Mixed'),
    ])
    expect(groups[0].items.map((a) => a.id)).toEqual(['go', 'do'])
  })
})
