import { test, expect } from "@playwright/test";
import {
  launchDesktop,
  waitForDashboard,
  goToSection,
  assertNoNewErrors,
  snapshotUserConfig,
  restoreUserConfig,
  startAssistant,
} from "./fixtures";

// Tier 3b — Agents. The Agent Management section renders one row per
// configured agent (loaded from the gateway via `agents:list`), each with
// a "Configure" button that opens AgentFormModal. The modal exposes:
//   - Agent name (disabled in configure mode — id can't change)
//   - Model <select> grouped by active provider (local / BYOK cloud)
//   - Save Changes button → persists via `agents:update` IPC → restarts
//     the gateway → success toast "Model switched — chat is using the
//     new model."
//
// Tests below cover:
//   1. Section renders, error-free (original Tier-3 smoke).
//   2. Configure modal opens with the agent's current model preselected.
//   3. Changing model + Save Changes persists the new model and surfaces
//      the success toast. Snapshot/restore the shared user config so
//      destructive mutations never leak into the dev install.

test.describe("Agents", () => {
  // Hard safety net — snapshot both shared config files before every
  // test, restore in afterEach. Same rationale as AI Provider spec:
  // mounting flows can rewrite config as a side effect, so we restore
  // unconditionally rather than rely on per-test discipline.
  let suiteSnapshot: Awaited<ReturnType<typeof snapshotUserConfig>>;
  test.beforeEach(async () => {
    suiteSnapshot = await snapshotUserConfig();
  });
  test.afterEach(async () => {
    if (suiteSnapshot) await restoreUserConfig(suiteSnapshot);
  });

  test("Agents section renders without errors", async () => {
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);
      const startConsole = ctx.consoleErrors.length;
      const startPage = ctx.pageErrors.length;

      await goToSection(ctx.page, "Agents");

      const bodyText = (await ctx.page.locator("body").textContent()) ?? "";
      expect(bodyText).toMatch(/agent|create|new agent|no agents|empty/i);

      const failures = assertNoNewErrors(ctx, startConsole, startPage);
      expect(failures, failures.join(" | ")).toEqual([]);
    } finally {
      await ctx.dispose();
    }
  });

  test("Clicking Configure opens the modal with current model preselected", async () => {
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);

      // Agent list loads from the gateway — make sure it's running so we
      // see at least the "main" agent. Without a gateway the list stays
      // empty and there's no row to click Configure on.
      await startAssistant(ctx.page).catch(() => {});
      await goToSection(ctx.page, "Agents");

      const configureBtn = ctx.page
        .getByRole("button", { name: /^configure$/i })
        .first();
      await configureBtn.waitFor({ state: "visible", timeout: 30_000 });
      await configureBtn.click();

      // Modal title for configure mode reads "Configure Agent: <name>"
      // (i18n key agentForm.configureAgent). Match loosely so a future
      // copy tweak doesn't break the test.
      const modalTitle = ctx.page.getByText(/configure agent/i).first();
      await expect(modalTitle).toBeVisible({ timeout: 5_000 });

      // The Model field has TWO render branches:
      //   - "no local models" warning: activeProvider==='local' and Ollama
      //     has no installed models. This is the correct UX for a fresh
      //     test environment where app-config.json defaults aiProvider to
      //     local. Skip — there's no <select> to assert against.
      //   - <select>: any other state.
      const noModelsWarning = ctx.page.getByText(/no local models installed/i);
      const hasNoModelsWarning = (await noModelsWarning.count()) > 0;
      test.skip(
        hasNoModelsWarning,
        "Test env has aiProvider=local with no Ollama models — modal renders an info banner, not a <select>",
      );

      const modelSelect = ctx.page.locator("select").first();
      await expect(modelSelect).toBeVisible();
      const currentSelected = await modelSelect.inputValue();
      expect(currentSelected.length).toBeGreaterThan(0);
    } finally {
      await ctx.dispose();
    }
  });

  test("Change model in Configure modal + Save Changes persists and toasts", async () => {
    // ⚠ Destructive: Save Changes writes through to ~/.openclaw/openclaw.json
    // and triggers a gateway restart. Snapshot/restore the shared user
    // config so we don't leak the test's pick into the dev install.
    const snapshot = await snapshotUserConfig();
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);
      await startAssistant(ctx.page).catch(() => {});
      await goToSection(ctx.page, "Agents");

      // 1) Open Configure on the first agent.
      const configureBtn = ctx.page
        .getByRole("button", { name: /^configure$/i })
        .first();
      await configureBtn.waitFor({ state: "visible", timeout: 30_000 });
      await configureBtn.click();
      await ctx.page.getByText(/configure agent/i).first().waitFor({ state: "visible" });

      // Same gate as the preselected test — skip when the modal renders
      // the "no local models" info banner instead of a <select>. That's
      // the correct UX in a fresh test env (default aiProvider=local +
      // no Ollama models); the Save flow can't be exercised here.
      const noModelsWarning = ctx.page.getByText(/no local models installed/i);
      const hasNoModelsWarning = (await noModelsWarning.count()) > 0;
      test.skip(
        hasNoModelsWarning,
        "Test env has aiProvider=local with no Ollama models — modal renders an info banner, not a <select>",
      );

      // 2) Find the model <select>, capture its current value, then pick
      //    a different option. We don't know which provider mode the
      //    dev's config uses, so iterate the options and choose any one
      //    that differs from the current value.
      const modelSelect = ctx.page.locator("select").first();
      const originalValue = await modelSelect.inputValue();

      const options = await modelSelect
        .locator("option")
        .evaluateAll((els) =>
          els.map((e) => ({ value: (e as HTMLOptionElement).value, text: e.textContent || "" })),
        );
      const altOption = options.find((o) => o.value && o.value !== originalValue);
      test.skip(
        !altOption,
        "Need at least two selectable models to test model-change Save flow — current provider has only one",
      );

      await modelSelect.selectOption(altOption!.value);
      const newValue = await modelSelect.inputValue();
      expect(newValue).toBe(altOption!.value);
      expect(newValue).not.toBe(originalValue);

      // 3) Click Save Changes. AgentFormModal renders this as
      //    "Save Changes" in configure mode (vs "Create Agent" in create
      //    mode).
      const saveBtn = ctx.page.getByRole("button", { name: /save changes/i }).first();
      await expect(saveBtn).toBeVisible();
      await saveBtn.click();

      // 4) Success toast — AgentManager fires "Model switched — chat is
      //    using the new model." once the gateway restart IPC resolves.
      const successToast = ctx.page.getByText(/model switched|chat is using the new model|saved/i);
      await expect(successToast.first()).toBeVisible({ timeout: 60_000 });

      // 5) Modal closes on success (AgentManager calls onModalClose after
      //    loadAgents). Verify the agents list now shows the new model
      //    string on the corresponding row.
      await ctx.page.waitForFunction(
        (newModel) => (document.body.textContent || "").includes(newModel),
        newValue,
        { timeout: 15_000 },
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
