import React, { useState, useEffect } from 'react';
import { ShieldAlert, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ExecApprovalRequest, ExecApprovalDecision } from '../../hooks/useExecApproval';

interface ColorTheme {
  background: {
    primary: string;
    secondary: string;
    tertiary: string;
    modifier: { hover: string; active: string; selected: string };
  };
  text: { normal: string; muted: string; header: string };
  accent: { brand: string; green: string; userBubble: string };
}

interface ExecApprovalOverlayProps {
  queue: ExecApprovalRequest[];
  busy: boolean;
  error: string | null;
  colors: ColorTheme;
  onDecision: (id: string, decision: ExecApprovalDecision) => void;
}

function formatRemaining(ms: number): string {
  const remaining = Math.max(0, ms);
  const totalSeconds = Math.floor(remaining / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

function MetaRow({ label, value, colors }: { label: string; value?: string | null; colors: ColorTheme }) {
  if (!value) return null;
  return (
    <div className="flex justify-between text-xs py-0.5">
      <span style={{ color: colors.text.muted }}>{label}</span>
      <span className="ml-4 text-right break-all" style={{ color: colors.text.normal }}>{value}</span>
    </div>
  );
}

export function ExecApprovalOverlay({ queue, busy, error, colors, onDecision }: ExecApprovalOverlayProps) {
  const { t } = useTranslation();
  const active = queue[0];
  const [, forceUpdate] = useState(0);

  // Tick every second to update the countdown
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => forceUpdate(n => n + 1), 1000);
    return () => clearInterval(interval);
  }, [active?.id]);

  if (!active) return null;

  const { request } = active;
  const remainingMs = active.expiresAtMs - Date.now();
  const remaining = remainingMs > 0 ? `expires in ${formatRemaining(remainingMs)}` : 'expired';
  const queueCount = queue.length;

  return (
    <div
      className="absolute inset-0 flex items-center justify-center z-50"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      role="dialog"
      aria-live="polite"
    >
      <div
        className="relative rounded-xl shadow-2xl p-6 max-w-lg w-full mx-4"
        style={{ backgroundColor: colors.background.secondary }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg" style={{ backgroundColor: '#f59e0b20' }}>
              <ShieldAlert className="h-5 w-5" style={{ color: '#f59e0b' }} />
            </div>
            <div>
              <h3 className="text-base font-bold" style={{ color: colors.text.header }}>
                {t('chat.execApprovalNeeded')}
              </h3>
              <p className="text-xs" style={{ color: colors.text.muted }}>{remaining}</p>
            </div>
          </div>
          {queueCount > 1 && (
            <span
              className="text-xs px-2 py-1 rounded-full font-medium"
              style={{ backgroundColor: colors.accent.brand, color: '#ffffff' }}
            >
              {queueCount} {t('chat.pending')}
            </span>
          )}
        </div>

        {/* Command */}
        <div
          className="rounded-lg p-3 mb-3 text-sm font-mono break-all whitespace-pre-wrap"
          style={{ backgroundColor: colors.background.primary, color: colors.text.normal }}
        >
          {request.command}
        </div>

        {/* Metadata */}
        <div
          className="rounded-lg p-3 mb-3"
          style={{ backgroundColor: colors.background.tertiary }}
        >
          <MetaRow label="Host" value={request.host} colors={colors} />
          <MetaRow label="Agent" value={request.agentId} colors={colors} />
          <MetaRow label="Session" value={request.sessionKey} colors={colors} />
          <MetaRow label="CWD" value={request.cwd} colors={colors} />
          <MetaRow label="Resolved" value={request.resolvedPath} colors={colors} />
          <MetaRow label="Security" value={request.security} colors={colors} />
          <MetaRow label="Ask" value={request.ask} colors={colors} />
        </div>

        {/* Error */}
        {error && (
          <div
            className="rounded-lg p-3 mb-3 text-sm"
            style={{ backgroundColor: '#991b1b30', color: '#fca5a5' }}
          >
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            disabled={busy}
            onClick={() => onDecision(active.id, 'allow-once')}
            className="flex-1 py-2.5 rounded-lg font-semibold text-sm transition-colors disabled:opacity-50"
            style={{ backgroundColor: colors.accent.brand, color: '#ffffff' }}
          >
            {t('chat.allowOnce')}
          </button>
          <button
            disabled={busy}
            onClick={() => onDecision(active.id, 'allow-always')}
            className="flex-1 py-2.5 rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
            style={{ backgroundColor: colors.background.tertiary, color: colors.text.normal }}
          >
            {t('chat.alwaysAllow')}
          </button>
          <button
            disabled={busy}
            onClick={() => onDecision(active.id, 'deny')}
            className="flex-1 py-2.5 rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
            style={{ backgroundColor: '#7f1d1d', color: '#fca5a5' }}
          >
            {t('chat.deny')}
          </button>
        </div>
      </div>
    </div>
  );
}
