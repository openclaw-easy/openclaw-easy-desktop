import { describe, it, expect } from 'vitest'
import {
  isCurlNoiseLine,
  isGatewayNoiseLine,
  GATEWAY_STOP_ACTION,
  GATEWAY_RESTART_ACTION,
} from './process-manager-base'

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

describe('gateway CLI actions', () => {
  // Upstream's own post-restart health budget, from
  // src/cli/daemon-cli/lifecycle.ts. `gateway restart` polls until the gateway
  // answers before it exits, so our deadline has to clear these or we SIGTERM
  // a restart that is still working.
  const UPSTREAM_RESTART_HEALTH_BUDGET_MS = process.platform === 'win32' ? 180_000 : 60_000

  it('gives restart more time than upstream spends proving health', () => {
    expect(GATEWAY_RESTART_ACTION.timeoutMs).toBeGreaterThan(UPSTREAM_RESTART_HEALTH_BUDGET_MS)
  })

  it('gives restart more time than a healthy restart actually costs', () => {
    // Measured on macOS: a healthy `openclaw gateway restart` is 31-33s
    // (teardown + boot + health proof), which is why a flat 30s deadline killed
    // every one of them and re-ran the whole restart on the next binary.
    expect(GATEWAY_RESTART_ACTION.timeoutMs).toBeGreaterThan(33_000)
  })

  it('keeps stop cheaper than restart — stop has no health proof', () => {
    expect(GATEWAY_STOP_ACTION.timeoutMs).toBeLessThan(GATEWAY_RESTART_ACTION.timeoutMs)
  })

  it('binds each label to the args it actually runs', () => {
    expect(GATEWAY_STOP_ACTION.args).toEqual(['gateway', 'stop', '--force'])
    expect(GATEWAY_STOP_ACTION.label).toBe('stop')
    expect(GATEWAY_RESTART_ACTION.args).toEqual(['gateway', 'restart'])
    expect(GATEWAY_RESTART_ACTION.label).toBe('restart')
  })
})
