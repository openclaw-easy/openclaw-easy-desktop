import { test, expect } from "@playwright/test";
import { launchDesktop, waitForDashboard, filterConsoleErrors } from "./fixtures";

// Tier 1 — smoke. Cheapest possible regression net: if any of these fail,
// the build is fundamentally broken and DMGs would ship a non-launching app.

test.describe("Desktop app smoke", () => {
  test("launches and renders dashboard without console errors", async () => {
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);

      // Sanity: a renderer-owned chrome element is on-screen.
      const sidebar = ctx.page.locator(
        '[aria-label="Collapse sidebar"], [aria-label="Expand sidebar"]',
      );
      await expect(sidebar.first()).toBeVisible();

      // The brand title / dashboard root is mounted.
      const dashboardRoot = ctx.page.locator("aside").first();
      await expect(dashboardRoot).toBeVisible();

      // No uncaught renderer exceptions.
      expect(ctx.pageErrors, "uncaught renderer exceptions").toEqual([]);

      // No console.error noise we don't expect (filter list in fixtures.ts).
      const filteredErrors = filterConsoleErrors(ctx.consoleErrors);
      expect(filteredErrors, "console.error output").toEqual([]);
    } finally {
      await ctx.dispose();
    }
  });
});
