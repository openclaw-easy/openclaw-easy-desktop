import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  isExtensionsDirUsable,
  describeMissingLoaders,
} from "./extensions-dir-usability";

function makeTmpExtensionsDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ext-usability-test-"));
}

describe("isExtensionsDirUsable", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTmpExtensionsDir();
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns false when the directory does not exist", () => {
    expect(isExtensionsDirUsable(path.join(tmp, "no-such-dir"))).toBe(false);
  });

  it("returns false when the sentinel (whatsapp) is missing", () => {
    // Empty extensions tree — no whatsapp/ at all.
    expect(isExtensionsDirUsable(tmp)).toBe(false);
  });

  it("returns false when whatsapp/ has only TypeScript sources", () => {
    // This is the broken dev-mode state that crashed Doctor.
    const sentinel = path.join(tmp, "whatsapp");
    fs.mkdirSync(sentinel);
    fs.writeFileSync(path.join(sentinel, "index.ts"), "export const x = 1;");
    expect(isExtensionsDirUsable(tmp)).toBe(false);
  });

  it("returns true when whatsapp/index.js exists", () => {
    const sentinel = path.join(tmp, "whatsapp");
    fs.mkdirSync(sentinel);
    fs.writeFileSync(path.join(sentinel, "index.js"), "module.exports = {};");
    expect(isExtensionsDirUsable(tmp)).toBe(true);
  });

  it("returns true when whatsapp/dist/index.js exists (sub-dir build output)", () => {
    const sentinel = path.join(tmp, "whatsapp", "dist");
    fs.mkdirSync(sentinel, { recursive: true });
    fs.writeFileSync(path.join(sentinel, "index.js"), "module.exports = {};");
    expect(isExtensionsDirUsable(tmp)).toBe(true);
  });

  it("returns true for index.mjs or index.cjs", () => {
    const a = makeTmpExtensionsDir();
    const b = makeTmpExtensionsDir();
    try {
      fs.mkdirSync(path.join(a, "whatsapp"));
      fs.writeFileSync(path.join(a, "whatsapp", "index.mjs"), "export default {};");
      expect(isExtensionsDirUsable(a)).toBe(true);

      fs.mkdirSync(path.join(b, "whatsapp"));
      fs.writeFileSync(path.join(b, "whatsapp", "index.cjs"), "module.exports = {};");
      expect(isExtensionsDirUsable(b)).toBe(true);
    } finally {
      fs.rmSync(a, { recursive: true, force: true });
      fs.rmSync(b, { recursive: true, force: true });
    }
  });

  it("returns false for sources next to a built sibling — sentinel must itself be built", () => {
    // openai is built, whatsapp is not — the sentinel-based check is strict.
    fs.mkdirSync(path.join(tmp, "openai"));
    fs.writeFileSync(path.join(tmp, "openai", "index.js"), "module.exports = {};");
    fs.mkdirSync(path.join(tmp, "whatsapp"));
    fs.writeFileSync(path.join(tmp, "whatsapp", "index.ts"), "export const x = 1;");
    expect(isExtensionsDirUsable(tmp)).toBe(false);
  });
});

describe("describeMissingLoaders", () => {
  it("names every expected loader filename so dev logs are debuggable", () => {
    const desc = describeMissingLoaders("/some/path");
    expect(desc).toContain("whatsapp");
    expect(desc).toContain("index.js");
    expect(desc).toContain("index.mjs");
    expect(desc).toContain("index.cjs");
    expect(desc).toContain(path.join("dist", "index.js"));
  });
});
