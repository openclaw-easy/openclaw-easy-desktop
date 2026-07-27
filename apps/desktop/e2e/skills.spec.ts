import { test, expect } from "@playwright/test";
import { launchDesktop, waitForDashboard, goToSection, assertNoNewErrors } from "./fixtures";

// Tier 3b — Skills (ClawHub). SkillsSection lists workspace-installed
// skills + offers a registry search. With no gateway, list will be empty
// but the search input and section header should render.

test.describe("Skills", () => {
  test("Skills section renders without errors", async () => {
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);
      const startConsole = ctx.consoleErrors.length;
      const startPage = ctx.pageErrors.length;

      await goToSection(ctx.page, "Skills");

      const bodyText = (await ctx.page.locator("body").textContent()) ?? "";
      expect(bodyText).toMatch(/skill|clawhub|registry|install|search/i);

      const failures = assertNoNewErrors(ctx, startConsole, startPage);
      expect(failures, failures.join(" | ")).toEqual([]);
    } finally {
      await ctx.dispose();
    }
  });
});
