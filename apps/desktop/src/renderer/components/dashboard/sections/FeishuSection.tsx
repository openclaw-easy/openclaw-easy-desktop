import React from "react";
import { useTranslation } from "react-i18next";
import { MessageSquare } from "lucide-react";
import { ColorTheme, LogEntry } from "../types";
import { ChannelLogs } from "./ChannelLogs";
import { extractFeishuMessages } from "./channelExtractors";

interface FeishuSectionProps {
  colors: ColorTheme;
  logs: LogEntry[];
}

export const FeishuSection: React.FC<FeishuSectionProps> = ({
  colors,
  logs,
}) => {
  const { t } = useTranslation();

  return (
    <ChannelLogs
      colors={colors}
      logs={logs}
      channelName={t('channels.feishu')}
      channelIcon={<MessageSquare className="h-6 w-6" />}
      channelColor="#00B1B0"
      description={t('channels.viewMessages', { channel: t('channels.feishu') })}
      extractMessages={extractFeishuMessages}
    />
  );
};
