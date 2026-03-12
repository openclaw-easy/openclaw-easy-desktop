import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare, Calendar, Trash2, Plus, RefreshCw, Search } from 'lucide-react';

interface ColorScheme {
  bg: {
    primary: string;
    secondary: string;
    tertiary: string;
    hover: string;
    active: string;
  };
  text: {
    normal: string;
    muted: string;
    header: string;
    link: string;
    danger: string;
  };
  accent: {
    brand: string;
    green: string;
    yellow: string;
    red: string;
    purple: string;
  };
}

interface SessionsSectionProps {
  colors: ColorScheme;
  onSelectSession?: (sessionKey: string) => void;
  currentSession?: string;
}

interface Session {
  key: string;
  kind: string;
  chatType: string;
  updatedAt?: number;
  inputTokens?: number;
  outputTokens?: number;
  messageCount?: number;
}

export function SessionsSection({ colors, onSelectSession, currentSession }: SessionsSectionProps) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterActive, setFilterActive] = useState<number>(0); // 0 = all, N = last N minutes
  const [deleteConfirm, setDeleteConfirm] = useState<{ show: boolean; sessionKey: string; displayName: string }>({
    show: false,
    sessionKey: '',
    displayName: '',
  });
  const [deleting, setDeleting] = useState(false);

  const loadSessions = async () => {
    setLoading(true);
    try {
      console.log('[SessionsSection] Loading sessions with filter:', filterActive || 'all');
      // Pass filterActive to API if set (0 means all sessions)
      const result = await window.electronAPI?.listSessions?.(
        undefined, // agentId
        filterActive > 0 ? filterActive : undefined // activeMinutes
      );
      console.log('[SessionsSection] Sessions result:', result);

      if (result?.success && result.sessions) {
        setSessions(result.sessions);
      } else {
        console.warn('[SessionsSection] Failed to load sessions:', result?.error);
      }
    } catch (error) {
      console.error('[SessionsSection] Error loading sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
    // Refresh sessions every 30 seconds
    const interval = setInterval(loadSessions, 30000);
    return () => clearInterval(interval);
  }, [filterActive]);

  const formatTimestamp = (timestamp?: number) => {
    if (!timestamp) {return t('common.never');}
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) {return t('common.justNow');}
    if (minutes < 60) {return t('common.minutesAgo', { count: minutes });}
    if (hours < 24) {return t('common.hoursAgo', { count: hours });}
    if (days < 7) {return t('common.daysAgo', { count: days });}
    return date.toLocaleDateString();
  };

  const formatTokens = (inputTokens?: number, outputTokens?: number) => {
    const total = (inputTokens || 0) + (outputTokens || 0);
    if (total === 0) {return '0';}
    if (total < 1000) {return total.toString();}
    return `${(total / 1000).toFixed(1)}K`;
  };

  const getSessionDisplayName = (sessionKey: string) => {
    // Extract meaningful parts from session key
    // Format: agent:<agentId>:<scope> or agent:<agentId>:<channel>:group:<id>
    const parts = sessionKey.split(':');
    if (parts.length >= 3) {
      const scope = parts[2];
      if (scope === 'main') {return t('sessions.mainConversation');}
      return scope.charAt(0).toUpperCase() + scope.slice(1);
    }
    return sessionKey;
  };

  const handleDeleteSession = async (sessionKey: string) => {
    setDeleting(true);
    try {
      console.log('[SessionsSection] Deleting session:', sessionKey);
      const result = await window.electronAPI?.deleteSession?.(sessionKey);

      if (result?.success) {
        console.log('[SessionsSection] Session deleted successfully');
        // Reload sessions list
        await loadSessions();
      } else {
        console.error('[SessionsSection] Failed to delete session:', result?.error);
        alert(`Failed to delete session: ${result?.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('[SessionsSection] Error deleting session:', error);
      alert('Error deleting session');
    } finally {
      setDeleting(false);
      setDeleteConfirm({ show: false, sessionKey: '', displayName: '' });
    }
  };

  const filteredSessions = sessions.filter((session) => {
    // Search filter only (time filter handled by API)
    return searchQuery === '' ||
      session.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
      getSessionDisplayName(session.key).toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-4 pb-3 border-b" style={{ borderColor: colors.bg.tertiary }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-baseline gap-2">
            <h3 className="text-lg font-bold" style={{ color: colors.text.header }}>
              {t('sessions.title')}
            </h3>
            <p className="text-xs" style={{ color: colors.text.muted }}>
              {t('sessions.subtitle')}
            </p>
          </div>
          <button
            onClick={loadSessions}
            disabled={loading}
            className="p-2 rounded-lg transition-colors"
            style={{
              backgroundColor: colors.bg.tertiary,
              color: colors.text.muted
            }}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Search and Filter */}
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: colors.text.muted }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('sessions.searchPlaceholder')}
              className="w-full pl-9 pr-3 py-2 rounded-lg text-sm"
              style={{
                backgroundColor: colors.bg.tertiary,
                color: colors.text.normal,
                border: 'none',
                outline: 'none',
              }}
            />
          </div>
          <select
            value={filterActive}
            onChange={(e) => setFilterActive(Number(e.target.value))}
            className="px-3 py-2 rounded-lg text-sm"
            style={{
              backgroundColor: colors.bg.tertiary,
              color: colors.text.normal,
              border: 'none',
            }}
          >
            <option value={0}>{t('sessions.allSessions')}</option>
            <option value={60}>{t('sessions.lastHour')}</option>
            <option value={720}>{t('sessions.last12Hours')}</option>
            <option value={1440}>{t('sessions.last24Hours')}</option>
            <option value={4320}>{t('sessions.last3Days')}</option>
          </select>
        </div>
      </div>

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-6 w-6 animate-spin" style={{ color: colors.text.muted }} />
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="text-center py-12">
            <MessageSquare className="h-12 w-12 mx-auto mb-3" style={{ color: colors.text.muted, opacity: 0.5 }} />
            <p className="text-sm" style={{ color: colors.text.muted }}>
              {searchQuery || filterActive > 0 ? t('sessions.noMatch') : t('sessions.noSessions')}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredSessions.map((session) => (
              <div
                key={session.key}
                className="rounded-lg p-4 transition-all hover:scale-[1.01] group"
                style={{
                  backgroundColor: currentSession === session.key ? colors.bg.active : colors.bg.secondary,
                  border: currentSession === session.key ? `2px solid ${colors.accent.brand}` : 'none',
                }}
              >
                <div className="flex items-start justify-between mb-2">
                  <div
                    className="flex items-center space-x-2 flex-1 cursor-pointer"
                    onClick={() => onSelectSession?.(session.key)}
                  >
                    <MessageSquare className="h-4 w-4" style={{ color: colors.accent.brand }} />
                    <span className="font-medium text-sm" style={{ color: colors.text.header }}>
                      {getSessionDisplayName(session.key)}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs" style={{ color: colors.text.muted }}>
                      {formatTimestamp(session.updatedAt)}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirm({
                          show: true,
                          sessionKey: session.key,
                          displayName: getSessionDisplayName(session.key),
                        });
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded transition-all hover:scale-110"
                      style={{
                        backgroundColor: colors.bg.tertiary,
                        color: colors.accent.red,
                      }}
                      title="Delete session"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => onSelectSession?.(session.key)}
                >
                  <div className="text-xs" style={{ color: colors.text.muted }}>
                    <span className="font-mono">{session.key}</span>
                  </div>
                  <div className="flex items-center space-x-3 text-xs" style={{ color: colors.text.muted }}>
                    {session.messageCount !== undefined && (
                      <span>💬 {session.messageCount}</span>
                    )}
                    <span>🎯 {formatTokens(session.inputTokens, session.outputTokens)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer Stats */}
      <div className="px-6 py-3 border-t" style={{ borderColor: colors.bg.tertiary }}>
        <div className="flex items-center justify-between text-xs" style={{ color: colors.text.muted }}>
          <span>{t('sessions.sessionCount', { count: filteredSessions.length })}</span>
          <span>{t('cron.total')}: {sessions.length}</span>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      {deleteConfirm.show && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)' }}
          onClick={() => !deleting && setDeleteConfirm({ show: false, sessionKey: '', displayName: '' })}
        >
          <div
            className="rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl"
            style={{ backgroundColor: colors.bg.secondary }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start space-x-3 mb-4">
              <div
                className="p-2 rounded-lg"
                style={{ backgroundColor: colors.bg.tertiary }}
              >
                <Trash2 className="h-5 w-5" style={{ color: colors.accent.red }} />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg mb-1" style={{ color: colors.text.header }}>
                  {t('sessions.deleteSession')}
                </h3>
                <p className="text-sm" style={{ color: colors.text.muted }}>
                  {t('sessions.deleteConfirm')}
                </p>
              </div>
            </div>

            <div
              className="rounded-lg p-3 mb-4"
              style={{ backgroundColor: colors.bg.tertiary }}
            >
              <div className="text-sm font-medium mb-1" style={{ color: colors.text.header }}>
                {deleteConfirm.displayName}
              </div>
              <div className="text-xs font-mono" style={{ color: colors.text.muted }}>
                {deleteConfirm.sessionKey}
              </div>
            </div>

            <div className="flex space-x-3">
              <button
                onClick={() => setDeleteConfirm({ show: false, sessionKey: '', displayName: '' })}
                disabled={deleting}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{
                  backgroundColor: colors.bg.tertiary,
                  color: colors.text.normal,
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => handleDeleteSession(deleteConfirm.sessionKey)}
                disabled={deleting}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{
                  backgroundColor: colors.accent.red,
                  color: '#FFFFFF',
                  opacity: deleting ? 0.6 : 1,
                }}
              >
                {deleting ? t('common.deleting') : t('sessions.deleteSession')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
