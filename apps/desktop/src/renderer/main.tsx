import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './i18n';
// Brand-grade typography. Inter Variable ships one font file (~80kb)
// covering weights 100-900 with smooth interpolation — replaces the
// system-font fallback that used to render San Francisco on macOS,
// Segoe UI on Windows, and something different on Linux. Now every
// user sees identical typography and h1↔body weight gradient is
// stepless instead of font-weight: 600 vs 700.
import '@fontsource-variable/inter';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);