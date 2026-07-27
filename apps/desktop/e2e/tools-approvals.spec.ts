import { test, expect } from "@playwright/test";
import { launchDesktop, waitForDashboard, assertNoNewErrors, expandSidebarGroup } from "./fixtures";

// Tier 3b — Tools / exec approvals. ToolsSection surfaces the
// allow/deny rule editor + pending approval queue. The pending queue is
// only populated by live agent runs; with no gateway, only the rules
// editor is visible.
//
// The section may live in a Files/Tools nav slot — search broadly.

test.describe("Tools / exec approvals", () => {
  test("Tools section renders without errors", async () => {
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);
      const startConsole = ctx.consoleErrors.length;
      const startPage = ctx.pageErrors.length;

      // Try common labels — "Tools" or "Files" host this in different
      // sidebar layouts.
      const groups = ["AI", "System", "Workspace"];
      let found = false;
      for (const g of groups) {
        try {
          await expandSidebarGroup(ctx.page, g);
        } catch {
          // group absent
        }
      }
      const candidates = ["Tools", "Files", "Permissions", "Approvals"];
      for (const label of candidates) {
        const btn = ctx.page.getByRole("button", { name: label, exact: true }).first();
        if ((await btn.count()) > 0) {
          await btn.click();
          await ctx.page.waitForTimeout(400);
          found = true;
          break;
        }
      }
      test.skip(!found, "No Tools-like sidebar item found in this build");

      const bodyText = (await ctx.page.locator("body").textContent()) ?? "";
      expect(bodyText).toMatch(/tool|permission|approval|allow|deny|exec/i);

      const failures = assertNoNewErrors(ctx, startConsole, startPage);
      expect(failures, failures.join(" | ")).toEqual([]);
    } finally {
      await ctx.dispose();
    }
  });
});
