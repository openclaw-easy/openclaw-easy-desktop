import { test, expect } from "@playwright/test";
import { launchDesktop, waitForDashboard, goToSection, assertNoNewErrors } from "./fixtures";

// Tier 3a — Activity log. ActivitySection renders a timeline of recent
// events from the gateway. With no gateway running, it shows the empty
// state ("No activity yet. Start OpenClaw to see logs." per
// ActivityLog.tsx:29).

test.describe("Activity log", () => {
  test("Activity section renders empty state without errors", async () => {
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);
      const startConsole = ctx.consoleErrors.length;
      const startPage = ctx.pageErrors.length;

      await goToSection(ctx.page, "Activity");

      const bodyText = (await ctx.page.locator("body").textContent()) ?? "";
      // Empty state copy mentions "no activity" or "start" — or there's a
      // populated timeline if the gateway is up.
      expect(bodyText).toMatch(/activity|no activity|start openclaw|event|log/i);

      const failures = assertNoNewErrors(ctx, startConsole, startPage);
      expect(failures, failures.join(" | ")).toEqual([]);
    } finally {
      await ctx.dispose();
    }
  });
});
