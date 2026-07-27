import type { ConfigManager } from './config-manager'
import type { OpenClawCommandExecutor } from './openclaw-command-executor'

/** Narrow seams so tests can inject fakes without Electron. */
type ConfigStore = Pick<ConfigManager, 'loadConfig' | 'mutateConfig'>
type CommandRunner = Pick<OpenClawCommandExecutor, 'executeCommand'>

/**
 * Channel access-control surface (upstream contract: src/config/
 * zod-schema.channel-messaging-common.ts + zod-schema.core.ts):
 *   channels.<id>.dmPolicy:   "pairing" | "allowlist" | "open" | "disabled"   (schema default: pairing)
 *   channels.<id>.allowFrom:  (string|number)[]
 *   channels.<id>.groupPolicy: "open" | "disabled" | "allowlist"              (schema default: allowlist)
 *   channels.<id>.groupAllowFrom: (string|number)[]
 * Pending DM pairing requests are owned by the gateway; the CLI
 * (`openclaw pairing list/approve`) is the supported client.
 */

export const DM_POLICIES = ['open', 'pairing', 'allowlist', 'disabled'] as const
export const GROUP_POLICIES = ['open', 'allowlist', 'disabled'] as const
export type DmPolicy = (typeof DM_POLICIES)[number]
export type GroupPolicy = (typeof GROUP_POLICIES)[number]

export interface ChannelAccess {
  channelId: string
  enabled: boolean
  /** Actual configured value; undefined = schema default applies. */
  dmPolicy?: DmPolicy
  allowFrom: string[]
  groupPolicy?: GroupPolicy
  groupAllowFrom: string[]
}

export interface ChannelAccessPatch {
  dmPolicy?: DmPolicy
  allowFrom?: string[]
  groupPolicy?: GroupPolicy
  groupAllowFrom?: string[]
}

export interface PairingRequest {
  channel: string
  code: string
  from?: string
  createdAt?: string
}

/** Config keys under `channels` that are not messaging channels. */
const NON_CHANNEL_KEYS = new Set(['defaults'])

function normalizeIdList(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  return list.map((v) => String(v).trim()).filter(Boolean)
}

/** Validate + normalize a patch to exactly the schema surface. */
export function normalizeAccessPatch(patch: ChannelAccessPatch): ChannelAccessPatch | null {
  const out: ChannelAccessPatch = {}
  if (patch.dmPolicy !== undefined) {
    if (!DM_POLICIES.includes(patch.dmPolicy)) return null
    out.dmPolicy = patch.dmPolicy
  }
  if (patch.groupPolicy !== undefined) {
    if (!GROUP_POLICIES.includes(patch.groupPolicy)) return null
    out.groupPolicy = patch.groupPolicy
  }
  if (patch.allowFrom !== undefined) out.allowFrom = normalizeIdList(patch.allowFrom)
  if (patch.groupAllowFrom !== undefined) out.groupAllowFrom = normalizeIdList(patch.groupAllowFrom)
  return Object.keys(out).length > 0 ? out : null
}

export class AccessControlManager {
  constructor(
    private configManager: ConfigStore,
    private executor: CommandRunner,
  ) {}

  async getChannelAccess(): Promise<{ success: boolean; channels?: ChannelAccess[]; error?: string }> {
    try {
      const config = await this.configManager.loadConfig()
      const entries = config?.channels && typeof config.channels === 'object' ? config.channels : {}
      const channels: ChannelAccess[] = Object.entries(entries)
        .filter(([id, value]) => !NON_CHANNEL_KEYS.has(id) && value && typeof value === 'object')
        .map(([channelId, value]: [string, any]) => ({
          channelId,
          enabled: value.enabled !== false,
          dmPolicy: DM_POLICIES.includes(value.dmPolicy) ? value.dmPolicy : undefined,
          allowFrom: normalizeIdList(value.allowFrom),
          groupPolicy: GROUP_POLICIES.includes(value.groupPolicy) ? value.groupPolicy : undefined,
          groupAllowFrom: normalizeIdList(value.groupAllowFrom),
        }))
      return { success: true, channels }
    } catch (error: any) {
      console.error('[AccessControl] Failed to read channel access:', error)
      return { success: false, error: error.message || 'Failed to read channel access' }
    }
  }

  async setChannelAccess(
    channelId: string,
    patch: ChannelAccessPatch,
  ): Promise<{ success: boolean; error?: string }> {
    const normalized = normalizeAccessPatch(patch)
    if (!normalized) {
      return { success: false, error: 'Invalid access-control values' }
    }
    try {
      const changed = await this.configManager.mutateConfig((config: any) => {
        const entry = config?.channels?.[channelId]
        if (!entry || typeof entry !== 'object') return false
        if (normalized.dmPolicy !== undefined) entry.dmPolicy = normalized.dmPolicy
        if (normalized.groupPolicy !== undefined) entry.groupPolicy = normalized.groupPolicy
        // Empty list = "nobody extra": keep the key so the policy is explicit.
        if (normalized.allowFrom !== undefined) entry.allowFrom = normalized.allowFrom
        if (normalized.groupAllowFrom !== undefined) entry.groupAllowFrom = normalized.groupAllowFrom
        return true
      })
      if (!changed) {
        return { success: false, error: `Channel "${channelId}" is not configured` }
      }
      console.log(`[AccessControl] Updated access for ${channelId}:`, normalized)
      return { success: true }
    } catch (error: any) {
      console.error(`[AccessControl] Failed to update ${channelId}:`, error)
      return { success: false, error: error.message || 'Failed to update access' }
    }
  }

  async listPairingRequests(): Promise<{ success: boolean; requests?: PairingRequest[]; error?: string }> {
    try {
      const result = await this.executor.executeCommand(['pairing', 'list', '--json'], 15000)
      if (!result) return { success: true, requests: [] }
      const data = JSON.parse(result)
      const requests = Array.isArray(data) ? data : data.requests || data.pending || []
      return { success: true, requests: Array.isArray(requests) ? requests : [] }
    } catch (error: any) {
      // The CLI exits non-zero when no channel is in pairing mode — that is
      // an empty state for this panel, not a failure.
      if (String(error?.message || '').includes('No chat DM pairing channels')) {
        return { success: true, requests: [] }
      }
      console.error('[AccessControl] Failed to list pairing requests:', error)
      return { success: false, error: error.message || 'Failed to list pairing requests' }
    }
  }

  async approvePairing(channel: string, code: string): Promise<{ success: boolean; error?: string }> {
    const trimmedChannel = channel.trim()
    const trimmedCode = code.trim()
    if (!trimmedChannel || !trimmedCode) {
      return { success: false, error: 'Channel and pairing code are required' }
    }
    try {
      await this.executor.executeCommand(['pairing', 'approve', trimmedChannel, trimmedCode], 15000)
      return { success: true }
    } catch (error: any) {
      console.error('[AccessControl] Failed to approve pairing:', error)
      return { success: false, error: error.message || 'Failed to approve pairing code' }
    }
  }
}
