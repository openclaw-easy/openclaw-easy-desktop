import React, { useState, useEffect } from "react";
import { Route, Plus, Trash2, TestTube, AlertCircle, CheckCircle, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ColorTheme } from "../types";
import { AgentBinding, AgentBindingResult, ResolvedAgentRoute } from "../../types/electron";

interface AgentRoutingSectionProps {
  colors: ColorTheme;
}

interface Agent {
  id: string;
  name?: string;
}

interface EnrichedBinding extends AgentBinding {
  description: string;
  normalizedAgentId: string;
}

const SUPPORTED_CHANNELS = [
  // Core channels
  { id: "whatsapp", name: "WhatsApp", icon: "📱" },
  { id: "telegram", name: "Telegram", icon: "✈️" },
  { id: "discord", name: "Discord", icon: "💬" },
  { id: "slack", name: "Slack", icon: "💼" },
  { id: "signal", name: "Signal", icon: "🔒" },
  { id: "imessage", name: "iMessage", icon: "💭" },
  { id: "googlechat", name: "Google Chat", icon: "📧" },
  { id: "line", name: "LINE", icon: "🟢" },
  { id: "irc", name: "IRC", icon: "📟" },
  // Extension channels
  { id: "matrix", name: "Matrix", icon: "🔷" },
  { id: "msteams", name: "Microsoft Teams", icon: "🟦" },
  { id: "feishu", name: "Feishu / Lark", icon: "🪶" },
  { id: "mattermost", name: "Mattermost", icon: "🔵" },
  { id: "twitch", name: "Twitch", icon: "🟣" },
  { id: "nostr", name: "Nostr", icon: "🌐" },
  { id: "bluebubbles", name: "BlueBubbles", icon: "🫧" },
  { id: "zalo", name: "Zalo", icon: "💙" },
  { id: "zalouser", name: "Zalo Personal", icon: "💙" },
  { id: "nextcloud-talk", name: "Nextcloud Talk", icon: "☁️" },
  { id: "synology-chat", name: "Synology Chat", icon: "🗄️" },
  { id: "tlon", name: "Tlon", icon: "🌀" },
];

export const AgentRoutingSection: React.FC<AgentRoutingSectionProps> = ({
  colors,
}) => {
  const { t } = useTranslation();
  const [bindings, setBindings] = useState<EnrichedBinding[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI toggles
  const [showAddModal, setShowAddModal] = useState(false);
  const [showTestRouting, setShowTestRouting] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState("");
  const [selectedAgent, setSelectedAgent] = useState("");
  const [accountId, setAccountId] = useState("*");
  const [isAddingBinding, setIsAddingBinding] = useState(false);

  // Routing test state
  const [testChannel, setTestChannel] = useState("");
  const [testAccountId, setTestAccountId] = useState("");
  const [testPeerId, setTestPeerId] = useState("");
  const [testResult, setTestResult] = useState<ResolvedAgentRoute | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load agent bindings
      const bindingsResult: AgentBindingResult = await window.electronAPI.listAgentBindings();
      if (bindingsResult.success) {
        setBindings(bindingsResult.bindings || []);
      } else {
        setError(bindingsResult.error || "Failed to load agent bindings");
      }

      // Load available agents
      const agentsResult = await window.electronAPI.listAgents();
      setAgents(agentsResult || []);

    } catch (err: any) {
      setError(err.message || "Failed to load routing data");
    } finally {
      setLoading(false);
    }
  };

  const handleAddBinding = async () => {
    if (!selectedChannel || !selectedAgent) {
      setError(t('agentRouting.selectBoth'));
      return;
    }

    setIsAddingBinding(true);
    setError(null);

    try {
      const binding: AgentBinding = {
        agentId: selectedAgent,
        match: {
          channel: selectedChannel,
          accountId: accountId === "*" ? "*" : accountId || undefined,
        },
      };

      const result: AgentBindingResult = await window.electronAPI.addAgentBinding(binding);

      if (result.success) {
        await loadData();
        // Reset form and close modal
        setSelectedChannel("");
        setSelectedAgent("");
        setAccountId("*");
        setShowAddModal(false);
      } else {
        setError(result.error || "Failed to add binding");
      }
    } catch (err: any) {
      setError(err.message || "Failed to add binding");
    } finally {
      setIsAddingBinding(false);
    }
  };

  const handleRemoveBinding = async (agentId: string, channel: string) => {
    if (!confirm(t('agentRouting.removeConfirm', { channel, agentId }))) {
      return;
    }

    try {
      const result: AgentBindingResult = await window.electronAPI.removeAgentBinding(agentId, channel);

      if (result.success) {
        await loadData();
      } else {
        setError(result.error || t('agentRouting.removeFailed'));
      }
    } catch (err: any) {
      setError(err.message || "Failed to remove binding");
    }
  };

  const handleTestRouting = async () => {
    if (!testChannel) {
      setError(t('agentRouting.selectChannel'));
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    setError(null);

    try {
      const result: AgentBindingResult = await window.electronAPI.testAgentRouting({
        channel: testChannel,
        accountId: testAccountId || undefined,
        peerId: testPeerId || undefined,
        peerKind: "dm",
      });

      if (result.success && result.route) {
        setTestResult(result.route);
      } else {
        setError(result.error || t('agentRouting.testFailed'));
      }
    } catch (err: any) {
      setError(err.message || "Failed to test routing");
    } finally {
      setIsTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-sm" style={{ color: colors.text.muted }}>
          {t('agentRouting.loadingRouting')}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-3">
        <Route className="h-5 w-5" style={{ color: colors.accent.purple }} />
        <div className="flex items-baseline gap-3">
          <h3 className="text-base font-semibold" style={{ color: colors.text.header }}>
            {t('agentRouting.title')}
          </h3>
          <p className="text-xs" style={{ color: colors.text.muted }}>
            {t('agentRouting.subtitle')}
          </p>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div
          className="p-3 rounded-lg border"
          style={{
            backgroundColor: colors.bg.tertiary,
            borderColor: "#dc2626",
          }}
        >
          <div className="flex items-center space-x-2">
            <AlertCircle className="h-4 w-4 text-red-500" />
            <span className="text-sm text-red-500">{error}</span>
          </div>
        </div>
      )}

      {/* Current Bindings Table */}
      <div
        className="rounded-lg"
        style={{
          backgroundColor: colors.bg.secondary,
        }}
      >
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: colors.bg.tertiary }}>
          <h4 className="text-sm font-semibold" style={{ color: colors.text.header }}>
            {t('agentRouting.currentRules')}
          </h4>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-opacity"
            style={{ backgroundColor: colors.accent.brand, color: "#ffffff" }}
          >
            <Plus className="h-3.5 w-3.5" />
            {t('agentRouting.addNewRule')}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b" style={{ borderColor: colors.bg.tertiary }}>
                <th className="text-left p-3 text-xs font-medium" style={{ color: colors.text.muted }}>
                  {t('agentRouting.channel')}
                </th>
                <th className="text-left p-3 text-xs font-medium" style={{ color: colors.text.muted }}>
                  {t('agentRouting.agent')}
                </th>
                <th className="text-left p-3 text-xs font-medium" style={{ color: colors.text.muted }}>
                  {t('agentRouting.accountFilter')}
                </th>
                <th className="text-left p-3 text-xs font-medium" style={{ color: colors.text.muted }}>
                  {t('agentRouting.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {bindings.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-6 text-center">
                    <div className="text-sm" style={{ color: colors.text.muted }}>
                      {t('agentRouting.noRulesConfigured')}
                    </div>
                  </td>
                </tr>
              ) : (
                bindings.map((binding, index) => {
                  const channel = SUPPORTED_CHANNELS.find(c => c.id === binding.match.channel);
                  const agent = agents.find(a => a.id === binding.normalizedAgentId);

                  return (
                    <tr key={index} className="border-b" style={{ borderColor: colors.bg.tertiary }}>
                      <td className="p-3">
                        <div className="flex items-center space-x-2">
                          <span className="text-lg">{channel?.icon || "📡"}</span>
                          <span style={{ color: colors.text.normal }}>
                            {channel?.name || binding.match.channel}
                          </span>
                        </div>
                      </td>
                      <td className="p-3">
                        <span style={{ color: colors.text.normal }}>
                          {agent?.name || binding.agentId}
                        </span>
                      </td>
                      <td className="p-3">
                        <span
                          className="px-2 py-1 rounded text-xs"
                          style={{
                            backgroundColor: binding.match.accountId === "*"
                              ? colors.accent.blue + "20"
                              : colors.accent.yellow + "20",
                            color: binding.match.accountId === "*"
                              ? colors.accent.blue
                              : colors.accent.yellow,
                          }}
                        >
                          {binding.match.accountId === "*" ? t('agentRouting.allUsers') : binding.match.accountId || t('agentRouting.default')}
                        </span>
                      </td>
                      <td className="p-3">
                        <button
                          onClick={() => handleRemoveBinding(binding.agentId, binding.match.channel)}
                          className="p-1 rounded hover:bg-red-500/20"
                          title={t('agentRouting.removeRoutingRule')}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add New Routing Rule Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div
            className="rounded-xl max-w-lg w-full mx-4 overflow-hidden"
            style={{ backgroundColor: colors.bg.secondary }}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: colors.bg.tertiary }}>
              <div className="flex items-center gap-2">
                <Plus className="h-4 w-4" style={{ color: colors.accent.green }} />
                <h4 className="text-sm font-semibold" style={{ color: colors.text.header }}>
                  {t('agentRouting.addNewRule')}
                </h4>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded transition-colors"
                style={{ color: colors.text.muted }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal body */}
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: colors.text.normal }}>
                  {t('agentRouting.channel')}
                </label>
                <select
                  value={selectedChannel}
                  onChange={(e) => setSelectedChannel(e.target.value)}
                  className="w-full px-3 py-2 rounded border-0 text-sm"
                  style={{
                    backgroundColor: colors.bg.tertiary,
                    color: colors.text.normal,
                  }}
                >
                  <option value="">{t('agentRouting.selectChannel')}</option>
                  {SUPPORTED_CHANNELS.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channel.icon} {channel.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: colors.text.normal }}>
                  {t('agentRouting.agent')}
                </label>
                <select
                  value={selectedAgent}
                  onChange={(e) => setSelectedAgent(e.target.value)}
                  className="w-full px-3 py-2 rounded border-0 text-sm"
                  style={{
                    backgroundColor: colors.bg.tertiary,
                    color: colors.text.normal,
                  }}
                >
                  <option value="">{t('agentRouting.selectAgent')}</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name || agent.id}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: colors.text.normal }}>
                  {t('agentRouting.accountFilter')}
                </label>
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full px-3 py-2 rounded border-0 text-sm"
                  style={{
                    backgroundColor: colors.bg.tertiary,
                    color: colors.text.normal,
                  }}
                >
                  <option value="*">{t('agentRouting.allUsers')}</option>
                  <option value="default">{t('agentRouting.defaultAccountOnly')}</option>
                </select>
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: colors.bg.tertiary }}>
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 rounded-md text-sm font-medium"
                style={{ backgroundColor: colors.bg.tertiary, color: colors.text.normal }}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleAddBinding}
                disabled={isAddingBinding || !selectedChannel || !selectedAgent}
                className="px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                style={{
                  backgroundColor: colors.accent.blue,
                  color: "white",
                }}
              >
                {isAddingBinding ? (
                  t('agentRouting.adding')
                ) : (
                  <>
                    <Plus className="h-4 w-4 inline mr-1" />
                    {t('agentRouting.addRule')}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Test Routing Toggle */}
      <button
        onClick={() => setShowTestRouting(!showTestRouting)}
        className="flex items-center gap-2 text-sm transition-colors"
        style={{ color: colors.text.muted }}
      >
        <TestTube className="h-4 w-4" style={{ color: colors.accent.yellow }} />
        <span>{t('agentRouting.testMessageRouting')}</span>
        <span className="text-xs">{showTestRouting ? '▲' : '▼'}</span>
      </button>

      {/* Routing Test Section */}
      {showTestRouting && (
      <div
        className="rounded-lg p-4"
        style={{
          backgroundColor: colors.bg.secondary,
        }}
      >
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: colors.text.normal }}>
              {t('agentRouting.channel')}
            </label>
            <select
              value={testChannel}
              onChange={(e) => setTestChannel(e.target.value)}
              className="w-full px-3 py-1.5 rounded border-0 text-sm"
              style={{
                backgroundColor: colors.bg.tertiary,
                color: colors.text.normal,
              }}
            >
              <option value="">{t('agentRouting.selectChannel')}</option>
              {SUPPORTED_CHANNELS.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.icon} {channel.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: colors.text.normal }}>
              {t('agentRouting.accountIdOptional')}
            </label>
            <input
              type="text"
              value={testAccountId}
              onChange={(e) => setTestAccountId(e.target.value)}
              placeholder="default"
              className="w-full px-3 py-1.5 rounded border-0 text-sm"
              style={{
                backgroundColor: colors.bg.tertiary,
                color: colors.text.normal,
              }}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: colors.text.normal }}>
              {t('agentRouting.userPeerIdOptional')}
            </label>
            <input
              type="text"
              value={testPeerId}
              onChange={(e) => setTestPeerId(e.target.value)}
              placeholder="+1234567890"
              className="w-full px-3 py-1.5 rounded border-0 text-sm"
              style={{
                backgroundColor: colors.bg.tertiary,
                color: colors.text.normal,
              }}
            />
          </div>

          <div className="flex items-end">
            <button
              onClick={handleTestRouting}
              disabled={isTesting || !testChannel}
              className="w-full px-4 py-1.5 rounded text-sm font-medium transition-colors disabled:opacity-50"
              style={{
                backgroundColor: colors.accent.green,
                color: "white",
              }}
            >
              {isTesting ? (
                t('agentRouting.testing')
              ) : (
                <>
                  <TestTube className="h-4 w-4 inline mr-1" />
                  {t('agentRouting.testRouting')}
                </>
              )}
            </button>
          </div>
        </div>

        {/* Test Result */}
        {testResult && (
          <div
            className="p-3 rounded-lg"
            style={{ backgroundColor: colors.bg.tertiary }}
          >
            <div className="flex items-center space-x-2 mb-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="font-medium" style={{ color: colors.text.header }}>
                {t('agentRouting.routingResult')}
              </span>
            </div>
            <div className="text-sm space-y-1">
              <div style={{ color: colors.text.normal }}>
                <strong>{t('agentRouting.agent')}:</strong> {testResult.agentId}
              </div>
              <div style={{ color: colors.text.normal }}>
                <strong>{t('agentRouting.accountFilter')}:</strong> {testResult.accountId}
              </div>
              <div style={{ color: colors.text.normal }}>
                <strong>{t('agentRouting.matchedBy')}:</strong>{" "}
                <span
                  className="px-2 py-1 rounded text-xs"
                  style={{
                    backgroundColor: colors.accent.purple + "20",
                    color: colors.accent.purple,
                  }}
                >
                  {testResult.matchedBy}
                </span>
              </div>
              <div style={{ color: colors.text.muted }}>
                <strong>{t('agentRouting.sessionKey')}:</strong> {testResult.sessionKey}
              </div>
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
};