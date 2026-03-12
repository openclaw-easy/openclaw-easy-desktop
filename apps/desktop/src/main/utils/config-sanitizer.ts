import * as fs from 'fs'
import * as path from 'path'

/**
 * Sanitize the OpenClaw config for a bundled (production) desktop app.
 *
 * Removes plugin references that are not available in the bundled plugins
 * directory, and sets `plugins.slots.memory = "none"` when memory-core is
 * not bundled (preventing the gateway from crashing on its implicit default).
 *
 * @param configPath  Absolute path to openclaw.json
 * @param bundledPluginsDir  Absolute path to the bundled plugins directory (e.g. <installDir>/dist/bundled)
 * @param onLog  Optional callback for structured log messages
 */
export async function sanitizeConfigForBundled(
  configPath: string,
  bundledPluginsDir: string,
  onLog?: (message: string) => void,
): Promise<void> {
  if (!fs.existsSync(configPath) || !fs.existsSync(bundledPluginsDir)) {
    return
  }

  try {
    const availablePlugins = new Set(
      fs.readdirSync(bundledPluginsDir).filter(name =>
        fs.statSync(path.join(bundledPluginsDir, name)).isDirectory(),
      ),
    )

    const raw = fs.readFileSync(configPath, 'utf8')
    const config = JSON.parse(raw)

    if (!config.plugins || typeof config.plugins !== 'object') {
      config.plugins = {}
    }

    const removed: string[] = []
    let needsWrite = false

    // Remove plugin entries that reference unavailable plugins
    if (config.plugins.entries && typeof config.plugins.entries === 'object') {
      for (const pluginId of Object.keys(config.plugins.entries)) {
        if (!availablePlugins.has(pluginId)) {
          delete config.plugins.entries[pluginId]
          removed.push(pluginId)
        }
      }
      if (Object.keys(config.plugins.entries).length === 0) {
        delete config.plugins.entries
      }
    }

    // Filter allow list to available plugins
    if (Array.isArray(config.plugins.allow)) {
      config.plugins.allow = config.plugins.allow.filter((id: string) => availablePlugins.has(id))
      if (config.plugins.allow.length === 0) delete config.plugins.allow
    }

    // Filter deny list to available plugins
    if (Array.isArray(config.plugins.deny)) {
      config.plugins.deny = config.plugins.deny.filter((id: string) => availablePlugins.has(id))
      if (config.plugins.deny.length === 0) delete config.plugins.deny
    }

    // Remove slot references to unavailable plugins
    if (config.plugins.slots?.memory && !availablePlugins.has(config.plugins.slots.memory)) {
      removed.push(`slots.memory=${config.plugins.slots.memory}`)
      delete config.plugins.slots.memory
      if (Object.keys(config.plugins.slots).length === 0) delete config.plugins.slots
    }

    // The gateway defaults plugins.slots.memory to "memory-core" when not
    // explicitly set. If that default plugin is not bundled, we must write an
    // explicit "none" to prevent the gateway from failing config validation.
    if (!availablePlugins.has('memory-core')) {
      const currentSlot = config.plugins.slots?.memory
      if (!currentSlot || currentSlot === 'memory-core') {
        if (!config.plugins.slots) config.plugins.slots = {}
        config.plugins.slots.memory = 'none'
        needsWrite = true
        onLog?.('Set plugins.slots.memory=none (memory-core not bundled)')
      }
    }

    // Clean up empty plugins object
    if (Object.keys(config.plugins).length === 0) {
      delete config.plugins
    }

    if (removed.length > 0 || needsWrite) {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
      if (removed.length > 0) {
        const removedList = removed.join(', ')
        onLog?.(`Removed ${removed.length} unavailable plugin(s) from config: ${removedList}`)
      }
    }
  } catch (error: any) {
    onLog?.(`Failed to sanitize config: ${error.message}`)
  }
}
