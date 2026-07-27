import { test, expect } from "@playwright/test";
import { launchDesktop, waitForDashboard, clickLaunchpadTile, assertNoNewErrors } from "./fixtures";

// Tier 3b — Cron. CronSection lists scheduled tasks. Cron is reachable
// via the Quick Actions launchpad's "Cron Jobs" tile (not a direct
// sidebar item). With a gateway it lists entries; without, empty state.

test.describe("Cron", () => {
  test("Cron section renders without errors", async () => {
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);
      const startConsole = ctx.consoleErrors.length;
      const startPage = ctx.pageErrors.length;

      await clickLaunchpadTile(ctx.page, /cron jobs/i);

      const bodyText = (await ctx.page.locator("body").textContent()) ?? "";
      expect(bodyText).toMatch(/cron|schedule|task|recurring|no jobs/i);

      const failures = assertNoNewErrors(ctx, startConsole, startPage);
      expect(failures, failures.join(" | ")).toEqual([]);
    } finally {
      await ctx.dispose();
    }
  });
});
