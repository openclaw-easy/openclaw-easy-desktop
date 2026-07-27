/**
 * Extensions-directory usability gate.
 *
 * The desktop runs against a system / bundled openclaw gateway and, in dev
 * mode, used to point its `OPENCLAW_BUNDLED_PLUGINS_DIR` env var at the
 * monorepo's `extensions/` tree so contributors could iterate on plugins
 * locally. That tree, however, ships TypeScript SOURCES — not built JS.
 * When openclaw's plugin loader is told to load a `.ts` source it
 * resolves its dependency imports against the monorepo `node_modules`,
 * which in turn surfaces every workspace package's deep-subpath import
 * that isn't yet wired into the package's `exports` map. The user-visible
 * symptom is a cascade of doctor errors like:
 *
 *   [plugins] openai failed to load: Cannot find module
 *     '@openclaw/normalization-core/string-normalization'
 *   [channels] failed to load bundled channel whatsapp:
 *     createNativeApprovalChannelRouteGates is not a function
 *
 * Pointing at an unbuilt source tree is never the right call — the system
 * gateway ships its own working bundled plugins. This helper proves a
 * candidate `extensions/` directory is actually loadable before we commit
 * to overriding the env var. If not, the caller returns `null` and the
 * gateway uses its bundled plugins instead.
 *
 * Pure (fs-only, sync) so it's trivial to unit-test by pointing at
 * fixture trees.
 */

import * as fs from "fs";
import * as path from "path";

/**
 * A "sentinel" extension we check for loadability. We pick `whatsapp`
 * because it's been a bundled channel for years and is present in every
 * supported openclaw release — if its loader entry is present and built,
 * the rest of the tree is overwhelmingly likely to be in the same state.
 */
const SENTINEL_EXTENSION = "whatsapp";

/**
 * Loader entry filenames the openclaw gateway accepts, in priority order.
 * If none of these exist for the sentinel, the tree is treated as
 * "TypeScript sources only" and the dir is rejected as the bundled-plugins
 * source.
 */
const LOADABLE_ENTRIES: readonly string[] = [
  "index.js",
  "index.cjs",
  "index.mjs",
  path.join("dist", "index.js"),
  path.join("dist", "index.cjs"),
  path.join("dist", "index.mjs"),
];

/**
 * Returns `true` iff `extensionsDir` looks like a built, gateway-loadable
 * bundled-plugins tree. Two requirements:
 *   1. The directory exists and contains the sentinel sub-directory.
 *   2. The sentinel sub-directory has at least one loadable JS entry point.
 *
 * A directory that exists but only contains `.ts` sources fails (2) — that's
 * the dev-mode trap that crashed Doctor.
 */
export function isExtensionsDirUsable(extensionsDir: string): boolean {
  try {
    if (!fs.existsSync(extensionsDir)) return false;
    const sentinel = path.join(extensionsDir, SENTINEL_EXTENSION);
    if (!fs.existsSync(sentinel)) return false;
    return LOADABLE_ENTRIES.some((entry) =>
      fs.existsSync(path.join(sentinel, entry)),
    );
  } catch {
    // Permission / IO errors — treat as unusable, never throw to the caller.
    return false;
  }
}

/**
 * Filenames considered when explaining why a dir was rejected. Exposed for
 * the logger in the resolver so the dev message can name what was missing.
 */
export function describeMissingLoaders(extensionsDir: string): string {
  const sentinel = path.join(extensionsDir, SENTINEL_EXTENSION);
  return `expected one of: ${LOADABLE_ENTRIES.map((e) => path.join(sentinel, e)).join(", ")}`;
}
