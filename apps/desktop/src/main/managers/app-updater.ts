/**
 * Consented in-app updates.
 *
 * Before this existed the app could only *tell* you an update was out: it
 * polled the GitHub releases feed, compared versions, showed a banner, and
 * opened the download page. Updating then meant fetching a several-hundred-MB
 * installer by hand, quitting, and re-running it — so installs drifted many
 * versions behind.
 *
 * `electron-updater` was already a dependency and had never been imported.
 *
 * CONSENTED, never silent. `autoDownload` and `autoInstallOnAppQuit` are both
 * off, so nothing is fetched or installed until the user asks for it. A build
 * that installs itself can push a broken release to every machine before
 * anyone can pull it; the user clicking "Download", then "Restart to install",
 * is the safety margin.
 *
 * Note this build is unsigned (`identity: null`, `notarize: false` in
 * electron-builder.yml), so an update surfaces the usual Gatekeeper /
 * SmartScreen prompts. `quitAndInstall` therefore runs non-silently — the
 * prompt is something you can see and act on rather than a silent dead end.
 */
import { autoUpdater } from "electron-updater";
import type { BrowserWindow } from "electron";

/** Renderer-facing update phases. Mirrored in `electron.d.ts`. */
export type UpdatePhase =
  | "idle"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export interface AppUpdaterDeps {
  /** Live lookup — the window is replaced on reopen, so never cache it. */
  getWindow: () => BrowserWindow | null;
  /** Honours the existing `autoUpdate` setting; users can opt out. */
  isEnabled: () => Promise<boolean>;
  /** electron-updater throws outside a packaged app; dev uses the no-op path. */
  isPackaged: boolean;
  currentVersion: string;
}

/**
 * True when the version string `next` is newer than `current`.
 *
 * Date-based versions (2026.9.20) compare correctly segment-by-segment as
 * integers; a plain string compare gets "2026.9.9" > "2026.9.20" wrong.
 * Exported for tests.
 */
export function isNewerSemver(next: string, current: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/, "")
      .split("-")[0]
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(next);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export class AppUpdater {
  private phase: UpdatePhase = "idle";
  private latestVersion: string | null = null;
  private wired = false;

  constructor(private readonly deps: AppUpdaterDeps) {}

  /** Attach listeners once. Safe to call repeatedly. */
  init(): void {
    if (this.wired || !this.deps.isPackaged) return;
    this.wired = true;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.logger = null;

    autoUpdater.on("update-available", (info) => {
      this.latestVersion = info?.version ?? null;
      this.phase = "available";
      this.emit("app:update-available", {
        hasUpdate: true,
        currentVersion: this.deps.currentVersion,
        latestVersion: info?.version,
        releaseDate: info?.releaseDate,
      });
    });

    autoUpdater.on("update-not-available", () => {
      this.phase = "idle";
    });

    autoUpdater.on("download-progress", (p) => {
      this.phase = "downloading";
      this.emit("app:update-download-progress", {
        percent: Math.round(p?.percent ?? 0),
        transferred: p?.transferred ?? 0,
        total: p?.total ?? 0,
        bytesPerSecond: p?.bytesPerSecond ?? 0,
      });
    });

    autoUpdater.on("update-downloaded", (info) => {
      this.phase = "downloaded";
      this.emit("app:update-downloaded", { version: info?.version });
    });

    autoUpdater.on("error", (err) => {
      this.phase = "error";
      // Surface the reason: a failed update is otherwise a silent dead end,
      // and unsigned Windows builds fail here in a way users must be told about.
      this.emit("app:update-error", { message: err?.message ?? String(err) });
    });
  }

  async check(): Promise<{ hasUpdate: boolean; latestVersion?: string }> {
    if (!this.deps.isPackaged) return { hasUpdate: false };
    if (!(await this.deps.isEnabled())) return { hasUpdate: false };
    this.init();
    const result = await autoUpdater.checkForUpdates();
    const version = result?.updateInfo?.version;
    const hasUpdate = Boolean(
      version && isNewerSemver(version, this.deps.currentVersion),
    );
    if (hasUpdate) this.latestVersion = version ?? null;
    return hasUpdate
      ? { hasUpdate, latestVersion: version }
      : { hasUpdate: false };
  }

  /** User pressed "Download update". */
  async download(): Promise<void> {
    if (!this.deps.isPackaged) return;
    this.init();
    this.phase = "downloading";
    await autoUpdater.downloadUpdate();
  }

  /**
   * User pressed "Restart to install". Quits and runs the installer.
   * `isSilent: false` keeps the platform installer UI visible, which this
   * unsigned build needs — the SmartScreen / Gatekeeper prompt must be
   * visible rather than a silently failed update.
   */
  install(): void {
    if (!this.deps.isPackaged || this.phase !== "downloaded") return;
    autoUpdater.quitAndInstall(false, true);
  }

  getState(): { phase: UpdatePhase; latestVersion: string | null } {
    return { phase: this.phase, latestVersion: this.latestVersion };
  }

  private emit(channel: string, payload: unknown): void {
    const win = this.deps.getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }
}
