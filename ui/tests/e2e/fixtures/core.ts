/**
 * Playwright fixtures for the end-to-end journeys.
 *
 * Two modes, chosen per worker:
 *  - **core mode** (`MFBE_CORE_BIN=/path/to/mfbe-core`): starts
 *    `mfbe-core serve --test-hooks --data-dir <tmp> --ui <MFBE_UI_DIST or ../dist>`, parses the
 *    single JSON ready line `{"port","token","pid"}` from its stdout and exposes
 *    `baseURL = http://127.0.0.1:<port>/?token=<token>`, an `rpc()` helper (Node WebSocket,
 *    JSON-RPC 2.0) and `enqueueDialog()` (`test.enqueueDialog`). One core per worker, isolated
 *    data directory, killed on teardown.
 *  - **core-less mode** (no binary): the UI bundle is served by `vite preview` through the
 *    `webServer` entry of playwright.config.ts (or by `MFBE_UI_URL`); `core.hasCore` is false and
 *    the RPC helpers throw. UI-only specs still run; specs needing the core call
 *    `test.skip(!core.hasCore, ...)`.
 *
 * Optional: `MFBE_RESOURCES` (passed as `--resources`), `MFBE_CORE_LOG_LEVEL` (`--log-level`).
 * Fixture books live in `tests/fixtures/books/` at the repository root (`fixtureBook(name)`).
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test as base, expect, type Page } from '@playwright/test';

export { expect };

const UI_DIR = fileURLToPath(new URL('../../..', import.meta.url));
const REPO_ROOT = path.resolve(UI_DIR, '..');

/** Absolute path of a fixture book under `tests/fixtures/books/`. */
/** The window title of the editor without a document. */
export const APP_TITLE = 'Maxima Fiction Book Editor';

/**
 * Waits for the new document the editor shows at start-up when no file was named (feature
 * 002): tests that switch views or start editing act on it.
 */
export async function waitForStartupDocument(page: Page): Promise<void> {
  await expect(page).toHaveTitle(`Untitled - ${APP_TITLE}`);
}

/**
 * Resolves once `file` is the open document (its name heads the window title). After File >
 * Open an assertion on the editor alone would also match the start-up document.
 */
export async function waitForBook(page: Page, file: string, timeout?: number): Promise<void> {
  const name = path.basename(file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await expect(page).toHaveTitle(new RegExp(`^${name}\\*? - `), { timeout });
}

/** Id of the document the Body view shows (null without one). */
function shownDocId(page: Page): Promise<string | null> {
  return page.evaluate<string | null>(
    `document.querySelector('[data-testid="body-view"]')?.getAttribute('data-doc-id') ?? null`,
  );
}

/**
 * File > New from the menu; resolves once its document replaced the one shown before. The
 * editor starts with a new document (feature 002), which an assertion on the editor alone
 * would also match.
 */
export async function fileNew(page: Page): Promise<void> {
  await expect(page).not.toHaveTitle(APP_TITLE);
  await expect.poll(() => shownDocId(page)).not.toBeNull();
  const before = await shownDocId(page);
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-new').click();
  await expect.poll(() => shownDocId(page)).not.toBe(before);
  await expect.poll(() => shownDocId(page)).not.toBeNull();
}

export function fixtureBook(name: string): string {
  return path.join(REPO_ROOT, 'tests', 'fixtures', 'books', name);
}

export const PREVIEW_PORT = Number(process.env.MFBE_PREVIEW_PORT ?? 4173);
export const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}/`;

export interface ReadyLine {
  port: number;
  token: string;
  pid: number;
}

/** Parses the core's ready line; returns null for any other output line. */
export function parseReadyLine(line: string): ReadyLine | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const value = JSON.parse(trimmed) as Partial<ReadyLine>;
    if (typeof value.port === 'number' && typeof value.token === 'string') {
      return { port: value.port, token: value.token, pid: value.pid ?? 0 };
    }
  } catch {
    // not JSON
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/* Minimal JSON-RPC client over Node's WebSocket                            */
/* ------------------------------------------------------------------------ */

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  method?: string;
  params?: unknown;
}

export class RpcCallError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'RpcCallError';
  }
}

export class NodeRpcClient {
  private socket: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readonly notificationListeners = new Set<(method: string, params: unknown) => void>();

  constructor(private readonly url: string) {}

  async connect(): Promise<void> {
    if (this.socket) return;
    const socket = new WebSocket(this.url);
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error(`cannot connect to ${this.url}`)), {
        once: true,
      });
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as JsonRpcResponse;
      if (typeof message.method === 'string' && message.id === undefined) {
        for (const listener of this.notificationListeners) listener(message.method, message.params);
        return;
      }
      if (typeof message.id !== 'number') return;
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) {
        entry.reject(
          new RpcCallError(message.error.code, message.error.message, message.error.data),
        );
      } else {
        entry.resolve(message.result);
      }
    });
    socket.addEventListener('close', () => {
      for (const entry of this.pending.values()) entry.reject(new Error('connection closed'));
      this.pending.clear();
      this.socket = null;
    });
  }

  async call<T = unknown>(method: string, params?: unknown, timeoutMs = 30_000): Promise<T> {
    await this.connect();
    const id = this.nextId++;
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    });
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: no response within ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.socket!.send(payload);
    });
  }

  onNotification(listener: (method: string, params: unknown) => void): () => void {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}

/** Calls `method`; when the core answers `{jobId}` waits for the matching job notification. */
export async function runJob<T>(
  client: NodeRpcClient,
  method: string,
  params?: unknown,
  timeoutMs = 60_000,
): Promise<T> {
  const first = await client.call<unknown>(method, params, timeoutMs);
  const jobId =
    typeof first === 'object' &&
    first !== null &&
    typeof (first as { jobId?: unknown }).jobId === 'string'
      ? (first as { jobId: string }).jobId
      : null;
  if (!jobId) return first as T;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`${method}: job ${jobId} did not finish within ${timeoutMs} ms`));
    }, timeoutMs);
    const off = client.onNotification((name, payload) => {
      const data = payload as {
        jobId?: string;
        result?: unknown;
        error?: { code: number; message: string; data?: unknown };
      };
      if (data?.jobId !== jobId) return;
      if (name === 'job.done') {
        clearTimeout(timer);
        off();
        resolve(data.result as T);
      } else if (name === 'job.failed') {
        clearTimeout(timer);
        off();
        reject(
          new RpcCallError(
            data.error?.code ?? -32603,
            data.error?.message ?? 'job failed',
            data.error?.data,
          ),
        );
      }
    });
  });
}

/* ------------------------------------------------------------------------ */
/* Core process                                                             */
/* ------------------------------------------------------------------------ */

export interface CoreServer {
  hasCore: boolean;
  baseURL: string;
  port?: number;
  token?: string;
  dataDir?: string;
  binary?: string;
  rpcClient?: NodeRpcClient;
  stop(): Promise<void>;
}

async function startCore(binary: string): Promise<CoreServer> {
  const uiDist = process.env.MFBE_UI_DIST ?? path.join(UI_DIR, 'dist');
  if (!existsSync(path.join(uiDist, 'index.html'))) {
    throw new Error(`UI bundle not found at ${uiDist}; run "npm run build" first`);
  }
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mfbe-e2e-'));
  const args = ['serve', '--test-hooks', '--data-dir', dataDir, '--ui', uiDist];
  if (process.env.MFBE_RESOURCES) args.push('--resources', process.env.MFBE_RESOURCES);
  if (process.env.MFBE_CORE_LOG_LEVEL) args.push('--log-level', process.env.MFBE_CORE_LOG_LEVEL);

  const child = spawn(binary, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MFBE_E2E: '1' },
  });
  const stderr: string[] = [];
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr.push(chunk);
    if (stderr.length > 200) stderr.shift();
  });

  const ready = await new Promise<ReadyLine>((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      reject(new Error(`mfbe-core did not print its ready line within 30 s\n${stderr.join('')}`));
    }, 30_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const parsed = parseReadyLine(line);
        if (parsed) {
          clearTimeout(timer);
          resolve(parsed);
          return;
        }
        newline = buffer.indexOf('\n');
      }
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(
          `mfbe-core exited before becoming ready (code ${code}, signal ${signal})\n${stderr.join('')}`,
        ),
      );
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`cannot start ${binary}: ${error.message}`));
    });
  });

  const rpcClient = new NodeRpcClient(`ws://127.0.0.1:${ready.port}/rpc?token=${ready.token}`);
  return {
    hasCore: true,
    baseURL: `http://127.0.0.1:${ready.port}/?token=${encodeURIComponent(ready.token)}`,
    port: ready.port,
    token: ready.token,
    dataDir,
    binary,
    rpcClient,
    async stop() {
      rpcClient.close();
      if (child.exitCode === null && !child.killed) {
        const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
        child.kill('SIGTERM');
        const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5_000));
        await Promise.race([exited, timeout]);
        if (child.exitCode === null) child.kill('SIGKILL');
      }
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

/**
 * Starts a second core with extra `serve` arguments (the worker fixture has no hook for them).
 * Returns its page URL, RPC-less; stopped by the returned function.
 */
export async function startCoreWith(
  binary: string,
  dataDir: string,
  extraArgs: string[],
): Promise<{ url: string; stop: () => Promise<void> }> {
  const uiDist = process.env.MFBE_UI_DIST ?? path.join(UI_DIR, 'dist');
  const child = spawn(
    binary,
    ['serve', '--test-hooks', '--data-dir', dataDir, '--ui', uiDist, ...extraArgs],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const stderr: string[] = [];
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => stderr.push(chunk));
  const ready = await new Promise<{ port: number; token: string }>((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(
      () => reject(new Error(`second core not ready in 30 s\n${stderr.join('')}`)),
      30_000,
    );
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      for (const line of buffer.split('\n')) {
        const parsed = parseReadyLine(line);
        if (parsed) {
          clearTimeout(timer);
          resolve(parsed);
          return;
        }
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`second core exited with ${code}\n${stderr.join('')}`));
    });
  });
  return {
    url: `http://127.0.0.1:${ready.port}/?token=${encodeURIComponent(ready.token)}`,
    stop: async () => {
      if (child.exitCode === null) {
        const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
        child.kill('SIGTERM');
        await Promise.race([exited, new Promise<void>((r) => setTimeout(r, 5_000))]);
        if (child.exitCode === null) child.kill('SIGKILL');
      }
    },
  };
}

function coreLessServer(): CoreServer {
  return {
    hasCore: false,
    baseURL: process.env.MFBE_UI_URL ?? PREVIEW_URL,
    stop: async () => {},
  };
}

/* ------------------------------------------------------------------------ */
/* Fixtures                                                                 */
/* ------------------------------------------------------------------------ */

export interface CoreHandle {
  /** False in core-less mode (no `MFBE_CORE_BIN`). */
  hasCore: boolean;
  /** Page URL including the session token. */
  baseURL: string;
  port?: number;
  token?: string;
  dataDir?: string;
  /** JSON-RPC call to the core (throws in core-less mode). */
  rpc<T = unknown>(method: string, params?: unknown): Promise<T>;
  /** Like `rpc()` but resolves a `{jobId}` answer through `job.done` / `job.failed`. */
  rpcJob<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T>;
  /** Pre-answers the next native dialog of `method` (`dialog.openFile`, `dialog.saveFile`...). */
  enqueueDialog(method: string, result: unknown): Promise<void>;
  /** Navigates the page to the application and waits for the shell to render. */
  openApp(page: Page): Promise<void>;
}

export const test = base.extend<{ core: CoreHandle }, { coreServer: CoreServer }>({
  coreServer: [
    // Playwright requires the object-destructuring form even without dependencies.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const binary = process.env.MFBE_CORE_BIN;
      const server = binary ? await startCore(binary) : coreLessServer();
      await use(server);
      await server.stop();
    },
    { scope: 'worker' },
  ],

  baseURL: async ({ coreServer }, use) => {
    await use(coreServer.baseURL);
  },

  core: async ({ coreServer }, use) => {
    const requireCore = (): NodeRpcClient => {
      if (!coreServer.rpcClient) {
        throw new Error('This test needs mfbe-core: set MFBE_CORE_BIN=/path/to/mfbe-core');
      }
      return coreServer.rpcClient;
    };
    const handle: CoreHandle = {
      hasCore: coreServer.hasCore,
      baseURL: coreServer.baseURL,
      port: coreServer.port,
      token: coreServer.token,
      dataDir: coreServer.dataDir,
      rpc: (method, params) => requireCore().call(method, params),
      rpcJob: (method, params, timeoutMs) => runJob(requireCore(), method, params, timeoutMs),
      enqueueDialog: async (method, result) => {
        await requireCore().call('test.enqueueDialog', { method, result });
      },
      openApp: async (page) => {
        await page.goto(coreServer.baseURL);
        await page.getByTestId('app-root').waitFor();
      },
    };
    await use(handle);
  },
});
