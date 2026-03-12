import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { spawn } from 'child_process'

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

export class EnvironmentManager {
  private configPath: string

  constructor(configPath: string = path.join(os.homedir(), '.openclaw', 'openclaw.json')) {
    this.configPath = configPath
  }

  /**
   * Initialize environment variables on Desktop app startup
   */
  async initializeEnvironment(): Promise<void> {
    console.log('[EnvironmentManager] Initializing system environment variables...')

    try {
      const requiredVars = this.getRequiredEnvironmentVariables()
      if (!requiredVars || Object.keys(requiredVars).length === 0) {
        console.log('[EnvironmentManager] No environment variables needed based on current configuration')
        return
      }

      const missingVars = this.checkMissingEnvironmentVariables(requiredVars)
      if (Object.keys(missingVars).length === 0) {
        console.log('[EnvironmentManager] All required environment variables are already set')
        return
      }

      console.log('[EnvironmentManager] Setting missing environment variables:', Object.keys(missingVars))
      await this.setSystemEnvironmentVariables(missingVars)

      // Update current process environment as well
      Object.assign(process.env, missingVars)

      console.log('[EnvironmentManager] Environment initialization completed')
    } catch (error) {
      console.error('[EnvironmentManager] Error initializing environment:', error)
    }
  }

  /**
   * Update environment variables when model configuration changes
   */
  async updateEnvironmentVariables(): Promise<void> {
    console.log('[EnvironmentManager] Updating environment variables after configuration change...')
    await this.initializeEnvironment()
  }

  /**
   * Get required environment variables based on OpenClaw configuration
   */
  private getRequiredEnvironmentVariables(): Record<string, string> {
    try {
      if (!fs.existsSync(this.configPath)) {
        console.log('[EnvironmentManager] OpenClaw config not found, no environment variables required')
        return {}
      }

      const configContent = fs.readFileSync(this.configPath, 'utf-8')
      const config: OpenClawConfig = JSON.parse(configContent)

      const primaryModel = config.agents?.defaults?.model?.primary
      if (!primaryModel) {
        console.log('[EnvironmentManager] No primary model configured')
        return {}
      }

      console.log(`[EnvironmentManager] Analyzing model: ${primaryModel}`)

      // Extract provider from model string
      const providerMatch = primaryModel.match(/^([^/]+)/)
      if (!providerMatch) {
        console.log('[EnvironmentManager] Could not extract provider from model')
        return {}
      }

      const provider = providerMatch[1]
      console.log(`[EnvironmentManager] Detected provider: ${provider}`)

      const providerConfig = config.models?.providers?.[provider]
      if (!providerConfig) {
        console.log(`[EnvironmentManager] No provider configuration found for: ${provider}`)
        return {}
      }

      // Generate environment variables based on provider type
      const envVars: Record<string, string> = {}

      switch (provider) {
        case 'ollama':
          if (providerConfig.baseUrl) {
            // Extract host from baseUrl (remove /v1 suffix if present)
            const baseUrl = providerConfig.baseUrl.replace(/\/v1$/, '')
            envVars.OLLAMA_HOST = baseUrl
          }
          if (providerConfig.apiKey) {
            envVars.OLLAMA_API_KEY = providerConfig.apiKey
          }
          break

        case 'anthropic':
          if (providerConfig.apiKey) {
            envVars.ANTHROPIC_API_KEY = providerConfig.apiKey
          }
          break

        case 'openai':
          if (providerConfig.apiKey) {
            envVars.OPENAI_API_KEY = providerConfig.apiKey
          }
          if (providerConfig.baseUrl) {
            envVars.OPENAI_BASE_URL = providerConfig.baseUrl
          }
          break

        case 'google':
          if (providerConfig.apiKey) {
            envVars.GEMINI_API_KEY = providerConfig.apiKey
          }
          break

        default:
          console.log(`[EnvironmentManager] Unknown provider: ${provider}`)
      }

      console.log(`[EnvironmentManager] Required environment variables:`, Object.keys(envVars))
      return envVars

    } catch (error) {
      console.error('[EnvironmentManager] Error reading config:', error)
      return {}
    }
  }

  /**
   * Check which environment variables are missing
   */
  private checkMissingEnvironmentVariables(requiredVars: Record<string, string>): Record<string, string> {
    const missingVars: Record<string, string> = {}

    for (const [key, value] of Object.entries(requiredVars)) {
      if (!process.env[key] || process.env[key] !== value) {
        missingVars[key] = value
        console.log(`[EnvironmentManager] Missing/incorrect env var: ${key}`)
      }
    }

    return missingVars
  }

  /**
   * Set system environment variables persistently
   */
  private async setSystemEnvironmentVariables(vars: Record<string, string>): Promise<void> {
    const platform = process.platform

    try {
      if (platform === 'darwin') {
        await this.setMacEnvironmentVariables(vars)
      } else if (platform === 'win32') {
        await this.setWindowsEnvironmentVariables(vars)
      } else {
        await this.setLinuxEnvironmentVariables(vars)
      }
    } catch (error) {
      console.error('[EnvironmentManager] Error setting system environment variables:', error)
      throw error
    }
  }

  /**
   * Set environment variables on macOS
   */
  private async setMacEnvironmentVariables(vars: Record<string, string>): Promise<void> {
    console.log('[EnvironmentManager] Setting macOS environment variables...')

    // Create/update ~/.zshrc and ~/.bash_profile for shell sessions
    const homeDir = os.homedir()
    const profiles = ['.zshrc', '.bash_profile']

    for (const profile of profiles) {
      const profilePath = path.join(homeDir, profile)

      try {
        // Read existing content
        let content = ''
        if (fs.existsSync(profilePath)) {
          content = fs.readFileSync(profilePath, 'utf-8')
        }

        let updated = false
        for (const [key, value] of Object.entries(vars)) {
          const exportLine = `export ${key}="${value}"`
          const existingPattern = new RegExp(`^\\s*export\\s+${key}=.*`, 'gm')

          if (existingPattern.test(content)) {
            // Replace existing
            content = content.replace(existingPattern, exportLine)
            updated = true
          } else {
            // Add new
            content += `\n# Added by Openclaw Easy Desktop App\n${exportLine}\n`
            updated = true
          }
        }

        if (updated) {
          fs.writeFileSync(profilePath, content)
          console.log(`[EnvironmentManager] Updated ${profile}`)
        }
      } catch (error) {
        console.error(`[EnvironmentManager] Error updating ${profile}:`, error)
      }
    }

    // Also set for current session using launchctl (for GUI applications)
    for (const [key, value] of Object.entries(vars)) {
      try {
        await this.execCommand(`launchctl setenv ${key} "${value}"`)
        console.log(`[EnvironmentManager] Set launchctl env var: ${key}`)
      } catch (error) {
        console.error(`[EnvironmentManager] Error setting launchctl env var ${key}:`, error)
      }
    }
  }

  /**
   * Set environment variables on Windows
   */
  private async setWindowsEnvironmentVariables(vars: Record<string, string>): Promise<void> {
    console.log('[EnvironmentManager] Setting Windows environment variables...')

    for (const [key, value] of Object.entries(vars)) {
      try {
        // Set for current user
        await this.execCommand(`setx ${key} "${value}"`)
        console.log(`[EnvironmentManager] Set Windows env var: ${key}`)
      } catch (error) {
        console.error(`[EnvironmentManager] Error setting Windows env var ${key}:`, error)
      }
    }
  }

  /**
   * Set environment variables on Linux
   */
  private async setLinuxEnvironmentVariables(vars: Record<string, string>): Promise<void> {
    console.log('[EnvironmentManager] Setting Linux environment variables...')

    const homeDir = os.homedir()
    const profiles = ['.bashrc', '.profile']

    for (const profile of profiles) {
      const profilePath = path.join(homeDir, profile)

      try {
        let content = ''
        if (fs.existsSync(profilePath)) {
          content = fs.readFileSync(profilePath, 'utf-8')
        }

        let updated = false
        for (const [key, value] of Object.entries(vars)) {
          const exportLine = `export ${key}="${value}"`
          const existingPattern = new RegExp(`^\\s*export\\s+${key}=.*`, 'gm')

          if (existingPattern.test(content)) {
            content = content.replace(existingPattern, exportLine)
            updated = true
          } else {
            content += `\n# Added by Openclaw Easy Desktop App\n${exportLine}\n`
            updated = true
          }
        }

        if (updated) {
          fs.writeFileSync(profilePath, content)
          console.log(`[EnvironmentManager] Updated ${profile}`)
        }
      } catch (error) {
        console.error(`[EnvironmentManager] Error updating ${profile}:`, error)
      }
    }
  }

  /**
   * Execute shell command with promise
   */
  private execCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const [cmd, ...args] = command.split(' ')
      const proc = spawn(cmd, args, { shell: true })

      let stdout = ''
      let stderr = ''

      proc.stdout?.on('data', (data) => {
        stdout += data.toString()
      })

      proc.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout)
        } else {
          reject(new Error(`Command failed: ${command}\nStderr: ${stderr}`))
        }
      })

      proc.on('error', reject)
    })
  }
}