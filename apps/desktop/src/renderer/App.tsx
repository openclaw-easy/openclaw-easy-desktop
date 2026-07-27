import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { OpenclawEasyDashboard } from './components/dashboard/OpenclawEasyDashboard';
import { useConfigStore } from './stores/configStore';
import { ToastProvider } from './contexts/ToastContext';
import { WhatsNewModal } from './components/WhatsNewModal';
import { Splash } from './components/ui/splash';
import { NEW_UI_ENABLED } from './lib/featureFlags';
import { useThemeStore } from './stores/themeStore';

export function App() {
  const { loadConfig } = useConfigStore();
  const { i18n } = useTranslation();
  const [isLoading, setIsLoading] = useState(true);
  const loadTheme = useThemeStore((s) => s.loadFromSettings);
  const initSystemWatcher = useThemeStore((s) => s.initSystemWatcher);

  useEffect(() => {
    // Mark the document so CSS can make html/body transparent and let
    // OS vibrancy show through in glass mode. Classic UI keeps an opaque
    // background to avoid render artifacts on the legacy chrome.
    document.documentElement.dataset.ui = NEW_UI_ENABLED ? 'glass' : 'classic';

    const initializeApp = async () => {
      try {
        // Load saved language preference
        const settings = await window.electronAPI?.getSettings?.();
        if (settings?.language) {
          await i18n.changeLanguage(settings.language);
        }

        // Apply persisted theme (default: follow system).
        await loadTheme();

        await loadConfig();
      } catch (error) {
        console.error('Failed to initialize app:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initializeApp();

    // Watch OS-level color-scheme changes so `mode: 'system'` stays live.
    const unsubscribe = initSystemWatcher();
    return () => unsubscribe();
  }, [loadConfig, loadTheme, initSystemWatcher, i18n]);

  if (isLoading) {
    return <Splash />;
  }

  return (
    <ToastProvider>
      <div className="min-h-screen">
        <OpenclawEasyDashboard uiMode={NEW_UI_ENABLED ? 'glass' : 'classic'} />
        <WhatsNewModal />
      </div>
    </ToastProvider>
  );
}
