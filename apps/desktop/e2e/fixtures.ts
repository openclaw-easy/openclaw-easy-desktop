import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { _electron, type ElectronApplication, type Page } from "@playwright/test";

// Build artifact entrypoint. `pnpm run build` (electron-vite build) writes
// `out/main/index.js`; if a spec can't find it the suite was run before
// the build — bail with a clear message instead of an opaque ENOENT.
const ELECTRON_ENTRY = "out/main/index.js";

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  /** Console-error sink populated for the lifetime of this app instance. */
  consoleErrors: string[];
  /** Page-error sink (uncaught renderer exceptions). */
  pageErrors: Error[];
  /** Temp user-data dir that should be torn down with `dispose()`. */
  userDataDir: string;
  dispose(): Promise<void>;
}

/**
 * Launch the Electron app against a fresh temp `--user-data-dir` so tests
 * never touch the developer's real `~/.openclaw` / Electron app data.
 * Returns the first window plus error sinks for assertions.
 */
export async function launchDesktop(): Promise<LaunchedApp> {
  const userDataDir = await mkdtemp(join(tmpdir(), "openclaw-easy-e2e-"));

  const app = await _electron.launch({
    args: [
      ELECTRON_ENTRY,
      `--user-data-dir=${userDataDir}`,
      // Disable GPU sandbox — CI runners and Linux headless setups
      // otherwise spew GPU-init warnings that pollute the console-error sink.
      "--no-sandbox",
      "--disable-gpu-sandbox",
    ],
    env: {
      ...process.env,
      // OPENCLAW_HOME deliberately NOT overridden — pointing it at a fresh
      // tmpdir leaves no seed config, and the bundled openclaw gateway needs
      // ~/.openclaw to be present (auth profile, agents directory, ports
      // config) to boot. Tests use --user-data-dir for Electron isolation,
      // which is enough to keep the renderer side stateless. The trade-off:
      // tests share ~/.openclaw with the user's real install. Avoid asserting
      // destructive changes to that config (and AI Provider key-save tests
      // explicitly use a fake key that won't validate).
      // Mark this run as E2E so any first-run telemetry / update checks
      // can opt out (no-op today, future-proofs the hook).
      OPENCLAW_E2E: "1",
      // Silence Electron's "ELECTRON_RUN_AS_NODE" auto-respawn path used
      // by some helper scripts; the test driver expects a real GUI process.
      ELECTRON_RUN_AS_NODE: "",
    },
    timeout: 60_000,
  });

  const consoleErrors: string[] = [];
  const pageErrors: Error[] = [];

  const page = await app.firstWindow();

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => {
    pageErrors.push(err);
  });

  return {
    app,
    page,
    consoleErrors,
    pageErrors,
    userDataDir,
    async dispose() {
      try {
        await app.close();
      } catch {
        // ignore — app may already be exiting
      }
      try {
        await rm(userDataDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    },
  };
}

/**
 * Wait for the dashboard to finish its async boot (auth restore + config
 * load + i18n) and the sidebar to render. The splash component renders
 * while `isLoading=true`; once the sidebar's collapse button is visible,
 * we know we're past the splash and into the real dashboard.
 */
export async function waitForDashboard(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  // The sidebar's collapse toggle uses one of these two aria-labels
  // depending on collapsed state — either signals the dashboard mounted.
  await page
    .locator('[aria-label="Collapse sidebar"], [aria-label="Expand sidebar"]')
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });
}

/**
 * Console-error filter: ignore noise that's unrelated to the desktop's
 * own renderer code (third-party DevTools warnings, hot-reload chatter
 * during a watch run, electron-vite's CSP report on `devtools://`).
 * Keep the list tight — every entry needs a reason.
 */
export const IGNORED_CONSOLE_ERROR_PATTERNS: RegExp[] = [
  // Electron's "Autofill" devtools probe writes to console.error on
  // some Chromium builds; harmless and not under our control.
  /Autofill\.(enable|setAddresses)/i,
  // DevTools extension warnings (React DevTools, etc.) — not desktop bugs.
  /Download the React DevTools/i,
  // Expected in E2E: the openclaw gateway isn't running, so any section
  // that opens a WebSocket to the local gateway logs a connection error.
  // The user starts the gateway with "Start OpenClaw" in normal use;
  // tier-2 nav doesn't exercise that flow (tier-3 lifecycle.spec does).
  /WebSocket connection to 'ws:\/\/localhost:18789\/' failed/i,
  /\[ChatConnection\] WebSocket error/i,
  // SQLite "missing node:sqlite" warning — Node 22 vs 24 known issue,
  // task-flow sidecars degrade gracefully and the test isn't asserting
  // on that surface.
  /SQLite support is unavailable in this Node runtime/i,
  /No such built-in module: node:sqlite/i,
];

export function filterConsoleErrors(errors: string[]): string[] {
  return errors.filter(
    (text) => !IGNORED_CONSOLE_ERROR_PATTERNS.some((rx) => rx.test(text)),
  );
}

// ============================================================
// Tier-3 shared helpers
// ============================================================

/**
 * Sidebar groups are collapsed by default. Opens a group by clicking
 * its header. No-op if already expanded. Animation is ~300ms.
 */
export async function expandSidebarGroup(page: Page, label: string): Promise<void> {
  const header = page.getByRole("button", { name: label, exact: true }).first();
  await header.waitFor({ state: "visible", timeout: 10_000 });
  const expanded = await header.getAttribute("aria-expanded");
  if (expanded === "false") {
    await header.click();
    await page.waitForTimeout(350);
  }
}

const GROUP_FOR_SECTION: Record<string, string> = {
  Chat: "Workspace",
  Onboard: "Workspace",
  Sessions: "Workspace",
  "Add channel": "Channels",
  WhatsApp: "Channels",
  Telegram: "Channels",
  Discord: "Channels",
  Slack: "Channels",
  Feishu: "Channels",
  Line: "Channels",
  Provider: "AI",
  Agents: "AI",
  Models: "AI",
  Skills: "AI",
  Hooks: "AI",
  Plugins: "AI",
  Files: "AI",
  Activity: "System",
  Doctor: "System",
  Commands: "System",
};

/**
 * Click a sidebar item by visible label, auto-expanding the containing
 * group first. Throws if the item never appears.
 */
export async function goToSection(page: Page, sectionLabel: string): Promise<void> {
  const group = GROUP_FOR_SECTION[sectionLabel];
  if (group) {
    await expandSidebarGroup(page, group);
  }
  const item = page.getByRole("button", { name: sectionLabel, exact: true }).first();
  await item.waitFor({ state: "visible", timeout: 5_000 });
  await item.click();
  // Section render commits synchronously on activeChannel change; give
  // lazy-imported subsections a beat to settle.
  await page.waitForTimeout(400);
}

/**
 * Click the prominent "Launch Assistant" button on the Quick Actions
 * launchpad and wait for the gateway to actually finish starting.
 *
 * Timing: the bundled openclaw runtime on first launch runs
 * `bun install --production` lazily, then spawns `bun openclaw.mjs
 * gateway run`. On a clean machine that's 15-45s. CI cold starts may
 * hit 60-90s. The test wants the REAL end state, not a transient one.
 *
 * The right signal is the absence of the stopped-state indicators
 * combined with the presence of a running-state cue:
 *   - "AI assistant is offline" text disappears (it's the stopped copy)
 *   - "Launch Assistant" button is no longer the active CTA (becomes
 *     "Stop" or the launchpad reshuffles)
 *   - A "running" / "active" status word appears on the assistant card
 *
 * NB: Don't match `connected` — the chat connection status writes
 * "Disconnected" into the body before launch, and a substring match on
 * `connected` would falsely fire on `Disconnected`.
 */
export async function startAssistant(page: Page, timeoutMs = 90_000): Promise<void> {
  const startBtn = page
    .getByRole("button", { name: /launch assistant|start openclaw/i })
    .first();
  await startBtn.waitFor({ state: "visible", timeout: 10_000 });
  await startBtn.click();

  await page.waitForFunction(
    () => {
      // Pull all visible button texts so we can check label transitions
      // robustly without relying on a brittle DOM-position query.
      const buttons = Array.from(document.querySelectorAll("button"));
      const buttonTexts = buttons
        .map((b) => (b.textContent || "").trim())
        .filter(Boolean);
      const launchStillVisible = buttonTexts.some((t) => /launch assistant/i.test(t));
      const stopVisible = buttonTexts.some(
        (t) => /^stop\b|stop assistant|stop openclaw/i.test(t),
      );

      const bodyText = document.body.textContent || "";
      const offlineStillShown = /AI assistant is offline/i.test(bodyText);
      const runningCueVisible = /assistant is running|assistant is active|gateway running|status:\s*running/i.test(
        bodyText,
      );

      // Pass conditions, in order of confidence:
      //   1. A Stop button appeared — gateway is up.
      //   2. The "AI assistant is offline" copy disappeared AND the launch
      //      button is no longer visible — the StatusCard re-rendered into
      //      its running variant.
      //   3. A positive running-cue string is present.
      return (
        stopVisible ||
        (!offlineStillShown && !launchStillVisible) ||
        runningCueVisible
      );
    },
    { timeout: timeoutMs },
  );
}

/**
 * Click "Stop" (or equivalent) and wait for the gateway to be marked
 * stopped. No-op if already stopped.
 */
export async function stopAssistant(page: Page, timeoutMs = 30_000): Promise<void> {
  const stopBtn = page
    .getByRole("button", { name: /stop assistant|stop openclaw|^stop$/i })
    .first();
  if ((await stopBtn.count()) === 0) {
    return; // nothing to stop
  }
  await stopBtn.click();
  await page.waitForFunction(
    () => /stopped|offline|inactive|assistant is offline/i.test(document.body.textContent || ""),
    { timeout: timeoutMs },
  );
}

/**
 * Open the Cmd+K command palette and wait for its input to be ready.
 * CommandPalette uses cmdk under the hood — there's no role="dialog"
 * wrapper; the search input with placeholder "Type a command or search..."
 * is the canonical "palette is open" signal.
 */
export async function openCommandPalette(page: Page): Promise<void> {
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await page
    .locator('input[placeholder*="Type a command" i], input[placeholder*="search" i]')
    .first()
    .waitFor({ state: "visible", timeout: 5_000 });
}

/**
 * Navigate to a section via the Cmd+K command palette. Use this for items
 * that aren't direct sidebar buttons (Cron, Sessions, Activity all live
 * in the palette but only some have sidebar entries).
 */
export async function gotoViaCommandPalette(page: Page, itemLabel: string): Promise<void> {
  await openCommandPalette(page);
  const input = page
    .locator('input[placeholder*="Type a command" i], input[placeholder*="search" i]')
    .first();
  await input.fill(itemLabel);
  // First search hit — press Enter or click.
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
}

/**
 * Click a tile on the Quick Actions launchpad by its visible heading.
 * Tiles include: Onboard, Chat with AI, Manage Channels, AI Configuration,
 * Configure Agent, Commands, Cron Jobs, Tools & Permissions.
 */
export async function clickLaunchpadTile(page: Page, tileLabel: string | RegExp): Promise<void> {
  // The tiles are anchor / button-like elements whose visible text is the
  // tile heading. Match by text and click the nearest interactive ancestor.
  const tile = page.getByText(tileLabel, { exact: false }).first();
  await tile.waitFor({ state: "visible", timeout: 5_000 });
  await tile.click();
  await page.waitForTimeout(400);
}

/**
 * Find the Settings cog button in the sidebar footer and click it.
 */
export async function openSettings(page: Page): Promise<void> {
  // Per Sidebar.tsx the Settings entry is a button with title "Settings"
  // (when collapsed) and visible text "Settings" (when expanded).
  const btn = page.getByRole("button", { name: /^settings$/i }).first();
  await btn.click();
  await page.waitForTimeout(400);
}

/**
 * Mocks an HTTP route inside the renderer's network stack. Useful for
 * validating BYOK API key forms without making real provider calls.
 *
 * Note: this only intercepts renderer-initiated fetch / XHR. Calls made
 * from the main process (e.g. ConfigManager's validate-api-key IPC, which
 * may itself spawn a child process) are NOT intercepted by Playwright.
 */
export async function mockHttpRoute(
  page: Page,
  urlGlob: string,
  status: number,
  body: unknown,
) {
  await page.route(urlGlob, async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  });
}

/**
 * The two real config files a test may mutate by clicking "Apply Changes"
 * / "Save Changes" — both live OUTSIDE the Electron --user-data-dir
 * isolation:
 *
 *   1. `~/.openclaw/openclaw.json` — gateway config (agents, models,
 *      plugins). Shared with the dev install because the bundled gateway
 *      can't boot without it.
 *   2. `~/.config/openclaw-desktop/app-config.json` — desktop app config
 *      (`aiProvider`, BYOK keys, STT). ConfigManager.getAppConfigPath()
 *      uses `app.getPath('home')`, not userData, so this also escapes
 *      `--user-data-dir`.
 *
 * Snapshot both before any destructive Apply / Save test, restore both
 * in `finally`. Skipping either side leaks state across tests — e.g. an
 * AI Provider test that switches to Local LLM but only restores
 * openclaw.json leaves the agents test stuck rendering the
 * "no local models" empty-state instead of the model picker.
 */
interface UserConfigSnapshot {
  openclaw: string | null;
  appConfig: string | null;
}

const OPENCLAW_CONFIG = () => join(homedir(), ".openclaw", "openclaw.json");
const APP_CONFIG = () => join(homedir(), ".config", "openclaw-desktop", "app-config.json");

async function readIfExists(p: string): Promise<string | null> {
  try {
    return await readFile(p, "utf8");
  } catch {
    return null;
  }
}

async function writeIfSnapshot(p: string, snapshot: string | null): Promise<void> {
  if (snapshot === null) return; // file didn't exist pre-test, leave it alone
  try {
    await writeFile(p, snapshot);
  } catch {
    console.error(`[e2e] restoreUserConfig failed to write ${p}`);
  }
}

export async function snapshotUserConfig(): Promise<UserConfigSnapshot> {
  return {
    openclaw: await readIfExists(OPENCLAW_CONFIG()),
    appConfig: await readIfExists(APP_CONFIG()),
  };
}

export async function restoreUserConfig(snapshot: UserConfigSnapshot): Promise<void> {
  await writeIfSnapshot(OPENCLAW_CONFIG(), snapshot.openclaw);
  await writeIfSnapshot(APP_CONFIG(), snapshot.appConfig);
}

/**
 * Assert that no console.error or pageerror was emitted within the
 * captured slice. Wraps the filter list so tests can call this in a
 * try/finally next to dispose().
 */
export function assertNoNewErrors(
  ctx: LaunchedApp,
  startConsoleIdx: number,
  startPageErrIdx: number,
): string[] {
  const failures: string[] = [];
  const newPageErrors = ctx.pageErrors.slice(startPageErrIdx);
  if (newPageErrors.length > 0) {
    failures.push(
      `${newPageErrors.length} uncaught error(s): ${newPageErrors.map((e) => e.message).join("; ")}`,
    );
  }
  const newConsoleErrors = filterConsoleErrors(ctx.consoleErrors.slice(startConsoleIdx));
  if (newConsoleErrors.length > 0) {
    failures.push(`console.error(s): ${newConsoleErrors.join(" | ")}`);
  }
  return failures;
}
