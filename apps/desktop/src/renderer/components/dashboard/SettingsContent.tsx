import React, { useState, useEffect, useRef } from 'react';
import { Settings, Loader2, Package, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '../../i18n';

interface ColorScheme {
  bg: {
    primary: string;
    secondary: string;
    tertiary: string;
    hover: string;
    active: string;
  };
  text: {
    normal: string;
    muted: string;
    header: string;
    link: string;
    danger: string;
  };
  accent: {
    brand: string;
    green: string;
    yellow: string;
    red: string;
    purple: string;
    indigo: string;
  };
}

interface SettingsContentProps {
  colors: ColorScheme;
  setSelectedServer: (server: string) => void;
  setActiveChannel: (channel: string) => void;
}

export function SettingsContent({
  colors,
  setSelectedServer,
  setActiveChannel,
}: SettingsContentProps) {
  const { t, i18n } = useTranslation();
  const [settings, setSettings] = useState({
    startOnBoot: false,
    minimizeToTray: true,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [currentVersion, setCurrentVersion] = useState<string>('');
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [checkResult, setCheckResult] = useState<{ hasUpdate: boolean; latestVersion?: string; downloads?: Record<string, string> } | null>(null);
  const [languageDropdownOpen, setLanguageDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setLanguageDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const loadedSettings = await window.electronAPI?.getSettings?.();
        if (loadedSettings) {
          setSettings(loadedSettings);
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadSettings();
  }, []);

  // Load current app version on mount
  useEffect(() => {
    window.electronAPI?.getAppVersion?.().then((v) => {
      if (v) setCurrentVersion(v)
    }).catch(() => {})
  }, []);

  const handleCheckForUpdates = async () => {
    setCheckingUpdate(true)
    setCheckResult(null)
    try {
      const result = await window.electronAPI?.checkForUpdates?.()
      if (result) {
        setCheckResult({ hasUpdate: result.hasUpdate, latestVersion: result.latestVersion, downloads: result.downloads as any })
      }
    } catch {
      setCheckResult({ hasUpdate: false })
    } finally {
      setCheckingUpdate(false)
    }
  }

  // Handler for setting changes
  const handleSettingChange = async (key: string, value: boolean) => {
    // Optimistic update
    setSettings(prev => ({ ...prev, [key]: value }));

    try {
      // Call appropriate IPC method
      switch (key) {
        case 'startOnBoot':
          await window.electronAPI?.setStartOnBoot?.(value);
          break;
        case 'minimizeToTray':
          await window.electronAPI?.setMinimizeToTray?.(value);
          break;
      }
      console.log(`[Settings] ${key} set to ${value}`);
    } catch (error) {
      console.error(`Failed to update ${key}:`, error);
      // Revert on error
      setSettings(prev => ({ ...prev, [key]: !value }));
    }
  };

  const handleLanguageChange = async (langCode: string) => {
    await i18n.changeLanguage(langCode);
    setLanguageDropdownOpen(false);
    try {
      await window.electronAPI?.setLanguage?.(langCode);
      console.log(`[Settings] Language set to ${langCode}`);
    } catch (error) {
      console.error('Failed to persist language:', error);
    }
  };

  const currentLang = SUPPORTED_LANGUAGES.find(l => l.code === i18n.language) || SUPPORTED_LANGUAGES[0];

  return (
    <div className="flex flex-col h-full">
      <div className="p-8 pb-4">
        <h3
          className="text-2xl font-bold mb-2"
          style={{ color: colors.text.header }}
        >
          {t('settings.title')}
        </h3>
        <p className="text-sm" style={{ color: colors.text.muted }}>
          {t('settings.subtitle')}
        </p>
      </div>

      {/* Scrollable Settings Content */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <div className="space-y-6">
          {/* Application Settings */}
          <div
            className="rounded-lg p-6"
            style={{ backgroundColor: colors.bg.secondary }}
          >
            <div className="flex items-center space-x-3 mb-4">
              <Settings
                className="h-5 w-5"
                style={{ color: colors.accent.green }}
              />
              <h4
                className="text-lg font-semibold"
                style={{ color: colors.text.header }}
              >
                {t('settings.application')}
              </h4>
            </div>

            <div className="space-y-4">
              {[
                {
                  key: 'startOnBoot',
                  name: t('settings.startOnBoot'),
                  desc: t('settings.startOnBootDesc'),
                },
                {
                  key: 'minimizeToTray',
                  name: t('settings.minimizeToTray'),
                  desc: t('settings.minimizeToTrayDesc'),
                },
              ].map((setting) => (
                <label
                  key={setting.key}
                  className="flex items-start space-x-3 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={settings[setting.key as keyof typeof settings]}
                    onChange={(e) => handleSettingChange(setting.key, e.target.checked)}
                    disabled={isLoading}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div
                      className="font-medium"
                      style={{ color: colors.text.header }}
                    >
                      {setting.name}
                    </div>
                    <p
                      className="text-sm"
                      style={{ color: colors.text.muted }}
                    >
                      {setting.desc}
                    </p>
                  </div>
                </label>
              ))}

              {/* Language Selector */}
              <div className="flex items-center space-x-3">
                <Globe className="h-5 w-5" style={{ color: colors.text.muted }} />
                <div className="flex-1">
                  <div
                    className="font-medium"
                    style={{ color: colors.text.header }}
                  >
                    {t('settings.language')}
                  </div>
                  <p
                    className="text-sm"
                    style={{ color: colors.text.muted }}
                  >
                    {t('settings.languageDesc')}
                  </p>
                </div>
                <div className="relative flex-shrink-0" ref={dropdownRef}>
                    <button
                      onClick={() => setLanguageDropdownOpen(!languageDropdownOpen)}
                      className="flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors w-48"
                      style={{
                        backgroundColor: colors.bg.tertiary,
                        color: colors.text.normal,
                        border: `1px solid ${colors.bg.hover}`,
                      }}
                    >
                      <span className="text-base">{currentLang.flag}</span>
                      <span className="flex-1 text-left">{currentLang.label}</span>
                      <svg className={`h-4 w-4 transition-transform ${languageDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {languageDropdownOpen && (
                      <div
                        className="absolute right-0 z-50 bottom-full mb-1 w-48 rounded-md shadow-lg py-1"
                        style={{
                          backgroundColor: colors.bg.tertiary,
                          border: `1px solid ${colors.bg.hover}`,
                        }}
                      >
                        {SUPPORTED_LANGUAGES.map((lang) => (
                          <button
                            key={lang.code}
                            onClick={() => handleLanguageChange(lang.code)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:brightness-125"
                            style={{
                              color: lang.code === i18n.language ? colors.text.header : colors.text.normal,
                              backgroundColor: lang.code === i18n.language ? colors.bg.active : 'transparent',
                            }}
                          >
                            <span className="text-base">{lang.flag}</span>
                            <span>{lang.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                </div>
              </div>
            </div>
          </div>

          {/* App Version */}
          <div
            className="rounded-lg p-6"
            style={{ backgroundColor: colors.bg.secondary }}
          >
            <div className="flex items-center space-x-3 mb-4">
              <Package
                className="h-5 w-5"
                style={{ color: colors.accent.brand }}
              />
              <h4
                className="text-lg font-semibold"
                style={{ color: colors.text.header }}
              >
                {t('settings.appVersion')}
              </h4>
            </div>

            <div
              className="flex items-center justify-between p-4 rounded"
              style={{ backgroundColor: colors.bg.tertiary }}
            >
              <div>
                <p className="text-sm" style={{ color: colors.text.normal }}>
                  {t('settings.currentVersion')}{' '}
                  <strong style={{ color: colors.text.header }}>
                    {currentVersion ? `v${currentVersion}` : t('settings.loading')}
                  </strong>
                </p>
                {checkResult && (
                  <p className="text-sm mt-1" style={{ color: checkResult.hasUpdate ? colors.accent.yellow : colors.accent.green }}>
                    {checkResult.hasUpdate
                      ? t('settings.updateAvailable', { version: checkResult.latestVersion })
                      : t('settings.upToDate')}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {checkResult?.hasUpdate && checkResult.downloads && (
                  <button
                    onClick={async () => {
                      const downloads = checkResult.downloads!
                      let url = downloads['win-x64']
                      try {
                        const sysInfo = await window.electronAPI?.getSystemInfo?.()
                        if (sysInfo?.platform === 'darwin') {
                          url = sysInfo.arch === 'arm64' ? downloads['mac-arm64'] : downloads['mac-x64']
                        }
                      } catch {
                        if (navigator.platform.toLowerCase().includes('mac')) {
                          url = downloads['mac-x64']
                        }
                      }
                      window.electronAPI?.openExternal?.(url)
                    }}
                    className="px-4 py-2 rounded text-sm font-medium transition-colors"
                    style={{
                      backgroundColor: colors.accent.brand,
                      color: 'white',
                    }}
                  >
                    {t('settings.download')}
                  </button>
                )}
                <button
                  onClick={handleCheckForUpdates}
                  disabled={checkingUpdate}
                  className="flex items-center gap-1.5 px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50"
                  style={{
                    backgroundColor: colors.bg.secondary,
                    color: colors.text.normal,
                    border: `1px solid ${colors.bg.primary}`,
                  }}
                >
                  {checkingUpdate ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> {t('settings.checking')}</>
                  ) : (
                    t('settings.checkForUpdates')
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
