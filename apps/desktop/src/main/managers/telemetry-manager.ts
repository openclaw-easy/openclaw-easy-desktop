import { ConfigManager } from './config-manager'
import { SettingsManager } from './settings-manager'

/**
 * TelemetryManager — telemetry is disabled in the open-source build.
 *
 * The hosted build posts periodic usage snapshots to a backend endpoint.
 * This build has no backend and must not phone home, so the collection is
 * gone; only the start/stop interface is kept so the app can wire it up
 * without special-casing.
 */
export class TelemetryManager {
  constructor(_configManager: ConfigManager, _settingsManager: SettingsManager) {}

  start(): void {
    // No-op: telemetry disabled in open-source build
  }

  stop(): void {
    // No-op
  }
}
