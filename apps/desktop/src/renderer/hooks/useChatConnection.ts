import { useState, useEffect, useCallback, useRef } from 'react';
import {
  type ExecApprovalRequest,
  type ExecApprovalDecision,
  parseExecApprovalRequested,
  parseExecApprovalResolved,
  addExecApproval,
  removeExecApproval,
} from './useExecApproval';


interface ChatAttachment {
  type?: string;
  mimeType?: string;
  fileName?: string;
  content: string; // base64 string (with or without data URI prefix)
}

interface ChatSendParams {
  message: string;
  sessionKey?: string;
  attachments?: ChatAttachment[];
}

export interface BackendError {
  message: string;
  type?: string;
  code?: 'quota_exceeded' | 'rate_limit' | 'insufficient_tier' | 'model_not_enabled' | string;
  usage?: {
    daily?: number;
    weekly?: number;
    monthly?: number;
  };
}

interface ChatEvent {
  state: 'delta' | 'final' | 'aborted' | 'error';
  text?: string;
  message?: any;
  error?: string;
  errorDetail?: BackendError;
  runId?: string;
}

interface NormalizedMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: any;
}

interface ChatConnection {
  isConnected: boolean;
  connectionError: string | null;
  sendMessage: (params: ChatSendParams) => Promise<void>;
  loadHistory: (sessionKey?: string, limit?: number) => Promise<NormalizedMessage[]>;
  abortRun: (runId: string, sessionKey?: string) => Promise<void>;
  onChatEvent: (handler: (event: ChatEvent) => void | Promise<void>) => () => void;
  connect: () => Promise<void>;
  reconnect: () => Promise<void>;
  disconnect: () => void;
  execApprovalQueue: ExecApprovalRequest[];
  execApprovalBusy: boolean;
  execApprovalError: string | null;
  resolveExecApproval: (id: string, decision: ExecApprovalDecision) => Promise<void>;
}

// No hard cap — keep retrying with exponential backoff (capped at 30s).
// The gateway may start at any time; giving up permanently is the #1 cause
// of "gateway not running" when the gateway IS actually running.

export function useChatConnection(gatewayPort: number = 18800): ChatConnection {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [execApprovalQueue, setExecApprovalQueue] = useState<ExecApprovalRequest[]>([]);
  const [execApprovalBusy, setExecApprovalBusy] = useState(false);
  const [execApprovalError, setExecApprovalError] = useState<string | null>(null);
  const execApprovalTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const retryCountRef = useRef(0);
  const shouldReconnectRef = useRef(true);
  const pendingRequestsRef = useRef<Map<string, { resolve: any; reject: any }>>(new Map());
  const chatEventHandlersRef = useRef<Set<(event: ChatEvent) => void | Promise<void>>>(new Set());
  const requestIdCounter = useRef(0);
  const isHandshakeCompleteRef = useRef(false);
  const pendingHandshakeRequestsRef = useRef<Array<() => void>>([]);
  const cleanupTimerRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);

  const generateRequestId = useCallback(() => {
    return `req_${Date.now()}_${++requestIdCounter.current}`;
  }, []);

  const sendRequest = useCallback((method: string, params: any): Promise<any> => {
    return new Promise((resolve, reject) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const executeRequest = () => {
        const id = generateRequestId();
        pendingRequestsRef.current.set(id, { resolve, reject });

        try {
          wsRef.current!.send(JSON.stringify({
            type: 'req',
            id,
            method,
            params
          }));
        } catch (error) {
          pendingRequestsRef.current.delete(id);
          reject(error);
        }

        // Timeout after 30 seconds
        setTimeout(() => {
          if (pendingRequestsRef.current.has(id)) {
            pendingRequestsRef.current.delete(id);
            reject(new Error('Request timeout'));
          }
        }, 30000);
      };

      // Queue request if handshake not complete (unless it's the connect request itself)
      if (!isHandshakeCompleteRef.current && method !== 'connect') {
        console.log('[ChatConnection] Queueing request until handshake completes:', method);
        pendingHandshakeRequestsRef.current.push(executeRequest);
      } else {
        executeRequest();
      }
    });
  }, [generateRequestId]);

  const connect = useCallback(async () => {
    // Don't create new connection if already connecting or connected
    if (wsRef.current &&
        (wsRef.current.readyState === WebSocket.OPEN ||
         wsRef.current.readyState === WebSocket.CONNECTING)) {
      console.log('[ChatConnection] Already connecting or connected, skipping...');
      return;
    }

    // Enable reconnection when manually connecting
    shouldReconnectRef.current = true;

    // Fetch the active gateway port dynamically so we always connect to
    // whichever port the process manager actually claimed (18800-18809).
    let currentPort = gatewayPort;
    try {
      const fetchedPort = await (window as any).electronAPI?.getGatewayPort?.();
      if (fetchedPort && fetchedPort > 0) {
        currentPort = fetchedPort;
      }
    } catch {
      // fall back to prop value
    }

    try {
      console.log(`[ChatConnection] Connecting to ws://localhost:${currentPort}/`);
      const ws = new WebSocket(`ws://localhost:${currentPort}/`);

      // Set wsRef immediately so sendRequest can use it
      wsRef.current = ws;

      ws.onopen = async () => {
        console.log('[ChatConnection] Connected to OpenClaw Gateway, starting handshake...');
        isHandshakeCompleteRef.current = false;

        // Wait for connect.challenge event, then send connect request
        // The actual connect will be triggered by the connect.challenge event handler
      };

      ws.onmessage = async (event) => {
        try {
          const frame = JSON.parse(event.data);
          console.log('[ChatConnection] Received frame:', frame);

          if (frame.type === 'event' && frame.event === 'connect.challenge') {
            // Handle connect challenge - send connect request
            console.log('[ChatConnection] Received connect challenge:', frame.payload);
            try {
              const nonce = frame.payload?.nonce;

              // Get gateway auth token from Electron main process
              let authToken: string | undefined;
              if (window.electronAPI?.getGatewayToken) {
                try {
                  authToken = await window.electronAPI.getGatewayToken();
                  console.log('[ChatConnection] Retrieved gateway token:', authToken ? '[PRESENT]' : 'null');
                } catch (error) {
                  console.warn('[ChatConnection] Failed to get gateway token:', error);
                }
              } else {
                console.warn('[ChatConnection] getGatewayToken API not available');
              }

              const clientId = 'webchat';
              const clientMode = 'webchat';
              const scopes = ['operator.read', 'operator.write', 'operator.admin', 'operator.approvals', 'operator.pairing'];

              // Build Ed25519 device identity via main process (Node.js crypto, required for scope grants)
              let device_identity: object | undefined;
              try {
                if (window.electronAPI?.buildDeviceIdentity) {
                  device_identity = await window.electronAPI.buildDeviceIdentity({
                    clientId,
                    clientMode,
                    role: 'operator',
                    scopes,
                    token: authToken || '',
                    nonce: nonce || ''
                  });
                  if (device_identity) {
                    console.log('[ChatConnection] Device identity ready, deviceId:', (device_identity as any).id?.slice(0, 16) + '...');
                  } else {
                    console.warn('[ChatConnection] buildDeviceIdentity returned null');
                  }
                } else {
                  console.warn('[ChatConnection] buildDeviceIdentity API not available');
                }
              } catch (err) {
                console.error('[ChatConnection] Failed to build device identity (will proceed without it):', err);
              }

              // Guard: if this WebSocket was replaced while we awaited async IPC calls
              // (getGatewayToken + buildDeviceIdentity), the nonce we signed is no longer
              // valid for the current connection. Sending it would cause device-nonce-mismatch
              // on the gateway. Abort silently — the new connection's onmessage handler will
              // run its own challenge/response with the correct nonce.
              if (wsRef.current !== ws) {
                console.warn('[ChatConnection] WS replaced during handshake async setup — aborting stale nonce, new connection will handle its own challenge');
                return;
              }

              const connectParams = {
                minProtocol: 3,
                maxProtocol: 3,
                client: {
                  id: clientId,
                  version: '1.0.0',
                  platform: typeof navigator !== 'undefined' ? navigator.platform : 'electron',
                  mode: clientMode,
                  instanceId: `desktop-${Date.now()}`
                },
                role: 'operator',
                scopes,
                caps: [],
                auth: authToken ? { token: authToken, password: authToken } : undefined,
                device: device_identity,
                userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Openclaw-Desktop/1.0.0',
                locale: typeof navigator !== 'undefined' ? navigator.language : 'en-US'
              };
              console.log('[ChatConnection] Sending connect with auth:', connectParams.auth ? 'token present' : 'no auth', '| device:', !!device_identity);
              await sendRequest('connect', connectParams);
              console.log('[ChatConnection] Handshake complete');
              isHandshakeCompleteRef.current = true;
              setIsConnected(true);
              setConnectionError(null);
              retryCountRef.current = 0;

              // Start heartbeat ping every 30s
              if (heartbeatRef.current) clearInterval(heartbeatRef.current);
              heartbeatRef.current = setInterval(() => {
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                  const pingId = `ping_${Date.now()}`;
                  const pongTimeout = setTimeout(() => {
                    // No response within 5s — close and let reconnect handle it
                    console.warn('[ChatConnection] Heartbeat pong timeout — closing socket');
                    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
                    wsRef.current?.close();
                  }, 5000);

                  pendingRequestsRef.current.set(pingId, {
                    resolve: () => clearTimeout(pongTimeout),
                    reject: () => clearTimeout(pongTimeout),
                  });

                  try {
                    wsRef.current.send(JSON.stringify({ type: 'req', id: pingId, method: 'ping', params: {} }));
                  } catch {
                    clearTimeout(pongTimeout);
                    pendingRequestsRef.current.delete(pingId);
                  }
                }
              }, 30000);

              // Execute queued requests
              const queued = [...pendingHandshakeRequestsRef.current];
              pendingHandshakeRequestsRef.current = [];
              console.log(`[ChatConnection] Executing ${queued.length} queued requests`);
              queued.forEach(fn => fn());
            } catch (error) {
              console.error('[ChatConnection] Handshake failed:', error);
              setConnectionError('Handshake failed');
              ws.close();
            }
          } else if (frame.type === 'res') {
            // Response to RPC request
            const pending = pendingRequestsRef.current.get(frame.id);
            if (pending) {
              if (frame.ok) {
                pending.resolve(frame.payload);
              } else {
                const errorMsg = typeof frame.error === 'string'
                  ? frame.error
                  : JSON.stringify(frame.error) || 'Request failed';
                console.error('[ChatConnection] RPC error:', frame.error);
                pending.reject(new Error(errorMsg));
              }
              pendingRequestsRef.current.delete(frame.id);
            }
          } else if (frame.type === 'event' && frame.event === 'exec.approval.requested') {
            const entry = parseExecApprovalRequested(frame.payload);
            if (entry) {
              console.log('[ChatConnection] Exec approval requested:', entry.id);
              setExecApprovalQueue(prev => addExecApproval(prev, entry));
              setExecApprovalError(null);
              // Auto-expire after the approval timeout (+500ms buffer)
              const delay = Math.max(0, entry.expiresAtMs - Date.now() + 500);
              const timer = setTimeout(() => {
                setExecApprovalQueue(prev => removeExecApproval(prev, entry.id));
                execApprovalTimersRef.current.delete(entry.id);
              }, delay);
              // Clear any previous timer for this id
              const prev = execApprovalTimersRef.current.get(entry.id);
              if (prev) clearTimeout(prev);
              execApprovalTimersRef.current.set(entry.id, timer);
            }
          } else if (frame.type === 'event' && frame.event === 'exec.approval.resolved') {
            const resolved = parseExecApprovalResolved(frame.payload);
            if (resolved) {
              console.log('[ChatConnection] Exec approval resolved externally:', resolved.id);
              setExecApprovalQueue(prev => removeExecApproval(prev, resolved.id));
              const timer = execApprovalTimersRef.current.get(resolved.id);
              if (timer) {
                clearTimeout(timer);
                execApprovalTimersRef.current.delete(resolved.id);
              }
            }
          } else if (frame.type === 'event' && frame.event === 'chat') {
            // Chat event (streaming, final, error)
            console.log('[ChatConnection] Chat event received:', {
              state: frame.payload?.state,
              runId: frame.payload?.runId,
              hasMessage: !!frame.payload?.message
            });

            // Parse structured backend error for error events
            const payload = frame.payload;
            // Bridge gateway-native errorMessage field → event.error
            if (payload?.state === 'error' && !payload.error && payload.errorMessage) {
              payload.error = payload.errorMessage;
            }
            if (payload?.state === 'error' && payload.error) {
              try {
                const parsed = JSON.parse(payload.error);
                if (parsed && typeof parsed === 'object') {
                  // Backend error shape: { error: { message, type, code, usage } }
                  payload.errorDetail = parsed.error ?? (parsed.code ? parsed : undefined);
                }
              } catch {
                // error is a plain string, no structured detail to extract
              }
            }

            chatEventHandlersRef.current.forEach(handler => {
              try {
                const result = handler(frame.payload);
                if (result instanceof Promise) {
                  result.catch(error => {
                    console.error('[ChatConnection] Error in async chat event handler:', error);
                  });
                }
              } catch (error) {
                console.error('[ChatConnection] Error in chat event handler:', error);
              }
            });
          }
        } catch (error) {
          console.error('[ChatConnection] Error parsing message:', error);
        }
      };

      ws.onerror = (error) => {
        // Guard: ignore errors from sockets that have already been replaced
        // (e.g. by reconnect()). Without this, a stale socket's onerror can
        // overwrite connectionError after reconnect() clears it.
        if (wsRef.current !== ws) return;
        console.error('[ChatConnection] WebSocket error:', error);
        setConnectionError('Connection error');
      };

      ws.onclose = () => {
        // If this socket was already replaced (e.g. by reconnect()), bail out.
        // Updating wsRef or triggering auto-reconnect here would clobber the new
        // connection that reconnect() just created, causing its handshake to be
        // aborted by the stale-nonce guard (wsRef.current !== ws).
        if (wsRef.current !== ws) {
          console.log('[ChatConnection] onclose: stale socket ignored (already replaced by reconnect)');
          return;
        }

        console.log('[ChatConnection] Disconnected from OpenClaw Gateway');
        if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
        setIsConnected(false);
        wsRef.current = null;
        isHandshakeCompleteRef.current = false;
        pendingHandshakeRequestsRef.current = [];

        // Auto-reconnect with exponential backoff — never give up.
        // The gateway can start/restart at any time; permanently giving up
        // leaves the user stuck on "Gateway Not Running" even after starting it.
        if (shouldReconnectRef.current) {
          const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000);
          retryCountRef.current = Math.min(retryCountRef.current + 1, 15); // cap counter, not attempts
          console.log(`[ChatConnection] Reconnecting in ${delay}ms...`);

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      };
    } catch (error) {
      console.error('[ChatConnection] Connection failed:', error);
      setConnectionError(error instanceof Error ? error.message : 'Connection failed');
    }
  }, [gatewayPort]);

  const disconnect = useCallback(() => {
    // Disable auto-reconnect
    shouldReconnectRef.current = false;
    retryCountRef.current = 0;

    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    isHandshakeCompleteRef.current = false;
    pendingHandshakeRequestsRef.current = [];

    // Clear exec approval state
    setExecApprovalQueue([]);
    setExecApprovalBusy(false);
    setExecApprovalError(null);
    for (const timer of execApprovalTimersRef.current.values()) {
      clearTimeout(timer);
    }
    execApprovalTimersRef.current.clear();
  }, []);

  // Manual reconnect: closes any stuck socket, resets retry state, fetches fresh
  // port from the main process, then establishes a new connection.
  const reconnect = useCallback(async () => {
    console.log('[ChatConnection] Manual reconnect triggered');

    // Disable auto-reconnect BEFORE closing so the onclose handler doesn't
    // schedule a competing reconnect that races with this explicit one.
    shouldReconnectRef.current = false;

    // Cancel any pending auto-reconnect timer
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = undefined;
    }

    // Force-close any existing socket (including stuck CONNECTING state)
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Reset retry state
    retryCountRef.current = 0;
    isHandshakeCompleteRef.current = false;
    pendingHandshakeRequestsRef.current = [];
    setConnectionError(null);

    // Re-enable auto-reconnect, then connect
    shouldReconnectRef.current = true;
    await connect();
  }, [connect]);

  const sendMessage = useCallback(async (params: ChatSendParams) => {
    try {
      const idempotencyKey = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const rpcParams: any = {
        message: params.message,
        sessionKey: params.sessionKey || 'default',
        idempotencyKey,
        deliver: false  // Don't use sessions_send tool for delivery - return via chat events
      };

      // Pass image attachments via the gateway's native attachment support
      if (params.attachments && params.attachments.length > 0) {
        rpcParams.attachments = params.attachments;
      }

      await sendRequest('chat.send', rpcParams);
    } catch (error) {
      console.error('[ChatConnection] Failed to send message:', error);
      throw error;
    }
  }, [sendRequest]);

  const loadHistory = useCallback(async (sessionKey: string = 'default', limit: number = 50): Promise<NormalizedMessage[]> => {
    try {
      const response = await sendRequest('chat.history', {
        sessionKey,
        limit
      });

      const messages: NormalizedMessage[] = (response.messages || [])
        .map((msg: any) => {
          const role = msg.role || 'assistant';
          let content = extractDisplayText(msg);
          if (role === 'user') content = stripUserMessageMetadata(content);
          return {
            id: msg.id || `${msg.timestamp || Date.now()}`,
            role,
            content,
            timestamp: msg.timestamp || Date.now(),
            metadata: msg.metadata
          };
        })
        .filter((msg: NormalizedMessage) => msg.content.trim().length > 0);

      return messages;
    } catch (error) {
      console.error('[ChatConnection] Failed to load history:', error);
      return [];
    }
  }, [sendRequest]);

  const abortRun = useCallback(async (runId: string, sessionKey?: string) => {
    try {
      await sendRequest('chat.abort', { runId, sessionKey });
    } catch (error) {
      console.error('[ChatConnection] Failed to abort run:', error);
      throw error;
    }
  }, [sendRequest]);

  const resolveExecApproval = useCallback(async (id: string, decision: ExecApprovalDecision) => {
    if (execApprovalBusy) return;
    setExecApprovalBusy(true);
    setExecApprovalError(null);
    try {
      await sendRequest('exec.approval.resolve', { id, decision });
      setExecApprovalQueue(prev => prev.filter(entry => entry.id !== id));
      const timer = execApprovalTimersRef.current.get(id);
      if (timer) {
        clearTimeout(timer);
        execApprovalTimersRef.current.delete(id);
      }
    } catch (err) {
      setExecApprovalError(`Exec approval failed: ${String(err)}`);
    } finally {
      setExecApprovalBusy(false);
    }
  }, [sendRequest, execApprovalBusy]);

  const onChatEvent = useCallback((handler: (event: ChatEvent) => void | Promise<void>) => {
    chatEventHandlersRef.current.add(handler);
    return () => {
      chatEventHandlersRef.current.delete(handler);
    };
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    // Clear any pending cleanup timer from previous effect runs (StrictMode re-mounts)
    if (cleanupTimerRef.current) {
      clearTimeout(cleanupTimerRef.current);
      cleanupTimerRef.current = null;
    }

    connect();

    return () => {
      // Only disconnect if the component is truly unmounting, not just re-mounting
      // Add a delay to avoid disconnecting during StrictMode re-mounts
      // If the component re-mounts within 150ms, the cleanup timer will be cleared above
      cleanupTimerRef.current = setTimeout(() => {
        console.log('[ChatConnection] Cleanup timer fired - disconnecting');
        disconnect();
        cleanupTimerRef.current = null;
      }, 200);
    };
  }, []); // Empty deps - only run once on mount (twice in StrictMode)

  return {
    isConnected,
    connectionError,
    sendMessage,
    loadHistory,
    abortRun,
    onChatEvent,
    connect,
    reconnect,
    disconnect,
    execApprovalQueue,
    execApprovalBusy,
    execApprovalError,
    resolveExecApproval,
  };
}

// Strip the metadata header the gateway prepends to user messages in chat history.
// Format: "Conversation info (untrusted metadata):\n```json\n{...}\n```\n\n[timestamp] actual message"
function stripUserMessageMetadata(content: string): string {
  if (!content.startsWith('Conversation info')) return content;
  // Find the closing ``` of the metadata JSON block
  const closeIdx = content.lastIndexOf('```');
  if (closeIdx === -1) return content;
  const afterBlock = content.slice(closeIdx + 3).trim();
  // Remove optional leading timestamp like "[Fri 2026-02-20 10:12 GMT+1]"
  return afterBlock.replace(/^\[[^\]]*\]\s*/, '').trim();
}

// Try to unwrap nested JSON that the openai-responses API stores in the session transcript.
// The gateway stores the raw output_text blocks as a JSON-stringified text value, e.g.:
//   [{"type":"output_text","text":"Hello","annotations":[]}]
// The blocks may be triple-nested (each text field may itself be another JSON string).
// The blocks may be separated by newlines when multiple response loops completed.
function tryUnwrapOutputTextJson(raw: string, depth = 0): string | null {
  if (depth > 5) {return null;} // Guard against infinite recursion
  const lines = raw.split('\n').filter(Boolean);
  const texts: string[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      const blocks = Array.isArray(parsed) ? parsed : [parsed];
      for (const b of blocks) {
        if ((b.type === 'output_text' || b.type === 'text') && b.text) {
          const inner = b.text as string;
          const trimmed = inner.trimStart();
          // Recursively unwrap if the text field is itself a JSON array/object
          if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
            const nested = tryUnwrapOutputTextJson(inner, depth + 1);
            if (nested !== null) {
              texts.push(nested);
              continue;
            }
          }
          texts.push(inner);
        }
      }
    } catch {
      // Not JSON — fall back to raw
      return null;
    }
  }
  return texts.length > 0 ? texts.join('') : null;
}

// Known content-block type names used by the gateway in serialized message transcripts.
// Used to distinguish content-block JSON arrays from regular JSON in the message text.
const CONTENT_BLOCK_TYPES = new Set([
  'function', 'tool_use', 'tool_result', 'output_text', 'text', 'image'
]);

// Clean a string-form message content:
//   1. Remove <function_calls>…</function_calls> blocks (serialised tool invocations)
//   2. For lines that are JSON content-block arrays, extract only displayable text;
//      lines that are NOT content-block arrays are kept verbatim.
function cleanStringContent(content: string): string {
  // Strip tool-call XML wrappers (<function_calls>, <function_calls_results>, and any variant)
  const stripped = content.replace(/<function_calls[^>]*>[\s\S]*?<\/function_calls[^>]*>/g, '');

  const outLines: string[] = [];
  for (const line of stripped.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        const blocks = Array.isArray(parsed) ? parsed : [parsed];
        const isContentBlock = blocks.some(
          (b: any) => b && typeof b === 'object' && CONTENT_BLOCK_TYPES.has(b.type)
        );
        if (isContentBlock) {
          // Extract text from output_text/text blocks; silently drop function/tool blocks
          const extracted = blocks
            .filter((b: any) => (b.type === 'output_text' || b.type === 'text') && typeof b.text === 'string')
            .map((b: any) => {
              const inner = b.text as string;
              if (inner.trimStart().startsWith('[') || inner.trimStart().startsWith('{')) {
                const nested = tryUnwrapOutputTextJson(inner);
                if (nested !== null) return nested;
              }
              return inner;
            })
            .join('');
          if (extracted) outLines.push(extracted);
          continue; // don't fall through regardless
        }
      } catch {
        // Not JSON — treat as plain text below
      }
    }
    outLines.push(line);
  }
  return outLines.join('\n').trim();
}

// Returns true if the message content is a JSON tool-result payload (not for display).
function isToolResultMessage(msg: any): boolean {
  if (!msg || typeof msg.content !== 'string') return false;
  try {
    const parsed = JSON.parse(msg.content);
    return parsed && typeof parsed === 'object' && ('results' in parsed || 'disabled' in parsed);
  } catch {
    return false;
  }
}

// Strips <think>, <thinking>, <reasoning> etc. tags and LLM special tokens from text.
// Only the tags themselves are removed; content between them is preserved.
function stripThinkingAndSpecialTokens(text: string): string {
  if (!text) return text;
  const withoutTokens = text.replace(/<\|[^>]+\|>/g, '');
  const thinkingTagRe = /<\s*\/?\s*(?:think(?:ing)?|thought|antthinking|final|reasoning)\b[^<>]*>/gi;
  return withoutTokens.replace(thinkingTagRe, '');
}

/**
 * Extracts the human-readable display text from a gateway message object.
 * Handles all known content formats: plain strings, content-block arrays,
 * nested JSON (openai-responses format), and streaming delta payloads.
 * Exported so ChatSection can reuse the same logic for both history and live events.
 */
export function extractDisplayText(msg: any): string {
  if (!msg) return '';

  // Skip JSON tool-result payloads (e.g. {"results":[...], "disabled":false})
  if (isToolResultMessage(msg)) return '';

  let text: string;

  if (typeof msg.content === 'string') {
    text = cleanStringContent(msg.content);
  } else if (Array.isArray(msg.content)) {
    // Find the last tool_use / tool_result block so we can prefer text that
    // comes after it (avoids leaking pre-tool thinking into the response).
    let lastToolIndex = -1;
    for (let i = msg.content.length - 1; i >= 0; i--) {
      if (msg.content[i].type === 'tool_use' || msg.content[i].type === 'tool_result') {
        lastToolIndex = i;
        break;
      }
    }

    const extractBlock = (c: any): string => {
      const raw = c.text || '';
      if (raw && (raw.trimStart().startsWith('[') || raw.trimStart().startsWith('{'))) {
        const unwrapped = tryUnwrapOutputTextJson(raw);
        if (unwrapped !== null) return unwrapped;
      }
      return cleanStringContent(raw);
    };

    let textBlocks = msg.content
      .map((c: any, idx: number) => ({ c, idx }))
      .filter(({ c, idx }: { c: any; idx: number }) =>
        (c.type === 'text' || c.type === 'output_text') && idx > lastToolIndex
      )
      .map(({ c }: { c: any }) => extractBlock(c));

    // Fallback: no text blocks after tools — include all text blocks
    if (textBlocks.length === 0) {
      textBlocks = msg.content
        .filter((c: any) => c.type === 'text' || c.type === 'output_text')
        .map(extractBlock);
    }

    text = textBlocks.join('\n');
  } else if (typeof msg.text === 'string') {
    text = msg.text;
  } else {
    text = '';
  }

  // Strip LLM-internal tags from assistant output
  if (msg.role === 'assistant' || !msg.role) {
    text = stripThinkingAndSpecialTokens(text);
  }

  // If no displayable content was extracted but this is an error message,
  // fall back to errorMessage so the user sees what went wrong.
  if (!text.trim() && msg.stopReason === 'error' && typeof msg.errorMessage === 'string' && msg.errorMessage) {
    return msg.errorMessage;
  }

  return text.trim();
}
