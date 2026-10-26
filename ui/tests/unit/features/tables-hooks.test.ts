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
import { FIXED_BLOCK_IDS } from '@/editor/schema';
import { actions, createAppStore } from '@/model/store';
import { UndoCoordinator } from '@/model/undo';

import { fakeRpc, fakeRunLock } from './testUtils';
import {
  caretIn,
  modelTable,
  removeHarnessHosts,
  tableDocument,
  tablesHarness,
} from './tablesHarness';

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

describe('placementSweep (US1, I27; C79)', () => {
  /** A book with an annotation block, a body title, an empty paragraph and a table. */
  function placementDocument(): Document {
    const base = tableDocument();
    const text = (value: string) => [{ type: 'text', text: value }];
    base.bodies[0]!.content = [
      {
        type: 'title',
        attrs: { nodeId: 'bt' },
        content: [{ type: 'p', attrs: { nodeId: 'btp' }, content: text('Book') }],
      },
      {
        type: 'section',
        attrs: { nodeId: 's1' },
        content: [
          { type: 'p', attrs: { nodeId: 'p1' }, content: text('Before') },
          { type: 'p', attrs: { nodeId: 'pe' }, content: [] },
          modelTable('t1', 2, 2),
          { type: 'p', attrs: { nodeId: 'p2' }, content: text('After') },
        ],
      },
    ] as never;
    return {
      ...base,
      description: {
        ...base.description,
        titleInfo: {
          ...base.description.titleInfo,
          annotation: {
            type: 'annotation',
            attrs: { nodeId: 'a1' },
            content: [{ type: 'p', attrs: { nodeId: 'ap' }, content: text('Annotation') }],
          } as AnnotationNode,
        },
      },
    };
  }

  afterEach(() => {
    removeHarnessHosts();
  });

  it('is not installed without ?test=1 or a core that asks for it', () => {
    createAppServices({ store: createAppStore(), rpc: null, platform: 'linux' });
    expect(window.__mfbeTest?.tables).toBeUndefined();
  });

  it('answers the registry’s state, the reason and the landing in model terms; restores the selection and changes nothing', async () => {
    window.history.replaceState(null, '', '/?test=1');
    const harness = await tablesHarness(placementDocument());
    const sweep = hooks()!.placementSweep;
    expect(typeof sweep).toBe('function');
    caretIn(harness, 'p2', 2);
    const selection = harness.controller.editorState!.selection;
    const doc = harness.controller.editorState!.doc;
    const model = harness.store.getState().document;
    const positions = [
      { nodeId: 'btp', offset: 2 },
      { nodeId: 'p1', offset: 0 },
      { nodeId: 'p1', offset: 3 },
      { nodeId: 'p1', offset: 6 },
      { nodeId: 'pe', offset: 0 },
      { nodeId: 'ap', offset: 10 },
      { nodeId: 't1-0-0', offset: 1 },
    ];
    const answers = sweep(positions);
    expect(answers).toEqual([
      { pos: positions[0], enabled: false, reason: 'noTablePlace', landing: null },
      {
        pos: positions[1],
        enabled: true,
        reason: null,
        landing: { kind: 'insert', parent: 's1', after: null },
      },
      {
        pos: positions[2],
        enabled: true,
        reason: null,
        landing: { kind: 'split', node: 'p1', offset: 3 },
      },
      {
        pos: positions[3],
        enabled: true,
        reason: null,
        landing: { kind: 'insert', parent: 's1', after: 'p1' },
      },
      { pos: positions[4], enabled: true, reason: null, landing: { kind: 'replace', node: 'pe' } },
      {
        pos: positions[5],
        enabled: true,
        reason: null,
        landing: { kind: 'insert', parent: FIXED_BLOCK_IDS.annotation, after: 'ap' },
      },
      {
        pos: positions[6],
        enabled: true,
        reason: null,
        landing: { kind: 'insert', parent: 's1', after: 't1' },
      },
    ]);
    // `enabled` is the registry's state at each point.
    caretIn(harness, 'btp', 2);
    expect(harness.services.commands.isEnabled('insert.table', harness.ctx)).toBe(false);
    caretIn(harness, 'pe', 0);
    expect(harness.services.commands.isEnabled('insert.table', harness.ctx)).toBe(true);
    // The selection it found is back; the document is unchanged.
    caretIn(harness, 'p2', 2);
    const again = harness.controller.editorState!.selection;
    sweep(positions);
    expect(harness.controller.editorState!.selection.eq(again)).toBe(true);
    expect(again.eq(selection)).toBe(true);
    expect(harness.controller.editorState!.doc).toBe(doc);
    expect(harness.store.getState().document).toBe(model);
    // Under the run lock: the lock's code.
    actions.setRunLock(harness.store, fakeRunLock('script'));
    expect(sweep([{ nodeId: 'p1', offset: 3 }])[0]).toMatchObject({
      enabled: false,
      reason: 'runLock.script',
    });
  });

  it('throws for a point whose text block is not in the Body editor’s document', async () => {
    window.history.replaceState(null, '', '/?test=1');
    await tablesHarness(placementDocument());
    const sweep = hooks()!.placementSweep;
    expect(() => sweep([{ nodeId: 'nope', offset: 0 }])).toThrow();
    expect(() => sweep([{ nodeId: 's1', offset: 0 }])).toThrow();
  });
});
