import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Loader2, StopCircle, WifiOff, RefreshCw, X, Zap, ImagePlus, Mic } from 'lucide-react';
import { useChatConnection, extractDisplayText, BackendError } from '../../../hooks/useChatConnection';
import { nextMessageKey } from '../../../hooks/messageKey';
import { MessageBubble } from '../../chat/MessageBubble';
import { StreamingIndicator } from '../../chat/StreamingIndicator';
import { TalkModeOverlay } from '../../chat/TalkModeOverlay';
import { ExecApprovalOverlay } from '../../chat/ExecApprovalOverlay';
import { MascotIllustration } from '../../ui/mascot-illustration';
import { useTalkMode } from '../../../hooks/useTalkMode';
import {
  DEFAULT_GATEWAY_PORT,
  MAX_CHAT_MESSAGE_LENGTH,
  CHAT_MESSAGE_COUNTER_THRESHOLD,
} from '../../../../shared/constants';

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
    red: string;
    yellow: string;
    blue: string;
    userBubble: string;
  };
  button: {
    primary: string;
    primaryFg: string;
    destructive: string;
    destructiveFg: string;
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
  // Shown when the gateway hasn't sent a delta within 30s of send (H4).
  // Lets the user know the request is in-flight but slow, instead of
  // staring at a frozen spinner. Cleared on any delta or terminal event.
  const [isResponseDelayed, setIsResponseDelayed] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rafIdRef = useRef<number | null>(null);
  // Tracks the latest streaming text so the RAF callback never reads a stale closure value
  const latestStreamingTextRef = useRef<string>('');
  // 60s client-side watchdog — cleared when the gateway sends final/error/aborted
  const streamingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 30s "response delayed" banner timer — paired with the 60s abort watchdog.
  const streamingDelayedRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref mirror of currentRunId for the timeout callback (avoids stale closure)
  const currentRunIdRef = useRef<string | null>(null);
  // Guard against double-send from rapid clicks (state update may not flush between clicks)
  const isSendingRef = useRef(false);

  /**
   * Clear all streaming-related state in one place: flag, in-progress
   * text, run id, both watchdog timers, RAF frame, and the "delayed"
   * banner. Bundling these prevents the bug class where a future code
   * path forgets one piece — e.g. clears isStreaming but leaves the
   * 90s watchdog armed, firing later as a "request timeout" message
   * for a message that already completed. Six call sites in this
   * component used to inline this sequence; they now all go through
   * this helper.
   */
  const stopStreamingState = useCallback(() => {
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
    if (streamingDelayedRef.current !== null) {
      clearTimeout(streamingDelayedRef.current);
      streamingDelayedRef.current = null;
    }
    setIsResponseDelayed(false);
  }, []);

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
        // Same as useChatConnection: a disconnect during an in-flight
        // history request is expected teardown noise, not a fault.
        if (error instanceof Error && /disconnect/i.test(error.message)) {
          console.debug('[ChatSection] History load aborted: connection closed');
        } else {
          console.error('[ChatSection] Failed to load history:', error);
        }
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
          // First delta arrived — cancel the "response delayed" banner.
          if (streamingDelayedRef.current !== null) {
            clearTimeout(streamingDelayedRef.current);
            streamingDelayedRef.current = null;
          }
          setIsResponseDelayed(false);
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
        stopStreamingState();

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
                id: nextMessageKey('msg', (event.message as any).id),
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
              id: nextMessageKey('msg', (event.message as any).id),
              role: (event.message as any).role || 'assistant',
              content: content || t('chat.responseReceived'),
              timestamp: (event.message as any).timestamp || Date.now()
            }]);
          }
        }
      } else if (event.state === 'error') {
        console.error('[ChatSection] Chat error:', event.error, event.errorDetail);
        stopStreamingState();

        const code = event.errorDetail?.code;
        if (code === 'quota_exceeded' || code === 'insufficient_tier') {
          setQuotaError(event.errorDetail!);
        } else if (code === 'rate_limit') {
          setRateLimitError(event.errorDetail?.message || t('chat.rateLimitReached', 'Rate limit reached. Please wait a moment before trying again.'));
        } else if (event.error) {
          // Generic error: inject into chat so the user isn't left with silence.
          // Prefer the structured message (errorDetail.message) so the bubble
          // shows a readable sentence — without this, event.error is the raw
          // stringified backend JSON (e.g. `{"error":{"message":"Bedrock
          // rejected the request for model 'us.meta.llama4-...': Access to
          // Meta Llama models is not allowed..."}}`), which leaks the
          // envelope into the chat UI. Fall back to event.error only when
          // the gateway sent an unparseable plain string.
          const display = event.errorDetail?.message || event.error!;
          setMessages(prev => [...prev, {
            id: nextMessageKey('err'),
            role: 'assistant' as const,
            content: display,
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
      id: nextMessageKey('usr'),
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

    // Guard against oversized input — the textarea's `maxLength` handles
    // typing, but paste / scripted input can bypass it. The backend will
    // reject with 400 either way; catching it here gives the user a
    // friendlier message and avoids the round-trip + the gateway's
    // billing-failure cooldown if the model is cloud-priced.
    if (inputValue.length > MAX_CHAT_MESSAGE_LENGTH) {
      setRateLimitError(
        t('chat.messageTooLong', `Message too long. Maximum ${MAX_CHAT_MESSAGE_LENGTH} characters.`),
      );
      return;
    }

    isSendingRef.current = true;

    const defaultImageCaption = t('chat.defaultImageCaption', 'Describe this image.');
    const messageContent = inputValue.trim() || (imagePreview ? defaultImageCaption : '');

    // For local display, show image as markdown so MessageBubble renders it inline
    const displayContent = imagePreview
      ? (messageContent !== defaultImageCaption
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
      id: nextMessageKey('usr'),
      role: 'user',
      content: displayContent,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setImagePreview(null);
    setIsStreaming(true);
    // H1 fix: don't release isSendingRef until the send Promise settles.
    // Previously this was set to false here (before await sendMessage),
    // creating a ~5ms-to-30s race window where a second click could pass
    // both isSendingRef and isStreaming guards (isStreaming is only async
    // updated after React flushes). Now released in the finally below.
    setIsResponseDelayed(false);

    // Watchdog timers — both cleared on event(final|aborted|error).
    //   • delayed   : 25s — show "Response delayed…" banner just before
    //                 the 29s API Gateway integration-timeout wall fires.
    //                 The cloud backend uses REST API + Lambda Proxy
    //                 integration; API Gateway hard-caps at 29s so any
    //                 in-flight request either returns or 504s by ~30s.
    //                 A banner at 25s tells the user "this is slow" right
    //                 before the response/error arrives — values past
    //                 30s would never fire in normal operation.
    //   • timeout   : 60s — abort the run if BOTH backend response and
    //                 API Gateway 504 fail to arrive. This is a "WS link
    //                 between desktop and openclaw gateway is genuinely
    //                 stuck" detector, not a "model is slow" one (the
    //                 29s wall handles that). 60s gives plenty of slack
    //                 for the gateway to forward the 504 to us before we
    //                 declare the connection dead.
    if (streamingTimeoutRef.current !== null) {
      clearTimeout(streamingTimeoutRef.current);
    }
    if (streamingDelayedRef.current !== null) {
      clearTimeout(streamingDelayedRef.current);
    }
    streamingDelayedRef.current = setTimeout(() => {
      streamingDelayedRef.current = null;
      setIsResponseDelayed(true);
    }, 25_000);
    streamingTimeoutRef.current = setTimeout(async () => {
      streamingTimeoutRef.current = null;
      const runId = currentRunIdRef.current;
      if (runId) {
        try { await abortRun(runId, sessionKey); } catch (e) {
          console.error('[ChatSection] Watchdog abort failed:', e);
        }
      }
      stopStreamingState();
      setMessages(prev => [...prev, {
        id: nextMessageKey('timeout'),
        role: 'assistant' as const,
        content: t('chat.requestTimeout'),
        timestamp: Date.now()
      }]);
    }, 60_000);

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
      stopStreamingState();
    } finally {
      // Release the send guard only AFTER the Promise settles. Multiple
      // rapid clicks now serialize through this guard correctly.
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
    stopStreamingState();
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
        <h2 className="font-display text-lg font-bold tracking-tight" style={{ color: colors.text.header }}>
          {t('chat.title')}
        </h2>
        <p className="text-sm" style={{ color: colors.text.muted }}>
          {t('chat.subtitle')}
        </p>

        {/* Connection Status — tinted pills so state reads at a glance
            without parsing text: green wash = live, red wash = down. */}
        <div className="flex items-center space-x-2 ml-auto">
          {!isConnected && (
            <>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/10 ring-1 ring-red-500/20">
                <WifiOff className="h-3.5 w-3.5 text-red-500" />
                <span className="text-xs font-medium text-red-600 dark:text-red-400">
                  {t('common.disconnected')}
                </span>
              </div>
              <button
                onClick={reconnect}
                className="press-pulse px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-[filter] hover:brightness-105 active:brightness-95"
                style={{ backgroundColor: colors.accent.brand, color: colors.button.primaryFg }}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span className="text-xs font-medium">{t('common.reconnect')}</span>
              </button>
            </>
          )}
          {isConnected && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/10 ring-1 ring-green-500/20">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-40" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
              <span className="text-xs font-medium text-green-700 dark:text-green-400">
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
                <div
                  className="rounded-lg p-4 mt-4"
                  style={{ backgroundColor: colors.accent.blue + '20', border: `1px solid ${colors.accent.blue}55` }}
                >
                  <p className="font-medium mb-2" style={{ color: colors.accent.blue }}>
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
            <div className="text-center max-w-md animate-fade-up">
              <div className="flex justify-center mb-5">
                <MascotIllustration size={72} mood="waving" />
              </div>
              <h3 className="font-display text-lg font-semibold mb-2" style={{ color: colors.text.header }}>
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

      {/* Response Delayed Banner — fires at 30s of streaming silence
          to reassure the user the request is in-flight. Auto-clears on
          first delta or any terminal event; abort watchdog still hits at 60s. */}
      {isResponseDelayed && isStreaming && (
        <div
          className="flex-shrink-0 flex items-center px-4 py-2 text-sm gap-2"
          style={{ backgroundColor: 'rgba(59, 130, 246, 0.10)', borderTop: '1px solid rgba(59, 130, 246, 0.35)', color: colors.text.normal }}
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" aria-hidden="true" />
          <span>{t('chat.responseDelayed', 'Response is taking longer than usual…')}</span>
        </div>
      )}

      {/* Rate Limit Banner */}
      {rateLimitError && (
        <div
          className="flex-shrink-0 flex items-center justify-between px-4 py-2 text-sm"
          style={{ backgroundColor: colors.accent.yellow + '20', borderTop: `1px solid ${colors.accent.yellow}60`, color: colors.accent.yellow }}
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
              className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full text-white"
              style={{ backgroundColor: colors.accent.red }}
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

          <div className="flex-1 relative">
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
              // Hard cap at the same limit the backend enforces — keeps a
              // wall-of-text from being typed AT ALL (paste still bypasses
              // this, which is why handleSend re-checks). See
              // shared/messageContent.ts on the backend for rationale.
              maxLength={MAX_CHAT_MESSAGE_LENGTH}
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
            {/* Character counter — hidden until the user is within
                CHAT_MESSAGE_COUNTER_THRESHOLD of the cap so the input UI
                stays quiet for normal messages. Turns red at the limit. */}
            {MAX_CHAT_MESSAGE_LENGTH - inputValue.length <= CHAT_MESSAGE_COUNTER_THRESHOLD && (
              <div
                className="absolute bottom-1 right-3 text-xs pointer-events-none select-none tabular-nums"
                style={{
                  color: inputValue.length >= MAX_CHAT_MESSAGE_LENGTH
                    ? colors.accent.brand
                    : colors.text.muted,
                }}
                aria-live="polite"
                aria-label={t('chat.charactersRemaining', {
                  remaining: MAX_CHAT_MESSAGE_LENGTH - inputValue.length,
                  defaultValue: `${MAX_CHAT_MESSAGE_LENGTH - inputValue.length} characters remaining`,
                })}
              >
                {inputValue.length} / {MAX_CHAT_MESSAGE_LENGTH}
              </div>
            )}
          </div>

          {/* Talk mode toggle */}
          {talkMode.isSupported && (
            <button
              onClick={() => talkMode.setActive(!talkMode.isActive)}
              disabled={isStreaming}
              className="p-3 rounded-lg transition-colors disabled:opacity-40"
              style={{
                backgroundColor: talkMode.isActive ? colors.accent.brand : colors.background.primary,
                color: talkMode.isActive ? colors.button.primaryFg : colors.text.muted,
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
                backgroundColor: colors.button.destructive,
                color: colors.button.destructiveFg,
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
                color: colors.button.primaryFg,
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
              <div className="p-2 rounded-lg" style={{ backgroundColor: colors.accent.yellow + '20' }}>
                <Zap className="h-6 w-6" style={{ color: colors.accent.yellow }} />
              </div>
              <h3 className="font-display text-lg font-bold tracking-tight" style={{ color: colors.text.header }}>
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
                style={{ backgroundColor: colors.accent.brand, color: colors.button.primaryFg }}
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
