import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../ui/button'
import {
  Clock,
  Plus,
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle,
  Play,
  Power,
  Trash2,
  ChevronDown,
  ChevronUp,
  XCircle
} from 'lucide-react'
import { ColorTheme } from '../types'

interface CronJobSchedule {
  kind: 'every' | 'cron' | 'at'
  everyMs?: number
  expr?: string
  tz?: string
  at?: string
}

interface CronJobPayload {
  kind: 'message' | 'system-event'
  message?: string
  event?: string
}

interface CronJob {
  id: string
  name: string
  description?: string
  enabled: boolean
  schedule: CronJobSchedule
  sessionTarget: 'main' | 'isolated'
  payload: CronJobPayload
  agentId?: string
  state: {
    nextRunAtMs?: number
    lastRunAtMs?: number
    lastStatus?: 'ok' | 'error' | 'skipped'
    lastError?: string
    lastDurationMs?: number
  }
  createdAtMs: number
}

interface CronSectionProps {
  colors: ColorTheme
}

function formatSchedule(schedule: CronJobSchedule): string {
  if (schedule.kind === 'every' && schedule.everyMs != null) {
    const ms = schedule.everyMs
    if (ms >= 86400000) {return `Every ${Math.round(ms / 86400000)}d`}
    if (ms >= 3600000) {return `Every ${Math.round(ms / 3600000)}h`}
    if (ms >= 60000) {return `Every ${Math.round(ms / 60000)}m`}
    return `Every ${Math.round(ms / 1000)}s`
  }
  if (schedule.kind === 'cron') {return schedule.expr || 'cron'}
  if (schedule.kind === 'at') {return `At ${schedule.at || ''}`}
  return 'Unknown'
}

function formatRelativeTime(ms: number | undefined): string {
  if (!ms) {return 'Never'}
  const delta = ms - Date.now()
  const absDelta = Math.abs(delta)
  const isPast = delta < 0
  if (absDelta < 60000) {return isPast ? 'Just now' : 'In <1m'}
  if (absDelta < 3600000) {
    const m = Math.round(absDelta / 60000)
    return isPast ? `${m}m ago` : `In ${m}m`
  }
  if (absDelta < 86400000) {
    const h = Math.round(absDelta / 3600000)
    return isPast ? `${h}h ago` : `In ${h}h`
  }
  const d = Math.round(absDelta / 86400000)
  return isPast ? `${d}d ago` : `In ${d}d`
}

export const CronSection: React.FC<CronSectionProps> = ({ colors }) => {
  const { t } = useTranslation()
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<Set<string>>(new Set())
  const [expandedJob, setExpandedJob] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)

  // Add form state
  const [formName, setFormName] = useState('')
  const [formScheduleKind, setFormScheduleKind] = useState<'every' | 'cron' | 'at'>('every')
  const [formScheduleValue, setFormScheduleValue] = useState('')
  const [formPayloadKind, setFormPayloadKind] = useState<'message' | 'system-event'>('message')
  const [formPayloadValue, setFormPayloadValue] = useState('')
  const [formAtDate, setFormAtDate] = useState('')
  const [formAtTime, setFormAtTime] = useState('')
  const [formAgentId, setFormAgentId] = useState('')
  const [formSubmitting, setFormSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const loadJobs = async (silent = false) => {
    if (!silent) {setLoading(true)}
    setError(null)
    try {
      const result = await window.electronAPI.listCronJobs()
      if (!result.success) {throw new Error(result.error || 'Failed to load cron jobs')}
      setJobs(result.jobs || [])
    } catch (err: any) {
      console.error('[CronSection] Error loading jobs:', err)
      setError(err.message || 'Failed to load cron jobs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadJobs()
  }, [])

  const withActionLoading = async (id: string, fn: () => Promise<void>) => {
    setActionLoading(prev => new Set(prev).add(id))
    try {
      await fn()
      await loadJobs(true)
    } finally {
      setActionLoading(prev => {
        const s = new Set(prev)
        s.delete(id)
        return s
      })
    }
  }

  const handleToggleEnabled = (job: CronJob) => {
    withActionLoading(job.id, async () => {
      if (job.enabled) {
        const result = await window.electronAPI.disableCronJob(job.id)
        if (!result.success) {throw new Error(result.error)}
      } else {
        const result = await window.electronAPI.enableCronJob(job.id)
        if (!result.success) {throw new Error(result.error)}
      }
    })
  }

  const handleDelete = (job: CronJob) => {
    if (!confirm(t('cron.deleteConfirm', { name: job.name }))) {return}
    withActionLoading(job.id, async () => {
      const result = await window.electronAPI.removeCronJob(job.id)
      if (!result.success) {throw new Error(result.error)}
    })
  }

  const handleRunNow = (job: CronJob) => {
    withActionLoading(`run-${job.id}`, async () => {
      const result = await window.electronAPI.runCronJob(job.id)
      if (!result.success) {throw new Error(result.error)}
    })
  }

  const handleAddJob = async () => {
    setFormError(null)
    if (!formName.trim()) { setFormError('Name is required'); return }
    if (!formPayloadValue.trim()) { setFormError('Payload is required'); return }

    // Build schedule value — combine date+time pickers for 'at' kind
    let scheduleValue = formScheduleValue.trim()
    if (formScheduleKind === 'at') {
      if (!formAtDate) { setFormError('Date is required'); return }
      if (!formAtTime) { setFormError('Time is required'); return }
      scheduleValue = `${formAtDate}T${formAtTime}:00`
    } else {
      if (!scheduleValue) { setFormError('Schedule value is required'); return }
    }

    setFormSubmitting(true)
    try {
      const result = await window.electronAPI.addCronJob({
        name: formName.trim(),
        scheduleKind: formScheduleKind,
        scheduleValue,
        payloadKind: formPayloadKind,
        payloadValue: formPayloadValue.trim(),
        agentId: formAgentId.trim() || undefined
      })
      if (!result.success) {throw new Error(result.error)}
      // Reset form
      setFormName('')
      setFormScheduleKind('every')
      setFormScheduleValue('')
      setFormAtDate('')
      setFormAtTime('')
      setFormPayloadKind('message')
      setFormPayloadValue('')
      setFormAgentId('')
      setShowAddForm(false)
      await loadJobs(true)
    } catch (err: any) {
      setFormError(err.message || 'Failed to add cron job')
    } finally {
      setFormSubmitting(false)
    }
  }

  const enabledCount = jobs.filter(j => j.enabled).length
  const disabledCount = jobs.length - enabledCount

  const inputStyle = {
    backgroundColor: colors.bg.primary,
    borderColor: colors.bg.hover,
    color: colors.text.normal,
    border: `1px solid ${colors.bg.hover}`,
    borderRadius: '6px',
    padding: '6px 10px',
    fontSize: '13px',
    width: '100%',
    outline: 'none'
  }

  const selectStyle = {
    ...inputStyle,
    cursor: 'pointer'
  }

  if (loading) {
    return (
      <div className="p-8 h-full flex items-center justify-center">
        <div className="flex items-center space-x-3">
          <Loader2 className="h-6 w-6 animate-spin" style={{ color: colors.accent.brand }} />
          <span style={{ color: colors.text.normal }}>{t('cron.loadingJobs')}</span>
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
        <div className="p-6 pb-4 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-baseline gap-2">
              <div className="flex items-center space-x-3">
                <Clock className="h-6 w-6" style={{ color: colors.accent.brand }} />
                <h3 className="text-lg font-semibold" style={{ color: colors.text.header }}>
                  {t('cron.title')}
                </h3>
              </div>
              <p className="text-sm" style={{ color: colors.text.muted }}>
                {t('cron.subtitle')}
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Button
                onClick={() => loadJobs()}
                size="sm"
                variant="outline"
                style={{ backgroundColor: colors.bg.tertiary, color: colors.text.normal, borderColor: colors.bg.hover }}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('common.refresh')}
              </Button>
              <Button
                onClick={() => setShowAddForm(v => !v)}
                size="sm"
                style={{ backgroundColor: colors.accent.brand, color: '#ffffff', border: 'none' }}
              >
                <Plus className="h-4 w-4 mr-2" />
                {t('cron.addJob')}
              </Button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="flex items-baseline justify-center gap-2 p-3 rounded" style={{ backgroundColor: colors.bg.tertiary }}>
              <span className="text-2xl font-bold" style={{ color: colors.text.header }}>{jobs.length}</span>
              <span className="text-xs" style={{ color: colors.text.muted }}>{t('cron.total')}</span>
            </div>
            <div className="flex items-baseline justify-center gap-2 p-3 rounded" style={{ backgroundColor: colors.bg.tertiary }}>
              <span className="text-2xl font-bold" style={{ color: colors.accent.green }}>{enabledCount}</span>
              <span className="text-xs" style={{ color: colors.text.muted }}>{t('common.enabled')}</span>
            </div>
            <div className="flex items-baseline justify-center gap-2 p-3 rounded" style={{ backgroundColor: colors.bg.tertiary }}>
              <span className="text-2xl font-bold" style={{ color: colors.text.muted }}>{disabledCount}</span>
              <span className="text-xs" style={{ color: colors.text.muted }}>{t('common.disabled')}</span>
            </div>
          </div>

          {/* Error banner */}
          {error && (
            <div
              className="flex items-start space-x-3 p-3 rounded mb-4"
              style={{ backgroundColor: `${colors.accent.red}15`, border: `1px solid ${colors.accent.red}40` }}
            >
              <AlertCircle className="h-5 w-5 flex-shrink-0" style={{ color: colors.accent.red }} />
              <div>
                <p className="text-sm font-medium" style={{ color: colors.text.header }}>{t('cron.mustBeRunning')}</p>
                <p className="text-xs mt-1" style={{ color: colors.text.muted }}>{error}</p>
              </div>
            </div>
          )}

          {/* Add Job Form */}
          {showAddForm && (
            <div
              className="rounded-lg p-4 mb-4"
              style={{ backgroundColor: colors.bg.primary }}
            >
              <h4 className="text-sm font-semibold mb-3" style={{ color: colors.text.header }}>{t('cron.newJob')}</h4>
              <div className="space-y-3">
                {/* Name */}
                <div>
                  <label className="block text-xs mb-1 font-medium" style={{ color: colors.text.muted }}>{t('cron.nameLabel')}</label>
                  <input
                    type="text"
                    placeholder={t('cron.namePlaceholder')}
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    style={inputStyle}
                  />
                </div>

                {/* Schedule type + value */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs mb-1 font-medium" style={{ color: colors.text.muted }}>{t('cron.scheduleType')}</label>
                    <select
                      value={formScheduleKind}
                      onChange={e => setFormScheduleKind(e.target.value as any)}
                      style={selectStyle}
                    >
                      <option value="every">{t('cron.everyInterval')}</option>
                      <option value="cron">{t('cron.cronExpression')}</option>
                      <option value="at">{t('cron.oneShot')}</option>
                    </select>
                  </div>
                  {formScheduleKind !== 'at' ? (
                    <div>
                      <label className="block text-xs mb-1 font-medium" style={{ color: colors.text.muted }}>
                        {formScheduleKind === 'every' ? t('cron.intervalLabel') : t('cron.cronExprLabel')}
                      </label>
                      <input
                        type="text"
                        placeholder={formScheduleKind === 'every' ? '1h' : '0 9 * * 1-5'}
                        value={formScheduleValue}
                        onChange={e => setFormScheduleValue(e.target.value)}
                        style={inputStyle}
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs mb-1 font-medium" style={{ color: colors.text.muted }}>{t('cron.dateLabel')}</label>
                        <input
                          type="date"
                          value={formAtDate}
                          onChange={e => setFormAtDate(e.target.value)}
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <label className="block text-xs mb-1 font-medium" style={{ color: colors.text.muted }}>{t('cron.timeLabel')}</label>
                        <input
                          type="time"
                          value={formAtTime}
                          onChange={e => setFormAtTime(e.target.value)}
                          style={inputStyle}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Payload type + value */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs mb-1 font-medium" style={{ color: colors.text.muted }}>{t('cron.payloadType')}</label>
                    <select
                      value={formPayloadKind}
                      onChange={e => setFormPayloadKind(e.target.value as any)}
                      style={selectStyle}
                    >
                      <option value="message">{t('cron.message')}</option>
                      <option value="system-event">{t('cron.systemEvent')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs mb-1 font-medium" style={{ color: colors.text.muted }}>
                      {formPayloadKind === 'message' ? t('cron.messageText') : t('cron.eventName')}
                    </label>
                    <input
                      type="text"
                      placeholder={formPayloadKind === 'message' ? 'Send daily summary' : 'daily-report'}
                      value={formPayloadValue}
                      onChange={e => setFormPayloadValue(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                </div>

                {/* Agent ID (optional) */}
                <div>
                  <label className="block text-xs mb-1 font-medium" style={{ color: colors.text.muted }}>{t('cron.agentIdOptional')}</label>
                  <input
                    type="text"
                    placeholder="main"
                    value={formAgentId}
                    onChange={e => setFormAgentId(e.target.value)}
                    style={inputStyle}
                  />
                </div>

                {formError && (
                  <p className="text-xs" style={{ color: colors.accent.red }}>{formError}</p>
                )}

                <div className="flex items-center space-x-2 pt-1">
                  <Button
                    onClick={handleAddJob}
                    disabled={formSubmitting}
                    size="sm"
                    style={{ backgroundColor: colors.accent.brand, color: '#ffffff', border: 'none' }}
                  >
                    {formSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
                    {t('cron.createJob')}
                  </Button>
                  <Button
                    onClick={() => { setShowAddForm(false); setFormError(null) }}
                    size="sm"
                    variant="outline"
                    style={{ backgroundColor: colors.bg.tertiary, color: colors.text.normal, borderColor: colors.bg.hover }}
                  >
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Job list */}
        <div className="flex-1 px-6 pb-6 min-h-0 overflow-hidden">
          <div className="h-full overflow-y-auto overflow-x-hidden">
            {jobs.length === 0 ? (
              <div className="text-center py-16">
                <Clock className="h-12 w-12 mx-auto mb-4" style={{ color: colors.text.muted, opacity: 0.4 }} />
                <h3 className="text-lg font-medium mb-2" style={{ color: colors.text.header }}>{t('cron.noJobsYet')}</h3>
                <p className="text-sm mb-4" style={{ color: colors.text.muted }}>
                  {t('cron.noJobsDesc')}
                </p>
                <Button
                  onClick={() => setShowAddForm(true)}
                  style={{ backgroundColor: colors.accent.brand, color: '#ffffff', border: 'none' }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t('cron.addFirstJob')}
                </Button>
              </div>
            ) : (
              <div className="space-y-3 pr-4">
                {jobs.map(job => {
                  const isExpanded = expandedJob === job.id
                  const isActioning = actionLoading.has(job.id)
                  const isRunning = actionLoading.has(`run-${job.id}`)

                  const lastStatusColor = job.state.lastStatus === 'ok'
                    ? colors.accent.green
                    : job.state.lastStatus === 'error'
                    ? colors.accent.red
                    : colors.text.muted

                  return (
                    <div
                      key={job.id}
                      className="rounded-lg overflow-hidden"
                      style={{ backgroundColor: colors.bg.primary }}
                    >
                      {/* Job row */}
                      <div className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3 min-w-0">
                            {/* Enabled indicator */}
                            <div
                              className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: job.enabled ? colors.accent.green : colors.text.muted }}
                            />
                            <div className="min-w-0">
                              <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                                <span className="font-medium text-sm" style={{ color: colors.text.header }}>
                                  {job.name}
                                </span>
                                <span
                                  className="px-2 py-0.5 text-xs rounded font-mono"
                                  style={{ backgroundColor: colors.bg.tertiary, color: colors.accent.brand }}
                                >
                                  {formatSchedule(job.schedule)}
                                </span>
                                {job.state.lastStatus && (
                                  <span
                                    className="px-2 py-0.5 text-xs rounded capitalize"
                                    style={{
                                      backgroundColor: `${lastStatusColor}20`,
                                      color: lastStatusColor,
                                      border: `1px solid ${lastStatusColor}40`
                                    }}
                                  >
                                    last: {job.state.lastStatus}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center space-x-3 mt-1">
                                <span className="text-xs" style={{ color: colors.text.muted }}>
                                  {job.payload.kind === 'message' ? `💬 ${job.payload.message?.slice(0, 40) || ''}` : `⚡ ${job.payload.event || ''}`}
                                </span>
                                {job.state.nextRunAtMs && (
                                  <span className="text-xs" style={{ color: colors.text.muted }}>
                                    {t('cron.nextRun', { time: formatRelativeTime(job.state.nextRunAtMs) })}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center space-x-2 flex-shrink-0 ml-3">
                            {/* Run now */}
                            <button
                              onClick={() => handleRunNow(job)}
                              disabled={isRunning}
                              title="Run now"
                              className="p-1.5 rounded hover:opacity-80 transition-opacity"
                              style={{ backgroundColor: `${colors.accent.green}20`, color: colors.accent.green }}
                            >
                              {isRunning
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Play className="h-3.5 w-3.5" />
                              }
                            </button>

                            {/* Enable/Disable */}
                            <button
                              onClick={() => handleToggleEnabled(job)}
                              disabled={isActioning}
                              title={job.enabled ? 'Disable' : 'Enable'}
                              className="p-1.5 rounded hover:opacity-80 transition-opacity"
                              style={{
                                backgroundColor: job.enabled ? `${colors.accent.red}20` : `${colors.accent.green}20`,
                                color: job.enabled ? colors.accent.red : colors.accent.green
                              }}
                            >
                              {isActioning
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Power className="h-3.5 w-3.5" />
                              }
                            </button>

                            {/* Delete */}
                            <button
                              onClick={() => handleDelete(job)}
                              disabled={isActioning}
                              title="Delete"
                              className="p-1.5 rounded hover:opacity-80 transition-opacity"
                              style={{ backgroundColor: `${colors.accent.red}15`, color: colors.accent.red }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>

                            {/* Expand */}
                            <button
                              onClick={() => setExpandedJob(isExpanded ? null : job.id)}
                              className="p-1.5 rounded hover:opacity-80 transition-opacity"
                              style={{ backgroundColor: colors.bg.tertiary, color: colors.text.muted }}
                            >
                              {isExpanded
                                ? <ChevronUp className="h-3.5 w-3.5" />
                                : <ChevronDown className="h-3.5 w-3.5" />
                              }
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Expanded details */}
                      {isExpanded && (
                        <div
                          className="px-4 pb-4 pt-0 border-t"
                          style={{ borderColor: colors.bg.tertiary }}
                        >
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3 text-xs">
                            <div>
                              <span className="block font-medium mb-0.5" style={{ color: colors.text.muted }}>{t('cron.jobId')}</span>
                              <span className="font-mono" style={{ color: colors.text.normal }}>{job.id}</span>
                            </div>
                            <div>
                              <span className="block font-medium mb-0.5" style={{ color: colors.text.muted }}>{t('cron.sessionTarget')}</span>
                              <span style={{ color: colors.text.normal }}>{job.sessionTarget}</span>
                            </div>
                            {job.agentId && (
                              <div>
                                <span className="block font-medium mb-0.5" style={{ color: colors.text.muted }}>{t('cron.agent')}</span>
                                <span style={{ color: colors.text.normal }}>{job.agentId}</span>
                              </div>
                            )}
                            {job.state.lastRunAtMs && (
                              <div>
                                <span className="block font-medium mb-0.5" style={{ color: colors.text.muted }}>{t('doctor.lastRun')}</span>
                                <span style={{ color: colors.text.normal }}>{formatRelativeTime(job.state.lastRunAtMs)}</span>
                              </div>
                            )}
                            {job.state.lastDurationMs != null && (
                              <div>
                                <span className="block font-medium mb-0.5" style={{ color: colors.text.muted }}>{t('cron.lastDuration')}</span>
                                <span style={{ color: colors.text.normal }}>{job.state.lastDurationMs}ms</span>
                              </div>
                            )}
                            <div>
                              <span className="block font-medium mb-0.5" style={{ color: colors.text.muted }}>{t('cron.created')}</span>
                              <span style={{ color: colors.text.normal }}>{formatRelativeTime(job.createdAtMs)}</span>
                            </div>
                          </div>

                          {job.state.lastError && (
                            <div
                              className="mt-3 p-2 rounded flex items-start space-x-2"
                              style={{ backgroundColor: `${colors.accent.red}15`, border: `1px solid ${colors.accent.red}30` }}
                            >
                              <XCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" style={{ color: colors.accent.red }} />
                              <span className="text-xs" style={{ color: colors.text.normal }}>{job.state.lastError}</span>
                            </div>
                          )}

                          {job.description && (
                            <p className="mt-3 text-xs" style={{ color: colors.text.muted }}>{job.description}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
