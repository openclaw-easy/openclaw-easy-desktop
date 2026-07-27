import { test, expect, type Page } from "@playwright/test";
import {
  launchDesktop,
  waitForDashboard,
  goToSection,
  gotoViaCommandPalette,
  snapshotUserConfig,
  restoreUserConfig,
} from "./fixtures";

// Verifies the BYOK model dropdowns reflect the current provider catalog
// (src/shared/providerModels.ts) after the 2026-06-25 refresh. Asserts that
// each provider's <select> contains the newly-added model IDs and no longer
// contains the removed/stale ones. The model picker is a native <select>
// whose options are in the DOM as soon as BYOK + a provider is selected, so
// no dropdown-open interaction is needed. The BYOK model <select> is uniquely
// identified by containing an <option value="custom">.

const EXPECT: Record<string, { present: string[]; absent: string[] }> = {
  google: {
    present: ["gemini-3.5-flash", "gemini-3.1-pro", "gemini-3.1-flash-lite"],
    absent: ["gemini-2.5-pro", "gemini-2.5-flash"],
  },
  openai: {
    present: ["gpt-5.5-pro", "gpt-5.5", "gpt-5.4", "o4-mini"],
    absent: ["o3"],
  },
  venice: {
    present: ["zai-org-glm-5-2", "deepseek-v4-pro", "grok-4-3", "kimi-k2-7-code"],
    absent: ["qwen-3-7-max", "zai-org-glm-4-7", "venice-uncensored-1-2"],
  },
  openrouter: {
    present: ["anthropic/claude-opus-4.8", "anthropic/claude-fable-5", "x-ai/grok-4.3", "deepseek/deepseek-v4-pro"],
    absent: ["anthropic/claude-opus-4.7", "google/gemini-2.5-pro", "x-ai/grok-4", "meta-llama/llama-4-maverick"],
  },
};

async function gotoProvider(page: Page) {
  try {
    await goToSection(page, "Provider");
  } catch {
    await gotoViaCommandPalette(page, "Provider");
  }
}

/** Returns the option `value`s of the BYOK model <select> (the one with a
 *  "custom" option), after selecting BYOK + the given provider radio. */
async function readModelOptionValues(page: Page, provider: string): Promise<string[]> {
  // Enter BYOK mode (idempotent — clicking when already selected is harmless).
  await page.getByText(/bring your own key/i).first().click({ force: true });
  await page.waitForTimeout(300);
  // Pick the provider via its hidden radio.
  await page.locator(`input[name="byok-provider"][value="${provider}"]`).check({ force: true });
  await page.waitForTimeout(300);
  // The BYOK model select is the only <select> carrying an option value="custom".
  const select = page.locator('select:has(option[value="custom"])').first();
  await select.waitFor({ state: "attached", timeout: 8_000 });
  return select.locator("option").evaluateAll((opts) =>
    opts.map((o) => (o as HTMLOptionElement).value),
  );
}

test.describe("AI Provider — model catalog (2026-06-25 refresh)", () => {
  let snapshot: Awaited<ReturnType<typeof snapshotUserConfig>>;
  test.beforeEach(async () => {
    snapshot = await snapshotUserConfig();
  });
  test.afterEach(async () => {
    if (snapshot) await restoreUserConfig(snapshot);
  });

  for (const [provider, { present, absent }] of Object.entries(EXPECT)) {
    test(`${provider}: dropdown has current models, no stale ones`, async () => {
      const ctx = await launchDesktop();
      try {
        await waitForDashboard(ctx.page);
        await gotoProvider(ctx.page);

        const values = await readModelOptionValues(ctx.page, provider);

        for (const id of present) {
          expect(values, `${provider}: missing current model "${id}" (got: ${values.join(", ")})`).toContain(id);
        }
        for (const id of absent) {
          expect(values, `${provider}: stale model "${id}" still present`).not.toContain(id);
        }
        // Every provider also keeps the Custom escape hatch.
        expect(values).toContain("custom");
      } finally {
        await ctx.dispose();
      }
    });
  }
});
