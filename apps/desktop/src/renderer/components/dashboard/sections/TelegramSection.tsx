import React from "react";
import { useTranslation } from "react-i18next";
import { Send } from "lucide-react";
import { ColorTheme, LogEntry } from "../types";
import { ChannelLogs } from "./ChannelLogs";
import { extractTelegramMessages } from "./channelExtractors";

interface TelegramSectionProps {
  colors: ColorTheme;
  logs: LogEntry[];
}

export const TelegramSection: React.FC<TelegramSectionProps> = ({
  colors,
  logs,
}) => {
  const { t } = useTranslation();

  return (
    <ChannelLogs
      colors={colors}
      logs={logs}
      channelName={t('channels.telegram')}
      channelIcon={<Send className="h-6 w-6" />}
      channelColor={colors.accent.brand}
      description={t('channels.viewMessages', { channel: t('channels.telegram') })}
      extractMessages={extractTelegramMessages}
    />
  );
};