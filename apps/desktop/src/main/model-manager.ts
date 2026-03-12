import { exec, execFile, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export interface ModelInfo {
  name: string;
  tag: string;
  size: string;
  modified: string;
  digest?: string;
  status: 'available' | 'downloading' | 'installed' | 'error';
  downloadProgress?: number;
}

export interface ModelDownloadProgress {
  modelName: string;
  progress: number;
  status: string;
  total?: number;
  completed?: number;
}

export class ModelManager {
  private downloadCallbacks: Map<string, (progress: ModelDownloadProgress) => void> = new Map();
  private isOllamaAvailable: boolean | null = null;
  private ollamaDetectionInterval: NodeJS.Timeout | null = null;
  private isModelManagerPageActive: boolean = false;

  /**
   * Resolve the absolute path to the ollama binary.
   * macOS GUI apps launch with a stripped PATH (/usr/bin:/bin:/usr/sbin:/sbin),
   * so bare 'ollama' will ENOENT. We must check known absolute locations.
   * Returns null if ollama is not found anywhere.
   */
  private async resolveOllamaBinary(): Promise<string | null> {
    // Common absolute install locations that are NOT in the stripped macOS GUI PATH
    const candidates = [
      '/usr/local/bin/ollama',
      '/opt/homebrew/bin/ollama',
      '/Applications/Ollama.app/Contents/Resources/ollama',
    ];

    const { existsSync } = await import('fs');
    for (const p of candidates) {
      if (existsSync(p)) {
        console.log(`[ModelManager] resolveOllamaBinary: found at ${p}`);
        return p;
      }
    }

    // Last resort: try which (works in dev / terminal-launched app)
    try {
      const { stdout } = await execAsync('which ollama');
      const p = stdout.trim();
      if (p) {
        console.log(`[ModelManager] resolveOllamaBinary: found via which → ${p}`);
        return p;
      }
    } catch {
      // which failed — ollama is not in PATH
    }

    console.warn('[ModelManager] resolveOllamaBinary: ollama binary not found');
    return null;
  }



  async checkOllamaAvailable(): Promise<boolean> {
    try {
      console.log('[ModelManager] Checking if Ollama is available...');

      // First, check if Ollama is already running
      try {
        await execAsync('curl -s http://localhost:11434/api/version --connect-timeout 2');
        console.log('[ModelManager] Ollama is available and running');
        this.isOllamaAvailable = true;
        return true;
      } catch {
        console.log('[ModelManager] Ollama service not running, checking if binary exists...');
      }

      // Check if Ollama binary exists (either via symlink or app path)
      let ollamaBinary = null;

      // First, try to find via symlink
      try {
        await execAsync('which ollama');
        ollamaBinary = 'ollama';
        console.log('[ModelManager] Found ollama via PATH');
      } catch {
        // Check if Ollama app is installed (common scenario after manual installation)
        try {
          await execAsync('ls /Applications/Ollama.app/Contents/Resources/ollama');
          ollamaBinary = '/Applications/Ollama.app/Contents/Resources/ollama';
          console.log('[ModelManager] Found Ollama.app, attempting to start service...');
        } catch {
          console.log('[ModelManager] Ollama binary not found anywhere');
          this.isOllamaAvailable = false;
          return false;
        }
      }

      // If we found Ollama binary, try to start it
      if (ollamaBinary) {
        console.log('[ModelManager] Attempting to start Ollama service...');
        const started = await this.startOllama();
        if (started) {
          console.log('[ModelManager] Successfully auto-started Ollama service');
          this.isOllamaAvailable = true;

          // Notify frontend to refresh
          const { BrowserWindow } = require('electron');
          const window = BrowserWindow.getAllWindows()[0];
          if (window) {
            window.webContents.send('ollama-installed');
            window.webContents.send('ollama-status-changed', { available: true });
          }

          return true;
        } else {
          console.log('[ModelManager] Failed to start Ollama service');
          this.isOllamaAvailable = false;
          return false;
        }
      }

      this.isOllamaAvailable = false;
      return false;
    } catch (error) {
      console.error('[ModelManager] Error checking Ollama availability:', error instanceof Error ? error.message : error);
      this.isOllamaAvailable = false;
      return false;
    }
  }

  // Start continuous Ollama detection for Model Manager page
  startOllamaDetection(): void {
    console.log('[ModelManager] Starting continuous Ollama detection');
    this.isModelManagerPageActive = true;

    // Clear any existing interval
    if (this.ollamaDetectionInterval) {
      clearInterval(this.ollamaDetectionInterval);
    }

    // Check immediately
    this.checkOllamaDetection();

    // Then check every 3 seconds as requested
    this.ollamaDetectionInterval = setInterval(() => {
      this.checkOllamaDetection();
    }, 3000);
  }

  // Stop continuous Ollama detection
  stopOllamaDetection(): void {
    console.log('[ModelManager] Stopping continuous Ollama detection');
    this.isModelManagerPageActive = false;

    if (this.ollamaDetectionInterval) {
      clearInterval(this.ollamaDetectionInterval);
      this.ollamaDetectionInterval = null;
    }
  }

  private async checkOllamaDetection(): Promise<void> {
    // Only run if Model Manager page is active
    if (!this.isModelManagerPageActive) {
      return;
    }

    try {
      console.log('[ModelManager] Running Ollama detection check...');

      // Check if Ollama is available (this will also try to start it automatically)
      const wasAvailable = this.isOllamaAvailable;
      const isNowAvailable = await this.checkOllamaAvailable();

      console.log(`[ModelManager] Detection result: was=${wasAvailable}, now=${isNowAvailable}`);

      // If Ollama becomes available, notify the frontend and stop detection
      if (!wasAvailable && isNowAvailable) {
        console.log('[ModelManager] Ollama became available, stopping detection and notifying frontend');
        this.stopOllamaDetection();

        // Notify frontend to refresh
        const { BrowserWindow } = require('electron');
        const window = BrowserWindow.getAllWindows()[0];
        if (window) {
          window.webContents.send('ollama-status-changed', { available: true });
        }
      } else if (!isNowAvailable) {
        console.log('[ModelManager] Ollama still not available, continuing detection...');
      }
    } catch (error) {
      console.log('[ModelManager] Detection check failed:', error instanceof Error ? error.message : error);
    }
  }

  async startOllama(): Promise<boolean> {
    try {
      console.log('[ModelManager] Attempting to start Ollama...');

      // Check if Ollama is already running
      try {
        await execAsync('curl -s http://localhost:11434/api/version --connect-timeout 1');
        console.log('[ModelManager] Ollama is already running');
        return true;
      } catch {
        console.log('[ModelManager] Ollama not running, starting it...');
      }

      const ollama_command = await this.resolveOllamaBinary();
      if (!ollama_command) {
        console.error('[ModelManager] Ollama binary not found');
        return false;
      }

      // Use spawn to start ollama serve in background with proper detachment
      const { spawn } = require('child_process');
      const child = spawn(ollama_command, ['serve'], {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore']
      });

      // Unref to allow parent process to exit independently
      child.unref();

      console.log(`[ModelManager] Started Ollama process with PID: ${child.pid}`);

      // Wait a moment for startup
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check if it's now available
      try {
        const result = await execAsync('curl -s http://localhost:11434/api/version --connect-timeout 3');
        console.log('[ModelManager] Ollama service started successfully, version:', result.stdout.trim());
        return true;
      } catch (error) {
        console.error('[ModelManager] Ollama service failed to start or is not responding:', error instanceof Error ? error.message : error);
        return false;
      }
    } catch (error) {
      console.error('[ModelManager] Failed to start Ollama:', error);
      return false;
    }
  }

  async installOllama(): Promise<{ success: boolean; message: string; checkInterval?: boolean }> {
    try {
      console.log('[ModelManager] Installing Ollama using official installer...');

      const platform = process.platform;

      if (platform === 'darwin') {
        // macOS: Open the Ollama website for download
        console.log('[ModelManager] Opening Ollama download page for macOS...');

        const { shell } = require('electron');

        // Open the Ollama download page
        shell.openExternal('https://ollama.com/download/Ollama-darwin.zip');

        // Start periodic check for installation
        this.startInstallationCheck();

        return {
          success: true,
          message: 'The Ollama download page has been opened in your browser. We\'ll automatically detect when installation is complete.',
          checkInterval: true
        };

      } else if (platform === 'win32') {
        // Windows: Open the Ollama website for download
        console.log('[ModelManager] Opening Ollama download page for Windows...');

        const { shell } = require('electron');
        shell.openExternal('https://ollama.com/download/windows');

        // Start periodic check for installation
        this.startInstallationCheck();

        return {
          success: true,
          message: 'The Ollama download page has been opened in your browser. We\'ll automatically detect when installation is complete.',
          checkInterval: true
        };

      } else {
        // Linux: Try to use the install script
        console.log('[ModelManager] Using official installer for Linux...');

        try {
          const { stdout } = await execAsync('curl -fsSL https://ollama.com/install.sh | sh');
          console.log('[ModelManager] Installation output:', stdout);

          // Reset availability check and verify installation
          this.isOllamaAvailable = null;

          // Give it a moment to start, then check if it's working
          setTimeout(async () => {
            const isAvailable = await this.checkOllamaAvailable();
            if (isAvailable) {
              console.log('[ModelManager] Ollama installation verified successfully');
            } else {
              console.log('[ModelManager] Ollama installed but not running');
            }
          }, 5000);

          return {
            success: true,
            message: 'Ollama installed successfully! You can now install AI models.'
          };

        } catch (error) {
          console.error('[ModelManager] Linux installation failed:', error);

          // Open download page as fallback
          const { shell } = require('electron');
          shell.openExternal('https://ollama.com/download/linux');

          // Start periodic check for installation
          this.startInstallationCheck();

          return {
            success: true,
            message: 'The Ollama download page has been opened. We\'ll automatically detect when installation is complete.',
            checkInterval: true
          };
        }
      }

    } catch (error) {
      console.error('[ModelManager] Ollama installation failed:', error);

      return {
        success: false,
        message: `Installation failed: ${error instanceof Error ? error.message : error}`
      };
    }
  }

  private installCheckInterval: NodeJS.Timeout | null = null;
  private installCheckCallback: ((installed: boolean) => void) | null = null;

  startInstallationCheck(callback?: (installed: boolean) => void) {
    if (callback) {
      this.installCheckCallback = callback;
    }

    // Clear any existing interval
    if (this.installCheckInterval) {
      clearInterval(this.installCheckInterval);
    }

    console.log('[ModelManager] Starting periodic Ollama installation check...');

    // Check immediately
    this.checkAndNotifyInstallation();

    // Then check every 1 second for faster detection
    this.installCheckInterval = setInterval(() => {
      this.checkAndNotifyInstallation();
    }, 3000);

    // Stop checking after 5 minutes
    setTimeout(() => {
      this.stopInstallationCheck();
      console.log('[ModelManager] Stopped installation check after timeout');
    }, 5 * 60 * 1000);
  }

  private async checkAndNotifyInstallation() {
    const isInstalled = await this.checkOllamaAvailable();

    if (isInstalled) {
      console.log('[ModelManager] Ollama installation detected!');

      // Notify the frontend
      const { BrowserWindow } = require('electron');
      const window = BrowserWindow.getAllWindows()[0];
      if (window) {
        window.webContents.send('ollama-installed');
      }

      // Call callback if provided
      if (this.installCheckCallback) {
        this.installCheckCallback(true);
      }

      // Stop checking
      this.stopInstallationCheck();
    }
  }

  stopInstallationCheck() {
    if (this.installCheckInterval) {
      clearInterval(this.installCheckInterval);
      this.installCheckInterval = null;
    }
    this.installCheckCallback = null;
  }

  async listInstalledModels(): Promise<ModelInfo[]> {
    console.log('[ModelManager] Listing installed models');
    const isAvailable = await this.checkOllamaAvailable();
    if (!isAvailable) {
      console.log('[ModelManager] Ollama not available, returning empty list');
      return [];
    }

    try {
      const ollama_command = await this.resolveOllamaBinary();
      if (!ollama_command) {
        console.error('[ModelManager] Ollama binary not found for listing');
        return [];
      }

      console.log(`[ModelManager] Running: ${ollama_command} list`);
      const { stdout } = await execFileAsync(ollama_command, ['list']);
      console.log('[ModelManager] Raw ollama list output:');
      console.log(stdout);
      console.log('[ModelManager] Raw output (JSON):', JSON.stringify(stdout));
      const lines = stdout.split('\n').filter(line => line.trim() && !line.startsWith('NAME'));
      console.log('[ModelManager] Filtered lines:', lines);

      const models = lines.map(line => {
        const parts = line.split(/\s+/);
        console.log('[ModelManager] Parsing line:', line, '-> parts:', parts);

        // Proper parsing: nameTag, id, then size (number + unit), then modified (rest)
        const nameTag = parts[0] || 'unknown';
        const id = parts[1] || 'unknown';

        // Size is always parts[2] + parts[3] (e.g., "3.8" + "GB")
        const size = parts[2] && parts[3] ? `${parts[2]} ${parts[3]}` : 'unknown';

        // Modified is everything from index 4 onwards
        const modified = parts.slice(4).join(' ') || 'unknown';

        const [name, tag] = nameTag.split(':');

        const model = {
          name: name || 'unknown',
          tag: tag || 'latest',
          size: size,
          modified: modified,
          digest: id,
          status: 'installed' as const
        };
        console.log('[ModelManager] Parsed model:', model);
        return model;
      });
      console.log('[ModelManager] Found installed models:', models);
      return models;
    } catch (error) {
      console.error('[ModelManager] Failed to list models:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  async listAvailableModels(): Promise<any[]> {
    try {
      console.log('[ModelManager] Fetching available models from ollama.ai/library...');

      // Scrape the actual Ollama library page to get all available models
      const pageResponse = await execAsync('curl -s -L -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" https://ollama.ai/library --max-time 10');

      // Extract model names from the HTML using simple text parsing
      const html = pageResponse.stdout;
      const modelMatches = html.match(/\/library\/([a-zA-Z0-9._-]+)/g);

      if (modelMatches && modelMatches.length > 0) {
        console.log('[ModelManager] Found model matches from web scraping:', modelMatches.length);

        // Extract unique model names from the matched URLs
        const uniqueModelNames = [...new Set(modelMatches.map(match =>
          match.replace('/library/', '').toLowerCase()
        ))];

        // Return models immediately with empty tags for instant UI loading
        const availableModels = uniqueModelNames.map(modelName => {
          return {
            id: modelName, // No tag - will be determined during install
            name: this.formatModelDisplayName(modelName),
            description: this.getModelDescription(modelName),
            size: this.estimateModelSize(modelName),
            category: this.categorizeModel(modelName),
            provider: this.getProviderFromId(modelName),
            recommended: this.isRecommendedModel(modelName)
          };
        });

        console.log(`[ModelManager] Successfully extracted ${availableModels.length} models from ollama.ai/library`);
        return availableModels;
      }

      console.log('[ModelManager] No models found in web scraping - returning empty list');
      return [];

    } catch (error) {
      console.error('[ModelManager] Model discovery failed:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  private async getBestTag(modelName: string): Promise<string> {
    const ollamaBinary = await this.resolveOllamaBinary();
    if (!ollamaBinary) {
      console.error('[ModelManager] Ollama binary not found for tag detection');
      return 'latest';
    }

    // Try tags in order of preference: no tag first (works for most models), then common tags
    const tagsToTry = ['', 'latest', 'cloud', 'instruct', 'chat', 'code', 'text'];

    for (const tag of tagsToTry) {
      const modelWithTag = tag ? `${modelName}:${tag}` : modelName;

      try {
        console.log(`[ModelManager] Testing tag '${tag || 'no-tag'}' for ${modelName}...`);

        // Quick test: try to pull the model manifest without downloading
        const testResult = await execFileAsync(ollamaBinary, ['pull', modelWithTag], { timeout: 10000 }).catch(e => ({ stdout: e.stdout || '', stderr: e.stderr || '' }));
        const testOutput = `${testResult.stdout}${testResult.stderr}`;

        // If it starts pulling (shows "pulling manifest"), the tag works
        if (testOutput.includes('pulling manifest') || testOutput.includes('pulling')) {
          console.log(`[ModelManager] Found working tag for ${modelName}: '${tag || 'no-tag'}'`);

          // Cancel the pull since we just wanted to test
          try { spawn('pkill', ['-f', `ollama pull ${modelWithTag}`], { stdio: 'ignore' }); } catch {}

          return tag || 'latest'; // Return 'latest' if empty tag worked (Ollama's default behavior)
        }

      } catch (error) {
        // This tag doesn't work, try the next one
        console.log(`[ModelManager] Tag '${tag || 'no-tag'}' failed for ${modelName}, trying next...`);
        continue;
      }
    }

    // If all tags fail, return 'latest' as final fallback
    console.log(`[ModelManager] All tags failed for ${modelName}, using 'latest' as final fallback`);
    return 'latest';
  }

  private formatModelDisplayName(id: string): string {
    return id.split(':')[0].replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  private categorizeModel(id: string): string {
    const name = id.toLowerCase();
    if (name.includes('code') || name.includes('coder')) {return 'coding';}
    if (name.includes('chat')) {return 'chat';}
    if (name.includes('1b') || name.includes('2b')) {return 'lightweight';}
    return 'general';
  }

  private getProviderFromId(id: string): string {
    // All models are community-provided through Ollama
    return 'Community';
  }

  private estimateModelSize(modelName: string): string {
    const name = modelName.toLowerCase();
    // Estimate sizes based on common model patterns
    if (name.includes('1b') || name.includes('1.5b')) {return '~1GB';}
    if (name.includes('2b')) {return '~1.5GB';}
    if (name.includes('3b')) {return '~2GB';}
    if (name.includes('7b')) {return '~4GB';}
    if (name.includes('8b')) {return '~4.5GB';}
    if (name.includes('13b')) {return '~7GB';}
    if (name.includes('70b')) {return '~40GB';}
    if (name.includes('embed')) {return '~1GB';}
    if (name.includes('code')) {return '~3GB';}
    return '~4GB'; // Default estimate
  }

  private getModelDescription(modelName: string): string {
    // Dynamic description without hardcoded model names
    const cleanName = modelName.replace(/[-_:]/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    return `${cleanName} - Open-source language model available through Ollama`;
  }

  private isRecommendedModel(modelName: string): boolean {
    // No hardcoded recommendations - all models are equal
    return false;
  }

  async installModel(modelId: string, onProgress?: (progress: ModelDownloadProgress) => void): Promise<{ success: boolean; message: string }> {
    const isAvailable = await this.checkOllamaAvailable();
    if (!isAvailable) {
      // Attempt to start or install Ollama
      const started = await this.startOllama();
      if (!started) {
        return {
          success: false,
          message: 'Ollama is not available. Please install Ollama first or enable Auto-Install in settings.'
        };
      }
    }

    try {
      console.log(`[ModelManager] Installing model: ${modelId}`);

      if (onProgress) {
        this.downloadCallbacks.set(modelId, onProgress);
      }

      // Find the ollama binary path first (handles stripped macOS GUI PATH)
      const ollamaBinary = await this.resolveOllamaBinary();
      if (!ollamaBinary) {
        return { success: false, message: 'Ollama binary not found. Please ensure Ollama is installed.' };
      }
      console.log(`[ModelManager] Using ollama binary at: ${ollamaBinary}`);

      // Extract model name from modelId (remove any existing tag)
      const modelName = modelId.split(':')[0];
      console.log(`[ModelManager] Installing ${modelName}...`);

      // Try each tag in sequence until one works
      const tagsToTry = ['', 'latest', 'cloud', 'instruct', 'chat', 'code', 'text'];

      for (let i = 0; i < tagsToTry.length; i++) {
        const tag = tagsToTry[i];
        const modelWithTag = tag === '' ? modelName : `${modelName}:${tag}`;

        console.log(`[ModelManager] Trying tag '${tag || 'no-tag'}' for ${modelName} (${i + 1}/${tagsToTry.length})...`);

        try {
          const result = await this.tryInstallWithTag(ollamaBinary, modelWithTag, modelId, onProgress);
          if (result.success) {
            console.log(`[ModelManager] Successfully installed ${modelName} with tag '${tag || 'no-tag'}'`);
            return result;
          } else {
            console.log(`[ModelManager] Tag '${tag || 'no-tag'}' failed for ${modelName}, trying next...`);
          }
        } catch (error) {
          console.log(`[ModelManager] Tag '${tag || 'no-tag'}' failed for ${modelName} with error:`, error);
        }
      }

      // All tags failed
      console.error(`[ModelManager] All tags failed for ${modelName}`);
      return {
        success: false,
        message: `Failed to install model ${modelName} - model may not exist or be available`
      };

    } catch (error) {
      this.downloadCallbacks.delete(modelId);
      console.error(`[ModelManager] Error installing model ${modelId}:`, error);
      return {
        success: false,
        message: `Error installing model: ${error instanceof Error ? error.message : error}`
      };
    }
  }

  private async tryInstallWithTag(
    ollamaBinary: string,
    modelWithTag: string,
    originalModelId: string,
    onProgress?: (progress: ModelDownloadProgress) => void
  ): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve) => {
      const child = execFile(ollamaBinary, ['pull', modelWithTag]);
      let buffer = '';

      // Ollama outputs progress to stderr, not stdout
      child.stderr?.on('data', (data) => {
        const output = data.toString();
        buffer += output;
        this.parseOllamaProgress(originalModelId, buffer, onProgress);
      });

      child.stdout?.on('data', (data) => {
        const output = data.toString();
        buffer += output;
        this.parseOllamaProgress(originalModelId, buffer, onProgress);
      });

      // Guard against spawn failures (binary missing, permissions, etc.)
      // Without this, an ENOENT would be an unhandled rejection and crash the main process.
      child.on('error', (err) => {
        console.error(`[ModelManager] tryInstallWithTag spawn error for ${modelWithTag}:`, err.message);
        resolve({ success: false, message: `Spawn error: ${err.message}` });
      });

      child.on('close', (code) => {
        if (code === 0) {
          if (onProgress) {
            onProgress({
              modelName: originalModelId,
              progress: 100,
              status: 'Installation complete'
            });
          }
          resolve({
            success: true,
            message: `Model ${modelWithTag} installed successfully`
          });
        } else {
          resolve({
            success: false,
            message: `Failed to install model ${modelWithTag}`
          });
        }
      });
    });
  }

  private parseOllamaProgress(modelId: string, buffer: string, onProgress?: (progress: ModelDownloadProgress) => void) {
    if (!onProgress) {return;}

    // Strip ANSI escape sequences and control characters from the buffer
    const cleanBuffer = buffer.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
                              .replace(/\x1b\[[?][0-9]*[hl]/g, '')
                              .replace(/\[K/g, '')
                              .replace(/\[A/g, '')
                              .replace(/\[\d+G/g, '');

    // Parse Ollama's progress output - look for the last line with percentage
    const lines = cleanBuffer.split('\n');

    // Process lines in reverse to get the most recent progress
    for (let i = lines.length - 1; i >= 0; i--) {
      const cleanLine = lines[i].trim();
      if (!cleanLine) {continue;}

      // Look for pulling with percentage (e.g., "pulling f5074b1221da:   3%")
      const pullMatch = cleanLine.match(/pulling\s+[\w:]+:\s*(\d+)%/);
      if (pullMatch) {
        const progress = parseInt(pullMatch[1]);

        onProgress({
          modelName: modelId,
          progress,
          status: `Downloading model... ${progress}%`
        });
        return; // Exit after finding most recent progress
      }

      // Look for simple percentage anywhere in the line
      const percentMatch = cleanLine.match(/(\d+)%/);
      if (percentMatch) {
        const progress = parseInt(percentMatch[1]);

        onProgress({
          modelName: modelId,
          progress,
          status: `Downloading... ${progress}%`
        });
        return;
      }
    }

    // Check for special states if no percentage found
    const fullText = cleanBuffer.toLowerCase();

    if (fullText.includes('pulling manifest')) {
      onProgress({
        modelName: modelId,
        progress: 1,
        status: 'Preparing download...'
      });
    } else if (fullText.includes('verifying')) {
      onProgress({
        modelName: modelId,
        progress: 95,
        status: 'Verifying model...'
      });
    } else if (fullText.includes('success') || fullText.includes('complete')) {
      onProgress({
        modelName: modelId,
        progress: 100,
        status: 'Installation complete'
      });
    }
  }

  async removeModel(modelId: string): Promise<{ success: boolean; message: string }> {
    const isAvailable = await this.checkOllamaAvailable();
    if (!isAvailable) {
      return {
        success: false,
        message: 'Ollama is not available'
      };
    }

    try {
      console.log(`[ModelManager] Removing model: ${modelId}`);

      // Get list of installed models to find the exact match
      const installedModels = await this.listInstalledModels();
      const installedModelNames = installedModels.map(m => `${m.name}:${m.tag}`);
      console.log(`[ModelManager] Installed models:`, installedModelNames);

      // Parse the requested modelId
      const [requestedName, requestedTag] = modelId.split(':');

      // Try to find the best match:
      // 1. Exact match (name:tag)
      // 2. Name match with any tag
      // 3. Starts-with match (for versioned models like minimax-m2 -> minimax-m2.1)
      const exactMatch = installedModels.find(m =>
        `${m.name}:${m.tag}` === modelId
      );

      const nameMatch = installedModels.find(m =>
        m.name === requestedName
      );

      const startsWithMatch = installedModels.find(m =>
        m.name.startsWith(requestedName)
      );

      const modelToRemove = exactMatch || nameMatch || startsWithMatch;

      if (!modelToRemove) {
        return {
          success: false,
          message: `Model '${modelId}' not found. Available models: ${installedModelNames.join(', ') || 'none'}`
        };
      }

      const fullModelName = `${modelToRemove.name}:${modelToRemove.tag}`;
      console.log(`[ModelManager] Found model to remove: ${fullModelName}`);

      const ollamaBinary = await this.resolveOllamaBinary();
      if (!ollamaBinary) {
        return { success: false, message: 'Ollama binary not found' };
      }
      await execFileAsync(ollamaBinary, ['rm', fullModelName]);

      return {
        success: true,
        message: `Model ${fullModelName} removed successfully`
      };
    } catch (error) {
      console.error(`[ModelManager] Error removing model ${modelId}:`, error);
      return {
        success: false,
        message: `Error removing model: ${error instanceof Error ? error.message : error}`
      };
    }
  }

  async validateModel(modelId: string): Promise<{ success: boolean; message: string }> {
    const isAvailable = await this.checkOllamaAvailable();
    if (!isAvailable) {
      return {
        success: false,
        message: 'Ollama is not available'
      };
    }

    try {
      console.log(`[ModelManager] Validating model: ${modelId}`);

      const ollamaBinary = await this.resolveOllamaBinary();
      if (!ollamaBinary) {
        return { success: false, message: 'Ollama binary not found' };
      }
      // Test the model with a simple prompt
      const { stdout } = await execFileAsync(ollamaBinary, ['generate', modelId, '--stream=false'], { input: 'Test prompt' } as any);

      if (stdout.trim()) {
        return {
          success: true,
          message: `Model ${modelId} is working correctly`
        };
      } else {
        return {
          success: false,
          message: `Model ${modelId} did not respond properly`
        };
      }
    } catch (error) {
      console.error(`[ModelManager] Error validating model ${modelId}:`, error);
      return {
        success: false,
        message: `Error validating model: ${error instanceof Error ? error.message : error}`
      };
    }
  }

  async getModelInfo(modelId: string): Promise<ModelInfo | null> {
    const models = await this.listInstalledModels();
    const [name, tag] = modelId.split(':');

    return models.find(m =>
      m.name === name && (m.tag === tag || (tag === undefined && m.tag === 'latest'))
    ) || null;
  }

  async getStorageInfo(): Promise<{ totalSize: string; modelCount: number }> {
    try {
      const models = await this.listInstalledModels();
      const modelCount = models.length;

      // Calculate total size (rough approximation)
      let totalBytes = 0;
      for (const model of models) {
        const sizeStr = model.size;
        if (sizeStr.includes('GB')) {
          totalBytes += parseFloat(sizeStr) * 1024 * 1024 * 1024;
        } else if (sizeStr.includes('MB')) {
          totalBytes += parseFloat(sizeStr) * 1024 * 1024;
        }
      }

      const totalGB = (totalBytes / (1024 * 1024 * 1024)).toFixed(1);

      return {
        totalSize: `${totalGB}GB`,
        modelCount
      };
    } catch (error) {
      console.error('[ModelManager] Error getting storage info:', error);
      return {
        totalSize: 'Unknown',
        modelCount: 0
      };
    }
  }

  async configureModel(modelId: string): Promise<{ success: boolean; message: string }> {
    try {
      console.log(`[ModelManager] Configuring model: ${modelId}`);

      // Update the OpenClaw configuration file
      const fs = require('fs');
      const path = require('path');
      const os = require('os');

      // Use OpenClaw's actual config path (not desktop app's)
      const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');

      let openclawConfig: any = {};
      if (fs.existsSync(configPath)) {
        const configContent = fs.readFileSync(configPath, 'utf8');
        openclawConfig = JSON.parse(configContent);
      }

      // Ensure agents.defaults structure exists
      if (!openclawConfig.agents) {
        openclawConfig.agents = {};
      }
      if (!openclawConfig.agents.defaults) {
        openclawConfig.agents.defaults = {};
      }

      // Detect model provider from the model ID
      let provider = 'ollama';
      let cleanModelId = modelId;
      let fullModelId = modelId;

      // Check if model ID already includes provider prefix
      if (modelId.includes('/')) {
        const [providerPart, modelPart] = modelId.split('/');
        provider = providerPart;
        cleanModelId = modelPart;
        fullModelId = modelId;
      } else if (modelId.includes(':')) {
        // Handle Ollama-style model:tag format
        provider = 'ollama';
        cleanModelId = modelId;
        fullModelId = `ollama/${cleanModelId}`;
      } else {
        // Default to Ollama for backward compatibility
        fullModelId = `ollama/${cleanModelId}`;
      }

      // Update the model configuration
      openclawConfig.agents.defaults.model = {
        primary: fullModelId
      };

      // Ensure models.providers structure exists
      if (!openclawConfig.models) {
        openclawConfig.models = {};
      }
      if (!openclawConfig.models.providers) {
        openclawConfig.models.providers = {};
      }

      // Configure the appropriate provider
      if (provider === 'ollama') {
        openclawConfig.models.providers.ollama = {
          baseUrl: "http://127.0.0.1:11434/v1",
          apiKey: "ollama-local",
          models: [
            {
              id: cleanModelId,
              name: this.formatModelDisplayName(cleanModelId)
            }
          ]
        };
      } else if (provider === 'anthropic') {
        // Ensure Anthropic provider is configured
        if (!openclawConfig.models.providers.anthropic) {
          openclawConfig.models.providers.anthropic = {
            apiKey: process.env.ANTHROPIC_API_KEY || ""
          };
        }
      } else if (provider === 'openai') {
        // Ensure OpenAI provider is configured
        if (!openclawConfig.models.providers.openai) {
          openclawConfig.models.providers.openai = {
            apiKey: process.env.OPENAI_API_KEY || ""
          };
        }
      }

      // Write back to file
      fs.writeFileSync(configPath, JSON.stringify(openclawConfig, null, 2));

      console.log(`[ModelManager] Successfully updated config to use ${fullModelId} with ${provider} provider`);

      // For local models (Ollama), create agent-specific auth-profiles.json
      if (provider === 'ollama') {
        try {
          const agentsDir = path.join(os.homedir(), '.openclaw', 'agents');

          // Find all agent directories
          if (fs.existsSync(agentsDir)) {
            const agents = fs.readdirSync(agentsDir, { withFileTypes: true })
              .filter(dirent => dirent.isDirectory())
              .map(dirent => dirent.name);

            for (const agentName of agents) {
              const agentDir = path.join(agentsDir, agentName, 'agent');

              // Create agent directory if it doesn't exist
              if (!fs.existsSync(agentDir)) {
                fs.mkdirSync(agentDir, { recursive: true });
              }

              const authProfilesPath = path.join(agentDir, 'auth-profiles.json');

              // Create auth-profiles.json for Ollama
              const authProfiles = {
                ollama: {
                  baseUrl: "http://127.0.0.1:11434/v1",
                  apiKey: "ollama-local"
                }
              };

              fs.writeFileSync(authProfilesPath, JSON.stringify(authProfiles, null, 2));
              console.log(`[ModelManager] Created auth-profiles.json for agent: ${agentName}`);
            }
          }
        } catch (error) {
          console.warn(`[ModelManager] Warning: Failed to create agent auth profiles:`, error);
          // Don't fail the entire operation if auth profile creation fails
        }
      }

      // Validate that required credentials are available
      if (provider === 'anthropic' && !openclawConfig.models.providers.anthropic?.apiKey) {
        console.warn('[ModelManager] Warning: Anthropic API key not configured');
        return {
          success: true,
          message: `Model configured but Anthropic API key is missing. Please add it in Configuration.`
        };
      }
      if (provider === 'openai' && !openclawConfig.models.providers.openai?.apiKey) {
        console.warn('[ModelManager] Warning: OpenAI API key not configured');
        return {
          success: true,
          message: `Model configured but OpenAI API key is missing. Please add it in Configuration.`
        };
      }

      return {
        success: true,
        message: `Successfully configured ${modelId} as active model with ${provider} provider`
      };
    } catch (error) {
      console.error(`[ModelManager] Failed to configure model ${modelId}:`, error);
      return {
        success: false,
        message: `Failed to configure model: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

}