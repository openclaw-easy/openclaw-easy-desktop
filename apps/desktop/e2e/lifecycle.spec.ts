import { test, expect } from "@playwright/test";
import { launchDesktop, waitForDashboard, goToSection } from "./fixtures";

// Tier 3a — gateway lifecycle. The "Launch Assistant" button on the
// Quick Actions launchpad spawns the bundled openclaw gateway process.
// First-launch overhead: when ~/.openclaw-easy/app/ is empty, a one-time
// `bun install --production` runs before `bun openclaw.mjs gateway run`.
// That can be 30-60s on a cold machine, occasionally more.
//
// Functional proof — NOT just UI label changes:
// The renderer's useChatConnection hook attempts a WebSocket to
// ws://localhost:<gateway-port>/. When the gateway isn't reachable, the
// Chat surface renders "Disconnected" + a Reconnect button. When the
// gateway accepts the WS, "Disconnected" disappears. So the right
// proof-of-launched is "Disconnected" gone from the Chat section, not
// the absence of a button label.

const LAUNCH_TIMEOUT_MS = 180_000; // 3 min — generous for first-time bun install

test.describe("Gateway lifecycle", () => {
  test("Launch Assistant actually brings the chat WebSocket up", async () => {
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);

      // The launchpad CTA mutates label based on supervisor state:
      //   - gateway not running → "Launch Assistant"
      //   - gateway running    → "Stop Assistant"
      // The bundled gateway can come up in well under 10s on a warm
      // ~/.openclaw-easy/app, so on a fast machine the "Launch Assistant"
      // label is already gone by the time we look. Treat both labels as
      // valid entry points: click "Launch Assistant" if present, otherwise
      // trust that the gateway is already up and proceed to WS proof.
      const launchBtn = ctx.page
        .getByRole("button", { name: /launch assistant/i })
        .first();
      const alreadyRunning = ctx.page
        .getByRole("button", { name: /stop assistant/i })
        .first();
      try {
        await expect(launchBtn).toBeVisible({ timeout: 5_000 });
        await launchBtn.click();
      } catch {
        await expect(alreadyRunning).toBeVisible({ timeout: 5_000 });
      }

      // Navigate to Chat — that's where the WebSocket connection status
      // is rendered. Before launch the chat shows "Disconnected".
      await goToSection(ctx.page, "Chat");

      // Wait for the chat UI to leave the "Disconnected" state. This is
      // the real proof the gateway is accepting WS connections.
      await ctx.page.waitForFunction(
        () => !/Disconnected/i.test(document.body.textContent || ""),
        { timeout: LAUNCH_TIMEOUT_MS },
      );
    } finally {
      await ctx.dispose();
    }
  });

  test("Stop Assistant tears down the chat connection", async () => {
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);

      // Start first — but only if it is not already up. The gateway can
      // already be running (LaunchAgent, a previous spec, or a developer's
      // own session), in which case the control reads "Stop Assistant" and
      // there is no "Launch Assistant" button to click. Clicking
      // unconditionally made this test fail purely on pre-existing state.
      const launchBtn = ctx.page.getByRole("button", { name: /launch assistant/i }).first();
      if ((await launchBtn.count()) > 0) {
        await launchBtn.click();
      }
      await goToSection(ctx.page, "Chat");
      await ctx.page.waitForFunction(
        () => !/Disconnected/i.test(document.body.textContent || ""),
        { timeout: LAUNCH_TIMEOUT_MS },
      );

      // Now Stop. The control may live on the Quick Actions section or as
      // a Stop button somewhere reachable from Chat — try the common labels.
      const stopBtn = ctx.page
        .getByRole("button", { name: /stop assistant|stop openclaw|^stop$/i })
        .first();
      if ((await stopBtn.count()) === 0) {
        // Fall back to navigating back to Quick Actions.
        await ctx.page.getByRole("button", { name: /quick actions/i }).first().click();
        await ctx.page.waitForTimeout(500);
      }
      await ctx.page
        .getByRole("button", { name: /stop assistant|stop openclaw|^stop$/i })
        .first()
        .click();

      // Confirm the chat goes back to Disconnected (or shows the offline copy).
      await ctx.page.waitForFunction(
        () =>
          /Disconnected/i.test(document.body.textContent || "") ||
          /AI assistant is offline/i.test(document.body.textContent || ""),
        { timeout: 30_000 },
      );
    } finally {
      await ctx.dispose();
    }
  });

  test("Send a chat message and get a reply via local Ollama", async () => {
    test.skip(
      !process.env.OPENCLAW_E2E_OLLAMA,
      "Needs OPENCLAW_E2E_OLLAMA=1 + a pulled Ollama model (e.g. llama3.2 or qwen2.5) — proves end-to-end inference",
    );
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);

      // Launch assistant.
      await ctx.page.getByRole("button", { name: /launch assistant/i }).first().click();
      await goToSection(ctx.page, "Chat");
      await ctx.page.waitForFunction(
        () => !/Disconnected/i.test(document.body.textContent || ""),
        { timeout: LAUNCH_TIMEOUT_MS },
      );

      // Compose and send.
      const composer = ctx.page
        .locator(
          'textarea, input[placeholder*="message" i], input[placeholder*="ask" i], [contenteditable="true"]',
        )
        .first();
      await composer.click();
      await composer.fill("Reply with the single word OK and nothing else.");
      await composer.press(
        process.platform === "darwin" ? "Meta+Enter" : "Control+Enter",
      );

      // Wait for the assistant's reply to appear. Local Ollama on a
      // 7B-class model returns a 1-token reply in 2-15s.
      await ctx.page.waitForFunction(
        () => /\bOK\b/.test(document.body.textContent || ""),
        { timeout: 90_000 },
      );
    } finally {
      await ctx.dispose();
    }
  });
});
