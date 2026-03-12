import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Loader2,
  MessageSquare,
} from "lucide-react";
import { ColorTheme, LogEntry } from "../types";

export interface ChannelMessage {
  id: string;
  timestamp: Date;
  direction: "inbound" | "outbound";
  from: string;
  message: string;
  originalLog: string;
  messageId?: string;
  charCount?: number;
}

interface ChannelLogsProps {
  colors: ColorTheme;
  logs: LogEntry[];
  channelName: string;
  channelIcon: React.ReactNode;
  channelColor: string;
  description: string;
  extractMessages: (logs: LogEntry[]) => ChannelMessage[];
  getMessageContent?: (messageId: string, originalLog: string) => Promise<string>;
}

export const ChannelLogs: React.FC<ChannelLogsProps> = ({
  colors,
  logs,
  channelName,
  channelIcon,
  channelColor,
  description,
  extractMessages,
  getMessageContent,
}) => {
  const { t } = useTranslation();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const [loadingMessages, setLoadingMessages] = useState<Set<string>>(new Set());
  const [messageContent, setMessageContent] = useState<Map<string, string>>(new Map());

  // Extract messages using the provided function
  const channelMessages = useMemo(() => {
    const messages = extractMessages(logs);
    console.log(`[${channelName}] Messages found:`, messages.length);
    return messages;
  }, [logs, extractMessages, channelName]);

  // Load message content asynchronously
  const loadMessageContent = async (messageId: string, originalLog: string) => {
    if (messageContent.has(messageId) || loadingMessages.has(messageId)) {
      return;
    }

    setLoadingMessages((prev) => new Set(prev).add(messageId));

    try {
      let content = "";

      if (getMessageContent) {
        content = await getMessageContent(messageId, originalLog);
      }

      if (!content) {
        content = t('channels.contentNotAvailable');
      }

      setMessageContent((prev) => new Map(prev).set(messageId, content));
    } catch (error) {
      console.error(`Failed to load ${channelName} message content:`, error);
      setMessageContent((prev) =>
        new Map(prev).set(messageId, t('channels.contentNotAvailable'))
      );
    } finally {
      setLoadingMessages((prev) => {
        const newSet = new Set(prev);
        newSet.delete(messageId);
        return newSet;
      });
    }
  };

  // Toggle message expansion
  const toggleMessage = async (messageId: string, originalLog?: string) => {
    const isExpanded = expandedMessages.has(messageId);

    if (isExpanded) {
      setExpandedMessages((prev) => {
        const newSet = new Set(prev);
        newSet.delete(messageId);
        return newSet;
      });
    } else {
      setExpandedMessages((prev) => new Set(prev).add(messageId));
      if (originalLog) {
        await loadMessageContent(messageId, originalLog);
      }
    }
  };

  // Auto-scroll to top when new messages arrive
  useEffect(() => {
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const isNearTop = container.scrollTop < 50;

      if (isNearTop || container.scrollTop === 0) {
        container.scrollTop = 0;
      }
    }
  }, [channelMessages]);

  return (
    <div className="p-8 h-full flex flex-col">
      <div
        className="rounded-lg flex-1 flex flex-col"
        style={{ backgroundColor: colors.bg.secondary }}
      >
        <div className="p-6 pb-4 flex-shrink-0">
          <div className="flex items-center space-x-3 mb-2">
            <div style={{ color: channelColor }}>
              {channelIcon}
            </div>
            <h3
              className="text-lg font-semibold"
              style={{ color: colors.text.header }}
            >
              {t('channels.messages', { channel: channelName })}
            </h3>
          </div>
          <p className="text-sm" style={{ color: colors.text.muted }}>
            {description}
          </p>

          <div
            className="mt-3 p-2 rounded"
            style={{ backgroundColor: colors.bg.tertiary }}
          >
            <p className="text-xs" style={{ color: colors.text.muted }}>
              {t('channels.messageMetadataNote')}
            </p>
          </div>

          {channelMessages.length > 0 && (
            <div className="mt-3 text-xs" style={{ color: colors.text.muted }}>
              {t('channels.messageCount', { count: channelMessages.length })}
            </div>
          )}
        </div>

        <div className="flex-1 px-6 pb-6">
          <div
            className="rounded-lg border"
            style={{
              backgroundColor: colors.bg.primary,
              borderColor: colors.bg.tertiary,
              height: "500px",
            }}
          >
            <div
              ref={scrollContainerRef}
              className="h-full overflow-y-auto p-4 scroll-smooth"
            >
              <div className="space-y-3">
                {channelMessages.length > 0 ? (
                  channelMessages.map((message) => {
                    const isExpanded = expandedMessages.has(
                      message.messageId || message.id,
                    );
                    const isLoading = loadingMessages.has(
                      message.messageId || message.id,
                    );
                    const content = messageContent.get(
                      message.messageId || message.id,
                    );

                    return (
                      <div
                        key={message.id}
                        className={`rounded-lg transition-all duration-200 ${
                          message.direction === "outbound"
                            ? "bg-blue-500/10 border border-blue-500/20"
                            : "bg-green-500/10 border border-green-500/20"
                        }`}
                      >
                        {/* Compact Message Header */}
                        <div
                          className="flex items-center p-3 cursor-pointer hover:bg-black/5 transition-colors"
                          onClick={() =>
                            toggleMessage(
                              message.messageId || message.id,
                              message.originalLog,
                            )
                          }
                        >
                          <div
                            className="flex-shrink-0 mr-3"
                            style={{
                              color:
                                message.direction === "outbound"
                                  ? colors.accent.brand
                                  : channelColor,
                            }}
                          >
                            {message.direction === "outbound" ? (
                              <ArrowUp className="h-4 w-4" />
                            ) : (
                              <ArrowDown className="h-4 w-4" />
                            )}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-2 mb-1">
                              <span
                                className="font-medium text-sm"
                                style={{
                                  color:
                                    message.direction === "outbound"
                                      ? colors.accent.brand
                                      : channelColor,
                                }}
                              >
                                {message.direction === "outbound" ? t('channels.to') : t('channels.from')}
                                : {message.from}
                              </span>
                              <span
                                className="text-xs"
                                style={{ color: colors.text.muted }}
                              >
                                {message.timestamp.toLocaleTimeString()}
                              </span>
                              {message.charCount !== undefined && (
                                <span
                                  className="text-xs px-2 py-1 rounded"
                                  style={{
                                    backgroundColor: colors.bg.tertiary,
                                    color: colors.text.muted,
                                  }}
                                >
                                  {t('channels.chars', { count: message.charCount })}
                                </span>
                              )}
                            </div>

                            <div
                              className="text-sm"
                              style={{ color: colors.text.muted }}
                            >
                              {message.message}
                            </div>
                          </div>

                          {/* Expand/Collapse Icon */}
                          <div className="flex-shrink-0 ml-2">
                            {isLoading ? (
                              <Loader2
                                className="h-4 w-4 animate-spin"
                                style={{ color: colors.text.muted }}
                              />
                            ) : (
                              <div
                                className="transform transition-transform duration-200"
                                style={{
                                  transform: isExpanded
                                    ? "rotate(90deg)"
                                    : "rotate(0deg)",
                                  color: colors.text.muted,
                                }}
                              >
                                <ChevronRight className="h-4 w-4" />
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Expanded Message Content */}
                        {isExpanded && (
                          <div
                            className="px-3 pb-3 border-t"
                            style={{ borderColor: colors.bg.tertiary }}
                          >
                            <div className="mt-3">
                              <div
                                className="text-sm font-medium mb-2"
                                style={{ color: colors.text.header }}
                              >
                                {t('channels.messageContent')}
                              </div>
                              {isLoading ? (
                                <div className="flex items-center space-x-2 py-4">
                                  <Loader2
                                    className="h-4 w-4 animate-spin"
                                    style={{ color: colors.text.muted }}
                                  />
                                  <span
                                    className="text-sm"
                                    style={{ color: colors.text.muted }}
                                  >
                                    {t('channels.loadingMessageContent')}
                                  </span>
                                </div>
                              ) : (
                                <div
                                  className="text-sm p-3 rounded"
                                  style={{
                                    backgroundColor: colors.bg.primary,
                                    color: colors.text.normal,
                                  }}
                                >
                                  {content || t('channels.contentNotAvailable')}
                                </div>
                              )}

                              <details className="mt-3">
                                <summary
                                  className="text-xs cursor-pointer"
                                  style={{ color: colors.text.muted }}
                                >
                                  {t('channels.rawLog')}
                                </summary>
                                <div
                                  className="text-xs font-mono mt-2 p-2 rounded"
                                  style={{
                                    backgroundColor: colors.bg.tertiary,
                                    color: colors.text.muted,
                                  }}
                                >
                                  {message.originalLog}
                                </div>
                              </details>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="flex flex-col items-center justify-center h-32 space-y-3">
                    <MessageSquare
                      className="h-12 w-12"
                      style={{ color: colors.text.muted }}
                    />
                    <div className="text-center">
                      <p
                        className="text-sm font-medium mb-1"
                        style={{ color: colors.text.muted }}
                      >
                        {t('channels.noMessagesYet', { channel: channelName })}
                      </p>
                      <p
                        className="text-xs"
                        style={{ color: colors.text.muted }}
                      >
                        {t('channels.messagesWillAppear', { channel: channelName })}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};