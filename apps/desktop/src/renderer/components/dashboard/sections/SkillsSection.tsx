import React, { useEffect, useRef, useState } from 'react'
import { Button } from '../../ui/button'
import {
  Settings,
  CheckCircle,
  AlertCircle,
  Download,
  ExternalLink,
  Info,
  Loader2,
  Package,
  RefreshCw,
  Power,
  Search,
  Globe,
  List,
  ChevronDown,
  ChevronUp,
  X,
  Trash2,
  FolderOpen
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ColorTheme } from '../types'
import { EmptyState } from '../../ui/empty-state'
import { MascotIllustration } from '../../ui/mascot-illustration'
import { AnimatedNumber } from '../../ui/animated-number'
import { Skeleton, SkeletonCard } from '../../ui/skeleton'
import { CLAWHUB_BASE_URL } from '../../../../shared/constants'

// Per-skill documentation URL is built from the skill name and routes to
// the public docs site. Kept as a constant so the literal isn't duplicated.
const SKILL_DOCS_URL = (name: string) => `https://docs.openclaw.ai/skills/${name}`

interface Skill {
  name: string
  emoji: string
  description: string
  enabled: boolean
  status: 'ready' | 'missing' | 'disabled' | 'blocked'
  source: string
  homepage?: string
  blockedByAllowlist?: boolean
  requirements?: {
    bins?: string[]
    env?: string[]
    config?: string[]
    [key: string]: any
  }
}

interface RegistrySkill {
  slug: string
  displayName: string
  summary: string
  downloads: number
  stars: number
  version: string
  url: string
}

interface WorkspaceSkill {
  dir: string
  name: string
  description: string
  emoji: string
  homepage: string
  version: string
  enabled: boolean
  requires?: { bins?: string[]; anyBins?: string[]; env?: string[]; config?: string[] }
}

interface SkillsSectionProps {
  colors: ColorTheme
}

/** Credential-like config leaf names that need real user input and can't be auto-resolved. */
const CREDENTIAL_LEAVES = new Set([
  'token', 'apikey', 'apiKey', 'api_key', 'apisecret', 'apiSecret', 'api_secret',
  'bottoken', 'botToken', 'bot_token', 'password', 'secret', 'webhook',
  'webhookurl', 'webhookUrl', 'webhook_url', 'accesstoken', 'accessToken',
  'access_token', 'refreshtoken', 'refreshToken', 'refresh_token',
  'clientid', 'clientId', 'client_id', 'clientsecret', 'clientSecret', 'client_secret',
  'key', 'apiKeyId', 'privateKey', 'signingKey',
])

/** Filter out credential keys from a config requirements list (they can't be auto-resolved). */
const filterAutoResolvableConfig = (configKeys: string[] | undefined): string[] => {
  if (!configKeys?.length) return []
  return configKeys.filter(key => {
    const leaf = key.split('.').pop() || ''
    return !CREDENTIAL_LEAVES.has(leaf)
  })
}

/**
 * Track which keys are mid-flight for an async operation (e.g. "this skill
 * is being installed"). Collapses three near-identical `Set<string>` state
 * slots (`installLoading`, `toggleLoading`, `removeLoading`) plus their
 * copy-pasted add/delete callbacks into a single hook with stable semantics.
 *
 * Inline rather than in a shared `hooks/` file because SkillsSection is
 * currently the only consumer; promote when a second one shows up.
 */
function useBusySet() {
  const [busy, setBusy] = useState<Set<string>>(new Set())
  return {
    has: (key: string) => busy.has(key),
    start: (key: string) =>
      setBusy(prev => (prev.has(key) ? prev : new Set(prev).add(key))),
    finish: (key: string) =>
      setBusy(prev => {
        if (!prev.has(key)) return prev
        const s = new Set(prev)
        s.delete(key)
        return s
      }),
  }
}

export const SkillsSection: React.FC<SkillsSectionProps> = ({ colors }) => {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<'manage' | 'discover'>('manage')
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const installBusy = useBusySet()
  const toggleBusy = useBusySet()
  const removeBusy = useBusySet()
  const [searchFilter, setSearchFilter] = useState('')
  const [skillsStats, setSkillsStats] = useState({
    total: 0,
    ready: 0,
    missing: 0,
    disabled: 0,
    blocked: 0
  })

  // Discover tab state
  const [discoverSkills, setDiscoverSkills] = useState<RegistrySkill[]>([])
  const [discoverLoading, setDiscoverLoading] = useState(false)
  const [discoverError, setDiscoverError] = useState<string | null>(null)
  const [discoverQuery, setDiscoverQuery] = useState('')
  const [discoverPage, setDiscoverPage] = useState(1)
  const SKILLS_PER_PAGE = 30
  const [installingSkills, setInstallingSkills] = useState<Record<string, 'loading' | 'success' | 'error'>>({})
  const [installOutputs, setInstallOutputs] = useState<Record<string, string>>({})
  const [expandedOutputs, setExpandedOutputs] = useState<Set<string>>(new Set())
  // Outcome banner for skill actions (install/toggle/remove). Rendered above
  // the tab panels: the Manage-tab actions write here too, so a banner only
  // visible on Discover turns their failures into "button did nothing".
  const [installBanner, setInstallBanner] = useState<{ text: string; isError?: boolean } | null>(null)
  const [workspaceSkills, setWorkspaceSkills] = useState<WorkspaceSkill[]>([])
  const discoverSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * Convert a workspace-only skill (from filesystem) into the same Skill shape
   * used by gateway-reported skills, so both render with the full card UI.
   */
  const workspaceSkillToSkill = (ws: WorkspaceSkill): Skill => {
    const hasMissing = ws.requires &&
      ((ws.requires.bins?.length ?? 0) > 0 ||
       (ws.requires.env?.length ?? 0) > 0 ||
       (ws.requires.config?.length ?? 0) > 0)

    let status: Skill['status']
    if (!ws.enabled) {
      status = 'disabled'
    } else if (hasMissing) {
      status = 'missing'
    } else {
      status = 'ready'
    }

    return {
      name: ws.name,
      emoji: ws.emoji || '📦',
      description: ws.description || t('skills.noDescription', 'No description available'),
      enabled: ws.enabled,
      status,
      source: `workspace (~/.openclaw/skills/${ws.dir})`,
      homepage: ws.homepage || undefined,
      blockedByAllowlist: false,
      requirements: ws.requires,
    }
  }

  const loadSkills = async (silent = false) => {
    if (!silent) {setLoading(true)}
    setError(null)

    try {
      console.log('[SkillsSection] Loading skills...')

      const [skillsResult, wsResult] = await Promise.all([
        window.electronAPI.listSkills(),
        window.electronAPI.listWorkspaceSkills()
      ])

      // The preload binding only declares `{dir, name}` for entries even
      // though the IPC actually returns the full WorkspaceSkill shape.
      // Cast here rather than over-promise in the preload type.
      const rawWsSkills: WorkspaceSkill[] = wsResult.success ? ((wsResult.skills || []) as WorkspaceSkill[]) : []
      setWorkspaceSkills(rawWsSkills)

      console.log('[SkillsSection] Skills data:', skillsResult.skills)

      // Skills data should now be an array from the backend
      let skillsData: Skill[] = ((skillsResult.success ? skillsResult.skills : null) || [])
        .map((skill: any) => {
          // The JSON from `openclaw skills list --json` uses `disabled: true/false`,
          // `eligible: true/false`, and `blockedByAllowlist: true/false`.
          // Filter out credential keys from missing.config — they can't be auto-resolved
          // and shouldn't make a skill show as "missing" with an Install button.
          const missing = skill.missing ? { ...skill.missing } : undefined
          if (missing?.config) {
            missing.config = filterAutoResolvableConfig(missing.config)
          }

          let status: Skill['status']
          if (skill.disabled) {
            status = 'disabled'
          } else if (skill.blockedByAllowlist) {
            status = 'blocked'
          } else if (missing && (missing.bins?.length > 0 || missing.env?.length > 0 || missing.config?.length > 0)) {
            status = 'missing'
          } else if (!skill.eligible) {
            status = 'blocked'
          } else {
            status = 'ready'
          }
          return {
            name: skill.name,
            emoji: skill.emoji || '📦',
            description: skill.description || t('skills.noDescription', 'No description available'),
            enabled: !skill.disabled,
            status,
            source: skill.source || 'unknown',
            homepage: skill.homepage,
            blockedByAllowlist: skill.blockedByAllowlist || false,
            requirements: missing
          } as Skill
        })

      // Merge workspace-only skills (not already in gateway list) into the unified list
      const gatewayNames = new Set(skillsData.map(s => s.name))
      for (const ws of rawWsSkills) {
        if (!gatewayNames.has(ws.name)) {
          skillsData.push(workspaceSkillToSkill(ws))
        }
      }

      setSkills(skillsData)

      // Update stats
      const stats = {
        total: skillsData.length,
        ready: skillsData.filter((s: Skill) => s.status === 'ready').length,
        missing: skillsData.filter((s: Skill) => s.status === 'missing').length,
        disabled: skillsData.filter((s: Skill) => s.status === 'disabled').length,
        blocked: skillsData.filter((s: Skill) => s.status === 'blocked').length
      }
      setSkillsStats(stats)

    } catch (err: any) {
      console.error('[SkillsSection] Error loading skills:', err)
      setError(err.message || t('skills.errorLoad'))
    } finally {
      setLoading(false)
    }
  }

  const toggleSkillEnabled = async (skillName: string, currentEnabled: boolean) => {
    toggleBusy.start(skillName)
    try {
      const result = await window.electronAPI.setSkillEnabled(skillName, !currentEnabled)
      if (result.success) {
        await loadSkills(true)
      } else {
        setInstallBanner({ text: result.error || t('skills.errorUpdate'), isError: true })
      }
    } catch (err: any) {
      console.error(`[SkillsSection] Error toggling skill ${skillName}:`, err)
      setInstallBanner({ text: err.message || t('skills.errorUpdate'), isError: true })
    } finally {
      toggleBusy.finish(skillName)
    }
  }

  const removeSkill = async (skillName: string) => {
    // Native window.confirm is intentional here — the app doesn't yet
    // have a themed confirm modal component. The user-facing message
    // is i18n'd; only the chrome is locale-default.
    if (!window.confirm(t('skills.confirmRemove', { name: skillName }))) return
    removeBusy.start(skillName)
    try {
      const result = await window.electronAPI.removeSkill(skillName)
      if (result.success) {
        // Optimistically remove from state — gateway caches the list so re-fetching won't reflect the change until restart
        setSkills(prev => prev.filter(s => s.name !== skillName))
        setSkillsStats(prev => ({ ...prev, total: prev.total - 1 }))
        setWorkspaceSkills(prev => prev.filter(ws => ws.dir !== skillName && ws.name !== skillName))
      } else {
        setInstallBanner({ text: result.error || t('skills.errorRemove'), isError: true })
      }
    } catch (err: any) {
      setInstallBanner({ text: err.message || t('skills.errorRemove'), isError: true })
    } finally {
      removeBusy.finish(skillName)
    }
  }

  const installSkillRequirements = async (skillName: string) => {
    installBusy.start(skillName)
    try {
      console.log(`[SkillsSection] Installing requirements for: ${skillName}`)
      const result = await window.electronAPI.installSkillRequirements(skillName)

      if (result.success) {
        // Show the backend message if it contains manual instructions (credentials, etc.)
        // Otherwise show the generic restart banner
        setInstallBanner({ text: result.message || t('skills.installedRestartNeeded', 'Skill installed — restart the assistant to activate it') })
        await loadSkills(true)
      } else {
        setInstallBanner({ text: result.error || t('skills.errorInstallRequirements'), isError: true })
      }
    } catch (err: any) {
      console.error(`[SkillsSection] Error installing requirements for ${skillName}:`, err)
      setInstallBanner({ text: err.message || t('skills.errorInstallRequirements'), isError: true })
    } finally {
      installBusy.finish(skillName)
    }
  }

  // Filter skills based on search input
  const filteredSkills = skills.filter(skill => {
    if (!searchFilter.trim()) {return true}
    const searchLower = searchFilter.toLowerCase()
    return skill.name.toLowerCase().includes(searchLower) ||
           skill.description.toLowerCase().includes(searchLower)
  })

  // Discover tab: fetch skills from ClawHub API (filters client-side by query)
  const loadDiscoverData = async (query: string) => {
    setDiscoverLoading(true)
    setDiscoverError(null)
    try {
      const result = await (window.electronAPI as any).searchSkillRegistry(query)
      if (result.success) {
        setDiscoverSkills(result.skills || [])
      } else {
        setDiscoverError(result.error || t('skills.errorLoad'))
      }
    } catch (err: any) {
      setDiscoverError(err.message || t('skills.errorLoad'))
    } finally {
      setDiscoverLoading(false)
    }
  }

  // Install a skill from the registry
  const installFromRegistry = async (slug: string) => {
    setInstallingSkills(prev => ({ ...prev, [slug]: 'loading' }))
    try {
      const result = await (window.electronAPI as any).installSkillFromRegistry(slug)
      if (result.success) {
        setInstallingSkills(prev => ({ ...prev, [slug]: 'success' }))
        if (result.output) {
          setInstallOutputs(prev => ({ ...prev, [slug]: result.output }))
        }
        setInstallBanner({ text: t('skills.installedRestartNeeded', 'Skill installed — restart the assistant to activate it') })
        // Refresh the skills list
        await loadSkills(true)
      } else {
        setInstallingSkills(prev => ({ ...prev, [slug]: 'error' }))
        setInstallOutputs(prev => ({
          ...prev,
          [slug]: result.output || result.error || t('skills.errorInstallation')
        }))
      }
    } catch (err: any) {
      setInstallingSkills(prev => ({ ...prev, [slug]: 'error' }))
      setInstallOutputs(prev => ({ ...prev, [slug]: err.message || t('skills.errorInstallation') }))
    }
  }


  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'ready':
        return <CheckCircle className="h-4 w-4" style={{ color: colors.accent.green }} />
      case 'missing':
        return <AlertCircle className="h-4 w-4" style={{ color: colors.accent.yellow }} />
      case 'disabled':
        return <Power className="h-4 w-4" style={{ color: colors.text.muted }} />
      case 'blocked':
        return <AlertCircle className="h-4 w-4" style={{ color: colors.accent.red }} />
      default:
        return <Settings className="h-4 w-4" style={{ color: colors.text.muted }} />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ready':
        return colors.accent.green
      case 'missing':
        return colors.accent.yellow
      case 'disabled':
        return colors.text.muted
      case 'blocked':
        return colors.accent.red
      default:
        return colors.text.muted
    }
  }

  useEffect(() => {
    loadSkills()
  }, [])

  // Silently refresh skills when switching back to Manage tab (picks up gateway restarts)
  const manageTabMountedRef = useRef(false)
  useEffect(() => {
    if (activeTab === 'manage') {
      if (manageTabMountedRef.current) {
        loadSkills(true)
      }
      manageTabMountedRef.current = true
    }
  }, [activeTab])

  // Fetch skills when Discover tab opens; debounce search input changes
  useEffect(() => {
    if (activeTab !== 'discover') return
    if (discoverSearchTimer.current) clearTimeout(discoverSearchTimer.current)
    // Immediate load when no query, debounce when typing
    const delay = discoverQuery ? 400 : 0
    discoverSearchTimer.current = setTimeout(() => {
      loadDiscoverData(discoverQuery)
    }, delay)
    return () => {
      if (discoverSearchTimer.current) clearTimeout(discoverSearchTimer.current)
    }
  }, [activeTab, discoverQuery])

  if (loading) {
    // Skeleton scaffold matches the manage-tab layout: stats pills,
    // search bar, list of skill cards. Lets the user see the shape of
    // the section immediately while the workspace skill scan completes.
    return (
      <div className="p-6 h-full flex flex-col space-y-4" aria-busy="true" aria-label={t('skills.loadingSkills')}>
        <div className="flex items-center gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-20 rounded-md" />
          ))}
        </div>
        <Skeleton className="h-9 w-full max-w-md rounded-md" />
        <div className="space-y-3 flex-1 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8 h-full flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 mx-auto mb-4" style={{ color: colors.accent.red }} />
          <h3 className="text-lg font-semibold mb-2" style={{ color: colors.text.header }}>
            {t('skills.failedToLoad')}
          </h3>
          <p className="text-sm mb-4" style={{ color: colors.text.muted }}>
            {error}
          </p>
          <Button
            onClick={() => loadSkills()}
            style={{ backgroundColor: colors.accent.brand, color: colors.button.primaryFg, border: 'none' }}
          >
            {t('common.tryAgain')}
          </Button>
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
        {/* Header (always visible) */}
        <div className="p-6 pb-0 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <Package
                className="h-6 w-6"
                style={{ color: colors.accent.brand }}
              />
              <h3
                className="text-lg font-semibold"
                style={{ color: colors.text.header }}
              >
                {t('skills.title')}
              </h3>
            </div>
            <Button
              onClick={() => loadSkills()}
              size="sm"
              style={{ backgroundColor: colors.accent.brand, color: colors.button.primaryFg, border: 'none' }}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('skills.refresh')}
            </Button>
          </div>

          <p className="text-sm mb-4" style={{ color: colors.text.muted }}>
            {t('skills.subtitle')}
          </p>

          {/* Tab Bar */}
          <div
            role="tablist"
            aria-label={t('skills.title')}
            className="flex space-x-1 mb-0"
            style={{ borderBottom: `1px solid ${colors.bg.tertiary}` }}
          >
            <button
              role="tab"
              aria-selected={activeTab === 'manage'}
              aria-controls="skills-tabpanel-manage"
              aria-label={t('skills.ariaTabManage')}
              onClick={() => setActiveTab('manage')}
              className="flex items-center space-x-2 px-4 py-2 text-sm font-medium transition-colors"
              style={{
                color: activeTab === 'manage' ? colors.accent.brand : colors.text.muted,
                borderBottom: activeTab === 'manage' ? `2px solid ${colors.accent.brand}` : '2px solid transparent',
                marginBottom: '-1px'
              }}
            >
              <List className="h-4 w-4" />
              <span>{t('skills.manage')}</span>
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'discover'}
              aria-controls="skills-tabpanel-discover"
              aria-label={t('skills.ariaTabDiscover')}
              onClick={() => setActiveTab('discover')}
              className="flex items-center space-x-2 px-4 py-2 text-sm font-medium transition-colors"
              style={{
                color: activeTab === 'discover' ? colors.accent.brand : colors.text.muted,
                borderBottom: activeTab === 'discover' ? `2px solid ${colors.accent.brand}` : '2px solid transparent',
                marginBottom: '-1px'
              }}
            >
              <Globe className="h-4 w-4" />
              <span>{t('skills.discover')}</span>
            </button>
          </div>
        </div>

        {/* Action-outcome banner — above the tab panels so Manage-tab
            failures/successes are visible no matter which tab is active. */}
        {installBanner && (
          <div className="px-6 pt-3 flex-shrink-0">
            <div
              className="flex items-center justify-between p-3 rounded-lg"
              style={{
                backgroundColor: `${installBanner.isError ? colors.accent.red : colors.accent.green}18`,
                border: `1px solid ${installBanner.isError ? colors.accent.red : colors.accent.green}40`
              }}
            >
              <span className="text-sm" style={{ color: installBanner.isError ? colors.accent.red : colors.accent.green }}>
                {installBanner.isError ? '⚠' : '✓'} {installBanner.text}
              </span>
              <button
                onClick={() => setInstallBanner(null)}
                aria-label={t('skills.ariaCloseBanner')}
                title={t('skills.ariaCloseBanner')}
              >
                <X className="h-4 w-4" style={{ color: installBanner.isError ? colors.accent.red : colors.accent.green }} />
              </button>
            </div>
          </div>
        )}

        {/* ── MANAGE TAB ── */}
        {activeTab === 'manage' && (
          <div role="tabpanel" id="skills-tabpanel-manage" className="contents">
            <div className="px-6 pt-3 pb-2 flex-shrink-0">
              {/* Skills Stats — numbers tween via AnimatedNumber. */}
              <div className="flex items-center gap-5 mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-base font-bold" style={{ color: colors.text.header }}><AnimatedNumber value={skillsStats.total} /></span>
                  <span className="text-xs" style={{ color: colors.text.muted }}>{t('skills.total')}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-base font-bold" style={{ color: colors.accent.green }}><AnimatedNumber value={skillsStats.ready} /></span>
                  <span className="text-xs" style={{ color: colors.text.muted }}>{t('skills.ready')}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-base font-bold" style={{ color: colors.accent.yellow }}><AnimatedNumber value={skillsStats.missing} /></span>
                  <span className="text-xs" style={{ color: colors.text.muted }}>{t('skills.missing')}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-base font-bold" style={{ color: colors.text.muted }}><AnimatedNumber value={skillsStats.disabled + skillsStats.blocked} /></span>
                  <span className="text-xs" style={{ color: colors.text.muted }}>{t('skills.other')}</span>
                </div>
              </div>

              {/* Search and Batch Actions Row */}
              <div className="flex items-center justify-between gap-4 mb-2">
                {/* Search Filter */}
                <div className="flex items-center space-x-2 flex-1">
                  <div className="relative">
                    <Search className="h-4 w-4 absolute left-3 top-1/2 transform -translate-y-1/2" style={{ color: colors.text.muted }} />
                    <input
                      type="text"
                      placeholder={t('skills.searchPlaceholder')}
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      className="pl-10 pr-4 py-2 border rounded-md text-sm w-80"
                      style={{
                        backgroundColor: colors.bg.tertiary,
                        borderColor: colors.bg.tertiary,
                        color: colors.text.normal
                      }}
                    />
                  </div>
                  {searchFilter && (
                    <span className="text-xs" style={{ color: colors.text.muted }}>
                      {t('skills.skillsOf', { count: filteredSkills.length, total: skills.length })}
                    </span>
                  )}
                </div>

              </div>

            </div>

            <div className="flex-1 px-6 pb-6 min-h-0 overflow-hidden">
              <div className="h-full overflow-y-auto overflow-x-hidden">
                <div className="space-y-3 pr-4">
                  {/* Empty state: no skills at all */}
                  {skills.length === 0 && !searchFilter && (
                    <EmptyState
                      colors={colors}
                      illustration={<MascotIllustration mood="napping" />}
                      title={t('skills.noSkillsFound')}
                      description={t('skills.browseDiscoverTab')}
                      action={
                        <Button
                          size="sm"
                          onClick={() => setActiveTab('discover')}
                          style={{ backgroundColor: colors.accent.brand, color: colors.button.primaryFg, border: 'none' }}
                        >
                          <Globe className="h-4 w-4 mr-2" />
                          {t('skills.discoverSkills')}
                        </Button>
                      }
                    />
                  )}

                  {filteredSkills.length === 0 && searchFilter ? (
                    <EmptyState
                      colors={colors}
                      illustration={<MascotIllustration mood="thinking" size={64} />}
                      title={t('skills.noSkillsFound')}
                      description={t('skills.noSkillsMatch', { search: searchFilter })}
                    />
                  ) : (
                    filteredSkills.map((skill) => (
                    <div
                      key={skill.name}
                      className="rounded-lg p-4 transition-all duration-200"
                      style={{
                        backgroundColor: colors.bg.tertiary,
                      }}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start space-x-3 flex-1">
                          <div className="text-xl flex-shrink-0">
                            {skill.emoji || '📦'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-2 mb-2">
                              <h4
                                className="font-medium text-sm"
                                style={{ color: colors.text.header }}
                              >
                                {skill.name}
                              </h4>
                              {getStatusIcon(skill.status)}
                              <span
                                className="px-2 py-1 text-xs rounded"
                                style={{
                                  backgroundColor: `${getStatusColor(skill.status)}20`,
                                  color: getStatusColor(skill.status),
                                  border: `1px solid ${getStatusColor(skill.status)}40`
                                }}
                              >
                                {t(`skills.${skill.status}`, skill.status)}
                              </span>
                            </div>
                            <p
                              className="text-sm leading-relaxed"
                              style={{ color: colors.text.muted }}
                            >
                              {skill.description}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2 flex-shrink-0 ml-4">
                          {skill.status === 'missing' && (
                            <Button
                              size="sm"
                              onClick={() => installSkillRequirements(skill.name)}
                              disabled={installBusy.has(skill.name)}
                              style={{ backgroundColor: colors.accent.brand, color: colors.button.primaryFg, border: 'none' }}
                            >
                              {installBusy.has(skill.name) ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <Download className="h-4 w-4 mr-1" />
                                  {t('skills.install')}
                                </>
                              )}
                            </Button>
                          )}
                          {(skill.status === 'ready' || skill.status === 'missing' || skill.status === 'disabled') && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => toggleSkillEnabled(skill.name, skill.enabled)}
                              disabled={toggleBusy.has(skill.name)}
                              title={skill.enabled ? t('skills.disableSkill') : t('skills.enableSkill')}
                              style={{
                                backgroundColor: colors.bg.tertiary,
                                // Toggle button color = what the click WILL DO.
                                // Currently enabled → click disables → destructive
                                // (red). Currently disabled → click enables →
                                // primary action (coral).
                                color: skill.enabled ? colors.button.destructive : colors.button.primary,
                                borderColor: skill.enabled
                                  ? colors.button.destructive + '88'
                                  : colors.button.primary + '88'
                              }}
                            >
                              {toggleBusy.has(skill.name)
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : <Power className="h-4 w-4" />
                              }
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => window.electronAPI?.openExternal?.(SKILL_DOCS_URL(skill.name))}
                            title={t('skills.ariaSkillInfo', { name: skill.name })}
                            aria-label={t('skills.ariaSkillInfo', { name: skill.name })}
                            style={{ backgroundColor: colors.bg.tertiary, color: colors.text.muted, borderColor: colors.bg.hover }}
                          >
                            <Info className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => window.electronAPI.openSkillFolder(skill.name)}
                            title={t('skills.openSkillFolder')}
                            aria-label={t('skills.openSkillFolder')}
                            style={{ backgroundColor: colors.bg.tertiary, color: colors.text.muted, borderColor: colors.bg.hover }}
                          >
                            <FolderOpen className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => removeSkill(skill.name)}
                            disabled={removeBusy.has(skill.name)}
                            title={t('skills.removeSkill')}
                            aria-label={t('skills.removeSkill')}
                            style={{ backgroundColor: colors.bg.tertiary, color: colors.accent.red, borderColor: colors.accent.red + '66' }}
                          >
                            {removeBusy.has(skill.name)
                              ? <Loader2 className="h-4 w-4 animate-spin" />
                              : <Trash2 className="h-4 w-4" />
                            }
                          </Button>
                        </div>
                      </div>

                      {/* Footer: source, requirements hint, homepage */}
                      <div className="mt-3 pt-3 border-t text-xs" style={{ borderColor: colors.bg.tertiary }}>
                        <div className="flex justify-between items-start">
                          <div className="flex flex-col gap-1">
                            <span style={{ color: colors.text.muted }}>
                              {t('skills.source')}: {skill.source}
                            </span>
                            {(skill.status === 'missing' || skill.status === 'blocked') && skill.requirements && (
                              <span style={{ color: colors.accent.yellow }}>
                                {[
                                  skill.requirements.bins?.length ? `bins: ${skill.requirements.bins.join(', ')}` : null,
                                  skill.requirements.env?.length ? `env: ${skill.requirements.env.join(', ')}` : null,
                                  skill.requirements.config?.length ? `config: ${skill.requirements.config.join(', ')}` : null,
                                ].filter(Boolean).join(' · ')}
                              </span>
                            )}
                            {skill.status === 'disabled' && (
                              <span style={{ color: colors.text.muted }}>
                                {t('skills.disabledClickEnable')}
                              </span>
                            )}
                            {skill.status === 'blocked' && skill.blockedByAllowlist && (
                              <span style={{ color: colors.accent.yellow }}>
                                {t('skills.blockedByAllowlist', { name: skill.name })}
                              </span>
                            )}
                            {skill.status === 'blocked' && !skill.blockedByAllowlist && !skill.requirements?.bins?.length && !skill.requirements?.env?.length && !skill.requirements?.config?.length && (
                              <span style={{ color: colors.accent.yellow }}>
                                {t('skills.notEligible')}
                              </span>
                            )}
                          </div>
                          {skill.homepage && (
                            // Not a real <a href> since this opens via Electron's
                            // shell rather than the renderer's nav — using a
                            // <button> avoids the fake href="#" and gets correct
                            // keyboard focus + screen-reader semantics for free.
                            <button
                              type="button"
                              onClick={() => window.electronAPI?.openExternal?.(skill.homepage!)}
                              className="flex items-center flex-shrink-0 ml-4 bg-transparent"
                              style={{ color: colors.accent.brand }}
                            >
                              {t('skills.homepage')} <ExternalLink className="h-3 w-3 ml-1" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── DISCOVER TAB ── */}
        {activeTab === 'discover' && (
          <div role="tabpanel" id="skills-tabpanel-discover" className="contents">
            {/* Source badge + search row */}
            <div className="p-6 pb-4 flex-shrink-0">
              {/* Source badge */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                  <span
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
                    style={{ backgroundColor: `${colors.accent.brand}18`, color: colors.accent.brand, border: `1px solid ${colors.accent.brand}40` }}
                  >
                    <Globe className="h-3 w-3" />
                    <span>{t('skills.clawHubRegistry')}</span>
                  </span>
                  <button
                    className="text-xs"
                    style={{ color: colors.text.muted }}
                    onClick={() => window.electronAPI?.openExternal?.(CLAWHUB_BASE_URL)}
                  >
                    <ExternalLink className="h-3 w-3 inline mr-0.5" />
                    {t('skills.browseClawhub')}
                  </button>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => loadDiscoverData(discoverQuery)}
                  disabled={discoverLoading}
                  title={t('skills.ariaRefreshRegistry')}
                  aria-label={t('skills.ariaRefreshRegistry')}
                  style={{ backgroundColor: colors.bg.tertiary, color: colors.text.muted, borderColor: colors.bg.hover }}
                >
                  <RefreshCw className={`h-3 w-3 ${discoverLoading ? 'animate-spin' : ''}`} />
                </Button>
              </div>

              {/* Search bar */}
              <div className="relative mb-4">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: colors.text.muted }} />
                <input
                  type="text"
                  placeholder={t('skills.searchRegistry')}
                  value={discoverQuery}
                  onChange={e => { setDiscoverQuery(e.target.value); setDiscoverPage(1) }}
                  className="w-full pl-10 pr-4 py-2 border rounded-md text-sm"
                  style={{
                    backgroundColor: colors.bg.tertiary,
                    borderColor: colors.bg.tertiary,
                    color: colors.text.normal
                  }}
                />
              </div>

            </div>

            {/* Content area */}
            <div className="flex-1 px-6 pb-6 min-h-0 overflow-hidden">
              <div className="h-full overflow-y-auto overflow-x-hidden">
                {discoverLoading && discoverSkills.length === 0 ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-6 w-6 animate-spin mr-3" style={{ color: colors.accent.brand }} />
                    <span style={{ color: colors.text.muted }}>{t('skills.loadingRegistry')}</span>
                  </div>
                ) : discoverError ? (
                  <div className="text-center py-12">
                    <AlertCircle className="h-10 w-10 mx-auto mb-3" style={{ color: colors.accent.red }} />
                    <p className="text-sm mb-4" style={{ color: colors.text.muted }}>{discoverError}</p>
                    <Button
                      size="sm"
                      onClick={() => loadDiscoverData(discoverQuery)}
                      style={{ backgroundColor: colors.accent.brand, color: colors.button.primaryFg, border: 'none' }}
                    >
                      {t('common.tryAgain')}
                    </Button>
                  </div>
                ) : discoverSkills.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="text-5xl mb-4">🔍</div>
                    <p className="text-sm" style={{ color: colors.text.muted }}>
                      {t('skills.noRegistrySkills')}
                    </p>
                  </div>
                ) : (
                  /* Skill cards with pagination */
                  <>
                    <p className="text-xs mb-3" style={{ color: colors.text.muted }}>
                      {t('skills.showingResults', { shown: Math.min(discoverPage * SKILLS_PER_PAGE, discoverSkills.length), total: discoverSkills.length })}
                      {discoverQuery.trim() ? ` ${t('skills.matchingQuery', { query: discoverQuery })}` : ''}
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pr-4 pb-4">
                      {discoverSkills.slice(0, discoverPage * SKILLS_PER_PAGE).map(skill => {
                        const installKey = skill.slug
                        const isInstalled = skills.some(s => s.name === skill.slug) || workspaceSkills.some(ws => ws.dir === skill.slug || ws.name === skill.slug)
                        const installState = installingSkills[installKey]
                        const hasOutput = !!installOutputs[installKey]
                        const outputExpanded = expandedOutputs.has(installKey)

                        return (
                          <div
                            key={skill.slug}
                            className="rounded-lg p-4 flex flex-col"
                            style={{ backgroundColor: colors.bg.tertiary }}
                          >
                            {/* Card header */}
                            <div className="flex items-start space-x-3 mb-2">
                              <span className="text-xl flex-shrink-0">📦</span>
                              <div className="min-w-0 flex-1">
                                <h4 className="font-semibold text-sm truncate" style={{ color: colors.text.header }}>
                                  {skill.displayName}
                                </h4>
                                <div className="flex items-center gap-3 mt-0.5">
                                  {skill.version && (
                                    <span className="text-xs" style={{ color: colors.text.muted }}>v{skill.version}</span>
                                  )}
                                  <span className="text-xs" style={{ color: colors.text.muted }}>
                                    {skill.downloads.toLocaleString()} {t('skills.downloads')}
                                  </span>
                                  {skill.stars > 0 && (
                                    <span className="text-xs" style={{ color: colors.text.muted }}>
                                      {skill.stars.toLocaleString()} {t('skills.stars')}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Description */}
                            <p
                              className="text-xs leading-relaxed flex-1 mb-3 overflow-hidden"
                              style={{ color: colors.text.muted, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}
                            >
                              {skill.summary}
                            </p>

                            {/* Actions */}
                            <div className="flex items-center justify-between pt-2 border-t mt-auto" style={{ borderColor: colors.bg.tertiary }}>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => window.electronAPI?.openExternal?.(skill.url)}
                                style={{ backgroundColor: colors.bg.tertiary, color: colors.text.muted, borderColor: colors.bg.hover, fontSize: '11px', padding: '2px 8px' }}
                              >
                                <ExternalLink className="h-3 w-3 mr-1" />
                                {t('skills.view')}
                              </Button>

                              {isInstalled ? (
                                <span className="text-xs font-medium" style={{ color: colors.accent.green }}>
                                  ✓ {t('skills.installed')}
                                </span>
                              ) : installState === 'loading' ? (
                                <Button
                                  size="sm"
                                  disabled
                                  style={{ backgroundColor: colors.accent.brand, color: colors.button.primaryFg, border: 'none', fontSize: '11px', padding: '2px 10px', opacity: 0.7 }}
                                >
                                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                  {t('common.installing')}
                                </Button>
                              ) : installState === 'success' ? (
                                <span className="text-xs font-medium" style={{ color: colors.accent.green }}>
                                  ✓ {t('skills.installed')}
                                </span>
                              ) : installState === 'error' ? (
                                <button
                                  className="text-xs font-medium flex items-center"
                                  style={{ color: colors.accent.red }}
                                  onClick={() => setExpandedOutputs(prev => {
                                    const s = new Set(prev)
                                    s.has(installKey) ? s.delete(installKey) : s.add(installKey)
                                    return s
                                  })}
                                >
                                  {t('common.error')}
                                  {hasOutput && (outputExpanded ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />)}
                                </button>
                              ) : (
                                <Button
                                  size="sm"
                                  onClick={() => installFromRegistry(skill.slug)}
                                  style={{ backgroundColor: colors.accent.brand, color: colors.button.primaryFg, border: 'none', fontSize: '11px', padding: '2px 10px' }}
                                >
                                  <Download className="h-3 w-3 mr-1" />
                                  {t('skills.install')}
                                </Button>
                              )}
                            </div>

                            {/* Collapsible output for errors */}
                            {hasOutput && outputExpanded && (
                              <div
                                className="mt-2 p-2 rounded text-xs font-mono overflow-auto max-h-24"
                                style={{ backgroundColor: colors.bg.tertiary, color: colors.text.muted }}
                              >
                                {installOutputs[installKey]}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    {discoverSkills.length > discoverPage * SKILLS_PER_PAGE && (
                      <div className="flex justify-center pt-2 pb-4">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDiscoverPage(p => p + 1)}
                          style={{ backgroundColor: colors.bg.tertiary, color: colors.text.normal, borderColor: colors.bg.hover }}
                        >
                          {t('skills.loadMore', { count: discoverSkills.length - discoverPage * SKILLS_PER_PAGE })}
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
