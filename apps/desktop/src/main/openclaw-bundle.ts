import * as path from 'path'
import * as fs from 'fs'
import * as crypto from 'crypto'
import { spawn } from 'child_process'

export type BundleLogger = (msg: string) => void

function copyRecursive(src: string, dest: string): void {
  if (fs.statSync(src).isDirectory()) {
    fs.mkdirSync(dest, { recursive: true })
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry))
    }
  } else {
    fs.copyFileSync(src, dest)
  }
}

/**
 * Owns the bundled OpenClaw runtime under ~/.openclaw-easy/app.
 *
 * Every code path that needs to spawn the bundled openclaw (gateway start,
 * onboarding terminal, command executor) goes through ensureInstalled() so
 * the bundle is extracted on first use — not only when the gateway happens
 * to start. ensureInstalled() is idempotent and single-flight: concurrent
 * callers share the same install promise.
 */
export class OpenClawBundle {
  // Install-dir entries created by `bun install`/this class rather than shipped
  // by the bundle — an upgrade mirror must not treat them as stale orphans.
  private static readonly INSTALL_OWNED = ['node_modules', '.package-hash']

  private installPromise: Promise<void> | null = null

  constructor(private readonly resourcesPath: string) {}

  getResourceDir(): string {
    return path.join(this.resourcesPath, 'openclaw')
  }

  getEasyHome(): string {
    const home = process.env.HOME || process.env.USERPROFILE || ''
    return path.join(home, '.openclaw-easy')
  }

  getInstallDir(): string {
    return path.join(this.getEasyHome(), 'app')
  }

  getOpenClawMjs(): string {
    return path.join(this.getInstallDir(), 'openclaw.mjs')
  }

  getBunBinary(): string {
    const isWindows = process.platform === 'win32'
    const name = isWindows
      ? 'bun-windows.exe'
      : `bun-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
    return path.join(this.resourcesPath, 'bun', name)
  }

  // Bundled Node runtime used to RUN openclaw (gateway + CLI). openclaw needs
  // `node:sqlite` (Node 22.5+/24+) for health-state/agent writes; bun does not
  // provide it (verified bun 1.3.x throws "No such built-in module:
  // node:sqlite"), so running openclaw under bun fails commands like
  // `agents add`. Bun is kept ONLY as the dependency installer (`bun install`
  // below); the run path uses this Node binary.
  getNodeBinary(): string {
    const isWindows = process.platform === 'win32'
    const name = isWindows
      ? 'node-windows.exe'
      : `node-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
    return path.join(this.resourcesPath, 'node', name)
  }

  isReady(): boolean {
    const dir = this.getInstallDir()
    return (
      fs.existsSync(path.join(dir, 'openclaw.mjs')) &&
      fs.existsSync(path.join(dir, 'node_modules'))
    )
  }

  async ensureInstalled(onLog?: BundleLogger): Promise<void> {
    if (this.installPromise) return this.installPromise
    const promise = this.doEnsureInstalled(onLog)
    this.installPromise = promise
    try {
      await promise
    } catch (err) {
      this.installPromise = null
      throw err
    }
  }

  private async doEnsureInstalled(onLog?: BundleLogger): Promise<void> {
    const log = onLog ?? (() => {})
    const installDir = this.getInstallDir()
    const resourceDir = this.getResourceDir()
    const bun = this.getBunBinary()

    if (!fs.existsSync(resourceDir)) {
      throw new Error(`OpenClaw bundle missing in app resources: ${resourceDir}`)
    }
    if (!fs.existsSync(bun)) {
      throw new Error(`Bundled bun binary missing: ${bun}`)
    }
    // The Node runtime RUNS openclaw (needs node:sqlite); a missing node binary
    // would otherwise surface as an opaque ENOENT only when the gateway/CLI is
    // first spawned. Fail fast here with a clear message (CI smoke also guards
    // against ever shipping a build without it).
    const node = this.getNodeBinary()
    if (!fs.existsSync(node)) {
      throw new Error(`Bundled node binary missing: ${node}`)
    }

    const firstInstall = !this.isReady()
    // Detect a bundle upgrade BEFORE copying (compare the NEW resource bundle's
    // package.json against the installed hash). Used both to prune stale files
    // and to gate the dependency reinstall.
    const bundleChanged = firstInstall || this.bundleChanged(installDir, resourceDir)

    if (firstInstall) {
      log('📦 Setting up OpenClaw runtime (first launch, ~30 seconds)…')
    }

    fs.mkdirSync(installDir, { recursive: true })
    this.syncAssets(installDir, resourceDir, bundleChanged)

    if (bundleChanged) {
      log('📥 Installing OpenClaw dependencies…')
      await this.runBunInstall(bun, installDir, log)
      this.savePackageHash(installDir)
      log('✅ OpenClaw runtime ready')
    }
  }

  /**
   * Mirror the packaged payload into the install dir.
   *
   * Copies every top-level entry the bundle ships rather than an allowlist:
   * prepare-openclaw-bundle.mjs is the single source of truth for what a
   * release contains, and a second list here silently drops whatever the build
   * starts emitting. That is exactly how `vendor/` — the file: targets the
   * rewritten package.json deps point at — never reached the install dir, so
   * `bun install` failed outright and left the runtime with no node_modules.
   */
  private syncAssets(installDir: string, resourceDir: string, prune = false): void {
    const shipped = fs.readdirSync(resourceDir)
    // On a bundle upgrade, MIRROR (wipe first) instead of overlaying. An
    // additive copy leaves files removed/renamed upstream as orphans — a stale
    // plugin manifest pointing at a deleted setup entry breaks the gateway's
    // plugins list after an over-the-top update. INSTALL_OWNED entries are
    // produced by `bun install` here, not by the bundle, so they are not stale.
    if (prune) {
      const keep = new Set([...shipped, ...OpenClawBundle.INSTALL_OWNED])
      for (const entry of fs.readdirSync(installDir)) {
        // Dotfiles are tool state (install stamps, package-manager metadata),
        // never shipped payload — deleting them buys nothing and can wipe
        // state whose owner lives outside this class.
        if (keep.has(entry) || entry.startsWith('.')) continue
        try {
          fs.rmSync(path.join(installDir, entry), { recursive: true, force: true })
        } catch { /* best effort */ }
      }
    }
    for (const entry of shipped) {
      const src = path.join(resourceDir, entry)
      const dest = path.join(installDir, entry)
      if (prune && fs.statSync(src).isDirectory() && fs.existsSync(dest)) {
        try { fs.rmSync(dest, { recursive: true, force: true }) } catch { /* best effort */ }
      }
      copyRecursive(src, dest)
    }
    for (const lockfile of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']) {
      const lf = path.join(installDir, lockfile)
      if (fs.existsSync(lf)) {
        try { fs.unlinkSync(lf) } catch { /* best effort */ }
      }
    }
  }

  /**
   * True when the bundled openclaw payload changed since the last install.
   * Compares the NEW resource bundle's package.json hash against the installed
   * `.package-hash` stamp — computed BEFORE syncAssets so it can also drive
   * the prune (mirror) of stale plugin/skill files on upgrade.
   */
  private bundleChanged(installDir: string, resourceDir: string): boolean {
    try {
      const hashFile = path.join(installDir, '.package-hash')
      const pkgPath = path.join(resourceDir, 'package.json')
      if (!fs.existsSync(pkgPath)) return false
      const currentHash = crypto.createHash('sha256').update(fs.readFileSync(pkgPath)).digest('hex')
      if (!fs.existsSync(hashFile)) return true
      return fs.readFileSync(hashFile, 'utf-8').trim() !== currentHash
    } catch {
      return true
    }
  }

  private savePackageHash(installDir: string): void {
    try {
      const pkgPath = path.join(installDir, 'package.json')
      const hash = crypto.createHash('sha256').update(fs.readFileSync(pkgPath)).digest('hex')
      fs.writeFileSync(path.join(installDir, '.package-hash'), hash)
    } catch { /* best effort */ }
  }

  private runBunInstall(bun: string, installDir: string, log: BundleLogger): Promise<void> {
    return new Promise((resolve, reject) => {
      const isWindows = process.platform === 'win32'
      const proc = spawn(bun, ['install', '--production', '--ignore-scripts'], {
        cwd: installDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, HOME: this.getEasyHome() },
        windowsHide: isWindows,
      })
      const timeout = setTimeout(() => {
        proc.kill()
        reject(new Error('bun install timed out after 3 minutes'))
      }, 3 * 60 * 1000)
      // Keep the tail of stderr: a bare exit code is undiagnosable after the
      // fact, and this install failing is what leaves the runtime unusable.
      const errTail: string[] = []
      proc.stdout?.on('data', (d: Buffer) => {
        const t = d.toString().trim()
        if (t) log(`  ${t}`)
      })
      proc.stderr?.on('data', (d: Buffer) => {
        const t = d.toString().trim()
        if (!t) return
        errTail.push(t)
        if (errTail.length > 10) errTail.shift()
        if (!t.includes('warn')) log(`  ${t}`)
      })
      proc.on('exit', (code) => {
        clearTimeout(timeout)
        if (code === 0) resolve()
        else {
          const detail = errTail.join('\n').trim()
          reject(new Error(`bun install exited with code ${code}${detail ? `:\n${detail}` : ''}`))
        }
      })
      proc.on('error', (err) => { clearTimeout(timeout); reject(err) })
    })
  }
}

let sharedBundle: OpenClawBundle | null = null

/**
 * Single shared bundle instance so that single-flight install is honored
 * across the gateway process manager, the onboarding terminal handler, and
 * any other consumer that spawns the bundled openclaw.
 */
export function getOpenClawBundle(): OpenClawBundle {
  if (!sharedBundle) {
    sharedBundle = new OpenClawBundle(process.resourcesPath)
  }
  return sharedBundle
}
