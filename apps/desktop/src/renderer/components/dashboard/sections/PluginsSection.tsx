import React, { useEffect, useState } from 'react'
import { Button } from '../../ui/button'
import {
  CheckCircle,
  AlertCircle,
  ExternalLink,
  Info,
  Loader2,
  RefreshCw,
  Power,
  Puzzle,
  Search,
  Download,
  RefreshCcw,
  Plus,
  Stethoscope,
  List,
  Grid,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../../contexts/ToastContext'
import { ColorTheme } from '../types'
import { EmptyState } from '../../ui/empty-state'
import { MascotIllustration } from '../../ui/mascot-illustration'
import { AnimatedNumber } from '../../ui/animated-number'
import { Skeleton, SkeletonCard } from '../../ui/skeleton'

interface Plugin {
  id: string
  name: string
  version: string
  description: string
  enabled: boolean
  status: 'enabled' | 'disabled' | 'error' | 'needs-config'
  source?: string
  origin?: 'bundled' | 'installed' | string
  homepage?: string
  /** Raw error / status message from the CLI (e.g. "bundled (disabled by default)") */
  cliError?: string
  /** True when the CLI reports required config fields are missing */
  needsConfig?: boolean
}

interface OfficialPlugin {
  id: string
  name: string
  description: string
  installSpec: string
  docsUrl: string
  category: string
}

// Curated featured-plugins set surfaced on the Install tab. These are
// non-bundled extensions users would actually want one-click access to —
// upstream ships ~134 bundled plugins (auto-enabled, no install needed)
// plus a long tail of ClawHub community plugins (discoverable via
// `openclaw plugins search`). The CLI is the source of truth; this list
// only seeds the most commonly requested install flows for the desktop.
//
// To find more installable plugins:
//   openclaw plugins search <query>
//   openclaw plugins install clawhub:<package-name>
//
// Last refreshed against `openclaw plugins search` output on 2026-06-15
// (OpenClaw 2026.6.2). Add new entries here only when the upstream docs
// promote one to "featured" or when we ship a strong UX for it.
const OFFICIAL_PLUGINS: OfficialPlugin[] = [
  {
    id: 'voice-call',
    name: 'Voice Call',
    description:
      'AI-powered voice calls using Twilio, Telnyx, or Plivo. Enable your AI agent to make and receive phone calls with real-time transcription.',
    installSpec: 'voice-call',
    docsUrl: 'https://docs.openclaw.ai/plugins/voice-call',
    category: 'Communication',
  },
  {
    id: 'ai-readme-mcp',
    name: 'AI README',
    description:
      'Manages AI_README.md files that document your project\'s conventions for AI assistants. Persistent memory of project rules across every session.',
    installSpec: 'clawhub:ai-readme-mcp',
    docsUrl: 'https://docs.openclaw.ai/plugins/clawhub',
    category: 'Productivity',
  },
  {
    id: 'ai-security-audit-pro',
    name: 'AI Security Audit',
    description:
      'Universal security-audit plugin and CLI engine for AI agents with OWASP-mapped reports.',
    installSpec: 'clawhub:ai-security-audit-pro',
    docsUrl: 'https://docs.openclaw.ai/plugins/clawhub',
    category: 'Security',
  },
  {
    id: 'ai4scholar',
    name: 'AI4Scholar',
    description:
      'Multi-source academic literature search, management, and analysis. Powered by ai4scholar.net.',
    installSpec: 'clawhub:ai4scholar',
    docsUrl: 'https://docs.openclaw.ai/plugins/clawhub',
    category: 'Research',
  },
]

interface PluginsSectionProps {
  colors: ColorTheme
}

/** Extract missing required fields from a CLI config-validation error message */
function parseMissingConfig(errMsg: string): string[] {
  const matches = errMsg.match(/must have required property '([^']+)'/g) || []
  return matches.map(m => {
    const m2 = m.match(/'([^']+)'/)
    return m2 ? m2[1] : ''
  }).filter(Boolean)
}

export const PluginsSection: React.FC<PluginsSectionProps> = ({ colors }) => {
  const { t } = useTranslation()
  const { addToast } = useToast()
  const [activeTab, setActiveTab] = useState<'installed' | 'install'>('installed')
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toggleLoading, setToggleLoading] = useState<Set<string>>(new Set())
  const [updateLoading, setUpdateLoading] = useState<Set<string>>(new Set())
  const [installLoading, setInstallLoading] = useState<Set<string>>(new Set())
  const [customInstallSpec, setCustomInstallSpec] = useState('')
  const [customInstalling, setCustomInstalling] = useState(false)
  const [doctorLoading, setDoctorLoading] = useState(false)
  const [searchFilter, setSearchFilter] = useState('')
  const [pluginStats, setPluginStats] = useState({ total: 0, enabled: 0, disabled: 0 })
  const [gatewayOff, setGatewayOff] = useState(false)
  /** Per-plugin inline error messages (replaces blocking alert()) */
  const [inlineErrors, setInlineErrors] = useState<Record<string, string>>({})

  const setInlineError = (pluginId: string, msg: string) =>
    setInlineErrors(prev => ({ ...prev, [pluginId]: msg }))
  const clearInlineError = (pluginId: string) =>
    setInlineErrors(prev => { const n = { ...prev }; delete n[pluginId]; return n })

  const loadPlugins = async (silent = false) => {
    if (!silent) { setLoading(true) }
    setError(null)

    try {
      console.log('[PluginsSection] Loading plugins...')
      const result = await window.electronAPI.listPlugins()

      setGatewayOff(!result.success)

      const pluginsData: Plugin[] = (result.success ? result.plugins || [] : []).map((p: any) => {
        const isEnabled = p.enabled !== false && !p.disabled
        const cliError: string | undefined = p.error || undefined
        // "disabled by default" is an informational message, not a blocking error
        const isInfoMsg = cliError && (
          cliError.includes('disabled by default') ||
          cliError.includes('bundled')
        )
        const needsConfig = cliError && !isInfoMsg &&
          cliError.toLowerCase().includes('config')

        let status: Plugin['status']
        if (!isEnabled && needsConfig) {
          status = 'needs-config'
        } else if (!isEnabled) {
          status = 'disabled'
        } else if (cliError && !isInfoMsg) {
          status = 'error'
        } else {
          status = 'enabled'
        }

        return {
          id: p.id || p.name,
          name: p.name || p.id,
          version: p.version || 'unknown',
          description: p.description || 'No description available',
          enabled: isEnabled,
          status,
          source: p.source || 'installed',
          origin: p.origin || 'unknown',
          homepage: p.homepage,
          cliError,
          needsConfig: !!needsConfig,
        }
      })

      setPlugins(pluginsData)
      setPluginStats({
        total: pluginsData.length,
        enabled: pluginsData.filter(p => p.status === 'enabled').length,
        disabled: pluginsData.filter(p => p.status === 'disabled' || p.status === 'needs-config' || p.status === 'error').length,
      })
    } catch (err: any) {
      console.error('[PluginsSection] Error loading plugins:', err)
      setError(err.message || 'Failed to load plugins')
    } finally {
      setLoading(false)
    }
  }

  const togglePlugin = async (pluginId: string, currentEnabled: boolean) => {
    clearInlineError(pluginId)
    setToggleLoading(prev => new Set(prev).add(pluginId))
    try {
      const result = currentEnabled
        ? await window.electronAPI.disablePlugin(pluginId)
        : await window.electronAPI.enablePlugin(pluginId)

      if (result.success) {
        await loadPlugins(true)
      } else {
        const rawErr = result.error || 'Failed to update plugin'
        // Show config-validation errors inline with friendly guidance
        if (rawErr.includes('Config validation failed') || rawErr.includes('must have required property')) {
          const missing = parseMissingConfig(rawErr)
          const hint = missing.length
            ? `This plugin requires configuration before it can be enabled. Missing fields: ${missing.join(', ')}. See the plugin docs for setup instructions.`
            : 'This plugin requires configuration before it can be enabled. See the plugin docs for setup instructions.'
          setInlineError(pluginId, hint)
        } else {
          setInlineError(pluginId, rawErr)
        }
      }
    } catch (err: any) {
      console.error(`[PluginsSection] Error toggling plugin ${pluginId}:`, err)
      setInlineError(pluginId, err.message || 'Failed to update plugin')
    } finally {
      setToggleLoading(prev => {
        const newSet = new Set(prev)
        newSet.delete(pluginId)
        return newSet
      })
    }
  }

  const updatePlugin = async (pluginId: string) => {
    clearInlineError(pluginId)
    setUpdateLoading(prev => new Set(prev).add(pluginId))
    try {
      const result = await window.electronAPI.updatePlugin(pluginId)
      if (result.success) {
        await loadPlugins(true)
      } else {
        setInlineError(pluginId, result.error || 'Failed to update plugin')
      }
    } catch (err: any) {
      console.error(`[PluginsSection] Error updating plugin ${pluginId}:`, err)
      setInlineError(pluginId, err.message || 'Failed to update plugin')
    } finally {
      setUpdateLoading(prev => {
        const newSet = new Set(prev)
        newSet.delete(pluginId)
        return newSet
      })
    }
  }

  const installOfficialPlugin = async (plugin: OfficialPlugin) => {
    setInstallLoading(prev => new Set(prev).add(plugin.id))
    try {
      const result = await window.electronAPI.installPlugin(plugin.installSpec)
      if (result.success) {
        await loadPlugins(true)
        setActiveTab('installed')
      } else {
        setInlineError(plugin.id, result.error || `Failed to install "${plugin.name}"`)
      }
    } catch (err: any) {
      console.error(`[PluginsSection] Error installing plugin ${plugin.id}:`, err)
      setInlineError(plugin.id, err.message || 'Failed to install plugin')
    } finally {
      setInstallLoading(prev => {
        const newSet = new Set(prev)
        newSet.delete(plugin.id)
        return newSet
      })
    }
  }

  const installCustomPlugin = async () => {
    const spec = customInstallSpec.trim()
    if (!spec) { return }

    setCustomInstalling(true)
    setError(null)
    try {
      const result = await window.electronAPI.installPlugin(spec)
      if (result.success) {
        setCustomInstallSpec('')
        await loadPlugins(true)
        setActiveTab('installed')
      } else {
        setError(result.error || `Failed to install "${spec}"`)
      }
    } catch (err: any) {
      console.error(`[PluginsSection] Error installing custom plugin ${spec}:`, err)
      setError(err.message || 'Failed to install plugin')
    } finally {
      setCustomInstalling(false)
    }
  }

  const runDoctor = async () => {
    setDoctorLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.runPluginsDoctor()
      if (result.success) {
        addToast(t('plugins.doctorComplete', 'Diagnostics complete'), 'success')
      } else {
        setError(result.error || t('plugins.doctorFailed'))
      }
    } catch (err: any) {
      console.error('[PluginsSection] Error running plugins doctor:', err)
      setError(err.message || 'Failed to run doctor')
    } finally {
      setDoctorLoading(false)
    }
  }

  const filteredPlugins = plugins.filter(plugin => {
    if (!searchFilter.trim()) { return true }
    const searchLower = searchFilter.toLowerCase()
    return plugin.name.toLowerCase().includes(searchLower) ||
      plugin.description.toLowerCase().includes(searchLower)
  })

  const isAlreadyInstalled = (officialPlugin: OfficialPlugin) => {
    return plugins.some(p =>
      p.id === officialPlugin.id ||
      p.id === officialPlugin.installSpec ||
      p.name === officialPlugin.id
    )
  }

  const isExternallyInstalled = (officialPlugin: OfficialPlugin) => {
    const match = plugins.find(p =>
      p.id === officialPlugin.id ||
      p.id === officialPlugin.installSpec ||
      p.name === officialPlugin.id
    )
    return match && match.origin !== 'bundled'
  }

  const getStatusIcon = (plugin: Plugin) => {
    switch (plugin.status) {
      case 'enabled':
        return <CheckCircle className="h-4 w-4" style={{ color: colors.accent.green }} />
      case 'needs-config':
        return <AlertCircle className="h-4 w-4" style={{ color: colors.accent.yellow }} />
      case 'error':
        return <AlertCircle className="h-4 w-4" style={{ color: colors.accent.red }} />
      default:
        return <Power className="h-4 w-4" style={{ color: colors.text.muted }} />
    }
  }

  const getStatusColor = (plugin: Plugin) => {
    switch (plugin.status) {
      case 'enabled': return colors.accent.green
      case 'needs-config': return colors.accent.yellow
      case 'error': return colors.accent.red
      default: return colors.text.muted
    }
  }

  const getStatusLabel = (plugin: Plugin) => {
    switch (plugin.status) {
      case 'needs-config': return t('plugins.needsConfig')
      default: return plugin.status
    }
  }

  useEffect(() => {
    loadPlugins()
  }, [])

  if (loading) {
    // Skeleton scaffold that mirrors the real layout: stats row + search
    // bar + card list. Beats a centered spinner because the user sees
    // the section's shape immediately and content streams in — no
    // empty-then-full layout shift.
    return (
      <div className="p-6 h-full flex flex-col space-y-4" aria-busy="true" aria-label={t('plugins.loadingPlugins')}>
        {/* Stats row — three pills */}
        <div className="flex items-center gap-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-20 rounded-md" />
          ))}
        </div>
        {/* Search bar */}
        <Skeleton className="h-9 w-full max-w-md rounded-md" />
        {/* Plugin cards */}
        <div className="space-y-3 flex-1 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    )
  }


  return (
    <div className="p-8 h-full flex flex-col min-h-0">
      <div
        className="rounded-lg flex-1 flex flex-col min-h-0"
        style={{ backgroundColor: colors.bg.secondary }}
      >
        {/* Header */}
        <div className="p-6 pb-0 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <Puzzle className="h-6 w-6" style={{ color: colors.accent.brand }} />
              <h3 className="text-lg font-semibold" style={{ color: colors.text.header }}>
                {t('plugins.title')}
              </h3>
            </div>
            <div className="flex items-center space-x-2">
              <Button
                onClick={runDoctor}
                disabled={doctorLoading}
                size="sm"
                variant="outline"
                style={{ backgroundColor: colors.bg.tertiary, color: colors.text.muted, borderColor: colors.bg.hover }}
              >
                {doctorLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Stethoscope className="h-4 w-4 mr-2" />}
                {t('plugins.doctor')}
              </Button>
              <Button
                onClick={() => loadPlugins()}
                size="sm"
                style={{ backgroundColor: colors.accent.brand, color: colors.button.primaryFg, border: 'none' }}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('plugins.refresh')}
              </Button>
            </div>
          </div>

          <p className="text-sm mb-4" style={{ color: colors.text.muted }}>
            {t('plugins.subtitle')}
          </p>

          {/* Error banner — shown whenever load/install failed, independent of
              list length, so a gateway/IPC failure isn't hidden behind the
              cheerful "No plugins installed" empty state. */}
          {error && (
            <div
              className="flex items-start space-x-2 p-3 mb-4 rounded"
              style={{ backgroundColor: `${colors.accent.red}15`, border: `1px solid ${colors.accent.red}40` }}
            >
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: colors.accent.red }} />
              <p className="text-sm flex-1" style={{ color: colors.accent.red }}>{error}</p>
              <button onClick={() => setError(null)}>
                <X className="h-4 w-4" style={{ color: colors.accent.red }} />
              </button>
            </div>
          )}

          {/* Tab Bar */}
          <div className="flex space-x-1 mb-0" style={{ borderBottom: `1px solid ${colors.bg.tertiary}` }}>
            <button
              onClick={() => setActiveTab('installed')}
              className="flex items-center space-x-2 px-4 py-2 text-sm font-medium transition-colors"
              style={{
                color: activeTab === 'installed' ? colors.accent.brand : colors.text.muted,
                borderBottom: activeTab === 'installed' ? `2px solid ${colors.accent.brand}` : '2px solid transparent',
                marginBottom: '-1px'
              }}
            >
              <List className="h-4 w-4" />
              <span>{t('plugins.installed')} {pluginStats.total > 0 && `(${pluginStats.total})`}</span>
            </button>
            <button
              onClick={() => setActiveTab('install')}
              className="flex items-center space-x-2 px-4 py-2 text-sm font-medium transition-colors"
              style={{
                color: activeTab === 'install' ? colors.accent.brand : colors.text.muted,
                borderBottom: activeTab === 'install' ? `2px solid ${colors.accent.brand}` : '2px solid transparent',
                marginBottom: '-1px'
              }}
            >
              <Grid className="h-4 w-4" />
              <span>{t('plugins.installNew')}</span>
            </button>
          </div>
        </div>

        {/* ── INSTALLED TAB ── */}
        {activeTab === 'installed' && (
          <>
            <div className="px-6 pt-3 pb-2 flex-shrink-0">
              {/* Stats — each number tweens via AnimatedNumber when
                  enable/disable toggles change the count. */}
              <div className="flex items-center gap-5 mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-base font-bold" style={{ color: colors.text.header }}><AnimatedNumber value={pluginStats.total} /></span>
                  <span className="text-xs" style={{ color: colors.text.muted }}>{t('plugins.total')}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-base font-bold" style={{ color: colors.accent.green }}><AnimatedNumber value={pluginStats.enabled} /></span>
                  <span className="text-xs" style={{ color: colors.text.muted }}>{t('plugins.enabled')}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-base font-bold" style={{ color: colors.text.muted }}><AnimatedNumber value={pluginStats.disabled} /></span>
                  <span className="text-xs" style={{ color: colors.text.muted }}>{t('plugins.disabled')}</span>
                </div>
              </div>

              {/* Search */}
              {plugins.length > 0 && (
                <div className="flex items-center space-x-2 mb-2">
                  <div className="relative">
                    <Search className="h-4 w-4 absolute left-3 top-1/2 transform -translate-y-1/2" style={{ color: colors.text.muted }} />
                    <input
                      type="text"
                      placeholder={t('plugins.searchPlugins')}
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      className="pl-10 pr-4 py-2 border rounded-md text-sm w-80"
                      style={{
                        backgroundColor: colors.bg.primary,
                        borderColor: colors.bg.tertiary,
                        color: colors.text.normal
                      }}
                    />
                  </div>
                  {searchFilter && (
                    <span className="text-xs" style={{ color: colors.text.muted }}>
                      {t('plugins.pluginsOf', { count: filteredPlugins.length, total: plugins.length })}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex-1 px-6 pb-6 min-h-0 overflow-hidden">
              <div className="h-full overflow-y-auto overflow-x-hidden">
                <div className="space-y-3 pr-4">
                  {/* Gateway-off banner */}
                  {gatewayOff && (
                    <div
                      className="flex items-center p-3 mb-3 rounded-lg text-sm"
                      style={{ backgroundColor: `${colors.accent.yellow}15`, border: `1px solid ${colors.accent.yellow}30`, color: colors.accent.yellow }}
                    >
                      <Info className="h-4 w-4 mr-2 flex-shrink-0" />
                      {t('plugins.gatewayOffBanner')}
                    </div>
                  )}

                  {filteredPlugins.length === 0 && searchFilter ? (
                    <EmptyState
                      colors={colors}
                      illustration={<MascotIllustration mood="thinking" size={64} />}
                      title={t('plugins.noPluginsFound')}
                      description={t('plugins.noPluginsMatch', { search: searchFilter })}
                    />
                  ) : filteredPlugins.length === 0 && !gatewayOff ? (
                    <EmptyState
                      colors={colors}
                      illustration={<MascotIllustration mood="napping" />}
                      title={t('plugins.noPluginsInstalled')}
                      description={t('plugins.noPluginsInstalledDesc')}
                      action={
                        <Button
                          onClick={() => setActiveTab('install')}
                          style={{ backgroundColor: colors.accent.brand, color: colors.button.primaryFg, border: 'none' }}
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          {t('plugins.browsePlugins')}
                        </Button>
                      }
                    />
                  ) : filteredPlugins.length > 0 ? (
                    filteredPlugins.map((plugin, idx) => (
                      <div
                        key={`${plugin.id}-${idx}`}
                        className="rounded-lg p-4 transition-all duration-200"
                        style={{
                          backgroundColor: colors.bg.primary,
                        }}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-start space-x-3 flex-1">
                            <div className="text-xl flex-shrink-0">🧩</div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center space-x-2 mb-1">
                                <h4 className="font-medium text-sm" style={{ color: colors.text.header }}>
                                  {plugin.name}
                                </h4>
                                {getStatusIcon(plugin)}
                                <span
                                  className="px-2 py-0.5 text-xs rounded capitalize"
                                  style={{
                                    backgroundColor: `${getStatusColor(plugin)}20`,
                                    color: getStatusColor(plugin),
                                    border: `1px solid ${getStatusColor(plugin)}40`
                                  }}
                                >
                                  {getStatusLabel(plugin)}
                                </span>
                                <span className="text-xs" style={{ color: colors.text.muted }}>v{plugin.version}</span>
                              </div>
                              <p className="text-sm leading-relaxed" style={{ color: colors.text.muted }}>
                                {plugin.description}
                              </p>

                              {/* Inline error / config hint */}
                              {inlineErrors[plugin.id] && (
                                <div
                                  className="flex items-start space-x-2 mt-2 p-2 rounded text-xs"
                                  style={{ backgroundColor: `${colors.accent.yellow}15`, border: `1px solid ${colors.accent.yellow}40` }}
                                >
                                  <AlertCircle className="h-3 w-3 flex-shrink-0 mt-0.5" style={{ color: colors.accent.yellow }} />
                                  <span className="flex-1" style={{ color: colors.accent.yellow }}>{inlineErrors[plugin.id]}</span>
                                  <button onClick={() => clearInlineError(plugin.id)}>
                                    <X className="h-3 w-3" style={{ color: colors.accent.yellow }} />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center space-x-2 flex-shrink-0 ml-4">
                            {plugin.origin !== 'bundled' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => updatePlugin(plugin.id)}
                                disabled={updateLoading.has(plugin.id)}
                                title={t('plugins.updatePlugin')}
                                style={{ backgroundColor: colors.bg.tertiary, color: colors.accent.brand, borderColor: `${colors.accent.brand}88` }}
                              >
                                {updateLoading.has(plugin.id)
                                  ? <Loader2 className="h-4 w-4 animate-spin" />
                                  : <RefreshCcw className="h-4 w-4" />
                                }
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => togglePlugin(plugin.id, plugin.enabled)}
                              disabled={toggleLoading.has(plugin.id)}
                              title={plugin.enabled ? t('plugins.disablePlugin') : t('plugins.enablePlugin')}
                              style={{
                                backgroundColor: colors.bg.tertiary,
                                // Toggle color = the action the click performs.
                                color: plugin.enabled ? colors.button.destructive : colors.button.primary,
                                borderColor: plugin.enabled
                                  ? `${colors.button.destructive}88`
                                  : `${colors.button.primary}88`
                              }}
                            >
                              {toggleLoading.has(plugin.id)
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : <Power className="h-4 w-4" />
                              }
                            </Button>
                            {plugin.homepage && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => window.electronAPI?.openExternal?.(plugin.homepage!)}
                                style={{ backgroundColor: colors.bg.tertiary, color: colors.text.muted, borderColor: colors.bg.hover }}
                              >
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>

                        <div className="mt-3 pt-3 border-t text-xs" style={{ borderColor: colors.bg.tertiary }}>
                          <span style={{ color: colors.text.muted }}>
                            {plugin.origin === 'bundled' ? t('plugins.builtInPlugin') : t('plugins.sourceInstalled', { source: plugin.source || 'installed' })}
                          </span>
                          {plugin.status === 'needs-config' && (
                            <span className="ml-3" style={{ color: colors.accent.yellow }}>
                              {t('plugins.requiresConfig')}
                            </span>
                          )}
                          {!plugin.enabled && plugin.status === 'disabled' && (
                            <span className="ml-3" style={{ color: colors.text.muted }}>
                              {t('plugins.disabledClickEnable')}
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  ) : null}
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── INSTALL NEW TAB ── */}
        {activeTab === 'install' && (
          <>
            <div className="p-6 pb-4 flex-shrink-0">
              {/* Custom install */}
              <div
                className="p-4 rounded-lg mb-6"
                style={{ backgroundColor: colors.bg.tertiary }}
              >
                <h4 className="text-sm font-medium mb-1" style={{ color: colors.text.header }}>
                  {t('plugins.installFromSpec')}
                </h4>
                <p className="text-xs mb-3" style={{ color: colors.text.muted }}>
                  {t('plugins.installFromSpecDesc')} (e.g.{' '}
                  <code style={{ color: colors.accent.brand }}>voice-call</code> or{' '}
                  <code style={{ color: colors.accent.brand }}>@my-org/plugin-foo</code>)
                </p>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    placeholder="voice-call or @npm/package-name"
                    value={customInstallSpec}
                    onChange={(e) => setCustomInstallSpec(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && installCustomPlugin()}
                    className="flex-1 px-3 py-2 border rounded-md text-sm"
                    style={{
                      backgroundColor: colors.bg.primary,
                      borderColor: colors.bg.hover,
                      color: colors.text.normal
                    }}
                  />
                  <Button
                    onClick={installCustomPlugin}
                    disabled={customInstalling || !customInstallSpec.trim()}
                    style={{ backgroundColor: colors.accent.brand, color: colors.button.primaryFg, border: 'none' }}
                  >
                    {customInstalling ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    {t('plugins.install')}
                  </Button>
                </div>
              </div>

              <h4 className="text-sm font-medium mb-3" style={{ color: colors.text.header }}>
                {t('plugins.officialPlugins')}
              </h4>
            </div>

            <div className="flex-1 px-6 pb-6 min-h-0 overflow-hidden">
              <div className="h-full overflow-y-auto overflow-x-hidden">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pr-4 pb-4">
                  {OFFICIAL_PLUGINS.map((plugin) => {
                    const installed = isAlreadyInstalled(plugin)
                    const canUpdate = isExternallyInstalled(plugin)
                    const pluginErr = inlineErrors[plugin.id]
                    return (
                      <div
                        key={plugin.id}
                        className="rounded-lg p-4 flex flex-col"
                        style={{
                          backgroundColor: colors.bg.primary,
                        }}
                      >
                        <div className="flex items-start space-x-3 mb-3">
                          <div className="text-2xl flex-shrink-0">🧩</div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center space-x-2 mb-0.5">
                              <h4 className="font-semibold text-sm" style={{ color: colors.text.header }}>
                                {plugin.name}
                              </h4>
                              {installed && (
                                <span
                                  className="px-2 py-0.5 text-xs rounded"
                                  style={{
                                    backgroundColor: `${colors.accent.green}20`,
                                    color: colors.accent.green,
                                    border: `1px solid ${colors.accent.green}40`
                                  }}
                                >
                                  {t('plugins.installed').toLowerCase()}
                                </span>
                              )}
                            </div>
                            <span
                              className="text-xs px-2 py-0.5 rounded"
                              style={{
                                backgroundColor: `${colors.accent.brand}20`,
                                color: colors.accent.brand,
                                border: `1px solid ${colors.accent.brand}30`
                              }}
                            >
                              {plugin.category}
                            </span>
                          </div>
                        </div>

                        <p className="text-xs leading-relaxed flex-1 mb-3" style={{ color: colors.text.muted }}>
                          {plugin.description}
                        </p>

                        {pluginErr && (
                          <div
                            className="flex items-start space-x-2 mb-3 p-2 rounded text-xs"
                            style={{ backgroundColor: `${colors.accent.red}15`, border: `1px solid ${colors.accent.red}40` }}
                          >
                            <AlertCircle className="h-3 w-3 flex-shrink-0 mt-0.5" style={{ color: colors.accent.red }} />
                            <span className="flex-1" style={{ color: colors.accent.red }}>{pluginErr}</span>
                            <button onClick={() => clearInlineError(plugin.id)}>
                              <X className="h-3 w-3" style={{ color: colors.accent.red }} />
                            </button>
                          </div>
                        )}

                        <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: colors.bg.tertiary }}>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => window.electronAPI?.openExternal?.(plugin.docsUrl)}
                            style={{ backgroundColor: colors.bg.tertiary, color: colors.text.muted, borderColor: colors.bg.hover, fontSize: '11px', padding: '2px 8px' }}
                          >
                            <ExternalLink className="h-3 w-3 mr-1" />
                            {t('plugins.docs')}
                          </Button>
                          {canUpdate ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => updatePlugin(plugin.id)}
                              disabled={updateLoading.has(plugin.id)}
                              style={{ backgroundColor: colors.bg.tertiary, color: colors.accent.brand, borderColor: `${colors.accent.brand}88`, fontSize: '11px', padding: '2px 8px' }}
                            >
                              {updateLoading.has(plugin.id)
                                ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                : <RefreshCcw className="h-3 w-3 mr-1" />
                              }
                              {t('plugins.update')}
                            </Button>
                          ) : installed ? (
                            <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: `${colors.accent.green}20`, color: colors.accent.green, border: `1px solid ${colors.accent.green}40` }}>
                              {t('plugins.bundled')}
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => installOfficialPlugin(plugin)}
                              disabled={installLoading.has(plugin.id)}
                              style={{ backgroundColor: colors.accent.brand, color: colors.button.primaryFg, border: 'none', fontSize: '11px', padding: '2px 8px' }}
                            >
                              {installLoading.has(plugin.id)
                                ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                : <Download className="h-3 w-3 mr-1" />
                              }
                              {t('plugins.install')}
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
