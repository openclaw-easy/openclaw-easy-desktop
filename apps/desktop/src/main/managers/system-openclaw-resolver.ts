/**
 * System-`openclaw` binary resolver.
 *
 * Locates a globally installed `openclaw` CLI so the desktop can dispatch
 * commands (doctor, plugins list, agents update, ...) through the same
 * Node-runtime binary the gateway uses, instead of falling back to the
 * dev-mode `bun + TypeScript source` path. That fallback was the root
 * cause of the user-visible cascade of:
 *
 *   - Failed reading plugin-state sidecar: SQLite support is unavailable
 *   - Failed migrating plugin install index: missing node:sqlite
 *   - Failed reading task registry sidecar: Cannot find package 'node:sqlite'
 *
 * Bun (1.3.x at the time of writing) doesn't expose `node:sqlite`, so any
 * openclaw code path that touches state-migration sidecars throws a
 * Bun-shaped `ResolveMessage` error. Node 22.5+/25 expose it natively.
 *
 * Used by:
 *   - ProcessManager.detectGatewayMode() — to pick gateway runtime mode.
 *   - OpenClawCommandExecutor.executeCommand() — to dispatch CLI calls to
 *     the system binary even before the manager's start() flow has run
 *     (e.g. user clicks "Check system health" before "Launch Assistant").
 *
 * Resolution order (first hit wins):
 *   1. `which openclaw` against an augmented PATH (Homebrew, pnpm, npm-global,
 *      .local/bin, .bun/bin). Handles nvm / fnm / volta-managed installs.
 *   2. Hard-coded fallback paths for stripped-PATH environments. Electron
 *      GUI processes on macOS don't inherit the shell's PATH; the
 *      augmented PATH above usually covers it but extra-careful here.
 *
 * Returns `null` when no system binary is found — callers must have a
 * bundled / dev-mode fallback.
 */

import { existsSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";

const execFileAsync = promisify(execFile);

/** Filenames + relative-paths we'll look at on each PATH directory. */
const OPENCLAW_BIN_NAME = "openclaw";

/**
 * Augment the current PATH with the directories shell sessions normally
 * have but Electron-spawned processes may be missing. Exported for tests
 * to verify the priority order; callers should NOT use this directly.
 */
export function getAugmentedPath(): string {
  const home = process.env.HOME || "";
  return [
    path.join(home, ".bun", "bin"),
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    process.env.PATH || "",
  ]
    .filter(Boolean)
    .join(":");
}

/**
 * Hard-coded fallback paths checked in priority order when `which` fails.
 * Order: user-managed installs (npm/pnpm/bun in user dirs) come first
 * because that's where contributors and most macOS users install. System
 * dirs come last. Exported for tests.
 */
export function getFallbackPaths(): string[] {
  const home = process.env.HOME || "";
  return [
    path.join(home, ".npm-global", "bin", OPENCLAW_BIN_NAME),
    path.join(home, ".local", "bin", OPENCLAW_BIN_NAME),
    // Bun-installed (`bun add -g openclaw`) lives here. Older fork code
    // looked here before the consolidation; we keep it so the resolver
    // is a strict superset of the implementations it replaces.
    path.join(home, ".bun", "bin", OPENCLAW_BIN_NAME),
    "/opt/homebrew/bin/" + OPENCLAW_BIN_NAME,
    "/usr/local/bin/" + OPENCLAW_BIN_NAME,
    "/usr/bin/" + OPENCLAW_BIN_NAME,
  ];
}

/**
 * Filter applied to `which openclaw` results before we trust them.
 * Workspace-local installs (anything under a `node_modules/.bin`) can
 * leak into PATH when Electron is launched from the dev shell — those
 * are NOT the user's globally installed openclaw and would point at a
 * package-version openclaw inside the fork's own node_modules.
 */
function isPathSuspicious(p: string): boolean {
  return p.includes("/node_modules/");
}

/**
 * Resolve a system `openclaw` binary. Returns the absolute path or `null`.
 *
 * Pure-ish — depends on the current process env and the filesystem. Safe
 * to call multiple times; callers should cache the result if they care
 * about cost.
 */
export async function detectSystemOpenClaw(): Promise<string | null> {
  // (1) `which openclaw` with augmented PATH. Reject workspace-local
  //     installs — only the user's global openclaw belongs here.
  try {
    const { stdout } = await execFileAsync("which", [OPENCLAW_BIN_NAME], {
      env: { ...process.env, PATH: getAugmentedPath() },
    });
    const resolved = stdout.trim();
    if (resolved && existsSync(resolved) && !isPathSuspicious(resolved)) {
      return resolved;
    }
  } catch {
    // `which` not on PATH or `openclaw` not found — fall through.
  }

  // (2) Hard-coded fallback for stripped-PATH environments.
  for (const candidate of getFallbackPaths()) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}
