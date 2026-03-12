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
  Zap,
  Search,
  Download,
  List,
  Plus,
  Stethoscope,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ColorTheme } from '../types'

interface Hook {
  name: string
  emoji: string
  description: string
  enabled: boolean
  status: 'enabled' | 'disabled' | 'error'
  source: string
  events?: string[]
  homepage?: string
}

interface HooksSectionProps {
  colors: ColorTheme
}

export const HooksSection: React.FC<HooksSectionProps> = ({ colors }) => {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<'manage' | 'install'>('manage')
  const [hooks, setHooks] = useState<Hook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [gatewayOff, setGatewayOff] = useState(false)
  const [toggleLoading, setToggleLoading] = useState<Set<string>>(new Set())
  const [searchFilter, setSearchFilter] = useState('')
  const [hooksStats, setHooksStats] = useState({ total: 0, enabled: 0, disabled: 0 })
  const [checkLoading, setCheckLoading] = useState(false)
  const [customInstallSpec, setCustomInstallSpec] = useState('')
  const [customInstalling, setCustomInstalling] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)

  const loadHooks = async (silent = false) => {
    if (!silent) { setLoading(true) }
    setError(null)

    try {
      console.log('[HooksSection] Loading hooks...')
      const result = await window.electronAPI.listHooks()

      setGatewayOff(!result.success)

      const hooksData: Hook[] = (result.success ? result.hooks || [] : []).map((hook: any) => {
        // CLI returns `disabled: boolean` (not `enabled`)
        const isEnabled = !hook.disabled
        return {
          name: hook.name,
          emoji: hook.emoji || '🪝',
          description: hook.description || 'No description available',
          enabled: isEnabled,
          status: !isEnabled ? 'disabled' : (hook.error ? 'error' : 'enabled'),
          source: hook.source || 'bundled',
          events: hook.events || [],
          homepage: hook.homepage,
        }
      })

      setHooks(hooksData)
      setHooksStats({
        total: hooksData.length,
        enabled: hooksData.filter(h => h.status === 'enabled').length,
        disabled: hooksData.filter(h => h.status === 'disabled').length,
      })
    } catch (err: any) {
      console.error('[HooksSection] Error loading hooks:', err)
      setError(err.message || 'Failed to load hooks')
    } finally {
      setLoading(false)
    }
  }

  const toggleHookEnabled = async (hookName: string, currentEnabled: boolean) => {
    setToggleLoading(prev => new Set(prev).add(hookName))
    try {
      const result = await window.electronAPI.setHookEnabled(hookName, !currentEnabled)
      if (result.success) {
        await loadHooks(true)
      } else {
        alert(result.error || 'Failed to update hook')
      }
    } catch (err: any) {
      console.error(`[HooksSection] Error toggling hook ${hookName}:`, err)
      alert(err.message || 'Failed to update hook')
    } finally {
      setToggleLoading(prev => {
        const newSet = new Set(prev)
        newSet.delete(hookName)
        return newSet
      })
    }
  }

  const runCheck = async () => {
    setCheckLoading(true)
    try {
      const result = await window.electronAPI.checkHooks()
      if (result.success) {
        const summary = result.status
          ? JSON.stringify(result.status, null, 2)
          : 'All hooks passed eligibility checks.'
        alert(summary)
      } else {
        alert(result.error || t('hooks.checkFailed'))
      }
    } catch (err: any) {
      console.error('[HooksSection] Error running hooks check:', err)
      alert(err.message || 'Failed to check hooks')
    } finally {
      setCheckLoading(false)
    }
  }

  const installCustomHook = async () => {
    const spec = customInstallSpec.trim()
    if (!spec) { return }

    setCustomInstalling(true)
    setInstallError(null)
    try {
      const result = await window.electronAPI.installHook(spec)
      if (result.success) {
        setCustomInstallSpec('')
        await loadHooks(true)
        setActiveTab('manage')
      } else {
        setInstallError(result.error || `Failed to install "${spec}"`)
      }
    } catch (err: any) {
      console.error(`[HooksSection] Error installing hook ${spec}:`, err)
      setInstallError(err.message || 'Failed to install hook')
    } finally {
      setCustomInstalling(false)
    }
  }

  const filteredHooks = hooks.filter(hook => {
    if (!searchFilter.trim()) { return true }
    const searchLower = searchFilter.toLowerCase()
    return hook.name.toLowerCase().includes(searchLower) ||
      hook.description.toLowerCase().includes(searchLower) ||
      (hook.events || []).some(e => e.toLowerCase().includes(searchLower))
  })

  useEffect(() => {
    loadHooks()
  }, [])

  if (loading) {
    return (
      <div className="p-8 h-full flex items-center justify-center">
        <div className="flex items-center space-x-3">
          <Loader2 className="h-6 w-6 animate-spin" style={{ color: colors.accent.brand }} />
          <span style={{ color: colors.text.normal }}>{t('hooks.loadingHooks')}</span>
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
        <div className="p-6 pb-0 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <Zap className="h-6 w-6" style={{ color: colors.accent.brand }} />
              <h3 className="text-lg font-semibold" style={{ color: colors.text.header }}>
                {t('hooks.title')}
              </h3>
            </div>
            <div className="flex items-center space-x-2">
              <Button
                onClick={runCheck}
                disabled={checkLoading || gatewayOff}
                size="sm"
                variant="outline"
                title={t('hooks.check')}
                style={{ backgroundColor: colors.bg.tertiary, color: colors.text.muted, borderColor: colors.bg.hover }}
              >
                {checkLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Stethoscope className="h-4 w-4 mr-2" />}
                {t('hooks.check')}
              </Button>
              <Button
                onClick={() => loadHooks()}
                size="sm"
                style={{ backgroundColor: colors.accent.brand, color: '#ffffff', border: 'none' }}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('hooks.refresh')}
              </Button>
            </div>
          </div>

          <p className="text-sm mb-4" style={{ color: colors.text.muted }}>
            {t('hooks.subtitle')}
          </p>

          {/* Tab Bar */}
          <div className="flex space-x-1 mb-0" style={{ borderBottom: `1px solid ${colors.bg.tertiary}` }}>
            <button
              onClick={() => setActiveTab('manage')}
              className="flex items-center space-x-2 px-4 py-2 text-sm font-medium transition-colors"
              style={{
                color: activeTab === 'manage' ? colors.accent.brand : colors.text.muted,
                borderBottom: activeTab === 'manage' ? `2px solid ${colors.accent.brand}` : '2px solid transparent',
                marginBottom: '-1px'
              }}
            >
              <List className="h-4 w-4" />
              <span>{t('hooks.manage')} {hooksStats.total > 0 && `(${hooksStats.total})`}</span>
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
              <Plus className="h-4 w-4" />
              <span>{t('hooks.install')}</span>
            </button>
          </div>
        </div>

        {/* ── MANAGE TAB ── */}
        {activeTab === 'manage' && (
          <>
            <div className="px-6 pt-3 pb-2 flex-shrink-0">
              {/* Stats */}
              <div className="flex items-center gap-5 mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-base font-bold" style={{ color: colors.text.header }}>{hooksStats.total}</span>
                  <span className="text-xs" style={{ color: colors.text.muted }}>{t('hooks.total')}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-base font-bold" style={{ color: colors.accent.green }}>{hooksStats.enabled}</span>
                  <span className="text-xs" style={{ color: colors.text.muted }}>{t('hooks.enabled')}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-base font-bold" style={{ color: colors.text.muted }}>{hooksStats.disabled}</span>
                  <span className="text-xs" style={{ color: colors.text.muted }}>{t('hooks.disabled')}</span>
                </div>
              </div>

              {/* Search */}
              {hooks.length > 0 && (
                <div className="flex items-center space-x-2 mb-2">
                  <div className="relative">
                    <Search className="h-4 w-4 absolute left-3 top-1/2 transform -translate-y-1/2" style={{ color: colors.text.muted }} />
                    <input
                      type="text"
                      placeholder={t('hooks.searchPlaceholder')}
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      className="pl-10 pr-4 py-2 border rounded-md text-sm w-96"
                      style={{
                        backgroundColor: colors.bg.primary,
                        borderColor: colors.bg.tertiary,
                        color: colors.text.normal
                      }}
                    />
                  </div>
                  {searchFilter && (
                    <span className="text-xs" style={{ color: colors.text.muted }}>
                      {t('hooks.hooksOf', { count: filteredHooks.length, total: hooks.length })}
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
                      {t('hooks.gatewayOffBanner')}
                    </div>
                  )}

                  {filteredHooks.length === 0 && searchFilter ? (
                    <div className="text-center py-8">
                      <div className="text-6xl mb-4">🔍</div>
                      <h3 className="text-lg font-medium mb-2" style={{ color: colors.text.header }}>
                        {t('hooks.noHooksFound')}
                      </h3>
                      <p className="text-sm" style={{ color: colors.text.muted }}>
                        {t('hooks.noHooksMatch', { search: searchFilter })}
                      </p>
                    </div>
                  ) : filteredHooks.length === 0 && !gatewayOff ? (
                    <div className="text-center py-8">
                      <div className="text-6xl mb-4">🪝</div>
                      <h3 className="text-lg font-medium mb-2" style={{ color: colors.text.header }}>
                        {t('hooks.noHooksAvailable')}
                      </h3>
                      <p className="text-sm" style={{ color: colors.text.muted }}>
                        {t('hooks.noHooksAvailableDesc')}
                      </p>
                    </div>
                  ) : filteredHooks.length > 0 ? (
                    filteredHooks.map((hook) => (
                      <div
                        key={hook.name}
                        className="rounded-lg p-4 transition-all duration-200"
                        style={{
                          backgroundColor: colors.bg.primary,
                        }}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-start space-x-3 flex-1">
                            <div className="text-xl flex-shrink-0">{hook.emoji}</div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center space-x-2 mb-1">
                                <h4 className="font-medium text-sm" style={{ color: colors.text.header }}>
                                  {hook.name}
                                </h4>
                                {hook.enabled ? (
                                  <CheckCircle className="h-4 w-4" style={{ color: colors.accent.green }} />
                                ) : (
                                  <Power className="h-4 w-4" style={{ color: colors.text.muted }} />
                                )}
                                <span
                                  className="px-2 py-0.5 text-xs rounded"
                                  style={{
                                    backgroundColor: hook.enabled ? `${colors.accent.green}20` : `${colors.text.muted}20`,
                                    color: hook.enabled ? colors.accent.green : colors.text.muted,
                                    border: `1px solid ${hook.enabled ? colors.accent.green : colors.text.muted}40`
                                  }}
                                >
                                  {hook.status}
                                </span>
                              </div>
                              <p className="text-sm leading-relaxed" style={{ color: colors.text.muted }}>
                                {hook.description}
                              </p>
                              {hook.events && hook.events.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-2">
                                  {hook.events.map(event => (
                                    <span
                                      key={event}
                                      className="px-2 py-0.5 text-xs rounded font-mono"
                                      style={{
                                        backgroundColor: `${colors.accent.brand}20`,
                                        color: colors.accent.brand,
                                        border: `1px solid ${colors.accent.brand}40`
                                      }}
                                    >
                                      {event}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center space-x-2 flex-shrink-0 ml-4">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => toggleHookEnabled(hook.name, hook.enabled)}
                              disabled={toggleLoading.has(hook.name)}
                              title={hook.enabled ? t('hooks.disableHook') : t('hooks.enableHook')}
                              style={{
                                backgroundColor: colors.bg.tertiary,
                                color: hook.enabled ? colors.accent.red : colors.accent.green,
                                borderColor: hook.enabled ? `${colors.accent.red}88` : `${colors.accent.green}88`
                              }}
                            >
                              {toggleLoading.has(hook.name)
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : <Power className="h-4 w-4" />
                              }
                            </Button>
                            {hook.homepage && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => window.electronAPI?.openExternal?.(hook.homepage!)}
                                style={{ backgroundColor: colors.bg.tertiary, color: colors.text.muted, borderColor: colors.bg.hover }}
                              >
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>

                        <div className="mt-3 pt-3 border-t text-xs" style={{ borderColor: colors.bg.tertiary }}>
                          <span style={{ color: colors.text.muted }}>{t('hooks.source', { source: hook.source })}</span>
                          {!hook.enabled && (
                            <span className="ml-4" style={{ color: colors.text.muted }}>
                              {t('hooks.disabledClickEnable')}
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

        {/* ── INSTALL TAB ── */}
        {activeTab === 'install' && (
          <div className="p-6 flex-shrink-0">
            <div
              className="p-4 rounded-lg mb-6"
              style={{ backgroundColor: colors.bg.tertiary }}
            >
              <h4 className="text-sm font-medium mb-1" style={{ color: colors.text.header }}>
                {t('hooks.installHookPack')}
              </h4>
              <p className="text-xs mb-3" style={{ color: colors.text.muted }}>
                {t('hooks.installHookPackDesc')} (e.g.{' '}
                <code style={{ color: colors.accent.brand }}>@my-org/my-hooks</code> or{' '}
                <code style={{ color: colors.accent.brand }}>./my-hooks</code>)
              </p>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  placeholder={t('hooks.installPlaceholder')}
                  value={customInstallSpec}
                  onChange={(e) => setCustomInstallSpec(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && installCustomHook()}
                  className="flex-1 px-3 py-2 border rounded-md text-sm"
                  style={{
                    backgroundColor: colors.bg.primary,
                    borderColor: colors.bg.hover,
                    color: colors.text.normal
                  }}
                />
                <Button
                  onClick={installCustomHook}
                  disabled={customInstalling || !customInstallSpec.trim()}
                  style={{ backgroundColor: colors.accent.brand, color: '#ffffff', border: 'none' }}
                >
                  {customInstalling ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  {t('hooks.install')}
                </Button>
              </div>
            </div>

            {/* Install error banner */}
            {installError && (
              <div
                className="flex items-start space-x-2 p-3 mb-4 rounded"
                style={{ backgroundColor: `${colors.accent.red}15`, border: `1px solid ${colors.accent.red}40` }}
              >
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: colors.accent.red }} />
                <p className="text-sm flex-1" style={{ color: colors.accent.red }}>{installError}</p>
                <button onClick={() => setInstallError(null)}>
                  <X className="h-4 w-4" style={{ color: colors.accent.red }} />
                </button>
              </div>
            )}

            <div className="text-sm" style={{ color: colors.text.muted }}>
              <p className="mb-3">
                {t('hooks.hookPackInfo')}
              </p>
              <p className="mb-3">
                {t('hooks.hookPackInstallPath')}
              </p>
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); window.electronAPI?.openExternal?.('https://docs.openclaw.ai/automation/hooks') }}
                className="flex items-center text-sm"
                style={{ color: colors.accent.brand }}
              >
                {t('hooks.learnMore')} <ExternalLink className="h-3 w-3 ml-1" />
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
