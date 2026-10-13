/**
 * T099 - sandbox building blocks: the globals of script-manifest.md §3 are scrubbed from the
 * global object and its prototype chain, the `mfbe` object exposes exactly the contract
 * surface (every member a bridge round trip, legacy façade included), the bridge multiplexes
 * calls / results / errors / JSON payloads and tracks cancellation, and script errors are
 * mapped to a line/column inside the package from Chromium stack traces.
 */

import {
  BLOCKED_GLOBALS,
  createBridge,
  createContext,
  createMfbe,
  describeError,
  msgBoxButtons,
  parseErrorLocation,
  scrubGlobals,
  type PortLike,
} from '@/scripting/sandbox';
import type { HostMessage, WorkerMessage } from '@/scripting/types';

/** A fake worker global with the dangerous members spread over the prototype chain. */
function fakeGlobal() {
  const workerGlobalScopeProto = {
    fetch() {
      return 'fetched';
    },
    importScripts() {},
    get navigator() {
      return { userAgent: 'x' };
    },
  };
  const dedicatedProto = Object.create(workerGlobalScopeProto) as Record<string, unknown>;
  Object.defineProperty(dedicatedProto, 'postMessage', { value() {}, configurable: true });
  Object.defineProperty(dedicatedProto, 'onmessage', {
    get: () => null,
    set: () => {},
    configurable: true,
  });
  dedicatedProto.close = () => {};
  const global = Object.create(dedicatedProto) as Record<string, unknown>;
  global.XMLHttpRequest = function XMLHttpRequest() {};
  global.WebSocket = function WebSocket() {};
  global.EventSource = function EventSource() {};
  global.Worker = function Worker() {};
  global.SharedWorker = function SharedWorker() {};
  global.indexedDB = {};
  global.caches = {};
  global.BroadcastChannel = function BroadcastChannel() {};
  global.MessageChannel = function MessageChannel() {};
  global.OffscreenCanvas = function OffscreenCanvas() {};
  global.setTimeout = () => 0;
  global.console = { log() {} };
  global.JSON = JSON;
  function Performance() {}
  Object.defineProperty(Performance.prototype, 'memory', {
    get: () => ({ usedJSHeapSize: 1 }),
    configurable: true,
  });
  global.Performance = Performance;
  global.performance = new (Performance as unknown as new () => object)();
  return global;
}

describe('scrubGlobals', () => {
  it('removes every blocked global from the object and its prototype chain', () => {
    const global = fakeGlobal();
    expect(typeof global.fetch).toBe('function');
    const reachable = scrubGlobals(global);
    expect(reachable).toEqual([]);
    for (const name of BLOCKED_GLOBALS) {
      expect(global[name], name).toBeUndefined();
    }
    // The prototype chain no longer provides them either (no `proto.fetch.call(self)`).
    let proto = Object.getPrototypeOf(global) as Record<string, unknown> | null;
    while (proto && proto !== Object.prototype) {
      for (const name of BLOCKED_GLOBALS) {
        expect(Object.prototype.hasOwnProperty.call(proto, name), name).toBe(false);
      }
      proto = Object.getPrototypeOf(proto) as Record<string, unknown> | null;
    }
    // Pinned: user code cannot restore them.
    const descriptor = Object.getOwnPropertyDescriptor(global, 'fetch');
    expect(descriptor?.writable).toBe(false);
    expect(descriptor?.configurable).toBe(false);
    expect(() => {
      'use strict';
      global.fetch = () => 'restored';
    }).toThrow();
    // performance.memory is gone, the rest of performance stays.
    expect((global.performance as { memory?: unknown }).memory).toBeUndefined();
    // Harmless globals survive.
    expect(typeof global.setTimeout).toBe('function');
    expect(typeof global.console).toBe('object');
    expect(global.JSON).toBe(JSON);
  });

  it('covers the list of script-manifest.md §3', () => {
    for (const name of [
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
      'OffscreenCanvas',
    ]) {
      expect(BLOCKED_GLOBALS).toContain(name);
    }
  });
});

/* ------------------------------------------------------------------------ */

class FakePort implements PortLike {
  sent: WorkerMessage[] = [];
  started = false;
  private listeners: ((event: { data: unknown }) => void)[] = [];
  postMessage(message: unknown) {
    this.sent.push(message as WorkerMessage);
  }
  addEventListener(_type: 'message', listener: (event: { data: unknown }) => void) {
    this.listeners.push(listener);
  }
  start() {
    this.started = true;
  }
  /** Delivers a host message. */
  receive(message: HostMessage) {
    for (const listener of this.listeners) listener({ data: message });
  }
  lastCall() {
    const call = [...this.sent].reverse().find((m) => m.type === 'call');
    if (!call || call.type !== 'call') throw new Error('no call sent');
    return call;
  }
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('bridge and mfbe object', () => {
  it('exposes exactly the contract surface and nothing else', () => {
    const port = new FakePort();
    const mfbe = createMfbe(createBridge(port));
    expect(Object.isFrozen(mfbe)).toBe(true);
    expect(Object.keys(mfbe).sort()).toEqual(
      [
        'version',
        'doc',
        'selection',
        'ui',
        'edit',
        'env',
        'MsgBox',
        'InputBox',
        'BeginUndoUnit',
        'EndUndoUnit',
      ].sort(),
    );
    expect(mfbe.version).toBe(1);
    expect(Object.keys(mfbe.doc).sort()).toEqual(
      [
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
      ].sort(),
    );
    expect(Object.keys(mfbe.selection).sort()).toEqual(
      ['get', 'set', 'replaceText', 'wrap', 'unwrap', 'selectNode', 'scrollIntoView'].sort(),
    );
    expect(Object.keys(mfbe.ui).sort()).toEqual(
      ['message', 'prompt', 'form', 'status', 'progress'].sort(),
    );
    expect(Object.keys(mfbe.edit).sort()).toEqual(['label', 'nbsp', 'symbols'].sort());
    expect(mfbe.edit.nbsp).toBe('\u00A0');
    expect(Object.keys(mfbe.env).sort()).toEqual(['settings', 'docLanguage'].sort());
    expect(Object.isFrozen(mfbe.doc)).toBe(true);
    expect(port.started).toBe(true);
  });

  it('turns every member into a call and resolves it from the host result', async () => {
    const port = new FakePort();
    const mfbe = createMfbe(createBridge(port));
    const pending = mfbe.doc.textOf!('n1');
    expect(port.lastCall()).toEqual({ type: 'call', id: 1, method: 'doc.textOf', args: ['n1'] });
    port.receive({ type: 'result', id: 1, value: 'Hello' });
    await expect(pending).resolves.toBe('Hello');

    // JSON payloads (large snapshots) are parsed in the worker.
    const snapshot = mfbe.doc.get!();
    port.receive({ type: 'result', id: 2, value: '{"docId":"d1"}', json: true });
    await expect(snapshot).resolves.toEqual({ docId: 'd1' });

    // Host errors reject with the message.
    const failing = mfbe.doc.getNode!('nope');
    port.receive({ type: 'error', id: 3, message: 'getNode: unknown nodeId "nope"' });
    await expect(failing).rejects.toThrow('unknown nodeId');

    // Unknown ids are ignored, other calls keep working.
    port.receive({ type: 'result', id: 99, value: 1 });
    const settings = mfbe.env.settings!();
    port.receive({ type: 'result', id: 4, value: { uiLanguage: 'ru' } });
    await expect(settings).resolves.toEqual({ uiLanguage: 'ru' });

    // ScriptApiError keeps its name and machine-readable code across the bridge.
    const invalid = mfbe.doc.insertNode!('after', 'n1', { type: 'section' });
    port.receive({
      type: 'error',
      id: 5,
      message: 'insertNode: invalid node at "section": Invalid content for node section',
      name: 'ScriptApiError',
      code: 'invalidNode',
    });
    await expect(invalid).rejects.toMatchObject({
      name: 'ScriptApiError',
      code: 'invalidNode',
      message: expect.stringContaining('invalid node at "section"'),
    });
  });

  it('maps the legacy façade onto ui.message / ui.prompt and no-ops the undo units', async () => {
    const port = new FakePort();
    const mfbe = createMfbe(createBridge(port));
    const answer = mfbe.MsgBox('Continue?', 'Fixture', 4 + 32);
    const call = port.lastCall();
    expect(call.method).toBe('ui.message');
    expect(call.args[0]).toBe('Continue?');
    const options = call.args[1] as {
      caption: string;
      icon: string;
      buttons: { id: string; default?: boolean }[];
    };
    expect(options.caption).toBe('Fixture');
    expect(options.icon).toBe('question');
    expect(options.buttons.map((b) => b.id)).toEqual(['yes', 'no']);
    port.receive({ type: 'result', id: call.id, value: 'yes' });
    await expect(answer).resolves.toBe(6);

    const noAnswer = mfbe.MsgBox('x');
    const second = port.lastCall();
    expect((second.args[1] as { buttons: { id: string }[] }).buttons.map((b) => b.id)).toEqual([
      'ok',
    ]);
    port.receive({ type: 'result', id: second.id, value: 'ok' });
    await expect(noAnswer).resolves.toBe(1);

    const input = mfbe.InputBox('Text:', 'Caption', 'default');
    const prompt = port.lastCall();
    expect(prompt.method).toBe('ui.prompt');
    expect(prompt.args).toEqual(['Text:', { caption: 'Caption', defaultValue: 'default' }]);
    port.receive({ type: 'result', id: prompt.id, value: null });
    await expect(input).resolves.toBeNull();

    const before = port.sent.length;
    await mfbe.BeginUndoUnit('x');
    await mfbe.EndUndoUnit();
    expect(port.sent.length).toBe(before);

    // vbYesNoCancel + default second button, vbAbortRetryIgnore.
    expect(msgBoxButtons(3 + 256).map((b) => `${b.id}${b.default ? '*' : ''}`)).toEqual([
      'yes',
      'no*',
      'cancel',
    ]);
    expect(msgBoxButtons(2).map((b) => b.id)).toEqual(['abort', 'retry', 'ignore']);
  });

  it('delivers run / cancel messages and reflects cancellation in ctx.cancelled', async () => {
    const port = new FakePort();
    const bridge = createBridge(port);
    const received: HostMessage[] = [];
    port.receive({ type: 'cancel' }); // queued until a handler exists
    bridge.onHostMessage((m) => received.push(m));
    expect(received).toEqual([{ type: 'cancel' }]);
    const ctx = createContext(bridge, {
      script: { id: 'a', name: 'A', group: 'g', kind: 'menu' },
      uiLanguage: 'en',
      treeNode: { nodeId: 'n1', type: 'section' },
    });
    expect(ctx.cancelled).toBe(true);
    expect(ctx.script).toEqual({ id: 'a', name: 'A', group: 'g', kind: 'menu' });
    expect(ctx.treeNode).toEqual({ nodeId: 'n1', type: 'section' });
    expect(Object.isFrozen(ctx)).toBe(true);
    await flush();
  });
});

/* ------------------------------------------------------------------------ */

describe('error mapping', () => {
  const entry = 'http://127.0.0.1:4100/scripts/test.errors.throws/index.js';
  const pkg = 'http://127.0.0.1:4100/scripts/test.errors.throws/';

  it('finds the first frame inside the package (sync and async frames, nested files)', () => {
    const stack = [
      'Error: boom',
      '    at run (http://127.0.0.1:4100/scripts/test.errors.throws/index.js:4:9)',
      '    at async http://127.0.0.1:4100/scripts/test.errors.throws/index.js:9:3',
      '    at blob:http://127.0.0.1:4100/abc-def:12:5',
    ].join('\n');
    expect(parseErrorLocation(stack, pkg)).toEqual({ line: 4, column: 9, file: 'index.js' });

    const helper = [
      'TypeError: x is not a function',
      '    at blob:http://127.0.0.1:4100/abc:1:1',
      '    at helper (http://127.0.0.1:4100/scripts/test.errors.throws/lib/util.js:12:17)',
      '    at async run (http://127.0.0.1:4100/scripts/test.errors.throws/index.js:3:3)',
    ].join('\n');
    expect(parseErrorLocation(helper, pkg)).toEqual({ line: 12, column: 17, file: 'lib/util.js' });

    const other = 'Error: x\n    at http://127.0.0.1:4100/scripts/other.script/index.js:2:2';
    expect(parseErrorLocation(other, pkg)).toBeNull();
    expect(parseErrorLocation(undefined, pkg)).toBeNull();
    expect(parseErrorLocation('Error: no frames', pkg)).toBeNull();
  });

  it('describes thrown values for the host', () => {
    const error = new Error('boom');
    error.stack = `Error: boom\n    at run (${entry}:4:9)`;
    expect(describeError(error, entry)).toMatchObject({
      name: 'Error',
      message: 'boom',
      line: 4,
      column: 9,
    });
    expect(describeError(error, entry).file).toBeUndefined();

    const nested = new RangeError('bad');
    nested.stack = `RangeError: bad\n    at f (${pkg}lib/x.js:7:2)`;
    expect(describeError(nested, entry)).toMatchObject({
      name: 'RangeError',
      message: 'bad',
      line: 7,
      column: 2,
      file: 'lib/x.js',
    });

    const syntax = new SyntaxError("Unexpected token '}'");
    syntax.stack = "SyntaxError: Unexpected token '}'";
    const described = describeError(syntax, entry);
    expect(described.line).toBeUndefined();
    expect(described.message).toBe("Unexpected token '}'");

    expect(describeError('plain string', entry)).toEqual({
      name: 'Error',
      message: 'plain string',
    });
    expect(describeError(42, entry)).toEqual({ name: 'Error', message: '42' });
  });
});
