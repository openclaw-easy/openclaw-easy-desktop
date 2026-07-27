import { test, expect } from "@playwright/test";
import {
  launchDesktop,
  waitForDashboard,
  goToSection,
  gotoViaCommandPalette,
  assertNoNewErrors,
  snapshotUserConfig,
  restoreUserConfig,
  startAssistant,
} from "./fixtures";

async function gotoProvider(page: import("@playwright/test").Page) {
  // The "Provider" item exists in the AI sidebar group AND in the Cmd+K palette.
  // Sidebar-first attempt:
  try {
    await goToSection(page, "Provider");
    return;
  } catch {
    // Fallback to palette.
    await gotoViaCommandPalette(page, "Provider");
  }
}

// Tier 3b — AI Provider (BYOK). The AIProviderSection renders form fields
// for each provider (Claude, OpenAI, Gemini, OpenRouter, Venice). Each
// has an API key input and (typically) a model selector. Tests assert:
//   - section renders without console errors
//   - at least one provider form field is present
//   - typing into an input updates its value (no read-only / no controlled-component breakage)
//
// Real key validation hits the provider's HTTPS endpoint; that's NOT
// asserted here because it requires a real key. A separate test gated on
// OPENCLAW_E2E_TEST_API_KEY env var exercises the full validate flow.

test.describe("AI Provider (BYOK)", () => {
  // Hard safety net: snapshot both shared config files before every test
  // and restore in `afterEach`, regardless of whether the test claimed to
  // be destructive. Reading-only tests (navigation, render assertions)
  // shouldn't mutate, but earlier full-sweep runs proved otherwise —
  // some renderer paths trigger a config rewrite as a side effect of
  // mounting. Belt-and-suspenders.
  let suiteSnapshot: Awaited<ReturnType<typeof snapshotUserConfig>>;
  test.beforeEach(async () => {
    suiteSnapshot = await snapshotUserConfig();
  });
  test.afterEach(async () => {
    if (suiteSnapshot) await restoreUserConfig(suiteSnapshot);
  });

  test("Provider section renders with mode-selection radios", async () => {
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);
      const startConsole = ctx.consoleErrors.length;
      const startPage = ctx.pageErrors.length;

      await gotoProvider(ctx.page);

      // The Provider section shows 2 mode radios:
      //   - Local LLM (Free)
      //   - Bring Your Own Key
      // There is no hosted/managed option in this build.
      const bodyText = (await ctx.page.locator("body").textContent()) ?? "";
      expect(bodyText).toMatch(/local llm/i);
      expect(bodyText).toMatch(/bring your own key|byok/i);
      expect(bodyText).not.toMatch(/premium/i);

      const failures = assertNoNewErrors(ctx, startConsole, startPage);
      expect(failures, failures.join(" | ")).toEqual([]);
    } finally {
      await ctx.dispose();
    }
  });

  test("Selecting Bring Your Own Key reveals the API key input", async () => {
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);
      await gotoProvider(ctx.page);

      // Click the BYOK row.
      const byokLabel = ctx.page.getByText(/bring your own key/i).first();
      await byokLabel.waitFor({ state: "visible", timeout: 5_000 });
      await byokLabel.click({ force: true });
      await ctx.page.waitForTimeout(800);

      // The form has two modes for the active provider's API-key field:
      //   - "masked view" — user has a saved key; renders a masked span
      //     ("sk-p****c95A") + a "Change Key" button. No input is mounted.
      //   - "input view"  — no saved key; renders an empty password input.
      // The user has a saved key in either ambient state, so check for
      // the masked view first and click "Change Key" to surface the
      // editable input. Either entry path ends at the same input
      // element, which we then prove we can fill.
      const changeKeyBtn = ctx.page.getByRole("button", { name: /change key/i }).first();
      if ((await changeKeyBtn.count()) > 0) {
        await changeKeyBtn.click();
        await ctx.page.waitForTimeout(400);
      }

      const keyInput = ctx.page
        .locator('input[type="password"], input[placeholder*="key" i], input[placeholder*="API" i]')
        .first();
      await keyInput.waitFor({ state: "visible", timeout: 8_000 });

      // Clear whatever the masked view pre-populated, then fill with our
      // sentinel test value (won't validate against any real provider).
      await keyInput.fill("");
      await keyInput.fill("sk-test-e2e-fake-key-not-real-do-not-use");
      await expect(keyInput).toHaveValue("sk-test-e2e-fake-key-not-real-do-not-use");
    } finally {
      await ctx.dispose();
    }
  });

  test("Provider validate flow round-trips with a real API key", async () => {
    test.skip(
      !process.env.OPENCLAW_E2E_TEST_API_KEY,
      "Needs OPENCLAW_E2E_TEST_API_KEY env var with a real provider key",
    );
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);
      await gotoProvider(ctx.page);
      const keyInput = ctx.page
        .locator('input[type="password"], input[placeholder*="key" i], input[placeholder*="API" i]')
        .first();
      await keyInput.fill(process.env.OPENCLAW_E2E_TEST_API_KEY!);
      const validateBtn = ctx.page.getByRole("button", { name: /validate|save|test|verify/i }).first();
      await validateBtn.click();
      await expect(ctx.page.getByText(/valid|saved|connected/i)).toBeVisible({ timeout: 15_000 });
    } finally {
      await ctx.dispose();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Apply Changes — the full save flow.
  // ─────────────────────────────────────────────────────────────────────────
  //
  // These exercise the path that crashed the Launch Assistant after the
  // 2026.6 upstream merge: AI Provider config → Apply → openclaw.json
  // write → gateway restart. Each test that mutates user config
  // snapshots ~/.openclaw/openclaw.json on setup and restores on
  // teardown so dev/user state stays clean.

  test("BYOK with cleared API key shows a validation error (no destructive save)", async () => {
    // ⚠ This test CLEARS the active provider's API key in the form state
    // and clicks Apply. The validation guard fires BEFORE any disk write,
    // so the user's saved key is never touched — but we still snapshot/
    // restore as belt-and-suspenders in case the guard ever regresses.
    const snapshot = await snapshotUserConfig();
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);
      await gotoProvider(ctx.page);

      // Select BYOK.
      await ctx.page.getByText(/bring your own key/i).first().click({ force: true });
      await ctx.page.waitForTimeout(500);

      // If the active provider already has a saved key, the form renders
      // the masked view with a "Change Key" button. Click it to surface
      // the editable input, then clear it. With no saved key, the input
      // is already mounted and empty.
      const changeKeyBtn = ctx.page.getByRole("button", { name: /change key/i }).first();
      if ((await changeKeyBtn.count()) > 0) {
        await changeKeyBtn.click();
        await ctx.page.waitForTimeout(300);
      }
      const keyInput = ctx.page
        .locator('input[type="password"], input[placeholder*="key" i], input[placeholder*="API" i]')
        .first();
      if ((await keyInput.count()) > 0) {
        await keyInput.fill("");
      }

      // Hit Apply Changes — handler refuses to save because the active
      // provider key is now empty.
      const applyBtn = ctx.page.getByRole("button", { name: /apply changes/i }).first();
      await applyBtn.waitFor({ state: "visible", timeout: 5_000 });
      await applyBtn.click();

      // Either of these copies proves the validation guard fired:
      //   - "Please enter your <Provider> API key" (i18n: enterApiKeyFor)
      //   - "Invalid API key format" (i18n: invalidApiKeyFormat)
      const errorToast = ctx.page.getByText(
        /please enter your .*api key|invalid api key|enter (an? )?api key/i,
      );
      await expect(errorToast.first()).toBeVisible({ timeout: 8_000 });
    } finally {
      try {
        await ctx.dispose();
      } finally {
        await restoreUserConfig(snapshot);
      }
    }
  });

  test("Toggle Local LLM → Apply Changes persists across app reload", async () => {
    // ⚠ Destructive: clicks Apply Changes which writes through to BOTH
    // `~/.openclaw/openclaw.json` and `~/.config/openclaw-desktop/app-config.json`.
    // The "persists across reload" assertion REQUIRES the save to survive
    // between two Electron launches, so the restore deliberately happens
    // only at the very end (after the second instance closes) — restoring
    // between launches would defeat the test. The outer try/finally
    // guarantees restore even if the first launch crashes mid-test.
    const snapshot = await snapshotUserConfig();
    try {
      const ctx = await launchDesktop();
      try {
        await waitForDashboard(ctx.page);
        await gotoProvider(ctx.page);

        await ctx.page.getByText(/local llm/i).first().click({ force: true });
        await ctx.page.waitForTimeout(400);

        const applyBtn = ctx.page.getByRole("button", { name: /apply changes/i }).first();
        await applyBtn.click();

        // Wait for save flow to complete (button leaves Applying/Validating).
        await ctx.page.waitForFunction(
          () => {
            const body = document.body.textContent || "";
            if (/configuration applied|saved|applied/i.test(body)) return true;
            const btns = Array.from(document.querySelectorAll("button"));
            return !btns.some((b) => /(applying|validating)/i.test(b.textContent || ""));
          },
          { timeout: 30_000 },
        );
      } finally {
        await ctx.dispose();
      }

      // Relaunch and verify the Local LLM radio is now the checked option
      // — that's the persistence proof.
      const ctx2 = await launchDesktop();
      try {
        await waitForDashboard(ctx2.page);
        await gotoProvider(ctx2.page);
        const localRadio = ctx2.page.locator('input[name="ai-provider"][value="local"]');
        await expect(localRadio).toBeChecked({ timeout: 10_000 });
      } finally {
        await ctx2.dispose();
      }
    } finally {
      // SINGLE restore at the very end — covers happy path + any throw.
      await restoreUserConfig(snapshot);
    }
  });

  test("Apply Changes triggers gateway restart and chat reconnects", async () => {
    // This is the integration test for the bug class that caused the
    // recent Launch Assistant regression: a config write that crashed
    // the gateway at startup. We click Apply Changes (same path used by
    // the user's real flow), then navigate to chat and assert the
    // WebSocket comes back up. If the new config can't boot the
    // gateway, "Disconnected" never goes away and this fails.
    const snapshot = await snapshotUserConfig();
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);

      // Make sure the gateway is running first.
      await startAssistant(ctx.page).catch(() => {
        // already running — fine.
      });

      await gotoProvider(ctx.page);

      // Click Local LLM (always selectable, no key required).
      await ctx.page.getByText(/local llm/i).first().click({ force: true });
      await ctx.page.waitForTimeout(400);

      // Apply.
      const applyBtn = ctx.page.getByRole("button", { name: /apply changes/i }).first();
      await applyBtn.click();

      // Wait for save to complete (button returns to idle label).
      await ctx.page.waitForFunction(
        () => {
          const btns = Array.from(document.querySelectorAll("button"));
          return !btns.some((b) => /(applying|validating)/i.test(b.textContent || ""));
        },
        { timeout: 45_000 },
      );

      // Navigate to chat and verify the WebSocket reconnected after the
      // gateway restart triggered by the config change. "Disconnected"
      // gone from the chat surface == ws is up.
      await goToSection(ctx.page, "Chat");
      await ctx.page.waitForFunction(
        () => !/Disconnected/i.test(document.body.textContent || ""),
        { timeout: 60_000 },
      );
    } finally {
      try {
        await ctx.dispose();
      } finally {
        await restoreUserConfig(snapshot);
      }
    }
  });
});
