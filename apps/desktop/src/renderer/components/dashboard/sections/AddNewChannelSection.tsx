import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ColorTheme } from '../types'
import { ChannelInfo } from '../../../hooks/useChannelManager'
import { getChannelIcon } from '../../ui/channel-icons'
import { Modal } from '../../ui/modal'

interface AddNewChannelSectionProps {
  colors: ColorTheme
  channels: { whatsapp: ChannelInfo; telegram: ChannelInfo; discord: ChannelInfo; slack: ChannelInfo; feishu: ChannelInfo; line: ChannelInfo; weixin: ChannelInfo }
  startWhatsAppSetup: () => void
  startTelegramSetup: () => void
  startDiscordSetup: () => void
  startSlackSetup: () => void
  startFeishuSetup: () => void
  startLineSetup: () => void
  startWeixinSetup: () => void
  disconnectWhatsApp: () => Promise<boolean>
  disconnectTelegram: () => Promise<boolean>
  disconnectDiscord: () => Promise<boolean>
  disconnectSlack: () => Promise<boolean>
  disconnectFeishu: () => Promise<boolean>
  disconnectLine: () => Promise<boolean>
  disconnectWeixin: () => Promise<boolean>
  isConnecting: Record<string, boolean>
  isDisconnecting: Record<string, boolean>
}

export const AddNewChannelSection: React.FC<AddNewChannelSectionProps> = ({
  colors,
  channels,
  startWhatsAppSetup,
  startTelegramSetup,
  startDiscordSetup,
  startSlackSetup,
  startFeishuSetup,
  startLineSetup,
  startWeixinSetup,
  disconnectWhatsApp,
  disconnectTelegram,
  disconnectDiscord,
  disconnectSlack,
  disconnectFeishu,
  disconnectLine,
  disconnectWeixin,
  isConnecting,
  isDisconnecting
}) => {
  const { t } = useTranslation()

  // Disconnect tears down a live channel, so gate it behind an in-app
  // confirm (mirrors SessionsSection's delete dialog). Holds the pending
  // channel until the user confirms or cancels.
  const [disconnectConfirm, setDisconnectConfirm] = useState<{ name: string; key: string } | null>(null)

  // Each channel gets a "what you need" tag in place of the meaningless
  // Easy/Medium difficulty label. This is the actionable info — what
  // the user has to provide to connect.
  const staticChannelData = [
    {
      name: t('channels.whatsapp'),
      desc: t('channels.whatsappDesc'),
      requires: 'Phone number',
      key: 'whatsapp',
      brandColor: '#25D366',
    },
    {
      // External official plugin: connecting installs
      // @tencent-weixin/openclaw-weixin on demand, then does a QR login.
      // No credentials to type in — same shape as WhatsApp.
      name: t('channels.weixin'),
      desc: t('channels.weixinDesc'),
      requires: 'QR scan',
      key: 'weixin',
      brandColor: '#07C160',
    },
    {
      name: t('channels.telegram'),
      desc: t('channels.telegramDesc'),
      requires: 'Bot token',
      key: 'telegram',
      brandColor: '#229ED9',
    },
    {
      name: t('channels.discord'),
      desc: t('channels.discordDesc'),
      requires: 'Bot token',
      key: 'discord',
      brandColor: '#5865F2',
    },
    {
      name: t('channels.slack'),
      desc: t('channels.slackDesc'),
      requires: 'App tokens',
      key: 'slack',
      brandColor: '#ECB22E',
    },
    {
      name: t('channels.feishu'),
      desc: t('channels.feishuDesc'),
      requires: 'App ID + secret',
      key: 'feishu',
      brandColor: '#00B1B0',
    },
    {
      name: t('channels.line'),
      desc: t('channels.lineDesc'),
      requires: 'Channel tokens',
      key: 'line',
      brandColor: '#06C755',
    },
  ]

  const getChannelStatus = (channelKey: string) => {
    return channels[channelKey]?.status || 'disconnected';
  };

  // Dispatch on the stable channel key, never the rendered name: the name is
  // translated (channels.weixin is "微信" under zh), so name matching silently
  // stopped dispatching in non-English locales.
  const setupByKey: Record<string, () => void> = {
    whatsapp: startWhatsAppSetup,
    telegram: startTelegramSetup,
    discord: startDiscordSetup,
    slack: startSlackSetup,
    feishu: startFeishuSetup,
    line: startLineSetup,
    weixin: startWeixinSetup,
  }

  const disconnectByKey: Record<string, () => Promise<boolean>> = {
    whatsapp: disconnectWhatsApp,
    telegram: disconnectTelegram,
    discord: disconnectDiscord,
    slack: disconnectSlack,
    feishu: disconnectFeishu,
    line: disconnectLine,
    weixin: disconnectWeixin,
  }

  const handleChannelSetup = (channelKey: string) => {
    setupByKey[channelKey]?.();
  }

  const handleChannelDisconnect = async (channelKey: string) => {
    await disconnectByKey[channelKey]?.();
  }

  return (
    <div className="h-full flex flex-col overflow-hidden px-6 pt-8 pb-0">
      <div className="mb-4 flex items-baseline gap-3 flex-shrink-0">
        <h3
          className="font-display text-lg font-bold tracking-tight"
          style={{ color: colors.text.header }}
        >
          {t('channels.title')}
        </h3>
        <p className="text-sm" style={{ color: colors.text.muted }}>
          {t('channels.subtitle')}
        </p>
      </div>

      <div className="overflow-y-auto overflow-x-hidden flex-1 pb-8">
      <div className="grid grid-cols-1 gap-3">
        {staticChannelData.map((channel) => {
          const currentStatus = getChannelStatus(channel.key);
          const isConnected = currentStatus === 'connected';
          const Icon = getChannelIcon(channel.key);
          return (
          <div
            key={channel.name}
            className="rounded-lg pl-4 pr-5 py-4 hover-lift relative overflow-hidden"
            style={{
              backgroundColor: colors.bg.secondary,
              // Connected channels get a vivid left accent in their brand
              // color so the row reads as "this one is alive". Others fall
              // back to a near-invisible accent that still sets up the
              // visual rhythm for the column.
              borderLeft: `3px solid ${isConnected ? channel.brandColor : 'transparent'}`,
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4 min-w-0">
                {Icon ? (
                  <div className="flex-shrink-0">
                    <Icon size={40} />
                  </div>
                ) : null}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h4
                      className="text-base font-semibold truncate"
                      style={{ color: colors.text.header }}
                    >
                      {channel.name}
                    </h4>
                    {isConnected && (
                      <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ backgroundColor: `${channel.brandColor}22`, color: channel.brandColor }}>
                        <span
                          className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
                          style={{ backgroundColor: channel.brandColor }}
                        />
                        Active
                      </span>
                    )}
                  </div>
                  <p
                    className="text-sm mt-0.5"
                    style={{ color: colors.text.muted }}
                  >
                    {channel.desc}
                  </p>
                  <div className="flex items-center gap-3 text-[11px] mt-1.5" style={{ color: colors.text.muted }}>
                    {/* "What you'll need" replaces the meaningless
                        Difficulty: Easy/Medium label. Actionable info. */}
                    <span className="flex items-center gap-1">
                      <span style={{ opacity: 0.7 }}>Needs:</span>
                      <span style={{ color: colors.text.normal }}>{channel.requires}</span>
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                {currentStatus === 'coming_soon' ? (
                  <div
                    className="px-6 py-2 rounded font-medium text-sm"
                    style={{
                      backgroundColor: colors.bg.tertiary,
                      color: colors.text.muted,
                    }}
                  >
                    {t('channels.comingSoon')}
                  </div>
                ) : isConnected ? (
                  <button
                    onClick={() => setDisconnectConfirm({ name: channel.name, key: channel.key })}
                    disabled={isDisconnecting[channel.key]}
                    className="px-4 py-2 text-sm rounded font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                    style={{
                      backgroundColor: colors.bg.tertiary,
                      color: colors.text.normal,
                      border: `1px solid ${colors.bg.hover}`,
                    }}
                  >
                    {isDisconnecting[channel.key] && (
                      <div className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
                    )}
                    {t('channels.disconnect')}
                  </button>
                ) : (
                  <button
                    onClick={() => handleChannelSetup(channel.key)}
                    disabled={isConnecting[channel.key]}
                    className="px-5 py-2 rounded-md font-medium text-sm transition-all disabled:opacity-50 flex items-center gap-2 hover:brightness-110"
                    style={{
                      backgroundColor: channel.brandColor,
                      color: colors.button.primaryFg,
                    }}
                  >
                    {isConnecting[channel.key] && (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    )}
                    {t('channels.setup')}
                  </button>
                )}
              </div>
            </div>
          </div>
          );
        })}
      </div>
      </div>

      {/* Disconnect confirmation — tearing down a live channel stops it
          receiving messages, so require an explicit confirm first. */}
      <Modal
        open={!!disconnectConfirm}
        onClose={() => setDisconnectConfirm(null)}
        dismissable={disconnectConfirm ? !isDisconnecting[disconnectConfirm.key] : true}
        shellClassName="shadow-2xl"
      >
        <h3 className="font-bold text-lg mb-2" style={{ color: colors.text.header }}>
          {t('channels.disconnectConfirmTitle', 'Disconnect {{channel}}?', { channel: disconnectConfirm?.name })}
        </h3>
        <p className="text-sm mb-4" style={{ color: colors.text.muted }}>
          {t('channels.disconnectConfirmBody', 'This will stop receiving messages on it.')}
        </p>
        <div className="flex space-x-3">
          <button
            onClick={() => setDisconnectConfirm(null)}
            disabled={disconnectConfirm ? isDisconnecting[disconnectConfirm.key] : false}
            className="flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            style={{ backgroundColor: colors.bg.tertiary, color: colors.text.normal }}
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={async () => {
              if (!disconnectConfirm) return
              const target = disconnectConfirm.key
              await handleChannelDisconnect(target)
              setDisconnectConfirm(null)
            }}
            disabled={disconnectConfirm ? isDisconnecting[disconnectConfirm.key] : false}
            className="flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ backgroundColor: colors.accent.red, color: colors.button.primaryFg }}
          >
            {disconnectConfirm && isDisconnecting[disconnectConfirm.key] && (
              <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
            )}
            {t('channels.disconnect')}
          </button>
        </div>
      </Modal>
    </div>
  )
}