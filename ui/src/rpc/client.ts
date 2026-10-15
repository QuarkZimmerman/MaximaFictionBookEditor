/**
 * JSON-RPC 2.0 client over a WebSocket to the core (`ws://127.0.0.1:<port>/rpc?token=…`).
 *
 * - Typed `call(method, params)` per `RpcMethods`; incrementing request ids; per-call timeout.
 * - Server notifications dispatched to `on(name, handler)` subscribers.
 * - Job helpers: `runJob()` resolves on `job.done` / rejects on `job.failed`.
 * - Automatic reconnect with exponential backoff and `onStatus()` callbacks.
 * - File dialog requests (`FILE_DIALOG_METHODS`) wait without a time limit and are reported
 *   while pending (`fileDialogOpen`, `onFileDialog()`).
 *
 * The client never touches binary payloads: images travel over the HTTP endpoints.
 */

import {
  RpcErrorCode,
  isJobStart,
  type JobProgress,
  type JobStart,
  type RpcErrorObject,
  type RpcMethodName,
  type RpcNotificationName,
  type RpcNotifications,
  type RpcParams,
  type RpcResult,
} from './types';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export class RpcError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.data = data;
  }

  static fromObject(error: RpcErrorObject): RpcError {
    return new RpcError(error.code, error.message, error.data);
  }

  toObject(): RpcErrorObject {
    return { code: this.code, message: this.message, data: this.data };
  }
}

export function isRpcError(value: unknown): value is RpcError {
  return value instanceof RpcError;
}

/** The subset of the WebSocket API the client relies on (mockable in tests). */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
}

export const WS_OPEN = 1;

export interface BackoffOptions {
  /** First reconnect delay in ms (default 500). */
  initialMs: number;
  /** Upper bound of the delay in ms (default 10 000). */
  maxMs: number;
  /** Multiplier applied after every failed attempt (default 2). */
  factor: number;
}

export interface RpcClientOptions {
  /** Full WebSocket URL. Defaults to `resolveCoreUrl()`. */
  url?: string;
  /** Default request timeout in ms (default 30 000). */
  timeoutMs?: number;
  /** Reconnect automatically after an unexpected close (default true). */
  reconnect?: boolean;
  backoff?: Partial<BackoffOptions>;
  /** Factory used to create sockets; tests inject a mock here. */
  webSocketFactory?: (url: string) => WebSocketLike;
  onStatus?: (status: ConnectionStatus) => void;
}

export interface CallOptions {
  timeoutMs?: number;
}

export interface RunJobOptions extends CallOptions {
  onProgress?: (progress: JobProgress) => void;
}

/** `call()` argument tuple: no params object for `void` methods. */
export type CallArgs<M extends RpcMethodName> =
  RpcParams<M> extends void
    ? [params?: undefined, options?: CallOptions]
    : [params: RpcParams<M>, options?: CallOptions];

type NotificationHandler<N extends RpcNotificationName> = (payload: RpcNotifications[N]) => void;

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: RpcError) => void;
  timer: ReturnType<typeof setTimeout> | null;
  payload: string;
  sent: boolean;
}

type JobOutcome = { ok: true; result: unknown } | { ok: false; error: RpcErrorObject };

interface JobWaiter {
  resolve: (result: unknown) => void;
  reject: (error: RpcError) => void;
  onProgress?: (progress: JobProgress) => void;
}

/**
 * Methods that show one of the platform's file dialogs (rpc-api.md §3.9): the core answers when
 * the user closes the dialog, so they wait without a time limit, and while one is pending the
 * editor takes no input (`app/fileDialogBlock.ts`).
 */
export const FILE_DIALOG_METHODS: ReadonlySet<string> = new Set([
  'dialog.openFile',
  'dialog.saveFile',
  'dialog.pickFolder',
]);

const DEFAULT_BACKOFF: BackoffOptions = { initialMs: 500, maxMs: 10_000, factor: 2 };
const UNCLAIMED_JOB_LIMIT = 32;

/* ------------------------------------------------------------------------ */
/* URL / token resolution                                                   */
/* ------------------------------------------------------------------------ */

export interface CoreLocation {
  /** Page URL (defaults to `window.location.href`). */
  pageUrl?: string;
  /** Dev override of the core origin, e.g. `http://127.0.0.1:41237` (VITE_MFBE_CORE). */
  coreOrigin?: string;
  /** Token compiled into the bundle (`__MFBE_TOKEN__`). */
  buildToken?: string;
}

/** Session token: `?token=` of the page URL first, then the build-time define. */
export function resolveToken(location: CoreLocation = {}): string {
  const pageUrl = location.pageUrl ?? (typeof window !== 'undefined' ? window.location.href : '');
  if (pageUrl) {
    try {
      const fromUrl = new URL(pageUrl).searchParams.get('token');
      if (fromUrl) return fromUrl;
    } catch {
      // not a valid URL: fall through to the build token
    }
  }
  if (location.buildToken !== undefined) return location.buildToken;
  return typeof __MFBE_TOKEN__ === 'string' ? __MFBE_TOKEN__ : '';
}

/** `ws(s)://<host>/rpc?token=<token>` derived from the page URL or the dev override. */
export function resolveCoreUrl(location: CoreLocation = {}): string {
  const token = resolveToken(location);
  const coreOrigin =
    location.coreOrigin ??
    (import.meta.env.VITE_MFBE_CORE ? String(import.meta.env.VITE_MFBE_CORE) : undefined);
  const pageUrl = location.pageUrl ?? (typeof window !== 'undefined' ? window.location.href : '');

  let base: URL;
  if (coreOrigin) {
    base = new URL(coreOrigin);
  } else if (pageUrl) {
    base = new URL(pageUrl);
  } else {
    base = new URL('http://127.0.0.1/');
  }
  const protocol = base.protocol === 'https:' || base.protocol === 'wss:' ? 'wss:' : 'ws:';
  const url = new URL(`${protocol}//${base.host}/rpc`);
  if (token) url.searchParams.set('token', token);
  return url.toString();
}

/* ------------------------------------------------------------------------ */
/* Client                                                                   */
/* ------------------------------------------------------------------------ */

export class RpcClient {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly reconnectEnabled: boolean;
  private readonly backoff: BackoffOptions;
  private readonly factory: (url: string) => WebSocketLike;

  private socket: WebSocketLike | null = null;
  private statusValue: ConnectionStatus = 'disconnected';
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();
  private readonly notificationListeners = new Map<string, Set<(payload: unknown) => void>>();
  private readonly pending = new Map<number, PendingRequest>();
  private readonly jobWaiters = new Map<string, JobWaiter>();
  private readonly unclaimedJobs = new Map<string, JobOutcome>();
  private nextId = 1;
  private pendingFileDialogs = 0;
  private readonly fileDialogListeners = new Set<(open: boolean) => void>();
  private closedByUser = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: RpcClientOptions = {}) {
    this.url = options.url ?? resolveCoreUrl();
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.reconnectEnabled = options.reconnect ?? true;
    this.backoff = { ...DEFAULT_BACKOFF, ...options.backoff };
    this.factory = options.webSocketFactory ?? ((url) => new WebSocket(url) as WebSocketLike);
    if (options.onStatus) this.statusListeners.add(options.onStatus);
  }

  get status(): ConnectionStatus {
    return this.statusValue;
  }

  get endpoint(): string {
    return this.url;
  }

  /** Number of attempts made since the last successful connection (for diagnostics). */
  get reconnectAttempts(): number {
    return this.reconnectAttempt;
  }

  /** Opens the connection (idempotent). */
  connect(): void {
    this.closedByUser = false;
    if (this.socket) return;
    this.clearReconnectTimer();
    this.openSocket();
  }

  /** Closes the connection for good: no reconnect, all pending requests rejected. */
  close(): void {
    this.closedByUser = true;
    this.clearReconnectTimer();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close(1000, 'client closed');
      } catch {
        // ignore errors from an already-closed socket
      }
    }
    this.rejectAllPending('connection closed');
    this.setStatus('disconnected');
  }

  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /** True while a file dialog request (`FILE_DIALOG_METHODS`) waits for its answer. */
  get fileDialogOpen(): boolean {
    return this.pendingFileDialogs > 0;
  }

  /**
   * Called with true when a file dialog request starts waiting and with false once no file
   * dialog request is pending any more (answered, failed or disconnected).
   */
  onFileDialog(listener: (open: boolean) => void): () => void {
    this.fileDialogListeners.add(listener);
    return () => {
      this.fileDialogListeners.delete(listener);
    };
  }

  /** Subscribes to a server notification. Returns the unsubscribe function. */
  on<N extends RpcNotificationName>(name: N, handler: NotificationHandler<N>): () => void {
    let set = this.notificationListeners.get(name);
    if (!set) {
      set = new Set();
      this.notificationListeners.set(name, set);
    }
    const wrapped = handler as (payload: unknown) => void;
    set.add(wrapped);
    return () => {
      set.delete(wrapped);
    };
  }

  /** Typed request. Rejects with `RpcError` (server error, timeout or disconnection). */
  call<M extends RpcMethodName>(method: M, ...args: CallArgs<M>): Promise<RpcResult<M>> {
    const [params, options] = args;
    return this.request(method, params, options) as Promise<RpcResult<M>>;
  }

  /** Untyped request for methods outside the contract (dev/test hooks). */
  request(method: string, params?: unknown, options: CallOptions = {}): Promise<unknown> {
    if (this.closedByUser || (this.statusValue === 'disconnected' && !this.reconnectTimer)) {
      return Promise.reject(
        new RpcError(RpcErrorCode.clientDisconnected, `${method}: not connected to the core`),
      );
    }
    const id = this.nextId++;
    const body: Record<string, unknown> = { jsonrpc: '2.0', id, method };
    if (params !== undefined) body.params = params;
    const payload = JSON.stringify(body);
    const fileDialog = FILE_DIALOG_METHODS.has(method);
    const timeoutMs = options.timeoutMs ?? (fileDialog ? 0 : this.timeoutMs);

    const answer = new Promise<unknown>((resolve, reject) => {
      const entry: PendingRequest = { method, resolve, reject, timer: null, payload, sent: false };
      if (timeoutMs > 0) {
        entry.timer = setTimeout(() => {
          this.pending.delete(id);
          reject(
            new RpcError(
              RpcErrorCode.clientTimeout,
              `${method}: no response within ${timeoutMs} ms`,
            ),
          );
        }, timeoutMs);
      }
      this.pending.set(id, entry);
      if (this.socket && this.socket.readyState === WS_OPEN) {
        this.send(entry);
      }
      // otherwise the request is flushed by onopen (status 'connecting')
    });
    if (!fileDialog) return answer;
    this.countFileDialog(1);
    return answer.finally(() => this.countFileDialog(-1));
  }

  private countFileDialog(change: 1 | -1): void {
    const wasOpen = this.pendingFileDialogs > 0;
    this.pendingFileDialogs += change;
    const open = this.pendingFileDialogs > 0;
    if (open === wasOpen) return;
    for (const listener of [...this.fileDialogListeners]) listener(open);
  }

  /**
   * Calls a method that may answer with `{jobId}` and waits for the job to finish.
   * Progress notifications of that job are forwarded to `onProgress`.
   */
  async runJob<M extends RpcMethodName>(
    method: M,
    ...args: RpcParams<M> extends void
      ? [params?: undefined, options?: RunJobOptions]
      : [params: RpcParams<M>, options?: RunJobOptions]
  ): Promise<Exclude<RpcResult<M>, JobStart>> {
    const [params, options] = args;
    const first = await this.request(method, params, options);
    if (isJobStart(first)) {
      return (await this.waitForJob(first.jobId, options?.onProgress)) as Exclude<
        RpcResult<M>,
        JobStart
      >;
    }
    return first as Exclude<RpcResult<M>, JobStart>;
  }

  /** Resolves with the `job.done` result of `jobId`, rejects with the `job.failed` error. */
  waitForJob(jobId: string, onProgress?: (progress: JobProgress) => void): Promise<unknown> {
    const finished = this.unclaimedJobs.get(jobId);
    if (finished) {
      this.unclaimedJobs.delete(jobId);
      return finished.ok
        ? Promise.resolve(finished.result)
        : Promise.reject(RpcError.fromObject(finished.error));
    }
    return new Promise<unknown>((resolve, reject) => {
      this.jobWaiters.set(jobId, { resolve, reject, onProgress });
    });
  }

  /* ---------------------------------------------------------------------- */

  private openSocket(): void {
    this.setStatus('connecting');
    let socket: WebSocketLike;
    try {
      socket = this.factory(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.reconnectAttempt = 0;
      this.setStatus('connected');
      for (const entry of this.pending.values()) {
        if (!entry.sent) this.send(entry);
      }
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.handleMessage(event.data);
    };
    socket.onerror = () => {
      // The close event that follows carries the actual state change.
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.rejectAllPending('connection lost');
      this.failAllJobs('connection lost');
      if (this.closedByUser || !this.reconnectEnabled) {
        this.setStatus('disconnected');
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || !this.reconnectEnabled) {
      this.setStatus('disconnected');
      return;
    }
    const delay = Math.min(
      this.backoff.maxMs,
      this.backoff.initialMs * Math.pow(this.backoff.factor, this.reconnectAttempt),
    );
    this.reconnectAttempt += 1;
    this.setStatus('disconnected');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser && !this.socket) this.openSocket();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private send(entry: PendingRequest): void {
    if (!this.socket) return;
    try {
      this.socket.send(entry.payload);
      entry.sent = true;
    } catch (error) {
      entry.sent = false;
      // Let the close handler reject pending requests; log nothing (no console noise in the UI).
      void error;
    }
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return; // malformed frames are ignored
    }
    if (typeof message !== 'object' || message === null) return;
    const msg = message as {
      id?: unknown;
      method?: unknown;
      params?: unknown;
      result?: unknown;
      error?: unknown;
    };

    if (typeof msg.method === 'string') {
      if (msg.id === undefined || msg.id === null) {
        this.dispatchNotification(msg.method, msg.params);
      } else {
        // Server -> client requests are not part of the contract.
        this.socket?.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            error: { code: RpcErrorCode.methodNotFound, message: 'Method not found' },
          }),
        );
      }
      return;
    }

    if (typeof msg.id !== 'number') return;
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    if (entry.timer) clearTimeout(entry.timer);

    if (msg.error !== undefined) {
      const err = msg.error as Partial<RpcErrorObject> | null;
      if (err && typeof err.code === 'number' && typeof err.message === 'string') {
        entry.reject(new RpcError(err.code, err.message, err.data));
      } else {
        entry.reject(
          new RpcError(
            RpcErrorCode.clientInvalidResponse,
            `${entry.method}: malformed error object`,
          ),
        );
      }
      return;
    }
    if ('result' in msg) {
      entry.resolve(msg.result);
      return;
    }
    entry.reject(
      new RpcError(RpcErrorCode.clientInvalidResponse, `${entry.method}: response without result`),
    );
  }

  private dispatchNotification(name: string, params: unknown): void {
    if (name === 'job.progress') {
      const progress = params as JobProgress;
      this.jobWaiters.get(progress.jobId)?.onProgress?.(progress);
    } else if (name === 'job.done') {
      const { jobId, result } = params as { jobId: string; result?: unknown };
      this.settleJob(jobId, { ok: true, result });
    } else if (name === 'job.failed') {
      const { jobId, error } = params as { jobId: string; error: RpcErrorObject };
      this.settleJob(jobId, { ok: false, error });
    }
    const listeners = this.notificationListeners.get(name);
    if (!listeners) return;
    for (const listener of [...listeners]) {
      try {
        listener(params);
      } catch {
        // a faulty subscriber must not break the others
      }
    }
  }

  private settleJob(jobId: string, outcome: JobOutcome): void {
    const waiter = this.jobWaiters.get(jobId);
    if (waiter) {
      this.jobWaiters.delete(jobId);
      if (outcome.ok) waiter.resolve(outcome.result);
      else waiter.reject(RpcError.fromObject(outcome.error));
      return;
    }
    // Finished before anybody waited for it: keep it for a later waitForJob().
    if (this.unclaimedJobs.size >= UNCLAIMED_JOB_LIMIT) {
      const oldest = this.unclaimedJobs.keys().next().value;
      if (oldest !== undefined) this.unclaimedJobs.delete(oldest);
    }
    this.unclaimedJobs.set(jobId, outcome);
  }

  private rejectAllPending(reason: string): void {
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(new RpcError(RpcErrorCode.clientDisconnected, `${entry.method}: ${reason}`));
    }
  }

  private failAllJobs(reason: string): void {
    const waiters = [...this.jobWaiters.values()];
    this.jobWaiters.clear();
    for (const waiter of waiters) {
      waiter.reject(new RpcError(RpcErrorCode.clientDisconnected, `job: ${reason}`));
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.statusValue === status) return;
    this.statusValue = status;
    for (const listener of [...this.statusListeners]) {
      try {
        listener(status);
      } catch {
        // status listeners must not break the client
      }
    }
  }
}
