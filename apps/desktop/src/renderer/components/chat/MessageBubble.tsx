import React, { useState } from 'react';
import { Copy, Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MarkdownRenderer } from './MarkdownRenderer';

interface ColorTheme {
  background: {
    primary: string;
    secondary: string;
    tertiary: string;
    modifier: {
      hover: string;
      active: string;
      selected: string;
    };
  };
  text: {
    normal: string;
    muted: string;
    header: string;
  };
  accent: {
    brand: string;
    green: string;
    userBubble: string;
  };
}

interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  colors: ColorTheme;
  showTimestamp?: boolean;
}

// Renders inline images from user messages.
// Handles markdown image syntax ![alt](url), raw image URLs, and data URIs.
function renderUserContentWithImages(content: string) {
  const parts: { type: 'text' | 'image'; value: string }[] = [];
  let lastIndex = 0;

  // Match: 1) markdown images ![...](url)  2) raw image URLs on own line  3) raw data URIs on own line
  // Group 1: URL from markdown syntax; Group 2: raw URL or data URI
  const combinedRe = /!\[[^\]]*\]\(((?:https?:\/\/[^\s)]+)|(?:data:image\/[^)]+))\)|(?:^|\n)((?:https?:\/\/\S+\.(?:png|jpe?g|gif|webp|svg)(?:\?[^\s]*)?)|(?:data:image\/[^;]+;base64,[^\s]+))(?:\n|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = combinedRe.exec(content)) !== null) {
    const url = match[1] || match[2];
    const matchStart = match.index;
    const matchEnd = combinedRe.lastIndex;

    if (matchStart > lastIndex) {
      const text = content.slice(lastIndex, matchStart).trim();
      if (text) parts.push({ type: 'text', value: text });
    }

    parts.push({ type: 'image', value: url });
    lastIndex = matchEnd;
  }

  if (lastIndex < content.length) {
    const text = content.slice(lastIndex).trim();
    if (text) parts.push({ type: 'text', value: text });
  }

  if (!parts.some((p) => p.type === 'image')) {
    return <div className="whitespace-pre-wrap break-words">{content}</div>;
  }

  return (
    <div className="space-y-2">
      {parts.map((part, i) =>
        part.type === 'image' ? (
          <InlineImage key={i} src={part.value} />
        ) : (
          <div key={i} className="whitespace-pre-wrap break-words">
            {part.value}
          </div>
        )
      )}
    </div>
  );
}

function InlineImage({ src }: { src: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <img
        src={src}
        alt="Attached image"
        className="rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
        style={{ maxWidth: '400px', maxHeight: '300px', objectFit: 'contain' }}
        onClick={() => setExpanded(true)}
        loading="lazy"
      />
      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 cursor-pointer"
          onClick={() => setExpanded(false)}
        >
          <button
            className="absolute top-4 right-4 p-2 rounded-full bg-black/50 text-white hover:bg-black/70"
            onClick={() => setExpanded(false)}
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={src}
            alt="Full size"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
          />
        </div>
      )}
    </>
  );
}

export function MessageBubble({
  role,
  content,
  timestamp,
  colors,
  showTimestamp = true
}: MessageBubbleProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const isUser = role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} group`}>
      <div
        className={`max-w-[75%] rounded-lg px-4 py-3 relative ${
          isUser ? 'rounded-br-none' : 'rounded-bl-none'
        }`}
        style={{
          backgroundColor: isUser
            ? colors.accent.userBubble
            : colors.background.secondary,
          color: colors.text.normal
        }}
      >
        {/* Copy button */}
        <button
          onClick={handleCopy}
          className="absolute -top-2 right-2 p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
          style={{
            backgroundColor: colors.background.tertiary,
            color: colors.text.muted
          }}
          title={t('chat.copyMessage')}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" style={{ color: colors.accent.green }} />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>

        {/* Message content */}
        <div className="text-sm">
          {isUser ? (
            renderUserContentWithImages(content)
          ) : (
            <MarkdownRenderer content={content} />
          )}
        </div>

        {/* Timestamp */}
        {showTimestamp && timestamp && (
          <div
            className="text-xs mt-2 opacity-60"
            style={{ color: isUser ? '#ffffff' : colors.text.muted }}
          >
            {new Date(timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit'
            })}
          </div>
        )}
      </div>
    </div>
  );
}
