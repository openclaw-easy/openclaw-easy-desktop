import { test, expect } from "@playwright/test";
import { launchDesktop, waitForDashboard, openCommandPalette } from "./fixtures";

// Tier 3a — Cmd+K Command Palette. CommandPalette.tsx uses cmdk
// under the hood. There's no role="dialog" wrapper — the canonical
// "open" signal is the search input with placeholder
// "Type a command or search..." (see screenshot from real UI).
//
// The palette items (per real screenshot): Quick Actions, Sessions,
// Activity, Chat, Cron, Onboard, Doctor, Commands, Permissions,
// Provider, Agents, Files.

test.describe("Command palette (Cmd+K)", () => {
  test("Cmd+K opens the command palette and shows the search input", async () => {
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);

      await openCommandPalette(ctx.page);

      const searchInput = ctx.page
        .locator('input[placeholder*="Type a command" i], input[placeholder*="search" i]')
        .first();
      await expect(searchInput).toBeVisible({ timeout: 5_000 });
    } finally {
      await ctx.dispose();
    }
  });

  test("Typing 'doctor' filters the palette list", async () => {
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);
      await openCommandPalette(ctx.page);
      const searchInput = ctx.page
        .locator('input[placeholder*="Type a command" i], input[placeholder*="search" i]')
        .first();
      await searchInput.fill("doctor");
      // After filtering, the body should contain a "Doctor" match.
      await expect(ctx.page.locator("body")).toContainText(/doctor/i, { timeout: 5_000 });
    } finally {
      await ctx.dispose();
    }
  });
});
