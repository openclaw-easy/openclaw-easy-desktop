import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  waitForDashboard,
  startAssistant,
  stopAssistant,
  goToSection,
  filterConsoleErrors,
} from "./fixtures";

// Drives the REAL installed/notarized app (not the dev out/ build) to prove the
// production runtime: signed app + bundled Node gateway + node:sqlite. Launch
// via executablePath = the installed .app's main binary. Run with the user's
// own instance quit and the shared gateway stopped (the runner script handles
// that) so the gateway port + ~/.openclaw are free.
const APP_BIN = "/Applications/Openclaw Easy.app/Contents/MacOS/Openclaw Easy";

// Only meaningful where the app is actually installed (a local post-release
// verification, not a CI gate). Skip everywhere else so the normal suite stays
// green. Run the user's instance quit + gateway stopped before invoking.
test.skip(!existsSync(APP_BIN), "Installed app not present at /Applications — local post-release check only");

async function launchInstalled(): Promise<{ app: ElectronApplication; page: Page; consoleErrors: string[]; userDataDir: string }> {
  const userDataDir = await mkdtemp(join(tmpdir(), "openclaw-installed-e2e-"));
  const app = await _electron.launch({
    executablePath: APP_BIN,
    args: [`--user-data-dir=${userDataDir}`, "--no-sandbox", "--disable-gpu-sandbox"],
    env: { ...process.env, OPENCLAW_E2E: "1", ELECTRON_RUN_AS_NODE: "" },
    timeout: 120_000,
  });
  const consoleErrors: string[] = [];
  const page = await app.firstWindow();
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  return { app, page, consoleErrors, userDataDir };
}

test.describe("Installed packaged app (production runtime)", () => {
  test("launches + renders the dashboard with no console errors", async () => {
    const { app, page, consoleErrors, userDataDir } = await launchInstalled();
    try {
      await waitForDashboard(page);
      const errs = filterConsoleErrors(consoleErrors);
      expect(errs, errs.join(" | ")).toEqual([]);
    } finally {
      await app.close().catch(() => {});
      await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("Launch Assistant boots the gateway under the bundled Node (WS up)", async () => {
    const { app, page, userDataDir } = await launchInstalled();
    try {
      await waitForDashboard(page);
      // This spawns the bundled Node → openclaw.mjs gateway run. The WS coming
      // up proves node:sqlite + the gateway work in the packaged/signed app.
      await startAssistant(page);
      await goToSection(page, "Chat");
      await page.waitForFunction(
        () => !/Disconnected/i.test(document.body.textContent || ""),
        { timeout: 90_000 },
      );
      await stopAssistant(page).catch(() => {});
    } finally {
      await app.close().catch(() => {});
      await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("Doctor runs a clean report (no plugin-load failures) under bundled Node", async () => {
    const { app, page, userDataDir } = await launchInstalled();
    try {
      await waitForDashboard(page);
      await goToSection(page, "Doctor");
      const runBtn = page.getByRole("button", { name: /run diagnostics|run doctor|^run$/i }).first();
      await runBtn.waitFor({ state: "visible", timeout: 10_000 });
      await runBtn.click();
      // Wait for the report to render and assert no plugin-load failure surfaced.
      await page.waitForFunction(
        () => /no issues|healthy|passed|✓|complete|ok/i.test(document.body.textContent || ""),
        { timeout: 60_000 },
      );
      const body = (await page.locator("body").textContent()) ?? "";
      expect(body).not.toMatch(/plugin load failed|Cannot find module|SQLite support is unavailable/i);
    } finally {
      await app.close().catch(() => {});
      await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
