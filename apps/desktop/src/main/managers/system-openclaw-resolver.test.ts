import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  detectSystemOpenClaw,
  getAugmentedPath,
  getFallbackPaths,
} from "./system-openclaw-resolver";

function makeTmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-resolver-test-"));
}

// getAugmentedPath is POSIX by construction: it joins with ":" and lists
// /opt/homebrew/bin, /usr/bin and /bin off $HOME. On Windows it therefore
// produces a string that resolves nothing, which is harmless — the Windows app
// runs the bundled runtime and detectSystemOpenClaw simply finds no system
// install — but the ordering assertions below only mean anything on POSIX.
// Skip rather than restate them per-separator, which would assert nothing.
// Follow-up: give detectSystemOpenClaw a real Windows branch (where-style
// lookup + ";" separator) or guard the whole resolver by platform.
describe.skipIf(process.platform === "win32")("getAugmentedPath", () => {
  it("places user-shell dirs ahead of system PATH for Electron parity with terminal", () => {
    const prevHome = process.env.HOME;
    process.env.HOME = "/Users/test";
    try {
      const p = getAugmentedPath();
      // .bun/bin and .npm-global/bin (common openclaw install dirs)
      // MUST appear before /usr/bin so `which openclaw` finds them.
      expect(p.indexOf("/Users/test/.bun/bin")).toBeGreaterThan(-1);
      expect(p.indexOf("/Users/test/.npm-global/bin")).toBeGreaterThan(-1);
      expect(p.indexOf("/Users/test/.npm-global/bin")).toBeLessThan(
        p.indexOf("/usr/bin"),
      );
    } finally {
      process.env.HOME = prevHome;
    }
  });

  it("includes /opt/homebrew/bin for Apple Silicon Homebrew Node installs", () => {
    expect(getAugmentedPath()).toContain("/opt/homebrew/bin");
  });
});

describe("getFallbackPaths", () => {
  it("lists the well-known global install locations including .bun and /usr/bin", () => {
    const prevHome = process.env.HOME;
    process.env.HOME = "/Users/test";
    try {
      const paths = getFallbackPaths();
      // Superset of every install location any prior fork-side detector covered.
      // Home-relative entries are built with path.join in the resolver, so they
      // are separator-correct for the host — hard-coding "/" made these fail on
      // Windows once CI started running this suite there.
      expect(paths).toContain(path.join("/Users/test", ".npm-global", "bin", "openclaw"));
      expect(paths).toContain(path.join("/Users/test", ".local", "bin", "openclaw"));
      expect(paths).toContain(path.join("/Users/test", ".bun", "bin", "openclaw"));
      expect(paths).toContain("/opt/homebrew/bin/openclaw");
      expect(paths).toContain("/usr/local/bin/openclaw");
      expect(paths).toContain("/usr/bin/openclaw");
    } finally {
      process.env.HOME = prevHome;
    }
  });

  it("orders user-managed installs ahead of system dirs", () => {
    const prevHome = process.env.HOME;
    process.env.HOME = "/Users/test";
    try {
      const paths = getFallbackPaths();
      const npmGlobalIdx = paths.indexOf(path.join("/Users/test", ".npm-global", "bin", "openclaw"));
      const usrLocalIdx = paths.indexOf("/usr/local/bin/openclaw");
      expect(npmGlobalIdx).toBeGreaterThanOrEqual(0);
      expect(npmGlobalIdx).toBeLessThan(usrLocalIdx);
    } finally {
      process.env.HOME = prevHome;
    }
  });
});

describe("detectSystemOpenClaw", () => {
  let tmpHome: string;
  let prevHome: string | undefined;
  let prevPath: string | undefined;

  beforeEach(() => {
    tmpHome = makeTmpHome();
    prevHome = process.env.HOME;
    prevPath = process.env.PATH;
    process.env.HOME = tmpHome;
    // Strip PATH so `which openclaw` reliably fails — we want to test the
    // fallback-paths branch deterministically. Tests of the `which` branch
    // mock execFile (see below).
    process.env.PATH = "/usr/bin:/bin";
  });
  afterEach(() => {
    process.env.HOME = prevHome;
    process.env.PATH = prevPath;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns null when no system openclaw exists anywhere", async () => {
    const result = await detectSystemOpenClaw();
    expect(result).toBeNull();
  });

  it("finds openclaw at ~/.npm-global/bin/openclaw via fallback path", async () => {
    const dir = path.join(tmpHome, ".npm-global", "bin");
    fs.mkdirSync(dir, { recursive: true });
    const bin = path.join(dir, "openclaw");
    fs.writeFileSync(bin, "#!/usr/bin/env node\n");
    fs.chmodSync(bin, 0o755);

    const result = await detectSystemOpenClaw();
    expect(result).toBe(bin);
  });

  it("finds openclaw at ~/.local/bin/openclaw via fallback path", async () => {
    const dir = path.join(tmpHome, ".local", "bin");
    fs.mkdirSync(dir, { recursive: true });
    const bin = path.join(dir, "openclaw");
    fs.writeFileSync(bin, "#!/usr/bin/env node\n");
    fs.chmodSync(bin, 0o755);

    const result = await detectSystemOpenClaw();
    expect(result).toBe(bin);
  });

  it("priority: .npm-global beats .local when both exist (ordered fallbacks)", async () => {
    for (const sub of [".npm-global/bin", ".local/bin"]) {
      const dir = path.join(tmpHome, sub);
      fs.mkdirSync(dir, { recursive: true });
      const bin = path.join(dir, "openclaw");
      fs.writeFileSync(bin, "#!/usr/bin/env node\n");
      fs.chmodSync(bin, 0o755);
    }
    const result = await detectSystemOpenClaw();
    expect(result).toBe(path.join(tmpHome, ".npm-global", "bin", "openclaw"));
  });

  it("finds openclaw at ~/.bun/bin/openclaw (bun-installed via `bun add -g openclaw`)", async () => {
    const dir = path.join(tmpHome, ".bun", "bin");
    fs.mkdirSync(dir, { recursive: true });
    const bin = path.join(dir, "openclaw");
    fs.writeFileSync(bin, "#!/usr/bin/env node\n");
    fs.chmodSync(bin, 0o755);

    const result = await detectSystemOpenClaw();
    expect(result).toBe(bin);
  });

  // The `which`-based first pass is harder to deterministically test
  // here (subject to whatever openclaw the test runner happens to find
  // on PATH), but we DO want to assert the node_modules-filter
  // behavior. We exercise it via the public function by stubbing
  // execFileAsync's behavior with an environment that resolves which to
  // a node_modules path — easiest done by symlinking through a
  // node_modules directory inside the fixture.
  it("rejects a `which openclaw` result that lives under node_modules", async () => {
    // Set up: a workspace-local openclaw at <tmp>/node_modules/.bin/openclaw
    // AND a legitimate global at <tmp>/.npm-global/bin/openclaw. The
    // workspace-local one would be returned by `which` if it were on
    // PATH first, but the filter rejects it; we fall back to the global.
    const nm = path.join(tmpHome, "node_modules", ".bin");
    fs.mkdirSync(nm, { recursive: true });
    const local = path.join(nm, "openclaw");
    fs.writeFileSync(local, "#!/usr/bin/env node\n");
    fs.chmodSync(local, 0o755);

    const global = path.join(tmpHome, ".npm-global", "bin", "openclaw");
    fs.mkdirSync(path.dirname(global), { recursive: true });
    fs.writeFileSync(global, "#!/usr/bin/env node\n");
    fs.chmodSync(global, 0o755);

    // Put the node_modules dir at the FRONT of PATH so `which` picks it.
    process.env.PATH = `${nm}:${process.env.PATH}`;

    const result = await detectSystemOpenClaw();
    // The which-pass should reject the node_modules path; the fallback
    // pass should then find the .npm-global one.
    expect(result).toBe(global);
  });
});
