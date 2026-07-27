import type { ComponentType } from 'react'
import {
  Activity,
  Bot,
  Brain,
  Clock,
  Database,
  FolderOpen,
  Globe,
  Hash,
  MessageSquare,
  Package,
  Plus,
  Puzzle,
  Rocket,
  Settings,
  Shield,
  Sparkles,
  Stethoscope,
  Terminal,
  Wrench,
  Zap,
} from 'lucide-react'
import {
  TelegramIcon,
  WhatsAppIcon,
  DiscordIcon,
  SlackIcon,
  FeishuIcon,
  LineIcon,
} from '../../ui/channel-icons'

/**
 * Sidebar item icon — accepts both Lucide line icons (which take a
 * `className` for sizing) and the brand-tile icons from
 * `channel-icons.tsx` (which take an explicit `size`). Both satisfy
 * the minimal `{ className?: string }` contract — Tailwind's `h-4 w-4`
 * overrides the SVG's intrinsic width/height attributes for brand
 * tiles, so they render at the same size as line icons in the rail.
 */
export type SidebarItemIcon = ComponentType<{ className?: string; size?: number }>

export interface SidebarItemDef {
  id: string
  /** i18n key — resolved via t() at render. Brand-name items (WhatsApp,
   *  Telegram, …) leave this undefined and use the static `label` instead
   *  since trademarks aren't translated. */
  labelKey?: string
  /** Fallback / brand-name static label. */
  label: string
  icon: SidebarItemIcon
  /** Sections still need a "server" context for the old props; this maps them. */
  legacyServer?: 'home' | 'main' | 'channels' | 'aiconfig'
}

export interface SidebarGroupDef {
  id: string
  /** i18n key for the group header. */
  labelKey?: string
  /** Fallback static group label. */
  label: string
  items: SidebarItemDef[]
}

/**
 * Flat-list-with-groups navigation. Order maps to the on-screen order
 * in the collapsible sidebar. Adding a section: pick a group, append an
 * item, update `OpenclawEasyDashboard`-rendered sections if necessary.
 */
export const sidebarGroups: SidebarGroupDef[] = [
  {
    id: 'workspace',
    labelKey: 'sidebar.groupWorkspace',
    label: 'Workspace',
    items: [
      { id: 'chat',     labelKey: 'nav.chat',     label: 'Chat',     icon: MessageSquare, legacyServer: 'main' },
      // Onboard sits directly under Chat — it's the launchpad for the
      // CLI onboarding wizard (first-run + reinstall flows).
      { id: 'onboard',  labelKey: 'nav.onboard',  label: 'Onboard',  icon: Rocket,        legacyServer: 'main' },
      { id: 'sessions', labelKey: 'nav.sessions', label: 'Sessions', icon: Hash,          legacyServer: 'main' },
    ],
  },
  {
    id: 'channels',
    labelKey: 'nav.channels',
    label: 'Channels',
    items: [
      { id: 'setup',    labelKey: 'nav.manageChannel', label: 'Add channel', icon: Plus,         legacyServer: 'channels' },
      // Brand-name channels: trademarks are not translated.
      { id: 'whatsapp', label: 'WhatsApp', icon: WhatsAppIcon, legacyServer: 'channels' },
      { id: 'telegram', label: 'Telegram', icon: TelegramIcon, legacyServer: 'channels' },
      { id: 'discord',  label: 'Discord',  icon: DiscordIcon,  legacyServer: 'channels' },
      { id: 'slack',    label: 'Slack',    icon: SlackIcon,    legacyServer: 'channels' },
      { id: 'feishu',   label: 'Feishu',   icon: FeishuIcon,   legacyServer: 'channels' },
      { id: 'line',     label: 'Line',     icon: LineIcon,     legacyServer: 'channels' },
      // Access control: who may DM the assistant / how it behaves in groups.
      { id: 'access',   labelKey: 'nav.access', label: 'Access', icon: Shield, legacyServer: 'channels' },
    ],
  },
  {
    id: 'ai',
    labelKey: 'sidebar.groupAi',
    label: 'AI',
    items: [
      { id: 'aiconfig', labelKey: 'nav.aiProvider',  label: 'Provider', icon: Brain,    legacyServer: 'aiconfig' },
      { id: 'agents',   labelKey: 'nav.agents',      label: 'Agents',   icon: Bot,      legacyServer: 'aiconfig' },
      { id: 'models',   labelKey: 'nav.localModels', label: 'Models',   icon: Sparkles, legacyServer: 'aiconfig' },
      { id: 'skills',   labelKey: 'nav.skills',      label: 'Skills',   icon: Wrench,   legacyServer: 'aiconfig' },
      { id: 'hooks',    labelKey: 'nav.hooks',       label: 'Hooks',    icon: Zap,      legacyServer: 'aiconfig' },
      { id: 'plugins',   labelKey: 'nav.plugins',   label: 'Plugins', icon: Puzzle,     legacyServer: 'aiconfig' },
      { id: 'browser',   labelKey: 'nav.browser',   label: 'Browser', icon: Globe,      legacyServer: 'aiconfig' },
      { id: 'memory',    labelKey: 'nav.memory',    label: 'Memory',  icon: Database,   legacyServer: 'aiconfig' },
      // Files moved from Workspace → AI: the files exposed here are
      // mostly AI-config artefacts (skill/hook scripts, mcp manifests,
      // CLAUDE.md), so this groups them with the rest of the AI surface.
      { id: 'workspace', labelKey: 'nav.workspace', label: 'Files',   icon: FolderOpen, legacyServer: 'main' },
    ],
  },
  {
    id: 'system',
    labelKey: 'nav.categorySystem',
    label: 'System',
    items: [
      { id: 'activity', labelKey: 'nav.activityLog', label: 'Activity',    icon: Activity,    legacyServer: 'main' },
      { id: 'doctor',   labelKey: 'nav.doctor',      label: 'Doctor',      icon: Stethoscope, legacyServer: 'main' },
      // Commands placed below Doctor (operator-tooling group).
      { id: 'commands', labelKey: 'nav.commands',    label: 'Commands',    icon: Terminal,    legacyServer: 'main' },
      { id: 'cron',     labelKey: 'nav.cronJobs',    label: 'Cron',        icon: Clock,       legacyServer: 'main' },
      // Tools & Permissions page — labeled "Permissions" in the sidebar
      // since that's the user-facing model (the page itself can keep
      // its longer "Tools & Permissions" title).
      { id: 'tools',    labelKey: 'nav.permissions', label: 'Permissions', icon: Package,     legacyServer: 'main' },
    ],
  },
  // Settings intentionally lives in the sidebar footer instead of a
  // group — it's a global action, not a section, and users expect it
  // pinned/always-visible (Linear/Notion convention). See Sidebar.tsx.
]

/**
 * Items rendered at the top of the sidebar, outside any group. Used
 * for high-frequency destinations (Quick Actions = the default landing
 * page) so they're always one click away regardless of group state.
 */
export const pinnedTopItems: SidebarItemDef[] = [
  { id: 'quick-actions', labelKey: 'nav.quickActions', label: 'Quick Actions', icon: Zap, legacyServer: 'home' },
]

export function findItem(id: string): SidebarItemDef | undefined {
  for (const i of pinnedTopItems) {
    if (i.id === id) return i
  }
  for (const g of sidebarGroups) {
    const hit = g.items.find((i) => i.id === id)
    if (hit) return hit
  }
  return undefined
}
