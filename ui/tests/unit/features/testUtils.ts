/**
 * Shared fakes for the feature tests: an RPC client answering from a table (with `on()` for
 * notifications and `runJob()` like the real client), a `Dialogs` implementation answering
 * message boxes and custom dialogs from queues, and a minimal Document factory.
 */

import { createInstance } from 'i18next';
import { isValidElement, type ReactNode } from 'react';

import type { CommandContext } from '@/app/commands';
import { createCommandRegistry } from '@/app/commands';
import { HotkeyMap } from '@/app/hotkeys';
import type { Dialogs, MessageBoxOptions } from '@/dialogs/types';
import { initI18n } from '@/i18n';
import { CaretRegistry } from '@/model/caret';
import type { Document } from '@/model/document';
import { createAppStore } from '@/model/store';
import { UndoCoordinator } from '@/model/undo';
import { RpcClient, RpcError } from '@/rpc/client';
import type { MessageButtonId, RpcNotificationName, RpcNotifications } from '@/rpc/types';

export type Responder = unknown | ((params: unknown) => unknown);

export interface FakeRpc {
  client: RpcClient;
  calls: { method: string; params: unknown }[];
  responses: Record<string, Responder>;
  /** Emits a server notification to the subscribers. */
  notify<N extends RpcNotificationName>(name: N, payload: RpcNotifications[N]): void;
}

export function rpcError(code: number, message: string, data?: unknown): RpcError {
  return new RpcError(code, message, data);
}

export function fakeRpc(responses: Record<string, Responder> = {}): FakeRpc {
  const calls: { method: string; params: unknown }[] = [];
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const respond = (method: string, params: unknown) => {
    calls.push({ method, params });
    if (!(method in responses)) {
      return Promise.reject(new RpcError(-32601, `Method not found: ${method}`));
    }
    const response = responses[method];
    const value =
      typeof response === 'function' ? (response as (p: unknown) => unknown)(params) : response;
    if (value instanceof Error) return Promise.reject(value);
    return Promise.resolve(value);
  };
  const client = {
    call: respond,
    request: respond,
    runJob: respond,
    status: 'connected',
    connect: () => {},
    close: () => {},
    onStatus: () => () => {},
    on: (name: string, handler: (payload: unknown) => void) => {
      let set = listeners.get(name);
      if (!set) {
        set = new Set();
        listeners.set(name, set);
      }
      set.add(handler);
      return () => {
        set!.delete(handler);
      };
    },
  } as unknown as RpcClient;
  return {
    client,
    calls,
    responses,
    notify: (name, payload) => {
      for (const handler of listeners.get(name) ?? []) handler(payload);
    },
  };
}

export interface FakeDialogs extends Dialogs {
  shown: MessageBoxOptions[];
  /** Custom dialogs opened (component display name + props). */
  custom: { name: string; props: Record<string, unknown> }[];
  messageAnswers: MessageButtonId[];
  customAnswers: unknown[];
}

export function fakeDialogs(
  messageAnswers: MessageButtonId[] = [],
  customAnswers: unknown[] = [],
): FakeDialogs {
  const dialogs: FakeDialogs = {
    shown: [],
    custom: [],
    messageAnswers: [...messageAnswers],
    customAnswers: [...customAnswers],
    showMessage: (options) => {
      dialogs.shown.push(options);
      return Promise.resolve(dialogs.messageAnswers.shift() ?? 'ok');
    },
    showMessageWithResult: (options) => {
      dialogs.shown.push(options);
      return Promise.resolve({
        button: dialogs.messageAnswers.shift() ?? 'ok',
        dontAskAgain: false,
      });
    },
    showInput: () => Promise.resolve({ button: 'cancel', value: '' }),
    openCustom: <T>(render: (close: (result: T) => void) => ReactNode) => {
      const element = render(() => {});
      const name =
        isValidElement(element) && typeof element.type === 'function'
          ? ((element.type as { displayName?: string; name: string }).displayName ??
            (element.type as { name: string }).name)
          : 'unknown';
      const props = isValidElement(element) ? (element.props as Record<string, unknown>) : {};
      dialogs.custom.push({ name, props });
      return Promise.resolve(dialogs.customAnswers.shift() as T);
    },
  };
  return dialogs;
}

export function fakeDocument(overrides: Partial<Document> = {}): Document {
  return {
    modelVersion: 1,
    docId: 'doc-1',
    path: '/books/alpha.fb2',
    fileKind: 'fb2',
    sourceEncoding: 'windows-1251',
    schemaHint: '2.1',
    stylesheets: [],
    description: {
      titleInfo: {
        genres: [{ code: 'sf' }],
        authors: [{ firstName: 'Ivan', lastName: 'Petrov', homePages: [], emails: [] }],
        bookTitle: 'Alpha',
        coverpage: [],
        lang: 'en',
        translators: [],
        sequences: [],
      },
      documentInfo: {
        authors: [{ nickname: 'maker', homePages: [], emails: [] }],
        date: { text: '2026' },
        srcUrls: [],
        id: 'id',
        version: '1.0',
        publishers: [],
      },
      customInfo: [],
      outputs: [],
    },
    bodies: [
      {
        type: 'body',
        attrs: { nodeId: 'n1' },
        content: [
          {
            type: 'section',
            attrs: { nodeId: 'n2' },
            content: [
              { type: 'p', attrs: { nodeId: 'n3' }, content: [{ type: 'text', text: 'Hello' }] },
            ],
          },
        ],
      },
    ],
    binaries: [],
    extras: [],
    ...overrides,
  };
}

export const CLEAN_REPORT = { issues: [], errorCount: 0, warningCount: 0, durationMs: 1 };

export async function makeContext(
  overrides: Partial<CommandContext> = {},
): Promise<CommandContext & { dialogs: FakeDialogs }> {
  const i18n = await initI18n({ instance: createInstance(), react: false, language: 'en' });
  const dialogs = (overrides.dialogs as FakeDialogs | undefined) ?? fakeDialogs();
  const ctx: CommandContext & { dialogs: FakeDialogs } = {
    store: createAppStore(),
    rpc: null,
    undo: new UndoCoordinator(),
    hotkeys: new HotkeyMap('linux'),
    carets: new CaretRegistry(),
    t: i18n.t,
    version: '0.1.0-test',
    ...overrides,
    dialogs,
  };
  return ctx;
}

export { createCommandRegistry };

/**
 * The calls a feature flow made, without the background traffic of always-on features (the
 * spell checker probes its dictionaries as soon as the Body editor is installed).
 */
export function flowCalls(rpc: FakeRpc): { method: string; params: unknown }[] {
  return rpc.calls.filter((c) => !c.method.startsWith('spell.'));
}
