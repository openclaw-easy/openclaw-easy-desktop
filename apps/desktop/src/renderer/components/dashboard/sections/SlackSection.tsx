import React from "react";
import { useTranslation } from "react-i18next";
import { Hash } from "lucide-react";
import { ColorTheme, LogEntry } from "../types";
import { ChannelLogs } from "./ChannelLogs";
import { extractSlackMessages } from "./channelExtractors";

interface SlackSectionProps {
  colors: ColorTheme;
  logs: LogEntry[];
}

export const SlackSection: React.FC<SlackSectionProps> = ({
  colors,
  logs,
}) => {
  const { t } = useTranslation();

  return (
    <ChannelLogs
      colors={colors}
      logs={logs}
      channelName={t('channels.slack')}
      channelIcon={<Hash className="h-6 w-6" />}
      channelColor="#4A154B"
      description={t('channels.viewMessages', { channel: t('channels.slack') })}
      extractMessages={extractSlackMessages}
    />
  );
};
