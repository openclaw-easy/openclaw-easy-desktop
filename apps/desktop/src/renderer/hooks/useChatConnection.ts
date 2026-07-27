import { useState, useEffect, useCallback, useRef } from 'react';
import { DEFAULT_GATEWAY_PORT } from '../../shared/constants';
import { nextMessageKey } from './messageKey';

import {
  type ExecApprovalRequest,
  type ExecApprovalDecision,
  parseExecApprovalRequested,
  parseExecApprovalResolved,
  addExecApproval,
  removeExecApproval,
} from './useExecApproval';

/**
 * True when a rejection was caused by the socket closing rather than by a
 * genuine request failure. In-flight requests are rejected with "Disconnected"
 * on teardown/restart, which is normal lifecycle noise.
 */
function isDisconnectError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /disconnect/i.test(message);
}


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

export function useChatConnection(gatewayPort: number = DEFAULT_GATEWAY_PORT): ChatConnection {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [execApprovalQueue, setExecApprovalQueue] = useState<ExecApprovalRequest[]>([]);
  const [execApprovalBusy, setExecApprovalBusy] = useState(false);
  const [execApprovalError, setExecApprovalError] = useState<string | null>(null);
  const execApprovalTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  /**
   * Promise-based single-flight for `connect()`. The first call sets this
   * to the in-flight connect Promise; concurrent callers (React
   * StrictMode double-mount, auto-reconnect racing with manual
   * reconnect(), useEffect re-runs) get the SAME Promise back and await
   * the same connect attempt.
   *
   * Without this, two concurrent connect() calls would both pass the
   * `wsRef.current` null-check, both await `getGatewayPort()`, and both
   * construct a WebSocket. The orphaned socket never gets a
   * `connect.challenge` reply (the renderer's onmessage guard ignores it
   * via `wsRef.current !== ws`), so the gateway logs a 15s
   * handshake-timeout and the user sees flaky chat.
   *
   * Cleared when the WS is constructed (wsRef takes over de-dup duty) or
   * when the attempt errors out.
   */
  const connectPromiseRef = useRef<Promise<void> | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const retryCountRef = useRef(0);
  const shouldReconnectRef = useRef(true);
  /**
   * Epoch ms when the current reconnect sequence started (i.e. when the
   * connection first dropped without a successful re-handshake). Used to
   * give up auto-reconnect after a cumulative budget so a permanently
   * offline gateway doesn't burn battery indefinitely. Cleared on every
   * successful handshake.
   */
  const reconnectSequenceStartRef = useRef<number | null>(null);
  /** Cumulative reconnect budget — give up after this elapses. 10 min
   *  feels right: enough to ride out a gateway restart or short network
   *  hiccup, short enough that a permanently-stopped gateway doesn't
   *  pin the renderer's event loop overnight. Manual reconnect() resets
   *  this so the user can always force a fresh attempt. */
  const RECONNECT_BUDGET_MS = 10 * 60 * 1000;
  const pendingRequestsRef = useRef<Map<string, { resolve: any; reject: any }>>(new Map());
  const chatEventHandlersRef = useRef<Set<(event: ChatEvent) => void | Promise<void>>>(new Set());
  const requestIdCounter = useRef(0);
  const isHandshakeCompleteRef = useRef(false);
  // Queued send requests that arrived before the handshake completed.
  // Each entry carries its own reject so we can fail the awaiting Promise
  // when the connection is torn down, rather than silently dropping it
  // (H3 — caller would otherwise hang forever on its `await sendMessage`).
  const pendingHandshakeRequestsRef = useRef<Array<{ execute: () => void; reject: (err: Error) => void }>>([]);
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
        pendingHandshakeRequestsRef.current.push({ execute: executeRequest, reject });
      } else {
        executeRequest();
      }
    });
  }, [generateRequestId]);

  const connect = useCallback(async (): Promise<void> => {
    // Don't create new connection if already connecting or connected
    if (wsRef.current &&
        (wsRef.current.readyState === WebSocket.OPEN ||
         wsRef.current.readyState === WebSocket.CONNECTING)) {
      console.log('[ChatConnection] Already connecting or connected, skipping...');
      return;
    }

    // Promise-based single-flight. If a connect attempt is already in
    // flight, every concurrent caller awaits THE SAME Promise — they all
    // observe the same final outcome (success or failure) without
    // racing to construct duplicate WebSockets.
    if (connectPromiseRef.current) {
      console.log('[ChatConnection] connect() already in progress, awaiting in-flight attempt...');
      return connectPromiseRef.current;
    }

    const attempt = (async () => {
      // Enable reconnection when manually connecting
      shouldReconnectRef.current = true;

      // Fetch the active gateway port dynamically so we always connect
      // to whichever port the process manager actually claimed.
      let currentPort = gatewayPort;
      try {
        const fetchedPort = await (window as any).electronAPI?.getGatewayPort?.();
        if (fetchedPort && fetchedPort > 0) {
          currentPort = fetchedPort;
        }
      } catch {
        // fall back to prop value
      }

      // The single-flight gate guarantees no parallel connect was
      // running, but a reconnect() called during our await window
      // could have already established a fresh socket. Honor it.
      if (wsRef.current &&
          (wsRef.current.readyState === WebSocket.OPEN ||
           wsRef.current.readyState === WebSocket.CONNECTING)) {
        console.log('[ChatConnection] WS materialized during await — skipping duplicate construct');
        return;
      }

      console.log(`[ChatConnection] Connecting to ws://localhost:${currentPort}/`);
      const ws = new WebSocket(`ws://localhost:${currentPort}/`);

      // Set wsRef immediately so sendRequest can use it AND the next
      // concurrent connect() sees us via the wsRef early-return guard.
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

              // Bound IPC waits — without these, a hung getGatewayToken() or
              // buildDeviceIdentity() blocks the handshake until the gateway
              // closes the WS for nonce-staleness, then reconnect spins
              // forever in "Gateway Not Running". 5s is generous: both calls
              // are local main-process work (keychain read + Ed25519 sign).
              const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T | undefined> =>
                Promise.race([
                  p,
                  new Promise<undefined>((resolve) =>
                    setTimeout(() => {
                      console.warn(`[ChatConnection] ${label} timed out after ${ms}ms — proceeding without it`);
                      resolve(undefined);
                    }, ms),
                  ),
                ]);

              // Get gateway auth token from Electron main process
              let authToken: string | undefined;
              if (window.electronAPI?.getGatewayToken) {
                try {
                  authToken = await withTimeout(
                    Promise.resolve(window.electronAPI.getGatewayToken()),
                    5000,
                    'getGatewayToken',
                  );
                  console.log('[ChatConnection] Retrieved gateway token:', authToken ? `${authToken.slice(0, 10)}...` : 'null');
                } catch (error) {
                  console.warn('[ChatConnection] Failed to get gateway token:', error);
                }
              } else {
                console.warn('[ChatConnection] getGatewayToken API not available');
              }

              const clientId = 'webchat';
              const clientMode = 'webchat';
              const platform = typeof navigator !== 'undefined' ? navigator.platform : 'electron';
              const deviceFamily = '';
              const scopes = ['operator.read', 'operator.write', 'operator.admin', 'operator.approvals', 'operator.pairing'];

              // Build Ed25519 device identity via main process (Node.js crypto, required for scope grants).
              // Pass platform + deviceFamily so the V3 signed payload matches the
              // platform string we send in connectParams.client.platform — the gateway's
              // verifier reconstructs the payload from BOTH the device fields and the
              // client.platform field; if they disagree, signature verification fails.
              let device_identity: object | undefined;
              try {
                if (window.electronAPI?.buildDeviceIdentity) {
                  device_identity = await withTimeout(
                    Promise.resolve(window.electronAPI.buildDeviceIdentity({
                      clientId,
                      clientMode,
                      role: 'operator',
                      scopes,
                      token: authToken || '',
                      nonce: nonce || '',
                      platform,
                      deviceFamily,
                    })),
                    5000,
                    'buildDeviceIdentity',
                  );
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
                // Protocol version bumped from 3 → 4 in upstream openclaw post-2026.5.
                // Sending maxProtocol < 4 returns INVALID_REQUEST "protocol mismatch".
                minProtocol: 3,
                maxProtocol: 4,
                client: {
                  id: clientId,
                  version: '1.0.0',
                  platform,
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
              // Reset the cumulative reconnect budget — a successful
              // handshake means the next disconnect starts a fresh
              // 10-minute clock, not a continuation of the previous one.
              reconnectSequenceStartRef.current = null;

              // Start heartbeat every 30s. Uses gateway.identity.get (a real
              // read-only method in the BASE_METHODS list) instead of "ping",
              // which the v4 gateway doesn't expose. The old "ping" call
              // returned INVALID_REQUEST every 30s — harmless to chat but
              // spammed the gateway log and burned a request slot per beat.
              if (heartbeatRef.current) clearInterval(heartbeatRef.current);
              heartbeatRef.current = setInterval(() => {
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                  const beatId = `hb_${Date.now()}`;
                  const pongTimeout = setTimeout(() => {
                    // No response within 5s — close and let reconnect handle it
                    console.warn('[ChatConnection] Heartbeat timeout — closing socket');
                    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
                    wsRef.current?.close();
                  }, 5000);

                  pendingRequestsRef.current.set(beatId, {
                    resolve: () => clearTimeout(pongTimeout),
                    reject: () => clearTimeout(pongTimeout),
                  });

                  try {
                    wsRef.current.send(JSON.stringify({ type: 'req', id: beatId, method: 'gateway.identity.get', params: {} }));
                  } catch {
                    clearTimeout(pongTimeout);
                    pendingRequestsRef.current.delete(beatId);
                  }
                }
              }, 30000);

              // Execute queued requests
              const queued = [...pendingHandshakeRequestsRef.current];
              pendingHandshakeRequestsRef.current = [];
              console.log(`[ChatConnection] Executing ${queued.length} queued requests`);
              queued.forEach(entry => entry.execute());
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
        // Reject any requests queued behind a handshake that will now never
        // complete — silent drop would hang the caller's `await sendMessage`.
        const droppedOnClose = pendingHandshakeRequestsRef.current;
        pendingHandshakeRequestsRef.current = [];
        droppedOnClose.forEach(entry => entry.reject(new Error('WebSocket disconnected before handshake completed')));

        // Also reject already-SENT RPCs (chat.send/chat.history) that are still
        // awaiting a response — otherwise they only settle via their 30s
        // timeout, keeping the send path blocked ("isSending") for 30s after a
        // drop and stranding the caller's await.
        const inFlight = Array.from(pendingRequestsRef.current.values());
        pendingRequestsRef.current.clear();
        inFlight.forEach(entry => { try { entry.reject(new Error('WebSocket disconnected')); } catch { /* heartbeat reject clears its timer */ } });

        // Auto-reconnect with exponential backoff. Originally "never give
        // up" — but a permanently offline gateway then pinged forever at
        // 30s intervals, burning battery without ever succeeding. We now
        // cap at a cumulative 10-minute budget per reconnect sequence:
        // long enough to ride out a gateway restart or transient
        // network blip, short enough that a stopped gateway doesn't keep
        // the desktop's event loop busy overnight. The manual reconnect()
        // button clears the budget so the user can always retry.
        if (shouldReconnectRef.current) {
          if (reconnectSequenceStartRef.current === null) {
            reconnectSequenceStartRef.current = Date.now();
          }
          const elapsed = Date.now() - reconnectSequenceStartRef.current;
          if (elapsed >= RECONNECT_BUDGET_MS) {
            console.log(`[ChatConnection] Auto-reconnect budget exhausted (${(elapsed / 1000).toFixed(0)}s) — stopping. User can manually retry.`);
            shouldReconnectRef.current = false;
            setConnectionError('Could not reach gateway — click reconnect to try again.');
            return;
          }
          const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000);
          retryCountRef.current = Math.min(retryCountRef.current + 1, 15); // cap counter, not attempts
          console.log(`[ChatConnection] Reconnecting in ${delay}ms (elapsed ${(elapsed / 1000).toFixed(0)}s / ${RECONNECT_BUDGET_MS / 1000}s budget)...`);

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      };
    })();

    // Publish + track the in-flight Promise. Concurrent connect() callers
    // hit the `connectPromiseRef.current` early-return and await this
    // same Promise. Cleared in the finally block so the next attempt is
    // unblocked regardless of success or failure.
    connectPromiseRef.current = attempt
      .catch((error) => {
        console.error('[ChatConnection] Connection failed:', error);
        setConnectionError(error instanceof Error ? error.message : 'Connection failed');
      })
      .finally(() => {
        connectPromiseRef.current = null;
      });
    return connectPromiseRef.current;
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
    // Clear the in-flight connect Promise so a subsequent reconnect()
    // can start fresh instead of awaiting a now-meaningless attempt.
    connectPromiseRef.current = null;
    setIsConnected(false);
    isHandshakeCompleteRef.current = false;
    // Reject queued sends so awaiters fail fast instead of hanging forever.
    const droppedOnDisconnect = pendingHandshakeRequestsRef.current;
    pendingHandshakeRequestsRef.current = [];
    droppedOnDisconnect.forEach(entry => entry.reject(new Error('Disconnected before handshake completed')));
    // Reject already-sent RPCs too so they don't hang on their 30s timeout.
    const inFlightOnDisconnect = Array.from(pendingRequestsRef.current.values());
    pendingRequestsRef.current.clear();
    inFlightOnDisconnect.forEach(entry => { try { entry.reject(new Error('Disconnected')); } catch { /* heartbeat reject clears its timer */ } });

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
    // Drop any in-flight connect Promise — we want a fresh attempt, not
    // to await one that's already racing with the close we just did.
    connectPromiseRef.current = null;

    // Reset retry state — including the cumulative reconnect budget, so
    // a user-driven retry always gets a fresh 10-minute clock even if
    // auto-reconnect had previously given up.
    retryCountRef.current = 0;
    reconnectSequenceStartRef.current = null;
    isHandshakeCompleteRef.current = false;
    // Reject queued sends so awaiters fail fast — they can be retried after reconnect.
    const droppedOnReconnect = pendingHandshakeRequestsRef.current;
    pendingHandshakeRequestsRef.current = [];
    droppedOnReconnect.forEach(entry => entry.reject(new Error('Reconnect requested before handshake completed')));
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
            // `nextMessageKey` makes this a globally-unique React key
            // even when upstream history sends two messages with the
            // same `msg.id` (the gateway occasionally uses bare
            // Date.now() ids that collide within a millisecond — that
            // produced the "two children with the same key 1778…" warning
            // and caused bubbles to silently merge).
            id: nextMessageKey('hist', msg.id ?? msg.timestamp),
            role,
            content,
            timestamp: msg.timestamp || Date.now(),
            metadata: msg.metadata
          };
        })
        .filter((msg: NormalizedMessage) => msg.content.trim().length > 0);

      return messages;
    } catch (error) {
      // A history request still in flight when the socket closes is rejected
      // with "Disconnected". That is an expected lifecycle event — gateway
      // restart, app teardown, a network blip — not a fault, so it must not
      // surface as console.error. Real failures still do.
      if (isDisconnectError(error)) {
        console.debug('[ChatConnection] History load aborted: connection closed');
        return [];
      }
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

  // Auto-connect on mount.
  //
  // The Promise-based single-flight in `connect()` makes this safe under
  // React StrictMode's double-mount: the second mount's `connect()` call
  // finds either a non-null `wsRef.current` (early return) OR an in-flight
  // `connectPromiseRef.current` (awaits the same Promise). Either way,
  // exactly ONE WebSocket is constructed.
  //
  // We deliberately disconnect on every cleanup — including StrictMode
  // unmount/remount. Briefly closing + reopening shows up in the gateway
  // log as a clean connect/disconnect pair (no stuck-handshake noise),
  // which is the right trade for not carrying timer hacks.
  useEffect(() => {
    void connect();
    return () => {
      disconnect();
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
