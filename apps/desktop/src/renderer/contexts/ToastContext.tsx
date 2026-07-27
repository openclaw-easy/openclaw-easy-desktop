import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react'

type ToastType = 'success' | 'error' | 'info'

interface ToastAction {
  label: string
  onClick: () => void
}

interface Toast {
  id: number
  message: string
  type: ToastType
  entering: boolean
  exiting: boolean
  action?: ToastAction
}

interface ToastContextValue {
  addToast(message: string, type: ToastType, duration?: number, action?: ToastAction): void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>')
  return ctx
}

// Accent color per type — only tints the icon + the left rail + the
// action-button border. Message text uses the theme's foreground token
// so it's always readable in both light and dark modes (previously,
// `text: '#4ade80'` etc. were tuned for dark and disappeared on light
// glass).
const TYPE_STYLES: Record<ToastType, { rail: string; iconBg: string; icon: string }> = {
  success: { rail: '#22c55e', iconBg: 'rgba(34, 197, 94, 0.18)',  icon: '#22c55e' },
  error:   { rail: '#ef4444', iconBg: 'rgba(239, 68, 68, 0.18)',  icon: '#ef4444' },
  info:    { rail: '#14b8a6', iconBg: 'rgba(20, 184, 166, 0.18)', icon: '#14b8a6' },
}

const TYPE_ICONS: Record<ToastType, React.FC<{ className?: string; style?: React.CSSProperties }>> = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const idRef = useRef(0)

  const addToast = useCallback((message: string, type: ToastType, duration = 10000, action?: ToastAction) => {
    const id = ++idRef.current
    setToasts(prev => [...prev, { id, message, type, entering: true, exiting: false, action }])

    // Mark enter animation done after mount
    requestAnimationFrame(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, entering: false } : t))
    })

    // Start exit animation before removal
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t))
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id))
      }, 300)
    }, duration)
  }, [])

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t))
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 300)
  }, [])

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}

      {/* Floating toast stack — fixed overlay, no layout impact */}
      {toasts.length > 0 && (
        <div
          style={{
            position: 'fixed',
            top: 16,
            right: 16,
            zIndex: 99999,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            pointerEvents: 'none',
          }}
        >
          {toasts.map(toast => {
            const s = TYPE_STYLES[toast.type]
            const Icon = TYPE_ICONS[toast.type]
            return (
              <div
                key={toast.id}
                className="glass-strong text-foreground border border-border rounded-xl"
                style={{
                  pointerEvents: 'auto',
                  display: 'flex',
                  alignItems: 'stretch',
                  fontSize: 13,
                  lineHeight: '1.45',
                  maxWidth: 600,
                  overflow: 'hidden',
                  boxShadow: '0 12px 32px rgba(0,0,0,0.18), 0 0 18px rgba(var(--glow-color) / 0.10)',
                  transform: toast.entering ? 'translateX(120%) scale(0.96)' : toast.exiting ? 'translateX(120%) scale(0.96)' : 'translateX(0) scale(1)',
                  opacity: toast.exiting ? 0 : 1,
                  transition: 'transform 280ms cubic-bezier(0.16, 1, 0.3, 1), opacity 280ms ease',
                }}
              >
                {/* Type-colored left rail */}
                <div
                  aria-hidden
                  style={{ width: 3, flexShrink: 0, backgroundColor: s.rail }}
                />
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', flex: 1, minWidth: 0 }}>
                  <span
                    className="flex items-center justify-center rounded-md shrink-0"
                    style={{ width: 24, height: 24, backgroundColor: s.iconBg, color: s.icon }}
                    aria-hidden
                  >
                    <Icon style={{ width: 14, height: 14 }} />
                  </span>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                    <span className="text-foreground">{toast.message}</span>
                    {toast.action && (
                      <button
                        onClick={() => { toast.action!.onClick(); dismiss(toast.id); }}
                        className="press-pulse"
                        style={{
                          alignSelf: 'flex-start',
                          background: 'none',
                          border: `1px solid ${s.rail}`,
                          borderRadius: 6,
                          padding: '4px 10px',
                          color: s.icon,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                          transition: 'background-color 150ms ease',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.backgroundColor = s.iconBg }}
                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}
                      >
                        {toast.action.label}
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => dismiss(toast.id)}
                    className="press-pulse text-muted-foreground hover:text-foreground transition-colors"
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 2,
                      flexShrink: 0,
                      marginTop: 1,
                    }}
                  >
                    <X style={{ width: 14, height: 14 }} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </ToastContext.Provider>
  )
}
