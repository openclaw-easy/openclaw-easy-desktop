import React from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { ColorTheme, LogEntry } from "../types";
import { ChannelLogs } from "./ChannelLogs";
import { extractDiscordMessages } from "./channelExtractors";

interface DiscordSectionProps {
  colors: ColorTheme;
  logs: LogEntry[];
}

export const DiscordSection: React.FC<DiscordSectionProps> = ({
  colors,
  logs,
}) => {
  const { t } = useTranslation();

  return (
    <ChannelLogs
      colors={colors}
      logs={logs}
      channelName={t('channels.discord')}
      channelIcon={<Users className="h-6 w-6" />}
      channelColor={colors.accent.indigo}
      description={t('channels.viewMessages', { channel: t('channels.discord') })}
      extractMessages={extractDiscordMessages}
    />
  );
};