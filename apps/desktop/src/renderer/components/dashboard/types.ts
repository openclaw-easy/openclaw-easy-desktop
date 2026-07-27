import { LucideIcon } from 'lucide-react'

export interface ColorTheme {
  bg: {
    primary: string
    secondary: string
    tertiary: string
    hover: string
    active: string
  }
  text: {
    normal: string
    muted: string
    header: string
    link: string
    danger: string
  }
  // `accent.*` is the semantic *signal* palette — what a color MEANS in
  // context (green=success, red=error, yellow=warn, blue=info). Use these
  // for icons, status dots, badges, transient feedback. NEVER use
  // `accent.green` as a button background — buttons take their color from
  // `button.*` below so the brand stays coral across the entire app.
  accent: {
    brand: string
    green: string
    yellow: string
    red: string
    purple: string
    indigo?: string
    blue?: string
  }
  // `button.*` is the semantic *action* palette — what a click DOES.
  // Every clickable surface in the app pulls its color from here so a
  // change to OpenClaw's brand only has to be made in one spot. The
  // hierarchy mirrors openclaw.ai:
  //   primary     — coral, used for all positive CTAs (Launch, Save,
  //                 Get Started, Configure, Enable, Open Chat, …).
  //   destructive — red, used only when the click destroys / aborts
  //                 work (Stop, Cancel running task, Delete, Disable).
  //   primaryFg / destructiveFg — text + icon color *on top of* the
  //                 above. Always white-ish so contrast is preserved.
  button: {
    primary: string
    primaryFg: string
    destructive: string
    destructiveFg: string
  }
}

export interface Channel {
  id: string
  name: string
  type: string
  icon: LucideIcon
  status?: 'connected' | 'pending' | 'disconnected'
}

export interface Server {
  id: string
  name: string
  icon: string
  channels: Channel[]
}

export type LogEntry = string | {
  timestamp?: string
  level?: string
  message?: string
  fullEntry?: string
}

export interface DashboardProps {
  colors: ColorTheme
  activeChannel: string
  setActiveChannel: (channel: string) => void
  selectedServer: string
  setSelectedServer: (server: string) => void
  servers: Server[]
  channels: Record<string, Channel[]>
  status: any
  logs: LogEntry[]
  [key: string]: any
}