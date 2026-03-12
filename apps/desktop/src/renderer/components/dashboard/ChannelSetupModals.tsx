import React from 'react';
import { X, CheckCircle, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { useToast } from '../../contexts/ToastContext';

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

interface ChannelSetupModalsProps {
  colors: ColorScheme;
  activeSetup: string | null;
  qrCode: string | null;
  qrLoadingTimedOut: boolean;
  isCheckingStatus: boolean;
  isConnecting: Record<string, boolean>;
  telegramToken: string;
  discordToken: string;
  discordServerId: string;
  slackBotToken: string;
  slackAppToken: string;
  feishuAppId: string;
  feishuAppSecret: string;
  feishuBotName: string;
  lineChannelAccessToken: string;
  lineChannelSecret: string;
  setTelegramToken: (token: string) => void;
  setDiscordToken: (token: string) => void;
  setDiscordServerId: (id: string) => void;
  setSlackBotToken: (token: string) => void;
  setSlackAppToken: (token: string) => void;
  setFeishuAppId: (id: string) => void;
  setFeishuAppSecret: (secret: string) => void;
  setFeishuBotName: (name: string) => void;
  setLineChannelAccessToken: (token: string) => void;
  setLineChannelSecret: (secret: string) => void;
  connectTelegramBot: (token: string) => Promise<boolean>;
  connectDiscordBot: (token: string, serverId: string) => Promise<boolean>;
  connectSlackBot: (botToken: string, appToken: string) => Promise<boolean>;
  connectFeishuBot: (appId: string, appSecret: string, botName: string) => Promise<boolean>;
  connectLineBot: (channelAccessToken: string, channelSecret: string) => Promise<boolean>;
  disconnectWhatsApp: () => Promise<boolean>;
  cancelSetup: () => void;
}

export function ChannelSetupModals({
  colors,
  activeSetup,
  qrCode,
  qrLoadingTimedOut,
  isCheckingStatus,
  isConnecting,
  telegramToken,
  discordToken,
  discordServerId,
  slackBotToken,
  slackAppToken,
  feishuAppId,
  feishuAppSecret,
  feishuBotName,
  lineChannelAccessToken,
  lineChannelSecret,
  setTelegramToken,
  setDiscordToken,
  setDiscordServerId,
  setSlackBotToken,
  setSlackAppToken,
  setFeishuAppId,
  setFeishuAppSecret,
  setFeishuBotName,
  setLineChannelAccessToken,
  setLineChannelSecret,
  connectTelegramBot,
  connectDiscordBot,
  connectSlackBot,
  connectFeishuBot,
  connectLineBot,
  disconnectWhatsApp,
  cancelSetup,
}: ChannelSetupModalsProps) {
  const { t } = useTranslation();
  const { addToast } = useToast();

  if (!activeSetup) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div
        className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4"
        style={{ backgroundColor: colors.bg.secondary }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3
            className="text-xl font-semibold"
            style={{ color: colors.text.header }}
          >
            {t('channels.setupChannel', { channel: activeSetup })}
          </h3>
          <button
            onClick={cancelSetup}
            className="p-1 rounded hover:bg-gray-700"
            style={{ color: colors.text.muted }}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {activeSetup === 'WhatsApp' && (
          <div className="space-y-4">
            <p style={{ color: colors.text.muted }}>
              {t('channels.scanQR')}
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
                      {t('channels.whatsappConnected')}
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
                    <p className="text-sm mt-2">
                      {t('channels.qrTimeout')}
                    </p>
                  </div>
                ) : qrCode.includes('█') || qrCode.includes('▄') ? (
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
                      {t('channels.alreadyConnected')}
                    </p>
                    <p className="text-sm mt-2">
                      {t('channels.alreadyConnectedDesc')}
                    </p>
                    <div className="flex gap-3 justify-center mt-6">
                      <Button
                        onClick={async () => {
                          const success = await disconnectWhatsApp();
                          if (success) {
                            cancelSetup();
                          }
                        }}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700"
                      >
                        🔌 Disconnect
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
                    <p className="text-sm mt-2">
                      {t('channels.checkConfig')}
                    </p>
                  </div>
                ) : qrCode.startsWith('QR_ERROR') ? (
                  <div
                    className="text-center p-8 border rounded"
                    style={{ color: colors.text.danger }}
                  >
                    <p>❌ QR Error</p>
                    <p className="text-sm mt-2">
                      {qrCode.replace('QR_ERROR: ', '')}
                    </p>
                  </div>
                ) : qrCode.startsWith('http') ? (
                  <img
                    src={qrCode}
                    alt="WhatsApp QR Code"
                    className="rounded"
                  />
                ) : (
                  <div
                    className="text-center p-8 border rounded"
                    style={{ color: colors.text.muted }}
                  >
                    <p>📱 QR Code Generated</p>
                    <p className="text-sm mt-2">
                      Check console for details
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                {isCheckingStatus ? (
                  <>
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                    <p
                      className="text-sm"
                      style={{ color: colors.text.muted }}
                    >
                      {t('channels.checkingStatus')}
                    </p>
                  </>
                ) : qrLoadingTimedOut ? (
                  <>
                    <Clock
                      className="h-12 w-12"
                      style={{ color: colors.accent.yellow }}
                    />
                    <p
                      className="text-sm font-semibold"
                      style={{ color: colors.accent.yellow }}
                    >
                      {t('channels.qrTakingLong')}
                    </p>
                    <p
                      className="text-xs"
                      style={{ color: colors.text.muted }}
                    >
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
                    <p
                      className="text-sm"
                      style={{ color: colors.text.muted }}
                    >
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
                <p
                  className="text-sm text-center"
                  style={{ color: colors.text.muted }}
                >
                  {t('channels.waitingForConnection')}
                </p>
              )}
          </div>
        )}

        {activeSetup === 'Telegram' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <p style={{ color: colors.text.muted }}>
                {t('channels.enterTelegramToken')}
              </p>
              <input
                type="password"
                value={telegramToken}
                onChange={(e) => setTelegramToken(e.target.value)}
                placeholder="1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZ"
                className="w-full px-3 py-2 rounded"
                style={{
                  backgroundColor: colors.bg.tertiary,
                  color: colors.text.normal,
                  border: 'none',
                }}
              />
            </div>
            <div className="flex space-x-2">
              <button
                onClick={cancelSetup}
                className="flex-1 px-4 py-2 rounded"
                style={{
                  backgroundColor: colors.bg.tertiary,
                  color: colors.text.normal,
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={async () => {
                  const success = await connectTelegramBot(telegramToken);
                  if (success) {
                    addToast(t('channels.connectedSuccess', { channel: 'Telegram' }), 'success', 5000);
                    cancelSetup();
                  } else {
                    addToast(t('channels.connectFailed', { channel: 'Telegram' }), 'error', 5000);
                  }
                }}
                disabled={!telegramToken || isConnecting.telegram}
                className="flex-1 px-4 py-2 rounded flex items-center justify-center gap-2"
                style={{
                  backgroundColor: telegramToken
                    ? colors.accent.brand
                    : colors.bg.tertiary,
                  color: 'white',
                  opacity: telegramToken ? 1 : 0.6,
                }}
              >
                {isConnecting.telegram && (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                {t('channels.connect')}
              </button>
            </div>
          </div>
        )}

        {activeSetup === 'Discord' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <p style={{ color: colors.text.muted }}>
                {t('channels.enterDiscordDetails')}
              </p>
              <input
                type="password"
                value={discordToken}
                onChange={(e) => setDiscordToken(e.target.value)}
                placeholder="Bot Token"
                className="w-full px-3 py-2 rounded"
                style={{
                  backgroundColor: colors.bg.tertiary,
                  color: colors.text.normal,
                  border: 'none',
                }}
              />
              <input
                type="text"
                value={discordServerId}
                onChange={(e) => setDiscordServerId(e.target.value)}
                placeholder="Server ID"
                className="w-full px-3 py-2 rounded"
                style={{
                  backgroundColor: colors.bg.tertiary,
                  color: colors.text.normal,
                  border: 'none',
                }}
              />
            </div>
            <div className="flex space-x-2">
              <button
                onClick={cancelSetup}
                className="flex-1 px-4 py-2 rounded"
                style={{
                  backgroundColor: colors.bg.tertiary,
                  color: colors.text.normal,
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={async () => {
                  const success = await connectDiscordBot(
                    discordToken,
                    discordServerId,
                  );
                  if (success) {
                    addToast(t('channels.connectedSuccess', { channel: 'Discord' }), 'success', 5000);
                    cancelSetup();
                  } else {
                    addToast(t('channels.connectFailed', { channel: 'Discord' }), 'error', 5000);
                  }
                }}
                disabled={!discordToken || !discordServerId || isConnecting.discord}
                className="flex-1 px-4 py-2 rounded flex items-center justify-center gap-2"
                style={{
                  backgroundColor:
                    discordToken && discordServerId
                      ? colors.accent.brand
                      : colors.bg.tertiary,
                  color: 'white',
                  opacity: discordToken && discordServerId ? 1 : 0.6,
                }}
              >
                {isConnecting.discord && (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                {t('channels.connect')}
              </button>
            </div>
          </div>
        )}

        {activeSetup === 'Slack' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <p style={{ color: colors.text.muted }}>
                {t('channels.enterSlackTokens')}
              </p>
              <input
                type="password"
                value={slackBotToken}
                onChange={(e) => setSlackBotToken(e.target.value)}
                placeholder="Bot Token (xoxb-...)"
                className="w-full px-3 py-2 rounded"
                style={{
                  backgroundColor: colors.bg.tertiary,
                  color: colors.text.normal,
                  border: 'none',
                }}
              />
              <input
                type="password"
                value={slackAppToken}
                onChange={(e) => setSlackAppToken(e.target.value)}
                placeholder="App Token (xapp-...)"
                className="w-full px-3 py-2 rounded"
                style={{
                  backgroundColor: colors.bg.tertiary,
                  color: colors.text.normal,
                  border: 'none',
                }}
              />
              <p className="text-xs" style={{ color: colors.text.muted }}>
                Create your Slack app at <span style={{ color: colors.text.link }}>api.slack.com/apps</span>. Enable Socket Mode and add the required bot scopes.
              </p>
            </div>
            <div className="flex space-x-2">
              <button
                onClick={cancelSetup}
                className="flex-1 px-4 py-2 rounded"
                style={{
                  backgroundColor: colors.bg.tertiary,
                  color: colors.text.normal,
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={async () => {
                  const success = await connectSlackBot(slackBotToken, slackAppToken);
                  if (success) {
                    addToast(t('channels.connectedSuccess', { channel: 'Slack' }), 'success', 5000);
                    cancelSetup();
                  } else {
                    addToast(t('channels.connectFailed', { channel: 'Slack' }), 'error', 5000);
                  }
                }}
                disabled={!slackBotToken || !slackAppToken || isConnecting.slack}
                className="flex-1 px-4 py-2 rounded flex items-center justify-center gap-2"
                style={{
                  backgroundColor:
                    slackBotToken && slackAppToken
                      ? '#4A154B'
                      : colors.bg.tertiary,
                  color: 'white',
                  opacity: slackBotToken && slackAppToken ? 1 : 0.6,
                }}
              >
                {isConnecting.slack && (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                {t('channels.connect')}
              </button>
            </div>
          </div>
        )}

        {activeSetup === 'Feishu' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <p style={{ color: colors.text.muted }}>
                {t('channels.enterFeishuCredentials')}
              </p>
              <input
                type="text"
                value={feishuAppId}
                onChange={(e) => setFeishuAppId(e.target.value)}
                placeholder="App ID (cli_xxx)"
                className="w-full px-3 py-2 rounded"
                style={{
                  backgroundColor: colors.bg.tertiary,
                  color: colors.text.normal,
                  border: 'none',
                }}
              />
              <input
                type="password"
                value={feishuAppSecret}
                onChange={(e) => setFeishuAppSecret(e.target.value)}
                placeholder="App Secret"
                className="w-full px-3 py-2 rounded"
                style={{
                  backgroundColor: colors.bg.tertiary,
                  color: colors.text.normal,
                  border: 'none',
                }}
              />
              <input
                type="text"
                value={feishuBotName}
                onChange={(e) => setFeishuBotName(e.target.value)}
                placeholder="Bot Name (optional)"
                className="w-full px-3 py-2 rounded"
                style={{
                  backgroundColor: colors.bg.tertiary,
                  color: colors.text.normal,
                  border: 'none',
                }}
              />
              <p className="text-xs" style={{ color: colors.text.muted }}>
                Create your app at <span style={{ color: colors.text.link }}>open.feishu.cn</span> and enable WebSocket event subscription.
              </p>
            </div>
            <div className="flex space-x-2">
              <button
                onClick={cancelSetup}
                className="flex-1 px-4 py-2 rounded"
                style={{
                  backgroundColor: colors.bg.tertiary,
                  color: colors.text.normal,
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={async () => {
                  const success = await connectFeishuBot(feishuAppId, feishuAppSecret, feishuBotName);
                  if (success) {
                    addToast(t('channels.connectedSuccess', { channel: 'Feishu' }), 'success', 5000);
                    cancelSetup();
                  } else {
                    addToast(t('channels.connectFailed', { channel: 'Feishu' }), 'error', 5000);
                  }
                }}
                disabled={!feishuAppId || !feishuAppSecret || isConnecting.feishu}
                className="flex-1 px-4 py-2 rounded flex items-center justify-center gap-2"
                style={{
                  backgroundColor:
                    feishuAppId && feishuAppSecret
                      ? '#00B1B0'
                      : colors.bg.tertiary,
                  color: 'white',
                  opacity: feishuAppId && feishuAppSecret ? 1 : 0.6,
                }}
              >
                {isConnecting.feishu && (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                {t('channels.connect')}
              </button>
            </div>
          </div>
        )}

        {activeSetup === 'Line' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <p style={{ color: colors.text.muted }}>
                {t('channels.enterLineCredentials')}
              </p>
              <input
                type="password"
                value={lineChannelAccessToken}
                onChange={(e) => setLineChannelAccessToken(e.target.value)}
                placeholder="Channel Access Token"
                className="w-full px-3 py-2 rounded"
                style={{
                  backgroundColor: colors.bg.tertiary,
                  color: colors.text.normal,
                  border: 'none',
                }}
              />
              <input
                type="password"
                value={lineChannelSecret}
                onChange={(e) => setLineChannelSecret(e.target.value)}
                placeholder="Channel Secret"
                className="w-full px-3 py-2 rounded"
                style={{
                  backgroundColor: colors.bg.tertiary,
                  color: colors.text.normal,
                  border: 'none',
                }}
              />
              <p className="text-xs" style={{ color: colors.text.muted }}>
                Create a Messaging API channel at <span style={{ color: colors.text.link }}>developers.line.biz</span>. Set webhook URL to your gateway's <span style={{ color: colors.text.link }}>/line/webhook</span> endpoint.
              </p>
            </div>
            <div className="flex space-x-2">
              <button
                onClick={cancelSetup}
                className="flex-1 px-4 py-2 rounded"
                style={{
                  backgroundColor: colors.bg.tertiary,
                  color: colors.text.normal,
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={async () => {
                  const success = await connectLineBot(lineChannelAccessToken, lineChannelSecret);
                  if (success) {
                    addToast(t('channels.connectedSuccess', { channel: 'LINE' }), 'success', 5000);
                    cancelSetup();
                  } else {
                    addToast(t('channels.connectFailed', { channel: 'LINE' }), 'error', 5000);
                  }
                }}
                disabled={!lineChannelAccessToken || !lineChannelSecret || isConnecting.line}
                className="flex-1 px-4 py-2 rounded flex items-center justify-center gap-2"
                style={{
                  backgroundColor:
                    lineChannelAccessToken && lineChannelSecret
                      ? '#06C755'
                      : colors.bg.tertiary,
                  color: 'white',
                  opacity: lineChannelAccessToken && lineChannelSecret ? 1 : 0.6,
                }}
              >
                {isConnecting.line && (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                {t('channels.connect')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
