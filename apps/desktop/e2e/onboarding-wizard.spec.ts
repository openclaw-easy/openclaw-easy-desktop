import { test, expect } from "@playwright/test";
import { launchDesktop, waitForDashboard, goToSection } from "./fixtures";

// Tier 3d — CLI Onboarding Wizard. The "Onboard" sidebar item mounts
// CliOnboardingWizard which:
//   - spawns the embedded openclaw CLI via createOpenclawTerminal(['onboard'])
//   - streams stdout into a browser-side xterm
//   - intercepts stdin for the user's responses
//   - dismisses on exit code 0
//
// The test asserts the wizard mounts and renders a terminal surface.
// Driving the wizard end-to-end (typing answers, waiting for exit) is
// gated on the bundled openclaw being installed.

test.describe("CLI Onboarding wizard", () => {
  test("Onboard section mounts a terminal-style surface", async () => {
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);

      await goToSection(ctx.page, "Onboard");

      // xterm renders into a div with class "xterm" (xterm.js convention)
      // or any element with role="textbox" within an xterm container.
      const term = ctx.page.locator('.xterm, [class*="xterm"], [class*="terminal"]');
      await expect(term.first()).toBeVisible({ timeout: 30_000 });
    } finally {
      await ctx.dispose();
    }
  });
});
