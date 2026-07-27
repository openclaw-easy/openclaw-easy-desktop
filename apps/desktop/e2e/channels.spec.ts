import { test, expect } from "@playwright/test";
import { launchDesktop, waitForDashboard, clickLaunchpadTile } from "./fixtures";

// Tier 3c — Channels (WhatsApp/Telegram/Slack/Discord/Feishu/LINE).
// Channel sections only appear in the sidebar AFTER the channel is
// connected. Without a real connection, the "Add channel" entry is the
// surface to test — clicking it should show all 6 channel cards.
//
// Real per-channel setup requires:
//   - WhatsApp: a phone running WhatsApp to scan the QR (manual)
//   - Telegram: a BotFather token (free, programmatic)
//   - Slack: an OAuth flow against a real workspace
//   - Discord: a bot token from the Developer Portal
//   - Feishu / LINE: vendor-specific OAuth
//
// We assert the connect cards render and the "Add" entry navigates
// correctly. Live connect-and-receive flows are gated on env vars and
// skip by default.

const CHANNELS = ["WhatsApp", "Telegram", "Slack", "Discord", "Feishu", "Line"];

test.describe("Channels", () => {
  test("Add channel surface renders cards for all 6 channels", async () => {
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);

      await clickLaunchpadTile(ctx.page, /manage channels/i);

      // body textContent strips whitespace between adjacent inline
      // elements ("WhatsAppConnect via QR code scan..."), so we can't use
      // \b word boundaries. Plain substring match is the right call here.
      const bodyText = ((await ctx.page.locator("body").textContent()) ?? "").toLowerCase();
      for (const name of CHANNELS) {
        expect(
          bodyText.includes(name.toLowerCase()),
          `channel "${name}" should appear on Add channel page`,
        ).toBe(true);
      }
    } finally {
      await ctx.dispose();
    }
  });

  test("Telegram setup with BotFather token connects to the channel", async () => {
    test.skip(
      !process.env.OPENCLAW_E2E_TELEGRAM_TOKEN,
      "Needs OPENCLAW_E2E_TELEGRAM_TOKEN with a BotFather token",
    );
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);
      await clickLaunchpadTile(ctx.page, /manage channels/i);
      // Click Telegram card.
      await ctx.page.getByRole("button", { name: /telegram/i }).first().click();
      await ctx.page.waitForTimeout(500);
      // Token input.
      const tokenInput = ctx.page
        .locator('input[type="password"], input[placeholder*="token" i], textarea[placeholder*="token" i]')
        .first();
      await tokenInput.fill(process.env.OPENCLAW_E2E_TELEGRAM_TOKEN!);
      // Connect.
      await ctx.page.getByRole("button", { name: /connect|save|add/i }).first().click();
      // Connected indicator.
      await expect(ctx.page.getByText(/connected|active|ready/i)).toBeVisible({ timeout: 20_000 });
    } finally {
      await ctx.dispose();
    }
  });

  test("WhatsApp setup renders a QR for manual scanning", async () => {
    test.skip(!process.env.OPENCLAW_E2E_WHATSAPP, "Needs OPENCLAW_E2E_WHATSAPP=1 + manual QR scan");
    const ctx = await launchDesktop();
    try {
      await waitForDashboard(ctx.page);
      await clickLaunchpadTile(ctx.page, /manage channels/i);
      await ctx.page.getByRole("button", { name: /whatsapp/i }).first().click();
      await ctx.page.waitForTimeout(500);
      // QR image / canvas should render.
      const qr = ctx.page.locator('img[alt*="qr" i], canvas, svg');
      await expect(qr.first()).toBeVisible({ timeout: 30_000 });
    } finally {
      await ctx.dispose();
    }
  });

  test("Slack OAuth setup gates on real workspace", async () => {
    test.skip(true, "Slack OAuth setup is interactive (browser redirect) — covered by manual QA");
  });

  test("Discord bot-token setup gates on real bot token", async () => {
    test.skip(
      !process.env.OPENCLAW_E2E_DISCORD_TOKEN,
      "Needs OPENCLAW_E2E_DISCORD_TOKEN with a Discord bot token",
    );
  });

  test("Feishu setup gates on real workspace + app ID/secret", async () => {
    test.skip(
      !process.env.OPENCLAW_E2E_FEISHU_APP_ID,
      "Needs Feishu OAuth credentials",
    );
  });

  test("LINE setup gates on a Messaging API channel", async () => {
    test.skip(
      !process.env.OPENCLAW_E2E_LINE_TOKEN,
      "Needs LINE Messaging API token",
    );
  });
});
