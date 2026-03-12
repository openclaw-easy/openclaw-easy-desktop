import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, Mic, Camera, Monitor, Accessibility } from 'lucide-react';
import { ColorTheme } from '../types';

type WinPermStatus = 'granted' | 'denied' | 'prompt';

interface WinPermission {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  status: WinPermStatus;
}

interface WindowsPermissionsSectionProps {
  colors: ColorTheme;
}

export const WindowsPermissionsSection: React.FC<WindowsPermissionsSectionProps> = ({ colors }) => {
  const { t } = useTranslation();
  const [permissions, setPermissions] = useState<WinPermission[]>([]);
  const [openingSettings, setOpeningSettings] = useState<string | null>(null);

  useEffect(() => {
    loadPermissions();
  }, []);

  const loadPermissions = async () => {
    const query = async (name: string): Promise<WinPermStatus> => {
      try {
        const result = await navigator.permissions.query({ name: name as PermissionName });
        return result.state as WinPermStatus;
      } catch {
        return 'prompt';
      }
    };

    const [micStatus, camStatus] = await Promise.all([
      query('microphone'),
      query('camera'),
    ]);

    setPermissions([
      {
        id: 'microphone',
        label: t('tools.microphone'),
        description: t('windowsPermissions.microphoneDesc'),
        icon: <Mic className="h-4 w-4" />,
        status: micStatus,
      },
      {
        id: 'camera',
        label: t('tools.camera'),
        description: t('windowsPermissions.cameraDesc'),
        icon: <Camera className="h-4 w-4" />,
        status: camStatus,
      },
    ]);
  };

  const handleOpenSettings = async (permId: string) => {
    setOpeningSettings(permId);
    try {
      await window.electronAPI?.openPermissionSettings?.(permId);
    } finally {
      setOpeningSettings(null);
      // Re-check status after user returns from Settings
      setTimeout(loadPermissions, 1500);
    }
  };

  return (
    <div className="rounded-lg p-6" style={{ backgroundColor: colors.bg.secondary }}>
      <div className="flex items-center space-x-3 mb-4">
        <Shield className="h-5 w-5" style={{ color: colors.accent.purple }} />
        <h4 className="text-lg font-semibold" style={{ color: colors.text.header }}>
          {t('windowsPermissions.title')}
        </h4>
      </div>
      <p className="text-sm mb-4" style={{ color: colors.text.muted }}>
        {t('windowsPermissions.subtitle')}
      </p>

      <div className="space-y-2">
        {/* Microphone & Camera — status readable via navigator.permissions */}
        {permissions.map((perm) => {
          const isOpening = openingSettings === perm.id;
          const statusColor =
            perm.status === 'granted' ? colors.accent.green :
            perm.status === 'denied'  ? colors.text.danger :
            colors.text.muted;
          const statusLabel =
            perm.status === 'granted' ? t('tools.granted') :
            perm.status === 'denied'  ? t('tools.denied') :
            t('tools.notDetermined');

          return (
            <div
              key={perm.id}
              className="flex items-center justify-between p-3 rounded"
              style={{ backgroundColor: colors.bg.tertiary }}
            >
              <div className="flex items-center space-x-3">
                <span style={{ color: statusColor }}>{perm.icon}</span>
                <div>
                  <div className="text-sm font-medium" style={{ color: colors.text.header }}>
                    {perm.label}
                  </div>
                  <div className="text-xs" style={{ color: colors.text.muted }}>
                    {perm.description}
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-3 shrink-0">
                <span
                  className="text-xs font-medium px-2 py-0.5 rounded-full"
                  style={{ color: statusColor, backgroundColor: statusColor + '20' }}
                >
                  {statusLabel}
                </span>
                {perm.status !== 'granted' && (
                  <button
                    onClick={() => handleOpenSettings(perm.id)}
                    disabled={isOpening}
                    className="text-xs px-3 py-1 rounded font-medium transition-colors disabled:opacity-50"
                    style={{ backgroundColor: colors.bg.primary, color: colors.text.link }}
                  >
                    {isOpening ? t('tools.opening') : t('tools.openSettings')}
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* Screen Capture — no Windows system permission required */}
        <div
          className="flex items-center justify-between p-3 rounded"
          style={{ backgroundColor: colors.bg.tertiary }}
        >
          <div className="flex items-center space-x-3">
            <span style={{ color: colors.text.muted }}><Monitor className="h-4 w-4" /></span>
            <div>
              <div className="text-sm font-medium" style={{ color: colors.text.header }}>
                {t('tools.screenCapture')}
              </div>
              <div className="text-xs" style={{ color: colors.text.muted }}>
                {t('windowsPermissions.screenCaptureDesc')}
              </div>
            </div>
          </div>
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={{ color: colors.accent.green, backgroundColor: colors.accent.green + '20' }}
          >
            {t('windowsPermissions.available')}
          </span>
        </div>

        {/* Accessibility — no Windows system permission required */}
        <div
          className="flex items-center justify-between p-3 rounded"
          style={{ backgroundColor: colors.bg.tertiary }}
        >
          <div className="flex items-center space-x-3">
            <span style={{ color: colors.text.muted }}><Accessibility className="h-4 w-4" /></span>
            <div>
              <div className="text-sm font-medium" style={{ color: colors.text.header }}>
                {t('tools.accessibility')}
              </div>
              <div className="text-xs" style={{ color: colors.text.muted }}>
                {t('windowsPermissions.accessibilityDesc')}
              </div>
            </div>
          </div>
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={{ color: colors.accent.green, backgroundColor: colors.accent.green + '20' }}
          >
            {t('windowsPermissions.available')}
          </span>
        </div>
      </div>
    </div>
  );
};
