import { test, expect } from "@playwright/test";
import { launchDesktop, waitForDashboard, goToSection, assertNoNewErrors } from "./fixtures";

// Tier 3b — Plugins. PluginsSection lists installed extensions and
// exposes registry browse/install.

test.describe("Plugins", () => {
  test("Plugins section renders without errors", async () => {
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);
      const startConsole = ctx.consoleErrors.length;
      const startPage = ctx.pageErrors.length;

      await goToSection(ctx.page, "Plugins");

      const bodyText = (await ctx.page.locator("body").textContent()) ?? "";
      expect(bodyText).toMatch(/plugin|extension|install|registry|no plugins/i);

      const failures = assertNoNewErrors(ctx, startConsole, startPage);
      expect(failures, failures.join(" | ")).toEqual([]);
    } finally {
      await ctx.dispose();
    }
  });
});
