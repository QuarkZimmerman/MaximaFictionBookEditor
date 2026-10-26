/**
 * The tables feature's test hooks (feature 006, T041; I27; data-model §16.4): none without
 * `?test=1` or a core that asks for them; `__mfbeTest.tables.grid(tableRef)` gives the summary
 * of a table in a body, in both annotations and in the history, null for an unknown reference.
 */

import { createAppServices, type FeatureContext } from '@/app/services';
import { createCommandRegistry } from '@/app/commands';
import { HotkeyMap } from '@/app/hotkeys';
import { registerTablesFeature } from '@/features/tables';
import { installTablesTestHooks, type TablesTestHooks } from '@/features/tables/testHooks';
import { CaretRegistry } from '@/model/caret';
import type { AnnotationNode, Document } from '@/model/document';
import { actions, createAppStore } from '@/model/store';
import { UndoCoordinator } from '@/model/undo';

import { fakeRpc } from './testUtils';
import { modelTable, tableDocument } from './tablesHarness';

function hooks(): TablesTestHooks | undefined {
  return window.__mfbeTest?.tables as TablesTestHooks | undefined;
}

function annotationWith(nodeId: string, tableId: string): AnnotationNode {
  return {
    type: 'annotation',
    attrs: { nodeId },
    content: [modelTable(tableId, 1, 2)],
  } as AnnotationNode;
}

/** A book with tables in a body, the book's annotation, the source annotation and the history. */
function bookWithTables(): Document {
  const base = tableDocument();
  const irregular = modelTable('t2', 2, 3);
  irregular.content[1]!.content.pop();
  irregular.attrs.id = 'named';
  base.bodies[0]!.content.push({
    type: 'section',
    attrs: { nodeId: 's2' },
    content: [irregular],
  } as never);
  return {
    ...base,
    description: {
      ...base.description,
      titleInfo: { ...base.description.titleInfo, annotation: annotationWith('a1', 'ta') },
      srcTitleInfo: { ...base.description.titleInfo, annotation: annotationWith('a2', 'ts') },
      documentInfo: { ...base.description.documentInfo, history: annotationWith('h1', 'th') },
    },
  };
}

/** A fake client that connects when told to, as the real one does after the services exist. */
function connectingRpc(responses: Record<string, unknown>) {
  const fake = fakeRpc(responses);
  const listeners = new Set<(status: string) => void>();
  const client = Object.assign(Object.create(fake.client) as object, {
    status: 'connecting',
    onStatus: (listener: (status: string) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  }) as unknown as typeof fake.client;
  return {
    client,
    calls: fake.calls,
    connect: () => {
      for (const listener of [...listeners]) listener('connected');
    },
  };
}

function featureContext(rpc: FeatureContext['rpc'] = null): FeatureContext {
  return {
    commands: createCommandRegistry(),
    rpc,
    undo: new UndoCoordinator(),
    carets: new CaretRegistry(),
    store: createAppStore(),
    hotkeys: new HotkeyMap('linux'),
  };
}

beforeEach(() => {
  delete window.__mfbeTest;
  window.history.replaceState(null, '', '/');
});

afterAll(() => {
  window.history.replaceState(null, '', '/');
});

describe('the tables test hooks', () => {
  it('are not installed without ?test=1 or a core that asks for them', async () => {
    createAppServices({ store: createAppStore(), rpc: null, platform: 'linux' });
    expect(hooks()).toBeUndefined();
    // A client that is connected already when the feature registers is not asked (unit tests'
    // clients; the real one connects after the services exist), so no call joins their traffic.
    const connected = fakeRpc({ 'app.info': { apiMinor: 5, testHooks: true } });
    registerTablesFeature(featureContext(connected.client));
    await Promise.resolve();
    expect(connected.calls).toEqual([]);
    expect(hooks()).toBeUndefined();
    const quiet = connectingRpc({ 'app.info': { apiMinor: 5, testHooks: false } });
    registerTablesFeature(featureContext(quiet.client));
    expect(quiet.calls).toEqual([]);
    quiet.connect();
    quiet.connect();
    await Promise.resolve();
    await Promise.resolve();
    expect(hooks()).toBeUndefined();
    expect(quiet.calls.map((call) => call.method)).toEqual(['app.info']);
  });

  it('are installed for a page that asks (?test=1) and for a core started with test hooks', async () => {
    window.history.replaceState(null, '', '/?test=1');
    registerTablesFeature(featureContext());
    expect(typeof hooks()?.grid).toBe('function');
    delete window.__mfbeTest;
    window.history.replaceState(null, '', '/');
    const core = connectingRpc({ 'app.info': { apiMinor: 5, testHooks: true } });
    registerTablesFeature(featureContext(core.client));
    expect(hooks()).toBeUndefined();
    core.connect();
    await vi.waitFor(() => expect(typeof hooks()?.grid).toBe('function'));
  });

  it('grid gives the summary of tables in a body, both annotations and the history; null for an unknown reference', () => {
    const ctx = featureContext();
    installTablesTestHooks(ctx);
    expect(hooks()!.grid('t1')).toBeNull(); // no document yet
    actions.setDocument(ctx.store, bookWithTables());
    const regular = { rows: 1, columns: 2, shortRows: 0, overlaps: 0, pastEnd: 0 };
    expect(hooks()!.grid('t1')).toEqual({
      rows: 3,
      columns: 3,
      shortRows: 0,
      overlaps: 0,
      pastEnd: 0,
    });
    expect(hooks()!.grid('t2')).toEqual({
      rows: 2,
      columns: 3,
      shortRows: 1,
      row: 2,
      covered: 2,
      overlaps: 0,
      pastEnd: 0,
      id: 'named',
    });
    expect(hooks()!.grid('ta')).toEqual(regular);
    expect(hooks()!.grid('ts')).toEqual(regular);
    expect(hooks()!.grid('th')).toEqual(regular);
    expect(hooks()!.grid('t1-0-0')).toBeNull();
    expect(hooks()!.grid('nope')).toBeNull();
    // Other hooks on the shared object stay.
    window.__mfbeTest!.other = 1;
    installTablesTestHooks(ctx);
    expect(window.__mfbeTest!.other).toBe(1);
  });
});
