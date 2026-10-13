/**
 * Script sandbox worker (T102). Created by the host from an inline (blob:) module so it
 * inherits the page's Content-Security-Policy (`script-src 'self'`: only same-origin modules,
 * i.e. the core's `/scripts/...` files, can be imported; `connect-src` keeps the network away
 * even before the scrub).
 *
 * Protocol:
 *  1. the host posts `{type: 'init', port}` on the worker's own channel and transfers one end
 *     of a MessageChannel - the only link to the host; it never leaves this closure;
 *  2. the bootstrap scrubs the globals of script-manifest.md §3 (plus the worker's own
 *     `postMessage`/`onmessage`/`close`), defines the frozen `mfbe` object (and the legacy
 *     `MsgBox` / `InputBox` / `BeginUndoUnit` / `EndUndoUnit` aliases) and reports `ready`;
 *  3. on `{type: 'run', entryUrl, context}` it imports the entry module with `import()`,
 *     calls its default export with the context and reports `done` or `fail` with the error
 *     mapped to a line/column inside the package. Every `mfbe.*` member is a `call` round
 *     trip answered by the host.
 */

import { createBridge, createContext, createMfbe, describeError, scrubGlobals } from './sandbox';
import type { HostMessage, InitMessage, WorkerMessage } from './types';

type RunFunction = (ctx: unknown) => unknown;

interface EntryModule {
  default?: unknown;
  run?: unknown;
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<InitMessage>) => void) | null;
  console?: Console;
};

scope.onmessage = (event: MessageEvent<InitMessage>) => {
  const init = event.data;
  if (!init || init.type !== 'init' || !init.port) return;
  scope.onmessage = null;
  const port = init.port;
  const bridge = createBridge(port);
  const post = (message: WorkerMessage) => bridge.post(message);

  // Route console output to the host (debug mode) instead of leaving it in the worker.
  const console = scope.console;
  if (console) {
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      console[level] = (...args: unknown[]) => {
        try {
          post({ type: 'log', level, args: args.map((a) => (a instanceof Error ? a.message : a)) });
        } catch {
          // non-cloneable arguments are dropped
        }
      };
    }
  }

  const leaked = scrubGlobals(self);
  const mfbe = createMfbe(bridge);
  const globals = self as unknown as Record<string, unknown>;
  const expose = (name: string, value: unknown) =>
    Object.defineProperty(globals, name, {
      value,
      writable: false,
      configurable: false,
      enumerable: false,
    });
  expose('mfbe', mfbe);
  expose('MsgBox', mfbe.MsgBox);
  expose('InputBox', mfbe.InputBox);
  expose('BeginUndoUnit', mfbe.BeginUndoUnit);
  expose('EndUndoUnit', mfbe.EndUndoUnit);
  if (leaked.length > 0) {
    post({ type: 'log', level: 'warn', args: ['sandbox: still reachable', leaked] });
  }

  let started = false;
  bridge.onHostMessage((message: HostMessage) => {
    if (message.type !== 'run' || started) return;
    started = true;
    const { entryUrl, context } = message;
    const ctx = createContext(bridge, context);
    void (async () => {
      try {
        const module = (await import(/* @vite-ignore */ entryUrl)) as EntryModule;
        const run = (module.default ?? module.run) as RunFunction | undefined;
        if (typeof run !== 'function') {
          throw new TypeError('the entry module must export a default async function run(ctx)');
        }
        await run(ctx);
        post({ type: 'done' });
      } catch (error) {
        post({ type: 'fail', error: describeError(error, entryUrl) });
      }
    })();
  });

  post({ type: 'ready' });
};
