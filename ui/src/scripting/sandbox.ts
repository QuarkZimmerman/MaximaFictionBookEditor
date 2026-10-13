/**
 * Sandbox building blocks shared by the worker bootstrap (`sandbox.worker.ts`) and the unit
 * tests: the list of globals scrubbed before user code runs (script-manifest.md §3), the
 * scrubbing routine, the request/response bridge over the host's private MessagePort, the
 * `mfbe` object exposed to scripts (script-api.d.ts, nothing more) and the error -> line/column
 * mapping. This module must stay free of DOM and host imports: it is bundled into the worker.
 */

import type {
  ApiMethod,
  ButtonSpec,
  HostMessage,
  ScriptContextData,
  ScriptErrorInfo,
  WorkerMessage,
} from './types';

/* ------------------------------------------------------------------------ */
/* Globals                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * Removed from the worker global scope (and its prototype chain) before the entry module is
 * imported. The contract list plus the worker's own messaging surface (`postMessage`,
 * `onmessage`, `close`) so user code can neither reach the network nor talk to the host except
 * through `mfbe` (the bridge port is held in a closure).
 */
export const BLOCKED_GLOBALS: readonly string[] = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'importScripts',
  'Worker',
  'SharedWorker',
  'indexedDB',
  'caches',
  'navigator',
  'BroadcastChannel',
  'MessageChannel',
  'MessagePort',
  'OffscreenCanvas',
  'WebTransport',
  'RTCPeerConnection',
  'Notification',
  'postMessage',
  'onmessage',
  'onmessageerror',
  'close',
];

/** Properties of other globals that leak host details (Chrome's `performance.memory`). */
export const BLOCKED_MEMBERS: readonly [owner: string, member: string][] = [
  ['Performance', 'memory'],
];

function removeFromChain(root: object, name: string): boolean {
  let removed = false;
  let target: object | null = root;
  while (target) {
    if (Object.prototype.hasOwnProperty.call(target, name)) {
      const descriptor = Object.getOwnPropertyDescriptor(target, name);
      if (descriptor?.configurable) {
        delete (target as Record<string, unknown>)[name];
        removed = true;
      } else {
        try {
          Object.defineProperty(target, name, { value: undefined, writable: false });
          removed = true;
        } catch {
          // non-configurable, non-writable: shadowed on the global below
        }
      }
    }
    target = Object.getPrototypeOf(target) as object | null;
  }
  return removed;
}

/**
 * Deletes every blocked global from `global` and its prototype chain, then pins an
 * `undefined` own property so later code cannot restore it. Returns the names that are still
 * reachable afterwards (for diagnostics; empty in Chromium).
 */
export function scrubGlobals(
  global: object,
  names: readonly string[] = BLOCKED_GLOBALS,
  members: readonly [string, string][] = BLOCKED_MEMBERS,
): string[] {
  const g = global as Record<string, unknown>;
  for (const name of names) {
    removeFromChain(global, name);
    try {
      Object.defineProperty(global, name, {
        value: undefined,
        writable: false,
        configurable: false,
        enumerable: false,
      });
    } catch {
      // already non-configurable
    }
  }
  for (const [owner, member] of members) {
    const ctor = g[owner];
    const proto = typeof ctor === 'function' ? (ctor as { prototype?: object }).prototype : null;
    if (proto) removeFromChain(proto, member);
    const instance = g[owner.toLowerCase()];
    if (instance && typeof instance === 'object') removeFromChain(instance, member);
  }
  const reachable: string[] = [];
  for (const name of names) {
    let value: unknown;
    try {
      value = g[name];
    } catch {
      value = undefined;
    }
    if (value !== undefined) reachable.push(name);
  }
  return reachable;
}

/* ------------------------------------------------------------------------ */
/* Bridge                                                                   */
/* ------------------------------------------------------------------------ */

export interface PortLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  start?(): void;
}

export interface Bridge {
  /** Calls a host capability; rejects with the host's error message. */
  call(method: ApiMethod, args: unknown[]): Promise<unknown>;
  /** Posts a worker -> host message. */
  post(message: WorkerMessage): void;
  /** Handles host -> worker messages that are not call results (`run`, `cancel`). */
  onHostMessage(handler: (message: HostMessage) => void): void;
  /** True once the host asked for cancellation. */
  readonly cancelRequested: boolean;
}

/** Request/response multiplexer over the private port. */
export function createBridge(port: PortLike): Bridge {
  let nextId = 1;
  let cancelRequested = false;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let handler: ((message: HostMessage) => void) | null = null;
  const queued: HostMessage[] = [];

  port.addEventListener('message', (event) => {
    const message = event.data as HostMessage;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'result' || message.type === 'error') {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.type === 'error') {
        // Host-side API errors keep their name and machine-readable `code` (e.g. `invalidNode`)
        // so a script can tell a schema violation from its own bugs.
        const error = new Error(message.message) as Error & { code?: string };
        if (message.name) error.name = message.name;
        if (message.code) error.code = message.code;
        entry.reject(error);
      } else {
        entry.resolve(message.json ? JSON.parse(message.value as string) : message.value);
      }
      return;
    }
    if (message.type === 'cancel') cancelRequested = true;
    if (handler) handler(message);
    else queued.push(message);
  });
  port.start?.();

  return {
    call(method, args) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        port.postMessage({ type: 'call', id, method, args } satisfies WorkerMessage);
      });
    },
    post(message) {
      port.postMessage(message);
    },
    onHostMessage(next) {
      handler = next;
      for (const message of queued.splice(0)) next(message);
    },
    get cancelRequested() {
      return cancelRequested;
    },
  };
}

/* ------------------------------------------------------------------------ */
/* The mfbe object                                                          */
/* ------------------------------------------------------------------------ */

/** VBScript MsgBox button flags -> button ids (vbOKOnly ... vbRetryCancel). */
const MSGBOX_BUTTONS: Record<number, string[]> = {
  0: ['ok'],
  1: ['ok', 'cancel'],
  2: ['abort', 'retry', 'ignore'],
  3: ['yes', 'no', 'cancel'],
  4: ['yes', 'no'],
  5: ['retry', 'cancel'],
};

/** VBScript MsgBox return values. */
const MSGBOX_RESULTS: Record<string, number> = {
  ok: 1,
  cancel: 2,
  abort: 3,
  retry: 4,
  ignore: 5,
  yes: 6,
  no: 7,
};

export function msgBoxButtons(flags: number): ButtonSpec[] {
  const ids = MSGBOX_BUTTONS[flags & 0x0f] ?? MSGBOX_BUTTONS[0]!;
  const defaultIndex = flags & 0x200 ? 2 : flags & 0x100 ? 1 : 0;
  return ids.map((id, index) => ({
    id,
    label: '',
    default: index === Math.min(defaultIndex, ids.length - 1),
    cancel: id === 'cancel' || (ids.length === 1 && id === 'ok'),
  }));
}

export function msgBoxIcon(flags: number): 'info' | 'warning' | 'error' | 'question' | undefined {
  switch (flags & 0xf0) {
    case 16:
      return 'error';
    case 32:
      return 'question';
    case 48:
      return 'warning';
    case 64:
      return 'info';
    default:
      return undefined;
  }
}

export function msgBoxResult(buttonId: string): number {
  return MSGBOX_RESULTS[buttonId] ?? 1;
}

export interface MfbeObject {
  readonly version: 1;
  readonly doc: Record<string, (...args: unknown[]) => Promise<unknown>>;
  readonly selection: Record<string, (...args: unknown[]) => Promise<unknown>>;
  readonly ui: Record<string, (...args: unknown[]) => Promise<unknown>>;
  readonly edit: {
    label(text: string): Promise<void>;
    readonly nbsp: '\u00A0';
    readonly symbols: () => Promise<unknown>;
  };
  readonly env: Record<string, (...args: unknown[]) => Promise<unknown>>;
  MsgBox(text: string, caption?: string, flags?: number): Promise<number>;
  InputBox(prompt: string, caption?: string, defaultValue?: string): Promise<string | null>;
  BeginUndoUnit(label?: string): Promise<void>;
  EndUndoUnit(): Promise<void>;
}

const DOC_METHODS = [
  'get',
  'getNode',
  'replaceNode',
  'insertNode',
  'removeNode',
  'setDescription',
  'getElementsByTagName',
  'textOf',
  'setText',
  'parentOf',
  'childrenOf',
  'find',
  'replaceAll',
  'binaries',
  'stats',
] as const;
const SELECTION_METHODS = [
  'get',
  'set',
  'replaceText',
  'wrap',
  'unwrap',
  'selectNode',
  'scrollIntoView',
] as const;
const UI_METHODS = ['message', 'prompt', 'form', 'status', 'progress'] as const;
const ENV_METHODS = ['settings', 'docLanguage'] as const;

function section(
  bridge: Bridge,
  prefix: string,
  methods: readonly string[],
): Record<string, (...args: unknown[]) => Promise<unknown>> {
  const out: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const name of methods) {
    const method = `${prefix}.${name}` as ApiMethod;
    out[name] = (...args: unknown[]) => bridge.call(method, args);
  }
  return Object.freeze(out);
}

/** Builds the frozen `mfbe` object over the bridge (every member is a host round trip). */
export function createMfbe(bridge: Bridge): MfbeObject {
  const ui = section(bridge, 'ui', UI_METHODS);
  const mfbe: MfbeObject = {
    version: 1,
    doc: section(bridge, 'doc', DOC_METHODS),
    selection: section(bridge, 'selection', SELECTION_METHODS),
    ui,
    edit: Object.freeze({
      label: (text: string) => bridge.call('edit.label', [text]).then(() => undefined),
      nbsp: '\u00A0' as const,
      symbols: () => bridge.call('edit.symbols', []),
    }),
    env: section(bridge, 'env', ENV_METHODS),
    async MsgBox(text: string, caption?: string, flags = 0): Promise<number> {
      const pressed = await ui.message!(String(text), {
        caption,
        buttons: msgBoxButtons(flags),
        icon: msgBoxIcon(flags),
      });
      return msgBoxResult(String(pressed));
    },
    async InputBox(prompt: string, caption?: string, defaultValue?: string) {
      const value = await ui.prompt!(String(prompt), { caption, defaultValue });
      return value === null || value === undefined ? null : String(value);
    },
    BeginUndoUnit: () => Promise.resolve(),
    EndUndoUnit: () => Promise.resolve(),
  };
  return Object.freeze(mfbe);
}

/** The `ctx` object handed to `run(ctx)`; `cancelled` reads the bridge flag live. */
export function createContext(bridge: Bridge, data: ScriptContextData) {
  return Object.freeze({
    script: Object.freeze({ ...data.script }),
    uiLanguage: data.uiLanguage,
    treeNode: data.treeNode ? Object.freeze({ ...data.treeNode }) : undefined,
    get cancelled() {
      return bridge.cancelRequested;
    },
  });
}

/* ------------------------------------------------------------------------ */
/* Errors                                                                   */
/* ------------------------------------------------------------------------ */

const FRAME_RE = /((?:https?|blob):[^\s()]+?):(\d+):(\d+)\)?\s*$/;

export interface ErrorLocation {
  line: number;
  column: number;
  /** Package-relative file (`index.js`, `lib/util.js`). */
  file: string;
}

/**
 * Finds the first stack frame inside the script package (`packageUrl` = the folder URL of the
 * entry module) and returns its line/column. Chromium prints `at fn (url:line:col)` and
 * `at async fn (url:line:col)` frames; frames of the bootstrap (blob:) are skipped.
 */
export function parseErrorLocation(
  stack: string | undefined,
  packageUrl: string,
): ErrorLocation | null {
  if (!stack) return null;
  for (const raw of stack.split('\n')) {
    const match = FRAME_RE.exec(raw.trim());
    if (!match) continue;
    const url = match[1]!;
    if (!url.startsWith(packageUrl)) continue;
    const file = decodeURIComponent(url.slice(packageUrl.length));
    return { line: Number(match[2]), column: Number(match[3]), file };
  }
  return null;
}

/** Firefox-style own properties (`lineNumber`/`columnNumber`) as a fallback. */
function ownLocation(error: unknown): { line: number; column: number } | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as { lineNumber?: unknown; columnNumber?: unknown };
  if (typeof e.lineNumber === 'number' && typeof e.columnNumber === 'number') {
    return { line: e.lineNumber, column: e.columnNumber };
  }
  return null;
}

/** Serialises any thrown value into the structured-cloneable error report. */
export function describeError(error: unknown, entryUrl: string): ScriptErrorInfo {
  const packageUrl = entryUrl.slice(0, entryUrl.lastIndexOf('/') + 1);
  const entryFile = decodeURIComponent(entryUrl.slice(packageUrl.length));
  if (error instanceof Error) {
    const info: ScriptErrorInfo = { name: error.name || 'Error', message: error.message };
    if (typeof error.stack === 'string') info.stack = error.stack;
    const location: ErrorLocation | null =
      parseErrorLocation(error.stack, packageUrl) ??
      (() => {
        const own = ownLocation(error);
        return own ? { ...own, file: entryFile } : null;
      })();
    if (location) {
      info.line = location.line;
      info.column = location.column;
      if (location.file && location.file !== entryFile) info.file = location.file;
    }
    return info;
  }
  return { name: 'Error', message: typeof error === 'string' ? error : String(error) };
}
