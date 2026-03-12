import { OpenClawCommandExecutor } from './openclaw-command-executor'

/**
 * Windows variant of OpenClawCommandExecutor.
 *
 * Previously wrapped all commands through WSL2 via wsl.exe.
 * Now a thin subclass — the generic OpenClawCommandExecutor already handles
 * Windows natively (selects bun-windows.exe based on process.platform).
 *
 * This class exists solely to preserve API compatibility with openclaw-manager.ts
 * which instantiates OpenClawCommandExecutorWindows on win32 and calls setWSLDistro().
 */
export class OpenClawCommandExecutorWindows extends OpenClawCommandExecutor {
  /** No-op: WSL2 is no longer used, gateway runs natively via bun-windows.exe */
  setWSLDistro(_distro: string) {}
}
