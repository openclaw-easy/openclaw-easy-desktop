#!/usr/bin/env node
// Copy OpenClaw's compiled output into the desktop installer payload.
//
// Single source of truth for what the DMG / EXE ships under
// installer-resources/openclaw/. Invoked from:
//   - moltbot-easy/apps/desktop/scripts/prepare-bundle.sh  (local mac dev build)
//   - .github/workflows/build-macos.yml                    (mac CI)
//   - .github/workflows/build-windows-desktop.yml          (windows CI)
//
// Usage:
//   node prepare-openclaw-bundle.mjs <workspace_dir> <dest_dir>
//
// Or via env (both forms supported; CLI wins if both given):
//   WORKSPACE_DIR=...  DEST_DIR=...  node prepare-openclaw-bundle.mjs
//
// Exits non-zero with a specific error before producing a partial bundle,
// so any caller can rely on success == "bundle is ready to package".

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIR = path.dirname(SCRIPT_DIR);

const [argWorkspace, argDest] = process.argv.slice(2);
const WORKSPACE_DIR = path.resolve(
  argWorkspace ||
    process.env.WORKSPACE_DIR ||
    path.join(DESKTOP_DIR, "..", "..", ".."),
);
const DEST_DIR = path.resolve(
  argDest ||
    process.env.DEST_DIR ||
    path.join(DESKTOP_DIR, "installer-resources", "openclaw"),
);

const log = (msg) => console.log(`[✓] ${msg}`);
const info = (msg) => console.log(`[i] ${msg}`);
const fatal = (msg) => {
  console.error(`\nERROR: ${msg}`);
  process.exit(1);
};

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function dirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const p = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(p);
      else if (entry.isFile()) {
        try {
          total += fs.statSync(p).size;
        } catch {
          /* race with deletion — ignore */
        }
      }
    }
  }
  return total;
}

// Mirror a directory: nuke dst, then copy src → dst. Optional exclude filter
// (called with each source path, return false to skip). Mimics
// `rsync -a --delete [--exclude=PATTERN]`.
function mirror(src, dst, { excludeDirNames = [] } = {}) {
  if (!fs.existsSync(src)) {
    fatal(`source missing: ${src}`);
  }
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });

  // `fs.cpSync` recursive + filter walks the tree. The filter receives
  // absolute src paths; return false to skip an entry (and its subtree
  // if it's a directory).
  //
  // `dereference: true` is the critical bit — without it, symlinks in
  // the source tree (e.g. docs/reference/templates/CLAUDE.md → AGENTS.md)
  // get copied verbatim, which then breaks the downstream pipeline:
  //   - Windows: 7zip's NSIS archive step rejects bundle symlinks with
  //     "The directory name is invalid"
  //   - macOS: `codesign --verify --deep --strict` rejects any symlink
  //     under .app/Contents/Resources/ with "invalid destination for
  //     symbolic link in bundle"
  // The pre-Node-script pipeline got away with this because PowerShell's
  // Copy-Item dereferenced by default and macOS codesign hadn't tripped
  // on the templates symlink (Apple has been tightening --strict over
  // time). Always dereferencing matches the safer of the two old
  // behaviours and produces an installer payload made entirely of
  // regular files, which both signers accept.
  fs.cpSync(src, dst, {
    recursive: true,
    force: true,
    dereference: true,
    filter: (srcPath) => {
      if (excludeDirNames.length === 0) return true;
      const base = path.basename(srcPath);
      return !excludeDirNames.includes(base);
    },
  });
}

console.log(`Workspace: ${WORKSPACE_DIR}`);
console.log(`Dest:      ${DEST_DIR}`);

// ── Preflight ────────────────────────────────────────────────────────────────
const DIST = path.join(WORKSPACE_DIR, "dist");
const DIST_EXTENSIONS = path.join(WORKSPACE_DIR, "dist", "extensions");
const DIST_CONTROL_UI = path.join(WORKSPACE_DIR, "dist", "control-ui", "index.html");
const TEMPLATES = path.join(WORKSPACE_DIR, "docs", "reference", "templates");
const SKILLS = path.join(WORKSPACE_DIR, "skills");
const OPENCLAW_MJS = path.join(WORKSPACE_DIR, "openclaw.mjs");
const ROOT_PKG = path.join(WORKSPACE_DIR, "package.json");

if (!fs.existsSync(DIST)) {
  fatal(
    `${DIST} not found.\n` +
      `Run the OpenClaw build first:\n` +
      `  cd ${WORKSPACE_DIR} && pnpm install && pnpm run build`,
  );
}
if (!fs.existsSync(DIST_EXTENSIONS)) {
  fatal(
    `${DIST_EXTENSIONS} not found.\n` +
      `'pnpm run build' did not populate dist/extensions/. Shipping source\n` +
      `extensions/ would cause the OpenClaw config validator to reject the\n` +
      `bundle ("setup entry not found: setup-entry.js") and every\n` +
      `plugins/hooks/skills list call would fail at runtime.`,
  );
}
// Control UI is a separate Vite build (ui/) that emits to dist/control-ui/.
// Upstream's `pnpm run build` does NOT run `pnpm ui:build`, so without this
// check we'd silently ship installers with no Control UI assets. Callers
// (local build script + each CI workflow) are expected to invoke
// `pnpm ui:build` themselves before calling this script.
if (!fs.existsSync(DIST_CONTROL_UI)) {
  fatal(
    `Control UI not built: ${DIST_CONTROL_UI} missing.\n` +
      `Run 'pnpm ui:build' at the workspace root before invoking this script.`,
  );
}
if (!fs.existsSync(TEMPLATES)) fatal(`${TEMPLATES} not found.`);
if (!fs.existsSync(SKILLS)) fatal(`${SKILLS} not found.`);
if (!fs.existsSync(OPENCLAW_MJS)) fatal(`${OPENCLAW_MJS} not found.`);
if (!fs.existsSync(ROOT_PKG)) fatal(`${ROOT_PKG} not found.`);

// ── Layout the destination ───────────────────────────────────────────────────
fs.mkdirSync(DEST_DIR, { recursive: true });

// ── 1. dist/ (compiled core + Control UI) ────────────────────────────────────
info("Copying dist/ (compiled core + Control UI)...");
mirror(DIST, path.join(DEST_DIR, "dist"));

// Sanity: Control UI must have made it into the payload.
const destControlUi = path.join(DEST_DIR, "dist", "control-ui", "index.html");
if (!fs.existsSync(destControlUi)) {
  fatal(
    `Control UI assets did not make it into installer payload at\n` +
      `  ${destControlUi}\n` +
      `Aborting — installer would ship with broken Web UI.`,
  );
}
log(
  `dist/ copied (${humanSize(dirSize(path.join(DEST_DIR, "dist")))} incl. control-ui)`,
);

// ── 2. dist/extensions/ → extensions/ ────────────────────────────────────────
// Plugins must come from dist/ (compiled JS + manifests), NOT the source
// extensions/ tree. node_modules under each plugin is excluded to keep the
// installer payload small — runtime deps are resolved through the bundled
// root node_modules at first launch.
info("Copying dist/extensions/ (compiled plugins)...");
mirror(DIST_EXTENSIONS, path.join(DEST_DIR, "extensions"), {
  excludeDirNames: ["node_modules"],
});

// Canary: a known stable plugin must have its compiled JS + manifest. If
// this ever fails, the build pipeline regressed and a fresh installer
// would crash on first launch.
const discordIndex = path.join(DEST_DIR, "extensions", "discord", "index.js");
const discordManifest = path.join(
  DEST_DIR,
  "extensions",
  "discord",
  "openclaw.plugin.json",
);
if (!fs.existsSync(discordIndex) || !fs.existsSync(discordManifest)) {
  fatal(
    `bundled extensions missing compiled JS or manifest.\n` +
      `  Expected: ${discordIndex}\n` +
      `  Expected: ${discordManifest}\n` +
      `Did 'pnpm run build' actually populate dist/extensions/?`,
  );
}
const pluginCount = fs
  .readdirSync(path.join(DEST_DIR, "extensions"), { withFileTypes: true })
  .filter((e) => e.isDirectory()).length;
log(
  `extensions/ copied (${humanSize(
    dirSize(path.join(DEST_DIR, "extensions")),
  )}, ${pluginCount} plugins)`,
);

// ── 3. skills/ ───────────────────────────────────────────────────────────────
info("Copying skills/...");
mirror(SKILLS, path.join(DEST_DIR, "skills"));
log(`skills/ copied (${humanSize(dirSize(path.join(DEST_DIR, "skills")))})`);

// ── 4. docs/reference/templates/ ─────────────────────────────────────────────
info("Copying docs/reference/templates/...");
fs.mkdirSync(path.join(DEST_DIR, "docs", "reference"), { recursive: true });
mirror(TEMPLATES, path.join(DEST_DIR, "docs", "reference", "templates"));
log(
  `templates copied (${humanSize(
    dirSize(path.join(DEST_DIR, "docs", "reference", "templates")),
  )})`,
);

// ── 5. Entry point + root manifest ───────────────────────────────────────────
fs.copyFileSync(OPENCLAW_MJS, path.join(DEST_DIR, "openclaw.mjs"));
fs.copyFileSync(ROOT_PKG, path.join(DEST_DIR, "package.json"));

// openclaw.mjs is shipped alone, so any repo-root sibling it imports has to come
// with it. Upstream added `./node-version.mjs` in the 2026-08-31 sync and the
// bundle shipped without it, so the runtime died at boot with
// ERR_MODULE_NOT_FOUND — caught only by the pre-notarization DMG smoke test.
// Derive the list from the entry point instead of maintaining it by hand, and
// fail loudly here rather than in a DMG.
const entrySource = fs.readFileSync(OPENCLAW_MJS, "utf8");
const siblingSpecifiers = new Set(
  [...entrySource.matchAll(/\bfrom\s*["'](\.\/[^"']+)["']|\bimport\s*\(\s*["'](\.\/[^"']+)["']/g)].map(
    (match) => match[1] ?? match[2],
  ),
);
for (const specifier of siblingSpecifiers) {
  // Directory specifiers are bundle payloads copied by the steps above.
  if (!/\.[cm]?js$/.test(specifier)) continue;
  const source = path.join(WORKSPACE_DIR, specifier);
  if (!fs.existsSync(source)) {
    fatal(
      `openclaw.mjs imports ${specifier}, which does not exist at ${source}.\n` +
        `The bundled runtime would fail to boot with ERR_MODULE_NOT_FOUND.`,
    );
  }
  const destination = path.join(DEST_DIR, specifier);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  console.log(`  entry sibling: ${specifier}`);
}

// ── 5b. Vendor workspace-protocol dependencies ───────────────────────────────
// The root manifest declares `workspace:*` runtime deps (@openclaw/ai,
// @openclaw/media-core) that the dist genuinely imports at runtime. Bun
// cannot resolve the workspace protocol outside this monorepo, so the
// end-user `bun install` in ~/.openclaw-easy/app fails ENTIRELY and the
// bundled runtime dies at import time (Cannot find package ...) for any
// user without a system openclaw install. Vendor each workspace dep's
// built package into vendor/<name> and rewrite the specifier to a file:
// path — recursively, because vendored packages can carry workspace deps
// of their own (media-core → normalization-core).
function vendorWorkspaceDeps(destDir, workspaceDir) {
  const vendorRoot = path.join(destDir, "vendor");
  const packagesDir = path.join(workspaceDir, "packages");
  /** @type {Map<string, string>} package name -> vendor dir basename */
  const vendored = new Map();

  const findWorkspacePackageDir = (name) => {
    // Runtime workspace libs all live under packages/*; scan by manifest
    // name so scoped names need no directory-naming convention.
    for (const entry of fs.readdirSync(packagesDir)) {
      const pkgPath = path.join(packagesDir, entry, "package.json");
      if (!fs.existsSync(pkgPath)) continue;
      if (JSON.parse(fs.readFileSync(pkgPath, "utf8")).name === name) {
        return path.join(packagesDir, entry);
      }
    }
    return null;
  };

  const vendorOne = (name) => {
    if (vendored.has(name)) return vendored.get(name);
    const srcDir = findWorkspacePackageDir(name);
    if (!srcDir) {
      throw new Error(
        `workspace dependency "${name}" not found under packages/ — cannot build a self-contained bundle`,
      );
    }
    const distDir = path.join(srcDir, "dist");
    if (!fs.existsSync(distDir)) {
      throw new Error(
        `workspace dependency "${name}" has no dist/ — build the workspace before bundling`,
      );
    }
    const safe = name.replace(/^@/, "").replace(/\//g, "-");
    const dstDir = path.join(vendorRoot, safe);
    fs.mkdirSync(dstDir, { recursive: true });
    fs.copyFileSync(path.join(srcDir, "package.json"), path.join(dstDir, "package.json"));
    mirror(distDir, path.join(dstDir, "dist"));
    vendored.set(name, safe);

    // Rewrite the vendored package's own workspace deps to sibling paths.
    const pkg = JSON.parse(fs.readFileSync(path.join(dstDir, "package.json"), "utf8"));
    for (const [dep, spec] of Object.entries(pkg.dependencies ?? {})) {
      if (String(spec).startsWith("workspace:")) {
        pkg.dependencies[dep] = `file:../${vendorOne(dep)}`;
      }
    }
    // devDependencies never install (--production) but may carry workspace
    // specifiers bun would still try to parse — drop them outright.
    delete pkg.devDependencies;
    fs.writeFileSync(path.join(dstDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
    return safe;
  };

  const rootManifestPath = path.join(destDir, "package.json");
  const rootManifest = JSON.parse(fs.readFileSync(rootManifestPath, "utf8"));
  let count = 0;
  for (const [dep, spec] of Object.entries(rootManifest.dependencies ?? {})) {
    if (String(spec).startsWith("workspace:")) {
      rootManifest.dependencies[dep] = `file:./vendor/${vendorOne(dep)}`;
      count++;
    }
  }
  // Same hazard as the per-package delete above, one level up: the payload
  // installs with `--production`, so devDependencies never install — but bun
  // still PARSES them and aborts the entire install on a workspace: specifier
  // it cannot resolve. An upstream sync only has to add one workspace devDep
  // (2026-08-15: @openclaw/session-url-contract) and every fresh install dies
  // with no node_modules. Drop them; a shipped runtime has no use for them.
  const hadDevDependencies = rootManifest.devDependencies !== undefined;
  delete rootManifest.devDependencies;
  if (count > 0 || hadDevDependencies) {
    fs.writeFileSync(rootManifestPath, JSON.stringify(rootManifest, null, 2) + "\n");
  }
  return { count, vendored: [...vendored.keys()] };
}

const vendorResult = vendorWorkspaceDeps(DEST_DIR, WORKSPACE_DIR);
if (vendorResult.count > 0) {
  log(`vendored workspace deps: ${vendorResult.vendored.join(", ")}`);
} else {
  log("no workspace-protocol deps to vendor");
}

// ── 6. Bundle stamp ──────────────────────────────────────────────────────────
// Embed build provenance into the shipped payload so post-release debugging
// can identify exactly which workspace commit, Node version, and runtime
// versions a given DMG/EXE came from. Auto-detected from the workspace;
// callers can override any field via OPENCLAW_BUNDLE_STAMP_<KEY> env vars.
function safeGit(args) {
  try {
    return execSync(`git ${args}`, {
      cwd: WORKSPACE_DIR,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

const stamp = {
  version: JSON.parse(fs.readFileSync(ROOT_PKG, "utf8")).version,
  builtAt: new Date().toISOString(),
  commit:
    process.env.OPENCLAW_BUNDLE_STAMP_COMMIT ||
    safeGit("rev-parse HEAD") ||
    null,
  commitShort:
    process.env.OPENCLAW_BUNDLE_STAMP_COMMIT_SHORT ||
    safeGit("rev-parse --short HEAD") ||
    null,
  branch:
    process.env.OPENCLAW_BUNDLE_STAMP_BRANCH ||
    safeGit("rev-parse --abbrev-ref HEAD") ||
    null,
  platform:
    process.env.OPENCLAW_BUNDLE_STAMP_PLATFORM || `${process.platform}-${process.arch}`,
  nodeVersion: process.version,
  bunVersion: process.env.OPENCLAW_BUNDLE_STAMP_BUN_VERSION || null,
  ci: process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true",
  workflow: process.env.GITHUB_WORKFLOW || null,
  runId: process.env.GITHUB_RUN_ID || null,
};
fs.writeFileSync(
  path.join(DEST_DIR, "bundle-stamp.json"),
  JSON.stringify(stamp, null, 2) + "\n",
);
log(`bundle-stamp.json written (commit ${stamp.commitShort || "?"}, ${stamp.platform})`);

// ── 7. Strip lockfiles ───────────────────────────────────────────────────────
// The bundled package.json is the workspace-root manifest; if a lockfile
// from this dev tree leaks into the installer, `bun install` at runtime
// will refuse or resolve against unexpected versions.
for (const lock of ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"]) {
  const lockPath = path.join(DEST_DIR, lock);
  if (fs.existsSync(lockPath)) fs.rmSync(lockPath, { force: true });
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log("");
log("OpenClaw bundle prepared:");
console.log(`  ${DEST_DIR}/dist                     ${humanSize(dirSize(path.join(DEST_DIR, "dist")))}`);
console.log(`  ${DEST_DIR}/extensions               ${humanSize(dirSize(path.join(DEST_DIR, "extensions")))}`);
console.log(`  ${DEST_DIR}/skills                   ${humanSize(dirSize(path.join(DEST_DIR, "skills")))}`);
console.log(`  ${DEST_DIR}/docs/reference/templates ${humanSize(dirSize(path.join(DEST_DIR, "docs", "reference", "templates")))}`);
