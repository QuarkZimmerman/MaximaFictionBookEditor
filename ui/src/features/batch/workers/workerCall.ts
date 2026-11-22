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
  | { type: 'result'; data: TResult }
  | { type: 'error'; message: string };

/**
 * Sends `payload` to a freshly created dedicated `Worker`, streams optional `progress` events,
 * resolves with `TResult`, and always terminates the worker on completion, error, or abort.
 */
export function runWorkerTask<TPayload, TResult>(
  createWorker: () => Worker,
  payload: TPayload,
  options: {
    signal?: AbortSignal;
    onProgress?: (event: WorkerProgressEvent) => void;
    transfer?: Transferable[];
  } = {},
): Promise<TResult> {
  if (options.signal?.aborted) {
    return Promise.reject(new WorkerCancelledError());
  }
  return new Promise<TResult>((resolve, reject) => {
    const worker = createWorker();
    let settled = false;

    const cleanup = () => {
      options.signal?.removeEventListener('abort', onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
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
      if (msg.type === 'result') {
        settled = true;
        cleanup();
        resolve(msg.data);
        return;
      }
      if (msg.type === 'error') {
        settled = true;
        cleanup();
        reject(new Error(msg.message || 'Worker failed'));
      }
    };

    worker.onerror = (event: ErrorEvent) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(event.message || 'Worker runtime error'));
    };

    worker.onmessageerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
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
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  });
}
