/**
 * process-manager.ts — factory entry point
 *
 * Returns the platform-appropriate ProcessManager:
 *   - macOS/Linux  → ProcessManagerMac  (direct bun spawn)
 *   - Windows      → ProcessManagerWindows  (native bun-windows.exe)
 *
 * Platform-specific logic lives entirely in the respective files.
 * Shared base class, types, and helpers are in process-manager-base.ts.
 */

export type { ProcessStatus, ProcessEvent, HealthEvent, ConfigManager } from './process-manager-base.js'
export { ProcessManagerBase } from './process-manager-base.js'
export { ProcessManagerMac } from './process-manager-mac.js'
export { ProcessManagerWindows } from './process-manager-windows.js'

import type { ConfigManager } from './process-manager-base.js'
import type { ProcessManagerBase } from './process-manager-base.js'
import { ProcessManagerMac } from './process-manager-mac.js'
import { ProcessManagerWindows } from './process-manager-windows.js'

/** Type alias kept for backward-compat with existing imports */
export type ProcessManager = ProcessManagerBase

export function createProcessManager(
  configPath: string,
  configManager?: ConfigManager
): ProcessManagerBase {
  if (process.platform === 'win32') {
    return new ProcessManagerWindows(configPath, configManager)
  }
  return new ProcessManagerMac(configPath, configManager)
}
