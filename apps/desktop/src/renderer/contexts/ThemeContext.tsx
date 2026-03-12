import React, { createContext, useContext } from 'react'
import type { ColorTheme } from '../components/dashboard/types'

const ThemeContext = createContext<ColorTheme | null>(null)

export function useTheme(): ColorTheme {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>')
  return ctx
}

export function ThemeProvider({ colors, children }: { colors: ColorTheme; children: React.ReactNode }) {
  return <ThemeContext.Provider value={colors}>{children}</ThemeContext.Provider>
}
