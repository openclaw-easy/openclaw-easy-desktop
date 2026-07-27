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
    <div className="flex justify-start animate-fade-up">
      <div
        className="max-w-[75%] rounded-2xl rounded-bl-md px-4 py-3 glow-ambient shadow-sm ring-1 ring-black/[0.04] dark:ring-white/[0.06]"
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
            {/* Soft coral caret — marks live streaming without the harsh
                full-block blink of the old bg-current cursor. */}
            <span className="inline-block w-[3px] h-4 ml-1 rounded-full align-text-bottom bg-brand-400 dark:bg-brand-500 animate-pulse" />
          </div>
        ) : (
          <div className="flex items-center space-x-2">
            <div className="flex space-x-1">
              {[0, 150, 300].map((delay) => (
                <div
                  key={delay}
                  className="w-1.5 h-1.5 rounded-full animate-bounce bg-brand-400/70 dark:bg-brand-500/70"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
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
