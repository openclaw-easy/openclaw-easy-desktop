import { test, expect } from "@playwright/test";
import { launchDesktop, waitForDashboard, goToSection, assertNoNewErrors } from "./fixtures";

// Tier 3a/b — Models / Ollama. The ModelManager in src/main/model-manager.ts
// auto-detects Ollama at known absolute paths (/usr/local/bin/ollama,
// /opt/homebrew/bin/ollama, /Applications/Ollama.app/...). The Models
// section in the renderer surfaces:
//   - detection status ("Ollama detected" or install prompt)
//   - list of installed models (output of `ollama list`)
//   - install/remove buttons for known models
//
// On a machine without Ollama, the section should render an install
// prompt without crashing. With Ollama running, the installed model list
// should be present (empty if no models pulled).

test.describe("Models / Ollama", () => {
  test("Models section renders Ollama state without crashing", async () => {
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);
      const startConsole = ctx.consoleErrors.length;
      const startPage = ctx.pageErrors.length;

      await goToSection(ctx.page, "Models");

      // Section header / page indicator should be visible.
      const bodyText = (await ctx.page.locator("body").textContent()) ?? "";
      // Either "ollama" is mentioned (detected, OR install-prompt path),
      // or the section is showing a placeholder.
      expect(bodyText).toMatch(/ollama|model|llama|qwen|install/i);

      const failures = assertNoNewErrors(ctx, startConsole, startPage);
      expect(failures, failures.join(" | ")).toEqual([]);
    } finally {
      await ctx.dispose();
    }
  });

  test("Lists installed models when Ollama is detected", async () => {
    test.skip(!process.env.OPENCLAW_E2E_OLLAMA, "Needs OPENCLAW_E2E_OLLAMA=1 + ollama installed");
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);
      await goToSection(ctx.page, "Models");
      // The renderer's useModelManager() hook calls model:list-installed.
      // Even with no models pulled, the section should render the empty-state
      // copy ("No models installed" or similar) — not crash.
      const bodyText = (await ctx.page.locator("body").textContent()) ?? "";
      expect(bodyText).toMatch(/installed|no models|llama|qwen|deepseek|mistral/i);
    } finally {
      await ctx.dispose();
    }
  });
});
