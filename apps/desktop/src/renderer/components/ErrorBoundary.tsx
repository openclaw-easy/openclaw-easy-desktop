import React from 'react'

interface Props {
  children: React.ReactNode
  /** Optional label so nested boundaries can identify which region failed. */
  region?: string
}

interface State {
  error: Error | null
}

/**
 * Top-level crash guard. Without this, any uncaught render throw in any
 * descendant unmounts the entire React tree to a blank window with no
 * recovery (white-screen). Catches the throw, shows a minimal recover UI,
 * and lets the user reload instead of force-quitting the app.
 *
 * Kept dependency-free (no theme/i18n hooks) so the fallback can render even
 * when those providers are the thing that threw.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface to the main-process log so field crashes are diagnosable.
    console.error(`[ErrorBoundary${this.props.region ? `:${this.props.region}` : ''}]`, error, info?.componentStack)
  }

  private handleReload = () => {
    window.location.reload()
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div
        role="alert"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          height: '100vh',
          padding: 24,
          textAlign: 'center',
          background: '#0b0b0f',
          color: '#e6e6ea',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700 }}>Something went wrong</div>
        <div style={{ fontSize: 13, opacity: 0.7, maxWidth: 520, wordBreak: 'break-word' }}>
          {error.message || 'The interface hit an unexpected error.'}
        </div>
        <button
          onClick={this.handleReload}
          style={{
            marginTop: 8,
            padding: '8px 18px',
            borderRadius: 8,
            border: 'none',
            cursor: 'pointer',
            background: '#5b5bd6',
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Reload
        </button>
      </div>
    )
  }
}
