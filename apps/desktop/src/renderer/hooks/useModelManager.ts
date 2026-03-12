import { useState, useCallback, useEffect } from 'react';

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  sizes: string[];
  description: string;
  requirements: { ram: number; disk: number } | null;
  downloads: string;
  status: 'not_installed' | 'installing' | 'installed' | 'failed';
  icon: string;
  premium?: boolean;
  progress?: number;
}

export interface SystemInfo {
  ram: number;
  gpu: string;
  disk: number;
  arch: string;
}

export interface OllamaInstallState {
  isInstalling: boolean;
  progress: number;
  error?: string;
}

export const useModelManager = () => {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [installedModels, setInstalledModels] = useState<Set<string>>(new Set());
  const [ollamaAvailable, setOllamaAvailable] = useState(false);
  const [ollamaInstallState, setOllamaInstallState] = useState<OllamaInstallState>({
    isInstalling: false,
    progress: 0
  });

  const [systemInfo, setSystemInfo] = useState<SystemInfo>({
    ram: 16, // Use your actual 16GB RAM as default
    gpu: 'Apple M1 Pro',
    disk: 250,
    arch: 'arm64'
  });

  // Initialize models once on mount - combine installed and available models
  useEffect(() => {
    const initializeModels = async () => {
      console.log('[ModelManager Frontend] Loading models from Ollama...');

      try {
        // Get both installed and available models
        const [installed, available] = await Promise.all([
          window.electronAPI?.getInstalledModels?.() || [],
          window.electronAPI?.getAvailableModels?.() || []
        ]);

        console.log('[ModelManager Frontend] Installed models:', installed);
        console.log('[ModelManager Frontend] Available models:', available);

        // Create set of installed model IDs for quick lookup
        const installedIds = new Set(installed.map((model: any) =>
          (model.name || model.id || 'unknown') + ':' + (model.tag || 'latest')
        ));

        // Convert installed models to ModelInfo format
        const installedModelList = installed.map((model: any) => {
          const baseId = `${model.name}:${model.tag}`;
          const provider = getProviderForModel(model.name);
          const icon = getIconForModel(model.name);
          const description = getDescriptionForModel(model.name);

          return {
            id: baseId,
            name: formatModelName(baseId),
            provider: provider,
            sizes: [model.tag || 'latest'],
            description: description,
            requirements: null, // No requirements checking for installed models
            downloads: model.size || 'Unknown',
            status: 'installed' as const,
            icon: icon
          };
        });

        // Convert available models to ModelInfo format (only if not already installed)
        const availableModelList = available
          .filter((model: any) => !installedIds.has(model.id))
          .map((model: any) => {
            const baseModel = model.id.split(':')[0];
            const provider = getProviderForModel(baseModel);
            const icon = getIconForModel(baseModel);

            // Use server requirements if available, otherwise use minimal defaults
            const requirements = model.requirements ||
              (model.ram && model.disk ? { ram: model.ram, disk: model.disk } : null);

            return {
              id: model.id,
              name: model.name,
              provider: provider,
              sizes: [extractModelSize(model.id)],
              description: model.description,
              requirements: requirements, // May be null - that's fine
              downloads: model.size || 'Popular',
              status: 'not_installed' as const,
              icon: icon,
              recommended: model.recommended,
              category: model.category
            };
          });

        // Combine installed and available models
        const allModels = [...installedModelList, ...availableModelList];
        console.log('[ModelManager Frontend] Combined models:', allModels);

        setModels(allModels);
        setInstalledModels(new Set(installedModelList.map(m => m.id)));

      } catch (error) {
        console.error('[ModelManager Frontend] Failed to load models:', error);
        setModels([]);
      }

      setLoading(false);
    };

    initializeModels();

    // Get actual system info once
    if (window.electronAPI?.getSystemInfo) {
      window.electronAPI.getSystemInfo().then((info: any) => {
        console.log('Received system info:', info);
        setSystemInfo({
          ram: info.ram,
          gpu: info.gpu || 'Integrated',
          disk: info.disk,
          arch: info.arch
        });
      }).catch(error => {
        console.error('Failed to get system info:', error);
        // Keep default values on error
      });
    }

    // Check Ollama availability once
    if (window.electronAPI?.checkOllamaAvailable) {
      window.electronAPI.checkOllamaAvailable().then((available: boolean) => {
        console.log('Ollama availability:', available);
        setOllamaAvailable(available);
      }).catch(error => {
        console.error('Failed to check Ollama availability:', error);
        setOllamaAvailable(false);
      });
    }
  }, []); // Empty dependency array - only run once!

  // Periodic check for installation status every 20 seconds
  useEffect(() => {
    const checkInstallationStatus = async () => {
      const installingModels = models.filter(m => m.status === 'installing');

      if (installingModels.length === 0) {return;}

      // Only log occasionally to reduce noise during downloads
      if (Math.random() < 0.1) { // Log ~10% of the time (every ~200 seconds on average)
        console.log(`[DEBUG] Checking installation status for ${installingModels.length} models`);
      }

      try {
        // Check which models are actually installed now
        const installedList = await window.electronAPI?.getInstalledModels?.() || [];
        const installedSet = new Set(installedList.map((m: any) => m.name || m.id || m));

        // Update status for any models that completed installation
        setModels(prev => prev.map(model => {
          if (model.status === 'installing' && installedSet.has(model.id)) {
            console.log(`[DEBUG] Model ${model.id} installation detected as complete!`);
            return { ...model, status: 'installed', progress: 100 };
          }
          return model;
        }));
      } catch (error) {
        console.error('[DEBUG] Failed to check installation status:', error);
      }
    };

    // Set up interval to check every 20 seconds, but only if we have installing models
    let interval: NodeJS.Timeout | null = null;

    const installingModels = models.filter(m => m.status === 'installing');
    if (installingModels.length > 0) {
      interval = setInterval(checkInstallationStatus, 20000);
      // Also check immediately
      checkInstallationStatus();
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [models]); // Run when models change

  // Helper functions for model formatting and metadata
  const formatModelName = (modelId: string): string => {
    const parts = modelId.split(':');
    const baseName = parts[0];
    const size = parts[1] || '';

    const nameMap: Record<string, string> = {
      'mistral': 'Mistral',
      'llama2': 'Llama 2',
      'llama': 'Llama',
      'llama3.1': 'Llama 3.1',
      'llama3.2': 'Llama 3.2',
      'phi': 'Phi',
      'codellama': 'Code Llama',
      'neural-chat': 'Neural Chat',
      'vicuna': 'Vicuna',
      'deepseek': 'DeepSeek'
    };

    const displayName = nameMap[baseName] || baseName;
    return size ? `${displayName} ${size.toUpperCase()}` : displayName;
  };

  const extractModelSize = (modelId: string): string => {
    const parts = modelId.split(':');
    return parts[1] || 'Unknown';
  };

  const getProviderForModel = (name: string): string => {
    const providers: Record<string, string> = {
      'mistral': 'Mistral AI',
      'llama': 'Meta',
      'llama2': 'Meta',
      'llama3.1': 'Meta',
      'llama3.2': 'Meta',
      'phi': 'Microsoft',
      'codellama': 'Meta',
      'neural-chat': 'Intel',
      'vicuna': 'LMSYS',
      'deepseek': 'DeepSeek'
    };
    return providers[name] || 'Community';
  };

  const getDescriptionForModel = (name: string): string => {
    const descriptions: Record<string, string> = {
      'mistral': 'High-performance language model optimized for efficiency',
      'llama': 'Open-source language model with strong performance',
      'llama2': 'Open-source language model from Meta',
      'llama3.1': 'Advanced language model with strong reasoning capabilities',
      'llama3.2': 'Latest Llama model with improved performance and efficiency',
      'phi': 'Lightweight model for resource-constrained environments',
      'codellama': 'Specialized code generation model',
      'neural-chat': 'Optimized for conversational AI applications',
      'vicuna': 'High-quality chatbot trained by fine-tuning LLaMA',
      'deepseek': 'Open-source language model'
    };
    return descriptions[name] || 'Open-source language model';
  };


  const getIconForModel = (name: string): string => {
    const icons: Record<string, string> = {
      'mistral': '🌪️',
      'llama': '🦙',
      'llama2': '🦙',
      'llama3.1': '🦙',
      'llama3.2': '🦙',
      'phi': '🧠',
      'codellama': '💻',
      'neural-chat': '💬',
      'vicuna': '🦙',
      'deepseek': '🔍'
    };
    return icons[name] || '🤖';
  };

  const installOllama = useCallback(async (): Promise<boolean> => {
    try {
      setOllamaInstallState({ isInstalling: true, progress: 0 });

      // Use the Electron API for Ollama installation
      if (window.electronAPI?.installOllama) {
        const result = await window.electronAPI.installOllama();
        if (result && result.success) {
          setOllamaAvailable(true);
          setOllamaInstallState({ isInstalling: false, progress: 100 });
          return true;
        } else {
          setOllamaInstallState({
            isInstalling: false,
            progress: 0,
            error: result?.message || 'Failed to install Ollama'
          });
          return false;
        }
      } else {
        setOllamaInstallState({
          isInstalling: false,
          progress: 0,
          error: 'Ollama installation not supported on this platform'
        });
        return false;
      }
    } catch (error) {
      console.error('Ollama installation failed:', error);
      setOllamaInstallState({
        isInstalling: false,
        progress: 0,
        error: error instanceof Error ? error.message : 'Installation failed'
      });
      return false;
    }
  }, []);

  const installModel = useCallback(async (modelId: string): Promise<{ needsOllama?: boolean; success?: boolean }> => {
    const model = models.find(m => m.id === modelId);
    if (!model || model.status === 'installed' || (model.requirements && model.requirements.ram > systemInfo.ram)) {
      return { success: false };
    }

    // Check if Ollama is available before starting installation
    if (!ollamaAvailable) {
      return { needsOllama: true, success: false };
    }

    // Start installation
    setModels(prev => prev.map(m =>
      m.id === modelId
        ? { ...m, status: 'installing', progress: 0 }
        : m
    ));

    try {
      // Use the proper Electron API for model installation
      if (window.electronAPI?.installModel) {
        // Set up progress monitoring
        const progressCleanup = window.electronAPI.onModelInstallProgress?.((progress) => {
          if (progress.modelName === modelId) {
            setModels(prev => prev.map(m =>
              m.id === modelId
                ? { ...m, progress: progress.progress }
                : m
            ));
          }
        });

        // Install the model
        console.log(`[DEBUG] Starting installation for ${modelId}`);
        const result = await window.electronAPI.installModel(modelId);
        console.log(`[DEBUG] Installation result for ${modelId}:`, result);

        // Clean up progress listener
        if (progressCleanup) {
          progressCleanup();
        }

        if (result && result.success) {
          console.log(`[DEBUG] Installation successful for ${modelId}, marking as installed`);
          // Mark as installed
          setModels(prev => prev.map(m =>
            m.id === modelId
              ? { ...m, status: 'installed', progress: 100 }
              : m
          ));
          setInstalledModels(prev => new Set([...prev, modelId]));
          return { success: true };
        } else {
          console.log(`[DEBUG] Installation failed for ${modelId}:`, result?.message || 'Unknown error');
          throw new Error(result?.message || 'Installation failed');
        }
      } else {
        // Fallback simulation if API not available
        console.log('Electron API not available, using simulation');
        for (let progress = 0; progress <= 100; progress += 10) {
          await new Promise(resolve => setTimeout(resolve, 500));
          setModels(prev => prev.map(m =>
            m.id === modelId
              ? { ...m, progress }
              : m
          ));
        }

        // Mark as installed
        setModels(prev => prev.map(m =>
          m.id === modelId
            ? { ...m, status: 'installed', progress: 100 }
            : m
        ));
        setInstalledModels(prev => new Set([...prev, modelId]));
        return { success: true };
      }

    } catch (error) {
      console.error('Model installation failed:', error);
      setModels(prev => prev.map(m =>
        m.id === modelId
          ? { ...m, status: 'failed', progress: 0 }
          : m
      ));
      return { success: false };
    }
  }, [models, systemInfo, ollamaAvailable]);

  const configureModel = useCallback(async (modelId: string) => {
    const model = models.find(m => m.id === modelId);
    if (!model || model.status !== 'installed') {
      return;
    }

    try {
      // Use the proper Electron API for model configuration
      if (window.electronAPI?.configureModel) {
        const result = await window.electronAPI.configureModel(modelId);
        if (result.success) {
          console.log(`Configured and activated model: ${modelId}`);
        } else {
          console.error('Failed to configure model:', result.message);
        }
      } else if (window.electronAPI?.updateOpenClawConfig) {
        // Fallback to direct config update using correct OpenClaw format
        await window.electronAPI.updateOpenClawConfig({
          'agents.defaults.model.primary': modelId
        });

        // Restart OpenClaw to apply new model
        if (window.electronAPI?.restartOpenClaw) {
          await window.electronAPI.restartOpenClaw();
        }

        console.log(`Configured and activated model: ${modelId}`);
      } else {
        console.log(`Would configure model: ${modelId} (API not available)`);
      }
    } catch (error) {
      console.error('Failed to configure model:', error);
    }
  }, [models]);

  const canInstallModel = useCallback((model: ModelInfo) => {
    // If no requirements data, allow installation (no artificial restrictions)
    if (!model.requirements) {
      return model.status === 'not_installed';
    }

    // Only check requirements if we have them from the server
    const canInstall = model.status === 'not_installed' &&
           model.requirements.ram <= systemInfo.ram &&
           model.requirements.disk <= systemInfo.disk;

    // Debug logging for any issues
    if (!canInstall && model.status === 'not_installed' && model.requirements) {
      console.log(`[DEBUG canInstallModel] FAILED ${model.id}:`, {
        status: model.status,
        modelRam: model.requirements.ram,
        systemRam: systemInfo.ram,
        ramCheck: model.requirements.ram <= systemInfo.ram,
        modelDisk: model.requirements.disk,
        systemDisk: systemInfo.disk,
        diskCheck: model.requirements.disk <= systemInfo.disk,
        finalCanInstall: canInstall,
        modelName: model.name
      });
    }

    return canInstall;
  }, [systemInfo]);

  return {
    models,
    systemInfo,
    installModel,
    configureModel,
    canInstallModel,
    ollamaAvailable,
    ollamaInstallState,
    installOllama
  };
};