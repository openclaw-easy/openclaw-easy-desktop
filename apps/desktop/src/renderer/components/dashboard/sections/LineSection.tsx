import React from "react";
import { useTranslation } from "react-i18next";
import { MessageSquare } from "lucide-react";
import { ColorTheme, LogEntry } from "../types";
import { ChannelLogs } from "./ChannelLogs";
import { extractLineMessages } from "./channelExtractors";

interface LineSectionProps {
  colors: ColorTheme;
  logs: LogEntry[];
}

export const LineSection: React.FC<LineSectionProps> = ({
  colors,
  logs,
}) => {
  const { t } = useTranslation();

  return (
    <ChannelLogs
      colors={colors}
      logs={logs}
      channelName={t('channels.line')}
      channelIcon={<MessageSquare className="h-6 w-6" />}
      channelColor="#06C755"
      description={t('channels.viewMessages', { channel: t('channels.line') })}
      extractMessages={extractLineMessages}
    />
  );
};
