import { test, expect } from "@playwright/test";
import { launchDesktop, waitForDashboard, goToSection, assertNoNewErrors } from "./fixtures";

// Tier 3a — Sessions. SessionsSection lists active sessions from the
// gateway via `sessions:list`. With no gateway running it should still
// render an empty state, not crash. Reset / Delete affordances appear
// once a session is present.

test.describe("Sessions", () => {
  test("Sessions section renders without errors", async () => {
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);
      const startConsole = ctx.consoleErrors.length;
      const startPage = ctx.pageErrors.length;

      await goToSection(ctx.page, "Sessions");

      const bodyText = (await ctx.page.locator("body").textContent()) ?? "";
      expect(bodyText).toMatch(/session|no sessions|empty|start/i);

      const failures = assertNoNewErrors(ctx, startConsole, startPage);
      expect(failures, failures.join(" | ")).toEqual([]);
    } finally {
      await ctx.dispose();
    }
  });
});
