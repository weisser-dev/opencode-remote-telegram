import { EventSource } from 'eventsource';
import type { MessageUsageInfo } from '../types/index.js';
import { getAuthHeaders } from '../utils/AuthHelper.js';
import { log } from '../utils/Logger.js';

// ─── Callback types ───────────────────────────────────────────────────────────

type TextDeltaCallback = (delta: string) => void;
type ThinkingCallback = () => void;
type IdleCallback = (sessionId: string) => void;
type ErrorCallback = (sessionId: string, error: { name: string; data?: { message?: string } }) => void;
type UsageCallback = (usage: MessageUsageInfo) => void;
type ConnectionErrorCallback = (error: Error) => void;

// ─── SSE Client with auto-reconnect ──────────────────────────────────────────

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 1000;

export class SSEClient {
  private eventSource: EventSource | null = null;
  private textDeltaCallbacks: TextDeltaCallback[] = [];
  private thinkingCallbacks: ThinkingCallback[] = [];
  private idleCallbacks: IdleCallback[] = [];
  private errorCallbacks: ErrorCallback[] = [];
  private usageCallbacks: UsageCallback[] = [];
  private connectionErrorCallbacks: ConnectionErrorCallback[] = [];

  private baseUrl = '';
  private port = 0;
  private reconnectAttempts = 0;
  private disconnectedManually = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  onText(cb: TextDeltaCallback): void { this.textDeltaCallbacks.push(cb); }
  onThinking(cb: ThinkingCallback): void { this.thinkingCallbacks.push(cb); }
  onIdle(cb: IdleCallback): void { this.idleCallbacks.push(cb); }
  onError(cb: ErrorCallback): void { this.errorCallbacks.push(cb); }
  onUsage(cb: UsageCallback): void { this.usageCallbacks.push(cb); }
  onConnectionError(cb: ConnectionErrorCallback): void { this.connectionErrorCallbacks.push(cb); }

  connect(baseUrl: string, port: number): void {
    this.baseUrl = baseUrl;
    this.port = port;
    this.disconnectedManually = false;
    this.reconnectAttempts = 0;
    this.doConnect();
  }

  private doConnect(): void {
    const url = `${this.baseUrl}/event`;
    const authHeaders = getAuthHeaders(this.port);

    this.eventSource = new EventSource(url, {
      fetch: (input: string | URL | Request, init?: RequestInit) => {
        const headers = new Headers((init as RequestInit | undefined)?.headers);
        for (const [key, value] of Object.entries(authHeaders)) {
          headers.set(key, value);
        }
        return globalThis.fetch(input, { ...(init as RequestInit | undefined), headers });
      },
    } as ConstructorParameters<typeof EventSource>[1]);

    this.eventSource.addEventListener('message', (event: MessageEvent) => {
      // Reset reconnect counter on successful message
      this.reconnectAttempts = 0;
      try {
        this.dispatch(JSON.parse(event.data));
      } catch { /* ignore malformed events */ }
    });

    this.eventSource.addEventListener('error', (err: Event) => {
      if (this.disconnectedManually) return;

      if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        this.reconnectAttempts++;
        const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1);
        log.warn(`[sse] connection lost — reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
        this.eventSource?.close();
        this.reconnectTimer = setTimeout(() => this.doConnect(), delay);
      } else {
        log.error(`[sse] failed after ${MAX_RECONNECT_ATTEMPTS} reconnect attempts`);
        this.connectionErrorCallbacks.forEach(cb =>
          cb(err instanceof Error ? err : new Error(`SSE connection lost after ${MAX_RECONNECT_ATTEMPTS} retries`)),
        );
      }
    });
  }

  disconnect(): void {
    this.disconnectedManually = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.eventSource?.close();
    this.eventSource = null;
  }

  isConnected(): boolean {
    return this.eventSource !== null && this.eventSource.readyState === EventSource.OPEN;
  }

  private dispatch(event: { type: string; properties: unknown }): void {
    const props = event.properties as Record<string, unknown>;

    switch (event.type) {

      case 'session.status': {
        const status = (props.status as Record<string, unknown> | undefined)?.type;
        if (status === 'busy') {
          this.thinkingCallbacks.forEach(cb => cb());
        }
        break;
      }

      case 'message.part.delta': {
        const field = props.field as string | undefined;
        const delta = (props.delta ?? props.d) as string | undefined;
        if (field === 'text' && typeof delta === 'string' && delta.length > 0) {
          this.textDeltaCallbacks.forEach(cb => cb(delta));
        }
        break;
      }

      case 'message.updated': {
        const info = props.info as Record<string, unknown> | undefined;
        if (
          info?.role === 'assistant' &&
          info?.finish &&
          (info.time as Record<string, unknown> | undefined)?.completed
        ) {
          const tokens = (info.tokens ?? {}) as Record<string, unknown>;
          const cache = (tokens.cache ?? {}) as Record<string, unknown>;
          const usage: MessageUsageInfo = {
            sessionID: info.sessionID as string,
            messageID: info.id as string,
            cost: (info.cost as number) ?? 0,
            tokens: {
              total: (tokens.total as number) ?? 0,
              input: (tokens.input as number) ?? 0,
              output: (tokens.output as number) ?? 0,
              reasoning: (tokens.reasoning as number) ?? 0,
              cache: {
                read: (cache.read as number) ?? 0,
                write: (cache.write as number) ?? 0,
              },
            },
            modelID: info.modelID as string | undefined,
            providerID: info.providerID as string | undefined,
          };
          const time = info.time as Record<string, number>;
          if (time.created && time.completed) usage.duration = time.completed - time.created;
          this.usageCallbacks.forEach(cb => cb(usage));
        }
        break;
      }

      case 'session.idle': {
        const sessionID = props.sessionID as string | undefined;
        if (sessionID) this.idleCallbacks.forEach(cb => cb(sessionID));
        break;
      }

      case 'session.error': {
        const sessionID = props.sessionID as string | undefined;
        const error = props.error as { name: string; data?: { message?: string } } | undefined;
        if (sessionID && error) this.errorCallbacks.forEach(cb => cb(sessionID, error));
        break;
      }
    }
  }
}
