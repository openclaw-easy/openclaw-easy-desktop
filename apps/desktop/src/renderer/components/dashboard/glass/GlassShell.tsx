import React from 'react'
import { Sidebar } from './Sidebar'

interface GlassShellProps {
  activeChannel: string
  onSelect: (id: string, legacyServer?: 'home' | 'main' | 'channels' | 'aiconfig') => void
  children: React.ReactNode
}

/**
 * Outer chrome for the new UI: full-bleed background, single collapsible
 * sidebar, content rendered inside a glass card. Vibrancy is configured
 * in src/main/index.ts (`vibrancy: 'under-window'` on macOS,
 * `backgroundMaterial: 'mica'` on Windows). For the system blur to be
 * visible, html/body must be transparent — enforced via the
 * `html[data-ui="glass"]` rule in globals.css.
 */
export function GlassShell({ activeChannel, onSelect, children }: GlassShellProps) {
  const [collapsed, setCollapsed] = React.useState(false)

  return (
    <div className="h-screen w-screen flex overflow-hidden text-foreground">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((v) => !v)}
        activeChannel={activeChannel}
        onSelect={onSelect}
      />

      <main className="flex-1 min-w-0 flex flex-col p-3 gap-3 overflow-hidden">
        <div className="flex-1 min-h-0 glass-card overflow-hidden flex flex-col">
          {children}
        </div>
      </main>
    </div>
  )
}
