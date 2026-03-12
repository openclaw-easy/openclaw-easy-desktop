import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { OpenclawEasyDashboard } from './components/dashboard/OpenclawEasyDashboard';
import { useConfigStore } from './stores/configStore';
import { ToastProvider } from './contexts/ToastContext';

export function App() {
  const { loadConfig } = useConfigStore();
  const { i18n } = useTranslation();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Load saved language preference
        const settings = await window.electronAPI?.getSettings?.();
        if (settings?.language) {
          await i18n.changeLanguage(settings.language);
        }

        await loadConfig();
      } catch (error) {
        console.error('Failed to initialize app:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initializeApp();
  }, [loadConfig]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600 mx-auto"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading Openclaw Easy...</p>
        </div>
      </div>
    );
  }

  return (
    <ToastProvider>
      <div className="min-h-screen">
        <OpenclawEasyDashboard />
      </div>
    </ToastProvider>
  );
}