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
  accent: {
    brand: string
    green: string
    yellow: string
    red: string
    purple: string
    indigo?: string
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