import React from 'react';
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
  };
}

interface StreamingIndicatorProps {
  text?: string;
  colors: ColorTheme;
  thinking?: string;
  showThinking?: boolean;
}

export function StreamingIndicator({
  text,
  colors,
  thinking,
  showThinking = false
}: StreamingIndicatorProps) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-start animate-fade-in">
      <div
        className="max-w-[75%] rounded-lg rounded-bl-none px-4 py-3"
        style={{
          backgroundColor: colors.background.secondary,
          color: colors.text.normal
        }}
      >
        {/* Thinking section (if enabled) */}
        {showThinking && thinking && (
          <div
            className="text-xs mb-3 pb-3 border-b italic"
            style={{
              color: colors.text.muted,
              borderColor: colors.background.modifier.hover
            }}
          >
            <div className="font-semibold mb-1">{t('chat.thinking')}</div>
            <div className="whitespace-pre-wrap">{thinking}</div>
          </div>
        )}

        {/* Streaming text */}
        {text ? (
          <div className="text-sm">
            <MarkdownRenderer content={text} />
            <span className="inline-block w-2 h-4 ml-1 bg-current animate-pulse" />
          </div>
        ) : (
          <div className="flex items-center space-x-2">
            <div className="flex space-x-1">
              <div
                className="w-2 h-2 rounded-full animate-bounce"
                style={{
                  backgroundColor: colors.text.muted,
                  animationDelay: '0ms'
                }}
              />
              <div
                className="w-2 h-2 rounded-full animate-bounce"
                style={{
                  backgroundColor: colors.text.muted,
                  animationDelay: '150ms'
                }}
              />
              <div
                className="w-2 h-2 rounded-full animate-bounce"
                style={{
                  backgroundColor: colors.text.muted,
                  animationDelay: '300ms'
                }}
              />
            </div>
            <span className="text-sm" style={{ color: colors.text.muted }}>
              {t('chat.thinking')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
