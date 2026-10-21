/**
 * Feature 004 US7 (T060): the switch decisions of the Body <-> Source mapping in `sync.ts`
 * with a fake core - a clean Body -> Source switch maps against the serial of the last
 * serialisation without a new `doc.toXml`, a dirty Source -> Body switch parses first with
 * `positions: true` and maps against the serial the parse returned, `null` answers go to the
 * document's start (Body) or leave the Source where it was, a core answering no serial skips
 * the mapping (release 0.0.3 behaviour), a stale serial (1005) is swallowed, a detour through
 * the Description view maps nothing, and the test switch turns the whole thing off.
 */

import { createInstance } from 'i18next';

import type { CommandContext } from '@/app/commands';
import { createAppServices } from '@/app/services';
import { initI18n } from '@/i18n';
import type { Document } from '@/model/document';
import { actions, createAppStore } from '@/model/store';
import { getBodyController, selectionPoints } from '@/views/body/bodyEditor';
import { sourceEditorFor } from '@/views/source/sourceEditor';
import {
  requestViewSwitch,
  sourceMappingState,
  sourceSession,
  updateSourceText,
} from '@/views/source/sync';

import { fakeDialogs, fakeDocument, fakeRpc, rpcError, type FakeRpc } from '../features/testUtils';

const XML = `<?xml version="1.0"?>
<FictionBook>
  <body>
    <section>
      <p>Hello</p>
    </section>
  </body>
</FictionBook>
`;

/** The parsed document of a dirty commit: fresh ids, as the core reissues them. */
function parsedDocument(): Document {
  return fakeDocument({
    bodies: [
      {
        type: 'body',
        attrs: { nodeId: 'm1' },
        content: [
          {
            type: 'section',
            attrs: { nodeId: 'm2' },
            content: [
              { type: 'p', attrs: { nodeId: 'm3' }, content: [{ type: 'text', text: 'Hullo' }] },
              { type: 'p', attrs: { nodeId: 'm4' }, content: [{ type: 'text', text: 'World' }] },
            ],
          },
        ],
      },
    ],
  });
}

async function harness(responses: Record<string, unknown> = {}) {
  const i18n = await initI18n({ instance: createInstance(), react: false, language: 'en' });
  const store = createAppStore();
  const rpc: FakeRpc = fakeRpc({
    'doc.watch': {},
    'doc.position': {},
    'doc.recent': [],
    'settings.set': { settings: null, restartRequired: false },
    ...responses,
  });
  const services = createAppServices({ store, rpc: rpc.client, platform: 'linux' });
  const ctx: CommandContext = {
    store,
    rpc: rpc.client,
    undo: services.undo,
    dialogs: fakeDialogs(),
    hotkeys: services.hotkeys,
    carets: services.carets,
    t: i18n.t,
    version: 'test',
  };
  actions.setConnection(store, 'connected');
  actions.setDocument(store, fakeDocument());
  const body = getBodyController(store);
  const source = sourceEditorFor(store, services.undo);
  return { ctx, store, rpc, body, source, calls: () => rpc.calls.map((c) => c.method) };
}

/** Loads `text` into the headless Source editor as the serialisation of the current model. */
async function loadSource(
  h: Awaited<ReturnType<typeof harness>>,
  text: string,
  serial: number | null,
) {
  const session = sourceSession(h.store);
  session.docId = h.store.getState().docId;
  session.text = text;
  session.baseline = text;
  session.model = h.store.getState().document;
  session.serial = serial;
  await h.source.load({ ...h.ctx, rpc: null });
  h.rpc.calls.length = 0;
}

function mapCalls(h: Awaited<ReturnType<typeof harness>>) {
  return h.rpc.calls.filter((c) => c.method === 'doc.mapPositions').map((c) => c.params);
}

beforeEach(() => {
  sourceMappingState.enabled = true;
  sourceMappingState.last = null;
});

describe('Body -> Source', () => {
  it('a clean switch reuses the serial of the last serialisation and selects the mapped offsets', async () => {
    const h = await harness({
      'doc.mapPositions': { toSource: [51, 54], toModel: [], durationMs: 0.2 },
    });
    await loadSource(h, XML, 7);
    // The Body caret after "He" in the only paragraph.
    h.body.selectRange('n3', 2, 2);
    expect(selectionPoints(h.body.editorState!)).toEqual({
      anchor: { nodeId: 'n3', offset: 2 },
      head: { nodeId: 'n3', offset: 2 },
    });

    expect(await requestViewSwitch(h.ctx, 'source')).toBe(true);
    expect(sourceSession(h.store).pendingPoints).toEqual({
      anchor: { nodeId: 'n3', offset: 2 },
      head: { nodeId: 'n3', offset: 2 },
    });
    await h.source.load(h.ctx);
    expect(h.calls()).not.toContain('doc.toXml'); // the model did not change: text reused
    expect(mapCalls(h)).toEqual([
      {
        docId: 'doc-1',
        serial: 7,
        toSource: [
          { nodeId: 'n3', offset: 2 },
          { nodeId: 'n3', offset: 2 },
        ],
      },
    ]);
    expect(h.source.selectionOffsets()).toEqual({ anchor: 51, head: 54 });
    expect(sourceSession(h.store).pendingPoints).toBeNull();
    expect(sourceMappingState.last).toMatchObject({
      direction: 'toSource',
      serial: 7,
      coreMs: 0.2,
    });
  });

  it('a changed model is serialised with positions and mapped against the new serial', async () => {
    const h = await harness({
      'doc.toXml': { text: XML.replace('Hello', 'Hallo'), serial: 9 },
      'doc.mapPositions': { toSource: [50, 50], toModel: [], durationMs: 0.1 },
    });
    await loadSource(h, XML, 3);
    const changed = fakeDocument({ path: '/books/beta.fb2' });
    actions.updateDocument(h.store, changed);
    h.body.selectRange('n3', 1, 1);
    expect(await requestViewSwitch(h.ctx, 'source')).toBe(true);
    await h.source.load(h.ctx);
    const toXml = h.rpc.calls.find((c) => c.method === 'doc.toXml');
    expect(toXml?.params).toMatchObject({ docId: 'doc-1', elideBinaries: true, positions: true });
    expect(sourceSession(h.store).serial).toBe(9);
    expect(mapCalls(h)[0]).toMatchObject({ serial: 9 });
    expect(h.source.selectionOffsets()).toEqual({ anchor: 50, head: 50 });
  });

  it('null answers leave the Source at its own position; a missing serial skips the mapping', async () => {
    const h = await harness({
      'doc.mapPositions': { toSource: [null, null], toModel: [], durationMs: 0.1 },
    });
    await loadSource(h, XML, 4);
    h.source.setSelection(10, 10);
    h.body.selectRange('n3', 3, 3);
    expect(await requestViewSwitch(h.ctx, 'source')).toBe(true);
    await h.source.load(h.ctx);
    expect(mapCalls(h)).toHaveLength(1);
    expect(h.source.selectionOffsets()).toEqual({ anchor: 10, head: 10 });

    // No serial (an older core answered none): no doc.mapPositions call at all.
    h.rpc.calls.length = 0;
    actions.setActiveView(h.store, 'body');
    sourceSession(h.store).serial = null;
    expect(await requestViewSwitch(h.ctx, 'source')).toBe(true);
    await h.source.load(h.ctx);
    expect(mapCalls(h)).toHaveLength(0);
    expect(h.source.selectionOffsets()).toEqual({ anchor: 10, head: 10 });
  });

  it('a detour through the Description view maps nothing', async () => {
    const h = await harness({
      'doc.mapPositions': { toSource: [51, 51], toModel: [], durationMs: 0.1 },
    });
    await loadSource(h, XML, 5);
    h.source.setSelection(12, 12);
    h.body.selectRange('n3', 2, 2);
    expect(await requestViewSwitch(h.ctx, 'description')).toBe(true);
    expect(await requestViewSwitch(h.ctx, 'source')).toBe(true);
    expect(sourceSession(h.store).pendingPoints).toBeNull();
    await h.source.load(h.ctx);
    expect(mapCalls(h)).toHaveLength(0);
    expect(h.source.selectionOffsets()).toEqual({ anchor: 12, head: 12 });
  });
});

describe('Source -> Body', () => {
  it('a dirty switch parses with positions first and maps against the serial of the parse', async () => {
    const parsed = parsedDocument();
    const h = await harness({
      'doc.fromXml': { document: parsed, serial: 12 },
      'doc.mapPositions': {
        toSource: [],
        toModel: [
          { nodeId: 'm3', offset: 1 },
          { nodeId: 'm4', offset: 3 },
        ],
        durationMs: 0.3,
      },
    });
    await loadSource(h, XML, 11);
    actions.setActiveView(h.store, 'source');
    const edited = XML.replace('<p>Hello</p>', '<p>Hullo</p>\n      <p>World</p>');
    updateSourceText(h.store, edited);
    h.source.setSelection(50, 70);

    expect(await requestViewSwitch(h.ctx, 'body')).toBe(true);
    const fromXml = h.rpc.calls.find((c) => c.method === 'doc.fromXml');
    expect(fromXml?.params).toEqual({ docId: 'doc-1', text: edited, positions: true });
    expect(sourceSession(h.store).serial).toBe(12);
    expect(mapCalls(h)).toEqual([{ docId: 'doc-1', serial: 12, toModel: [50, 70] }]);
    expect(h.store.getState()).toMatchObject({ activeView: 'body', document: parsed });
    expect(selectionPoints(h.body.editorState!)).toEqual({
      anchor: { nodeId: 'm3', offset: 1 },
      head: { nodeId: 'm4', offset: 3 },
    });
    expect(sourceMappingState.last).toMatchObject({ direction: 'toModel', serial: 12 });
  });

  it('a clean switch maps against the current serial without a parse', async () => {
    const h = await harness({
      'doc.mapPositions': {
        toSource: [],
        toModel: [
          { nodeId: 'n3', offset: 4 },
          { nodeId: 'n3', offset: 4 },
        ],
        durationMs: 0.1,
      },
    });
    await loadSource(h, XML, 6);
    actions.setActiveView(h.store, 'source');
    h.source.setSelection(53, 53);
    expect(await requestViewSwitch(h.ctx, 'body')).toBe(true);
    expect(h.calls()).not.toContain('doc.fromXml');
    expect(mapCalls(h)).toEqual([{ docId: 'doc-1', serial: 6, toModel: [53, 53] }]);
    expect(selectionPoints(h.body.editorState!)).toEqual({
      anchor: { nodeId: 'n3', offset: 4 },
      head: { nodeId: 'n3', offset: 4 },
    });
  });

  it('null points go to the document start: the first text block of the first body', async () => {
    const h = await harness({
      'doc.mapPositions': { toSource: [], toModel: [null, null], durationMs: 0.1 },
    });
    await loadSource(h, XML, 2);
    h.body.selectRange('n3', 3, 3);
    actions.setActiveView(h.store, 'source');
    h.source.setSelection(3, 3);
    expect(await requestViewSwitch(h.ctx, 'body')).toBe(true);
    expect(selectionPoints(h.body.editorState!)).toEqual({
      anchor: { nodeId: 'n3', offset: 0 },
      head: { nodeId: 'n3', offset: 0 },
    });
  });

  it('a missing serial keeps the 0.0.3 behaviour: the remapped Body caret is restored', async () => {
    const parsed = parsedDocument();
    const h = await harness({
      'doc.fromXml': {
        document: parsed,
        remap: { map: { n1: 'm1', n2: 'm2', n3: 'm3' }, unmappedOld: [], unmappedNew: [] },
      },
    });
    await loadSource(h, XML, null);
    sourceSession(h.store).bodyCaret = { view: 'body', nodeId: 'n3', offset: 2 };
    actions.setActiveView(h.store, 'source');
    updateSourceText(h.store, XML.replace('Hello', 'Hullo'));
    expect(await requestViewSwitch(h.ctx, 'body')).toBe(true);
    expect(mapCalls(h)).toHaveLength(0);
    await vi.waitFor(() =>
      expect(selectionPoints(h.body.editorState!)).toEqual({
        anchor: { nodeId: 'm3', offset: 2 },
        head: { nodeId: 'm3', offset: 2 },
      }),
    );
  });

  it('a stale serial (1005) is swallowed and the switch still happens', async () => {
    const h = await harness({
      'doc.mapPositions': rpcError(1005, 'doc.positionsStale', { docId: 'doc-1', serial: 8 }),
    });
    await loadSource(h, XML, 8);
    actions.setActiveView(h.store, 'source');
    expect(await requestViewSwitch(h.ctx, 'body')).toBe(true);
    expect(h.store.getState().activeView).toBe('body');
    expect(sourceMappingState.last).toMatchObject({ direction: 'toModel', coreMs: null });
    expect(sourceMappingState.last?.error).toContain('doc.positionsStale');
  });

  it('the test switch turns the recording and the mapping off', async () => {
    sourceMappingState.enabled = false;
    const h = await harness({
      'doc.toXml': { text: XML },
      'doc.mapPositions': { toSource: [1, 1], toModel: [], durationMs: 0.1 },
    });
    h.body.selectRange('n3', 2, 2);
    expect(await requestViewSwitch(h.ctx, 'source')).toBe(true);
    await h.source.load(h.ctx);
    const toXml = h.rpc.calls.find((c) => c.method === 'doc.toXml');
    expect(toXml?.params).toEqual({
      docId: 'doc-1',
      document: h.store.getState().document,
      elideBinaries: true,
    });
    expect(mapCalls(h)).toHaveLength(0);
    expect(sourceSession(h.store).serial).toBeNull();
  });
});
