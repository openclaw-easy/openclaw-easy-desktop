import React from 'react'
import { useTranslation } from 'react-i18next'
import { ColorTheme } from '../types'
import { ChannelInfo } from '../../../hooks/useChannelManager'

interface AddNewChannelSectionProps {
  colors: ColorTheme
  channels: { whatsapp: ChannelInfo; telegram: ChannelInfo; discord: ChannelInfo; slack: ChannelInfo; feishu: ChannelInfo; line: ChannelInfo }
  startWhatsAppSetup: () => void
  startTelegramSetup: () => void
  startDiscordSetup: () => void
  startSlackSetup: () => void
  startFeishuSetup: () => void
  startLineSetup: () => void
  disconnectWhatsApp: () => Promise<boolean>
  disconnectTelegram: () => Promise<boolean>
  disconnectDiscord: () => Promise<boolean>
  disconnectSlack: () => Promise<boolean>
  disconnectFeishu: () => Promise<boolean>
  disconnectLine: () => Promise<boolean>
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
  disconnectWhatsApp,
  disconnectTelegram,
  disconnectDiscord,
  disconnectSlack,
  disconnectFeishu,
  disconnectLine,
  isConnecting,
  isDisconnecting
}) => {
  const { t } = useTranslation()

  const staticChannelData = [
    {
      name: t('channels.whatsapp'),
      icon: "📱",
      desc: t('channels.whatsappDesc'),
      difficulty: t('channels.easy'),
      key: "whatsapp"
    },
    {
      name: t('channels.telegram'),
      icon: "✈️",
      desc: t('channels.telegramDesc'),
      difficulty: t('channels.medium'),
      key: "telegram"
    },
    {
      name: t('channels.discord'),
      icon: "🎮",
      desc: t('channels.discordDesc'),
      difficulty: t('channels.medium'),
      key: "discord"
    },
    {
      name: t('channels.slack'),
      icon: "💬",
      desc: t('channels.slackDesc'),
      difficulty: t('channels.medium'),
      key: "slack"
    },
    {
      name: t('channels.feishu'),
      icon: "🪁",
      desc: t('channels.feishuDesc'),
      difficulty: t('channels.medium'),
      key: "feishu"
    },
    {
      name: t('channels.line'),
      icon: "💚",
      desc: t('channels.lineDesc'),
      difficulty: t('channels.medium'),
      key: "line"
    },
  ]

  const getChannelStatus = (channelKey: string) => {
    return channels[channelKey]?.status || 'disconnected';
  };

  const handleChannelSetup = (channelName: string) => {
    if (channelName === "WhatsApp") {
      startWhatsAppSetup();
    } else if (channelName === "Telegram") {
      startTelegramSetup();
    } else if (channelName === "Discord") {
      startDiscordSetup();
    } else if (channelName === "Slack") {
      startSlackSetup();
    } else if (channelName === "Feishu") {
      startFeishuSetup();
    } else if (channelName === "Line") {
      startLineSetup();
    }
  }

  const handleChannelDisconnect = async (channelName: string) => {
    if (channelName === "WhatsApp") {
      await disconnectWhatsApp();
    } else if (channelName === "Telegram") {
      await disconnectTelegram();
    } else if (channelName === "Discord") {
      await disconnectDiscord();
    } else if (channelName === "Slack") {
      await disconnectSlack();
    } else if (channelName === "Feishu") {
      await disconnectFeishu();
    } else if (channelName === "Line") {
      await disconnectLine();
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden px-6 pt-8 pb-0">
      <div className="mb-4 flex items-baseline gap-3 flex-shrink-0">
        <h3
          className="text-lg font-bold"
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
          return (
          <div
            key={channel.name}
            className="rounded-lg px-5 py-4 transition-all hover:scale-[1.01]"
            style={{ backgroundColor: colors.bg.secondary }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="text-2xl">{channel.icon}</div>
                <div>
                  <h4
                    className="text-base font-semibold"
                    style={{ color: colors.text.header }}
                  >
                    {channel.name}
                  </h4>
                  <p
                    className="text-sm"
                    style={{ color: colors.text.muted }}
                  >
                    {channel.desc}
                  </p>
                  <div className="flex items-center space-x-4 text-xs mt-0.5">
                    <span style={{ color: colors.text.muted }}>
                      {t('channels.difficulty', { level: channel.difficulty })}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-end gap-2">
                {currentStatus === 'coming_soon' ? (
                  <div
                    className="px-6 py-2 rounded font-medium"
                    style={{
                      backgroundColor: colors.bg.tertiary,
                      color: colors.text.muted,
                    }}
                  >
                    {t('channels.comingSoon')}
                  </div>
                ) : currentStatus === 'connected' ? (
                  <>
                    <div className="flex items-center gap-2 text-green-500 text-sm font-medium">
                      <span>✅</span>
                      <span>{t('common.connected')}</span>
                    </div>
                    <button
                      onClick={() => handleChannelDisconnect(channel.name)}
                      disabled={isDisconnecting[channel.key]}
                      className="px-4 py-1 text-sm rounded font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                      style={{
                        backgroundColor: colors.bg.tertiary,
                        color: colors.text.muted,
                        border: `1px solid ${colors.text.muted}`,
                      }}
                    >
                      {isDisconnecting[channel.key] && (
                        <div className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
                      )}
                      {t('channels.disconnect')}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => handleChannelSetup(channel.name)}
                    disabled={isConnecting[channel.key]}
                    className="px-6 py-2 rounded font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                    style={{
                      backgroundColor: colors.accent.brand,
                      color: "white",
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
    </div>
  )
}