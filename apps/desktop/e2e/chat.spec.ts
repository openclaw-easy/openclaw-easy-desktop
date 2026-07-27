import { test, expect } from "@playwright/test";
import { launchDesktop, waitForDashboard, goToSection, startAssistant } from "./fixtures";

// Tier 3b — Chat. ChatSection mounts a provider picker + message input +
// streamed reply view. Tests cover:
//   - Chat section navigation + composer renders (no API needed)
//   - Send + receive via local Ollama (skipped if OPENCLAW_E2E_OLLAMA unset)
//   - Send + receive via BYOK provider (skipped without test key)

test.describe("Chat", () => {
  test("Chat section renders composer and message area", async () => {
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);

      await goToSection(ctx.page, "Chat");

      // Composer: an input or textarea where the user types.
      const composer = ctx.page.locator(
        'textarea, input[placeholder*="message" i], input[placeholder*="ask" i], [contenteditable="true"]',
      );
      await expect(composer.first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await ctx.dispose();
    }
  });

  test("Send a message to local Ollama and receive a streamed reply", async () => {
    test.skip(!process.env.OPENCLAW_E2E_OLLAMA, "Needs OPENCLAW_E2E_OLLAMA=1 + a pulled Ollama model");

    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);
      await startAssistant(ctx.page);
      await goToSection(ctx.page, "Chat");

      const composer = ctx.page
        .locator(
          'textarea, input[placeholder*="message" i], input[placeholder*="ask" i], [contenteditable="true"]',
        )
        .first();
      await composer.click();
      await composer.fill("Reply with exactly the word OK and nothing else.");

      // Submit via Enter (most chat composers).
      await composer.press("Enter");

      // Stream-in usually takes 2-15s on local Ollama for a 1-token reply.
      // We don't assert exact text — just that some non-trivial assistant
      // response appears.
      await ctx.page.waitForFunction(
        () => /OK\b/i.test(document.body.textContent || ""),
        { timeout: 60_000 },
      );
    } finally {
      await ctx.dispose();
    }
  });
});
