// Feature 011 (US11; D41; constitution 3.3.0 power (e); contracts/script-api.md, contracts/tree.md
// §1, §4, §5; data-model "Tree-script rows"): the rows tree scripts show in the Document tree.
import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';

import type { ModelNodeJson } from '@/editor/fromModel';
import { initI18n } from '@/i18n';
import type { BodyNode } from '@/model/document';
import { actions, createAppStore } from '@/model/store';
import { createScriptApi, type ScriptApiDeps } from '@/scripting/api-impl';
import { getScriptRows, parseScriptRowId, scriptRowId } from '@/views/tree/scriptRows';
import { addScriptRows, buildTreeIndex } from '@/views/tree/treeModel';
import { treeMenuFor } from '@/views/tree/treeMenuModel';

import { fakeDialogs, fakeDocument } from '../features/testUtils';

const CAPTIONS = { annotation: 'Annotation', history: 'History' };

const p = (nodeId: string, text: string): ModelNodeJson => ({
  type: 'p',
  attrs: { nodeId },
  content: [{ type: 'text', text }],
});

/** body n1 > section n2 > [title, p n3, subtitle n4, p n5], section n6 > [p n7] */
function book() {
  const body: ModelNodeJson = {
    type: 'body',
    attrs: { nodeId: 'n1' },
    content: [
      {
        type: 'section',
        attrs: { nodeId: 'n2' },
        content: [
          { type: 'title', attrs: { nodeId: 't2' }, content: [p('tp2', 'Chapter')] },
          p('n3', 'No full stop here'),
          { type: 'subtitle', attrs: { nodeId: 'n4' }, content: [{ type: 'text', text: '* * *' }] },
          p('n5', 'Nor here'),
        ],
      },
      { type: 'section', attrs: { nodeId: 'n6' }, content: [p('n7', 'Another one.')] },
    ],
  };
  return fakeDocument({ bodies: [body as unknown as BodyNode] });
}

async function apiWith(overrides: Partial<ScriptApiDeps> = {}) {
  const i18n = await initI18n({ instance: createInstance(), react: false, language: 'en' });
  const store = createAppStore();
  actions.setDocument(store, book());
  const api = createScriptApi({
    store,
    document: store.getState().document,
    controller: null,
    dialogs: fakeDialogs(),
    rpc: null,
    t: i18n.t,
    scriptName: 'Test',
    uiLanguage: 'en',
    ...overrides,
  });
  return { api, store };
}

describe('mfbe.tree in a run (contracts/script-api.md)', () => {
  it('is notAllowed in a run of a script of another kind', async () => {
    const { api } = await apiWith();
    await expect(api.call('tree.showRows', [[{ node: 'n3' }]])).rejects.toMatchObject({
      code: 'notAllowed',
    });
    await expect(api.call('tree.clearRows', [])).rejects.toMatchObject({ code: 'notAllowed' });
  });

  it('shows the known nodes of a treeRows run, skipping unknown and stale ones', async () => {
    const shown: { nodeId: string; caption?: string }[][] = [];
    let cleared = 0;
    const { api } = await apiWith({
      treeRows: {
        show: (entries) => {
          shown.push(entries);
          return entries.length;
        },
        clear: () => {
          cleared += 1;
        },
      },
    });
    const count = await api.call('tree.showRows', [
      [
        { node: 'n3', caption: 'First' },
        { node: { nodeId: 'n5', type: 'p' } },
        { node: 'gone' },
        { caption: 'no node' },
        null,
      ],
    ]);
    expect(count).toBe(2);
    expect(shown).toEqual([[{ nodeId: 'n3', caption: 'First' }, { nodeId: 'n5' }]]);
    await api.call('tree.clearRows', []);
    expect(cleared).toBe(1);
    await expect(api.call('tree.showRows', ['n3'])).rejects.toMatchObject({ code: 'apiError' });
  });
});

describe('the rows of the window (data-model: Tree-script rows)', () => {
  it('replaces a script’s rows on its next run; Clean, Clean row and Ctrl+choose remove them', () => {
    const store = createAppStore();
    actions.setDocument(store, book());
    const rows = getScriptRows(store);
    rows.show({ scriptId: 'a', name: 'A', entries: [{ nodeId: 'n3' }, { nodeId: 'n3' }] });
    rows.show({ scriptId: 'b', name: 'B', entries: [{ nodeId: 'n5' }] });
    expect([...rows.getState().keys()]).toEqual(['a', 'b']);
    expect(rows.getState().get('a')!.entries).toEqual([{ nodeId: 'n3' }]);
    rows.show({ scriptId: 'a', name: 'A', entries: [{ nodeId: 'n7' }] });
    expect(rows.getState().get('a')!.entries).toEqual([{ nodeId: 'n7' }]);
    rows.cleanRow('a', 'n7');
    expect(rows.getState().has('a')).toBe(false);
    rows.show({ scriptId: 'c', name: 'C', entries: [{ nodeId: 'n3' }] });
    rows.clearOthers('c');
    expect([...rows.getState().keys()]).toEqual(['c']);
    rows.clear();
    expect(rows.hasRows).toBe(false);
  });

  it('drops a row whose node is deleted, all of them when another book opens; never in the book', () => {
    const store = createAppStore();
    const document = book();
    actions.setDocument(store, document);
    const rows = getScriptRows(store);
    rows.show({ scriptId: 'a', name: 'A', entries: [{ nodeId: 'n3' }, { nodeId: 'n7' }] });
    // Display only: the book is the same object.
    expect(store.getState().document).toBe(document);
    const section = document.bodies[0]!.content[1]!;
    actions.updateDocument(store, {
      ...document,
      bodies: [{ ...document.bodies[0]!, content: [section] } as BodyNode],
    });
    expect(rows.getState().get('a')!.entries).toEqual([{ nodeId: 'n7' }]);
    actions.setDocument(store, { ...book(), docId: 'doc-2' });
    expect(rows.hasRows).toBe(false);
  });
});

describe('script rows in the tree (contracts/tree.md §1, §4)', () => {
  it('stand under the nearest row above their node, in document order', () => {
    const document = book();
    const index = addScriptRows(
      buildTreeIndex(document, CAPTIONS),
      document,
      [
        {
          scriptId: 'tree/example-1',
          name: 'Paragraphs Without a Full Stop',
          iconUrl: '/scripts/tree/example-1/icon.png',
          entries: [
            { nodeId: 'n5', caption: 'Nor here' },
            { nodeId: 'n3' },
            { nodeId: 'n4' },
            { nodeId: 'missing' },
          ],
        },
      ],
      scriptRowId,
    );
    const id = (node: string) => scriptRowId('tree/example-1', node);
    // A paragraph's row stands under its section's, before the subtitle after it; a node with a
    // row of its own (the subtitle) gets the script row just before it.
    expect(index.rows.get('n2')!.childIds).toEqual([id('n3'), id('n4'), 'n4', id('n5')]);
    const row = index.rows.get(id('n3'))!;
    expect(row).toMatchObject({
      kind: 'script',
      caption: 'Paragraphs Without a Full Stop',
      depth: index.rows.get('n2')!.depth + 1,
      parentId: 'n2',
      script: { scriptId: 'tree/example-1', nodeId: 'n3' },
      iconUrl: '/scripts/tree/example-1/icon.png',
    });
    expect(index.rows.get(id('n5'))!.caption).toBe('Nor here');
    expect(index.rows.has(id('missing'))).toBe(false);
    expect(index.order.indexOf(id('n3'))).toBeGreaterThan(index.order.indexOf('n2'));
    expect(parseScriptRowId(id('n3'))).toEqual({ scriptId: 'tree/example-1', nodeId: 'n3' });
  });

  it('a script row’s menu: Go To, Go To Source, Clean', async () => {
    const i18n = await initI18n({ instance: createInstance(), react: false, language: 'en' });
    const document = book();
    const lines = treeMenuFor(
      buildTreeIndex(document, CAPTIONS),
      scriptRowId('tree/example-1', 'n3'),
      i18n.t,
    );
    expect(lines.map((line) => (line === 'separator' ? '-' : line.commandId))).toEqual([
      'tree.view',
      'tree.viewSource',
      '-',
      'tree.cleanRow',
    ]);
  });
});
