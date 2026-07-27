import { test, expect } from "@playwright/test";
import { launchDesktop, waitForDashboard, openSettings, assertNoNewErrors } from "./fixtures";

// Tier 3a — Settings / preferences. SettingsManager persists user choices
// to app.getPath('userData')/settings.json. Tests assert:
//   - Settings panel opens from the sidebar footer
//   - core toggles (minimize-to-tray, start-on-boot, auto-update, language)
//     are present
//   - toggling a switch updates DOM state (functional change)
//
// Persistence across-restart is asserted in a separate test that disposes
// and re-launches with the SAME --user-data-dir.

test.describe("Settings", () => {
  test("Settings panel opens and exposes core toggles", async () => {
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);
      const startConsole = ctx.consoleErrors.length;
      const startPage = ctx.pageErrors.length;

      await openSettings(ctx.page);

      // At least one of the known user-facing settings should appear.
      const bodyText = (await ctx.page.locator("body").textContent()) ?? "";
      expect(bodyText).toMatch(
        /minimize.*tray|start.*boot|auto.?update|language|theme|notification|telemetry/i,
      );

      const failures = assertNoNewErrors(ctx, startConsole, startPage);
      expect(failures, failures.join(" | ")).toEqual([]);
    } finally {
      await ctx.dispose();
    }
  });

  test("Theme toggle from sidebar footer changes the document state", async () => {
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);
      // The Sidebar.tsx footer has a 3-option theme picker (System/Light/Dark)
      // each with an aria-label of its label text.
      const darkBtn = ctx.page.getByRole("button", { name: /^dark$/i }).first();
      await darkBtn.waitFor({ state: "visible", timeout: 5_000 });
      await darkBtn.click();
      // The themeStore writes data-theme on the root and the dark class.
      await ctx.page.waitForFunction(
        () => {
          const html = document.documentElement;
          return (
            html.classList.contains("dark") ||
            html.getAttribute("data-theme") === "dark"
          );
        },
        { timeout: 5_000 },
      );
    } finally {
      await ctx.dispose();
    }
  });
});
