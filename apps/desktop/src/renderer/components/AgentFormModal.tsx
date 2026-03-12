import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { BYOK_PROVIDER_MODELS, byokAgentModelId, defaultByokAgentModelId } from "../../shared/providerModels";

interface ModelInfo {
  name: string;
  tag: string;
  size: string;
  modified: string;
  digest?: string;
  status: "available" | "downloading" | "installed" | "error";
}

interface AgentFormData {
  name: string;
  model: string;
  fallbacks: string[];
}

interface Agent {
  id: string;
  name: string;
  status: string;
  model: string;
  fallbacks?: string[];
}

interface AgentFormModalProps {
  isOpen: boolean;
  mode: "create" | "configure";
  agent?: Agent | null;
  onClose: () => void;
  onSuccess: () => void;
  localModels: ModelInfo[];
  loadingModels: boolean;
  onNavigateToLocalModels?: () => void;
}

// Agent model IDs use the format "{provider}/{model}" which the gateway routes accordingly.
// Derived from the shared providerModels.ts — single source of truth.

function getCloudModelsForProvider(byokProvider: string): string[] {
  const cfg = BYOK_PROVIDER_MODELS[byokProvider] ?? BYOK_PROVIDER_MODELS.anthropic;
  return cfg.models.map(m => byokAgentModelId(byokProvider, m.id));
}

function getDefaultByokModel(byokProvider: string): string {
  return defaultByokAgentModelId(byokProvider);
}

export const AgentFormModal: React.FC<AgentFormModalProps> = ({
  isOpen,
  mode,
  agent,
  onClose,
  onSuccess,
  localModels,
  loadingModels,
  onNavigateToLocalModels,
}) => {
  const { t } = useTranslation();
  const [formData, setFormData] = useState<AgentFormData>({
    name: "",
    model: "anthropic/claude-sonnet-4-6",
    fallbacks: [],
  });
  const [fallbackModels, setFallbackModels] = useState<string[]>([]);
  const [showFallbackConfig, setShowFallbackConfig] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeProvider, setActiveProvider] = useState<"byok" | "local">("byok");
  const [byokProvider, setByokProvider] = useState<string>("anthropic");
  const [newFallbackModelState, setNewFallbackModelState] = useState("");

  // Load provider config and initialize form data whenever the modal opens
  useEffect(() => {
    if (!isOpen) return;

    window.electronAPI.getConfig().then((config: any) => {
      const provider: "byok" | "local" = (config?.aiProvider === "byok" || config?.aiProvider === "local") ? config.aiProvider : "byok";
      const bProvider: string = config?.byok?.provider ?? "anthropic";
      setActiveProvider(provider);
      setByokProvider(bProvider);

      if (mode === "create") {
        let defaultModel: string;
        if (provider === "local") {
          defaultModel =
            localModels.length > 0
              ? `ollama/${localModels[0].name}:${localModels[0].tag}`
              : "";
        } else {
          defaultModel = getDefaultByokModel(bProvider);
        }
        setFormData({ name: "", model: defaultModel, fallbacks: [] });
        setFallbackModels([]);
        setShowFallbackConfig(false);
      } else if (mode === "configure" && agent) {
        setFormData({
          name: agent.name,
          model: agent.model || getDefaultByokModel(bProvider),
          fallbacks: agent.fallbacks || [],
        });
        setFallbackModels(agent.fallbacks || []);
        setShowFallbackConfig(false);
      }
    }).catch(() => {
      // Config load failed — fall back to safe defaults
      if (mode === "create") {
        setFormData({ name: "", model: "anthropic/claude-sonnet-4-6", fallbacks: [] });
        setFallbackModels([]);
      } else if (mode === "configure" && agent) {
        setFormData({
          name: agent.name,
          model: agent.model || "anthropic/claude-sonnet-4-6",
          fallbacks: agent.fallbacks || [],
        });
        setFallbackModels(agent.fallbacks || []);
      }
      setShowFallbackConfig(false);
    });
  }, [mode, agent, isOpen]);

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      alert(t('agentForm.pleaseEnterName'));
      return;
    }

    try {
      setLoading(true);

      // If a local model is selected, configure it first
      if (formData.model.startsWith("ollama/")) {
        console.log("Configuring local model:", formData.model);
        if (window.electronAPI.configureModel) {
          const configResult = await window.electronAPI.configureModel(formData.model);
          if (!configResult.success) {
            alert(t('agentForm.failedToConfigure', { message: configResult.message }));
            return;
          }
          console.log("Model configured successfully:", configResult.message);
        }
      }

      let result;
      if (mode === "create") {
        result = await window.electronAPI.createAgent(formData.name, {
          model: formData.model,
          fallbacks: fallbackModels,
        });
      } else {
        result = await window.electronAPI.updateAgent(agent!.id, {
          model: formData.model,
          fallbacks: fallbackModels,
        });
      }

      if (result.success) {
        if (formData.model.startsWith("ollama/")) {
          const key = mode === "create" ? 'agentForm.agentCreatedLocal' : 'agentForm.agentUpdatedLocal';
          alert(t(key, { name: formData.name, model: formData.model }));
        }
        onSuccess();
        onClose();
      } else {
        const key = mode === "create" ? 'agentForm.failedToCreateAgent' : 'agentForm.failedToUpdateAgent';
        alert(t(key, { error: result.error }));
      }
    } catch (error) {
      console.error(`Failed to ${mode} agent:`, error);
      alert(t(mode === "create" ? 'agentForm.failedToCreate' : 'agentForm.failedToUpdate'));
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const filteredCloudModels = getCloudModelsForProvider(byokProvider);
  const isByokCloudModel =
    formData.model.startsWith("anthropic/") ||
      formData.model.startsWith("openai/") ||
      formData.model.startsWith("google/");

  const providerLabel: Record<string, string> = {
    google:     "Google",
    anthropic:  "Anthropic",
    openai:     "OpenAI",
    venice:     "Venice AI",
    openrouter: "OpenRouter",
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 text-white p-6 rounded-lg max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <h3 className="text-xl font-bold mb-4">
          {mode === "create" ? t('agentForm.createNewAgent') : t('agentForm.configureAgent', { name: agent?.name })}
        </h3>

        <div className="space-y-4">
          {/* Agent Name */}
          <div>
            <label className="block text-sm font-medium mb-2">{t('agentForm.agentName')}</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t('agentForm.agentNamePlaceholder')}
              disabled={mode === "configure"}
            />
            {mode === "configure" && (
              <p className="text-xs text-gray-400 mt-1">
                {t('agentForm.agentNameCannotChange')}
              </p>
            )}
          </div>

          {/* Model Selection */}
          <div>
            <label className="block text-sm font-medium mb-2">{t('agentForm.model')}</label>

            {/* Local provider with no models */}
            {activeProvider === "local" && localModels.length === 0 && !loadingModels ? (
              <div className="p-3 bg-yellow-900/20 border border-yellow-700 rounded-md text-sm text-yellow-200">
                🏠 <span className="font-semibold">{t('agentForm.noLocalModels')}</span>{" "}
                {t('agentForm.goToModelManager')}{" "}
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onNavigateToLocalModels?.();
                  }}
                  className="font-semibold underline hover:text-yellow-100 transition-colors"
                >
                  {t('agentForm.modelManager')}
                </button>{" "}
                {t('agentForm.toDownloadOllama')}
              </div>
            ) : (
              <select
                value={formData.model}
                onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={loadingModels}
              >
                {/* Local provider */}
                {activeProvider === "local" && (
                  <optgroup label={`🏠 ${t('agentForm.localModelsGroup')}`}>
                    {localModels.map((model) => {
                      const modelId = `ollama/${model.name}:${model.tag}`;
                      return (
                        <option key={modelId} value={modelId}>
                          {model.name}:{model.tag}
                        </option>
                      );
                    })}
                  </optgroup>
                )}

                {/* BYOK provider */}
                {activeProvider === "byok" && (
                  <optgroup label={`☁️ ${t('agentForm.cloudModelsGroup', { provider: providerLabel[byokProvider] ?? "Cloud" })}`}>
                    {filteredCloudModels.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </optgroup>
                )}

              </select>
            )}

            {loadingModels && (
              <p className="text-xs text-gray-400 mt-1">{t('agentForm.loadingLocalModels')}</p>
            )}

            {/* BYOK cloud model reminder */}
            {isByokCloudModel && (
              <div className="mt-2 p-2 bg-blue-900/20 border border-blue-800 rounded text-xs text-blue-200">
                ☁️ {t('agentForm.byokApiKeyHint')}
              </div>
            )}
          </div>

          {/* Status for configure mode */}
          {mode === "configure" && agent && (
            <div>
              <label className="block text-sm font-medium mb-2">{t('agentForm.status')}</label>
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${getStatusColor(agent.status)}`} />
                <span className="capitalize">{agent.status}</span>
              </div>
            </div>
          )}

          {/* Fallback Models Section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium">
                {t('agentForm.fallbackModelsAdvanced')}
              </label>
              <button
                type="button"
                onClick={() => setShowFallbackConfig(!showFallbackConfig)}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                {showFallbackConfig ? t('agentForm.hideAdvanced') : t('agentForm.configureFallbacks')}
              </button>
            </div>

            {showFallbackConfig && (
              <div className="bg-gray-900 p-4 rounded-lg border border-gray-700 space-y-3">
                <div className="bg-blue-900/20 p-3 rounded border border-blue-800">
                  <div className="flex items-start space-x-2">
                    <div className="text-blue-400 mt-0.5">ℹ️</div>
                    <div className="text-xs text-blue-200">
                      <p className="font-medium">{t('agentForm.failoverProtection')}</p>
                      <p className="mt-1 opacity-90">
                        {t('agentForm.failoverProtectionDesc')}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="text-xs text-gray-400">
                  <span className="font-medium">{t('agentForm.primary')}</span> {formData.model}
                </div>

                {fallbackModels.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-gray-300">{t('agentForm.fallbackOrder')}</div>
                    {fallbackModels.map((modelId, index) => (
                      <div
                        key={`${modelId}-${index}`}
                        className="flex items-center justify-between bg-gray-800 p-2 rounded"
                      >
                        <div className="flex items-center space-x-2">
                          <span className="text-xs text-yellow-400">#{index + 2}</span>
                          <span className="text-sm">{modelId}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setFallbackModels(fallbackModels.filter((_, i) => i !== index))
                          }
                          className="text-red-400 hover:text-red-300 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <select
                    value={newFallbackModelState}
                    onChange={(e) => setNewFallbackModelState(e.target.value)}
                    className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  >
                    <option value="">{t('agentForm.selectBackupModel')}</option>
                    {activeProvider === "byok" && (
                      <optgroup label={`☁️ ${t('agentForm.cloudModels')}`}>
                        {filteredCloudModels
                          .filter((m) => m !== formData.model && !fallbackModels.includes(m))
                          .map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                      </optgroup>
                    )}
                    {localModels.length > 0 && (
                      <optgroup label={`🏠 ${t('agentForm.localModels')}`}>
                        {localModels
                          .filter((model) => {
                            const id = `ollama/${model.name}:${model.tag}`;
                            return id !== formData.model && !fallbackModels.includes(id);
                          })
                          .map((model) => {
                            const id = `ollama/${model.name}:${model.tag}`;
                            return (
                              <option key={id} value={id}>
                                {model.name}:{model.tag}
                              </option>
                            );
                          })}
                      </optgroup>
                    )}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      if (newFallbackModelState && !fallbackModels.includes(newFallbackModelState)) {
                        setFallbackModels([...fallbackModels, newFallbackModelState]);
                        setNewFallbackModelState("");
                      }
                    }}
                    disabled={!newFallbackModelState}
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-md text-sm transition-colors"
                  >
                    {t('agentForm.add')}
                  </button>
                </div>

                {fallbackModels.length === 0 && (
                  <div className="text-center py-3 text-gray-500 text-xs">
                    {t('agentForm.noFallbacksConfigured')}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded-md text-sm font-medium transition-colors"
            disabled={loading}
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-md text-sm font-medium transition-colors"
            disabled={loading || (activeProvider === "local" && localModels.length === 0 && !loadingModels)}
          >
            {loading ? (
              <div className="flex items-center gap-2">
                <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                {mode === "create" ? t('common.creating') : t('common.updating')}
              </div>
            ) : (
              mode === "create" ? t('agentForm.createAgent') : t('common.saveChanges')
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// Helper function for status colors
const getStatusColor = (status: string | undefined) => {
  if (!status) return "bg-gray-400";
  switch (status.toLowerCase()) {
    case "active":
    case "running":  return "bg-green-500";
    case "idle":     return "bg-yellow-500";
    case "stopped":  return "bg-gray-500";
    case "error":    return "bg-red-500";
    default:         return "bg-gray-400";
  }
};
