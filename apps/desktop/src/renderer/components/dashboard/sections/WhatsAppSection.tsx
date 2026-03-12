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

interface WhatsAppMessage {
  id: string;
  timestamp: Date;
  direction: "inbound" | "outbound";
  from: string;
  message: string;
  originalLog: string;
  messageId?: string; // For async loading
  charCount?: number;
}

interface WhatsAppSectionProps {
  colors: ColorTheme;
  logs: LogEntry[];
}

export const WhatsAppSection: React.FC<WhatsAppSectionProps> = ({
  colors,
  logs,
}) => {
  const { t } = useTranslation();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(
    new Set(),
  );
  const [loadingMessages, setLoadingMessages] = useState<Set<string>>(
    new Set(),
  );
  const [messageContent, setMessageContent] = useState<Map<string, string>>(
    new Map(),
  );

  // Helper function to strip ANSI color codes from text
  const stripAnsiCodes = (text: string): string => {
    // Remove ANSI escape sequences (color codes)
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\[(?:90|3[0-9])m/g, '');
  };

  // Filter and parse WhatsApp messages from logs
  const whatsappMessages = useMemo(() => {
    const messages: WhatsAppMessage[] = [];
    let messageId = 0;

    // Debug: Log the raw logs we're receiving
    console.log("[WhatsApp] Total logs received:", logs.length);

    // Find all WhatsApp-related logs
    const whatsappLogs = logs.filter((log) => {
      const rawLogText = typeof log === "string" ? log : String(log);
      // Strip ANSI codes before checking
      const logText = stripAnsiCodes(rawLogText);
      return (
        logText.toLowerCase().includes("whatsapp") ||
        logText.includes("+49") || // German phone numbers
        logText.includes("+1") || // US phone numbers
        logText.includes("📱") || // Phone emoji
        logText.includes("message")
      );
    });

    console.log("[WhatsApp] WhatsApp-related logs found:", whatsappLogs.length);
    if (whatsappLogs.length > 0) {
      console.log("[WhatsApp] Sample WhatsApp logs:", whatsappLogs.slice(-3));
    }

    logs.forEach((log) => {
      const rawLogText =
        typeof log === "string"
          ? log
          : log?.message || log?.fullEntry || String(log);

      // Strip ANSI color codes from the log text for pattern matching
      const logText = stripAnsiCodes(rawLogText);

      // Check for new WhatsApp log format: [whatsapp] Inbound message +number -> +number (direct, X chars)
      const whatsappInboundMatch = logText.match(
        /\[whatsapp\]\s+Inbound message\s+([+\d]+)\s+->\s+([+\d]+)\s+\(([^,]+),\s+(\d+)\s+chars\)/i,
      );

      if (whatsappInboundMatch) {
        const [, fromNumber, , messageType, charCount] =
          whatsappInboundMatch;
        const msgId = `inbound-${fromNumber}-${Date.now()}-${messageId++}`;
        messages.push({
          id: msgId,
          timestamp: new Date(),
          direction: "inbound",
          from: fromNumber,
          message: `${messageType} message`,
          originalLog: rawLogText,
          messageId: msgId,
          charCount: parseInt(charCount) || 0,
        });
        return;
      }

      // Check for outbound WhatsApp messages - multiple patterns
      const whatsappOutboundMatch =
        logText.match(
          /\[whatsapp\]\s+Outbound message\s+([+\d]+)\s+->\s+([+\d]+)\s+\(([^,]+),\s+(\d+)\s+chars\)/i,
        ) ||
        logText.match(
          /\[whatsapp\]\s+(?:Sent|Sending)\s+(?:message\s+)?(?:to\s+)?([+\d]+)\s*(?:->\s*)?([+\d]+)?\s*\(([^,]+),\s+(\d+)\s+chars\)/i,
        ) ||
        logText.match(/Sent.*whatsapp.*to\s+([+\d]+)/i) ||
        logText.match(/Auto-replied.*whatsapp.*to\s+([+\d]+)/i);

      if (whatsappOutboundMatch) {
        const [, fromNumber, toNumber, messageType, charCount] =
          whatsappOutboundMatch;
        const msgId = `outbound-${toNumber || fromNumber}-${Date.now()}-${messageId++}`;
        messages.push({
          id: msgId,
          timestamp: new Date(),
          direction: "outbound",
          from: `To ${toNumber || fromNumber}`,
          message: messageType || "Outbound message",
          originalLog: rawLogText,
          messageId: msgId,
          charCount: parseInt(charCount) || 0,
        });
        return;
      }

      // Check for general outbound patterns (replies, responses, etc.)
      const generalOutboundMatch =
        logText.match(/\[whatsapp\].*(?:reply|response|answer|sent)/i) ||
        logText.match(/(?:reply|response|answer|sent).*\[whatsapp\]/i) ||
        (logText.match(/Auto-replied/i) && logText.includes("whatsapp"));

      if (generalOutboundMatch) {
        messages.push({
          id: `msg-${messageId++}`,
          timestamp: new Date(),
          direction: "outbound",
          from: "Openclaw",
          message: "Sent response",
          originalLog: rawLogText,
        });
        return;
      }

      // Legacy patterns for backward compatibility
      const legacyInboundMatch =
        logText.match(/Inbound message.*WhatsApp.*from\s+(.*?):\s*(.*)/i) ||
        logText.match(/📱.*WhatsApp.*from\s+(.*?):\s*(.*)/i) ||
        logText.match(/Received.*WhatsApp.*from\s+(.*?):\s*(.*)/i);

      if (legacyInboundMatch) {
        messages.push({
          id: `msg-${messageId++}`,
          timestamp: new Date(),
          direction: "inbound",
          from: legacyInboundMatch[1]?.trim() || "Unknown",
          message: legacyInboundMatch[2]?.trim() || "",
          originalLog: rawLogText,
        });
        return;
      }

      // Legacy outbound patterns
      const legacyOutboundMatch =
        logText.match(/Auto-replied.*WhatsApp.*to\s+(.*?):\s*(.*)/i) ||
        logText.match(/Sent.*WhatsApp.*to\s+(.*?):\s*(.*)/i) ||
        logText.match(/📤.*WhatsApp.*to\s+(.*?):\s*(.*)/i);

      if (legacyOutboundMatch) {
        messages.push({
          id: `msg-${messageId++}`,
          timestamp: new Date(),
          direction: "outbound",
          from: legacyOutboundMatch[1]?.trim() || "You",
          message: legacyOutboundMatch[2]?.trim() || "",
          originalLog: rawLogText,
        });
        return;
      }

      // General WhatsApp activity
      if (
        logText.toLowerCase().includes("[whatsapp]") ||
        (logText.toLowerCase().includes("whatsapp") &&
          (logText.includes("message") ||
            logText.includes("received") ||
            logText.includes("sent")))
      ) {
        // Extract timestamp if available
        const timestampMatch = logText.match(
          /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/,
        );
        const timestamp = timestampMatch
          ? new Date(timestampMatch[1])
          : new Date();

        // Better direction detection
        const isOutbound =
          /outbound|sent|reply|response|auto-replied|sending/i.test(logText);

        messages.push({
          id: `msg-${messageId++}`,
          timestamp,
          direction: isOutbound ? "outbound" : "inbound",
          from: isOutbound ? "Openclaw" : "WhatsApp Contact",
          message: logText
            .replace(/^🖥️\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\s*/, "")
            .trim(),
          originalLog: rawLogText,
        });
      }
    });

    // If no structured messages found, create entries from WhatsApp logs
    if (messages.length === 0 && whatsappLogs.length > 0) {
      console.log(
        "[WhatsApp] No structured messages found, showing raw WhatsApp logs",
      );
      whatsappLogs.forEach((log) => {
        const rawLogText = typeof log === "string" ? log : String(log);
        const logText = stripAnsiCodes(rawLogText);

        // Extract timestamp if available
        const timestampMatch = logText.match(
          /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/,
        );
        const timestamp = timestampMatch
          ? new Date(timestampMatch[1])
          : new Date();

        // Determine direction based on keywords
        const isOutbound =
          /outbound|sent|reply|response|auto-replied|sending|to\s+\+/i.test(
            logText,
          );

        messages.push({
          id: `log-${messageId++}`,
          timestamp,
          direction: isOutbound ? "outbound" : "inbound",
          from: isOutbound ? "Openclaw" : "WhatsApp",
          message:
            logText.replace(/^.*?\[whatsapp\]\s*/i, "").substring(0, 100) +
            (logText.length > 100 ? "..." : ""),
          originalLog: rawLogText,
        });
      });
    }

    // Debug: Log found messages
    console.log("[WhatsApp] Messages found:", messages.length);
    if (messages.length > 0) {
      console.log("[WhatsApp] Sample messages:", messages.slice(0, 3));
    }

    // Return newest messages first
    return messages.toReversed().slice(0, 100);
  }, [logs]);

  // Function to load message content asynchronously
  const loadMessageContent = async (messageId: string, originalLog: string) => {
    if (messageContent.has(messageId) || loadingMessages.has(messageId)) {
      return; // Already loaded or loading
    }

    setLoadingMessages((prev) => new Set(prev).add(messageId));

    try {
      // Extract timestamp and phone numbers from the log for content fetching
      const timestampMatch = originalLog.match(
        /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/,
      );
      const phoneMatch = originalLog.match(
        /\[whatsapp\]\s+Inbound message\s+([+\d]+)\s+->\s+([+\d]+)/,
      );

      if (timestampMatch && phoneMatch) {
        const timestamp = timestampMatch[1];
        const fromNumber = phoneMatch[1];

        // Try to fetch actual message content from OpenClaw
        if (window.electronAPI?.getWhatsAppMessages) {
          const result = await window.electronAPI.getWhatsAppMessages();

          if (result.success && result.messages) {
            // Find the matching message by timestamp and phone number
            const matchingMessage = result.messages.find(
              (msg: any) =>
                msg.timestamp === timestamp ||
                (msg.from === fromNumber &&
                  Math.abs(
                    new Date(msg.timestamp).getTime() -
                      new Date(timestamp).getTime(),
                  ) < 5000),
            );

            if (matchingMessage && matchingMessage.content) {
              setMessageContent((prev) =>
                new Map(prev).set(messageId, matchingMessage.content),
              );
              return;
            }
          }
        }
      }

      // Fallback: Try to extract any readable content from recent logs
      const recentContent = await extractContentFromLogs(originalLog);
      setMessageContent((prev) =>
        new Map(prev).set(
          messageId,
          recentContent || t('channels.contentNotAvailable'),
        ),
      );
    } catch (error) {
      console.error("Failed to load message content:", error);
      setMessageContent((prev) =>
        new Map(prev).set(messageId, t('channels.contentNotAvailable')),
      );
    } finally {
      setLoadingMessages((prev) => {
        const newSet = new Set(prev);
        newSet.delete(messageId);
        return newSet;
      });
    }
  };

  // Helper function to extract content from surrounding logs
  const extractContentFromLogs = async (
    targetLog: string,
  ): Promise<string | null> => {
    try {
      // Look through recent logs for content related to this message
      const timestampMatch = targetLog.match(
        /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/,
      );
      if (!timestampMatch) {return null;}

      const targetTime = new Date(timestampMatch[1]);

      // Search through logs for content that appeared around the same time
      for (const log of logs.slice(-50)) {
        // Check last 50 logs
        const logText =
          typeof log === "string"
            ? log
            : log?.message || log?.fullEntry || String(log);

        // Look for content that might be the message text
        if (
          logText.includes("content:") ||
          logText.includes("text:") ||
          logText.includes("message:")
        ) {
          const logTimeMatch = logText.match(
            /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/,
          );
          if (logTimeMatch) {
            const logTime = new Date(logTimeMatch[1]);
            // If within 10 seconds of target message
            if (Math.abs(logTime.getTime() - targetTime.getTime()) < 10000) {
              // Extract content after content: or similar patterns
              const contentMatch = logText.match(
                /(?:content|text|message):\s*(.+)/i,
              );
              if (contentMatch) {
                return contentMatch[1].trim();
              }
            }
          }
        }
      }

      return null;
    } catch (error) {
      console.error("Error extracting content from logs:", error);
      return null;
    }
  };

  // Toggle message expansion
  const toggleMessage = async (messageId: string, originalLog?: string) => {
    const isExpanded = expandedMessages.has(messageId);

    if (isExpanded) {
      // Collapse
      setExpandedMessages((prev) => {
        const newSet = new Set(prev);
        newSet.delete(messageId);
        return newSet;
      });
    } else {
      // Expand and load content
      setExpandedMessages((prev) => new Set(prev).add(messageId));
      await loadMessageContent(messageId, originalLog || "");
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
  }, [whatsappMessages]);

  return (
    <div className="p-8 h-full flex flex-col">
      <div
        className="rounded-lg flex-1 flex flex-col"
        style={{ backgroundColor: colors.bg.secondary }}
      >
        <div className="p-6 pb-4 flex-shrink-0">
          <div className="flex items-center space-x-3 mb-2">
            <MessageSquare
              className="h-6 w-6"
              style={{ color: colors.accent.green }}
            />
            <h3
              className="text-lg font-semibold"
              style={{ color: colors.text.header }}
            >
              {t('channels.messages', { channel: t('channels.whatsapp') })}
            </h3>
          </div>
          <p className="text-sm" style={{ color: colors.text.muted }}>
            {t('channels.viewMessages', { channel: t('channels.whatsapp') })}
          </p>

          <div
            className="mt-3 p-2 rounded"
            style={{ backgroundColor: colors.bg.tertiary }}
          >
            <p className="text-xs" style={{ color: colors.text.muted }}>
              {t('channels.messageMetadataNote')}
            </p>
          </div>

          {whatsappMessages.length > 0 && (
            <div className="mt-3 text-xs" style={{ color: colors.text.muted }}>
              {t('channels.messageCount', { count: whatsappMessages.length })}
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
                {whatsappMessages.length > 0 ? (
                  whatsappMessages.map((message) => {
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
                                  : colors.accent.green,
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
                                      : colors.accent.green,
                                }}
                              >
                                {message.direction === "outbound"
                                  ? t('channels.to')
                                  : t('channels.from')}
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
                        {t('channels.noMessagesYet', { channel: t('channels.whatsapp') })}
                      </p>
                      <p
                        className="text-xs"
                        style={{ color: colors.text.muted }}
                      >
                        {t('channels.messagesWillAppear', { channel: t('channels.whatsapp') })}
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