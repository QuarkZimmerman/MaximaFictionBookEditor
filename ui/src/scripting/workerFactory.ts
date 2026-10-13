/**
 * Creates the sandbox worker. Kept in its own module so the host (`host.ts`) can be unit
 * tested with a fake worker: the `?worker&inline` import makes Vite bundle the worker as an
 * inline blob (same origin, inherits the page CSP - see sandbox.worker.ts).
 */

import SandboxWorker from './sandbox.worker?worker&inline';

export function createSandboxWorker(): Worker {
  return new SandboxWorker({ name: 'mfbe-script' });
}
