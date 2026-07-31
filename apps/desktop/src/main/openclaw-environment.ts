import * as path from 'path'
import * as fs from 'fs'
import { isExtensionsDirUsable, describeMissingLoaders } from './managers/extensions-dir-usability'
import { getVendoredCoreRoot } from './vendored-core-root'

interface ModelProvider {
  baseUrl?: string
  apiKey?: string
  models?: Array<{ id: string; name: string }>
}

interface OpenClawConfig {
  agents?: {
    defaults?: {
      model?: {
        primary?: string
      }
    }
  }
  models?: {
    providers?: {
      [key: string]: ModelProvider
    }
  }
}

/**
 * Centralized environment variable management for OpenClaw processes
 * Handles both model provider configurations and plugin/extension paths
 * Includes automatic doctor diagnostics and fixes
 */
export class OpenClawEnvironment {
  private configPath: string

  constructor(configPath: string) {
    this.configPath = configPath
  }

  /**
   * Get all environment variables needed for OpenClaw processes
   * Includes model provider configs and plugin directory paths
   */
  getEnvironmentVariables(): Record<string, string> {
    const envVars: Record<string, string> = {
      OPENCLAW_CONFIG_PATH: this.configPath,
      ...this.getModelProviderEnvironment(),
      ...this.getPluginEnvironment()
    }

    return envVars
  }

  /**
   * Get model provider specific environment variables
   * Based on the currently configured primary model
   */
  private getModelProviderEnvironment(): Record<string, string> {
    try {
      const configContent = fs.readFileSync(this.configPath, 'utf-8')
      const config: OpenClawConfig = JSON.parse(configContent)

      const primaryModel = config.agents?.defaults?.model?.primary
      if (!primaryModel) {
        console.log('[OpenClawEnvironment] No primary model configured, using default env vars')
        return {}
      }

      console.log(`[OpenClawEnvironment] Detected primary model: ${primaryModel}`)

      // Extract provider from model string (e.g., "ollama/llama3.1:latest" -> "ollama")
      const providerMatch = primaryModel.match(/^([^/]+)/)
      if (!providerMatch) {
        console.log('[OpenClawEnvironment] Could not extract provider from model, using default env vars')
        return {}
      }

      const provider = providerMatch[1]
      console.log(`[OpenClawEnvironment] Detected provider: ${provider}`)

      const providerConfig = config.models?.providers?.[provider]
      if (!providerConfig) {
        console.log(`[OpenClawEnvironment] No configuration found for provider: ${provider}`)
        return {}
      }

      return this.getProviderSpecificEnvironment(provider, providerConfig)

    } catch (error) {
      console.error('[OpenClawEnvironment] Error reading config for model provider env vars:', error)
      return {}
    }
  }

  /**
   * Get environment variables for a specific model provider
   */
  private getProviderSpecificEnvironment(provider: string, config: ModelProvider): Record<string, string> {
    const envVars: Record<string, string> = {}

    switch (provider) {
      case 'ollama':
        if (config.baseUrl) {
          // Extract host from baseUrl (remove /v1 suffix if present)
          const baseUrl = config.baseUrl.replace(/\/v1$/, '')
          envVars.OLLAMA_HOST = baseUrl
          console.log(`[OpenClawEnvironment] Setting OLLAMA_HOST: ${baseUrl}`)
        }
        if (config.apiKey) {
          envVars.OLLAMA_API_KEY = config.apiKey
          // Redact — these logs persist to ~/Library/Logs and are exportable
          // in-app. Mirrors the OpenAI/Gemini redaction below.
          console.log(`[OpenClawEnvironment] Setting OLLAMA_API_KEY: [REDACTED]`)
        }
        break

      // Anthropic BYOK was removed 2026-06-15. No ANTHROPIC_API_KEY env
      // var is set anymore — Claude is reached through OpenRouter, which
      // uses OPENROUTER_API_KEY.

      case 'openai':
        if (config.apiKey) {
          envVars.OPENAI_API_KEY = config.apiKey
          console.log(`[OpenClawEnvironment] Setting OPENAI_API_KEY: [REDACTED]`)
        }
        if (config.baseUrl) {
          envVars.OPENAI_BASE_URL = config.baseUrl
          console.log(`[OpenClawEnvironment] Setting OPENAI_BASE_URL: ${config.baseUrl}`)
        }
        break

      case 'google':
        if (config.apiKey) {
          envVars.GEMINI_API_KEY = config.apiKey
          console.log(`[OpenClawEnvironment] Setting GEMINI_API_KEY: [REDACTED]`)
        }
        break

      default:
        console.log(`[OpenClawEnvironment] Unknown provider: ${provider}, no env vars set`)
    }

    return envVars
  }

  /**
   * Get plugin/extension related environment variables
   * Automatically detects and configures plugin directory paths
   */
  private getPluginEnvironment(): Record<string, string> {
    const envVars: Record<string, string> = {}

    // Auto-detect extensions directory relative to the desktop app
    const extensionsPath = this.resolveExtensionsDirectory()
    if (extensionsPath) {
      envVars.OPENCLAW_BUNDLED_PLUGINS_DIR = extensionsPath
      console.log(`[OpenClawEnvironment] Setting OPENCLAW_BUNDLED_PLUGINS_DIR: ${extensionsPath}`)
    } else {
      console.warn('[OpenClawEnvironment] Could not locate extensions directory')
    }

    return envVars
  }

  /**
   * Resolve the path to the OpenClaw extensions (bundled plugins/skills) directory.
   *
   * Production: openclaw is installed by process-manager.ts into ~/.openclaw-easy/app/.
   *   The bundled skills/plugins live at ~/.openclaw-easy/app/dist/bundled/.
   *
   * Development: extensions/ lives inside the vendored core at the repo
   *   root — see getVendoredCoreRoot().
   */
  private resolveExtensionsDirectory(): string | null {
    try {
      // Determine packaged vs dev without a dynamic import (sync context).
      // process.resourcesPath is only defined in the packaged app; in dev it is undefined.
      const isPackaged = !!process.resourcesPath && !process.resourcesPath.includes('node_modules')

      if (isPackaged) {
        const home = process.env.HOME || process.env.USERPROFILE || ''
        // Channel plugins (whatsapp, telegram, etc.) live in extensions/, not dist/bundled/
        const extensionsDir = path.join(home, '.openclaw-easy', 'app', 'extensions')
        console.log(`[OpenClawEnvironment] Production extensions dir: ${extensionsDir} (exists=${fs.existsSync(extensionsDir)})`)
        if (fs.existsSync(extensionsDir)) {
          return extensionsDir
        }
        console.warn('[OpenClawEnvironment] Production extensions dir not found — openclaw may not be installed yet')
        return null
      }

      // Development: extensions/ lives inside the vendored core.
      //
      // CRITICAL: only return this path if the extensions are actually
      // *built* (have loadable JS entry points). The monorepo ships
      // TypeScript SOURCES; pointing the gateway at them forces the
      // plugin loader to resolve `.ts` files, which cascades into
      // workspace subpath-import failures (e.g. `Cannot find module
      // '@openclaw/normalization-core/string-normalization'`) and
      // crashes Doctor with a wall of "failed to load" errors. If the
      // local tree isn't built, return null so the system gateway uses
      // its own bundled plugins — which always work.
      const extensionsDir = path.join(getVendoredCoreRoot(), 'extensions')

      if (!fs.existsSync(extensionsDir)) {
        console.warn(`[OpenClawEnvironment] Extensions directory not found at: ${extensionsDir}`)
        return null
      }
      if (!isExtensionsDirUsable(extensionsDir)) {
        console.log(
          `[OpenClawEnvironment] Local extensions at ${extensionsDir} are not built; ` +
          `deferring to the system gateway's bundled plugins. ` +
          `(To use local extensions: ${describeMissingLoaders(extensionsDir)})`,
        )
        return null
      }
      console.log(`[OpenClawEnvironment] Found built extensions directory at: ${extensionsDir}`)
      return extensionsDir
    } catch (error) {
      console.error('[OpenClawEnvironment] Error resolving extensions directory:', error)
      return null
    }
  }

  /**
   * Validate that all required environment variables are properly set
   */
  validateEnvironment(): { valid: boolean; missing: string[] } {
    const envVars = this.getEnvironmentVariables()
    const missing: string[] = []

    // Check for required OpenClaw config
    if (!envVars.OPENCLAW_CONFIG_PATH) {
      missing.push('OPENCLAW_CONFIG_PATH')
    }

    // Check for extensions directory
    if (!envVars.OPENCLAW_BUNDLED_PLUGINS_DIR) {
      missing.push('OPENCLAW_BUNDLED_PLUGINS_DIR')
    }

    return {
      valid: missing.length === 0,
      missing
    }
  }

}