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
  type?: 'problem' | 'fix' | 'status';
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
    problemsFound: number;
    problemsFixed: number;
    status: 'idle' | 'running' | 'success' | 'warning' | 'error';
  }>({
    problemsFound: 0,
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
        // Parse doctor output into structured logs
        parseDoctorOutput(doctorOutput.output, doctorOutput.errors);
        setSummary(prev => ({
          ...prev,
          status: doctorOutput.problemsFixed > 0 ? 'success' : 'warning'
        }));
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

  const parseDoctorOutput = (output: string, errors: string) => {
    const lines = (output + '\n' + errors).split('\n').filter(line => line.trim());
    let problemsFound = 0;
    let problemsFixed = 0;
    const parsedLogs: DoctorLogEntry[] = [];

    lines.forEach(line => {
      const trimmedLine = line.trim();
      if (!trimmedLine) {return;}

      let level: DoctorLogEntry['level'] = 'info';
      let type: DoctorLogEntry['type'] = 'status';
      let message = trimmedLine;

      // Detect message types by emoji prefix first (most reliable),
      // then fall back to keyword heuristics — but skip "no ... detected"
      // phrases that indicate the absence of a problem.
      const isNegated = /\b(no|not|none|zero)\b/i.test(trimmedLine);

      if (trimmedLine.includes('✅') || trimmedLine.includes('fixed') || trimmedLine.includes('resolved')) {
        level = 'success';
        type = 'fix';
        problemsFixed++;
        message = `✅ ${trimmedLine.replace(/^✅\s*/, '')}`;
      } else if (trimmedLine.includes('⚠️') || (!isNegated && /\bwarning\b/i.test(trimmedLine)) || (!isNegated && /\bissue\b/i.test(trimmedLine))) {
        level = 'warning';
        type = 'problem';
        problemsFound++;
        message = `⚠️ ${trimmedLine.replace(/^⚠️\s*/, '')}`;
      } else if (trimmedLine.includes('❌') || (!isNegated && /\berror\b/i.test(trimmedLine)) || (!isNegated && /\bfailed\b/i.test(trimmedLine))) {
        level = 'error';
        type = 'problem';
        problemsFound++;
        message = `❌ ${trimmedLine.replace(/^❌\s*/, '')}`;
      } else if (trimmedLine.includes('🔍') || trimmedLine.includes('checking') || trimmedLine.includes('scanning')) {
        level = 'info';
        message = `🔍 ${trimmedLine.replace(/^🔍\s*/, '')}`;
      }

      parsedLogs.push({
        timestamp: new Date().toISOString(),
        level,
        message,
        type
      });
    });

    setLogs(prev => [...prev, ...parsedLogs]);
    setSummary(prev => ({
      ...prev,
      problemsFound,
      problemsFixed,
      status: problemsFound === 0 ? 'success' : problemsFixed > 0 ? 'warning' : 'error'
    }));
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
            <h2 className="text-lg font-bold" style={{ color: colors.text.header }}>
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
            backgroundColor: colors.accent.blue,
            color: colors.bg.primary,
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

      {/* Status Summary */}
      <div className="grid grid-cols-3 gap-4 flex-shrink-0">
        <Card className="border-0 shadow-none" style={{ backgroundColor: colors.bg.secondary }}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold" style={{ color: colors.text.header }}>{summary.problemsFound}</span>
                <span className="text-sm" style={{ color: colors.text.muted }}>{t('doctor.problemsFound')}</span>
              </div>
              <AlertCircle className="h-6 w-6 flex-shrink-0" style={{ color: colors.accent.yellow }} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-none" style={{ backgroundColor: colors.bg.secondary }}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold" style={{ color: colors.text.header }}>{summary.problemsFixed}</span>
                <span className="text-sm" style={{ color: colors.text.muted }}>{t('doctor.problemsFixed')}</span>
              </div>
              <CheckCircle className="h-6 w-6 flex-shrink-0" style={{ color: colors.accent.green }} />
            </div>
          </CardContent>
        </Card>

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
              backgroundColor: colors.bg.primary,
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
                    backgroundColor: entry.level === 'error' ? `${colors.accent.red}15` :
                                   entry.level === 'warning' ? `${colors.accent.yellow}15` :
                                   entry.level === 'success' ? `${colors.accent.green}15` :
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
                      {entry.type && (
                        <span
                          className="text-xs px-2 py-1 rounded-full font-medium uppercase tracking-wide"
                          style={{
                            backgroundColor: entry.type === 'fix' ? colors.accent.green :
                                           entry.type === 'problem' ? colors.accent.red :
                                           colors.accent.blue,
                            color: colors.bg.primary,
                            opacity: 0.9
                          }}
                        >
                          {entry.type === 'problem' ? t('doctor.problem') : entry.type === 'fix' ? t('doctor.fix') : t('doctor.status')}
                        </span>
                      )}
                    </div>
                    <p
                      className="text-sm leading-relaxed font-medium break-words"
                      style={{
                        color: entry.level === 'success' ? colors.accent.green :
                               entry.level === 'warning' ? colors.accent.yellow :
                               entry.level === 'error' ? colors.accent.red :
                               colors.text.header,
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