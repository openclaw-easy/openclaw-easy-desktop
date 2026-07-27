import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron, test } from "@playwright/test";


// Screenshots are published, so nothing credential-shaped may survive into a
// capture. The gateway serves real provider config, and its masked form still
// exposes the key's first and last characters — replace it wholesale.
async function sanitize(page: any) {
  await page.evaluate(() => {
    const GENERIC = "sk-................";
    for (const el of Array.from(document.querySelectorAll("input"))) {
      const i = el as HTMLInputElement;
      const looksSecret = /sk-|•|\u2022|\*{4,}/.test(`${i.value}${i.placeholder}`);
      if (looksSecret) {
        i.value = "";
        i.setAttribute("placeholder", GENERIC);
      }
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const hits: Text[] = [];
    while (walker.nextNode()) {
      const n = walker.currentNode as Text;
      if (/sk-[A-Za-z0-9•\u2022*]{4,}|\/Users\//.test(n.data)) hits.push(n);
    }
    for (const n of hits) n.data = n.data.replace(/sk-[A-Za-z0-9•\u2022*]+/g, GENERIC).replace(/\/Users\/[^\s"')]+/g, "/home/user/...");
  });
  await page.waitForTimeout(400);
}

const OUT = process.env.SHOT_DIR!;
const ENTRY = "out/main/index.js";

test("capture UI screenshots", async () => {
  test.setTimeout(300_000);
  await mkdir(OUT, { recursive: true });
  const userDataDir = await mkdtemp(join(tmpdir(), "openclaw-shots-"));

  const app = await _electron.launch({
    args: [ENTRY, `--user-data-dir=${userDataDir}`, "--no-sandbox", "--disable-gpu-sandbox"],
    env: { ...process.env, OPENCLAW_E2E: "1", ELECTRON_RUN_AS_NODE: "" },
    timeout: 60_000,
  });

  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1440, height: 900 });
  // Dashboard hydration: config load, gateway probe, model list.
  await page.waitForTimeout(10_000);

  await sanitize(page);
  await page.screenshot({ path: join(OUT, "screenshot-dashboard.png") });
  console.log("SHOT dashboard");

  // The Navigation cards on the dashboard are stable, labelled click targets —
  // unlike the sidebar, whose groups stay collapsed until expanded.
  const views: Array<[string, string]> = [
    ["chat", "Chat with AI"],
    ["ai-config", "AI Configuration"],
    ["channels", "Manage Channels"],
    ["agents", "Configure Agent"],
    ["cron", "Cron Jobs"],
    ["tools", "Tools & Permissions"],
  ];

  for (const [name, label] of views) {
    try {
      // Return to the dashboard so the card grid is on screen again.
      const home = page.getByText("Quick Actions", { exact: true }).first();
      if (await home.isVisible({ timeout: 2000 }).catch(() => false)) {
        await home.click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(1200);
      }
      const card = page.getByText(label, { exact: true }).first();
      await card.click({ timeout: 6000 });
      await page.waitForTimeout(3500);
      await sanitize(page);
      await page.screenshot({ path: join(OUT, `screenshot-${name}.png`) });
      console.log(`SHOT ${name}`);
    } catch (e) {
      console.log(`SKIP ${name}: ${(e as Error).message.split("\n")[0]}`);
    }
  }

  await app.close();
});
