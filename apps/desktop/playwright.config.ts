import { defineConfig } from "@playwright/test";

// Electron E2E suite. Each spec launches a fresh Electron instance via
// `_electron.launch()` and drives the renderer like a browser page.
//
// Run with:
//   pnpm run test:e2e            (headless, single worker)
//   pnpm run test:e2e:headed     (visible window for debugging)
//
// CI: tag E2E specs run on a clean job with `pnpm run build` already
// done. Tests assume `out/main/index.js` exists.

export default defineConfig({
  testDir: "./e2e",
  // Electron is heavy; one window at a time avoids GPU/window-server contention.
  workers: 1,
  fullyParallel: false,
  // Build artifacts are required; fail fast if a spec is mis-targeted.
  forbidOnly: !!process.env.CI,
  // Single retry locally (Electron startup can race on the user-data dir
  // unlink between specs); CI gets two retries for transient GPU init flakes.
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: process.env.CI ? "retain-on-failure" : "off",
  },
});
