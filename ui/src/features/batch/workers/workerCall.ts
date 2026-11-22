/**
 * Feature 019 (T024): cancellable Web Worker RPC wrapper. Terminates the worker immediately on
 * AbortSignal so cancelled batch items wind down within milliseconds and never leak threads.
 */

export class WorkerCancelledError extends Error {
  constructor() {
    super('Batch worker cancelled');
    this.name = 'WorkerCancelledError';
  }
}

export interface WorkerProgressEvent {
  done: number;
  total: number;
  stage?: string;
}

export type WorkerOutboundMessage<TResult> =
  | { type: 'progress'; done: number; total: number; stage?: string }
  | { type: 'request'; id: number; payload: unknown }
  | { type: 'result'; data: TResult }
  | { type: 'error'; message: string };

/**
 * Per-batch pool of stateless Web Workers so multi-book runs avoid cold-starting and re-parsing
 * worker bundles for every single file. Any worker that errors or is aborted is terminated
 * immediately; `dispose()` terminates all idle workers and prevents future reuse.
 */
export class BatchWorkerPool {
  private readonly idle = new Map<string, Worker[]>();
  private disposed = false;

  acquire(key: string, createWorker: () => Worker): Worker {
    if (!this.disposed) {
      const bucket = this.idle.get(key);
      const cached = bucket?.pop();
      if (cached) return cached;
    }
    return createWorker();
  }

  release(key: string, worker: Worker): void {
    if (this.disposed) {
      worker.terminate();
      return;
    }
    let bucket = this.idle.get(key);
    if (!bucket) {
      bucket = [];
      this.idle.set(key, bucket);
    }
    bucket.push(worker);
  }

  dispose(): void {
    this.disposed = true;
    for (const bucket of this.idle.values()) {
      for (const worker of bucket) {
        worker.terminate();
      }
    }
    this.idle.clear();
  }
}

/**
 * Sends `payload` to a dedicated (or pooled) `Worker`, streams optional `progress` events,
 * resolves with `TResult`, and terminates the worker on error or abort (returning healthy workers
 * to `options.pool` when provided, or terminating immediately otherwise).
 */
export function runWorkerTask<TPayload, TResult>(
  createWorker: () => Worker,
  payload: TPayload,
  options: {
    signal?: AbortSignal;
    onProgress?: (event: WorkerProgressEvent) => void;
    onRequest?: (payload: unknown) => Promise<unknown>;
    transfer?: Transferable[];
    pool?: { pool: BatchWorkerPool; key: string };
  } = {},
): Promise<TResult> {
  if (options.signal?.aborted) {
    return Promise.reject(new WorkerCancelledError());
  }
  return new Promise<TResult>((resolve, reject) => {
    const worker = options.pool
      ? options.pool.pool.acquire(options.pool.key, createWorker)
      : createWorker();
    let settled = false;

    const cleanup = (reusable: boolean) => {
      options.signal?.removeEventListener('abort', onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      if (reusable && options.pool) {
        options.pool.pool.release(options.pool.key, worker);
      } else {
        worker.terminate();
      }
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup(false);
      reject(new WorkerCancelledError());
    };

    options.signal?.addEventListener('abort', onAbort, { once: true });

    worker.onmessage = (event: MessageEvent<WorkerOutboundMessage<TResult>>) => {
      if (settled) return;
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'progress') {
        options.onProgress?.({ done: msg.done, total: msg.total, stage: msg.stage });
        return;
      }
      if (msg.type === 'request') {
        const handler = options.onRequest;
        if (!handler) {
          worker.postMessage({
            type: 'response',
            id: msg.id,
            ok: false,
            message: 'Worker request handler not configured',
          });
          return;
        }
        void handler(msg.payload).then(
          (data) => {
            if (!settled && !options.signal?.aborted) {
              worker.postMessage({ type: 'response', id: msg.id, ok: true, data });
            }
          },
          (error: unknown) => {
            if (!settled && !options.signal?.aborted) {
              worker.postMessage({
                type: 'response',
                id: msg.id,
                ok: false,
                message: error instanceof Error ? error.message : String(error),
              });
            }
          },
        );
        return;
      }
      if (msg.type === 'result') {
        settled = true;
        cleanup(true);
        resolve(msg.data);
        return;
      }
      if (msg.type === 'error') {
        settled = true;
        cleanup(false);
        reject(new Error(msg.message || 'Worker failed'));
      }
    };

    worker.onerror = (event: ErrorEvent) => {
      if (settled) return;
      settled = true;
      cleanup(false);
      reject(new Error(event.message || 'Worker runtime error'));
    };

    worker.onmessageerror = () => {
      if (settled) return;
      settled = true;
      cleanup(false);
      reject(new Error('Worker message serialization error'));
    };

    try {
      if (options.transfer && options.transfer.length > 0) {
        worker.postMessage(payload, options.transfer);
      } else {
        worker.postMessage(payload);
      }
    } catch (error) {
      if (!settled) {
        settled = true;
        cleanup(false);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  });
}
