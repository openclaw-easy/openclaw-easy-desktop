import { describe, it, expect } from 'vitest'
import { isCurlNoiseLine, isGatewayNoiseLine } from './process-manager-base'

describe('isCurlNoiseLine', () => {
  it('should detect curl progress rows', () => {
    expect(isCurlNoiseLine('  0  1234  0  1234  0  0  1234  0  0:00:01')).toBe(true)
    expect(isCurlNoiseLine(' 100  5678  100  5678  0  0  5678  0  0:00:02')).toBe(true)
  })

  it('should detect curl header row 1', () => {
    expect(isCurlNoiseLine('% Total    % Received % Xferd')).toBe(true)
  })

  it('should detect curl header row 2', () => {
    expect(isCurlNoiseLine('Dload  Upload   Total   Spent')).toBe(true)
  })

  it('should detect SIGTERM message', () => {
    expect(isCurlNoiseLine('Command aborted by signal SIGTERM')).toBe(true)
  })

  it('should NOT filter real curl errors', () => {
    expect(isCurlNoiseLine('curl: (7) Failed to connect to localhost port 18800')).toBe(false)
    expect(isCurlNoiseLine('curl: (6) Could not resolve host: example.com')).toBe(false)
  })

  it('should NOT filter real error messages', () => {
    expect(isCurlNoiseLine('Error: connection refused')).toBe(false)
    expect(isCurlNoiseLine('FATAL: gateway crashed')).toBe(false)
  })

  it('should NOT filter informational lines', () => {
    expect(isCurlNoiseLine('Gateway started on port 18800')).toBe(false)
    expect(isCurlNoiseLine('Listening on 127.0.0.1:18800')).toBe(false)
  })
})

describe('isGatewayNoiseLine', () => {
  it('should detect duplicate plugin warnings', () => {
    expect(isGatewayNoiseLine('duplicate plugin id detected: telegram')).toBe(true)
    expect(isGatewayNoiseLine('  duplicate plugin id detected: discord  ')).toBe(true)
  })

  it('should detect "Config warnings:" header', () => {
    expect(isGatewayNoiseLine('Config warnings:')).toBe(true)
  })

  it('should detect RangeError lines', () => {
    expect(isGatewayNoiseLine('RangeError: Maximum call stack size exceeded')).toBe(true)
    expect(isGatewayNoiseLine('RangeError: invalid array length')).toBe(true)
  })

  it('should detect Maximum call stack size exceeded', () => {
    expect(isGatewayNoiseLine('Maximum call stack size exceeded')).toBe(true)
  })

  it('should detect stack trace frames', () => {
    expect(isGatewayNoiseLine('    at Function.from (/path/to/file.js:10:5)')).toBe(true)
    expect(isGatewayNoiseLine('at processTicksAndRejections (node:internal/process/task_queues:95:5)')).toBe(true)
  })

  it('should detect source code snippet lines', () => {
    expect(isGatewayNoiseLine('122 |   }')).toBe(true)
    expect(isGatewayNoiseLine('  45|  const x = 1')).toBe(true)
  })

  it('should detect caret error indicator', () => {
    expect(isGatewayNoiseLine('^')).toBe(true)
  })

  it('should detect "Failed to read config at" messages', () => {
    expect(isGatewayNoiseLine('Failed to read config at /home/user/.openclaw/openclaw.json')).toBe(true)
  })

  it('should detect empty lines', () => {
    expect(isGatewayNoiseLine('')).toBe(true)
    expect(isGatewayNoiseLine('   ')).toBe(true)
  })

  it('should detect node trace-warnings hint', () => {
    expect(isGatewayNoiseLine('(Use `node --trace-warnings ...` to show where the warning was created)')).toBe(true)
  })

  it('should NOT filter real gateway errors', () => {
    expect(isGatewayNoiseLine('Error: EADDRINUSE: address already in use :::18800')).toBe(false)
    expect(isGatewayNoiseLine('TypeError: Cannot read properties of undefined')).toBe(false)
  })

  it('should NOT filter gateway status messages', () => {
    expect(isGatewayNoiseLine('Gateway started on port 18800')).toBe(false)
    expect(isGatewayNoiseLine('Channel telegram connected')).toBe(false)
    expect(isGatewayNoiseLine('Processing message from user@example.com')).toBe(false)
  })

  it('should NOT filter actual error outputs that happen to contain numbers', () => {
    expect(isGatewayNoiseLine('Error: port 18800 is already in use')).toBe(false)
  })
})
