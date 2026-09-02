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
      // Precondition, not politeness: this test measures the BOOT, so the
      // gateway has to be down before the click. In full-suite order an
      // earlier spec leaves it running and only a Stop button is rendered.
      // Accepting the already-running state instead would make the assertion
      // below vacuous — it would pass without ever starting the bundled Node.
      await stopAssistant(page).catch(() => {});
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
      // Scope every read to the Doctor output pane. The dashboard renders chat
      // next to it, so the old document.body reads swept in the persisted chat
      // transcript: one historical "Cannot find module ..." message failed this
      // test permanently, and the completion regex could match "ok" in any past
      // chat line. Both signals now come from the report itself.
      const report = page.getByTestId("doctor-output");
      await expect(report).not.toBeEmpty({ timeout: 60_000 });
      // Run button re-enables when the run ends (disabled={isRunning}) — a
      // locale-independent completion signal, unlike matching report copy.
      await expect(runBtn).toBeEnabled({ timeout: 60_000 });
      const reportText = (await report.textContent()) ?? "";
      expect(reportText, reportText).not.toMatch(
        /plugin load failed|Cannot find module|SQLite support is unavailable/i,
      );
    } finally {
      await app.close().catch(() => {});
      await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
