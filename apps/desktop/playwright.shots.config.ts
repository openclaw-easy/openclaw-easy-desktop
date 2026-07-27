import { defineConfig } from "@playwright/test";

// Screenshot capture for the README. Separate from playwright.config.ts so the
// e2e suite's retries/reporters don't apply and a capture run can never be
// mistaken for a test run.
export default defineConfig({
  testDir: "./e2e-shots",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  timeout: 180_000,
  expect: { timeout: 15_000 },
});
