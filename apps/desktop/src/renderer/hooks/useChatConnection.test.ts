import { describe, it, expect } from 'vitest'
import { extractDisplayText } from './useChatConnection'

// ---------------------------------------------------------------------------
// extractDisplayText
// ---------------------------------------------------------------------------

describe('extractDisplayText', () => {
  it('returns empty string for null/undefined', () => {
    expect(extractDisplayText(null)).toBe('')
    expect(extractDisplayText(undefined)).toBe('')
  })

  // ── Plain string content ──────────────────────────────────────────────

  it('returns plain string content', () => {
    const msg = { role: 'assistant', content: 'Hello world' }
    expect(extractDisplayText(msg)).toBe('Hello world')
  })

  it('trims whitespace', () => {
    const msg = { role: 'assistant', content: '  Hello  ' }
    expect(extractDisplayText(msg)).toBe('Hello')
  })

  it('returns text from msg.text fallback', () => {
    const msg = { role: 'assistant', text: 'fallback text' }
    expect(extractDisplayText(msg)).toBe('fallback text')
  })

  it('returns empty when no content or text', () => {
    expect(extractDisplayText({ role: 'assistant' })).toBe('')
    expect(extractDisplayText({ role: 'assistant', content: 42 })).toBe('')
  })

  // ── Content block arrays ──────────────────────────────────────────────

  it('extracts text from content block array', () => {
    const msg = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: 'world' },
      ],
    }
    expect(extractDisplayText(msg)).toBe('Hello\nworld')
  })

  it('extracts output_text blocks', () => {
    const msg = {
      role: 'assistant',
      content: [
        { type: 'output_text', text: 'The answer is 42.' },
      ],
    }
    expect(extractDisplayText(msg)).toBe('The answer is 42.')
  })

  it('skips tool_use and tool_result blocks', () => {
    const msg = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Before tool' },
        { type: 'tool_use', id: 'tool1', name: 'search', input: {} },
        { type: 'tool_result', tool_use_id: 'tool1', content: 'result' },
        { type: 'text', text: 'After tool' },
      ],
    }
    // Should prefer text after the last tool block
    expect(extractDisplayText(msg)).toBe('After tool')
  })

  it('falls back to all text blocks when none come after tool blocks', () => {
    const msg = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Only text before tool' },
        { type: 'tool_use', id: 'tool1', name: 'search', input: {} },
      ],
    }
    expect(extractDisplayText(msg)).toBe('Only text before tool')
  })

  // ── Function call XML stripping ───────────────────────────────────────

  it('strips function_calls XML blocks from string content', () => {
    const msg = {
      role: 'assistant',
      content: 'Hello <function_calls><invoke name="test"><parameter name="x">1</parameter></invoke></function_calls> World',
    }
    expect(extractDisplayText(msg)).toBe('Hello  World')
  })

  // ── Tool result messages ──────────────────────────────────────────────

  it('returns empty for JSON tool-result messages', () => {
    const msg = {
      role: 'assistant',
      content: JSON.stringify({ results: [{ id: 1 }], disabled: false }),
    }
    expect(extractDisplayText(msg)).toBe('')
  })

  it('returns empty for disabled tool-result messages', () => {
    const msg = {
      role: 'assistant',
      content: JSON.stringify({ disabled: true }),
    }
    expect(extractDisplayText(msg)).toBe('')
  })

  // ── Thinking/special token stripping (assistant messages) ─────────────

  it('strips <thinking> tags from assistant messages', () => {
    const msg = {
      role: 'assistant',
      content: '<thinking>internal reasoning</thinking>The answer is 42.',
    }
    expect(extractDisplayText(msg)).toBe('internal reasoningThe answer is 42.')
  })

  it('strips <think> tags from assistant messages', () => {
    const msg = {
      role: 'assistant',
      content: '<think>hmm</think>Result here.',
    }
    expect(extractDisplayText(msg)).toBe('hmmResult here.')
  })

  it('strips special LLM tokens', () => {
    const msg = {
      role: 'assistant',
      content: '<|im_start|>Hello<|im_end|>',
    }
    expect(extractDisplayText(msg)).toBe('Hello')
  })

  it('does NOT strip thinking tags from user messages', () => {
    const msg = {
      role: 'user',
      content: '<thinking>user typed this literally</thinking>',
    }
    expect(extractDisplayText(msg)).toBe('<thinking>user typed this literally</thinking>')
  })

  // ── Nested JSON content (openai-responses format) ─────────────────────

  it('unwraps nested output_text JSON in string content', () => {
    const inner = JSON.stringify([{ type: 'output_text', text: 'Unwrapped text', annotations: [] }])
    const msg = { role: 'assistant', content: inner }
    expect(extractDisplayText(msg)).toBe('Unwrapped text')
  })

  it('unwraps nested output_text JSON in content block array', () => {
    const nested = JSON.stringify([{ type: 'output_text', text: 'deep text', annotations: [] }])
    const msg = {
      role: 'assistant',
      content: [
        { type: 'output_text', text: nested },
      ],
    }
    expect(extractDisplayText(msg)).toBe('deep text')
  })

  // ── Error fallback ────────────────────────────────────────────────────

  it('falls back to errorMessage when content is empty and stopReason is error', () => {
    const msg = {
      role: 'assistant',
      content: '',
      stopReason: 'error',
      errorMessage: 'Rate limit exceeded',
    }
    expect(extractDisplayText(msg)).toBe('Rate limit exceeded')
  })

  it('does not use errorMessage when content is present', () => {
    const msg = {
      role: 'assistant',
      content: 'Some text',
      stopReason: 'error',
      errorMessage: 'Rate limit exceeded',
    }
    expect(extractDisplayText(msg)).toBe('Some text')
  })

  // ── Content block JSON in string content ──────────────────────────────

  it('extracts text from content-block JSON lines embedded in string', () => {
    const jsonLine = JSON.stringify([
      { type: 'text', text: 'Extracted from JSON line' },
    ])
    const msg = {
      role: 'assistant',
      content: `Some preamble\n${jsonLine}\nSome trailing`,
    }
    expect(extractDisplayText(msg)).toContain('Extracted from JSON line')
  })

  it('drops function/tool_use blocks embedded in string JSON', () => {
    const jsonLine = JSON.stringify([
      { type: 'function', name: 'search', arguments: '{}' },
      { type: 'text', text: 'Visible' },
    ])
    const msg = {
      role: 'assistant',
      content: jsonLine,
    }
    expect(extractDisplayText(msg)).toBe('Visible')
  })
})
