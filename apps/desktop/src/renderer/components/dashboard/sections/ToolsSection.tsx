import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ColorTheme } from '../types';
import { WindowsPermissionsSection } from './WindowsPermissionsSection';
import {
  Terminal,
  Globe,
  Settings,
  AlertCircle,
  Loader2,
  Check,
  Image,
  Link,
  Shield,
  Mic,
  Camera,
  Monitor,
  Accessibility,
} from 'lucide-react';

interface ToolsSectionProps {
  colors: ColorTheme;
}

interface ToolsConfig {
  profile: 'minimal' | 'coding' | 'messaging' | 'full';
  exec?: {
    host: 'sandbox' | 'gateway' | 'node';
    security: 'deny' | 'allowlist' | 'full';
    safeBins?: string[];
  };
  web?: {
    search?: { enabled: boolean };
    fetch?: { enabled: boolean };
  };
  media?: {
    image?: { enabled: boolean };
    audio?: { enabled: boolean };
    video?: { enabled: boolean };
  };
  links?: {
    enabled: boolean;
  };
  elevated?: {
    enabled: boolean;
  };
}

type PermissionStatus = 'granted' | 'denied' | 'not-determined' | 'restricted';

interface MacPermission {
  id: 'microphone' | 'camera' | 'screen' | 'accessibility';
  label: string;
  description: string;
  icon: React.ReactNode;
  status: PermissionStatus;
  canRequestInApp: boolean; // mic & camera only — others require opening System Settings
}

export const ToolsSection: React.FC<ToolsSectionProps> = ({ colors }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [config, setConfig] = useState<ToolsConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [applyToAllAgents, setApplyToAllAgents] = useState(true);
  const [permissions, setPermissions] = useState<MacPermission[] | null>(null);
  const [requestingPermission, setRequestingPermission] = useState<string | null>(null);
  const [platform, setPlatform] = useState<string | null>(null);

  useEffect(() => {
    loadConfig();
    loadPermissions();
    setPlatform(window.electronAPI?.getPlatform?.() ?? null);
  }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get OpenClaw config
      const result = await window.electronAPI.getOpenClawConfig();

      if (result && result.config) {
        const toolsConfig: ToolsConfig = {
          profile: result.config.tools?.profile || 'coding',
          exec: result.config.tools?.exec || {
            host: 'sandbox',
            security: 'allowlist',
            safeBins: []
          },
          web: result.config.tools?.web || {
            search: { enabled: true },
            fetch: { enabled: true }
          },
          media: result.config.tools?.media || {
            image: { enabled: true },
            audio: { enabled: true },
            video: { enabled: true }
          },
          links: result.config.tools?.links || { enabled: true },
          elevated: result.config.tools?.elevated || { enabled: true }
        };

        setConfig(toolsConfig);
      }
    } catch (err: any) {
      console.error('[ToolsSection] Failed to load config:', err);
      setError(err.message || 'Failed to load tools configuration');
    } finally {
      setLoading(false);
    }
  };

  const loadPermissions = async () => {
    try {
      const statuses = await window.electronAPI?.checkAllPermissions?.();
      if (!statuses) {return;} // non-macOS or API unavailable
      setPermissions([
        {
          id: 'microphone',
          label: t('tools.microphone'),
          description: t('tools.microphoneDesc'),
          icon: <Mic className="h-4 w-4" />,
          status: statuses.microphone as PermissionStatus,
          canRequestInApp: statuses.microphone === 'not-determined',
        },
        {
          id: 'camera',
          label: t('tools.camera'),
          description: t('tools.cameraDesc'),
          icon: <Camera className="h-4 w-4" />,
          status: statuses.camera as PermissionStatus,
          canRequestInApp: statuses.camera === 'not-determined',
        },
        {
          id: 'screen',
          label: t('tools.screenRecording'),
          description: t('tools.screenRecordingDesc'),
          icon: <Monitor className="h-4 w-4" />,
          status: statuses.screen as PermissionStatus,
          canRequestInApp: false,
        },
        {
          id: 'accessibility',
          label: t('tools.accessibilityLabel'),
          description: t('tools.accessibilityLabelDesc'),
          icon: <Accessibility className="h-4 w-4" />,
          status: statuses.accessibility as PermissionStatus,
          canRequestInApp: false,
        },
      ]);
    } catch (err) {
      console.error('[ToolsSection] Failed to load permissions:', err);
    }
  };

  const handlePermissionAction = async (permission: MacPermission) => {
    setRequestingPermission(permission.id);
    try {
      if (permission.canRequestInApp) {
        await window.electronAPI?.requestPermission?.(permission.id as 'microphone' | 'camera');
        await loadPermissions(); // refresh status after request
      } else {
        await window.electronAPI?.openPermissionSettings?.(permission.id);
      }
    } finally {
      setRequestingPermission(null);
    }
  };

  const handleProfileChange = async (newProfile: 'minimal' | 'coding' | 'messaging' | 'full') => {
    try {
      setSaving(true);
      setSaveSuccess(false);
      setSaveError(null);

      // Configure complete settings for each profile
      // Based on official OpenClaw docs: https://docs.openclaw.ai/tools
      const profileConfigs = {
        minimal: {
          // Minimal: Only session_status (everything else implicitly denied)
          profile: 'minimal',
          allow: [],
          deny: [],
          exec: { host: 'sandbox', security: 'deny' },
          web: { search: { enabled: false }, fetch: { enabled: false } }
        },
        coding: {
          // Coding: group:fs, group:runtime, group:sessions, group:memory, image tools
          // We add group:web to enable web search/fetch as an extension
          profile: 'coding',
          allow: ['group:web'],  // Expand beyond profile's default
          deny: [],
          exec: { host: 'sandbox', security: 'allowlist' },
          web: { search: { enabled: true }, fetch: { enabled: true } }
        },
        messaging: {
          // Messaging: group:messaging + specific session tools
          // We add group:web for web search/fetch
          profile: 'messaging',
          allow: ['group:web', 'memory_search'],  // Expand beyond profile's default
          deny: [],
          exec: { host: 'sandbox', security: 'deny' },
          web: { search: { enabled: true }, fetch: { enabled: true } }
        },
        full: {
          // Full: All tools enabled explicitly
          // Note: Even with profile='full', exec must be in allow list to be provided to agents
          profile: 'full',
          allow: ['exec', 'group:web'],  // Keep it simple - just exec and web tools
          deny: [],
          exec: { host: 'gateway', security: 'allowlist' },  // Changed from 'full' to 'allowlist' to avoid approval prompts
          web: { search: { enabled: true }, fetch: { enabled: true } }
        }
      };

      const profileConfig = profileConfigs[newProfile];

      // Apply all settings using updateToolsConfig for atomic update
      const result = await window.electronAPI.updateToolsConfig(profileConfig, applyToAllAgents);

      if (result.success) {
        // Update local state
        setConfig(prev => prev ? {
          ...prev,
          profile: newProfile,
          exec: profileConfig.exec as any,
          web: profileConfig.web
        } : null);

        // Show success indicator
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
      } else {
        throw new Error(result.error || 'Failed to set profile');
      }
    } catch (err: any) {
      console.error('[ToolsSection] Failed to change profile:', err);
      setSaveError(err.message || 'Failed to change profile');
    } finally {
      setSaving(false);
    }
  };

  const handleExecHostChange = async (newHost: 'sandbox' | 'gateway' | 'node') => {
    try {
      setSaving(true);
      setSaveSuccess(false);
      setSaveError(null);

      const result = await window.electronAPI.setExecHost(newHost, applyToAllAgents);

      if (result.success) {
        // Update local state
        setConfig(prev => prev ? {
          ...prev,
          exec: { ...prev.exec!, host: newHost }
        } : null);

        // Show success indicator
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
      } else {
        throw new Error(result.error || 'Failed to set exec host');
      }
    } catch (err: any) {
      console.error('[ToolsSection] Failed to change exec host:', err);
      setSaveError(err.message || 'Failed to change exec host');
    } finally {
      setSaving(false);
    }
  };

  const handleExecSecurityChange = async (newSecurity: 'deny' | 'allowlist' | 'full') => {
    try {
      setSaving(true);
      setSaveSuccess(false);
      setSaveError(null);

      const result = await window.electronAPI.setExecSecurity(newSecurity, applyToAllAgents);

      if (result.success) {
        // Update local state
        setConfig(prev => prev ? {
          ...prev,
          exec: { ...prev.exec!, security: newSecurity }
        } : null);

        // Show success indicator
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
      } else {
        throw new Error(result.error || 'Failed to set exec security');
      }
    } catch (err: any) {
      console.error('[ToolsSection] Failed to change exec security:', err);
      setSaveError(err.message || 'Failed to change exec security');
    } finally {
      setSaving(false);
    }
  };

  const handleWebSearchToggle = async (enabled: boolean) => {
    try {
      setSaving(true);
      setSaveSuccess(false);
      setSaveError(null);

      const result = await window.electronAPI.setWebSearchEnabled(enabled);

      if (result.success) {
        // Update local state
        setConfig(prev => prev ? {
          ...prev,
          web: {
            ...prev.web,
            search: { enabled }
          }
        } : null);

        // Show success indicator
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
      } else {
        throw new Error(result.error || 'Failed to toggle web search');
      }
    } catch (err: any) {
      console.error('[ToolsSection] Failed to toggle web search:', err);
      setSaveError(err.message || 'Failed to toggle web search');
    } finally {
      setSaving(false);
    }
  };

  const handleWebFetchToggle = async (enabled: boolean) => {
    try {
      setSaving(true);
      setSaveSuccess(false);
      setSaveError(null);

      const result = await window.electronAPI.setWebFetchEnabled(enabled);

      if (result.success) {
        // Update local state
        setConfig(prev => prev ? {
          ...prev,
          web: {
            ...prev.web,
            fetch: { enabled }
          }
        } : null);

        // Show success indicator
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
      } else {
        throw new Error(result.error || 'Failed to toggle web fetch');
      }
    } catch (err: any) {
      console.error('[ToolsSection] Failed to toggle web fetch:', err);
      setSaveError(err.message || 'Failed to toggle web fetch');
    } finally {
      setSaving(false);
    }
  };

  const handleMediaToggle = async (mediaType: 'image' | 'audio' | 'video', enabled: boolean) => {
    try {
      setSaving(true);
      setSaveSuccess(false);
      setSaveError(null);

      const updates = {
        media: {
          ...config?.media,
          [mediaType]: { enabled }
        }
      };

      const result = await window.electronAPI.updateToolsConfig(updates, applyToAllAgents);

      if (result.success) {
        setConfig(prev => prev ? {
          ...prev,
          media: {
            ...prev.media,
            [mediaType]: { enabled }
          }
        } : null);

        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
      } else {
        throw new Error(result.error || `Failed to toggle ${mediaType}`);
      }
    } catch (err: any) {
      console.error(`[ToolsSection] Failed to toggle ${mediaType}:`, err);
      setSaveError(err.message || `Failed to toggle ${mediaType}`);
    } finally {
      setSaving(false);
    }
  };

  const handleLinksToggle = async (enabled: boolean) => {
    try {
      setSaving(true);
      setSaveSuccess(false);
      setSaveError(null);

      const updates = {
        links: { enabled }
      };

      const result = await window.electronAPI.updateToolsConfig(updates, applyToAllAgents);

      if (result.success) {
        setConfig(prev => prev ? {
          ...prev,
          links: { enabled }
        } : null);

        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
      } else {
        throw new Error(result.error || 'Failed to toggle links');
      }
    } catch (err: any) {
      console.error('[ToolsSection] Failed to toggle links:', err);
      setSaveError(err.message || 'Failed to toggle links');
    } finally {
      setSaving(false);
    }
  };

  const handleElevatedToggle = async (enabled: boolean) => {
    try {
      setSaving(true);
      setSaveSuccess(false);
      setSaveError(null);

      const updates = {
        elevated: { enabled }
      };

      const result = await window.electronAPI.updateToolsConfig(updates, applyToAllAgents);

      if (result.success) {
        setConfig(prev => prev ? {
          ...prev,
          elevated: { enabled }
        } : null);

        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
      } else {
        throw new Error(result.error || 'Failed to toggle elevated tools');
      }
    } catch (err: any) {
      console.error('[ToolsSection] Failed to toggle elevated tools:', err);
      setSaveError(err.message || 'Failed to toggle elevated tools');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-8 pb-4">
        <div className="flex items-baseline gap-2 mb-4">
          <h3 className="text-lg font-bold" style={{ color: colors.text.header }}>
            {t('tools.title')}
          </h3>
          <p className="text-sm" style={{ color: colors.text.muted }}>
            {t('tools.subtitle')}
          </p>
        </div>

        {/* Apply to All Agents Toggle */}
        <div
          className="flex items-center space-x-3 p-4 rounded-lg"
          style={{ backgroundColor: colors.bg.secondary }}
        >
          <input
            type="checkbox"
            id="apply-to-all-agents"
            checked={applyToAllAgents}
            onChange={(e) => setApplyToAllAgents(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
          />
          <label
            htmlFor="apply-to-all-agents"
            className="flex-1 cursor-pointer select-none"
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium" style={{ color: colors.text.header }}>
                  {t('tools.applyToAllAgents')}
                </span>
                <p className="text-xs mt-1" style={{ color: colors.text.muted }}>
                  {t('tools.applyToAllAgentsDesc')}
                </p>
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3" style={{ color: colors.text.muted }} />
              <p className="text-sm" style={{ color: colors.text.muted }}>
                {t('tools.loadingConfig')}
              </p>
            </div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center max-w-md">
              <AlertCircle className="h-12 w-12 mx-auto mb-4" style={{ color: '#f87171' }} />
              <h4 className="text-lg font-semibold mb-2" style={{ color: colors.text.header }}>
                {t('tools.failedToLoad')}
              </h4>
              <p className="text-sm mb-4" style={{ color: colors.text.muted }}>
                {error}
              </p>
              <button
                onClick={loadConfig}
                className="px-4 py-2 rounded-lg font-medium transition-colors"
                style={{ backgroundColor: colors.accent.brand, color: '#ffffff' }}
              >
                {t('common.retry')}
              </button>
            </div>
          </div>
        ) : config ? (
          <div className="space-y-6">
            {/* Inline save error banner */}
            {saveError && (
              <div
                className="flex items-center justify-between p-3 rounded-lg"
                style={{ backgroundColor: '#7f1d1d20', border: '1px solid #f87171' }}
              >
                <div className="flex items-center space-x-2">
                  <AlertCircle className="h-4 w-4 shrink-0" style={{ color: '#f87171' }} />
                  <span className="text-sm" style={{ color: '#f87171' }}>{saveError}</span>
                </div>
                <button
                  onClick={() => setSaveError(null)}
                  className="text-xs px-2 py-0.5 rounded ml-4"
                  style={{ color: colors.text.muted }}
                >
                  ✕
                </button>
              </div>
            )}

            {/* Windows System Permissions */}
            {platform === 'win32' && (
              <WindowsPermissionsSection colors={colors} />
            )}

            {/* macOS System Permissions */}
            {permissions && (
              <div
                className="rounded-lg p-6"
                style={{ backgroundColor: colors.bg.secondary }}
              >
                <div className="flex items-center space-x-3 mb-4">
                  <Shield className="h-5 w-5" style={{ color: colors.accent.purple }} />
                  <h4 className="text-lg font-semibold" style={{ color: colors.text.header }}>
                    {t('tools.macPermissions')}
                  </h4>
                </div>
                <p className="text-sm mb-4" style={{ color: colors.text.muted }}>
                  {t('tools.macPermissionsDesc')}
                </p>
                <div className="space-y-2">
                  {permissions.map((perm) => {
                    const isRequesting = requestingPermission === perm.id;
                    const statusColor =
                      perm.status === 'granted' ? colors.accent.green :
                      perm.status === 'denied' ? colors.text.danger :
                      perm.status === 'restricted' ? colors.accent.yellow :
                      colors.text.muted;
                    const statusLabel =
                      perm.status === 'granted' ? t('tools.granted') :
                      perm.status === 'denied' ? t('tools.denied') :
                      perm.status === 'restricted' ? t('tools.restricted') :
                      t('tools.notDetermined');
                    const actionLabel = perm.canRequestInApp ? t('tools.requestAccess') : t('tools.openSettings');

                    return (
                      <div
                        key={perm.id}
                        className="flex items-center justify-between p-3 rounded"
                        style={{ backgroundColor: colors.bg.tertiary }}
                      >
                        <div className="flex items-center space-x-3">
                          <span style={{ color: statusColor }}>{perm.icon}</span>
                          <div>
                            <div className="text-sm font-medium" style={{ color: colors.text.header }}>
                              {perm.label}
                            </div>
                            <div className="text-xs" style={{ color: colors.text.muted }}>
                              {perm.description}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center space-x-3 shrink-0">
                          <span
                            className="text-xs font-medium px-2 py-0.5 rounded-full"
                            style={{
                              color: statusColor,
                              backgroundColor: statusColor + '20',
                            }}
                          >
                            {statusLabel}
                          </span>
                          {perm.status !== 'granted' && perm.status !== 'restricted' && (
                            <button
                              onClick={() => handlePermissionAction(perm)}
                              disabled={isRequesting}
                              className="text-xs px-3 py-1 rounded font-medium transition-colors disabled:opacity-50"
                              style={{
                                backgroundColor: colors.bg.primary,
                                color: colors.text.link,
                              }}
                            >
                              {isRequesting
                                ? (perm.canRequestInApp ? t('tools.requesting') : t('tools.opening'))
                                : actionLabel}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Profile Preset Selector */}
            <div
              className="rounded-lg p-6"
              style={{ backgroundColor: colors.bg.secondary }}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <Settings className="h-5 w-5" style={{ color: colors.accent.brand }} />
                  <h4 className="text-lg font-semibold" style={{ color: colors.text.header }}>
                    {t('tools.toolProfilePresets')}
                  </h4>
                </div>
                {saveSuccess && (
                  <div className="flex items-center space-x-2 text-green-500">
                    <Check className="h-4 w-4" />
                    <span className="text-sm">{t('tools.saved')}</span>
                  </div>
                )}
              </div>

              <p className="text-sm mb-4" style={{ color: colors.text.muted }}>
                {t('tools.profilePresetsDesc')}
              </p>

              <div className="grid grid-cols-2 gap-3">
                {/* Minimal Profile */}
                <button
                  onClick={() => handleProfileChange('minimal')}
                  disabled={saving || config.profile === 'minimal'}
                  className={`p-4 rounded-lg border-2 transition-all text-left ${
                    config.profile === 'minimal' ? 'border-blue-500' : 'border-transparent hover:border-blue-400'
                  }`}
                  style={{
                    backgroundColor: config.profile === 'minimal' ? colors.accent.brand + '20' : colors.bg.tertiary,
                    opacity: saving ? 0.5 : 1
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm" style={{ color: colors.text.header }}>
                      🔒 {t('tools.safeMode')}
                    </span>
                    {config.profile === 'minimal' && (
                      <div className="h-2 w-2 rounded-full bg-blue-500" />
                    )}
                  </div>
                  <p className="text-xs" style={{ color: colors.text.muted }}>
                    {t('tools.safeModeDesc')}
                  </p>
                </button>

                {/* Coding Profile */}
                <button
                  onClick={() => handleProfileChange('coding')}
                  disabled={saving || config.profile === 'coding'}
                  className={`p-4 rounded-lg border-2 transition-all text-left ${
                    config.profile === 'coding' ? 'border-green-500' : 'border-transparent hover:border-green-400'
                  }`}
                  style={{
                    backgroundColor: config.profile === 'coding' ? colors.accent.green + '20' : colors.bg.tertiary,
                    opacity: saving ? 0.5 : 1
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm" style={{ color: colors.text.header }}>
                      💻 {t('tools.assistant')}
                    </span>
                    {config.profile === 'coding' && (
                      <div className="h-2 w-2 rounded-full bg-green-500" />
                    )}
                  </div>
                  <p className="text-xs" style={{ color: colors.text.muted }}>
                    {t('tools.assistantDesc')}
                  </p>
                </button>

                {/* Messaging Profile */}
                <button
                  onClick={() => handleProfileChange('messaging')}
                  disabled={saving || config.profile === 'messaging'}
                  className={`p-4 rounded-lg border-2 transition-all text-left ${
                    config.profile === 'messaging' ? 'border-purple-500' : 'border-transparent hover:border-purple-400'
                  }`}
                  style={{
                    backgroundColor: config.profile === 'messaging' ? colors.accent.purple + '20' : colors.bg.tertiary,
                    opacity: saving ? 0.5 : 1
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm" style={{ color: colors.text.header }}>
                      💬 {t('tools.chatbot')}
                    </span>
                    {config.profile === 'messaging' && (
                      <div className="h-2 w-2 rounded-full bg-purple-500" />
                    )}
                  </div>
                  <p className="text-xs" style={{ color: colors.text.muted }}>
                    {t('tools.chatbotDesc')}
                  </p>
                </button>

                {/* Full Profile */}
                <button
                  onClick={() => handleProfileChange('full')}
                  disabled={saving || config.profile === 'full'}
                  className={`p-4 rounded-lg border-2 transition-all text-left ${
                    config.profile === 'full' ? 'border-yellow-500' : 'border-transparent hover:border-yellow-400'
                  }`}
                  style={{
                    backgroundColor: config.profile === 'full' ? colors.accent.yellow + '20' : colors.bg.tertiary,
                    opacity: saving ? 0.5 : 1
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm" style={{ color: colors.text.header }}>
                      ⚡ {t('tools.powerUser')}
                    </span>
                    {config.profile === 'full' && (
                      <div className="h-2 w-2 rounded-full bg-yellow-500" />
                    )}
                  </div>
                  <p className="text-xs" style={{ color: colors.text.muted }}>
                    {t('tools.powerUserDesc')}
                  </p>
                </button>
              </div>

              {saving && (
                <div className="flex items-center justify-center mt-4 space-x-2" style={{ color: colors.text.muted }}>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">{t('tools.savingChanges')}</span>
                </div>
              )}
            </div>

            {/* Execution Tools */}
            <div
              className="rounded-lg p-6"
              style={{ backgroundColor: colors.bg.secondary }}
            >
              <div className="flex items-center space-x-3 mb-1">
                <Terminal className="h-5 w-5" style={{ color: colors.accent.green }} />
                <h4 className="text-lg font-semibold" style={{ color: colors.text.header }}>
                  {t('tools.runCommands')}
                </h4>
              </div>
              <p className="text-sm mb-4" style={{ color: colors.text.muted }}>
                {t('tools.runCommandsDesc')}
              </p>

              <div className="space-y-3">
                {/* Host Mode Selector */}
                <div className="p-3 rounded" style={{ backgroundColor: colors.bg.tertiary }}>
                  <div className="font-medium text-sm mb-2" style={{ color: colors.text.header }}>
                    {t('tools.whereCommandsRun')}
                  </div>
                  <select
                    value={config.exec?.host || 'sandbox'}
                    onChange={(e) => handleExecHostChange(e.target.value as any)}
                    disabled={saving}
                    className="w-full px-3 py-2 rounded border text-sm"
                    style={{
                      backgroundColor: colors.bg.primary,
                      borderColor: colors.bg.tertiary,
                      color: colors.text.header,
                      opacity: saving ? 0.5 : 1
                    }}
                  >
                    <option value="sandbox">{t('tools.sandbox')}</option>
                    <option value="gateway">{t('tools.gateway')}</option>
                    <option value="node">{t('tools.node')}</option>
                  </select>
                  <div className="text-xs mt-2" style={{ color: colors.text.muted }}>
                    {config.exec?.host === 'sandbox' && `✓ ${t('tools.sandboxHint')}`}
                    {config.exec?.host === 'gateway' && `⚠️ ${t('tools.gatewayHint')}`}
                    {config.exec?.host === 'node' && `ℹ️ ${t('tools.nodeHint')}`}
                  </div>
                </div>

                {/* Security Mode Selector */}
                <div className="p-3 rounded" style={{ backgroundColor: colors.bg.tertiary }}>
                  <div className="font-medium text-sm mb-2" style={{ color: colors.text.header }}>
                    {t('tools.whichCommandsAllowed')}
                  </div>
                  <select
                    value={config.exec?.security || 'allowlist'}
                    onChange={(e) => handleExecSecurityChange(e.target.value as any)}
                    disabled={saving}
                    className="w-full px-3 py-2 rounded border text-sm"
                    style={{
                      backgroundColor: colors.bg.primary,
                      borderColor: colors.bg.tertiary,
                      color: colors.text.header,
                      opacity: saving ? 0.5 : 1
                    }}
                  >
                    <option value="deny">{t('tools.deny')}</option>
                    <option value="allowlist">{t('tools.allowlist')}</option>
                    <option value="full">{t('tools.full')}</option>
                  </select>
                  <div className="text-xs mt-2" style={{ color: colors.text.muted }}>
                    {config.exec?.security === 'deny' && `🔒 ${t('tools.denyHint')}`}
                    {config.exec?.security === 'allowlist' && `✓ ${t('tools.allowlistHint')}`}
                    {config.exec?.security === 'full' && `⚠️ ${t('tools.fullHint')}`}
                  </div>
                </div>

                {config.exec?.security === 'allowlist' && config.exec?.safeBins && (
                  <div className="p-3 rounded" style={{ backgroundColor: colors.bg.tertiary }}>
                    <div className="font-medium text-sm mb-2" style={{ color: colors.text.header }}>
                      {t('tools.approvedCommands', { count: config.exec.safeBins.length })}
                    </div>
                    <div className="text-xs" style={{ color: colors.text.muted }}>
                      {config.exec.safeBins.length > 0 ? (
                        <>
                          {config.exec.safeBins.slice(0, 10).join(', ')}
                          {config.exec.safeBins.length > 10 && ` … ${t('tools.andMore', { count: config.exec.safeBins.length - 10 })}`}
                        </>
                      ) : (
                        t('tools.noSafeCommands')
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Web Tools */}
            <div
              className="rounded-lg p-6"
              style={{ backgroundColor: colors.bg.secondary }}
            >
              <div className="flex items-center space-x-3 mb-1">
                <Globe className="h-5 w-5" style={{ color: colors.accent.purple }} />
                <h4 className="text-lg font-semibold" style={{ color: colors.text.header }}>
                  {t('tools.internetAccess')}
                </h4>
              </div>
              <p className="text-sm mb-4" style={{ color: colors.text.muted }}>
                {t('tools.internetAccessDesc')}
              </p>

              <div className="space-y-3">
                {/* Web Search Toggle */}
                <div className="flex items-center justify-between p-3 rounded" style={{ backgroundColor: colors.bg.tertiary }}>
                  <div>
                    <div className="font-medium text-sm mb-1" style={{ color: colors.text.header }}>
                      {t('tools.searchTheWeb')}
                    </div>
                    <div className="text-xs" style={{ color: colors.text.muted }}>
                      {t('tools.searchTheWebDesc')}
                    </div>
                  </div>
                  <button
                    onClick={() => handleWebSearchToggle(!config.web?.search?.enabled)}
                    disabled={saving}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      config.web?.search?.enabled ? 'bg-green-500' : 'bg-gray-600'
                    }`}
                    style={{ opacity: saving ? 0.5 : 1 }}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        config.web?.search?.enabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Web Fetch Toggle */}
                <div className="flex items-center justify-between p-3 rounded" style={{ backgroundColor: colors.bg.tertiary }}>
                  <div>
                    <div className="font-medium text-sm mb-1" style={{ color: colors.text.header }}>
                      {t('tools.readWebPages')}
                    </div>
                    <div className="text-xs" style={{ color: colors.text.muted }}>
                      {t('tools.readWebPagesDesc')}
                    </div>
                  </div>
                  <button
                    onClick={() => handleWebFetchToggle(!config.web?.fetch?.enabled)}
                    disabled={saving}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      config.web?.fetch?.enabled ? 'bg-green-500' : 'bg-gray-600'
                    }`}
                    style={{ opacity: saving ? 0.5 : 1 }}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        config.web?.fetch?.enabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>

            {/* Media Tools */}
            <div
              className="rounded-lg p-6"
              style={{ backgroundColor: colors.bg.secondary }}
            >
              <div className="flex items-center space-x-3 mb-1">
                <Image className="h-5 w-5" style={{ color: colors.accent.yellow }} />
                <h4 className="text-lg font-semibold" style={{ color: colors.text.header }}>
                  {t('tools.seeAndHear')}
                </h4>
              </div>
              <p className="text-sm mb-4" style={{ color: colors.text.muted }}>
                {t('tools.seeAndHearDesc')}
              </p>

              <div className="space-y-3">
                {/* Image Understanding Toggle */}
                <div className="flex items-center justify-between p-3 rounded" style={{ backgroundColor: colors.bg.tertiary }}>
                  <div>
                    <div className="font-medium text-sm mb-1" style={{ color: colors.text.header }}>
                      {t('tools.photosImages')}
                    </div>
                    <div className="text-xs" style={{ color: colors.text.muted }}>
                      {t('tools.photosImagesDesc')}
                    </div>
                  </div>
                  <button
                    onClick={() => handleMediaToggle('image', !config.media?.image?.enabled)}
                    disabled={saving}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      config.media?.image?.enabled ? 'bg-green-500' : 'bg-gray-600'
                    }`}
                    style={{ opacity: saving ? 0.5 : 1 }}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        config.media?.image?.enabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Audio Understanding Toggle */}
                <div className="flex items-center justify-between p-3 rounded" style={{ backgroundColor: colors.bg.tertiary }}>
                  <div>
                    <div className="font-medium text-sm mb-1" style={{ color: colors.text.header }}>
                      {t('tools.voiceMessagesAudio')}
                    </div>
                    <div className="text-xs" style={{ color: colors.text.muted }}>
                      {t('tools.voiceMessagesAudioDesc')}
                    </div>
                  </div>
                  <button
                    onClick={() => handleMediaToggle('audio', !config.media?.audio?.enabled)}
                    disabled={saving}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      config.media?.audio?.enabled ? 'bg-green-500' : 'bg-gray-600'
                    }`}
                    style={{ opacity: saving ? 0.5 : 1 }}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        config.media?.audio?.enabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Video Understanding Toggle */}
                <div className="flex items-center justify-between p-3 rounded" style={{ backgroundColor: colors.bg.tertiary }}>
                  <div>
                    <div className="font-medium text-sm mb-1" style={{ color: colors.text.header }}>
                      {t('tools.videos')}
                    </div>
                    <div className="text-xs" style={{ color: colors.text.muted }}>
                      {t('tools.videosDesc')}
                    </div>
                  </div>
                  <button
                    onClick={() => handleMediaToggle('video', !config.media?.video?.enabled)}
                    disabled={saving}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      config.media?.video?.enabled ? 'bg-green-500' : 'bg-gray-600'
                    }`}
                    style={{ opacity: saving ? 0.5 : 1 }}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        config.media?.video?.enabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>

            {/* Links Tool */}
            <div
              className="rounded-lg p-6"
              style={{ backgroundColor: colors.bg.secondary }}
            >
              <div className="flex items-center space-x-3 mb-1">
                <Link className="h-5 w-5" style={{ color: colors.accent.brand }} />
                <h4 className="text-lg font-semibold" style={{ color: colors.text.header }}>
                  {t('tools.smartLinks')}
                </h4>
              </div>

              <div className="flex items-center justify-between p-3 rounded" style={{ backgroundColor: colors.bg.tertiary }}>
                <div>
                  <div className="font-medium text-sm mb-1" style={{ color: colors.text.header }}>
                    {t('tools.understandLinks')}
                  </div>
                  <div className="text-xs" style={{ color: colors.text.muted }}>
                    {t('tools.understandLinksDesc')}
                  </div>
                </div>
                <button
                  onClick={() => handleLinksToggle(!config.links?.enabled)}
                  disabled={saving}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    config.links?.enabled ? 'bg-green-500' : 'bg-gray-600'
                  }`}
                  style={{ opacity: saving ? 0.5 : 1 }}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      config.links?.enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Elevated Tools */}
            <div
              className="rounded-lg p-6"
              style={{ backgroundColor: colors.bg.secondary }}
            >
              <div className="flex items-center space-x-3 mb-1">
                <AlertCircle className="h-5 w-5" style={{ color: colors.accent.red }} />
                <h4 className="text-lg font-semibold" style={{ color: colors.text.header }}>
                  {t('tools.advancedActions')}
                </h4>
              </div>

              <div className="flex items-center justify-between p-3 rounded" style={{ backgroundColor: colors.bg.tertiary }}>
                <div>
                  <div className="font-medium text-sm mb-1" style={{ color: colors.text.header }}>
                    {t('tools.allowSensitiveOps')}
                  </div>
                  <div className="text-xs" style={{ color: colors.text.muted }}>
                    {t('tools.allowSensitiveOpsDesc')}
                  </div>
                </div>
                <button
                  onClick={() => handleElevatedToggle(!config.elevated?.enabled)}
                  disabled={saving}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    config.elevated?.enabled ? 'bg-green-500' : 'bg-gray-600'
                  }`}
                  style={{ opacity: saving ? 0.5 : 1 }}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      config.elevated?.enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>

          </div>
        ) : null}
      </div>
    </div>
  );
};
