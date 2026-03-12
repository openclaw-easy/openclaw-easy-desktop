import { LogEntry } from "../types";
import { ChannelMessage } from "./ChannelLogs";

// WhatsApp message extractor
export const extractWhatsAppMessages = (logs: LogEntry[]): ChannelMessage[] => {
  const messages: ChannelMessage[] = [];
  let messageId = 0;

  console.log("[WhatsApp] Total logs received:", logs.length);

  logs.forEach((log) => {
    const logText =
      typeof log === "string"
        ? log
        : log?.message || log?.fullEntry || String(log);

    // Check for new WhatsApp log format: [whatsapp] Inbound message +number -> +number (direct, X chars)
    const whatsappInboundMatch = logText.match(
      /\[whatsapp\]\s+Inbound message\s+([+\d]+)\s+->\s+([+\d]+)\s+\(([^,]+),\s+(\d+)\s+chars\)/i,
    );

    if (whatsappInboundMatch) {
      const [, fromNumber, toNumber, messageType, charCount] = whatsappInboundMatch;
      const msgId = `inbound-${fromNumber}-${Date.now()}-${messageId++}`;
      messages.push({
        id: msgId,
        timestamp: new Date(),
        direction: "inbound",
        from: fromNumber,
        message: `${messageType} message`,
        originalLog: logText,
        messageId: msgId,
        charCount: parseInt(charCount) || 0,
      });
      return;
    }

    // Check for outbound WhatsApp messages
    const whatsappOutboundMatch =
      logText.match(
        /\[whatsapp\]\s+Outbound message\s+([+\d]+)\s+->\s+([+\d]+)\s+\(([^,]+),\s+(\d+)\s+chars\)/i,
      ) ||
      logText.match(/Auto-replied.*to\s+([+\d]+)/i);

    if (whatsappOutboundMatch) {
      const [, fromNumber, toNumber, messageType, charCount] = whatsappOutboundMatch;
      const msgId = `outbound-${toNumber || fromNumber}-${Date.now()}-${messageId++}`;
      messages.push({
        id: msgId,
        timestamp: new Date(),
        direction: "outbound",
        from: `To ${toNumber || fromNumber}`,
        message: messageType || "Outbound message",
        originalLog: logText,
        messageId: msgId,
        charCount: parseInt(charCount) || 0,
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
      const timestampMatch = logText.match(
        /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/,
      );
      const timestamp = timestampMatch ? new Date(timestampMatch[1]) : new Date();

      const isOutbound = /outbound|sent|reply|response|auto-replied|sending/i.test(logText);

      messages.push({
        id: `msg-${messageId++}`,
        timestamp,
        direction: isOutbound ? "outbound" : "inbound",
        from: isOutbound ? "Openclaw" : "WhatsApp Contact",
        message: logText
          .replace(/^🖥️\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\s*/, "")
          .trim(),
        originalLog: logText,
      });
    }
  });

  console.log("[WhatsApp] Messages found:", messages.length);
  return messages.toReversed().slice(0, 100);
};

// Telegram message extractor
export const extractTelegramMessages = (logs: LogEntry[]): ChannelMessage[] => {
  const messages: ChannelMessage[] = [];
  let messageId = 0;

  console.log("[Telegram] Total logs received:", logs.length);

  logs.forEach((log) => {
    const logText =
      typeof log === "string"
        ? log
        : log?.message || log?.fullEntry || String(log);

    // Check for Telegram inbound messages
    const telegramInboundMatch = logText.match(
      /\[telegram\]\s+Inbound message.*?from\s+(@?\w+|\d+)\s*(?:.*?(\d+)\s+chars)?/i,
    );

    if (telegramInboundMatch) {
      const [, fromUser, charCount] = telegramInboundMatch;
      const msgId = `telegram-inbound-${fromUser}-${Date.now()}-${messageId++}`;
      messages.push({
        id: msgId,
        timestamp: new Date(),
        direction: "inbound",
        from: fromUser.startsWith('@') ? fromUser : `@${fromUser}`,
        message: "Telegram message",
        originalLog: logText,
        messageId: msgId,
        charCount: parseInt(charCount) || 0,
      });
      return;
    }

    // Check for Telegram outbound messages
    const telegramOutboundMatch = logText.match(
      /\[telegram\]\s+(?:Outbound|Sent|Sending).*?(?:to\s+)?(@?\w+|\d+)/i,
    ) || logText.match(/Auto-replied.*telegram.*to\s+(@?\w+|\d+)/i);

    if (telegramOutboundMatch) {
      const [, toUser] = telegramOutboundMatch;
      const msgId = `telegram-outbound-${toUser}-${Date.now()}-${messageId++}`;
      messages.push({
        id: msgId,
        timestamp: new Date(),
        direction: "outbound",
        from: `To ${toUser.startsWith('@') ? toUser : `@${toUser}`}`,
        message: "Bot response",
        originalLog: logText,
        messageId: msgId,
      });
      return;
    }

    // General Telegram activity
    if (
      logText.toLowerCase().includes("[telegram]") ||
      (logText.toLowerCase().includes("telegram") &&
        (logText.includes("message") ||
          logText.includes("received") ||
          logText.includes("sent")))
    ) {
      const timestampMatch = logText.match(
        /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/,
      );
      const timestamp = timestampMatch ? new Date(timestampMatch[1]) : new Date();

      const isOutbound = /outbound|sent|reply|response|auto-replied|sending/i.test(logText);

      messages.push({
        id: `telegram-msg-${messageId++}`,
        timestamp,
        direction: isOutbound ? "outbound" : "inbound",
        from: isOutbound ? "Openclaw" : "Telegram User",
        message: logText
          .replace(/^🖥️\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\s*/, "")
          .trim(),
        originalLog: logText,
      });
    }
  });

  console.log("[Telegram] Messages found:", messages.length);
  return messages.toReversed().slice(0, 100);
};

// Discord message extractor
export const extractDiscordMessages = (logs: LogEntry[]): ChannelMessage[] => {
  const messages: ChannelMessage[] = [];
  let messageId = 0;

  console.log("[Discord] Total logs received:", logs.length);

  logs.forEach((log) => {
    const logText =
      typeof log === "string"
        ? log
        : log?.message || log?.fullEntry || String(log);

    // Check for Discord inbound messages
    const discordInboundMatch = logText.match(
      /\[discord\]\s+(?:Inbound message|Message).*?from\s+([^:]+)(?:.*?(\d+)\s+chars)?/i,
    );

    if (discordInboundMatch) {
      const [, fromUser, charCount] = discordInboundMatch;
      const msgId = `discord-inbound-${fromUser}-${Date.now()}-${messageId++}`;
      messages.push({
        id: msgId,
        timestamp: new Date(),
        direction: "inbound",
        from: fromUser.trim(),
        message: "Discord message",
        originalLog: logText,
        messageId: msgId,
        charCount: parseInt(charCount) || 0,
      });
      return;
    }

    // Check for Discord outbound messages
    const discordOutboundMatch = logText.match(
      /\[discord\]\s+(?:Outbound|Sent|Sending).*?(?:to\s+)?([^:]+)/i,
    ) || logText.match(/Auto-replied.*discord.*to\s+([^:]+)/i);

    if (discordOutboundMatch) {
      const [, toUser] = discordOutboundMatch;
      const msgId = `discord-outbound-${toUser}-${Date.now()}-${messageId++}`;
      messages.push({
        id: msgId,
        timestamp: new Date(),
        direction: "outbound",
        from: `To ${toUser.trim()}`,
        message: "Bot response",
        originalLog: logText,
        messageId: msgId,
      });
      return;
    }

    // General Discord activity
    if (
      logText.toLowerCase().includes("[discord]") ||
      (logText.toLowerCase().includes("discord") &&
        (logText.includes("message") ||
          logText.includes("received") ||
          logText.includes("sent")))
    ) {
      const timestampMatch = logText.match(
        /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/,
      );
      const timestamp = timestampMatch ? new Date(timestampMatch[1]) : new Date();

      const isOutbound = /outbound|sent|reply|response|auto-replied|sending/i.test(logText);

      messages.push({
        id: `discord-msg-${messageId++}`,
        timestamp,
        direction: isOutbound ? "outbound" : "inbound",
        from: isOutbound ? "Openclaw" : "Discord User",
        message: logText
          .replace(/^🖥️\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\s*/, "")
          .trim(),
        originalLog: logText,
      });
    }
  });

  console.log("[Discord] Messages found:", messages.length);
  return messages.toReversed().slice(0, 100);
};

// Slack message extractor
export const extractSlackMessages = (logs: LogEntry[]): ChannelMessage[] => {
  const messages: ChannelMessage[] = [];
  let messageId = 0;

  console.log("[Slack] Total logs received:", logs.length);

  logs.forEach((log) => {
    const logText =
      typeof log === "string"
        ? log
        : log?.message || log?.fullEntry || String(log);

    // Check for Slack inbound messages
    const slackInboundMatch = logText.match(
      /\[slack\]\s+(?:Inbound message|Message).*?from\s+([^:(\s]+)(?:.*?(\d+)\s+chars)?/i,
    );

    if (slackInboundMatch) {
      const [, fromUser, charCount] = slackInboundMatch;
      const msgId = `slack-inbound-${fromUser}-${Date.now()}-${messageId++}`;
      messages.push({
        id: msgId,
        timestamp: new Date(),
        direction: "inbound",
        from: fromUser.trim(),
        message: "Slack message",
        originalLog: logText,
        messageId: msgId,
        charCount: parseInt(charCount) || 0,
      });
      return;
    }

    // Check for Slack outbound messages
    const slackOutboundMatch =
      logText.match(/\[slack\]\s+(?:Outbound|Sent|Sending).*?(?:to\s+)?([^:(\s]+)/i) ||
      logText.match(/Auto-replied.*slack.*to\s+([^:(\s]+)/i);

    if (slackOutboundMatch) {
      const [, toUser] = slackOutboundMatch;
      const msgId = `slack-outbound-${toUser}-${Date.now()}-${messageId++}`;
      messages.push({
        id: msgId,
        timestamp: new Date(),
        direction: "outbound",
        from: `To ${toUser.trim()}`,
        message: "Bot response",
        originalLog: logText,
        messageId: msgId,
      });
      return;
    }

    // General Slack activity
    if (
      logText.toLowerCase().includes("[slack]") ||
      (logText.toLowerCase().includes("slack") &&
        (logText.includes("message") ||
          logText.includes("received") ||
          logText.includes("sent")))
    ) {
      const timestampMatch = logText.match(
        /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/,
      );
      const timestamp = timestampMatch ? new Date(timestampMatch[1]) : new Date();
      const isOutbound = /outbound|sent|reply|response|auto-replied|sending/i.test(logText);

      messages.push({
        id: `slack-msg-${messageId++}`,
        timestamp,
        direction: isOutbound ? "outbound" : "inbound",
        from: isOutbound ? "Openclaw" : "Slack User",
        message: logText
          .replace(/^🖥️\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\s*/, "")
          .trim(),
        originalLog: logText,
      });
    }
  });

  console.log("[Slack] Messages found:", messages.length);
  return messages.toReversed().slice(0, 100);
};

// Feishu message extractor
export const extractFeishuMessages = (logs: LogEntry[]): ChannelMessage[] => {
  const messages: ChannelMessage[] = [];
  let messageId = 0;

  logs.forEach((log) => {
    const logText =
      typeof log === "string"
        ? log
        : log?.message || log?.fullEntry || String(log);

    const feishuInboundMatch = logText.match(
      /\[feishu\]\s+(?:Inbound message|Message).*?from\s+([^:(\s]+)(?:.*?(\d+)\s+chars)?/i,
    );

    if (feishuInboundMatch) {
      const [, fromUser, charCount] = feishuInboundMatch;
      const msgId = `feishu-inbound-${fromUser}-${Date.now()}-${messageId++}`;
      messages.push({
        id: msgId,
        timestamp: new Date(),
        direction: "inbound",
        from: fromUser.trim(),
        message: "Feishu message",
        originalLog: logText,
        messageId: msgId,
        charCount: parseInt(charCount) || 0,
      });
      return;
    }

    const feishuOutboundMatch =
      logText.match(/\[feishu\]\s+(?:Outbound|Sent|Sending).*?(?:to\s+)?([^:(\s]+)/i) ||
      logText.match(/Auto-replied.*feishu.*to\s+([^:(\s]+)/i);

    if (feishuOutboundMatch) {
      const [, toUser] = feishuOutboundMatch;
      const msgId = `feishu-outbound-${toUser}-${Date.now()}-${messageId++}`;
      messages.push({
        id: msgId,
        timestamp: new Date(),
        direction: "outbound",
        from: `To ${toUser.trim()}`,
        message: "Bot response",
        originalLog: logText,
        messageId: msgId,
      });
      return;
    }

    if (
      logText.toLowerCase().includes("[feishu]") ||
      (logText.toLowerCase().includes("feishu") &&
        (logText.includes("message") ||
          logText.includes("received") ||
          logText.includes("sent")))
    ) {
      const timestampMatch = logText.match(
        /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/,
      );
      const timestamp = timestampMatch ? new Date(timestampMatch[1]) : new Date();
      const isOutbound = /outbound|sent|reply|response|auto-replied|sending/i.test(logText);

      messages.push({
        id: `feishu-msg-${messageId++}`,
        timestamp,
        direction: isOutbound ? "outbound" : "inbound",
        from: isOutbound ? "Openclaw" : "Feishu User",
        message: logText
          .replace(/^🖥️\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\s*/, "")
          .trim(),
        originalLog: logText,
      });
    }
  });

  return messages.toReversed().slice(0, 100);
};

// LINE message extractor
export const extractLineMessages = (logs: LogEntry[]): ChannelMessage[] => {
  const messages: ChannelMessage[] = [];
  let messageId = 0;

  logs.forEach((log) => {
    const logText =
      typeof log === "string"
        ? log
        : log?.message || log?.fullEntry || String(log);

    const lineInboundMatch = logText.match(
      /\[line\]\s+(?:Inbound message|Message).*?from\s+([^:(\s]+)(?:.*?(\d+)\s+chars)?/i,
    );

    if (lineInboundMatch) {
      const [, fromUser, charCount] = lineInboundMatch;
      const msgId = `line-inbound-${fromUser}-${Date.now()}-${messageId++}`;
      messages.push({
        id: msgId,
        timestamp: new Date(),
        direction: "inbound",
        from: fromUser.trim(),
        message: "LINE message",
        originalLog: logText,
        messageId: msgId,
        charCount: parseInt(charCount) || 0,
      });
      return;
    }

    const lineOutboundMatch =
      logText.match(/\[line\]\s+(?:Outbound|Sent|Sending).*?(?:to\s+)?([^:(\s]+)/i) ||
      logText.match(/Auto-replied.*\bline\b.*to\s+([^:(\s]+)/i);

    if (lineOutboundMatch) {
      const [, toUser] = lineOutboundMatch;
      const msgId = `line-outbound-${toUser}-${Date.now()}-${messageId++}`;
      messages.push({
        id: msgId,
        timestamp: new Date(),
        direction: "outbound",
        from: `To ${toUser.trim()}`,
        message: "Bot response",
        originalLog: logText,
        messageId: msgId,
      });
      return;
    }

    if (
      logText.toLowerCase().includes("[line]") ||
      (logText.toLowerCase().includes("line") &&
        (logText.includes("message") ||
          logText.includes("received") ||
          logText.includes("sent")))
    ) {
      const timestampMatch = logText.match(
        /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/,
      );
      const timestamp = timestampMatch ? new Date(timestampMatch[1]) : new Date();
      const isOutbound = /outbound|sent|reply|response|auto-replied|sending/i.test(logText);

      messages.push({
        id: `line-msg-${messageId++}`,
        timestamp,
        direction: isOutbound ? "outbound" : "inbound",
        from: isOutbound ? "Openclaw" : "LINE User",
        message: logText
          .replace(/^🖥️\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\s*/, "")
          .trim(),
        originalLog: logText,
      });
    }
  });

  return messages.toReversed().slice(0, 100);
};

// WhatsApp content fetcher
export const getWhatsAppMessageContent = async (
  messageId: string,
  originalLog: string,
): Promise<string> => {
  try {
    // Try to fetch actual message content from OpenClaw
    if (window.electronAPI?.getWhatsAppMessages) {
      const result = await window.electronAPI.getWhatsAppMessages();

      if (result.success && result.messages) {
        const timestampMatch = originalLog.match(
          /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/,
        );
        const phoneMatch = originalLog.match(
          /\[whatsapp\]\s+Inbound message\s+([+\d]+)/,
        );

        if (timestampMatch && phoneMatch) {
          const timestamp = timestampMatch[1];
          const fromNumber = phoneMatch[1];

          const matchingMessage = result.messages.find(
            (msg: any) =>
              msg.timestamp === timestamp ||
              (msg.from === fromNumber &&
                Math.abs(
                  new Date(msg.timestamp).getTime() - new Date(timestamp).getTime(),
                ) < 5000),
          );

          if (matchingMessage && matchingMessage.content) {
            return matchingMessage.content;
          }
        }
      }
    }

    return "Message content not available";
  } catch (error) {
    console.error("Failed to get WhatsApp message content:", error);
    return "Failed to load message content";
  }
};