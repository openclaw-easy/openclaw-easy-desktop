import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Search, Play, ArrowLeft, RefreshCw, AlertTriangle } from 'lucide-react'
import { ColorTheme } from '../types'
import { COMMANDS, CATEGORY_LABELS, CommandDef, CommandCategory } from './commandCatalog'

interface CommandsSectionProps {
  colors: ColorTheme
}

type FilterCategory = 'all' | CommandCategory

export const CommandsSection: React.FC<CommandsSectionProps> = ({ colors }) => {
  const { t } = useTranslation()
  // Browse state
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<FilterCategory>('all')

  // Run state
  const [selectedCommand, setSelectedCommand] = useState<CommandDef | null>(null)
  const [paramValues, setParamValues] = useState<Record<string, string>>({})
  const [showTerminal, setShowTerminal] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  // Initialize xterm when terminal panel becomes visible
  useEffect(() => {
    if (!showTerminal || !terminalRef.current || xtermRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff',
      },
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
        } else {
          args.push(val)
        }
      }
    }
    return args
  }

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
              <h3 className="text-lg font-bold" style={{ color: colors.text.header }}>
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
                    {param.required && <span className="text-red-400 ml-0.5">*</span>}
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
                      onKeyDown={(e) => e.key === 'Enter' && !isRunning && handleRun()}
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
              style={{ backgroundColor: '#7f1d1d33' }}
            >
              <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-400">{cmd.dangerMessage}</p>
            </div>
          </div>
        )}

        {/* Run button */}
        {!showTerminal && (
          <div className="px-6 pb-4 flex-shrink-0">
            {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
            <button
              onClick={handleRun}
              disabled={isRunning}
              className="flex items-center gap-2 px-5 py-2 rounded-lg font-medium text-sm transition-all disabled:opacity-50"
              style={{
                backgroundColor: cmd.danger ? colors.accent.red : colors.accent.brand,
                color: 'white',
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
              style={{ backgroundColor: '#1e1e1e', padding: '4px' }}
            />
            {(isComplete || error) && (
              <div className="flex items-center gap-3 pt-3 flex-shrink-0">
                {isComplete && (
                  <span className="text-sm text-green-400 font-medium">✅ {t('commands.completed')}</span>
                )}
                {error && <span className="text-sm text-red-400">{error}</span>}
                <button
                  onClick={handleRunAgain}
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
      </div>
    )
  }

  // ─── Browse Panel ─────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col overflow-hidden px-6 pt-6 pb-0">
      {/* Header */}
      <div className="mb-4 flex items-baseline gap-3 flex-shrink-0">
        <h3 className="text-lg font-bold" style={{ color: colors.text.header }}>
          {t('commands.title')}
        </h3>
        <p className="text-sm" style={{ color: colors.text.muted }}>
          {t('commands.subtitle')}
        </p>
      </div>

      {/* Search */}
      <div className="relative mb-3 flex-shrink-0">
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
      <div className="flex gap-2 overflow-x-auto pb-2 mb-3 flex-shrink-0 scrollbar-none">
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
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-8">
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
                      {cmd.danger && <span className="text-xs text-red-400">⚠️ Careful</span>}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleSelectCommand(cmd)}
                  className="flex items-center gap-2 px-4 py-2 rounded font-medium text-sm flex-shrink-0 transition-colors"
                  style={{
                    backgroundColor: cmd.danger ? colors.accent.red : colors.accent.brand,
                    color: 'white',
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
        </div>
      </div>
    </div>
  )
}
