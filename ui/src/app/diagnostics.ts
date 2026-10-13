/**
 * UI side of the errors-only diagnostics log (FR-131, T152).
 *
 * The core writes `<data dir>/logs/mfbe-errors.log`; the UI appends through the `log.error`
 * RPC. Rules shared by every caller:
 *  - best effort: logging never throws and never blocks the user flow;
 *  - never book text: messages and context carry identifiers (docId, path, command id, codes)
 *    and the error's own message, not document content or the page URL (it holds the token);
 *  - one line per failure: errors the core already reported (an `RpcError` with a server code)
 *    are logged by the core, so callers only log client-side failures (`isClientSideError`).
 *
 * `installGlobalErrorLogging` catches what no handler caught: uncaught exceptions and
 * unhandled promise rejections (rate limited so a render loop cannot flood the log).
 */

import type { AppStore } from '@/model/store';
import { RpcError, type RpcClient } from '@/rpc/client';
import { RpcErrorCode } from '@/rpc/types';

export interface UiLogEntry {
  /** Stable code such as `file.saveFailed` or `ui.unhandledError`. */
  code: string;
  message: string;
  stack?: string;
  context?: Record<string, string | number | boolean | undefined>;
  /** `ui` (default) or `script`. */
  source?: string;
}

/** Appends one entry to the errors-only log; swallows every failure. */
export async function logUiError(rpc: RpcClient | null, entry: UiLogEntry): Promise<void> {
  if (!rpc) return;
  const context: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry.context ?? {})) {
    if (value !== undefined) context[key] = String(value);
  }
  try {
    await rpc.call('log.error', {
      source: entry.source ?? 'ui',
      code: entry.code,
      message: entry.message,
      stack: entry.stack,
      context,
    });
  } catch {
    // the log is best effort
  }
}

/**
 * True when `error` did not come from the core: plain exceptions and the client's own RPC
 * errors (timeout, disconnection, malformed response). Server errors are logged by the core.
 */
export function isClientSideError(error: unknown): boolean {
  if (!(error instanceof RpcError)) return true;
  return (
    error.code === RpcErrorCode.clientTimeout ||
    error.code === RpcErrorCode.clientDisconnected ||
    error.code === RpcErrorCode.clientInvalidResponse
  );
}

/** Message and stack of an arbitrary thrown value, without the page URL. */
export function describeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message || error.name, stack: error.stack };
  }
  if (typeof error === 'string') return { message: error };
  try {
    return { message: JSON.stringify(error) ?? String(error) };
  } catch {
    return { message: String(error) };
  }
}

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;

/**
 * Logs uncaught exceptions (`error` events) and unhandled promise rejections with the current
 * document id and view as context. Returns the uninstall function.
 */
export function installGlobalErrorLogging(
  rpc: RpcClient | null,
  store: AppStore,
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> | null = typeof window ===
  'undefined'
    ? null
    : window,
): () => void {
  if (!rpc || !target) return () => {};
  const recent: number[] = [];
  let lastKey = '';
  let lastAt = 0;

  const report = (code: string, error: unknown, fallback: string) => {
    const now = Date.now();
    while (recent.length > 0 && now - recent[0]! > RATE_WINDOW_MS) recent.shift();
    if (recent.length >= RATE_LIMIT) return;
    const { message, stack } = describeError(error);
    const text = message || fallback;
    // Identical errors fired in a burst (event handlers re-rendering) are logged once.
    const key = `${code}:${text}`;
    if (key === lastKey && now - lastAt < 2000) return;
    lastKey = key;
    lastAt = now;
    recent.push(now);
    const state = store.getState();
    void logUiError(rpc, {
      code,
      message: text,
      stack,
      context: { docId: state.docId ?? undefined, view: state.activeView },
    });
  };

  const onError = (event: ErrorEvent) => {
    report('ui.unhandledError', event.error ?? event.message, 'uncaught error');
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    report('ui.unhandledRejection', event.reason, 'unhandled promise rejection');
  };
  target.addEventListener('error', onError as EventListener);
  target.addEventListener('unhandledrejection', onRejection as EventListener);
  return () => {
    target.removeEventListener('error', onError as EventListener);
    target.removeEventListener('unhandledrejection', onRejection as EventListener);
  };
}
