import React from 'react';
import { CheckCircle, Clock, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import type { ColorTheme } from './types';

/**
 * The QR-login surface, shared by every channel that authenticates by scanning
 * a terminal-rendered QR (WhatsApp, Weixin).
 *
 * This used to be inlined in ChannelSetupModals under `activeSetup ===
 * 'WhatsApp'`, which is why Weixin opened an empty modal: the main process
 * generated a valid QR and the hook stored it, but no branch matched
 * `activeSetup === 'Weixin'` so nothing ever rendered it. Keeping one panel
 * means a new QR channel only has to be added to the branch condition — it
 * cannot silently render blank again.
 *
 * All copy is channel-parameterized; do not reintroduce WhatsApp-specific
 * strings here.
 */
export interface QrLoginPanelProps {
  colors: ColorTheme;
  /** Display name, e.g. "WhatsApp" or "微信". Interpolated into all copy. */
  channelLabel: string;
  /**
   * Either the terminal-rendered QR (half-block glyphs), an `http(s)` image
   * URL, or one of the sentinel states the channel managers emit
   * (`SUCCESS`, `ALREADY_CONNECTED`, `CONNECTION_ERROR`, `QR_TIMEOUT`,
   * `QR_GENERATION_FAILED`, `QR_ERROR: …`). Null while still generating.
   */
  qrCode: string | null;
  qrLoadingTimedOut: boolean;
  isCheckingStatus: boolean;
  /** Opens the owner's disconnect confirmation dialog. */
  onRequestDisconnect: () => void;
  cancelSetup: () => void;
}

export function QrLoginPanel({
  colors,
  channelLabel,
  qrCode,
  qrLoadingTimedOut,
  isCheckingStatus,
  onRequestDisconnect,
  cancelSetup,
}: QrLoginPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <p style={{ color: colors.text.muted }}>
        {t('channels.scanQRWith', { channel: channelLabel })}
      </p>
      {qrCode ? (
        <div className="flex justify-center">
          {qrCode === 'SUCCESS' ? (
            <div
              className="text-center p-8 border rounded bg-green-500/10 border-green-500"
              style={{ color: colors.accent.green }}
            >
              <CheckCircle className="h-12 w-12 mx-auto mb-4" />
              <p className="text-lg font-semibold">
                {t('channels.connectedSuccess', { channel: channelLabel })}
              </p>
              <p className="text-sm mt-2">{t('channels.closingMoment')}</p>
            </div>
          ) : qrCode === 'CONNECTION_ERROR' ? (
            <div
              className="text-center p-8 border rounded bg-red-500/10 border-red-500"
              style={{ color: colors.accent.red }}
            >
              <X className="h-12 w-12 mx-auto mb-4" />
              <p className="text-lg font-semibold">
                {t('channels.connectionFailed')}
              </p>
              <p className="text-sm mt-2">{t('channels.pleaseTryAgain')}</p>
            </div>
          ) : qrCode === 'QR_TIMEOUT' ? (
            <div
              className="text-center p-8 border rounded bg-yellow-500/10 border-yellow-500"
              style={{ color: colors.accent.yellow }}
            >
              <Clock className="h-12 w-12 mx-auto mb-4" />
              <p className="text-lg font-semibold">{t('channels.timeout')}</p>
              <p className="text-sm mt-2">{t('channels.qrTimeout')}</p>
            </div>
          ) : qrCode.includes('█') || qrCode.includes('▄') ? (
            // Terminal QR: white background and zero letter-spacing are load
            // bearing — the half-block glyphs only scan when the rows abut.
            <pre
              className="font-mono text-xs leading-none bg-white p-4 rounded border"
              style={{
                color: '#000',
                fontSize: '8px',
                lineHeight: '8px',
                letterSpacing: '0',
              }}
            >
              {qrCode}
            </pre>
          ) : qrCode === 'ALREADY_CONNECTED' ? (
            <div
              className="text-center p-8 border rounded bg-blue-500/10 border-blue-500"
              style={{ color: colors.text.link }}
            >
              <CheckCircle className="h-12 w-12 mx-auto mb-4" />
              <p className="text-lg font-semibold">
                {t('channels.channelAlreadyConnected', { channel: channelLabel })}
              </p>
              <p className="text-sm mt-2">
                {t('channels.channelAlreadyConnectedDesc', { channel: channelLabel })}
              </p>
              <div className="flex gap-3 justify-center mt-6">
                <Button
                  onClick={onRequestDisconnect}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700"
                >
                  🔌 {t('channels.disconnect')}
                </Button>
                <Button
                  onClick={cancelSetup}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600"
                >
                  {t('common.close')}
                </Button>
              </div>
            </div>
          ) : qrCode === 'QR_GENERATION_FAILED' ? (
            <div
              className="text-center p-8 border rounded"
              style={{ color: colors.text.muted }}
            >
              <p>{t('channels.qrGenerationFailed')}</p>
              <p className="text-sm mt-2">{t('channels.checkConfig')}</p>
            </div>
          ) : qrCode.startsWith('QR_ERROR') ? (
            <div
              className="text-center p-8 border rounded"
              style={{ color: colors.text.danger }}
            >
              <p>❌ {t('channels.qrGenerationFailed')}</p>
              <p className="text-sm mt-2">{qrCode.replace('QR_ERROR: ', '')}</p>
            </div>
          ) : qrCode.startsWith('http') ? (
            <img
              src={qrCode}
              alt={t('channels.scanQRWith', { channel: channelLabel })}
              className="rounded"
            />
          ) : (
            <div
              className="text-center p-8 border rounded"
              style={{ color: colors.text.muted }}
            >
              <p>{t('channels.qrGenerationFailed')}</p>
              <p className="text-sm mt-2">{t('channels.checkConfig')}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 space-y-4">
          {isCheckingStatus ? (
            <>
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
              <p className="text-sm" style={{ color: colors.text.muted }}>
                {t('channels.checkingStatus')}
              </p>
            </>
          ) : qrLoadingTimedOut ? (
            <>
              <Clock className="h-12 w-12" style={{ color: colors.accent.yellow }} />
              <p
                className="text-sm font-semibold"
                style={{ color: colors.accent.yellow }}
              >
                {t('channels.qrTakingLong')}
              </p>
              <p className="text-xs" style={{ color: colors.text.muted }}>
                {t('channels.problemWithOpenClaw')}
              </p>
              <Button
                onClick={cancelSetup}
                className="mt-4 px-4 py-2 bg-gray-700 hover:bg-gray-600"
              >
                {t('channels.cancelSetup')}
              </Button>
            </>
          ) : (
            <>
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
              <p className="text-sm" style={{ color: colors.text.muted }}>
                {t('channels.generatingQR')}
              </p>
              <p
                className="text-xs"
                style={{ color: colors.text.muted, opacity: 0.7 }}
              >
                {t('channels.mayTake30Seconds')}
              </p>
            </>
          )}
        </div>
      )}
      {qrCode &&
        !qrCode.includes('ERROR') &&
        !qrCode.includes('FAILED') &&
        qrCode !== 'SUCCESS' &&
        qrCode !== 'QR_TIMEOUT' && (
          <p className="text-sm text-center" style={{ color: colors.text.muted }}>
            {t('channels.waitingForConnection')}
          </p>
        )}
    </div>
  );
}
