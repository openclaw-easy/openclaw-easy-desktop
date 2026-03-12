import { useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Progress } from "../ui/progress";
import { ScrollArea } from "../ui/scroll-area";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Cpu,
  Download,
  FolderOpen,
  Play,
  Search,
  Star,
  Trash2,
} from "lucide-react";

interface ModelInfo {
  name: string;
  tag: string;
  size: string;
  modified: string;
  digest?: string;
  status: "available" | "downloading" | "installed" | "error";
  downloadProgress?: number;
}

interface ModelDownloadProgress {
  modelName: string;
  progress: number;
  status: string;
  total?: number;
  completed?: number;
}

interface StorageInfo {
  totalSize: string;
  modelCount: number;
}

interface AvailableModel {
  id: string;
  name: string;
  size: string;
  description: string;
  category: string;
  recommended?: boolean;
}

interface ColorTheme {
  bg: {
    primary: string;
    secondary: string;
    tertiary: string;
    hover: string;
  };
  text: {
    header: string;
    normal: string;
    muted: string;
  };
  accent: {
    brand: string;
    green: string;
    yellow: string;
    red: string;
    purple: string;
  };
}

interface LocalModelManagerProps {
  colors: ColorTheme;
}

export function LocalModelManager({ colors }: LocalModelManagerProps) {
  const { t } = useTranslation();
  const [installedModels, setInstalledModels] = useState<ModelInfo[]>([]);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [isOllamaAvailable, setIsOllamaAvailable] = useState<boolean | null>(
    null,
  );
  const [downloadProgress, setDownloadProgress] = useState<
    Map<string, ModelDownloadProgress>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [showOnlyRecommended, setShowOnlyRecommended] = useState(false);
  const [systemSpecs, setSystemSpecs] = useState<{
    memory: number;
    cpu: string;
  } | null>(null);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);
  const [modelStats, setModelStats] = useState<
    Map<
      string,
      { lastUsed?: string; usageCount?: number; avgResponseTime?: number }
    >
  >(new Map());

  useEffect(() => {
    loadData(true); // Force initial load
    checkOllamaStatus();
    loadActiveModel();
    loadSystemSpecs();
    loadModelStats();

    // Set up progress listener
    const unsubscribe = window.electronAPI.onModelInstallProgress(
      (progress: ModelDownloadProgress) => {
        setDownloadProgress(
          (prev) => new Map(prev.set(progress.modelName, progress)),
        );
      },
    );

    // Set up Ollama installed listener
    const unsubscribeOllama = window.electronAPI.onOllamaInstalled(() => {
      console.log(
        "[ModelManager] Ollama installation detected, refreshing UI...",
      );
      checkOllamaStatus();
      loadData(true);
    });

    // Set up Ollama status change listener for continuous detection
    const unsubscribeOllamaStatus =
      window.electronAPI.onOllamaStatusChanged?.(() => {
        console.log(
          "[ModelManager] Ollama status changed detected, refreshing UI...",
        );
        checkOllamaStatus();
        loadData(true);
      }) || (() => {});

    // Start continuous Ollama detection when component mounts
    // This will check if Ollama is available and try to start it automatically
    const startDetectionAlways = async () => {
      console.log(
        "[ModelManager Frontend] Starting Ollama detection and auto-startup...",
      );
      await window.electronAPI.startOllamaDetection();
    };

    startDetectionAlways();

    return () => {
      // Stop Ollama detection when component unmounts
      console.log("[ModelManager Frontend] Stopping Ollama detection...");
      window.electronAPI.stopOllamaDetection();
      unsubscribe();
      unsubscribeOllama();
      unsubscribeOllamaStatus();
    };
  }, []); // Run only once on mount

  // Merge available models with installed models that aren't in the available list
  const allModels = useMemo(() => {
    const models = [...availableModels];

    // Add installed models that don't have a corresponding entry in available models
    installedModels.forEach(installed => {
      const installedId = `${installed.name}:${installed.tag}`;

      // Check if this installed model is already represented in available models
      const isRepresented = models.some(available => {
        // Check exact match
        if (available.id === installedId || available.id === installed.name) {
          return true;
        }
        // Check if installed is a variant of available (e.g., minimax-m2 is variant of minimax)
        const baseName = available.id.split(':')[0];
        if (installed.name.startsWith(baseName + '-') || installed.name.startsWith(baseName + '.')) {
          return true;
        }
        return false;
      });

      // If not represented, add it as a new entry
      if (!isRepresented) {
        models.push({
          id: installedId,
          name: installedId, // Use raw format: name:tag
          description: `Installed local model`,
          size: installed.size,
          category: 'general',
          recommended: false
        });
      }
    });

    return models;
  }, [availableModels, installedModels]);

  const loadActiveModel = async () => {
    try {
      // Try to read the current active model from config
      // For now, we'll just check localStorage or a default
      const savedModel = localStorage.getItem("activeModel");
      if (savedModel) {
        setActiveModel(savedModel);
      }
    } catch (error) {
      console.error("Error loading active model:", error);
    }
  };

  const loadSystemSpecs = async () => {
    try {
      const info = await window.electronAPI.getSystemInfo();
      if (info) {
        setSystemSpecs({
          memory: info.ram || 8,
          cpu: info.cpu || "Unknown",
        });
      }
    } catch (error) {
      console.error("Error loading system specs:", error);
    }
  };

  // Get recommended models based on system specs
  const getRecommendedModels = () => {
    if (!systemSpecs) {return [];}

    const memoryGB = Math.floor(systemSpecs.memory); // Already in GB from backend
    const recommendations = [];

    if (memoryGB >= 32) {
      recommendations.push(
        "Advanced models (8x7B, 70B) - Your system can handle large models",
      );
    } else if (memoryGB >= 16) {
      recommendations.push(
        "Medium models (13B) - Good balance of quality and performance",
      );
    } else if (memoryGB >= 8) {
      recommendations.push("Small models (7B) - Recommended for your system");
    } else {
      recommendations.push(
        "Lightweight models (2B-3B) - Best for limited resources",
      );
    }

    return recommendations;
  };

  const loadModelStats = async () => {
    try {
      // Load usage stats from localStorage for now
      // In a real app, this would come from a backend API
      const savedStats = localStorage.getItem("modelUsageStats");
      if (savedStats) {
        const parsedStats = JSON.parse(savedStats);
        setModelStats(new Map(Object.entries(parsedStats)));
      }
    } catch (error) {
      console.error("Error loading model stats:", error);
    }
  };

  const updateModelStats = (modelId: string) => {
    const currentStats = modelStats.get(modelId) || {};
    const newStats = {
      ...currentStats,
      lastUsed: new Date().toISOString(),
      usageCount: (currentStats.usageCount || 0) + 1,
      avgResponseTime: Math.round(Math.random() * 2000 + 500), // Mock data for demo
    };

    const updatedStats = new Map(modelStats);
    updatedStats.set(modelId, newStats);
    setModelStats(updatedStats);

    // Save to localStorage
    const statsObject = Object.fromEntries(updatedStats);
    localStorage.setItem("modelUsageStats", JSON.stringify(statsObject));
  };

  const formatLastUsed = (lastUsed?: string) => {
    if (!lastUsed) {return "Never";}
    const date = new Date(lastUsed);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 60) {return `${diffMins}m ago`;}
    if (diffHours < 24) {return `${diffHours}h ago`;}
    return `${diffDays}d ago`;
  };

  const [lastRefresh, setLastRefresh] = useState<number>(0);

  const loadData = async (force = false) => {
    // Throttle requests - don't refresh more than once per 5 seconds unless forced
    const now = Date.now();
    if (!force && now - lastRefresh < 5000) {
      return;
    }

    setLoading(true);
    try {
      console.log("[ModelManager Frontend] Loading data...");
      const [installed, available, storage] = await Promise.all([
        window.electronAPI.getInstalledModels(),
        window.electronAPI.getAvailableModels(),
        window.electronAPI.getStorageInfo(),
      ]);

      console.log(
        "[ModelManager Frontend] Raw API response - installed:",
        installed,
      );
      console.log(
        "[ModelManager Frontend] Raw API response - available:",
        available,
      );
      console.log(
        "[ModelManager Frontend] Raw API response - storage:",
        storage,
      );

      console.log("[ModelManager Frontend] Loaded data:", {
        installed,
        available,
        storage,
      });
      setInstalledModels(installed as ModelInfo[]);
      setAvailableModels(available as AvailableModel[]);
      setStorageInfo(storage);
      setLastRefresh(now);
    } catch (error) {
      console.error("Error loading model data:", error);
    }
    setLoading(false);
  };

  const checkOllamaStatus = async () => {
    try {
      const available = await window.electronAPI.checkOllamaAvailable();
      setIsOllamaAvailable(available);
    } catch (error) {
      console.error("Error checking Ollama status:", error);
      setIsOllamaAvailable(false);
    }
  };

  const handleInstallOllama = async () => {
    try {
      const result = await window.electronAPI.installOllama();
      if (result.success) {
        alert(result.message);
        await checkOllamaStatus();
      } else {
        alert(`Failed to install Ollama: ${result.message}`);
      }
    } catch (error) {
      console.error("Error installing Ollama:", error);
      alert("Failed to install Ollama");
    }
  };

  const handleInstallModel = async (modelId: string) => {
    try {
      setDownloadProgress(
        (prev) =>
          new Map(
            prev.set(modelId, {
              modelName: modelId,
              progress: 0,
              status: "Starting download...",
            }),
          ),
      );

      const result = await window.electronAPI.installModel(modelId);

      if (result.success) {
        await loadData(true); // Force refresh after successful install
        setDownloadProgress((prev) => {
          const newMap = new Map(prev);
          newMap.delete(modelId);
          return newMap;
        });
      } else {
        alert(`Failed to install model: ${result.message}`);
        setDownloadProgress((prev) => {
          const newMap = new Map(prev);
          newMap.delete(modelId);
          return newMap;
        });
      }
    } catch (error) {
      console.error("Error installing model:", error);
      alert("Failed to install model");
      setDownloadProgress((prev) => {
        const newMap = new Map(prev);
        newMap.delete(modelId);
        return newMap;
      });
    }
  };

  const handleRemoveModel = async (modelId: string) => {
    if (
      !confirm(
        `Are you sure you want to remove ${modelId}? This will delete the model files from your disk and cannot be undone.`,
      )
    ) {
      return;
    }

    try {
      const result = await window.electronAPI.removeModel(modelId);
      if (result.success) {
        await loadData(true); // Force refresh after successful install
      } else {
        alert(`Failed to remove model: ${result.message}`);
      }
    } catch (error) {
      console.error("Error removing model:", error);
      alert("Failed to remove model");
    }
  };

  const handleOpenModelFolder = async () => {
    try {
      await window.electronAPI.openModelFolder();
    } catch (error) {
      console.error("Error opening model folder:", error);
      alert("Failed to open model folder");
    }
  };

  const [configuringModel, setConfiguringModel] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<string | null>(null);

  const handleBulkInstall = async () => {
    const modelsToInstall = Array.from(selectedModels).filter(
      (id) => !isModelInstalled(id),
    );
    if (modelsToInstall.length === 0) {
      alert("No uninstalled models selected.");
      return;
    }

    if (
      !confirm(
        `Install ${modelsToInstall.length} model${modelsToInstall.length !== 1 ? "s" : ""}?`,
      )
    ) {
      return;
    }

    for (const modelId of modelsToInstall) {
      try {
        await handleInstallModel(modelId);
      } catch (error) {
        console.error(`Failed to install ${modelId}:`, error);
      }
    }
    setSelectedModels(new Set());
  };

  const handleBulkDelete = async () => {
    const modelsToDelete = Array.from(selectedModels).filter((id) =>
      isModelInstalled(id),
    );
    if (modelsToDelete.length === 0) {
      alert("No installed models selected.");
      return;
    }

    if (
      !confirm(
        `Delete ${modelsToDelete.length} model${modelsToDelete.length !== 1 ? "s" : ""}? This will remove the model files from your disk and cannot be undone.`,
      )
    ) {
      return;
    }

    for (const modelId of modelsToDelete) {
      try {
        await handleRemoveModel(modelId);
      } catch (error) {
        console.error(`Failed to delete ${modelId}:`, error);
      }
    }
    setSelectedModels(new Set());
  };

  const handleUseModel = async (modelId: string) => {
    setConfiguringModel(modelId);
    try {
      const result = await window.electronAPI.configureModel(modelId);
      if (result.success) {
        setActiveModel(modelId);
        localStorage.setItem("activeModel", modelId);
        updateModelStats(modelId);
        alert(
          `✅ Success!\n\n${modelId} is now your default AI model.\n\nAll agents will use this model unless configured otherwise.`,
        );
      } else {
        alert(`❌ Failed to set default model\n\n${result.message}`);
      }
    } catch (error) {
      console.error("Error setting default model:", error);
      alert(
        "❌ Failed to set default model\n\nPlease ensure OpenClaw is installed and running.",
      );
    } finally {
      setConfiguringModel(null);
    }
  };

  const isModelInstalled = (modelId: string) => {
    // Parse the model ID
    const [name, requestedTag] = modelId.split(":");
    const tag = requestedTag || "latest"; // Default to 'latest' if no tag specified

    // Check if the model is installed
    return installedModels.some((m) => {
      // Direct match
      if (m.name === name && m.tag === tag) {
        return true;
      }

      // Check if installed model is a variant of the requested model
      // For example, "minimax" should match "minimax-m2" or "minimax-m2.1"
      if (m.name.startsWith(name + '-') || m.name.startsWith(name + '.')) {
        return true;
      }

      // Check if model name matches and tags are compatible
      if (m.name === name) {
        // If tags match exactly
        if (m.tag === tag) {
          return true;
        }

        // If requested model has no tag and installed has 'latest'
        if (!requestedTag && m.tag === "latest") {
          return true;
        }

        // If requested is 'latest' and installed has no tag or is 'latest'
        if (tag === "latest" && (m.tag === "latest" || !m.tag)) {
          return true;
        }
      }

      return false;
    });
  };

  // Helper function to estimate download time based on size
  const getEstimatedDownloadTime = (sizeStr: string): string => {
    const sizeMatch = sizeStr.match(/([\d.]+)\s*(GB|MB)/i);
    if (!sizeMatch) {return "";}

    const size = parseFloat(sizeMatch[1]);
    const unit = sizeMatch[2].toUpperCase();

    // Convert to MB
    const sizeInMB = unit === "GB" ? size * 1024 : size;

    // Assume average download speed of 10 Mbps (1.25 MB/s)
    const downloadSpeedMBps = 1.25;
    const seconds = sizeInMB / downloadSpeedMBps;

    if (seconds < 60) {
      return `${Math.round(seconds)}s`;
    } else if (seconds < 3600) {
      return `${Math.round(seconds / 60)} min`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.round((seconds % 3600) / 60);
      return minutes > 0 ? `${hours}h ${minutes}min` : `${hours}h`;
    }
  };

  if (loading) {
    return (
      <Card
        className="border-0 shadow-none"
        style={{
          backgroundColor: colors.bg.secondary,
        }}
      >
        <CardHeader>
          <CardTitle style={{ color: colors.text.header }}>
            {t('models.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div
              className="animate-spin rounded-full h-8 w-8 border-b-2"
              style={{ borderBottomColor: colors.accent.brand }}
            ></div>
            <span className="ml-2" style={{ color: colors.text.normal }}>
              {t('common.loading')}
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isOllamaAvailable === false) {
    return (
      <Card
        className="border-0 shadow-none"
        style={{
          backgroundColor: colors.bg.secondary,
        }}
      >
        <CardHeader>
          <CardTitle
            className="flex items-center space-x-2"
            style={{ color: colors.text.header }}
          >
            <AlertCircle
              className="h-5 w-5"
              style={{ color: colors.accent.yellow }}
            />
            <span>{t('ollama.required')}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p style={{ color: colors.text.muted }}>
            Ollama is required to manage and run local AI models. Install Ollama
            to get started with offline AI capabilities.
          </p>

          <div className="p-4 rounded-lg" style={{ backgroundColor: colors.bg.tertiary, borderLeft: `3px solid ${colors.accent.brand}` }}>
            <h4 className="font-semibold mb-2" style={{ color: colors.text.header }}>
              Benefits of Local Models:
            </h4>
            <ul className="list-disc list-inside mt-2 text-sm space-y-1" style={{ color: colors.text.muted }}>
              <li>Complete privacy - data never leaves your machine</li>
              <li>No internet connection required</li>
              <li>No usage limits or costs</li>
              <li>Fast responses once models are downloaded</li>
            </ul>
          </div>

          <Button
            onClick={handleInstallOllama}
            className="w-full"
            style={{ backgroundColor: colors.accent.brand, color: '#ffffff', border: 'none' }}
          >
            {t('ollama.installOllama')}
          </Button>

          <p className="text-xs text-center" style={{ color: colors.text.muted }}>
            Or install manually from{" "}
            <a
              href="#"
              onClick={() =>
                window.electronAPI.openExternal("https://ollama.ai")
              }
              style={{ color: colors.accent.brand }}
              className="hover:underline"
            >
              ollama.ai
            </a>
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* System Recommendations */}
      {systemSpecs && (
        <Card
          className="border-0 shadow-none"
          style={{
            backgroundColor: colors.bg.secondary,
          }}
        >
          <CardHeader>
            <CardTitle
              className="flex items-center space-x-2"
              style={{ color: colors.text.header }}
            >
              <Cpu
                className="h-5 w-5"
                style={{ color: colors.accent.purple }}
              />
              <span>{t('models.systemRecommendations', 'System Recommendations')}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {getRecommendedModels().map((rec, idx) => (
                <div key={idx} className="flex items-center space-x-2">
                  <Star
                    className="h-4 w-4 flex-shrink-0"
                    style={{ color: colors.accent.yellow }}
                  />
                  <p className="text-sm">
                    <span style={{ color: colors.text.muted }}>Based on your system ({Math.floor(systemSpecs.memory)} GB RAM):</span>
                    {' '}
                    <span style={{ color: colors.text.normal }}>{rec}</span>
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* All Models */}
      <Card
        className="border-0 shadow-none"
        style={{
          backgroundColor: colors.bg.secondary,
        }}
      >
        <CardHeader>
          <CardTitle
            className="flex items-center justify-between"
            style={{ color: colors.text.header }}
          >
            <span>{t('models.title')}</span>
            <div className="flex items-center space-x-2">
              <Button
                size="sm"
                onClick={handleOpenModelFolder}
                title="Open models folder in Finder"
                style={{ backgroundColor: colors.bg.tertiary, color: colors.text.normal, border: `1px solid ${colors.bg.hover}` }}
              >
                <FolderOpen className="h-4 w-4 mr-1" />
                {t('models.openFolder', 'Open Folder')}
              </Button>
              <Button
                size="sm"
                onClick={() => setShowOnlyRecommended(!showOnlyRecommended)}
                title="Show only recommended models"
                style={{
                  backgroundColor: showOnlyRecommended ? colors.accent.yellow + '33' : colors.bg.tertiary,
                  color: showOnlyRecommended ? colors.accent.yellow : colors.text.muted,
                  border: `1px solid ${showOnlyRecommended ? colors.accent.yellow + '66' : colors.bg.hover}`
                }}
              >
                <Star className={`h-4 w-4 ${showOnlyRecommended ? "fill-current" : ""}`} />
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setBulkMode(!bulkMode);
                  setSelectedModels(new Set());
                }}
                title="Enable bulk operations"
                style={{
                  backgroundColor: bulkMode ? colors.accent.brand : colors.bg.tertiary,
                  color: bulkMode ? '#ffffff' : colors.text.normal,
                  border: `1px solid ${bulkMode ? colors.accent.brand : colors.bg.hover}`
                }}
              >
                {bulkMode ? t('models.exitBulk', 'Exit Bulk') : t('models.bulkMode', 'Bulk Mode')}
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Bulk Operations Bar */}
          {bulkMode && (
            <div className="p-3 rounded-lg" style={{ backgroundColor: colors.bg.tertiary }}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium" style={{ color: colors.text.header }}>
                  {selectedModels.size} model
                  {selectedModels.size !== 1 ? "s" : ""} selected
                </span>
                <div className="flex items-center space-x-2">
                  {selectedModels.size > 0 && (
                    <>
                      <Button
                        size="sm"
                        onClick={() => handleBulkInstall()}
                        disabled={Array.from(selectedModels).every((id) =>
                          isModelInstalled(id),
                        )}
                        style={{ backgroundColor: colors.accent.brand, color: '#ffffff', border: 'none' }}
                      >
                        {t('models.installSelected', 'Install Selected')}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleBulkDelete()}
                        disabled={Array.from(selectedModels).every(
                          (id) => !isModelInstalled(id),
                        )}
                        style={{ backgroundColor: colors.accent.red, color: '#ffffff', border: 'none' }}
                      >
                        {t('models.deleteSelected', 'Delete Selected')}
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    onClick={() => {
                      const allVisibleModels = allModels
                        .filter((model) => {
                          if (
                            searchQuery &&
                            !model.name
                              .toLowerCase()
                              .includes(searchQuery.toLowerCase()) &&
                            !model.description
                              .toLowerCase()
                              .includes(searchQuery.toLowerCase())
                          ) {
                            return false;
                          }
                          if (
                            selectedCategory !== "all" &&
                            model.category !== selectedCategory
                          ) {
                            return false;
                          }
                          if (showOnlyRecommended && !model.recommended) {
                            return false;
                          }
                          return true;
                        })
                        .map((model) => model.id);
                      setSelectedModels(new Set(allVisibleModels));
                    }}
                    style={{ backgroundColor: colors.bg.primary, color: colors.text.normal, border: `1px solid ${colors.bg.hover}` }}
                  >
                    {t('models.selectAllVisible', 'Select All Visible')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setSelectedModels(new Set())}
                    style={{ backgroundColor: colors.bg.primary, color: colors.text.normal, border: `1px solid ${colors.bg.hover}` }}
                  >
                    {t('models.clearSelection', 'Clear Selection')}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Search and Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 relative">
              <Search
                className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4"
                style={{ color: colors.text.muted }}
              />
              <input
                type="text"
                placeholder={t('models.searchModels', 'Search models...')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                style={{
                  backgroundColor: colors.bg.tertiary,
                  borderColor: colors.bg.tertiary,
                  color: colors.text.normal,
                }}
              />
            </div>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              style={{
                backgroundColor: colors.bg.tertiary,
                borderColor: colors.bg.tertiary,
                color: colors.text.normal,
              }}
            >
              <option
                value="all"
                style={{
                  backgroundColor: colors.bg.tertiary,
                  color: colors.text.normal,
                }}
              >
                All Categories
              </option>
              <option
                value="general"
                style={{
                  backgroundColor: colors.bg.tertiary,
                  color: colors.text.normal,
                }}
              >
                General Purpose
              </option>
              <option
                value="coding"
                style={{
                  backgroundColor: colors.bg.tertiary,
                  color: colors.text.normal,
                }}
              >
                Coding
              </option>
              <option
                value="chat"
                style={{
                  backgroundColor: colors.bg.tertiary,
                  color: colors.text.normal,
                }}
              >
                Chat
              </option>
              <option
                value="lightweight"
                style={{
                  backgroundColor: colors.bg.tertiary,
                  color: colors.text.normal,
                }}
              >
                Lightweight
              </option>
              <option
                value="advanced"
                style={{
                  backgroundColor: colors.bg.tertiary,
                  color: colors.text.normal,
                }}
              >
                Advanced
              </option>
            </select>
          </div>
          <ScrollArea className="h-[600px] xl:h-[700px]">
            <div className="space-y-3">
              {allModels
                .filter((model) => {
                  // Filter by search query
                  if (
                    searchQuery &&
                    !model.name
                      .toLowerCase()
                      .includes(searchQuery.toLowerCase()) &&
                    !model.description
                      .toLowerCase()
                      .includes(searchQuery.toLowerCase())
                  ) {
                    return false;
                  }
                  // Filter by category
                  if (
                    selectedCategory !== "all" &&
                    model.category !== selectedCategory
                  ) {
                    return false;
                  }
                  // Filter by recommended
                  if (showOnlyRecommended && !model.recommended) {
                    return false;
                  }
                  return true;
                })
                .toSorted((a, b) => {
                  // Sort installed models first
                  const aInstalled = isModelInstalled(a.id);
                  const bInstalled = isModelInstalled(b.id);
                  if (aInstalled && !bInstalled) {return -1;}
                  if (!aInstalled && bInstalled) {return 1;}
                  // Within each group, sort by recommended status, then name
                  if (a.recommended && !b.recommended) {return -1;}
                  if (!a.recommended && b.recommended) {return 1;}
                  return a.name.localeCompare(b.name);
                })
                .map((model) => {
                  const isInstalled = isModelInstalled(model.id);
                  const progress = downloadProgress.get(model.id);
                  const isDownloading = !!progress;
                  const estimatedTime = model.size
                    ? getEstimatedDownloadTime(model.size)
                    : "";

                  return (
                    <div
                      key={model.id}
                      className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-lg"
                      style={{
                        backgroundColor: isInstalled ? colors.accent.green + '11' : colors.bg.primary,
                      }}
                    >
                      {bulkMode && (
                        <div className="absolute top-2 left-2">
                          <input
                            type="checkbox"
                            checked={selectedModels.has(model.id)}
                            onChange={(e) => {
                              const newSelected = new Set(selectedModels);
                              if (e.target.checked) {
                                newSelected.add(model.id);
                              } else {
                                newSelected.delete(model.id);
                              }
                              setSelectedModels(newSelected);
                            }}
                            className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                          />
                        </div>
                      )}
                      <div
                        className={`flex items-start space-x-3 flex-1 mb-3 sm:mb-0 ${bulkMode ? "ml-6" : ""}`}
                      >
                        <div className="mt-1">
                          {isInstalled ? (
                            <CheckCircle className="h-5 w-5" style={{ color: colors.accent.green }} />
                          ) : isDownloading ? (
                            <Download className="h-5 w-5 animate-pulse" style={{ color: colors.accent.brand }} />
                          ) : model.recommended ? (
                            <Star className="h-5 w-5 fill-current" style={{ color: colors.accent.yellow }} />
                          ) : (
                            <Cpu className="h-5 w-5" style={{ color: colors.text.muted }} />
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p
                              className="font-medium"
                              style={{ color: colors.text.header }}
                            >
                              {model.id.includes(':') ? model.id : `${model.id}:latest`}
                            </p>
                            {isInstalled && (
                              <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: colors.accent.green + '22', color: colors.accent.green }}>
                                {t('models.installed', 'Installed')}
                              </span>
                            )}
                            {model.recommended && !isInstalled && (
                              <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: colors.accent.brand + '22', color: colors.accent.brand }}>
                                {t('models.recommended', 'Recommended')}
                              </span>
                            )}
                            <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: colors.bg.tertiary, color: colors.text.muted }}>
                              {model.size}
                            </span>
                          </div>
                          <p
                            className="text-sm mt-1"
                            style={{ color: colors.text.normal }}
                          >
                            {model.description}
                          </p>

                          {/* Performance Metrics */}
                          {isInstalled && modelStats.has(model.id) && (
                            <div
                              className="mt-2 flex flex-wrap gap-3 text-xs"
                              style={{ color: colors.text.muted }}
                            >
                              <span className="flex items-center">
                                <Clock className="h-3 w-3 mr-1" />
                                Used:{" "}
                                {formatLastUsed(
                                  modelStats.get(model.id)?.lastUsed,
                                )}
                              </span>
                              <span>
                                Count:{" "}
                                {modelStats.get(model.id)?.usageCount || 0}
                              </span>
                              {modelStats.get(model.id)?.avgResponseTime && (
                                <span>
                                  Avg:{" "}
                                  {modelStats.get(model.id)?.avgResponseTime}ms
                                </span>
                              )}
                            </div>
                          )}

                          {!isInstalled && !isDownloading && estimatedTime && (
                            <p className="text-xs mt-1 flex items-center" style={{ color: colors.text.muted }}>
                              <Clock className="h-3 w-3 mr-1" />
                              Estimated: {estimatedTime}
                            </p>
                          )}
                          {isDownloading && (
                            <div className="mt-2 space-y-1">
                              <div className="flex justify-between text-xs" style={{ color: colors.text.muted }}>
                                <span>{progress.status}</span>
                                <span>{progress.progress}%</span>
                              </div>
                              <Progress
                                value={progress.progress}
                                className="h-2"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center space-x-2 mt-3 sm:mt-0">
                        {isInstalled ? (
                          <>
                            {activeModel === model.id ? (
                              <Button
                                size="sm"
                                disabled={true}
                                style={{ backgroundColor: colors.accent.brand + '33', color: colors.accent.brand, border: `1px solid ${colors.accent.brand}55` }}
                              >
                                <Play className="h-4 w-4 mr-1" />
                                {t('models.active', 'Active')}
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                onClick={() => handleUseModel(model.id)}
                                disabled={configuringModel === model.id}
                                style={{ backgroundColor: colors.accent.brand, color: '#ffffff', border: 'none' }}
                              >
                                <Play
                                  className={`h-4 w-4 mr-1 ${configuringModel === model.id ? "animate-spin" : ""}`}
                                />
                                {configuringModel === model.id
                                  ? t('models.setting', 'Setting...')
                                  : t('models.setAsDefault', 'Set as Default Model')}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              onClick={() => handleRemoveModel(model.id)}
                              style={{ backgroundColor: colors.accent.red, color: '#ffffff', border: 'none' }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => handleInstallModel(model.id)}
                            disabled={isDownloading}
                            style={{
                              backgroundColor: isDownloading ? colors.bg.tertiary : colors.accent.brand,
                              color: isDownloading ? colors.text.muted : '#ffffff',
                              border: 'none'
                            }}
                          >
                            <Download
                              className={`h-4 w-4 mr-1 ${isDownloading ? "animate-pulse" : ""}`}
                            />
                            {isDownloading
                              ? `${progress?.progress}%`
                              : t('models.downloadInstall', 'Download & Install')}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}