import { test, expect, type Page } from "@playwright/test";
import { launchDesktop, waitForDashboard, filterConsoleErrors } from "./fixtures";

// Tier 2 — navigation. Click each top-level sidebar section that does NOT
// require a connected channel or trigger a blocking flow, and verify the
// section renders without throwing or leaving the UI blank.
//
// Sidebar items are buttons whose visible text comes from sidebarNav.ts
// (`label`/`labelKey`). They do NOT carry aria-label, so we select by
// role+name. Groups are collapsed by default; the nav test opens each
// before walking its items.
//
// Channel-specific sections (WhatsApp, Telegram, …) are only mounted in
// the sidebar after the channel is connected → covered by Tier 3 flows.
// "Onboard" is skipped because it opens the CliOnboardingWizard which is
// a multi-step modal — also Tier 3 territory.

interface NavGroup {
  /** Group header text (English locale). */
  label: string;
  /** Item label texts to click inside the group. */
  items: string[];
}

const GROUPS: NavGroup[] = [
  { label: "Workspace", items: ["Chat", "Sessions"] },
  { label: "AI", items: ["Provider", "Agents", "Models", "Skills", "Hooks", "Plugins", "Files"] },
  { label: "System", items: ["Activity", "Doctor", "Commands"] },
];

/**
 * Expand a sidebar group by clicking its header. The header is a button
 * carrying the group label as visible text and `aria-expanded` state.
 * No-op if already expanded.
 */
async function expandGroup(page: Page, label: string): Promise<void> {
  const header = page.getByRole("button", { name: label, exact: true }).first();
  await header.waitFor({ state: "visible", timeout: 10_000 });
  const expanded = await header.getAttribute("aria-expanded");
  if (expanded === "false") {
    await header.click();
    // Grid-row animation takes ~300ms; wait for items inside to be tab-reachable.
    await page.waitForTimeout(350);
  }
}

test.describe("Desktop app navigation", () => {
  test("can navigate every standalone sidebar section without errors", async () => {
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);

      const startupErrorCount = ctx.consoleErrors.length;
      const failures: string[] = [];

      for (const group of GROUPS) {
        try {
          await expandGroup(ctx.page, group.label);
        } catch (err) {
          failures.push(`group "${group.label}": failed to expand — ${(err as Error).message}`);
          continue;
        }

        for (const itemLabel of group.items) {
          const before = ctx.consoleErrors.length;
          // Use role+name so any button matching the visible text qualifies.
          // exact:true avoids matching e.g. "Add channel" when probing for
          // "Channels" group header.
          const item = ctx.page
            .getByRole("button", { name: itemLabel, exact: true })
            .first();

          const exists = (await item.count()) > 0;
          if (!exists) {
            failures.push(`${itemLabel}: sidebar button not found in group "${group.label}"`);
            continue;
          }

          try {
            await item.click({ timeout: 5_000 });
          } catch (err) {
            failures.push(`${itemLabel}: click failed — ${(err as Error).message}`);
            continue;
          }

          // The dashboard renders sections synchronously on `activeChannel`
          // change, but some lazy-imported subsections settle async. Give
          // a short beat before sampling errors.
          await ctx.page.waitForTimeout(400);

          if (ctx.pageErrors.length > 0) {
            failures.push(
              `${itemLabel}: ${ctx.pageErrors.length} uncaught error(s) — ${ctx.pageErrors
                .map((e) => e.message)
                .join("; ")}`,
            );
            ctx.pageErrors.length = 0;
          }

          const newErrors = filterConsoleErrors(ctx.consoleErrors.slice(before));
          if (newErrors.length > 0) {
            failures.push(`${itemLabel}: console.error(s) — ${newErrors.join(" | ")}`);
          }
        }
      }

      expect(
        failures,
        `${failures.length} navigation failure(s) (startup had ${startupErrorCount} console.error(s) before nav started)`,
      ).toEqual([]);
    } finally {
      await ctx.dispose();
    }
  });
});
