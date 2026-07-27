import React, { useState } from 'react';
import { X, CheckCircle, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { useToast } from '../../contexts/ToastContext';
import { Modal } from '../ui/modal';
import { QrLoginPanel } from './QrLoginPanel';
import {
  isHandledSetupChannel,
  isQrLoginChannel,
  type QrLoginChannel,
} from './channel-setup-channels';
import type { ColorTheme } from './types';

// Local alias for back-compat with the prop name. Was a duplicated
// interface declaration until the 2026-06-15 ColorTheme dedup pass.
type ColorScheme = ColorTheme;

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
  disconnectWeixin: () => Promise<boolean>;
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
  disconnectWeixin,
  cancelSetup,
}: ChannelSetupModalsProps) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const titleId = 'channel-setup-title';
  // Gate disconnect behind a confirm so one click can't tear down a live
  // channel. Mirrors SessionsSection's delete dialog. Holds the channel being
  // disconnected rather than a boolean so the dialog names — and disconnects —
  // the right one; a boolean silently disconnected WhatsApp for every channel.
  const [disconnectTarget, setDisconnectTarget] = useState<QrLoginChannel | null>(null);
  const qrChannelLabel = (channel: QrLoginChannel) =>
    channel === 'Weixin' ? t('channels.weixin') : t('channels.whatsapp');

  return (
    <>
    {/* Escape / backdrop click both call cancelSetup so partial state is
        rolled back the same way the X button would. */}
    <Modal
      open={!!activeSetup}
      onClose={cancelSetup}
      labelledBy={titleId}
    >
        <div className="flex items-center justify-between mb-4">
          <h3
            id={titleId}
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

        {/* A label with no body below would render an empty modal, which is
            indistinguishable from a failed setup. Say so instead. */}
        {activeSetup && !isHandledSetupChannel(activeSetup) && (
          <div className="text-center p-8" style={{ color: colors.text.danger }}>
            <p>{t('channels.connectFailed', { channel: activeSetup })}</p>
          </div>
        )}

        {isQrLoginChannel(activeSetup) && (
          <QrLoginPanel
            colors={colors}
            channelLabel={qrChannelLabel(activeSetup)}
            qrCode={qrCode}
            qrLoadingTimedOut={qrLoadingTimedOut}
            isCheckingStatus={isCheckingStatus}
            onRequestDisconnect={() => setDisconnectTarget(activeSetup)}
            cancelSetup={cancelSetup}
          />
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
                  color: colors.button.primaryFg,
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
                  color: colors.button.primaryFg,
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
                  color: colors.button.primaryFg,
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
                  color: colors.button.primaryFg,
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
                  color: colors.button.primaryFg,
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
    </Modal>

    {/* Disconnect confirmation — stops the channel receiving messages, so
        require an explicit confirm before tearing it down. */}
    <Modal
      open={disconnectTarget !== null}
      onClose={() => setDisconnectTarget(null)}
      shellClassName="shadow-2xl"
    >
      <h3 className="font-bold text-lg mb-2" style={{ color: colors.text.header }}>
        {t('channels.disconnectConfirmTitle', 'Disconnect {{channel}}?', {
          channel: disconnectTarget ? qrChannelLabel(disconnectTarget) : '',
        })}
      </h3>
      <p className="text-sm mb-4" style={{ color: colors.text.muted }}>
        {t('channels.disconnectConfirmBody', 'This will stop receiving messages on it.')}
      </p>
      <div className="flex space-x-3">
        <button
          onClick={() => setDisconnectTarget(null)}
          className="flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{ backgroundColor: colors.bg.tertiary, color: colors.text.normal }}
        >
          {t('common.cancel')}
        </button>
        <button
          onClick={async () => {
            const success =
              disconnectTarget === 'Weixin'
                ? await disconnectWeixin()
                : await disconnectWhatsApp();
            setDisconnectTarget(null);
            if (success) {
              cancelSetup();
            }
          }}
          className="flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{ backgroundColor: colors.accent.red, color: colors.button.primaryFg }}
        >
          {t('channels.disconnect')}
        </button>
      </div>
    </Modal>
    </>
  );
}
