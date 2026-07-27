import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Search, Play, ArrowLeft, RefreshCw, AlertTriangle } from 'lucide-react'
import { ColorTheme } from '../types'
import { COMMANDS, CATEGORY_LABELS, CommandDef, CommandCategory } from './commandCatalog'

/**
 * A top-level CLI command discovered at runtime via `openclaw --help`
 * (see main/managers/commands-discovery.ts). Surfaced when the static
 * catalog doesn't know about it — gives upstream additions a path into
 * the UI without us having to refresh `commandCatalog.ts` on every merge.
 */
interface DiscoveredCommandEntry {
  name: string
  description: string
  hasSubcommands: boolean
}
import { SectionHeader } from '../../ui/section-header'
import { Modal } from '../../ui/modal'
import { useThemeStore } from '../../../stores/themeStore'
import { getXtermTheme } from '../../../lib/xtermTheme'

interface CommandsSectionProps {
  colors: ColorTheme
}

type FilterCategory = 'all' | CommandCategory

export const CommandsSection: React.FC<CommandsSectionProps> = ({ colors }) => {
  const { t } = useTranslation()
  const resolvedTheme = useThemeStore((s) => s.resolved)
  // Browse state
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<FilterCategory>('all')

  // Discovered (CLI-only) commands — top-level entries from
  // `openclaw --help` that aren't in the static catalog. Loaded once at
  // mount; null = not yet loaded, [] = loaded with empty result.
  const [discovered, setDiscovered] = useState<DiscoveredCommandEntry[] | null>(null)

  // Run state
  const [selectedCommand, setSelectedCommand] = useState<CommandDef | null>(null)
  const [paramValues, setParamValues] = useState<Record<string, string>>({})
  const [showTerminal, setShowTerminal] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Danger-flagged commands (e.g. reset/purge) get a confirm gate so one
  // click can't fire a state-changing CLI command. Mirrors SessionsSection.
  const [showDangerConfirm, setShowDangerConfirm] = useState(false)

  // Terminal refs
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const terminalIdRef = useRef<string | null>(null)
  const listenerCleanupRef = useRef<(() => void) | null>(null)

  const cleanupTerminal = useCallback(() => {
    listenerCleanupRef.current?.()
    listenerCleanupRef.current = null
    if (terminalIdRef.current) {
      window.electronAPI.killTerminal(terminalIdRef.current)
      terminalIdRef.current = null
    }
    if (xtermRef.current) {
      xtermRef.current.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
    }
  }, [])

  useEffect(() => () => cleanupTerminal(), [cleanupTerminal])

  // Load discovered commands once at mount. Failures degrade silently —
  // the catalog still works; we just don't surface the extra section.
  useEffect(() => {
    let cancelled = false
    window.electronAPI
      .listDiscoveredCommands?.()
      .then((result) => {
        if (cancelled) return
        if (result?.success && Array.isArray(result.commands)) {
          // Strip out commands already covered by the static catalog so
          // the "More from CLI" section is genuinely additive, not a
          // duplicate of what's already curated above.
          const cataloged = new Set(COMMANDS.map((c) => c.args[0]))
          const extras = result.commands.filter((c) => !cataloged.has(c.name))
          setDiscovered(extras)
        } else {
          setDiscovered([])
        }
      })
      .catch(() => {
        if (!cancelled) setDiscovered([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Initialize xterm when terminal panel becomes visible
  useEffect(() => {
    if (!showTerminal || !terminalRef.current || xtermRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"SF Mono", "Fira Code", "JetBrains Mono", Menlo, Monaco, "Courier New", monospace',
      theme: getXtermTheme(resolvedTheme),
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(terminalRef.current)
    fitAddon.fit()
    xtermRef.current = term
    fitAddonRef.current = fitAddon

    term.onData((data) => {
      if (terminalIdRef.current) {
        window.electronAPI.writeToTerminal(terminalIdRef.current, data)
      }
    })

    const handleResize = () => {
      fitAddon.fit()
      if (terminalIdRef.current && xtermRef.current) {
        window.electronAPI.resizeTerminal(
          terminalIdRef.current,
          xtermRef.current.cols,
          xtermRef.current.rows
        )
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [showTerminal])

  // Live-update xterm theme when the app's light/dark mode flips while
  // the terminal is mounted.
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = getXtermTheme(resolvedTheme)
    }
  }, [resolvedTheme])

  const filteredCommands = COMMANDS.filter((cmd) => {
    const matchCat = activeCategory === 'all' || cmd.category === activeCategory
    const q = search.toLowerCase()
    const matchSearch =
      !q ||
      cmd.title.toLowerCase().includes(q) ||
      cmd.description.toLowerCase().includes(q) ||
      cmd.args.join(' ').includes(q)
    return matchCat && matchSearch
  })

  const handleSelectCommand = (cmd: CommandDef) => {
    cleanupTerminal()
    setSelectedCommand(cmd)
    setParamValues({})
    setShowTerminal(false)
    setIsRunning(false)
    setIsComplete(false)
    setError(null)
  }

  const handleBack = () => {
    cleanupTerminal()
    setSelectedCommand(null)
    setShowTerminal(false)
    setIsRunning(false)
    setIsComplete(false)
    setError(null)
  }

  const buildArgs = (): string[] | null => {
    if (!selectedCommand) return null
    const args = [...selectedCommand.args]
    for (const param of selectedCommand.params ?? []) {
      const val = (paramValues[param.paramId] ?? param.default ?? '').trim()
      if (param.required && !val) {
        setError(`Please fill in: ${param.label}`)
        return null
      }
      if (val) {
        if (param.flag) {
          args.push(param.flag, val)
        } else if (/\s/.test(val)) {
          // Positional value with embedded whitespace — split into
          // multiple raw args. Lets the discovered-command "Additional
          // arguments" field accept inputs like `list --json` or
          // `--limit 10 --json` without our needing a shell.
          args.push(...val.split(/\s+/).filter(Boolean))
        } else {
          args.push(val)
        }
      }
    }
    return args
  }

  /** Synthesize a CommandDef for a discovered CLI command so the
   *  existing selection / run / terminal flow handles it identically
   *  to a catalog entry. The single "Additional arguments" param is
   *  optional — runs `openclaw <name>` bare if left empty, or
   *  `openclaw <name> <extras>` after whitespace-splitting. */
  const discoveredToCommandDef = (d: DiscoveredCommandEntry): CommandDef => ({
    id: `discovered:${d.name}`,
    category: 'system',
    icon: d.hasSubcommands ? '📁' : '⚡',
    title: d.name,
    description:
      d.description || t('commands.discoveredFallbackDesc', 'Discovered CLI command'),
    args: [d.name],
    params: [
      {
        paramId: 'extraArgs',
        flag: '',
        label: d.hasSubcommands
          ? t('commands.subcommandAndFlags', 'Subcommand + flags')
          : t('commands.additionalFlags', 'Additional flags'),
        type: 'text',
        placeholder: d.hasSubcommands ? 'e.g. list --json' : 'e.g. --help',
        required: false,
      },
    ],
  })

  const handleRun = async () => {
    const args = buildArgs()
    if (!args) return

    setError(null)
    setIsComplete(false)
    setIsRunning(true)
    setShowTerminal(true)

    // Give React one tick to mount the terminal div
    await new Promise((r) => setTimeout(r, 100))

    try {
      const result = await window.electronAPI.createOpenclawTerminal(args)
      terminalIdRef.current = result.terminalId

      const removeData = window.electronAPI.onTerminalData((id, data) => {
        if (id === terminalIdRef.current && xtermRef.current) {
          xtermRef.current.write(data)
        }
      })
      const removeExit = window.electronAPI.onTerminalExit((id, code) => {
        if (id === terminalIdRef.current) {
          setIsRunning(false)
          if (code === 0) {
            setIsComplete(true)
          } else {
            setError(`Process exited with code ${code}`)
          }
          listenerCleanupRef.current = null
          removeData()
          removeExit()
        }
      })
      listenerCleanupRef.current = () => { removeData(); removeExit() }
    } catch (err) {
      setIsRunning(false)
      setError(err instanceof Error ? err.message : 'Failed to start command')
    }
  }

  const handleRunAgain = () => {
    cleanupTerminal()
    setShowTerminal(false)
    setError(null)
    setIsComplete(false)
    setTimeout(() => handleRun(), 100)
  }

  // Entry points (Run button + Enter key) for danger commands open the
  // confirm first; safe commands run immediately as before.
  const requestRun = () => {
    if (selectedCommand?.danger) {
      setShowDangerConfirm(true)
      return
    }
    handleRun()
  }

  const requestRunAgain = () => {
    if (selectedCommand?.danger) {
      setShowDangerConfirm(true)
      return
    }
    handleRunAgain()
  }

  // ─── Run Panel ────────────────────────────────────────────────────────────
  if (selectedCommand) {
    const cmd = selectedCommand
    const hasParams = (cmd.params?.length ?? 0) > 0

    return (
      <div className="h-full flex flex-col overflow-hidden">
        {/* Back + title */}
        <div className="px-6 pt-5 pb-3 flex-shrink-0">
          <button
            onClick={handleBack}
            className="flex items-center gap-1.5 text-sm mb-3 transition-opacity hover:opacity-70"
            style={{ color: colors.text.muted }}
          >
            <ArrowLeft className="h-4 w-4" />
            {t('commands.backToCommands')}
          </button>
          <div className="flex items-center gap-3">
            <span className="text-2xl">{cmd.icon}</span>
            <div>
              <h3 className="font-display text-lg font-bold tracking-tight" style={{ color: colors.text.header }}>
                {cmd.title}
              </h3>
              <p className="text-sm" style={{ color: colors.text.muted }}>
                {cmd.description}
              </p>
            </div>
          </div>
        </div>

        {/* Param form */}
        {!showTerminal && hasParams && (
          <div className="px-6 pb-3 flex-shrink-0">
            <div
              className="rounded-lg p-4 space-y-3"
              style={{ backgroundColor: colors.bg.secondary }}
            >
              {cmd.params!.map((param) => (
                <div key={param.paramId}>
                  <label
                    className="block text-xs font-medium mb-1"
                    style={{ color: colors.text.muted }}
                  >
                    {param.label}
                    {param.required && <span className="ml-0.5" style={{ color: colors.accent.red }}>*</span>}
                  </label>
                  {param.type === 'select' ? (
                    <select
                      value={paramValues[param.paramId] ?? param.default ?? ''}
                      onChange={(e) =>
                        setParamValues((v) => ({ ...v, [param.paramId]: e.target.value }))
                      }
                      className="w-full px-3 py-1.5 rounded text-sm outline-none"
                      style={{
                        backgroundColor: colors.bg.tertiary,
                        color: colors.text.normal,
                        border: `1px solid ${colors.text.muted}33`,
                      }}
                    >
                      <option value="">{t('commands.select')}</option>
                      {param.options!.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={param.type === 'password' ? 'password' : 'text'}
                      value={paramValues[param.paramId] ?? ''}
                      onChange={(e) =>
                        setParamValues((v) => ({ ...v, [param.paramId]: e.target.value }))
                      }
                      onKeyDown={(e) => e.key === 'Enter' && !isRunning && requestRun()}
                      placeholder={param.placeholder}
                      className="w-full px-3 py-1.5 rounded text-sm outline-none"
                      style={{
                        backgroundColor: colors.bg.tertiary,
                        color: colors.text.normal,
                        border: `1px solid ${colors.text.muted}33`,
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Danger warning */}
        {!showTerminal && cmd.danger && (
          <div className="px-6 pb-3 flex-shrink-0">
            <div
              className="flex items-start gap-2 rounded-lg p-3"
              style={{ backgroundColor: `${colors.accent.red}33` }}
            >
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: colors.accent.red }} />
              <p className="text-xs" style={{ color: colors.accent.red }}>{cmd.dangerMessage}</p>
            </div>
          </div>
        )}

        {/* Run button */}
        {!showTerminal && (
          <div className="px-6 pb-4 flex-shrink-0">
            {error && <p className="text-xs mb-2" style={{ color: colors.accent.red }}>{error}</p>}
            <button
              onClick={requestRun}
              disabled={isRunning}
              className="flex items-center gap-2 px-5 py-2 rounded-lg font-medium text-sm transition-all disabled:opacity-50"
              style={{
                backgroundColor: cmd.danger ? colors.accent.red : colors.accent.brand,
                color: colors.button.primaryFg,
              }}
            >
              <Play className="h-4 w-4" />
              {t('commands.runCommand')}
            </button>
          </div>
        )}

        {/* Terminal */}
        {showTerminal && (
          <div className="flex-1 flex flex-col min-h-0 px-6 pb-4">
            <div
              ref={terminalRef}
              className="flex-1 min-h-0 rounded-lg overflow-hidden"
              // Match the xterm theme bg so the container doesn't flash
              // black before xterm renders its canvas.
              style={{
                backgroundColor: resolvedTheme === 'dark' ? '#0a0f1a' : '#fbf6ec',
                padding: '4px',
              }}
            />
            {(isComplete || error) && (
              <div className="flex items-center gap-3 pt-3 flex-shrink-0">
                {isComplete && (
                  <span className="text-sm font-medium" style={{ color: colors.accent.green }}>✅ {t('commands.completed')}</span>
                )}
                {error && <span className="text-sm" style={{ color: colors.accent.red }}>{error}</span>}
                <button
                  onClick={requestRunAgain}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded ml-auto transition-opacity hover:opacity-80"
                  style={{ backgroundColor: colors.bg.tertiary, color: colors.text.muted }}
                >
                  <RefreshCw className="h-3 w-3" />
                  {t('commands.runAgain')}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Danger command confirmation — a danger-flagged command makes
            state changes, so gate it behind an explicit confirm. */}
        <Modal
          open={showDangerConfirm}
          onClose={() => setShowDangerConfirm(false)}
          shellClassName="shadow-2xl"
        >
          <div className="flex items-start gap-3 mb-4">
            <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" style={{ color: colors.accent.red }} />
            <div className="flex-1">
              <h3 className="font-bold text-lg mb-1" style={{ color: colors.text.header }}>
                {t('commands.dangerConfirmTitle', 'Run {{command}}?', { command: cmd.args.join(' ') })}
              </h3>
              <p className="text-sm" style={{ color: colors.text.muted }}>
                {cmd.dangerMessage || t('commands.dangerConfirmBody', 'This may make changes.')}
              </p>
            </div>
          </div>
          <div className="flex space-x-3">
            <button
              onClick={() => setShowDangerConfirm(false)}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              style={{ backgroundColor: colors.bg.tertiary, color: colors.text.normal }}
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => {
                setShowDangerConfirm(false)
                // When the terminal is already up the user hit "Run again";
                // otherwise it's the first run from the param form.
                if (showTerminal) {
                  handleRunAgain()
                } else {
                  handleRun()
                }
              }}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
              style={{ backgroundColor: colors.accent.red, color: colors.button.primaryFg }}
            >
              <Play className="h-4 w-4" />
              {t('commands.runCommand')}
            </button>
          </div>
        </Modal>
      </div>
    )
  }

  // ─── Browse Panel ─────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <SectionHeader
        title={t('commands.title')}
        subtitle={t('commands.subtitle')}
        colors={colors}
        border={false}
      />

      {/* Search */}
      <div className="relative mb-3 mx-6 flex-shrink-0">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
          style={{ color: colors.text.muted }}
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('commands.searchPlaceholder')}
          className="w-full pl-9 pr-4 py-2 rounded-lg text-sm outline-none"
          style={{
            backgroundColor: colors.bg.secondary,
            color: colors.text.normal,
            border: `1px solid ${colors.bg.tertiary}`,
          }}
        />
      </div>

      {/* Category pills */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-3 mx-6 flex-shrink-0 scrollbar-none">
        <button
          onClick={() => setActiveCategory('all')}
          className="px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap flex-shrink-0 transition-colors"
          style={{
            backgroundColor: activeCategory === 'all' ? colors.accent.brand : colors.bg.secondary,
            color: activeCategory === 'all' ? 'white' : colors.text.muted,
          }}
        >
          {t('commands.all', { count: COMMANDS.length })}
        </button>
        {(Object.keys(CATEGORY_LABELS) as CommandCategory[]).map((cat) => {
          const count = COMMANDS.filter((c) => c.category === cat).length
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className="px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap flex-shrink-0 transition-colors"
              style={{
                backgroundColor:
                  activeCategory === cat ? colors.accent.brand : colors.bg.secondary,
                color: activeCategory === cat ? 'white' : colors.text.muted,
              }}
            >
              {CATEGORY_LABELS[cat]} ({count})
            </button>
          )
        })}
      </div>

      {/* Command list */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 pb-8">
        <div className="grid grid-cols-1 gap-3">
          {filteredCommands.map((cmd) => (
            <div
              key={cmd.id}
              className="rounded-lg px-5 py-4 transition-all hover:scale-[1.01]"
              style={{ backgroundColor: colors.bg.secondary }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="text-2xl">{cmd.icon}</div>
                  <div>
                    <h4 className="text-base font-semibold" style={{ color: colors.text.header }}>
                      {cmd.title}
                    </h4>
                    <p className="text-sm" style={{ color: colors.text.muted }}>
                      {cmd.description}
                    </p>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs" style={{ color: colors.text.muted }}>
                        {CATEGORY_LABELS[cmd.category]}
                      </span>
                      <code
                        className="text-xs px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: colors.bg.tertiary, color: colors.text.muted }}
                      >
                        {cmd.args.join(' ')}
                      </code>
                      {cmd.danger && <span className="text-xs" style={{ color: colors.accent.red }}>⚠️ Careful</span>}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleSelectCommand(cmd)}
                  className="flex items-center gap-2 px-4 py-2 rounded font-medium text-sm flex-shrink-0 transition-colors"
                  style={{
                    backgroundColor: cmd.danger ? colors.accent.red : colors.accent.brand,
                    color: colors.button.primaryFg,
                  }}
                >
                  <Play className="h-3.5 w-3.5" />
                  Run
                </button>
              </div>
            </div>
          ))}

          {filteredCommands.length === 0 && (
            <div className="text-center py-16" style={{ color: colors.text.muted }}>
              <div className="text-4xl mb-3">🔍</div>
              <p className="text-sm">{t('commands.noResults', { search })}</p>
            </div>
          )}

          {/* More from CLI — top-level openclaw commands the static catalog
              doesn't curate yet. Surfaced via `openclaw --help` so upstream
              additions (acp, commitments, crestodian, message, onboard, …)
              are reachable without us refreshing the catalog. Only renders
              when the discovery probe actually found extras and we're not
              hiding them via category filter. */}
          {discovered && discovered.length > 0 && activeCategory === 'all' && (() => {
            const q = search.toLowerCase()
            const filteredDiscovered = discovered.filter(
              (d) => !q || d.name.includes(q) || d.description.toLowerCase().includes(q),
            )
            if (filteredDiscovered.length === 0) return null
            return (
              <div className="mt-6">
                <div className="flex items-baseline gap-2 mb-2">
                  <h3
                    className="text-sm font-semibold uppercase tracking-wider"
                    style={{ color: colors.text.muted }}
                  >
                    {t('commands.moreFromCli', 'More from CLI')}
                  </h3>
                  <span className="text-xs" style={{ color: colors.text.muted }}>
                    ({filteredDiscovered.length})
                  </span>
                </div>
                <p className="text-xs mb-3" style={{ color: colors.text.muted }}>
                  {t(
                    'commands.discoveredCaption',
                    'Commands discovered from openclaw --help that the curated catalog above does not cover yet. Run them with optional flags or subcommands.',
                  )}
                </p>
                <div className="grid grid-cols-1 gap-3">
                  {filteredDiscovered.map((d) => (
                    <div
                      key={d.name}
                      className="rounded-lg px-5 py-3 transition-all hover:scale-[1.01]"
                      style={{ backgroundColor: colors.bg.secondary }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className="text-xl">{d.hasSubcommands ? '📁' : '⚡'}</div>
                          <div>
                            <h4
                              className="text-sm font-semibold"
                              style={{ color: colors.text.header }}
                            >
                              openclaw {d.name}{' '}
                              {d.hasSubcommands && (
                                <span
                                  className="text-xs ml-1"
                                  style={{ color: colors.text.muted }}
                                >
                                  *
                                </span>
                              )}
                            </h4>
                            <p
                              className="text-xs"
                              style={{ color: colors.text.muted }}
                            >
                              {d.description || t('commands.noDescription', 'No description')}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleSelectCommand(discoveredToCommandDef(d))}
                          className="flex items-center gap-2 px-3 py-1.5 rounded font-medium text-xs flex-shrink-0 transition-colors"
                          style={{
                            backgroundColor: colors.bg.tertiary,
                            color: colors.text.normal,
                          }}
                        >
                          <Play className="h-3 w-3" />
                          {t('commands.run', 'Run')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
