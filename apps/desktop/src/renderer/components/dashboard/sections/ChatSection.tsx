import React, { useState, useEffect, useRef, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Loader2, StopCircle, WifiOff, RefreshCw, X, Zap, ImagePlus, Mic } from 'lucide-react';
import { useChatConnection, extractDisplayText, BackendError } from '../../../hooks/useChatConnection';
import { MessageBubble } from '../../chat/MessageBubble';
import { StreamingIndicator } from '../../chat/StreamingIndicator';
import { TalkModeOverlay } from '../../chat/TalkModeOverlay';
import { ExecApprovalOverlay } from '../../chat/ExecApprovalOverlay';
import { useTalkMode } from '../../../hooks/useTalkMode';
import { DEFAULT_GATEWAY_PORT } from '../../../../shared/constants';

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

interface ChatSectionProps {
  colors: ColorTheme;
  sessionKey?: string;
  gatewayPort?: number;
  isGatewayRunning?: boolean;
  isActive?: boolean;
  onUpgrade?: () => void;
  onGoToVoiceSettings?: () => void;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

const ChatSectionComponent = ({ colors, sessionKey = 'default', gatewayPort = DEFAULT_GATEWAY_PORT, isGatewayRunning = false, isActive = false, onUpgrade, onGoToVoiceSettings }: ChatSectionProps) => {
  const { t } = useTranslation();
  const {
    isConnected,
    connectionError,
    sendMessage,
    loadHistory,
    abortRun,
    onChatEvent,
    connect,
    reconnect,
    execApprovalQueue,
    execApprovalBusy,
    execApprovalError,
    resolveExecApproval,
  } = useChatConnection(gatewayPort);

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState('');
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [quotaError, setQuotaError] = useState<BackendError | null>(null);
  const [rateLimitError, setRateLimitError] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rafIdRef = useRef<number | null>(null);
  // Tracks the latest streaming text so the RAF callback never reads a stale closure value
  const latestStreamingTextRef = useRef<string>('');
  // 150s client-side watchdog — cleared when the gateway sends final/error/aborted
  const streamingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref mirror of currentRunId for the timeout callback (avoids stale closure)
  const currentRunIdRef = useRef<string | null>(null);
  // Guard against double-send from rapid clicks (state update may not flush between clicks)
  const isSendingRef = useRef(false);

  // When the gateway transitions to running while chat is disconnected,
  // immediately reconnect instead of waiting for the exponential backoff timer.
  const prevGatewayRunningRef = useRef(isGatewayRunning);
  useEffect(() => {
    const wasRunning = prevGatewayRunningRef.current;
    prevGatewayRunningRef.current = isGatewayRunning;

    if (!wasRunning && isGatewayRunning && !isConnected) {
      console.log('[ChatSection] Gateway just started — triggering immediate reconnect');
      reconnect();
    }
  }, [isGatewayRunning, isConnected, reconnect]);

  // Talk mode (speech-to-text / text-to-speech)
  const talkMode = useTalkMode();
  // Track which message was last spoken to avoid re-speaking during history reload races
  const lastSpokenIdRef = useRef<string | null>(null);

  // Handle image file selection
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Max 10MB
    if (file.size > 10 * 1024 * 1024) {
      alert(t('chat.imageTooLarge'));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
    // Reset the input so the same file can be re-selected
    e.target.value = '';
  };

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({
      behavior,
      block: 'end',
      inline: 'nearest'  // Prevent horizontal scrolling
    });
  };

  // Auto-scroll when messages change or streaming updates
  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingMessage]);

  // Auto-scroll to bottom on initial history load.
  // Double RAF ensures the browser has completed layout after messages render
  // before we attempt to scroll (avoids timing issues with display:none → flex).
  useEffect(() => {
    if (!isLoadingHistory && messages.length > 0) {
      const raf1 = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollToBottom('instant');
        });
      });
      return () => cancelAnimationFrame(raf1);
    }
  }, [isLoadingHistory]);

  // Turn off talk mode when navigating away from the chat page
  useEffect(() => {
    if (!isActive && talkMode.isActive) {
      talkMode.setActive(false);
    }
  }, [isActive]);

  // Scroll to bottom whenever the chat tab becomes visible.
  // ChatSection stays mounted (display:none) when navigating away, so React
  // effects don't re-fire on navigation — we need to watch isActive explicitly.
  useEffect(() => {
    if (isActive && !isLoadingHistory) {
      const raf1 = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollToBottom('instant');
        });
      });
      return () => cancelAnimationFrame(raf1);
    }
  }, [isActive]);

  // Timeout the loading spinner if we never connect (e.g. gateway not running).
  // Don't bail out immediately on connectionError — transient errors occur during
  // normal retry attempts even when the gateway is starting up.
  useEffect(() => {
    if (!isLoadingHistory || isConnected) return;
    const timer = setTimeout(() => {
      setIsLoadingHistory(false);
    }, 10_000);
    return () => clearTimeout(timer);
  }, [isLoadingHistory, isConnected]);

  // Load chat history on connect and when session changes
  useEffect(() => {
    if (!isConnected) return;

    const loadChatHistory = async () => {
      // Skip reload if we already have messages (avoids wiping history on reconnect)
      if (messages.length > 0) {
        setIsLoadingHistory(false);
        return;
      }

      setIsLoadingHistory(true);
      try {
        const history = await loadHistory(sessionKey, 100);
        setMessages(history);
      } catch (error) {
        console.error('[ChatSection] Failed to load history:', error);
      } finally {
        setIsLoadingHistory(false);
      }
    };

    loadChatHistory();
  }, [isConnected, loadHistory, sessionKey]);

  // Subscribe to chat events
  useEffect(() => {
    const unsubscribe = onChatEvent(async (event) => {
      if (event.state === 'delta') {
        const text = extractDisplayText(event.message);
        if (text) {
          // Always update the ref before scheduling RAF so the callback never reads
          // a stale value when multiple delta events land in the same animation frame.
          latestStreamingTextRef.current = text;
          setIsStreaming(true);
          if (rafIdRef.current === null) {
            rafIdRef.current = requestAnimationFrame(() => {
              setStreamingMessage(latestStreamingTextRef.current);
              rafIdRef.current = null;
            });
          }
          setCurrentRunId(event.runId || null);
          currentRunIdRef.current = event.runId || null;
        }
      } else if (event.state === 'final' || event.state === 'aborted') {
        // The gateway fires 'final' for EACH agent loop (one per LLM call), not just the last.
        // Tool-call-only loops produce event.message = undefined, so we reload history from
        // the session transcript (always up-to-date) rather than relying on the event payload.
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
        setIsStreaming(false);
        setStreamingMessage('');
        setCurrentRunId(null);
        currentRunIdRef.current = null;
        if (streamingTimeoutRef.current !== null) {
          clearTimeout(streamingTimeoutRef.current);
          streamingTimeoutRef.current = null;
        }

        try {
          const history = await loadHistory(sessionKey, 100);
          if (history.length > 0) {
            setMessages(history);
          } else if (event.message) {
            // History empty (likely a scope/auth issue on chat.history) — fall back to the
            // event payload which the gateway always includes for non-tool-only loops.
            console.warn('[ChatSection] History load returned empty, using event payload as fallback');
            const content = extractDisplayText(event.message);
            if (content) {
              setMessages(prev => [...prev, {
                id: (event.message as any).id || `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                role: (event.message as any).role || 'assistant',
                content,
                timestamp: (event.message as any).timestamp || Date.now()
              }]);
            }
          }
          // If both history and event.message are absent (tool-call-only loop), keep existing messages.
        } catch (error) {
          console.error('[ChatSection] Failed to reload history after final event:', error);
          if (event.message) {
            const content = extractDisplayText(event.message);
            setMessages(prev => [...prev, {
              id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              role: (event.message as any).role || 'assistant',
              content: content || t('chat.responseReceived'),
              timestamp: (event.message as any).timestamp || Date.now()
            }]);
          }
        }
      } else if (event.state === 'error') {
        console.error('[ChatSection] Chat error:', event.error, event.errorDetail);
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
        setIsStreaming(false);
        setStreamingMessage('');
        setCurrentRunId(null);
        currentRunIdRef.current = null;
        if (streamingTimeoutRef.current !== null) {
          clearTimeout(streamingTimeoutRef.current);
          streamingTimeoutRef.current = null;
        }

        const code = event.errorDetail?.code;
        if (code === 'quota_exceeded' || code === 'insufficient_tier') {
          setQuotaError(event.errorDetail!);
        } else if (code === 'rate_limit') {
          setRateLimitError(event.errorDetail?.message || t('chat.rateLimitReached', 'Rate limit reached. Please wait a moment before trying again.'));
        } else if (event.error) {
          // Generic error: inject into chat so the user isn't left with silence
          setMessages(prev => [...prev, {
            id: `err-${Date.now()}`,
            role: 'assistant' as const,
            content: event.error!,
            timestamp: Date.now()
          }]);
        }
      }
    });

    return unsubscribe;
  }, [onChatEvent, loadHistory, sessionKey]);

  // Auto-speak assistant replies when talk mode is active.
  // Track lastSpokenIdRef to avoid re-speaking a stale message during the
  // window between isStreaming→false and the async history reload completing.
  useEffect(() => {
    if (!talkMode.isActive || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role === 'assistant' && !isStreaming && last.id !== lastSpokenIdRef.current) {
      lastSpokenIdRef.current = last.id;
      talkMode.speak(last.content);
    }
  }, [messages.length, isStreaming]);

  // Talk mode: auto-send transcript as a message (hands-free conversation loop).
  // Watches pendingTranscript (set once per transcription, cleared after send) instead
  // of transcript (display-only) so the effect naturally fires once per speech input —
  // no ref-based dedup needed. isStreaming/isConnected in deps let it retry when those
  // conditions change (e.g. streaming ends while a pending transcript is waiting).
  useEffect(() => {
    if (!talkMode.isActive || !talkMode.pendingTranscript || talkMode.isListening) return;
    const messageContent = talkMode.pendingTranscript.trim();
    if (!messageContent || isStreaming || !isConnected) return;

    // Consume immediately — clears pendingTranscript so this effect won't re-fire
    // when isStreaming or other deps change.
    talkMode.clearPendingTranscript();

    const userMessage: Message = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'user',
      content: messageContent,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMessage]);
    setIsStreaming(true);

    sendMessage({ message: messageContent, sessionKey }).catch((err) => {
      console.error('[TalkMode] Auto-send failed:', err);
      setIsStreaming(false);
    });
  }, [talkMode.pendingTranscript, talkMode.isListening, talkMode.isActive, isStreaming, isConnected]);

  // Talk mode: auto-relisten after AI finishes speaking (continuous conversation loop).
  // Requires isConnected so the loop stops when disconnected (avoids recording →
  // transcribing → silently dropping speech in a cycle with no user feedback).
  useEffect(() => {
    if (talkMode.isActive && !talkMode.isSpeaking && !talkMode.isListening && !isStreaming && isConnected) {
      // Small delay before re-listening to avoid picking up TTS tail-end audio
      const timer = setTimeout(() => {
        if (talkMode.isActive) talkMode.startListening();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [talkMode.isSpeaking, talkMode.isActive, talkMode.isListening, isStreaming, isConnected]);

  // Non-talk-mode: populate input with transcript for manual send.
  // Uses pendingTranscript (consumed after use) so deactivating talk mode after
  // auto-send won't re-populate the textbox with already-sent text.
  useEffect(() => {
    if (!talkMode.isActive && talkMode.pendingTranscript && !talkMode.isListening) {
      setInputValue((prev) => (prev ? prev + ' ' : '') + talkMode.pendingTranscript);
      talkMode.clearPendingTranscript();
    }
  }, [talkMode.isListening, talkMode.isActive]);

  // Auto-resize textarea
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  };

  const handleSend = async () => {
    if ((!inputValue.trim() && !imagePreview) || isStreaming || !isConnected) {
      return;
    }
    if (isSendingRef.current) return;
    isSendingRef.current = true;

    const messageContent = inputValue.trim() || (imagePreview ? 'Describe this image.' : '');

    // For local display, show image as markdown so MessageBubble renders it inline
    const displayContent = imagePreview
      ? (messageContent !== 'Describe this image.'
          ? `![image](${imagePreview})\n\n${messageContent}`
          : `![image](${imagePreview})`)
      : messageContent;

    // Build attachments array for the gateway's native image support
    const attachments: { mimeType: string; content: string }[] = [];
    if (imagePreview) {
      // Parse data URI: "data:image/png;base64,AAAA..."
      const match = imagePreview.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (match) {
        attachments.push({ mimeType: match[1], content: match[2] });
      } else {
        // Raw base64 without prefix
        attachments.push({ mimeType: 'image/png', content: imagePreview });
      }
    }

    const userMessage: Message = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'user',
      content: displayContent,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setImagePreview(null);
    setIsStreaming(true);
    isSendingRef.current = false;

    // 150s client-side watchdog: if the gateway never responds, abort and surface an error
    if (streamingTimeoutRef.current !== null) {
      clearTimeout(streamingTimeoutRef.current);
    }
    streamingTimeoutRef.current = setTimeout(async () => {
      streamingTimeoutRef.current = null;
      const runId = currentRunIdRef.current;
      if (runId) {
        try { await abortRun(runId, sessionKey); } catch (e) {
          console.error('[ChatSection] Watchdog abort failed:', e);
        }
      }
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      setIsStreaming(false);
      setStreamingMessage('');
      setCurrentRunId(null);
      currentRunIdRef.current = null;
      setMessages(prev => [...prev, {
        id: `timeout-${Date.now()}`,
        role: 'assistant' as const,
        content: t('chat.requestTimeout'),
        timestamp: Date.now()
      }]);
    }, 150_000);

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      await sendMessage({
        message: messageContent,
        sessionKey,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
    } catch (error) {
      console.error('[ChatSection] Failed to send message:', error);
      if (streamingTimeoutRef.current !== null) {
        clearTimeout(streamingTimeoutRef.current);
        streamingTimeoutRef.current = null;
      }
      setIsStreaming(false);
      isSendingRef.current = false;
    }
  };

  const handleAbort = async () => {
    if (currentRunId) {
      try {
        await abortRun(currentRunId, sessionKey);
      } catch (error) {
        console.error('[ChatSection] Failed to abort:', error);
      }
    }
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    setIsStreaming(false);
    setStreamingMessage('');
    setCurrentRunId(null);
    currentRunIdRef.current = null;
    if (streamingTimeoutRef.current !== null) {
      clearTimeout(streamingTimeoutRef.current);
      streamingTimeoutRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full relative" style={{ backgroundColor: colors.background.primary }}>
      {/* Header */}
      <div
        className="flex-shrink-0 px-6 py-4 border-b flex items-center gap-3"
        style={{
          borderColor: colors.background.modifier.hover,
          backgroundColor: colors.background.secondary
        }}
      >
        <h2 className="text-lg font-bold" style={{ color: colors.text.header }}>
          {t('chat.title')}
        </h2>
        <p className="text-sm" style={{ color: colors.text.muted }}>
          {t('chat.subtitle')}
        </p>

        {/* Connection Status */}
        <div className="flex items-center space-x-2 ml-auto">
          {!isConnected && (
            <>
              <div className="flex items-center space-x-2 px-3 py-1.5 rounded-lg" style={{ backgroundColor: colors.background.tertiary }}>
                <WifiOff className="h-4 w-4" style={{ color: '#f87171' }} />
                <span className="text-sm" style={{ color: colors.text.muted }}>
                  {t('common.disconnected')}
                </span>
              </div>
              <button
                onClick={reconnect}
                className="px-3 py-1.5 rounded-lg flex items-center space-x-2 transition-colors"
                style={{ backgroundColor: colors.accent.brand, color: '#ffffff' }}
              >
                <RefreshCw className="h-4 w-4" />
                <span className="text-sm">{t('common.reconnect')}</span>
              </button>
            </>
          )}
          {isConnected && (
            <div className="flex items-center space-x-2 px-3 py-1.5 rounded-lg" style={{ backgroundColor: colors.background.tertiary }}>
              <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-sm" style={{ color: colors.text.muted }}>
                {t('common.connected')}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Messages Area - Scrollable */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-4 space-y-4">
        {isLoadingHistory ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3" style={{ color: colors.text.muted }} />
              <p className="text-sm" style={{ color: colors.text.muted }}>
                {t('chat.loadingHistory')}
              </p>
            </div>
          </div>
        ) : !isConnected && connectionError ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-lg px-6">
              <div className="text-5xl mb-4">⚠️</div>
              <h3 className="text-xl font-bold mb-3" style={{ color: colors.text.header }}>
                {t('chat.gatewayNotRunning')}
              </h3>
              <div className="space-y-3 text-sm" style={{ color: colors.text.muted }}>
                <p>
                  {t('chat.gatewayNeeded')}
                </p>
                <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-4 mt-4">
                  <p className="font-medium mb-2" style={{ color: '#60a5fa' }}>
                    {t('chat.toStartGateway')}
                  </p>
                  <div className="text-left text-sm" style={{ color: colors.text.muted }}>
                    <p>{t('chat.goToSidebar')}</p>
                  </div>
                </div>
                <p className="text-xs mt-4 opacity-70">
                  {t('chat.separateGateway')}
                </p>
              </div>
            </div>
          </div>
        ) : messages.length === 0 && !isStreaming ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md">
              <div className="text-4xl mb-4">💬</div>
              <h3 className="text-lg font-semibold mb-2" style={{ color: colors.text.header }}>
                {t('chat.startConversation')}
              </h3>
              <p className="text-sm" style={{ color: colors.text.muted }}>
                {t('chat.typeBelow')}
              </p>
            </div>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                role={message.role}
                content={message.content}
                timestamp={message.timestamp}
                colors={colors}
              />
            ))}

            {/* Streaming Indicator */}
            {isStreaming && (
              <StreamingIndicator
                text={streamingMessage}
                colors={colors}
              />
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Rate Limit Banner */}
      {rateLimitError && (
        <div
          className="flex-shrink-0 flex items-center justify-between px-4 py-2 text-sm"
          style={{ backgroundColor: '#78350f20', borderTop: '1px solid #d9770660', color: '#fbbf24' }}
        >
          <span>⚠️ {rateLimitError}</span>
          <button onClick={() => setRateLimitError(null)} className="ml-3 opacity-70 hover:opacity-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Talk Mode Overlay */}
      {talkMode.isActive && (
        <TalkModeOverlay
          colors={colors}
          isListening={talkMode.isListening}
          transcript={talkMode.transcript}
          isSpeaking={talkMode.isSpeaking}
          isStreaming={isStreaming}
          error={talkMode.error}
          onToggleListening={() => {
            if (talkMode.isListening) talkMode.stopListening();
            else talkMode.startListening();
          }}
          onClose={() => talkMode.setActive(false)}
          onGoToVoiceSettings={onGoToVoiceSettings}
        />
      )}

      {/* Image preview */}
      {imagePreview && (
        <div
          className="flex-shrink-0 px-6 py-2 border-t flex items-center gap-2"
          style={{ borderColor: colors.background.modifier.hover, backgroundColor: colors.background.secondary }}
        >
          <div className="relative inline-block">
            <img
              src={imagePreview}
              alt="Preview"
              className="h-16 rounded-lg object-cover"
            />
            <button
              onClick={() => setImagePreview(null)}
              className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-red-500 text-white"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <span className="text-xs" style={{ color: colors.text.muted }}>{t('chat.imageAttached')}</span>
        </div>
      )}

      {/* Input Area - Fixed at bottom */}
      <div
        className="flex-shrink-0 px-6 py-4 border-t"
        style={{
          borderColor: colors.background.modifier.hover,
          backgroundColor: colors.background.secondary
        }}
      >
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={handleImageSelect}
        />

        <div className="flex items-end space-x-3">
          {/* Image upload button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming || !isConnected}
            className="p-3 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              backgroundColor: colors.background.primary,
              color: colors.text.muted,
              height: '56px',
            }}
            title={t('chat.attachImage')}
          >
            <ImagePlus className="h-5 w-5" />
          </button>

          <div className="flex-1">
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder={
                isConnected
                  ? t('chat.placeholder')
                  : t('chat.connectingPlaceholder')
              }
              disabled={isStreaming || !isConnected}
              className="w-full px-4 py-3 rounded-lg resize-none focus:outline-none focus:ring-2 transition-colors"
              style={{
                backgroundColor: colors.background.primary,
                color: colors.text.normal,
                borderColor: colors.background.modifier.hover,
                minHeight: '56px',
                maxHeight: '200px'
              }}
              rows={1}
            />
          </div>

          {/* Talk mode toggle */}
          {talkMode.isSupported && (
            <button
              onClick={() => talkMode.setActive(!talkMode.isActive)}
              disabled={isStreaming}
              className="p-3 rounded-lg transition-colors disabled:opacity-40"
              style={{
                backgroundColor: talkMode.isActive ? colors.accent.brand : colors.background.primary,
                color: talkMode.isActive ? '#ffffff' : colors.text.muted,
                height: '56px',
              }}
              title={talkMode.isActive ? t('chat.disableTalkMode') : t('chat.enableTalkMode')}
            >
              <Mic className="h-5 w-5" />
            </button>
          )}

          {isStreaming ? (
            <button
              onClick={handleAbort}
              className="px-6 py-3 rounded-lg font-medium transition-all flex items-center space-x-2"
              style={{
                backgroundColor: '#f87171',
                color: '#ffffff',
                height: '56px'
              }}
            >
              <StopCircle className="h-5 w-5" />
              <span>{t('chat.stop')}</span>
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={(!inputValue.trim() && !imagePreview) || !isConnected}
              className="px-6 py-3 rounded-lg font-medium transition-all flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                backgroundColor: colors.accent.brand,
                color: '#ffffff',
                height: '56px'
              }}
            >
              <Send className="h-5 w-5" />
              <span>{t('chat.send')}</span>
            </button>
          )}
        </div>
        <p className="text-xs mt-2" style={{ color: colors.text.muted }}>
          {t('chat.sendShortcut')}
        </p>
      </div>

      {/* Exec Approval Overlay */}
      {execApprovalQueue.length > 0 && (
        <ExecApprovalOverlay
          queue={execApprovalQueue}
          busy={execApprovalBusy}
          error={execApprovalError}
          colors={colors}
          onDecision={resolveExecApproval}
        />
      )}

      {/* Quota / Tier Upgrade Modal */}
      {quotaError && (
        <div className="absolute inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <div
            className="relative rounded-xl shadow-2xl p-8 max-w-md w-full mx-4"
            style={{ backgroundColor: colors.background.secondary }}
          >
            <button
              onClick={() => setQuotaError(null)}
              className="absolute top-4 right-4 opacity-60 hover:opacity-100"
              style={{ color: colors.text.muted }}
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg" style={{ backgroundColor: '#f59e0b20' }}>
                <Zap className="h-6 w-6" style={{ color: '#f59e0b' }} />
              </div>
              <h3 className="text-lg font-bold" style={{ color: colors.text.header }}>
                {quotaError.code === 'insufficient_tier' ? t('chat.planUpgradeRequired') : t('chat.usageLimitReached')}
              </h3>
            </div>

            <p className="text-sm mb-4" style={{ color: colors.text.normal }}>
              {quotaError.message || 'You have reached your token limit for this period.'}
            </p>

            {quotaError.usage && (
              <div
                className="rounded-lg p-4 mb-4 text-sm space-y-1"
                style={{ backgroundColor: colors.background.tertiary, color: colors.text.muted }}
              >
                {quotaError.usage.daily !== undefined && (
                  <div className="flex justify-between">
                    <span>{t('chat.dailyUsage')}</span>
                    <span style={{ color: colors.text.normal }}>{quotaError.usage.daily.toLocaleString()} tokens</span>
                  </div>
                )}
                {quotaError.usage.weekly !== undefined && (
                  <div className="flex justify-between">
                    <span>{t('chat.weeklyUsage')}</span>
                    <span style={{ color: colors.text.normal }}>{quotaError.usage.weekly.toLocaleString()} tokens</span>
                  </div>
                )}
                {quotaError.usage.monthly !== undefined && (
                  <div className="flex justify-between">
                    <span>{t('chat.monthlyUsage')}</span>
                    <span style={{ color: colors.text.normal }}>{quotaError.usage.monthly.toLocaleString()} tokens</span>
                  </div>
                )}
              </div>
            )}

            <p className="text-sm mb-6" style={{ color: colors.text.muted }}>
              {t('chat.upgradeMessage')}
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setQuotaError(null);
                  if (onUpgrade) {
                    onUpgrade();
                  } else {
                    window.electronAPI?.openExternal?.('https://openclaw-easy.com/pricing');
                  }
                }}
                className="flex-1 py-2.5 rounded-lg font-semibold text-sm transition-colors"
                style={{ backgroundColor: colors.accent.brand, color: '#ffffff' }}
              >
                {t('chat.upgradePlan')}
              </button>
              <button
                onClick={() => setQuotaError(null)}
                className="flex-1 py-2.5 rounded-lg font-medium text-sm transition-colors"
                style={{ backgroundColor: colors.background.tertiary, color: colors.text.normal }}
              >
                {t('common.dismiss')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Custom comparison function for memo to prevent re-renders from color object reference changes
const arePropsEqual = (prevProps: ChatSectionProps, nextProps: ChatSectionProps) => {
  // Compare primitive props
  if (
    prevProps.sessionKey !== nextProps.sessionKey ||
    prevProps.gatewayPort !== nextProps.gatewayPort ||
    prevProps.isGatewayRunning !== nextProps.isGatewayRunning ||
    prevProps.isActive !== nextProps.isActive ||
    prevProps.onUpgrade !== nextProps.onUpgrade
  ) {
    return false;
  }

  // Deep compare colors object
  const prevColors = prevProps.colors;
  const nextColors = nextProps.colors;

  return (
    prevColors.background.primary === nextColors.background.primary &&
    prevColors.background.secondary === nextColors.background.secondary &&
    prevColors.background.tertiary === nextColors.background.tertiary &&
    prevColors.background.modifier.hover === nextColors.background.modifier.hover &&
    prevColors.background.modifier.active === nextColors.background.modifier.active &&
    prevColors.background.modifier.selected === nextColors.background.modifier.selected &&
    prevColors.text.normal === nextColors.text.normal &&
    prevColors.text.muted === nextColors.text.muted &&
    prevColors.text.header === nextColors.text.header &&
    prevColors.accent.brand === nextColors.accent.brand &&
    prevColors.accent.green === nextColors.accent.green &&
    prevColors.accent.userBubble === nextColors.accent.userBubble
  );
};

// Wrap with memo and custom comparison to prevent unnecessary re-renders
export const ChatSection = memo(ChatSectionComponent, arePropsEqual);
