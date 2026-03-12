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

const TYPE_STYLES: Record<ToastType, { bg: string; border: string; text: string }> = {
  success: { bg: '#1a2e1a', border: '#3ba55d', text: '#4ade80' },
  error:   { bg: '#2e1a1a', border: '#ed4245', text: '#f87171' },
  info:    { bg: '#1a1e2e', border: '#60a5fa', text: '#93bbfc' },
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
                style={{
                  pointerEvents: 'auto',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  borderRadius: 10,
                  padding: '12px 16px',
                  backgroundColor: s.bg,
                  border: `1px solid ${s.border}`,
                  color: s.text,
                  fontSize: 13,
                  lineHeight: '1.45',
                  maxWidth: 600,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                  transform: toast.entering ? 'translateX(120%)' : toast.exiting ? 'translateX(120%)' : 'translateX(0)',
                  opacity: toast.exiting ? 0 : 1,
                  transition: 'transform 0.3s ease, opacity 0.3s ease',
                }}
              >
                <Icon style={{ width: 16, height: 16, flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span>{toast.message}</span>
                  {toast.action && (
                    <button
                      onClick={() => { toast.action!.onClick(); dismiss(toast.id); }}
                      style={{
                        alignSelf: 'flex-start',
                        background: 'none',
                        border: `1px solid ${s.border}`,
                        borderRadius: 5,
                        padding: '3px 10px',
                        color: s.text,
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: 'pointer',
                        opacity: 0.85,
                        transition: 'opacity 0.15s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                      onMouseLeave={e => (e.currentTarget.style.opacity = '0.85')}
                    >
                      {toast.action.label}
                    </button>
                  )}
                </div>
                <button
                  onClick={() => dismiss(toast.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'inherit',
                    opacity: 0.5,
                    cursor: 'pointer',
                    padding: 0,
                    flexShrink: 0,
                    marginTop: 1,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}
                >
                  <X style={{ width: 14, height: 14 }} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </ToastContext.Provider>
  )
}
