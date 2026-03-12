import * as path from 'path'
import * as fs from 'fs'
import { spawn, ChildProcess } from 'child_process'
import { existsSync } from 'fs'

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

export interface DoctorResult {
  hasIssues: boolean
  fixed: boolean
  issues: string[]
  actions: string[]
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
          console.log(`[OpenClawEnvironment] Setting OLLAMA_API_KEY: ${config.apiKey}`)
        }
        break

      case 'anthropic':
        if (config.apiKey) {
          envVars.ANTHROPIC_API_KEY = config.apiKey
          console.log(`[OpenClawEnvironment] Setting ANTHROPIC_API_KEY: [REDACTED]`)
        }
        break

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
   * Development: extensions/ lives at the monorepo root, five levels above __dirname
   *   (apps/desktop/out/main → ../../../openclaw).
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

      // Development: extensions/ is at the monorepo root
      const workspaceRoot = path.join(__dirname, '../../../../openclaw/')
      const extensionsDir = path.join(workspaceRoot, 'extensions')

      if (fs.existsSync(extensionsDir)) {
        const whatsappExtension = path.join(extensionsDir, 'whatsapp')
        if (fs.existsSync(whatsappExtension)) {
          console.log(`[OpenClawEnvironment] Found extensions directory at: ${extensionsDir}`)
          return extensionsDir
        } else {
          console.warn(`[OpenClawEnvironment] Extensions directory found but missing WhatsApp extension: ${extensionsDir}`)
        }
      } else {
        console.warn(`[OpenClawEnvironment] Extensions directory not found at: ${extensionsDir}`)
      }

      return null
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

  /**
   * Run OpenClaw doctor diagnostics and auto-fix issues
   * This includes enabling disabled plugins like WhatsApp
   */
  async runDoctorDiagnostics(): Promise<DoctorResult> {
    const issues: string[] = []
    const actions: string[] = []

    try {
      console.log('[OpenClawEnvironment] Running doctor diagnostics...')

      // First run doctor to check for issues (with timeout to prevent hanging)
      const doctorOutput = await this.runOpenClawCommand(['doctor'], 15000)

      // Check for plugin issues
      if (doctorOutput.includes('Plugins') && doctorOutput.includes('Disabled')) {
        issues.push('Some plugins are disabled')

        // Check specifically for WhatsApp plugin
        const pluginsOutput = await this.runOpenClawCommand(['plugins', 'list'], 5000)

        if (pluginsOutput.includes('whatsapp') && pluginsOutput.includes('disabled')) {
          issues.push('WhatsApp plugin is disabled')

          // Auto-enable WhatsApp plugin
          try {
            console.log('[OpenClawEnvironment] Enabling WhatsApp plugin...')
            await this.runOpenClawCommand(['plugins', 'enable', 'whatsapp'], 5000)
            actions.push('Enabled WhatsApp plugin')
            console.log('[OpenClawEnvironment] WhatsApp plugin enabled successfully')
          } catch (error) {
            console.error('[OpenClawEnvironment] Failed to enable WhatsApp plugin:', error)
          }
        }

        // Enable other essential channel plugins if disabled
        const essentialPlugins = ['telegram', 'discord', 'slack']
        for (const plugin of essentialPlugins) {
          if (pluginsOutput.includes(plugin) && pluginsOutput.includes('disabled')) {
            try {
              await this.runOpenClawCommand(['plugins', 'enable', plugin], 5000)
              actions.push(`Enabled ${plugin} plugin`)
              console.log(`[OpenClawEnvironment] Enabled ${plugin} plugin`)
            } catch (error) {
              console.error(`[OpenClawEnvironment] Failed to enable ${plugin} plugin:`, error)
            }
          }
        }
      }

      // Check for missing credentials directory
      if (doctorOutput.includes('OAuth dir missing')) {
        issues.push('OAuth credentials directory missing')

        // Create credentials directory
        const homeDir = process.env.HOME || process.env.USERPROFILE || ''
        const credentialsDir = path.join(homeDir, '.openclaw', 'credentials')

        if (!fs.existsSync(credentialsDir)) {
          try {
            fs.mkdirSync(credentialsDir, { recursive: true })
            actions.push('Created OAuth credentials directory')
            console.log('[OpenClawEnvironment] Created credentials directory')
          } catch (error) {
            console.error('[OpenClawEnvironment] Failed to create credentials directory:', error)
          }
        }
      }

      // Run doctor --fix if there are issues
      if (issues.length > 0) {
        try {
          console.log('[OpenClawEnvironment] Running doctor --fix...')
          await this.runOpenClawCommand(['doctor', '--fix'], 15000)
          actions.push('Applied doctor fixes')
        } catch (error) {
          console.error('[OpenClawEnvironment] Doctor --fix failed:', error)
        }
      }

      console.log(`[OpenClawEnvironment] Doctor diagnostics complete. Issues: ${issues.length}, Actions: ${actions.length}`)

      return {
        hasIssues: issues.length > 0,
        fixed: actions.length > 0,
        issues,
        actions
      }
    } catch (error) {
      console.error('[OpenClawEnvironment] Doctor diagnostics failed:', error)
      return {
        hasIssues: false,
        fixed: false,
        issues: [],
        actions: []
      }
    }
  }

  /**
   * Run an OpenClaw command with proper environment.
   * In production uses the bundled bun binary and ~/.openclaw-easy/app/openclaw.mjs.
   * In development uses the local bun and TypeScript source.
   */
  private async runOpenClawCommand(args: string[], timeout: number = 10000): Promise<string> {
    const { app } = await import('electron')
    const isWindows = process.platform === 'win32'
    const home = process.env.HOME || process.env.USERPROFILE || ''
    const pathSep = isWindows ? ';' : ':'
    const env = this.getEnvironmentVariables()

    let runtime: string
    let openclawPath: string
    let enhancedEnv: NodeJS.ProcessEnv

    if (app.isPackaged) {
      const bunBinaryName = isWindows
        ? 'bun-windows.exe'
        : `bun-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
      runtime = path.join(process.resourcesPath, 'bun', bunBinaryName)
      openclawPath = path.join(home, '.openclaw-easy', 'app', 'openclaw.mjs')
      const expandedPath = isWindows
        ? (process.env.PATH || '')
        : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', process.env.PATH || ''].join(pathSep)
      enhancedEnv = { ...process.env, ...env, PATH: expandedPath }
    } else {
      const bunPath = path.join(home, '.bun', 'bin')
      runtime = 'bun'
      openclawPath = path.join(__dirname, '../../../../openclaw/src/index.ts')
      enhancedEnv = { ...process.env, ...env, PATH: `${bunPath}:${process.env.PATH}` }
    }

    // Diagnostic logging for production troubleshooting.
    const runtimeOk = existsSync(runtime)
    const openclawOk = existsSync(openclawPath)
    console.log(`[OpenClawEnvironment] runOpenClawCommand: args=[${args.join(' ')}]`)
    console.log(`[OpenClawEnvironment]   runtime     : ${runtime} (exists=${runtimeOk})`)
    console.log(`[OpenClawEnvironment]   openclawPath: ${openclawPath} (exists=${openclawOk})`)
    if (!runtimeOk) console.error('[OpenClawEnvironment] *** MISSING runtime binary — spawn will ENOENT ***')
    if (!openclawOk) console.error('[OpenClawEnvironment] *** MISSING openclaw entry point — spawn will fail ***')

    return new Promise((resolve, reject) => {
      const proc = spawn(runtime, [openclawPath, ...args], {
        env: enhancedEnv,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let stdout = ''
      let stderr = ''
      let completed = false

      // Add timeout to prevent hanging
      const timeoutHandle = setTimeout(() => {
        if (!completed) {
          completed = true
          proc.kill('SIGTERM')
          console.warn(`[OpenClawEnvironment] Command timed out after ${timeout}ms: ${args.join(' ')}`)
          resolve(stdout || stderr || 'Command timed out')
        }
      }, timeout)

      proc.stdout?.on('data', (data) => {
        stdout += data.toString()
      })

      proc.stderr?.on('data', (data) => {
        const text = data.toString()
        if (!text.includes('DeprecationWarning')) {
          stderr += text
        }
      })

      proc.on('exit', (code) => {
        if (!completed) {
          completed = true
          clearTimeout(timeoutHandle)
          // Return output even on non-zero exit for diagnostic purposes
          resolve(stdout || stderr)
        }
      })

      proc.on('error', (error) => {
        if (!completed) {
          completed = true
          clearTimeout(timeoutHandle)
          reject(error)
        }
      })
    })
  }
}