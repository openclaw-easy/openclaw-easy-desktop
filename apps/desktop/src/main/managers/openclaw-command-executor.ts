import * as path from 'path'
import { existsSync, readFileSync, unlinkSync, openSync, closeSync, mkdirSync } from 'fs'
import { spawn } from 'child_process'
import { tmpdir } from 'os'
import { OpenClawEnvironment } from '../openclaw-environment'

/** Filter known-noisy stderr lines produced by the OpenClaw CLI on every invocation. */
function filterStderrNoise(raw: string): string {
  return raw.split('\n').filter(l => {
    const t = l.trim()
    if (!t) return false
    if (t.includes('duplicate plugin id detected')) return false
    if (t === 'Config warnings:') return false
    if (t.startsWith('RangeError:')) return false
    if (t.includes('Maximum call stack size exceeded')) return false
    if (t.startsWith('at ')) return false // stack trace frames
    if (/^\d+\s*\|/.test(t)) return false // source code snippets
    if (/^\^$/.test(t)) return false
    if (t.includes('Failed to read config at')) return false
    if (t === '(Use `node --trace-warnings ...` to show where the warning was created)') return false
    return true
  }).join('\n').trim()
}

/** Emits structured diagnostics so production failures can be root-caused from logs. */
function logSpawnDiagnostics(tag: string, runtime: string, openclawPath: string, args: string[]) {
  // Only check existence for absolute paths — bare names like 'bun' are resolved via PATH
  const isAbsPath = path.isAbsolute(runtime)
  const runtimeOk = isAbsPath ? existsSync(runtime) : true
  const openclawOk = existsSync(openclawPath)
  console.log(`[${tag}] spawn: args=[${args.join(' ')}]`)
  if (!runtimeOk) console.error(`[${tag}] *** MISSING runtime binary: ${runtime} ***`)
  if (!openclawOk) console.error(`[${tag}] *** MISSING openclaw entry point: ${openclawPath} ***`)
}

/**
 * OpenClawCommandExecutor - Executes OpenClaw CLI commands
 *
 * Uses spawn() with an args array (no shell) to prevent shell injection from
 * user-controlled values such as cron job names, agent names, and message payloads.
 *
 * Supports three execution modes:
 * - System binary: uses the user's installed `openclaw` binary directly
 * - Bundled (production): uses the bundled bun + ~/.openclaw-easy/app/openclaw.mjs
 * - Dev: uses local bun + TypeScript source
 */
export class OpenClawCommandExecutor {
  private openclawEnv: OpenClawEnvironment
  /** When set, all commands use this system binary instead of the bundled one. */
  private systemBinaryPath: string | null = null

  constructor(configPath: string) {
    this.openclawEnv = new OpenClawEnvironment(configPath)
  }

  /**
   * Switch the executor to use the system-installed openclaw binary.
   * When set, executeCommand() calls the system binary directly,
   * bypassing the bundled bun + openclaw.mjs entirely.
   */
  setSystemBinary(binaryPath: string | null) {
    this.systemBinaryPath = binaryPath
    if (binaryPath) {
      console.log(`[OpenClawCommandExecutor] Using system binary: ${binaryPath}`)
    } else {
      console.log('[OpenClawCommandExecutor] Reverted to bundled binary')
    }
  }

  async executeCommand(args: string[], timeoutMs: number = 10000): Promise<string | null> {
    const { app } = await import('electron')
    const isWindows = process.platform === 'win32'
    const home = process.env.HOME || process.env.USERPROFILE || ''
    const pathSep = isWindows ? ';' : ':'
    const openclawEnvVars = this.openclawEnv.getEnvironmentVariables()

    let runtime: string
    let openclawPath: string
    let enhancedEnv: NodeJS.ProcessEnv
    let cwd: string

    // ── System binary mode ─────────────────────────────────────────────
    // When a system openclaw binary is configured, use it directly.
    // The binary is a self-contained CLI — no separate runtime needed.
    if (this.systemBinaryPath) {
      runtime = this.systemBinaryPath
      openclawPath = '' // Not used — system binary IS the entry point
      cwd = home

      const expandedPath = isWindows
        ? (process.env.PATH || '')
        : [
            path.join(home, '.bun', 'bin'),
            path.join(home, '.npm-global', 'bin'),
            path.join(home, '.local', 'bin'),
            '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin',
            process.env.PATH || ''
          ].join(pathSep)

      enhancedEnv = {
        ...process.env,
        ...openclawEnvVars,
        PATH: expandedPath
      }
    } else if (app.isPackaged) {
      // ── Bundled mode (production) ──────────────────────────────────────
      // Use the bun binary bundled in the .app (extraResources/bun/)
      // and the openclaw entry point installed at ~/.openclaw-easy/app/openclaw.mjs.
      const bunBinaryName = isWindows
        ? 'bun-windows.exe'
        : `bun-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
      runtime = path.join(process.resourcesPath, 'bun', bunBinaryName)
      openclawPath = path.join(home, '.openclaw-easy', 'app', 'openclaw.mjs')
      cwd = path.join(home, '.openclaw-easy', 'app')

      const expandedPath = isWindows
        ? (process.env.PATH || '')
        : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', process.env.PATH || ''].join(pathSep)

      enhancedEnv = {
        ...process.env,
        ...openclawEnvVars,
        PATH: expandedPath
      }
    } else {
      // ── Dev mode ───────────────────────────────────────────────────────
      // Always run TypeScript source directly with bun
      openclawPath = path.join(__dirname, '../../../../openclaw/src/index.ts')
      runtime = 'bun'
      cwd = path.join(__dirname, '../../../../openclaw/')
      const bunPath = path.join(home, '.bun', 'bin')
      enhancedEnv = {
        ...process.env,
        ...openclawEnvVars,
        PATH: `${bunPath}${pathSep}${process.env.PATH}`
      }
    }

    // Build the spawn arguments: system binary doesn't need openclawPath
    const spawnArgs = openclawPath ? [openclawPath, ...args] : args

    // Always log spawn diagnostics so production issues can be root-caused from logs.
    logSpawnDiagnostics('OpenClawCommandExecutor', runtime, openclawPath || '(system binary)', args)

    // For JSON commands, write stdout directly to a temp file via fd to avoid
    // pipe-buffering race conditions in Electron when output exceeds ~8KB.
    const isLargeJsonCommand = args.includes('--json')

    if (isLargeJsonCommand) {
      const tempDir = tmpdir()
      try { mkdirSync(tempDir, { recursive: true }) } catch {}
      const tempFile = path.join(tempDir, `openclaw-json-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)

      return new Promise((resolve, reject) => {
        let fd: number
        try {
          fd = openSync(tempFile, 'w')
        } catch (e: any) {
          reject(new Error(`Could not open temp file: ${e.message}`))
          return
        }

        const stderrChunks: Buffer[] = []

        // Redirect stdout directly to the file descriptor — bypasses Node pipe buffering
        const child = spawn(runtime, spawnArgs, {
          env: enhancedEnv,
          timeout: timeoutMs,
          stdio: ['pipe', fd, 'pipe'],
          cwd,
          windowsHide: true,
        })

        child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

        child.on('error', (err: any) => {
          try { closeSync(fd) } catch {}
          try { unlinkSync(tempFile) } catch {}
          if (err.code === 'ETIMEDOUT') {
            reject(new Error(`OpenClaw command timed out after ${timeoutMs}ms: ${args.join(' ')}`))
          } else {
            reject(new Error(`OpenClaw spawn error: ${err.message}`))
          }
        })

        child.on('close', (code) => {
          try { closeSync(fd) } catch {}
          const stderrRaw = Buffer.concat(stderrChunks).toString('utf8')
          const stderr = filterStderrNoise(stderrRaw)
          if (stderr) console.warn(`[OpenClawCommandExecutor] stderr: ${stderr.slice(0, 500)}`)

          try {
            const output = readFileSync(tempFile, 'utf8')
            try { unlinkSync(tempFile) } catch {}

            if (code !== 0) {
              // If we got valid-looking JSON output despite non-zero exit (e.g. config
              // warnings cause non-zero exit but the command still produces JSON), return
              // it rather than discarding useful data.
              if (output && (output.includes('{') || output.includes('['))) {
                console.warn(`[OpenClawCommandExecutor] Non-zero exit (${code}) but JSON output present (${output.length} chars), returning output. stderr: ${stderr.slice(0, 200)}`)
                resolve(output)
                return
              }
              reject(new Error(`OpenClaw command failed: ${stderr || `exit code ${code}`}`))
              return
            }

            console.log(`[OpenClawCommandExecutor] JSON output size: ${output.length} characters`)
            resolve(output)
          } catch (readErr: any) {
            try { unlinkSync(tempFile) } catch {}
            reject(new Error(`Failed to read command output: ${readErr.message}`))
          }
        })
      })
    }

    // Regular commands — spawn with array args (no shell, no injection)
    return new Promise((resolve, reject) => {
      const child = spawn(runtime, spawnArgs, {
        env: enhancedEnv,
        timeout: timeoutMs,
        cwd,
        windowsHide: true,
      })

      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

      child.on('error', (err: any) => {
        if (err.code === 'ETIMEDOUT') {
          reject(new Error(`OpenClaw command timed out after ${timeoutMs}ms: ${args.join(' ')}`))
        } else {
          reject(new Error(`OpenClaw spawn error: ${err.message}`))
        }
      })

      child.on('close', (code) => {
        const stdout = Buffer.concat(stdoutChunks).toString('utf8')
        const stderrRaw = Buffer.concat(stderrChunks).toString('utf8')
        const stderr = filterStderrNoise(stderrRaw)
        if (stderr) console.warn(`[OpenClawCommandExecutor] stderr: ${stderr.slice(0, 500)}`)

        if (code !== 0) {
          reject(new Error(`OpenClaw command failed: ${stderr || `exit code ${code}`}`))
        } else {
          console.log(`[OpenClawCommandExecutor] Command output length: ${stdout.length} characters`)
          resolve(stdout)
        }
      })
    })
  }
}
