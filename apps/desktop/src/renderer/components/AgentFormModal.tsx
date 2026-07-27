import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../contexts/ToastContext";
import { BYOK_PROVIDER_MODELS, byokAgentModelId, defaultByokAgentModelId } from "../../shared/providerModels";
import { Modal } from "./ui/modal";

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
  // Fallback to OpenAI's catalog if the configured provider isn't in the
  // table (e.g. an upgraded install whose persisted config still says
  // `anthropic`, which was removed as a BYOK provider on 2026-06-15).
  const cfg = BYOK_PROVIDER_MODELS[byokProvider] ?? BYOK_PROVIDER_MODELS.openai;
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
  const { addToast } = useToast();
  const [formData, setFormData] = useState<AgentFormData>({
    name: "",
    model: "openai/gpt-5.4-mini",
    fallbacks: [],
  });
  const [fallbackModels, setFallbackModels] = useState<string[]>([]);
  const [showFallbackConfig, setShowFallbackConfig] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeProvider, setActiveProvider] = useState<"byok" | "local">("byok");
  // Anthropic removed from BYOK 2026-06-15. Defaults migrated to openai
  // (the OpenAI BYOK path is the closest analog and gpt-5.4-mini is the
  // catalog's fallback default).
  const [byokProvider, setByokProvider] = useState<string>("openai");
  const [newFallbackModelState, setNewFallbackModelState] = useState("");

  // Load provider config and initialize form data whenever the modal opens
  useEffect(() => {
    if (!isOpen) return;

    window.electronAPI.getConfig().then((config: any) => {
      // Anything that isn't a provider this build supports falls back to BYOK.
      // Covers configs written by a build that offered a hosted provider.
      const provider: "byok" | "local" = config?.aiProvider === "local" ? "local" : "byok";
      // Migrate legacy `byok.provider: 'anthropic'` configs to openai —
      // Anthropic was removed as a BYOK provider on 2026-06-15.
      const rawProvider = config?.byok?.provider as string | undefined;
      const bProvider: string =
        rawProvider === "anthropic" || !rawProvider ? "openai" : rawProvider;
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
        setFormData({ name: "", model: "openai/gpt-5.4-mini", fallbacks: [] });
        setFallbackModels([]);
      } else if (mode === "configure" && agent) {
        setFormData({
          name: agent.name,
          model: agent.model || "openai/gpt-5.4-mini",
          fallbacks: agent.fallbacks || [],
        });
        setFallbackModels(agent.fallbacks || []);
      }
      setShowFallbackConfig(false);
    });
  }, [mode, agent, isOpen]);

  const handleSubmit = async () => {
    // Synchronous double-submit guard: the button is only disabled on the async
    // `loading` state, so a fast double-click before re-render could create the
    // agent twice (the create write persists).
    if (loading) return;
    if (!formData.name.trim()) {
      addToast(t('agentForm.pleaseEnterName'), 'error');
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
            addToast(t('agentForm.failedToConfigure', { message: configResult.message }), 'error');
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
          addToast(t(key, { name: formData.name, model: formData.model }), 'success');
        }
        onSuccess();
        onClose();
      } else {
        const key = mode === "create" ? 'agentForm.failedToCreateAgent' : 'agentForm.failedToUpdateAgent';
        addToast(t(key, { error: result.error }), 'error');
      }
    } catch (error) {
      console.error(`Failed to ${mode} agent:`, error);
      addToast(t(mode === "create" ? 'agentForm.failedToCreate' : 'agentForm.failedToUpdate'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const filteredCloudModels = getCloudModelsForProvider(byokProvider);
  const isByokCloudModel =
    formData.model.startsWith("openai/") ||
    formData.model.startsWith("google/");

  const providerLabel: Record<string, string> = {
    google:     "Google",
    openai:     "OpenAI",
    venice:     "Venice AI",
    openrouter: "OpenRouter",
  };

  const titleId = 'agent-form-title';

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      maxWidthClass="max-w-2xl"
      shellClassName="text-foreground max-h-[90vh] overflow-y-auto"
      labelledBy={titleId}
    >
        <h3 id={titleId} className="font-display text-xl font-bold tracking-tight mb-4">
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
              className="input-glow w-full px-3 py-2 bg-background/60 border border-border rounded-md focus:outline-none"
              placeholder={t('agentForm.agentNamePlaceholder')}
              disabled={mode === "configure"}
            />
            {mode === "configure" && (
              <p className="text-xs text-muted-foreground mt-1">
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
                className="input-glow w-full px-3 py-2 bg-background/60 border border-border rounded-md focus:outline-none"
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
              <p className="text-xs text-muted-foreground mt-1">{t('agentForm.loadingLocalModels')}</p>
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
                className="text-xs text-primary hover:text-primary/80 transition-colors"
              >
                {showFallbackConfig ? t('agentForm.hideAdvanced') : t('agentForm.configureFallbacks')}
              </button>
            </div>

            {showFallbackConfig && (
              <div className="bg-background/60 p-4 rounded-lg border border-border space-y-3">
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

                <div className="text-xs text-muted-foreground">
                  <span className="font-medium">{t('agentForm.primary')}</span> {formData.model}
                </div>

                {fallbackModels.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-foreground/80">{t('agentForm.fallbackOrder')}</div>
                    {fallbackModels.map((modelId, index) => (
                      <div
                        key={`${modelId}-${index}`}
                        className="flex items-center justify-between bg-card/80 border border-border p-2 rounded"
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
                    className="input-glow flex-1 px-3 py-2 bg-background/60 border border-border rounded-md focus:outline-none text-sm"
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
                    className="press-pulse ripple-glow px-3 py-2 bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:cursor-not-allowed rounded-md text-sm transition-all hover:-translate-y-px hover:shadow-glow active:translate-y-0"
                  >
                    {t('agentForm.add')}
                  </button>
                </div>

                {fallbackModels.length === 0 && (
                  <div className="text-center py-3 text-muted-foreground text-xs">
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
            className="press-pulse ripple-glow px-4 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-md text-sm font-medium transition-colors"
            disabled={loading}
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            className="press-pulse ripple-glow px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md text-sm font-medium transition-all hover:-translate-y-px hover:shadow-glow active:translate-y-0"
            disabled={loading || (activeProvider === "local" && localModels.length === 0 && !loadingModels)}
          >
            {loading ? (
              <div className="flex items-center gap-2">
                <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                {/* The Save button stays in this state for the full sync
                    gateway restart (~3-5s) — the previous fast-return
                    fire-and-forget left the gateway running the OLD
                    model, causing chat to answer with the stale model.
                    Honest copy here so the wait doesn't feel hung. */}
                {t('agentForm.restartingWithNewModel', 'Restarting with new model…')}
              </div>
            ) : (
              mode === "create" ? t('agentForm.createAgent') : t('common.saveChanges')
            )}
          </button>
        </div>
    </Modal>
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
