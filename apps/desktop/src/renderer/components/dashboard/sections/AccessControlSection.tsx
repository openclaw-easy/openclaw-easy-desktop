import React, { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw, Shield, UserCheck, Users, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../../contexts/ToastContext'
import type { ColorTheme } from '../types'

/**
 * "Who can use my assistant" — per-channel DM/group access policy plus
 * pending pairing approvals. Binds to the upstream channel config surface
 * (channels.<id>.dmPolicy / allowFrom / groupPolicy / groupAllowFrom) and
 * the `openclaw pairing` CLI. Saving applies live (gateway restart is
 * handled by the main process).
 */

type DmPolicy = 'open' | 'pairing' | 'allowlist' | 'disabled'
type GroupPolicy = 'open' | 'allowlist' | 'disabled'

interface ChannelAccess {
  channelId: string
  enabled: boolean
  dmPolicy?: DmPolicy
  allowFrom: string[]
  groupPolicy?: GroupPolicy
  groupAllowFrom: string[]
}

interface PairingRequest {
  channel: string
  code: string
  from?: string
  createdAt?: string
}

const DM_POLICIES: DmPolicy[] = ['open', 'pairing', 'allowlist', 'disabled']
const GROUP_POLICIES: GroupPolicy[] = ['open', 'allowlist', 'disabled']

// Channel ids whose config entries are internal, not user-facing chat surfaces.
const HIDDEN_CHANNELS = new Set(['clickclack'])

interface Props {
  colors: ColorTheme
}

function ListEditor({
  colors,
  values,
  onChange,
  placeholder,
  disabled,
}: {
  colors: ColorTheme
  values: string[]
  onChange: (next: string[]) => void
  placeholder: string
  disabled?: boolean
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft.trim()
    if (!v || values.includes(v)) return
    onChange([...values, v])
    setDraft('')
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {values.map((v) => (
        <span
          key={v}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
          style={{ backgroundColor: colors.bg.tertiary, color: colors.text.normal }}
        >
          {v}
          {!disabled && (
            <button
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="opacity-60 hover:opacity-100"
              aria-label={`remove ${v}`}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
          onBlur={add}
          placeholder={placeholder}
          className="min-w-[10rem] rounded px-2 py-1 text-xs outline-none"
          style={{ backgroundColor: colors.bg.tertiary, color: colors.text.normal }}
        />
      )}
    </div>
  )
}

export function AccessControlSection({ colors }: Props) {
  const { t } = useTranslation()
  const { addToast } = useToast()
  const [channels, setChannels] = useState<ChannelAccess[]>([])
  const [pairing, setPairing] = useState<PairingRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [savingChannel, setSavingChannel] = useState<string | null>(null)
  const [approving, setApproving] = useState<string | null>(null)
  // Local edits, keyed by channel id; unsaved changes live here until Apply.
  const [edits, setEdits] = useState<Record<string, ChannelAccess>>({})

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const [accessRes, pairingRes] = await Promise.all([
        window.electronAPI?.getChannelAccess?.(),
        window.electronAPI?.listPairingRequests?.(),
      ])
      if (accessRes?.success) {
        setChannels((accessRes.channels || []).filter((c) => !HIDDEN_CHANNELS.has(c.channelId)))
        setEdits({})
      } else if (accessRes?.error) {
        addToast(accessRes.error, 'error')
      }
      if (pairingRes?.success) setPairing(pairingRes.requests || [])
    } finally {
      setLoading(false)
    }
  }, [addToast])

  useEffect(() => {
    load()
  }, [load])

  const current = (c: ChannelAccess): ChannelAccess => edits[c.channelId] ?? c
  const isDirty = (c: ChannelAccess): boolean => {
    const e = edits[c.channelId]
    if (!e) return false
    return JSON.stringify(e) !== JSON.stringify(c)
  }
  const update = (channelId: string, base: ChannelAccess, patch: Partial<ChannelAccess>) => {
    setEdits((prev) => ({ ...prev, [channelId]: { ...(prev[channelId] ?? base), ...patch } }))
  }

  const apply = async (c: ChannelAccess) => {
    const e = edits[c.channelId]
    if (!e) return
    setSavingChannel(c.channelId)
    try {
      const res = await window.electronAPI?.setChannelAccess?.(c.channelId, {
        dmPolicy: e.dmPolicy,
        allowFrom: e.allowFrom,
        groupPolicy: e.groupPolicy,
        groupAllowFrom: e.groupAllowFrom,
      })
      if (res?.success) {
        addToast(t('access.saved', 'Access settings applied — the assistant restarted with the new policy.'), 'success')
        await load(true)
      } else {
        addToast(res?.error || t('access.saveFailed', 'Failed to apply access settings'), 'error')
      }
    } finally {
      setSavingChannel(null)
    }
  }

  const approve = async (req: PairingRequest) => {
    setApproving(req.code)
    try {
      const res = await window.electronAPI?.approvePairing?.(req.channel, req.code)
      if (res?.success) {
        addToast(t('access.pairingApproved', 'Pairing approved — that sender can now message your assistant.'), 'success')
        await load(true)
      } else {
        addToast(res?.error || t('access.pairingFailed', 'Failed to approve pairing code'), 'error')
      }
    } finally {
      setApproving(null)
    }
  }

  const dmPolicyLabel = (p: DmPolicy) =>
    ({
      open: t('access.dmOpen', 'Open — anyone can message'),
      pairing: t('access.dmPairing', 'Pairing — new senders need your approval'),
      allowlist: t('access.dmAllowlist', 'Allowlist — only listed senders'),
      disabled: t('access.dmDisabled', 'Disabled — ignore all DMs'),
    })[p]

  const groupPolicyLabel = (p: GroupPolicy) =>
    ({
      open: t('access.groupOpen', 'Open — reply in any group'),
      allowlist: t('access.groupAllowlist', 'Allowlist — only listed groups/senders'),
      disabled: t('access.groupDisabled', 'Disabled — ignore group chats'),
    })[p]

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: colors.text.muted }} />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 font-display text-lg font-bold tracking-tight" style={{ color: colors.text.header }}>
            <Shield className="h-5 w-5" />
            {t('access.title', 'Access Control')}
          </h2>
          <p className="text-sm" style={{ color: colors.text.muted }}>
            {t('access.subtitle', 'Decide who can talk to your assistant on each channel.')}
          </p>
        </div>
        <button
          onClick={() => load()}
          className="rounded p-2 hover:opacity-80"
          style={{ backgroundColor: colors.bg.tertiary, color: colors.text.normal }}
          aria-label={t('common.refresh', 'Refresh')}
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {pairing.length > 0 && (
        <div className="mb-6 rounded-lg border p-4" style={{ borderColor: colors.accent.yellow, backgroundColor: colors.bg.secondary }}>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold" style={{ color: colors.text.header }}>
            <UserCheck className="h-4 w-4" />
            {t('access.pendingPairing', 'Pending pairing requests')}
          </h3>
          <div className="space-y-2">
            {pairing.map((req) => (
              <div key={`${req.channel}:${req.code}`} className="flex items-center justify-between gap-2 text-sm" style={{ color: colors.text.normal }}>
                <span>
                  <span className="font-mono">{req.code}</span>
                  {' · '}
                  {req.channel}
                  {req.from ? ` · ${req.from}` : ''}
                </span>
                <button
                  onClick={() => approve(req)}
                  disabled={approving === req.code}
                  className="rounded px-3 py-1 text-xs font-medium hover:opacity-80 disabled:opacity-50"
                  style={{ backgroundColor: colors.button.primary, color: colors.button.primaryFg }}
                >
                  {approving === req.code
                    ? t('access.approving', 'Approving…')
                    : t('access.approve', 'Approve')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {channels.length === 0 && (
        <p className="text-sm" style={{ color: colors.text.muted }}>
          {t('access.noChannels', 'No channels configured yet — connect a channel first.')}
        </p>
      )}

      <div className="space-y-4">
        {channels.map((c) => {
          const e = current(c)
          const dmPolicy = e.dmPolicy ?? 'pairing' // upstream schema default
          const groupPolicy = e.groupPolicy ?? 'allowlist' // upstream schema default
          return (
            <div key={c.channelId} className="rounded-lg border p-4" style={{ borderColor: colors.bg.tertiary, backgroundColor: colors.bg.secondary }}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold capitalize" style={{ color: colors.text.header }}>
                  {c.channelId}
                  {!c.enabled && (
                    <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] uppercase" style={{ backgroundColor: colors.bg.tertiary, color: colors.text.muted }}>
                      {t('access.disabledBadge', 'disabled')}
                    </span>
                  )}
                </h3>
                {isDirty(c) && (
                  <button
                    onClick={() => apply(c)}
                    disabled={savingChannel === c.channelId}
                    className="rounded px-3 py-1 text-xs font-medium hover:opacity-80 disabled:opacity-50"
                    style={{ backgroundColor: colors.button.primary, color: colors.button.primaryFg }}
                  >
                    {savingChannel === c.channelId
                      ? t('access.applying', 'Applying…')
                      : t('access.apply', 'Apply')}
                  </button>
                )}
              </div>

              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: colors.text.muted }}>
                    {t('access.dmPolicy', 'Direct messages')}
                  </label>
                  <select
                    value={dmPolicy}
                    onChange={(ev) => update(c.channelId, c, { dmPolicy: ev.target.value as DmPolicy })}
                    className="w-full max-w-md rounded px-2 py-1.5 text-sm outline-none"
                    style={{ backgroundColor: colors.bg.tertiary, color: colors.text.normal }}
                  >
                    {DM_POLICIES.map((p) => (
                      <option key={p} value={p}>
                        {dmPolicyLabel(p)}
                      </option>
                    ))}
                  </select>
                </div>

                {(dmPolicy === 'allowlist' || dmPolicy === 'open' || dmPolicy === 'pairing') && (
                  <div>
                    <label className="mb-1 block text-xs font-medium" style={{ color: colors.text.muted }}>
                      {t('access.allowFrom', 'Allowed senders')}{' '}
                      <span className="font-normal">
                        {t('access.allowFromHint', '("*" means everyone; phone numbers / user ids)')}
                      </span>
                    </label>
                    <ListEditor
                      colors={colors}
                      values={e.allowFrom}
                      onChange={(next) => update(c.channelId, c, { allowFrom: next })}
                      placeholder={t('access.addSender', 'Add sender…')}
                    />
                  </div>
                )}

                <div>
                  <label className="mb-1 flex items-center gap-1 text-xs font-medium" style={{ color: colors.text.muted }}>
                    <Users className="h-3.5 w-3.5" />
                    {t('access.groupPolicy', 'Group chats')}
                  </label>
                  <select
                    value={groupPolicy}
                    onChange={(ev) => update(c.channelId, c, { groupPolicy: ev.target.value as GroupPolicy })}
                    className="w-full max-w-md rounded px-2 py-1.5 text-sm outline-none"
                    style={{ backgroundColor: colors.bg.tertiary, color: colors.text.normal }}
                  >
                    {GROUP_POLICIES.map((p) => (
                      <option key={p} value={p}>
                        {groupPolicyLabel(p)}
                      </option>
                    ))}
                  </select>
                </div>

                {groupPolicy === 'allowlist' && (
                  <div>
                    <label className="mb-1 block text-xs font-medium" style={{ color: colors.text.muted }}>
                      {t('access.groupAllowFrom', 'Allowed groups / senders in groups')}
                    </label>
                    <ListEditor
                      colors={colors}
                      values={e.groupAllowFrom}
                      onChange={(next) => update(c.channelId, c, { groupAllowFrom: next })}
                      placeholder={t('access.addGroup', 'Add group or sender…')}
                    />
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
