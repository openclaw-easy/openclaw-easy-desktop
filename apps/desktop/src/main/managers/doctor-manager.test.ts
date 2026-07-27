import { describe, it, expect } from 'vitest'
import { parseDoctorOutput } from './doctor-manager'

describe('parseDoctorOutput', () => {
  it('returns all-zero result for empty input', () => {
    expect(parseDoctorOutput('')).toEqual({
      problemsFound: 0,
      warningsFound: 0,
      fixesPreviewed: 0,
      problemsFixed: 0,
    })
  })

  it('classifies bullets inside a "Doctor warnings" panel as warnings, not errors', () => {
    const sample = [
      '┌  OpenClaw doctor',
      '│',
      '◇  Doctor warnings ' + '─'.repeat(40) + '╮',
      '│                                                                          │',
      '│  - first warning here                                                    │',
      '│  - second warning here                                                   │',
      '│  - third warning here                                                    │',
      '│                                                                          │',
      '├' + '─'.repeat(74) + '╯',
    ].join('\n')

    const result = parseDoctorOutput(sample)
    expect(result.problemsFound).toBe(0)
    expect(result.warningsFound).toBe(3)
    expect(result.problemsFixed).toBe(0)
  })

  it('classifies bullets inside a "Doctor errors" panel as errors (red)', () => {
    const sample = [
      '◇  Doctor errors ' + '─'.repeat(40) + '╮',
      '│                                                                          │',
      '│  - a true blocker                                                        │',
      '│  - another blocker                                                       │',
      '├' + '─'.repeat(74) + '╯',
    ].join('\n')

    const result = parseDoctorOutput(sample)
    expect(result.problemsFound).toBe(2)
    expect(result.warningsFound).toBe(0)
  })

  it('counts a "Doctor changes" panel as a previewed fix, not a problem', () => {
    const sample = [
      '◇  Doctor changes ' + '─'.repeat(40) + '╮',
      '│                                                                │',
      '│  openai/claude-haiku model configured, enabled automatically.  │',
      '│                                                                │',
      '├' + '─'.repeat(64) + '╯',
    ].join('\n')

    const result = parseDoctorOutput(sample)
    // The "Doctor changes" header itself counts as one previewed migration
    // (prose-style entries don't always have a bullet).
    expect(result.problemsFound).toBe(0)
    expect(result.warningsFound).toBe(0)
    expect(result.fixesPreviewed).toBe(1)
  })

  it('classifies bullets in unknown panels as warnings (advisories, not blockers)', () => {
    const sample = [
      '◇  Gateway service config ' + '─'.repeat(40) + '╮',
      '│  - PATH missing required dirs                                            │',
      '│  - PATH includes version managers                                        │',
      '├' + '─'.repeat(74) + '╯',
    ].join('\n')

    const result = parseDoctorOutput(sample)
    expect(result.problemsFound).toBe(0)
    expect(result.warningsFound).toBe(2)
  })

  it('strips ANSI color codes before parsing', () => {
    const ESC = String.fromCharCode(27)
    // Note: clack uses box-drawing '─' (U+2500), NOT ASCII '-', for panel
    // horizontal rules. The PANEL_HEADER_RE matches '─╮╭' explicitly.
    const sample = [
      `${ESC}[32m◇  Doctor warnings ${'─'.repeat(20)}╮${ESC}[0m`,
      `${ESC}[32m│  - colored bullet${ESC}[0m`,
    ].join('\n')
    const result = parseDoctorOutput(sample)
    expect(result.warningsFound).toBe(1)
  })

  it('does NOT count "No issues" / "No warnings" as a problem', () => {
    const sample = [
      '◇  Doctor warnings ' + '─'.repeat(20) + '╮',
      '│  - No issues found',
      '│  - No warnings detected',
      '│  - real warning here',
    ].join('\n')

    const result = parseDoctorOutput(sample)
    expect(result.warningsFound).toBe(1)
    expect(result.problemsFound).toBe(0)
  })

  it('parses a real captured doctor run with multiple mixed panels', () => {
    // Captured shape: 2 generic-check bullets (UI), 1 Doctor changes
    // preview, 3 Doctor warnings, 2 generic-check bullets (Gateway).
    const sample = [
      '┌  OpenClaw doctor',
      '│',
      '◇  UI ' + '─'.repeat(35) + '╮',
      '│                                    │',
      '│  - Control UI assets are missing.  │',
      '│  - Run: pnpm ui:build              │',
      '│                                    │',
      '├' + '─'.repeat(36) + '╯',
      '│',
      '◇  Doctor changes ' + '─'.repeat(40) + '╮',
      '│                                                                │',
      '│  openai/claude-haiku model configured, enabled automatically.  │',
      '│                                                                │',
      '├' + '─'.repeat(64) + '╯',
      '│',
      '◇  Doctor warnings ' + '─'.repeat(40) + '╮',
      '│                                                                          │',
      '│  - whatsapp.groupPolicy is allowlist but groupAllowFrom is empty         │',
      '│  - whatsapp.accounts.default.groupPolicy is allowlist but empty          │',
      '│  - telegram first-time setup mode                                        │',
      '│                                                                          │',
      '├' + '─'.repeat(74) + '╯',
      '│',
      '◇  Gateway service config ' + '─'.repeat(40) + '╮',
      '│                                                                          │',
      '│  - Gateway service PATH missing required dirs                            │',
      '│  - Gateway service PATH includes version managers                        │',
      '│                                                                          │',
      '├' + '─'.repeat(74) + '╯',
    ].join('\n')

    const result = parseDoctorOutput(sample)
    // Errors: 0 (no "Doctor errors" panel)
    // Warnings: 2 (UI) + 3 (Doctor warnings) + 2 (Gateway) = 7
    // Fixes previewed: 1 (Doctor changes)
    expect(result.problemsFound).toBe(0)
    expect(result.warningsFound).toBe(7)
    expect(result.fixesPreviewed).toBe(1)
    expect(result.problemsFixed).toBe(0)
  })

  it('the user-reported SQLite migration cascade reports as warnings, not errors', () => {
    // Captured shape from the original bug report: state-migrations warnings
    // surfacing in a "Doctor warnings" panel. None of these should land in
    // problemsFound (the red "found N issues" badge).
    const sample = [
      '◇  Doctor warnings ' + '─'.repeat(40) + '╮',
      '│  - Failed migrating plugin install index ~/.openclaw/plugins/installs.json: ...    │',
      '│  - Failed reading legacy cron storage at ~/.openclaw/cron/jobs.json: ...           │',
      '│  - Failed reading plugin-state sidecar ~/.openclaw/plugin-state/state.sqlite: ...  │',
      '│  - Failed reading task registry sidecar ~/.openclaw/tasks/runs.sqlite: ...         │',
      '│  - Failed reading task flow sidecar ~/.openclaw/flows/registry.sqlite: ...         │',
      '├' + '─'.repeat(74) + '╯',
    ].join('\n')

    const result = parseDoctorOutput(sample)
    expect(result.problemsFound).toBe(0)
    expect(result.warningsFound).toBe(5)
  })

  it('counts ✅/Applied/Fixed markers as fixed problems (forward-compat with --fix)', () => {
    const sample = [
      '✅ Repaired channels.telegram.streaming',
      'Applied: 3 changes',
      'Fixed: agents.defaults.model.primary',
      '◇  Doctor warnings ' + '─'.repeat(20) + '╮',
      '│  - still have one warning',
    ].join('\n')

    const result = parseDoctorOutput(sample)
    expect(result.warningsFound).toBe(1)
    expect(result.problemsFixed).toBe(3)
  })

  it('bare top-level bullets (rare) count as errors — they indicate a fatal pre-panel condition', () => {
    const sample = [
      '- cannot connect to gateway',
      '- doctor aborted',
    ].join('\n')

    const result = parseDoctorOutput(sample)
    expect(result.problemsFound).toBe(2)
    expect(result.warningsFound).toBe(0)
  })
})
