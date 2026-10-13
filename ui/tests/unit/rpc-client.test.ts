import {
  RpcClient,
  RpcError,
  WS_OPEN,
  resolveCoreUrl,
  resolveToken,
  type ConnectionStatus,
  type WebSocketLike,
} from '@/rpc/client';
import { RpcErrorCode } from '@/rpc/types';

/** Minimal scripted WebSocket double. */
class MockSocket implements WebSocketLike {
  readyState = 0;
  readonly sent: string[] = [];
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closedByClient = false;

  constructor(readonly url: string) {}

  send(data: string): void {
    if (this.readyState !== WS_OPEN) throw new Error('socket not open');
    this.sent.push(data);
  }

  close(): void {
    this.closedByClient = true;
    this.readyState = 3;
  }

  /** Server side helpers */
  open(): void {
    this.readyState = WS_OPEN;
    this.onopen?.(new Event('open'));
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }

  receiveRaw(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  serverClose(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: 'lost' } as CloseEvent);
  }

  lastRequest(): { jsonrpc: string; id: number; method: string; params?: unknown } {
    const raw = this.sent.at(-1);
    if (!raw) throw new Error('nothing was sent');
    return JSON.parse(raw) as { jsonrpc: string; id: number; method: string; params?: unknown };
  }
}

function setup(options: ConstructorParameters<typeof RpcClient>[0] = {}) {
  const sockets: MockSocket[] = [];
  const statuses: ConnectionStatus[] = [];
  const client = new RpcClient({
    url: 'ws://127.0.0.1:1/rpc?token=t',
    timeoutMs: 1000,
    backoff: { initialMs: 100, maxMs: 400, factor: 2 },
    webSocketFactory: (url) => {
      const socket = new MockSocket(url);
      sockets.push(socket);
      return socket;
    },
    onStatus: (status) => statuses.push(status),
    ...options,
  });
  return { client, sockets, statuses, socket: () => sockets.at(-1)! };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('RpcClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects, sends JSON-RPC 2.0 requests with incrementing ids and matches responses', async () => {
    const { client, socket, statuses } = setup();
    client.connect();
    expect(statuses).toEqual(['connecting']);
    socket().open();
    expect(statuses).toEqual(['connecting', 'connected']);
    expect(client.status).toBe('connected');

    const info = client.call('app.info');
    const open = client.call('doc.open', { path: '/tmp/a.fb2' });
    expect(socket().sent).toHaveLength(2);
    const first = JSON.parse(socket().sent[0]!);
    const second = JSON.parse(socket().sent[1]!);
    expect(first).toEqual({ jsonrpc: '2.0', id: 1, method: 'app.info' });
    expect(second).toEqual({
      jsonrpc: '2.0',
      id: 2,
      method: 'doc.open',
      params: { path: '/tmp/a.fb2' },
    });

    // Out-of-order responses are matched by id.
    socket().receive({
      jsonrpc: '2.0',
      id: 2,
      result: { document: { docId: 'd1' }, warnings: [] },
    });
    socket().receive({ jsonrpc: '2.0', id: 1, result: { version: '1.0', apiVersion: 1 } });
    await expect(open).resolves.toEqual({ document: { docId: 'd1' }, warnings: [] });
    await expect(info).resolves.toMatchObject({ version: '1.0' });
  });

  it('maps JSON-RPC error objects to RpcError with code, message and data', async () => {
    const { client, socket } = setup();
    client.connect();
    socket().open();
    const promise = client.call('doc.open', { path: '/missing.fb2' });
    socket().receive({
      jsonrpc: '2.0',
      id: 1,
      error: {
        code: 1002,
        message: 'cannot read',
        data: { path: '/missing.fb2', reason: 'ENOENT' },
      },
    });
    await expect(promise).rejects.toBeInstanceOf(RpcError);
    await promise.catch((error: RpcError) => {
      expect(error.code).toBe(RpcErrorCode.docIoError);
      expect(error.message).toBe('cannot read');
      expect(error.data).toEqual({ path: '/missing.fb2', reason: 'ENOENT' });
      expect(error.toObject()).toEqual({
        code: 1002,
        message: 'cannot read',
        data: { path: '/missing.fb2', reason: 'ENOENT' },
      });
    });
  });

  it('rejects a request that receives no response within the timeout', async () => {
    const { client, socket } = setup();
    client.connect();
    socket().open();
    const promise = client.call('settings.get', undefined, { timeoutMs: 250 });
    const rejection = expect(promise).rejects.toMatchObject({ code: RpcErrorCode.clientTimeout });
    vi.advanceTimersByTime(249);
    expect(socket().sent).toHaveLength(1);
    vi.advanceTimersByTime(1);
    await rejection;
    // A late response for the timed-out id is ignored.
    socket().receive({ jsonrpc: '2.0', id: 1, result: {} });
  });

  it('ignores malformed frames and unexpected ids', async () => {
    const { client, socket } = setup();
    client.connect();
    socket().open();
    const promise = client.call('app.info');
    socket().receiveRaw('{not json');
    socket().receiveRaw(new ArrayBuffer(2));
    socket().receive({ jsonrpc: '2.0', id: 999, result: 1 });
    socket().receive({ jsonrpc: '2.0', id: 1, error: 'broken' });
    await expect(promise).rejects.toMatchObject({ code: RpcErrorCode.clientInvalidResponse });
  });

  it('dispatches notifications to subscribers until they unsubscribe', () => {
    const { client, socket } = setup();
    client.connect();
    socket().open();
    const received: unknown[] = [];
    const off = client.on('doc.changedOnDisk', (payload) => received.push(payload));
    const other = vi.fn();
    client.on('settings.changed', other);

    socket().receive({
      jsonrpc: '2.0',
      method: 'doc.changedOnDisk',
      params: { docId: 'd1', path: '/a.fb2', mtime: '2026-10-12T00:00:00Z' },
    });
    expect(received).toEqual([{ docId: 'd1', path: '/a.fb2', mtime: '2026-10-12T00:00:00Z' }]);
    expect(other).not.toHaveBeenCalled();

    off();
    socket().receive({
      jsonrpc: '2.0',
      method: 'doc.changedOnDisk',
      params: { docId: 'd1', path: '/a.fb2', mtime: 'later' },
    });
    expect(received).toHaveLength(1);
  });

  it('answers server-to-client requests with method-not-found', () => {
    const { client, socket } = setup();
    client.connect();
    socket().open();
    socket().receive({ jsonrpc: '2.0', id: 'srv-1', method: 'ui.doSomething', params: {} });
    expect(JSON.parse(socket().sent[0]!)).toEqual({
      jsonrpc: '2.0',
      id: 'srv-1',
      error: { code: -32601, message: 'Method not found' },
    });
  });

  it('queues requests made while connecting and flushes them on open', async () => {
    const { client, socket } = setup();
    client.connect();
    const promise = client.call('app.info');
    expect(socket().sent).toHaveLength(0);
    socket().open();
    expect(socket().sent).toHaveLength(1);
    expect(socket().lastRequest().method).toBe('app.info');
    socket().receive({ jsonrpc: '2.0', id: 1, result: { version: 'x' } });
    await expect(promise).resolves.toEqual({ version: 'x' });
  });

  it('rejects immediately when the client was never connected or was closed', async () => {
    const { client } = setup();
    await expect(client.call('app.info')).rejects.toMatchObject({
      code: RpcErrorCode.clientDisconnected,
    });
    client.connect();
    client.close();
    await expect(client.call('app.info')).rejects.toMatchObject({
      code: RpcErrorCode.clientDisconnected,
    });
  });

  describe('jobs', () => {
    it('runJob returns the direct result when the method did not start a job', async () => {
      const { client, socket } = setup();
      client.connect();
      socket().open();
      const promise = client.runJob('doc.validate', { docId: 'd1' });
      socket().receive({
        jsonrpc: '2.0',
        id: 1,
        result: { issues: [], errorCount: 0, warningCount: 0, durationMs: 1 },
      });
      await expect(promise).resolves.toEqual({
        issues: [],
        errorCount: 0,
        warningCount: 0,
        durationMs: 1,
      });
    });

    it('runJob waits for job.done and forwards job.progress', async () => {
      const { client, socket } = setup();
      client.connect();
      socket().open();
      const progress: unknown[] = [];
      const promise = client.runJob(
        'doc.open',
        { path: '/big.fb2' },
        { onProgress: (p) => progress.push(p) },
      );
      socket().receive({ jsonrpc: '2.0', id: 1, result: { jobId: 'job-7' } });
      await flush();
      socket().receive({
        jsonrpc: '2.0',
        method: 'job.progress',
        params: { jobId: 'job-7', phase: 'parse', done: 1, total: 2 },
      });
      socket().receive({
        jsonrpc: '2.0',
        method: 'job.progress',
        params: { jobId: 'other', phase: 'parse', done: 1, total: 2 },
      });
      socket().receive({
        jsonrpc: '2.0',
        method: 'job.done',
        params: { jobId: 'job-7', result: { document: { docId: 'd9' }, warnings: [] } },
      });
      await expect(promise).resolves.toEqual({ document: { docId: 'd9' }, warnings: [] });
      expect(progress).toEqual([{ jobId: 'job-7', phase: 'parse', done: 1, total: 2 }]);
    });

    it('runJob rejects with the job.failed error', async () => {
      const { client, socket } = setup();
      client.connect();
      socket().open();
      const promise = client.runJob('doc.save', { docId: 'd1', document: {} as never });
      socket().receive({ jsonrpc: '2.0', id: 1, result: { jobId: 'job-1' } });
      await flush();
      socket().receive({
        jsonrpc: '2.0',
        method: 'job.failed',
        params: { jobId: 'job-1', error: { code: 1090, message: 'cancelled' } },
      });
      await expect(promise).rejects.toMatchObject({ code: RpcErrorCode.cancelled });
    });

    it('waitForJob resolves even when job.done arrived before anybody waited', async () => {
      const { client, socket } = setup();
      client.connect();
      socket().open();
      socket().receive({
        jsonrpc: '2.0',
        method: 'job.done',
        params: { jobId: 'early', result: 42 },
      });
      await expect(client.waitForJob('early')).resolves.toBe(42);
      // claimed exactly once
      const second = client.waitForJob('early');
      socket().receive({
        jsonrpc: '2.0',
        method: 'job.done',
        params: { jobId: 'early', result: 43 },
      });
      await expect(second).resolves.toBe(43);
    });

    it('fails waiting jobs when the connection drops', async () => {
      const { client, socket } = setup();
      client.connect();
      socket().open();
      const promise = client.waitForJob('job-x');
      socket().serverClose();
      await expect(promise).rejects.toMatchObject({ code: RpcErrorCode.clientDisconnected });
    });
  });

  describe('reconnect', () => {
    it('rejects pending requests and reconnects with exponential backoff', async () => {
      const { client, sockets, socket, statuses } = setup();
      client.connect();
      socket().open();
      const pending = client.call('app.info');
      socket().serverClose();
      await expect(pending).rejects.toMatchObject({ code: RpcErrorCode.clientDisconnected });
      expect(client.status).toBe('disconnected');
      expect(sockets).toHaveLength(1);

      vi.advanceTimersByTime(99);
      expect(sockets).toHaveLength(1);
      vi.advanceTimersByTime(1); // 100 ms: first retry
      expect(sockets).toHaveLength(2);
      expect(client.status).toBe('connecting');

      socket().serverClose(); // retry fails
      vi.advanceTimersByTime(199);
      expect(sockets).toHaveLength(2);
      vi.advanceTimersByTime(1); // 200 ms: second retry (doubled)
      expect(sockets).toHaveLength(3);

      socket().serverClose();
      vi.advanceTimersByTime(400); // capped at maxMs
      expect(sockets).toHaveLength(4);

      socket().serverClose();
      vi.advanceTimersByTime(399);
      expect(sockets).toHaveLength(4);
      vi.advanceTimersByTime(1);
      expect(sockets).toHaveLength(5);

      socket().open(); // success resets the backoff
      expect(client.status).toBe('connected');
      expect(client.reconnectAttempts).toBe(0);
      socket().serverClose();
      vi.advanceTimersByTime(100);
      expect(sockets).toHaveLength(6);

      expect(statuses[0]).toBe('connecting');
      expect(statuses).toContain('disconnected');
      expect(statuses.filter((s) => s === 'connected')).toHaveLength(2);
    });

    it('queues requests during the backoff wait and sends them once reconnected', async () => {
      const { client, socket } = setup();
      client.connect();
      socket().open();
      socket().serverClose();
      const promise = client.call('app.info');
      vi.advanceTimersByTime(100);
      socket().open();
      expect(socket().lastRequest().method).toBe('app.info');
      socket().receive({ jsonrpc: '2.0', id: 1, result: { version: 'v' } });
      await expect(promise).resolves.toEqual({ version: 'v' });
    });

    it('does not reconnect after close() and tells the socket to close', () => {
      const { client, sockets, socket } = setup();
      client.connect();
      socket().open();
      client.close();
      expect(socket().closedByClient).toBe(true);
      expect(client.status).toBe('disconnected');
      vi.advanceTimersByTime(10_000);
      expect(sockets).toHaveLength(1);
    });

    it('does not reconnect when reconnect is disabled', () => {
      const { client, sockets, socket } = setup({ reconnect: false });
      client.connect();
      socket().open();
      socket().serverClose();
      vi.advanceTimersByTime(10_000);
      expect(sockets).toHaveLength(1);
      expect(client.status).toBe('disconnected');
    });

    it('connect() after close() opens a fresh socket', () => {
      const { client, sockets, socket } = setup();
      client.connect();
      socket().open();
      client.close();
      client.connect();
      expect(sockets).toHaveLength(2);
      expect(client.status).toBe('connecting');
    });
  });
});

describe('resolveCoreUrl / resolveToken', () => {
  it('takes the token from the page URL first', () => {
    expect(resolveToken({ pageUrl: 'http://127.0.0.1:4123/?token=abc', buildToken: 'build' })).toBe(
      'abc',
    );
    expect(resolveToken({ pageUrl: 'http://127.0.0.1:4123/', buildToken: 'build' })).toBe('build');
  });

  it('derives ws://host/rpc?token= from the page location', () => {
    expect(resolveCoreUrl({ pageUrl: 'http://127.0.0.1:4123/?token=abc', buildToken: '' })).toBe(
      'ws://127.0.0.1:4123/rpc?token=abc',
    );
  });

  it('uses wss for https pages and omits an empty token', () => {
    expect(resolveCoreUrl({ pageUrl: 'https://localhost:8443/index.html', buildToken: '' })).toBe(
      'wss://localhost:8443/rpc',
    );
  });

  it('honours the dev override of the core origin', () => {
    expect(
      resolveCoreUrl({
        pageUrl: 'http://127.0.0.1:5173/',
        coreOrigin: 'http://127.0.0.1:41237',
        buildToken: 'devtoken',
      }),
    ).toBe('ws://127.0.0.1:41237/rpc?token=devtoken');
  });
});
