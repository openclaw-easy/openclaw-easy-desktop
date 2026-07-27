import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from 'react-i18next';
import { Button } from "../../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/card";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Loader2,
  PlayCircle,
  Shield,
  StethoscopeIcon as Stethoscope,
  Terminal,
  XCircle,
} from "lucide-react";
import { cn } from "../../../lib/utils";

interface DoctorLogEntry {
  timestamp: string;
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
  /**
   * Badge category — what's shown in the colored pill next to the
   * timestamp. Should mirror the line's level so a warning-class line
   * gets a yellow "WARNING" pill, not a red "PROBLEM" pill. The earlier
   * fork conflated these into a single 'problem' type which produced
   * misleading red badges for advisories like "skill missing optional
   * config" or "skill needs `obsidian` binary".
   */
  type?: 'error' | 'warning' | 'fix' | 'preview' | 'status';
}

interface DoctorSectionProps {
  colors: any;
}

export function DoctorSection({ colors }: DoctorSectionProps) {
  const { t } = useTranslation();
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<DoctorLogEntry[]>([]);
  const [lastRun, setLastRun] = useState<Date | null>(null);

  // Load last run time from Electron config on mount
  useEffect(() => {
    window.electronAPI?.getConfig?.().then((config) => {
      if (config?.doctorLastRun) {
        setLastRun(new Date(config.doctorLastRun));
      }
    }).catch(() => {});
  }, []);
  const [summary, setSummary] = useState<{
    /** True blockers (red ❌). */
    problemsFound: number;
    /** Yellow advisories — formerly conflated with problemsFound. */
    warningsFound: number;
    /** "Doctor changes" preview entries — fixes that --fix would apply. */
    fixesPreviewed: number;
    /** Repairs applied (only populated by `doctor --fix`). */
    problemsFixed: number;
    status: 'idle' | 'running' | 'success' | 'warning' | 'error';
  }>({
    problemsFound: 0,
    warningsFound: 0,
    fixesPreviewed: 0,
    problemsFixed: 0,
    status: 'idle',
  });
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const runDiagnostics = async () => {
    setIsRunning(true);
    setSummary(prev => ({ ...prev, status: 'running' }));
    setLogs([]);

    // Add initial log
    const initialLog: DoctorLogEntry = {
      timestamp: new Date().toISOString(),
      level: 'info',
      message: '🏥 Starting OpenClaw Doctor diagnostics...',
      type: 'status'
    };
    setLogs([initialLog]);

    try {
      // Call the doctor command via electron API
      const doctorOutput = await window.electronAPI?.runDoctor?.();

      if (doctorOutput?.success) {
        // Render the raw doctor output as structured log entries. The
        // main-process parser is the source of truth for the counter
        // badges — we no longer re-count in the renderer (that was the
        // path that lit up "8 problems found" on a clean machine because
        // every clack-panel bullet counted, regardless of warning vs
        // error context). See managers/doctor-manager.ts:parseDoctorOutput.
        renderDoctorLogs(doctorOutput.output, doctorOutput.errors);
        const errors = doctorOutput.problemsFound ?? 0;
        const warnings = doctorOutput.warningsFound ?? 0;
        const previews = doctorOutput.fixesPreviewed ?? 0;
        const fixed = doctorOutput.problemsFixed ?? 0;
        setSummary({
          problemsFound: errors,
          warningsFound: warnings,
          fixesPreviewed: previews,
          problemsFixed: fixed,
          status: errors > 0 ? 'error' : warnings > 0 ? 'warning' : 'success',
        });
      } else {
        throw new Error(doctorOutput?.error || 'Doctor command failed');
      }
    } catch (error) {
      const errorLog: DoctorLogEntry = {
        timestamp: new Date().toISOString(),
        level: 'error',
        message: `❌ Doctor failed: ${error instanceof Error ? error.message : String(error)}`,
        type: 'status'
      };
      setLogs(prev => [...prev, errorLog]);
      setSummary(prev => ({ ...prev, status: 'error' }));
    } finally {
      setIsRunning(false);
      const now = new Date();
      setLastRun(now);
      // Persist to Electron config
      try {
        const cfg = await window.electronAPI?.getConfig?.() || {};
        cfg.doctorLastRun = now.toISOString();
        await window.electronAPI?.saveConfig?.(cfg);
      } catch {}
    }
  };

  // Pattern matchers for panel headers. Mirrors managers/doctor-manager.ts
  // so per-line log coloring matches the badge counts the main process
  // returns. Order matters — most specific first.
  const PANEL_ERROR_RE = /^[\s│┌└├─◇◆◐◯╭╮╯╰┤┬┴┼]*Doctor errors\b/i;
  const PANEL_WARNING_RE = /^[\s│┌└├─◇◆◐◯╭╮╯╰┤┬┴┼]*Doctor warnings\b/i;
  const PANEL_CHANGES_RE = /^[\s│┌└├─◇◆◐◯╭╮╯╰┤┬┴┼]*Doctor changes\b/i;
  const PANEL_GENERIC_RE = /^[\s│┌└├─◇◆◐◯╭╮╯╰┤┬┴┼]*[A-Z][\w\s/]*?\s+[─╮╭]/;
  const BULLET_RE = /^[\s│┌└├─◇◆◐◯╭╮╯╰┤┬┴┼]*-\s/;

  // Strip the leading box-drawing prefix to see what a line ACTUALLY says.
  const BOX_PREFIX_STRIP_RE = /^[\s│┌└├─◇◆◐◯╭╮╯╰┤┬┴┼]+/;
  // Lines that are purely box-drawing separators carry no signal.
  const PURE_SEPARATOR_RE = /^[─╮╭╯┤├]+$/;
  // Trailing box-drawing on the right side of a panel row.
  const TRAILING_BOX_RE = /[\s│]+$/;

  const renderDoctorLogs = (output: string, errors: string) => {
    const lines = (output + '\n' + errors).split('\n');
    const parsedLogs: DoctorLogEntry[] = [];

    // Track the enclosing panel's severity so each bullet inherits the
    // right color. Default to error for bare top-level bullets.
    let currentSeverity: 'error' | 'warning' | 'info' | 'success' = 'error';

    lines.forEach((rawLine) => {
      const trimmedLine = rawLine.trim();
      if (!trimmedLine) return;

      // Panel transitions — update current severity, don't emit a log entry.
      if (PANEL_ERROR_RE.test(trimmedLine)) { currentSeverity = 'error'; return; }
      if (PANEL_WARNING_RE.test(trimmedLine)) { currentSeverity = 'warning'; return; }
      if (PANEL_CHANGES_RE.test(trimmedLine)) { currentSeverity = 'info'; return; }
      if (PANEL_GENERIC_RE.test(trimmedLine)) { currentSeverity = 'warning'; return; }

      // Strip the box-drawing prefix + trailing chars to see the actual content.
      // A clack box-drawing row looks like:
      //   │  - real content here  │
      // After stripping leading box chars and trailing │, we get the meat.
      const inside = trimmedLine.replace(BOX_PREFIX_STRIP_RE, '').replace(TRAILING_BOX_RE, '');
      // Skip lines that are 100% decorative — empty box rows, separator runs,
      // closing corners. These are the bulk of "yellow noise" in the log pane.
      if (!inside) return;
      if (PURE_SEPARATOR_RE.test(inside)) return;

      let level: DoctorLogEntry['level'] = 'info';
      let type: DoctorLogEntry['type'] = 'status';
      let message = inside;

      // Forward-compat: doctor --fix emits explicit success markers.
      if (/^✅|^Applied:|^Fixed:|^Repaired:/i.test(inside)) {
        level = 'success';
        type = 'fix';
        message = `✅ ${inside.replace(/^✅\s*/, '')}`;
      } else if (/^-\s/.test(inside)) {
        // Bullet inherits the panel's severity. "No issues/warnings"
        // is informational ("- No issues detected.").
        if (/^-\s+No\s/i.test(inside)) {
          type = 'status';
          level = 'info';
        } else if (currentSeverity === 'error') {
          type = 'error';
          level = 'error';
        } else if (currentSeverity === 'warning') {
          type = 'warning';
          level = 'warning';
        } else if (currentSeverity === 'info') {
          // "Doctor changes" panel — auto-fix previews, NOT problems.
          type = 'preview';
          level = 'info';
        }
      }
      // Prose lines (not bullets, not success markers) fall through to
      // level='info' / type='status'. They render with a transparent
      // background — visible for context but not screaming for attention.

      parsedLogs.push({
        timestamp: new Date().toISOString(),
        level,
        message,
        type,
      });
    });

    setLogs((prev) => [...prev, ...parsedLogs]);
  };

  const getStatusIcon = () => {
    switch (summary.status) {
      case 'running':
        return <Loader2 className="h-5 w-5 animate-spin" style={{ color: colors.accent.blue }} />;
      case 'success':
        return <CheckCircle className="h-5 w-5" style={{ color: colors.accent.green }} />;
      case 'warning':
        return <AlertCircle className="h-5 w-5" style={{ color: colors.accent.yellow }} />;
      case 'error':
        return <XCircle className="h-5 w-5" style={{ color: colors.accent.red }} />;
      default:
        return <Stethoscope className="h-5 w-5" style={{ color: colors.text.muted }} />;
    }
  };

  const getLogIcon = (entry: DoctorLogEntry) => {
    switch (entry.level) {
      case 'success':
        return <CheckCircle className="h-4 w-4 flex-shrink-0" style={{ color: colors.accent.green }} />;
      case 'warning':
        return <AlertCircle className="h-4 w-4 flex-shrink-0" style={{ color: colors.accent.yellow }} />;
      case 'error':
        return <XCircle className="h-4 w-4 flex-shrink-0" style={{ color: colors.accent.red }} />;
      default:
        return <Terminal className="h-4 w-4 flex-shrink-0" style={{ color: colors.text.muted }} />;
    }
  };

  return (
    <div className="h-full flex flex-col p-6 gap-6">
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          {getStatusIcon()}
          <div className="flex items-baseline gap-2">
            <h2 className="font-display text-lg font-bold tracking-tight" style={{ color: colors.text.header }}>
              {t('doctor.title')}
            </h2>
            <p className="text-sm" style={{ color: colors.text.muted }}>
              {t('doctor.subtitle')}
            </p>
          </div>
        </div>
        <Button
          onClick={runDiagnostics}
          disabled={isRunning}
          className="flex items-center gap-2 px-6 py-2"
          style={{
            backgroundColor: colors.accent.brand,
            color: colors.button.primaryFg,
          }}
        >
          {isRunning ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('doctor.running')}
            </>
          ) : (
            <>
              <PlayCircle className="h-4 w-4" />
              {t('doctor.runDiagnostics')}
            </>
          )}
        </Button>
      </div>

      {/* Status Summary — 4 cards. The Warnings card was previously
          conflated into Problems Found, producing scary "N issues
          detected" badges for what were really yellow advisories. */}
      <div className="grid grid-cols-4 gap-4 flex-shrink-0">
        {/* Errors (red) — true blockers from "Doctor errors" panels. */}
        <Card className="border-0 shadow-none" style={{ backgroundColor: colors.bg.secondary }}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-2xl font-bold tracking-tight" style={{ color: colors.text.header }}>{summary.problemsFound}</span>
                <span className="text-sm" style={{ color: colors.text.muted }}>{t('doctor.problemsFound')}</span>
              </div>
              <XCircle className="h-6 w-6 flex-shrink-0" style={{ color: colors.accent.red }} />
            </div>
          </CardContent>
        </Card>

        {/* Warnings (yellow) — advisories from "Doctor warnings" + generic panels. */}
        <Card className="border-0 shadow-none" style={{ backgroundColor: colors.bg.secondary }}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-2xl font-bold tracking-tight" style={{ color: colors.text.header }}>{summary.warningsFound}</span>
                <span className="text-sm" style={{ color: colors.text.muted }}>{t('doctor.warningsFound', 'Warnings')}</span>
              </div>
              <AlertCircle className="h-6 w-6 flex-shrink-0" style={{ color: colors.accent.yellow }} />
            </div>
          </CardContent>
        </Card>

        {/* Fixes Previewed (info) — "Doctor changes" panel entries the
            gateway would auto-apply on `doctor --fix`. Not problems. */}
        <Card className="border-0 shadow-none" style={{ backgroundColor: colors.bg.secondary }}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-2xl font-bold tracking-tight" style={{ color: colors.text.header }}>{summary.fixesPreviewed}</span>
                <span className="text-sm" style={{ color: colors.text.muted }}>{t('doctor.fixesPreviewed', 'Fixes Previewed')}</span>
              </div>
              <CheckCircle className="h-6 w-6 flex-shrink-0" style={{ color: colors.accent.green }} />
            </div>
          </CardContent>
        </Card>

        {/* Last run timestamp. */}
        <Card className="border-0 shadow-none" style={{ backgroundColor: colors.bg.secondary }}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1">
                <span className="text-sm" style={{ color: colors.text.muted }}>{t('doctor.lastRun')}</span>
                <span className="text-sm font-medium" style={{ color: colors.text.header }}>
                  {lastRun ? lastRun.toLocaleString() : t('common.never')}
                </span>
              </div>
              <Clock className="h-6 w-6 flex-shrink-0" style={{ color: colors.text.muted }} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Doctor Output Logs */}
      <Card className="flex-1 flex flex-col min-h-0 border-0 shadow-none" style={{ backgroundColor: colors.bg.secondary }}>
        <CardContent className="flex-1 flex flex-col min-h-0 p-0">
          <div
            ref={logContainerRef}
            className="flex-1 overflow-y-auto space-y-1"
            style={{
              backgroundColor: colors.bg.tertiary,
            }}
          >
            {logs.length === 0 ? (
              <div className="flex items-center justify-center h-full text-center">
                <div>
                  <Shield className="h-12 w-12 mx-auto mb-4" style={{ color: colors.text.muted }} />
                  <p className="text-base" style={{ color: colors.text.muted }}>
                    {t('doctor.clickToStart')}
                  </p>
                </div>
              </div>
            ) : (
              [...logs].toReversed().map((entry, index) => (
                <div
                  key={index}
                  className="flex items-start gap-2 px-3 py-1.5 rounded-md hover:bg-opacity-50 transition-colors"
                  style={{
                    // Only TINT the background when the line has its own
                    // pill (real actionable item). Prose / status lines
                    // are level='info' but type='status' — we render them
                    // transparently so the log pane isn't a wall of yellow
                    // when a warning panel has lots of contextual prose.
                    backgroundColor: entry.type === 'error' ? `${colors.accent.red}15` :
                                   entry.type === 'warning' ? `${colors.accent.yellow}15` :
                                   entry.type === 'fix' ? `${colors.accent.green}15` :
                                   entry.type === 'preview' ? `${colors.accent.blue}15` :
                                   'transparent'
                  }}
                >
                  {getLogIcon(entry)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-xs font-medium tracking-wide"
                        style={{ color: colors.text.muted }}
                      >
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                      {entry.type && entry.type !== 'status' && (
                        <span
                          className="text-xs px-2 py-1 rounded-full font-medium uppercase tracking-wide"
                          style={{
                            backgroundColor:
                              entry.type === 'error' ? colors.accent.red :
                              entry.type === 'warning' ? colors.accent.yellow :
                              entry.type === 'fix' ? colors.accent.green :
                              entry.type === 'preview' ? colors.accent.blue :
                              colors.accent.blue,
                            color: colors.button.primaryFg,
                            opacity: 0.95
                          }}
                        >
                          {entry.type === 'error' ? t('doctor.error', 'Error') :
                           entry.type === 'warning' ? t('doctor.warning', 'Warning') :
                           entry.type === 'fix' ? t('doctor.fix') :
                           entry.type === 'preview' ? t('doctor.preview', 'Preview') :
                           t('doctor.status')}
                        </span>
                      )}
                    </div>
                    <p
                      className="text-sm leading-relaxed font-medium break-words"
                      style={{
                        // Same idea as background: only color the text
                        // when this row has a pill. Prose/status lines
                        // use the muted header color so they read like
                        // context, not severity.
                        color: entry.type === 'fix' ? colors.accent.green :
                               entry.type === 'warning' ? colors.accent.yellow :
                               entry.type === 'error' ? colors.accent.red :
                               entry.type === 'preview' ? colors.accent.blue :
                               colors.text.normal,
                        fontFamily: 'inherit'
                      }}
                    >
                      {entry.message}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

    </div>
  );
}