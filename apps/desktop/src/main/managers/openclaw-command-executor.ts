import * as path from 'path'
import { existsSync, readFileSync, unlinkSync, openSync, closeSync, mkdirSync } from 'fs'
import { spawn } from 'child_process'
import { tmpdir } from 'os'
import { OpenClawEnvironment } from '../openclaw-environment'
import { getOpenClawBundle } from '../openclaw-bundle'
import { getDevOpenClawSpawn } from '../dev-openclaw-runtime'
import { detectSystemOpenClaw } from './system-openclaw-resolver'

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
  // System-binary mode passes a placeholder rather than a path — the runtime
  // IS the entry point there, so existence-checking it reports a phantom
  // failure on a perfectly healthy spawn. Mirrors channel-manager.ts.
  const openclawOk = !path.isAbsolute(openclawPath) || existsSync(openclawPath)
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
  /** When set explicitly via setSystemBinary, overrides auto-detection. */
  private systemBinaryPath: string | null = null
  /**
   * Cached auto-detection result. `undefined` means "not yet detected";
   * `null` means "detected, nothing found"; string means "detected this path".
   * Detection is async but executeCommand() is async too, so we lazily
   * resolve on first call and cache for the executor's lifetime.
   */
  private detectionPromise: Promise<string | null> | null = null

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

  /**
   * Resolve the binary to spawn. Priority:
   *   1. Explicit override from setSystemBinary() (set by manager.start()
   *      once gateway mode is detected).
   *   2. Auto-detected system openclaw on disk. CRITICAL for the
   *      pre-start path: when the user clicks "Check system health"
   *      (Doctor) before clicking "Launch Assistant", the manager
   *      hasn't called setSystemBinary yet, so without this fallback
   *      the executor would fall through to the dev-mode bun+TS path —
   *      Bun lacks node:sqlite and cascades into "Failed reading plugin-
   *      state sidecar / missing node:sqlite" errors in the doctor
   *      output. See managers/system-openclaw-resolver.ts.
   *   3. `null` (caller falls back to bundled or dev-mode bun+TS).
   */
  private async resolveSystemBinary(): Promise<string | null> {
    if (this.systemBinaryPath) return this.systemBinaryPath
    if (!this.detectionPromise) {
      this.detectionPromise = detectSystemOpenClaw()
    }
    return this.detectionPromise
  }

  async executeCommand(
    args: string[],
    timeoutMs: number = 10000,
    opts?: {
      /**
       * Piped to the child's stdin, then stdin is closed. Used for CLI
       * commands that read a secret from stdin (models auth paste-token /
       * paste-api-key) so the secret never appears in argv or spawn logs.
       */
      stdinData?: string
    },
  ): Promise<string | null> {
    const stdinData = opts?.stdinData
    const { app } = await import('electron')
    const isWindows = process.platform === 'win32'
    const home = process.env.HOME || process.env.USERPROFILE || ''
    const pathSep = isWindows ? ';' : ':'
    const openclawEnvVars = this.openclawEnv.getEnvironmentVariables()

    let runtime: string
    let openclawPath: string
    let enhancedEnv: NodeJS.ProcessEnv
    let cwd: string

    // Shared by the bundled + dev branches; the system-binary branch widens
    // this with user-local bin dirs to find the installed binary's runtime.
    const standardPath = isWindows
      ? (process.env.PATH || '')
      : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', process.env.PATH || ''].join(pathSep)

    // ── System binary mode ─────────────────────────────────────────────
    // When a system openclaw binary is configured (or auto-detected on
    // disk), use it directly. The binary is a self-contained CLI — no
    // separate runtime needed.
    const resolvedSystemBinary = await this.resolveSystemBinary()
    if (resolvedSystemBinary) {
      runtime = resolvedSystemBinary
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
      // Run openclaw under the bundled Node runtime (extraResources/node/) —
      // openclaw needs node:sqlite for state-touching commands (doctor, cron,
      // statistics, state migrations); bun does NOT provide it. The openclaw
      // entry point is installed at ~/.openclaw-easy/app/openclaw.mjs. Bun is
      // kept only as the dependency installer (bundle's bun install).
      // ensureInstalled() is single-flight, so this is a no-op once the
      // eager install kicked off at app init has completed.
      const bundle = getOpenClawBundle()
      await bundle.ensureInstalled()
      runtime = bundle.getNodeBinary()
      openclawPath = bundle.getOpenClawMjs()
      cwd = bundle.getInstallDir()
      enhancedEnv = {
        ...process.env,
        ...openclawEnvVars,
        PATH: standardPath
      }
    } else {
      // ── Dev mode ─────────────────────────────────────────────────────
      // Built CLI under Node (see dev-openclaw-runtime.ts)
      const dev = getDevOpenClawSpawn()
      openclawPath = dev.entry
      runtime = dev.runtime
      cwd = dev.cwd
      enhancedEnv = {
        ...process.env,
        ...openclawEnvVars,
        PATH: standardPath
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

        // Redirect stdout directly to the file descriptor — bypasses Node pipe buffering.
        // stdin is 'ignore' (unless stdinData is piped) so the CLI sees
        // /dev/null on stdin and never blocks on a read.
        const child = spawn(runtime, spawnArgs, {
          env: enhancedEnv,
          timeout: timeoutMs,
          killSignal: 'SIGKILL',
          stdio: [stdinData !== undefined ? 'pipe' : 'ignore', fd, 'pipe'],
          cwd,
          windowsHide: true,
        })

        if (stdinData !== undefined) {
          child.stdin?.end(stdinData)
        }

        child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

        // Early-resolve poller: many openclaw read commands print the full JSON
        // payload long before the runtime exits — bundled-plugin scanning in dev
        // mode can keep the process alive for 30+ s after the JSON is on disk.
        // Once we see a complete JSON object, SIGKILL the child and resolve so
        // the renderer doesn't stare at a spinner waiting for plugin shutdown.
        let resolved = false
        let pollTimer: NodeJS.Timeout | null = null
        const tryEarlyResolve = () => {
          if (resolved) return
          let raw: string
          try { raw = readFileSync(tempFile, 'utf8') } catch { return }
          if (!raw) return
          const stripped = raw.replace(/\x1b\[[0-9;]*[mGKHFABCDsuJK]/g, '')
          const objStart = stripped.indexOf('{')
          const arrStart = stripped.indexOf('[')
          let start: number
          if (objStart === -1 && arrStart === -1) return
          if (objStart === -1) start = arrStart
          else if (arrStart === -1) start = objStart
          else start = Math.min(objStart, arrStart)
          const closing = stripped[start] === '{' ? '}' : ']'
          const end = stripped.lastIndexOf(closing)
          if (end === -1 || end < start) return
          const candidate = stripped.substring(start, end + 1)
          try {
            JSON.parse(candidate)
          } catch {
            return
          }
          resolved = true
          if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
          console.log(`[OpenClawCommandExecutor] Early-resolved JSON (${raw.length} chars) — killing child`)
          try { child.kill('SIGKILL') } catch {}
          try { closeSync(fd) } catch {}
          try { unlinkSync(tempFile) } catch {}
          resolve(raw)
        }
        // Wait 1.5s before first poll so the process gets a chance to print.
        const firstPoll = setTimeout(() => {
          tryEarlyResolve()
          if (!resolved) {
            pollTimer = setInterval(tryEarlyResolve, 500)
          }
        }, 1500)

        child.on('error', (err: any) => {
          if (resolved) return
          resolved = true
          clearTimeout(firstPoll)
          if (pollTimer) clearInterval(pollTimer)
          try { closeSync(fd) } catch {}
          try { unlinkSync(tempFile) } catch {}
          if (err.code === 'ETIMEDOUT') {
            reject(new Error(`OpenClaw command timed out after ${timeoutMs}ms: ${args.join(' ')}`))
          } else {
            reject(new Error(`OpenClaw spawn error: ${err.message}`))
          }
        })

        child.on('close', (code) => {
          clearTimeout(firstPoll)
          if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
          if (resolved) return
          resolved = true
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

      if (stdinData !== undefined) {
        // Write the secret and close stdin so non-TTY prompts resolve.
        child.stdin?.end(stdinData)
      }

      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
      child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

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
