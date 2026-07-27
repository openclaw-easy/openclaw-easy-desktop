import { test, expect } from "@playwright/test";
import {
  launchDesktop,
  waitForDashboard,
  goToSection,
  assertNoNewErrors,
} from "./fixtures";

// Tier 3a — Doctor. The DoctorSection clicks `openclaw doctor` against the
// detected gateway runtime (system / bundled) and streams the report into
// a log pane. Two specs:
//
//   1. Renders + exposes Run Diagnostics button (smoke).
//   2. Clicking Run Diagnostics produces a clean report — NO "failed to
//      load" / "Cannot find module" cascade. This caught the regression
//      where the desktop overrode OPENCLAW_BUNDLED_PLUGINS_DIR with the
//      unbuilt local-workspace extensions dir, sending the gateway's
//      plugin loader at TS sources whose subpath imports could not
//      resolve. See managers/extensions-dir-usability.ts for the gate.

test.describe("Doctor", () => {
  test("Doctor section renders and exposes a Run button", async () => {
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);
      const startConsole = ctx.consoleErrors.length;
      const startPage = ctx.pageErrors.length;

      await goToSection(ctx.page, "Doctor");

      const bodyText = (await ctx.page.locator("body").textContent()) ?? "";
      expect(bodyText).toMatch(/doctor|diagnostic|health|check/i);

      const runBtn = ctx.page
        .getByRole("button", { name: /run diagnostics|run/i })
        .first();
      const runBtnCount = await runBtn.count();
      expect(runBtnCount).toBeGreaterThan(0);

      const failures = assertNoNewErrors(ctx, startConsole, startPage);
      expect(failures, failures.join(" | ")).toEqual([]);
    } finally {
      await ctx.dispose();
    }
  });

  test("Run Diagnostics produces a clean report (no plugin-load failures)", async () => {
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);
      await goToSection(ctx.page, "Doctor");

      // Click the Run Diagnostics button.
      const runBtn = ctx.page
        .getByRole("button", { name: /run diagnostics/i })
        .first();
      await runBtn.waitFor({ state: "visible", timeout: 10_000 });
      await runBtn.click();

      // Wait for the run to finish. The button label flips back from
      // "Running…" once the IPC returns and `isRunning` toggles false.
      await ctx.page.waitForFunction(
        () => {
          const btns = Array.from(document.querySelectorAll("button"));
          return !btns.some((b) => /running/i.test(b.textContent || ""));
        },
        { timeout: 120_000 },
      );

      // The log pane is the only multi-line, monospaced-looking output
      // area on this section. We grab the whole body text and assert
      // against the failure substrings that flagged the bug:
      //
      //   - "failed to load bundled channel"
      //   - "Cannot find module '@openclaw/normalization-core/..."
      //   - "Cannot find module '@openclaw/media-core/..."
      //   - "Cannot find module '@openclaw/model-catalog-core/..."
      //
      // Any of these means the gateway's plugin loader is being pointed
      // at an unloadable source tree — a regression on the
      // extensions-dir-usability gate.
      const body = (await ctx.page.locator("body").textContent()) ?? "";

      const forbiddenPatterns: RegExp[] = [
        // Unbuilt local-extensions cascade (managed by extensions-dir-usability).
        /failed to load bundled channel/i,
        /Cannot find module '@openclaw\/normalization-core\//i,
        /Cannot find module '@openclaw\/media-core\//i,
        /Cannot find module '@openclaw\/model-catalog-core\//i,
        /createNativeApprovalChannelRouteGates' is not a function/i,
        // node:sqlite cascade (managed by system-openclaw-resolver).
        // When the executor falls back to dev-mode `bun + TS source`, Bun
        // lacks `node:sqlite` and openclaw's state-migration code throws:
        //   - "Failed reading plugin-state sidecar ... missing node:sqlite"
        //   - "Failed migrating plugin install index ... missing node:sqlite"
        //   - "Failed reading task registry sidecar ... missing node:sqlite"
        //   - "Failed reading task flow sidecar ... missing node:sqlite"
        //   - "Failed reading legacy cron storage ... missing node:sqlite"
        // The fix routes Doctor through the system openclaw (Node, has
        // node:sqlite). Any reappearance of these strings means the
        // executor regressed to the bun+TS path.
        /Cannot find package 'node:sqlite'/i,
        /SQLite support is unavailable in this Node runtime/i,
        /No such built-in module: node:sqlite/i,
      ];
      const matched = forbiddenPatterns.filter((rx) => rx.test(body));
      expect(
        matched,
        `Doctor surfaced plugin-load failures: ${matched.map((rx) => rx.toString()).join(", ")}`,
      ).toEqual([]);

      // Sanity: also assert SOMETHING ran. An empty body would silently
      // pass the forbidden-pattern check.
      expect(body).toMatch(/doctor|configured|model|plugin|gateway/i);
    } finally {
      await ctx.dispose();
    }
  });
});
