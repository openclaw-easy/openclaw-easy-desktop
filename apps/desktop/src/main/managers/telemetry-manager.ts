import { ConfigManager } from './config-manager'

/**
 * TelemetryManager — telemetry is disabled in the open-source build.
 * The start/stop interface is kept so callers don't need to change.
 */
export class TelemetryManager {
  constructor(_configManager: ConfigManager) {}

  start(): void {
    // No-op: telemetry disabled in open-source build
  }

  stop(): void {
    // No-op
  }
}
