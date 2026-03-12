import React, { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useElectronAPI } from "../hooks/useElectronAPI";
import { AgentFormModal } from "./AgentFormModal";
import { ColorTheme } from "./dashboard/types";

interface Agent {
  id: string;
  name: string;
  status: string;
  model: string;
  description?: string;
  fallbacks?: string[];
}

interface AgentManagerProps {
  onClose?: () => void;
  colors: ColorTheme;
  onNavigateToLocalModels?: () => void;
}

interface ModelInfo {
  name: string;
  tag: string;
  size: string;
  modified: string;
  digest?: string;
  status: "available" | "downloading" | "installed" | "error";
}

const TrashIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export const AgentManager: React.FC<AgentManagerProps> = ({ onClose, colors, onNavigateToLocalModels }) => {
  const { t } = useTranslation();
  const electronAPI = useElectronAPI();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [localModels, setLocalModels] = useState<ModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [agentToDelete, setAgentToDelete] = useState<Agent | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "configure">("create");
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  useEffect(() => {
    loadAgents();
    loadLocalModels();
  }, []);

  const loadLocalModels = async () => {
    setLoadingModels(true);
    try {
      if (window.electronAPI.getInstalledModels) {
        const installed = await window.electronAPI.getInstalledModels();
        setLocalModels(installed as ModelInfo[]);
      }
    } catch (error) {
      console.error("Failed to load local models:", error);
    } finally {
      setLoadingModels(false);
    }
  };

  const loadAgents = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const agentList = await electronAPI.listAgents();
      setAgents(agentList);
    } catch (error: any) {
      console.error("Failed to load agents:", error);
      setLoadError(error.message || "Failed to load agents");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenCreateModal = () => {
    setModalMode("create");
    setSelectedAgent(null);
    setShowAgentModal(true);
  };

  const handleOpenConfigureModal = (agent: Agent) => {
    setModalMode("configure");
    setSelectedAgent(agent);
    setShowAgentModal(true);
  };

  const handleModalClose = () => {
    setShowAgentModal(false);
    setSelectedAgent(null);
  };

  const handleModalSuccess = async () => {
    await loadAgents();
  };

  const handleDeleteAgent = async (agent: Agent) => {
    if (!electronAPI) return;
    setIsDeleting(true);
    try {
      const result = await electronAPI.deleteAgent(agent.id);
      if (result.success) {
        await loadAgents();
        setAgentToDelete(null);
      } else {
        alert(`Failed to delete agent: ${result.error}`);
      }
    } catch (error: any) {
      console.error("Failed to delete agent:", error);
      alert(`Failed to delete agent: ${error.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const getStatusBadge = (status: string | undefined) => {
    switch ((status || "").toLowerCase()) {
      case "active":
      case "running":
        return { label: "Active", color: colors.accent.green };
      case "idle":
        return { label: "Idle", color: colors.accent.yellow };
      case "stopped":
        return { label: "Stopped", color: colors.text.muted };
      case "error":
        return { label: "Error", color: colors.accent.red };
      default:
        return { label: status || "Unknown", color: colors.text.muted };
    }
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <Bot className="h-5 w-5" style={{ color: colors.accent.brand }} />
          <h3 className="text-lg font-bold" style={{ color: colors.text.header }}>
            {t('nav.agentManagement')}
          </h3>
          <p className="text-sm" style={{ color: colors.text.muted }}>
            {t('nav.agentManagementDesc')}
          </p>
        </div>
        <button
          onClick={handleOpenCreateModal}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-opacity disabled:opacity-50"
          style={{ backgroundColor: colors.accent.brand, color: "#ffffff" }}
        >
          <PlusIcon />
          {t('nav.newAgent')}
        </button>
      </div>

      {/* Error banner */}
      {loadError && !loading && (
        <div
          className="mb-4 px-3 py-2.5 rounded-md flex items-center gap-2 text-sm"
          style={{
            backgroundColor: colors.accent.red + "18",
            border: `1px solid ${colors.accent.red}40`,
            color: colors.accent.red,
          }}
        >
          <span>⚠</span>
          <span className="flex-1">{loadError}</span>
          <button onClick={loadAgents} className="text-xs underline hover:no-underline opacity-80">
            Retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div
            className="animate-spin rounded-full h-7 w-7 border-2 border-transparent"
            style={{ borderTopColor: colors.accent.brand }}
          />
          <p className="text-sm" style={{ color: colors.text.muted }}>
            {t('nav.loadingAgents')}
          </p>
        </div>
      )}

      {/* Agents list */}
      {!loading && agents.length > 0 && (
        <div className="flex flex-col gap-2">
          {agents.map((agent) => {
            const badge = getStatusBadge(agent.status);
            return (
              <div
                key={agent.id}
                className="flex items-center gap-4 rounded-lg px-4 py-3"
                style={{ backgroundColor: colors.bg.secondary }}
              >
                {/* Agent info */}
                <Bot className="h-6 w-6 flex-shrink-0" style={{ color: colors.accent.brand }} />
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <h3
                    className="font-semibold text-base whitespace-nowrap"
                    style={{ color: colors.text.header }}
                  >
                    {agent.name}
                  </h3>
                  <span
                    className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0"
                    style={{
                      backgroundColor: badge.color + "20",
                      color: badge.color,
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: badge.color }}
                    />
                    {badge.label}
                  </span>
                  {agent.model ? (
                    <span
                      className="px-2 py-0.5 rounded text-sm flex-shrink-0"
                      style={{
                        backgroundColor: colors.bg.tertiary,
                        color: colors.text.muted,
                      }}
                    >
                      {agent.model}
                    </span>
                  ) : (
                    <span
                      className="px-2 py-0.5 rounded text-sm flex-shrink-0"
                      style={{
                        backgroundColor: colors.accent.yellow + "15",
                        color: colors.accent.yellow,
                      }}
                    >
                      {t('common.noModel')}
                    </span>
                  )}
                  {agent.description && (
                    <span
                      className="text-sm truncate"
                      style={{ color: colors.text.muted }}
                    >
                      {agent.description}
                    </span>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleOpenConfigureModal(agent)}
                    className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
                    style={{
                      backgroundColor: '#e67e22',
                      color: '#ffffff',
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.opacity = '0.85')
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.opacity = '1')
                    }
                  >
                    {t('common.configure')}
                  </button>
                  <button
                    onClick={() => setAgentToDelete(agent)}
                    className="p-1.5 rounded transition-colors"
                    title="Delete agent"
                    style={{ color: colors.text.muted, backgroundColor: "transparent" }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = colors.accent.red + "20";
                      e.currentTarget.style.color = colors.accent.red;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "transparent";
                      e.currentTarget.style.color = colors.text.muted;
                    }}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {!loading && !loadError && agents.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <div className="text-5xl">🤖</div>
          <div>
            <h3 className="font-semibold text-base mb-1" style={{ color: colors.text.header }}>
              {t('nav.noAgentsYet')}
            </h3>
            <p className="text-sm" style={{ color: colors.text.muted }}>
              {t('nav.noAgentsDesc')}
            </p>
          </div>
          <button
            onClick={handleOpenCreateModal}
            className="px-5 py-2 rounded-md text-sm font-medium"
            style={{ backgroundColor: colors.accent.brand, color: "#ffffff" }}
          >
            {t('nav.createFirstAgent')}
          </button>
        </div>
      )}

      {/* Agent Form Modal */}
      <AgentFormModal
        isOpen={showAgentModal}
        mode={modalMode}
        agent={selectedAgent}
        onClose={handleModalClose}
        onSuccess={handleModalSuccess}
        localModels={localModels}
        loadingModels={loadingModels}
        onNavigateToLocalModels={onNavigateToLocalModels}
      />

      {/* Delete Confirmation Modal */}
      {agentToDelete && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div
            className="p-6 rounded-xl max-w-md w-full mx-4"
            style={{
              backgroundColor: colors.bg.secondary,
            }}
          >
            <h3 className="text-lg font-bold mb-1" style={{ color: colors.text.header }}>
              {t('nav.deleteAgent')}
            </h3>
            <p className="text-sm mb-1" style={{ color: colors.text.normal }}>
              Are you sure you want to delete{" "}
              <span className="font-semibold" style={{ color: colors.text.header }}>
                "{agentToDelete.name}"
              </span>
              ?
            </p>
            <p className="text-xs mb-6" style={{ color: colors.accent.red }}>
              {t('nav.deleteAgentConfirm')}
            </p>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setAgentToDelete(null)}
                disabled={isDeleting}
                className="px-4 py-2 rounded-md text-sm font-medium transition-colors"
                style={{ backgroundColor: colors.bg.tertiary, color: colors.text.normal }}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => handleDeleteAgent(agentToDelete)}
                disabled={isDeleting}
                className="px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2"
                style={{ backgroundColor: colors.accent.red, color: "#ffffff" }}
              >
                {isDeleting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-transparent border-t-white" />
                    {t('common.deleting')}
                  </>
                ) : (
                  t('nav.deleteAgent')
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
