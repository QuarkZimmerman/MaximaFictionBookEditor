/**
 * T099 / feature 002 T056 - the host side of every `mfbe` member (api-impl.ts) against a
 * fixture document loaded into the real, headless Body controller: reads, structural edits on
 * the run's working copy (the document and the editor change only when the working copy is
 * shown: before dialogs and selection calls, and by the host at the end), search/replace,
 * selection, dialogs, status/progress, environment, the 64 MB snapshot guard and the
 * allow-list (unknown methods are rejected).
 */

import { createInstance } from 'i18next';

import type { CommandContext } from '@/app/commands';
import { createAppServices, type AppServices } from '@/app/services';
import { initI18n } from '@/i18n';
import type { BodyNode, Document, SectionNode } from '@/model/document';
import { actions, createAppStore, type AppStore } from '@/model/store';
import { createScriptApi, JsonText, setBodySelection, type ScriptApi } from '@/scripting/api-impl';
import type { RunEnd } from '@/scripting/types';
import type { Match, NodeRef, SelectionInfo } from '@/scripting/types';
import { getBodyController } from '@/views/body/bodyEditor';

import { fakeDialogs, fakeDocument, fakeRpc, type FakeDialogs } from '../features/testUtils';

function paragraph(nodeId: string, text: string, marks?: { type: string }[]) {
  return {
    type: 'p' as const,
    attrs: { nodeId },
    content: [{ type: 'text' as const, text, ...(marks ? { marks } : {}) }],
  } as SectionNode['content'][number];
}

function book(extraSections = 0): Document {
  const base = fakeDocument();
  const sections: BodyNode['content'] = [
    {
      type: 'section',
      attrs: { nodeId: 's1' },
      content: [
        { type: 'title', attrs: { nodeId: 't1' }, content: [paragraph('t1p', 'One')] },
        paragraph('p1', 'Alpha beta gamma.'),
        paragraph('p2', 'Beta again, and beta once more.'),
        {
          type: 'p',
          attrs: { nodeId: 'p2b' },
          content: [
            { type: 'text', text: 'Plain and ' },
            { type: 'text', text: 'emphasised', marks: [{ type: 'emphasis' }] },
          ],
        },
      ],
    } as SectionNode,
    {
      type: 'section',
      attrs: { nodeId: 's2' },
      content: [paragraph('p3', 'Second section beta.')],
    } as SectionNode,
  ];
  for (let i = 0; i < extraSections; i += 1) {
    sections.push({
      type: 'section',
      attrs: { nodeId: `x${i}` },
      content: [paragraph(`xp${i}`, `Extra ${i} beta`)],
    } as SectionNode);
  }
  const body: BodyNode = {
    type: 'body',
    attrs: { nodeId: 'b1' },
    content: [
      { type: 'title', attrs: { nodeId: 't0' }, content: [paragraph('t0p', 'Book')] },
      ...sections,
    ] as BodyNode['content'],
  };
  const notes: BodyNode = {
    type: 'body',
    attrs: { nodeId: 'b2', name: 'notes' },
    content: [
      {
        type: 'section',
        attrs: { nodeId: 'n1', id: 'n_1' },
        content: [paragraph('np1', 'A note.')],
      },
    ] as BodyNode['content'],
  };
  return {
    ...base,
    bodies: [body, notes],
    binaries: [
      {
        id: 'cover.png',
        contentType: 'image/png',
        size: 1000,
        decodable: true,
        willConvert: false,
        referenceCount: 1,
      },
    ],
  };
}

interface Harness {
  services: AppServices;
  store: AppStore;
  dialogs: FakeDialogs;
  api: ScriptApi;
  calls: { method: string; params: unknown }[];
  ctx: CommandContext;
  progress: unknown[];
  uiActivity: boolean[];
}

async function harness(
  document: Document = book(),
  options: { snapshotLimit?: number; runEnd?: RunEnd } = {},
) {
  const i18n = await initI18n({ instance: createInstance(), react: false, language: 'en' });
  const store = createAppStore();
  const rpc = fakeRpc({
    'resources.symbols': [
      { codepoint: 0x2014, names: { en: 'Em dash', ru: 'Длинное тире' } },
      { codepoint: 0x00a0, names: { en: 'No-break space' } },
    ],
  });
  const services = createAppServices({ store, rpc: rpc.client, platform: 'linux' });
  const dialogs = fakeDialogs();
  actions.setConnection(store, 'connected');
  actions.setDocument(store, document);
  const progress: unknown[] = [];
  const uiActivity: boolean[] = [];
  const api = createScriptApi({
    store,
    controller: getBodyController(store),
    dialogs,
    rpc: rpc.client,
    t: i18n.t,
    scriptName: 'Fixture',
    uiLanguage: 'en',
    onProgress: (...args) => progress.push(args),
    onUiActivity: (active) => uiActivity.push(active),
    snapshotLimit: options.snapshotLimit,
    runEnd: options.runEnd,
  });
  const ctx: CommandContext = {
    store,
    rpc: rpc.client,
    undo: services.undo,
    dialogs,
    hotkeys: services.hotkeys,
    carets: services.carets,
    t: i18n.t,
    version: 'test',
  };
  const h: Harness = { services, store, dialogs, api, calls: rpc.calls, ctx, progress, uiActivity };
  return h;
}

const call = (h: Harness, method: string, ...args: unknown[]) => h.api.call(method, args);

function textOfNode(h: Harness, nodeId: string): Promise<string> {
  return call(h, 'doc.textOf', nodeId) as Promise<string>;
}

function sectionTypes(h: Harness, sectionId: string): Promise<string[]> {
  return (call(h, 'doc.childrenOf', sectionId) as Promise<NodeRef[]>).then((refs) =>
    refs.map((r) => r.type),
  );
}

/** Plain text of a text block in the document the store holds (what the editor shows). */
function shownText(h: Harness, nodeId: string): string | null {
  let found: string | null = null;
  const visit = (node: {
    type: string;
    text?: string;
    attrs?: { nodeId?: unknown };
    content?: unknown[];
  }) => {
    if (found !== null || node.type === 'text') return;
    if (node.attrs?.nodeId === nodeId) {
      found = (node.content ?? []).map((c) => (c as { text?: string }).text ?? '').join('');
      return;
    }
    for (const child of node.content ?? []) visit(child as typeof node);
  };
  for (const body of h.store.getState().document!.bodies)
    visit(body as unknown as Parameters<typeof visit>[0]);
  return found;
}

describe('doc.* reads', () => {
  it('get() returns the whole document as JSON text (parsed in the worker) and guards the size', async () => {
    const h = await harness();
    const result = (await call(h, 'doc.get')) as JsonText;
    expect(result).toBeInstanceOf(JsonText);
    expect(JSON.parse(result.text).docId).toBe('doc-1');
    const small = await harness(book(), { snapshotLimit: 100 });
    await expect(call(small, 'doc.get')).rejects.toThrow(/larger than/);
  });

  it('getNode / parentOf / childrenOf / textOf / getElementsByTagName navigate the tree', async () => {
    const h = await harness();
    const node = (await call(h, 'doc.getNode', 's1')) as {
      type: string;
      attrs: { nodeId: string };
    };
    expect(node.type).toBe('section');
    expect(node.attrs.nodeId).toBe('s1');
    expect(await call(h, 'doc.getNode', { nodeId: 'p1', type: 'p' })).toMatchObject({ type: 'p' });
    await expect(call(h, 'doc.getNode', 'nope')).rejects.toThrow('unknown nodeId');
    await expect(call(h, 'doc.getNode', 42)).rejects.toThrow('expected a NodeRef');

    expect(await call(h, 'doc.parentOf', 'p1')).toEqual({ nodeId: 's1', type: 'section' });
    expect(await call(h, 'doc.parentOf', 'b1')).toBeNull();
    expect(await sectionTypes(h, 's1')).toEqual(['title', 'p', 'p', 'p']);

    expect(await textOfNode(h, 'p1')).toBe('Alpha beta gamma.');
    expect(await textOfNode(h, 'p2b')).toBe('Plain and emphasised');
    expect(await textOfNode(h, 's2')).toBe('Second section beta.');
    expect(await textOfNode(h, 's1')).toBe(
      'One\nAlpha beta gamma.\nBeta again, and beta once more.\nPlain and emphasised',
    );

    const paragraphs = (await call(h, 'doc.getElementsByTagName', 'p')) as NodeRef[];
    expect(paragraphs.map((r) => r.nodeId)).toEqual(['t0p', 't1p', 'p1', 'p2', 'p2b', 'p3', 'np1']);
    const within = (await call(h, 'doc.getElementsByTagName', 'p', 's2')) as NodeRef[];
    expect(within.map((r) => r.nodeId)).toEqual(['p3']);
    const sections = (await call(h, 'doc.getElementsByTagName', 'section')) as NodeRef[];
    expect(sections.map((r) => r.nodeId)).toEqual(['s1', 's2', 'n1']);
    // Inline marks are not nodes: the text blocks that carry them are returned.
    const emphasised = (await call(h, 'doc.getElementsByTagName', 'emphasis')) as NodeRef[];
    expect(emphasised.map((r) => r.nodeId)).toEqual(['p2b']);
  });

  it('binaries() gives metadata only and stats() counts text, structure and bytes', async () => {
    const h = await harness();
    expect(await call(h, 'doc.binaries')).toEqual(h.store.getState().document!.binaries);
    expect(await call(h, 'doc.stats')).toEqual({
      characters: 'Book'.length + 'One'.length + 17 + 31 + 20 + 20 + 7,
      words: 1 + 1 + 3 + 6 + 3 + 3 + 2,
      paragraphs: 7,
      sections: 3,
      images: 0,
      notes: 1,
      binaryBytes: 1000,
    });
  });
});

describe('doc.* edits (working copy)', () => {
  it('setText replaces the inline content of the working copy only', async () => {
    const h = await harness();
    await call(h, 'doc.setText', 'p1', 'Replaced text');
    expect(await textOfNode(h, 'p1')).toBe('Replaced text');
    // No editor transaction, store change or undo entry per write.
    expect(shownText(h, 'p1')).toBe('Alpha beta gamma.');
    expect(h.services.undo.canUndo).toBe(false);
    await expect(call(h, 'doc.setText', 's1', 'x')).rejects.toThrow('not a text block');
  });

  it('result() hands out the changed document; null when nothing changed', async () => {
    const untouched = await harness();
    await call(untouched, 'doc.getNode', 'p1');
    expect(untouched.api.result()).toBeNull();

    const h = await harness();
    const before = h.store.getState().document!;
    await call(h, 'doc.setText', 'p1', 'One');
    const first = h.api.result()!;
    expect(first).not.toBe(before);
    // Later writes leave a handed-out document as it is.
    await call(h, 'doc.setText', 'p1', 'Two');
    expect(JSON.stringify(first)).toContain('"One"');
    expect(JSON.stringify(h.api.result())).toContain('"Two"');
    expect(JSON.stringify(before)).toContain('Alpha beta gamma.');
  });

  it('dialogs and selection calls show the changes made so far, without an undo entry', async () => {
    const h = await harness();
    await call(h, 'doc.setText', 'p1', 'Shown before the message');
    expect(shownText(h, 'p1')).toBe('Alpha beta gamma.');
    h.dialogs.customAnswers.push('ok');
    await call(h, 'ui.message', 'So far');
    expect(shownText(h, 'p1')).toBe('Shown before the message');
    const editor = getBodyController(h.store).editorState!.doc.textContent;
    expect(editor).toContain('Shown before the message');

    await call(h, 'doc.setText', 'p3', 'Shown before the selection');
    await call(h, 'selection.get');
    expect(shownText(h, 'p3')).toBe('Shown before the selection');
    expect(h.services.undo.canUndo).toBe(false);
    // Status and progress do not show anything.
    await call(h, 'doc.setText', 'p3', 'Not shown yet');
    await call(h, 'ui.status', 'Working');
    await call(h, 'ui.progress', 1, 2);
    expect(shownText(h, 'p3')).toBe('Shown before the selection');
  });

  it('insertNode places nodes before / after / inside and rejects schema violations', async () => {
    const h = await harness();
    const added = (await call(h, 'doc.insertNode', 'append', 's1', {
      type: 'p',
      attrs: {},
      content: [{ type: 'text', text: 'Appended' }],
    })) as NodeRef;
    expect(added.type).toBe('p');
    expect(added.nodeId).toMatch(/^sc_/);
    expect(await sectionTypes(h, 's1')).toEqual(['title', 'p', 'p', 'p', 'p']);
    expect(await textOfNode(h, added.nodeId)).toBe('Appended');

    await call(h, 'doc.insertNode', 'before', 'p1', { type: 'empty-line', attrs: {} });
    await call(h, 'doc.insertNode', 'after', 'p1', { type: 'subtitle', attrs: {}, content: [] });
    expect(await sectionTypes(h, 's1')).toEqual([
      'title',
      'empty-line',
      'p',
      'subtitle',
      'p',
      'p',
      'p',
    ]);
    // A title after a paragraph breaks the FB2 order.
    await expect(
      call(h, 'doc.insertNode', 'after', 'p1', { type: 'title', attrs: {}, content: [] }),
    ).rejects.toThrow('not allowed');
    await expect(call(h, 'doc.insertNode', 'inside', 'p1', { type: 'p' })).rejects.toThrow(
      'where must be',
    );
    await expect(call(h, 'doc.insertNode', 'append', 's1', { type: 'nope' })).rejects.toThrow();
    await expect(call(h, 'doc.insertNode', 'append', 's1', 'text')).rejects.toThrow(
      'expected an object',
    );
    expect(h.services.undo.canUndo).toBe(false);
  });

  it('replaceNode keeps the node id; removeNode deletes and protects bodies', async () => {
    const h = await harness();
    const ref = (await call(h, 'doc.replaceNode', 'p2', {
      type: 'subtitle',
      attrs: {},
      content: [{ type: 'text', text: 'Sub' }],
    })) as NodeRef;
    expect(ref).toEqual({ nodeId: 'p2', type: 'subtitle' });
    expect(await textOfNode(h, 'p2')).toBe('Sub');
    expect(await sectionTypes(h, 's1')).toEqual(['title', 'p', 'subtitle', 'p']);

    await call(h, 'doc.removeNode', 'p2b');
    expect(await sectionTypes(h, 's1')).toEqual(['title', 'p', 'subtitle']);
    await expect(call(h, 'doc.getNode', 'p2b')).rejects.toThrow('unknown nodeId');
    await expect(call(h, 'doc.removeNode', 'b1')).rejects.toThrow('body cannot be removed');
    // A paragraph may again replace the subtitle (the parent's check is not cached wrongly).
    await call(h, 'doc.replaceNode', 'p2', paragraph('p2', 'Back'));
    expect(await sectionTypes(h, 's1')).toEqual(['title', 'p', 'p']);
    expect(shownText(h, 'p2b')).toBe('Plain and emphasised');
  });

  it('setDescription replaces the description block', async () => {
    const h = await harness();
    const current = h.store.getState().document!.description;
    await call(h, 'doc.setDescription', {
      ...current,
      titleInfo: { ...current.titleInfo, bookTitle: 'Renamed', lang: 'ru' },
    });
    expect(await call(h, 'env.docLanguage')).toBe('ru');
    expect(h.store.getState().document!.description.titleInfo.bookTitle).toBe('Alpha');
    expect(h.api.result()!.description.titleInfo.bookTitle).toBe('Renamed');
    await expect(call(h, 'doc.setDescription', { titleInfo: {} })).rejects.toThrow('required');
  });
});

/** The repro of conversion-notes-a.md "Gaps 2": a section mixing blocks and a subsection. */
const MIXED_SECTION = {
  type: 'section',
  attrs: {},
  content: [
    {
      type: 'title',
      attrs: {},
      content: [{ type: 'p', attrs: {}, content: [{ type: 'text', text: 'T' }] }],
    },
    { type: 'p', attrs: {}, content: [{ type: 'text', text: 'x' }] },
    {
      type: 'section',
      attrs: {},
      content: [{ type: 'p', attrs: {}, content: [{ type: 'text', text: 'y' }] }],
    },
  ],
};

function bodyJson(name: string, sectionId: string, text: string) {
  return {
    type: 'body',
    attrs: { name },
    content: [
      {
        type: 'title',
        attrs: {},
        content: [{ type: 'p', attrs: {}, content: [{ type: 'text', text: 'Notes' }] }],
      },
      {
        type: 'section',
        attrs: { id: sectionId },
        content: [{ type: 'p', attrs: {}, content: [{ type: 'text', text }] }],
      },
    ],
  };
}

async function bodyNames(h: Harness): Promise<(string | undefined)[]> {
  const snapshot = JSON.parse(((await call(h, 'doc.get')) as JsonText).text) as Document;
  return snapshot.bodies.map((b) => b.attrs.name);
}

describe('schema-invalid nodes are refused before anything is applied', () => {
  it.each([
    ['whole-book', 0, 's2'],
    ['windowed', 40, 'x39'],
  ])('insertNode / replaceNode reject the mixed section (%s mode)', async (_mode, extra, ref) => {
    const h = await harness(book(extra));
    const before = JSON.stringify(h.store.getState().document);
    let error: unknown;
    await call(h, 'doc.insertNode', 'after', ref, MIXED_SECTION).catch((e) => {
      error = e;
    });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe('ScriptApiError');
    expect((error as { code?: string }).code).toBe('invalidNode');
    expect((error as Error).message).toMatch(
      /^insertNode: invalid node at "section": Invalid content for node section/,
    );
    await expect(call(h, 'doc.replaceNode', ref, MIXED_SECTION)).rejects.toMatchObject({
      code: 'invalidNode',
      message: expect.stringContaining('replaceNode: invalid node at "section"'),
    });
    // Nothing was applied: same model, nothing to undo.
    expect(JSON.stringify(h.store.getState().document)).toBe(before);
    expect(h.services.undo.canUndo).toBe(false);
  });

  it('reports the path of a nested violation and counts the rest', async () => {
    const h = await harness();
    // A valid section whose poem has no stanza and whose cite holds a bare section.
    const nested = {
      type: 'section',
      attrs: {},
      content: [
        { type: 'p', attrs: {}, content: [{ type: 'text', text: 'ok' }] },
        { type: 'poem', attrs: {}, content: [] },
        { type: 'cite', attrs: {}, content: [{ type: 'section', attrs: {}, content: [] }] },
      ],
    };
    await expect(call(h, 'doc.insertNode', 'after', 's2', nested)).rejects.toThrow(
      /invalid node at "section\/poem\[2\]": Invalid content for node poem.*and 2 more problems/,
    );
    await expect(
      call(h, 'doc.insertNode', 'append', 's1', {
        type: 'p',
        attrs: {},
        content: [{ type: 'text', text: 'x', marks: [{ type: 'blink' }] }],
      }),
    ).rejects.toThrow('invalid node at "p/text[1]": unknown mark type "blink"');
    expect(await sectionTypes(h, 's1')).toEqual(['title', 'p', 'p', 'p']);
  });

  it('checks the parent of an unmounted node the same way as a mounted one', async () => {
    const h = await harness(book(40));
    const title = { type: 'title', attrs: {}, content: [] };
    await expect(call(h, 'doc.insertNode', 'after', 'xp39', title)).rejects.toMatchObject({
      code: 'notAllowed',
      message: 'insertNode: a "title" is not allowed inside "section" at this position',
    });
    await expect(call(h, 'doc.replaceNode', 'xp39', title)).rejects.toThrow('not allowed');
    await expect(
      call(h, 'doc.insertNode', 'append', 'b2', { type: 'p', attrs: {}, content: [] }),
    ).rejects.toThrow('a "p" is not allowed inside "body"');
    // A body may only be followed by another body.
    await expect(
      call(h, 'doc.insertNode', 'after', 'b2', { type: 'section', attrs: {}, content: [] }),
    ).rejects.toThrow(/invalid node|not allowed/);
    expect(await sectionTypes(h, 'x39')).toEqual(['p']);
    expect(h.services.undo.canUndo).toBe(false);
  });
});

describe('body-level edits', () => {
  it('creates a body after the last one in windowed mode (window kept when shown)', async () => {
    const h = await harness(book(40));
    const controller = getBodyController(h.store);
    expect(controller.currentWindow?.wholeBook).toBe(false);
    // The notes-engine flow of groups 02/03/04: edit a mounted block first, then add the body.
    await call(h, 'doc.replaceNode', 'p1', {
      type: 'p',
      attrs: {},
      content: [{ type: 'text', text: 'Alpha [1] gamma.' }],
    });
    const bodies = (await call(h, 'doc.getElementsByTagName', 'body')) as NodeRef[];
    const last = bodies[bodies.length - 1]!;
    const created = (await call(
      h,
      'doc.insertNode',
      'after',
      last.nodeId,
      bodyJson('comments', 'c_1', 'A comment.'),
    )) as NodeRef;
    expect(created.type).toBe('body');
    expect(await bodyNames(h)).toEqual([undefined, 'notes', 'comments']);
    const children = (await call(h, 'doc.childrenOf', created)) as NodeRef[];
    expect(children.map((c) => c.type)).toEqual(['title', 'section']);
    expect(await textOfNode(h, children[1]!.nodeId)).toBe('A comment.');
    expect(await call(h, 'doc.parentOf', created.nodeId)).toBeNull();
    // Shown: the window still shows the first body, with the edited block.
    controller.showModel(h.api.result()!);
    expect(controller.currentWindow?.bodyIndex).toBe(0);
    expect(controller.currentWindow?.bodyCount).toBe(3);
    expect(controller.editorState!.doc.textContent).toContain('Alpha [1] gamma.');
    expect(h.store.getState().document!.bodies.map((b) => b.attrs.name)).toEqual([
      undefined,
      'notes',
      'comments',
    ]);
  });

  it('creates a body in whole-book mode too, and keeps the window on the visible body', async () => {
    const small = await harness();
    const ref = (await call(
      small,
      'doc.insertNode',
      'after',
      'b2',
      bodyJson('comments', 'c_1', 'Comment'),
    )) as NodeRef;
    expect(await bodyNames(small)).toEqual([undefined, 'notes', 'comments']);
    expect(((await call(small, 'doc.getNode', ref)) as { type: string }).type).toBe('body');

    // Windowed: a body inserted before the mounted one shifts the indexes; once shown (at the
    // next selection call) the window follows its body and the caret stays on its block.
    const large = await harness(book(40));
    const controller = getBodyController(large.store);
    await call(large, 'selection.set', { nodeId: 'xp3', offset: 2 });
    await call(large, 'doc.insertNode', 'before', 'b1', bodyJson('extra', 'e_1', 'First'));
    expect(await bodyNames(large)).toEqual(['extra', undefined, 'notes']);
    expect(((await call(large, 'selection.get')) as SelectionInfo).anchor).toEqual({
      nodeId: 'xp3',
      offset: 2,
    });
    expect(controller.currentWindow?.bodyIndex).toBe(1);
  });

  it('removeNode removes any body but the first and still protects the last section', async () => {
    for (const extra of [0, 40]) {
      const h = await harness(book(extra));
      await expect(call(h, 'doc.removeNode', 'b1')).rejects.toMatchObject({
        code: 'notAllowed',
        message: 'removeNode: the first body cannot be removed',
      });
      // The only section of the notes body (unmounted in windowed mode) stays.
      await expect(call(h, 'doc.removeNode', 'n1')).rejects.toThrow('"body" needs this "section"');
      await call(h, 'doc.removeNode', 'b2');
      expect(await bodyNames(h)).toEqual([undefined]);
      await expect(call(h, 'doc.getNode', 'n1')).rejects.toThrow('unknown nodeId');
      await expect(call(h, 'doc.getNode', 'np1')).rejects.toThrow('unknown nodeId');
      getBodyController(h.store).showModel(h.api.result()!);
      expect(h.store.getState().document!.bodies).toHaveLength(1);
      expect(getBodyController(h.store).currentWindow?.bodyIndex).toBe(0);
    }
  });

  it('replaceNode on an unmounted body keeps its id and goes through the model', async () => {
    const h = await harness(book(40));
    const ref = (await call(
      h,
      'doc.replaceNode',
      'b2',
      bodyJson('notes', 'n_1', 'Rewritten'),
    )) as NodeRef;
    expect(ref).toEqual({ nodeId: 'b2', type: 'body' });
    expect(await textOfNode(h, 'b2')).toBe('Notes\nRewritten');
    await expect(call(h, 'doc.getNode', 'np1')).rejects.toThrow('unknown nodeId');
  });
});

describe('doc.* edits outside the mounted window', () => {
  it('edits unmounted sections of a windowed book like mounted ones', async () => {
    const h = await harness(book(40));
    const controller = getBodyController(h.store);
    expect(controller.currentWindow?.wholeBook).toBe(false);
    // Section x39 is far outside the initial window.
    await call(h, 'doc.setText', 'xp39', 'Edited far away');
    expect(await textOfNode(h, 'xp39')).toBe('Edited far away');
    const added = (await call(h, 'doc.insertNode', 'append', 'x39', {
      type: 'p',
      attrs: {},
      content: [{ type: 'text', text: 'Tail' }],
    })) as NodeRef;
    expect(await sectionTypes(h, 'x39')).toEqual(['p', 'p']);
    await call(h, 'doc.removeNode', added.nodeId);
    expect(await sectionTypes(h, 'x39')).toEqual(['p']);
    await call(h, 'doc.replaceNode', 'xp39', {
      type: 'subtitle',
      attrs: {},
      content: [{ type: 'text', text: 'S' }],
    });
    expect(await sectionTypes(h, 'x39')).toEqual(['subtitle']);
    expect(shownText(h, 'xp39')).toBe('Extra 39 beta');
    // Appending to the body itself in windowed mode appends after its last section.
    const appended = (await call(h, 'doc.insertNode', 'append', 'b1', {
      type: 'section',
      attrs: {},
      content: [{ type: 'p', attrs: {}, content: [{ type: 'text', text: 'Last' }] }],
    })) as NodeRef;
    const sections = (await call(h, 'doc.getElementsByTagName', 'section', 'b1')) as NodeRef[];
    expect(sections[sections.length - 1]!.nodeId).toBe(appended.nodeId);
  });
});

describe('doc.find / doc.replaceAll', () => {
  it('finds with the editor options and limits to a subtree', async () => {
    const h = await harness();
    const all = (await call(h, 'doc.find', { text: 'beta' })) as Match[];
    expect(all.map((m) => `${m.nodeId}:${m.from}-${m.to}`)).toEqual([
      'p1:6-10',
      'p2:0-4',
      'p2:16-20',
      'p3:15-19',
    ]);
    expect(all[1]!.text).toBe('Beta');
    const cased = (await call(h, 'doc.find', { text: 'beta', matchCase: true })) as Match[];
    expect(cased).toHaveLength(3);
    const within = (await call(h, 'doc.find', { text: 'beta', within: 's2' })) as Match[];
    expect(within.map((m) => m.nodeId)).toEqual(['p3']);
    const whole = (await call(h, 'doc.find', { text: 'bet', wholeWord: true })) as Match[];
    expect(whole).toHaveLength(0);
    const regex = (await call(h, 'doc.find', { text: 'b(e)ta', regex: true })) as Match[];
    expect(regex).toHaveLength(4);
    await expect(call(h, 'doc.find', { text: '(', regex: true })).rejects.toThrow(
      'invalid regular',
    );
    await expect(call(h, 'doc.find', { text: '' })).rejects.toThrow('required');
  });

  it('replaceAll counts replacements and expands regex groups', async () => {
    const h = await harness(book(40));
    const { count } = (await call(h, 'doc.replaceAll', { text: 'beta', wholeWord: true }, 'X')) as {
      count: number;
    };
    // 4 in the mounted sections + 40 unmounted extra sections.
    expect(count).toBe(44);
    expect(await textOfNode(h, 'p1')).toBe('Alpha X gamma.');
    expect(await textOfNode(h, 'xp39')).toBe('Extra 39 X');
    const regex = (await call(
      h,
      'doc.replaceAll',
      { text: '(Alpha) (X)', regex: true, within: 's1' },
      '$2-$1',
    )) as { count: number };
    expect(regex.count).toBe(1);
    expect(await textOfNode(h, 'p1')).toBe('X-Alpha gamma.');
    expect(shownText(h, 'p1')).toBe('Alpha beta gamma.');
    expect(shownText(h, 'xp39')).toBe('Extra 39 beta');
  });
});

describe('selection.*', () => {
  it('reads, sets, replaces, wraps and unwraps the Body selection', async () => {
    const h = await harness();
    await call(h, 'selection.set', { nodeId: 'p1', offset: 6 }, { nodeId: 'p1', offset: 10 });
    const selection = (await call(h, 'selection.get')) as SelectionInfo;
    expect(selection.text).toBe('beta');
    expect(selection.anchor).toEqual({ nodeId: 'p1', offset: 6 });
    expect(selection.head).toEqual({ nodeId: 'p1', offset: 10 });
    expect(selection.nodes).toEqual([{ nodeId: 'p1', type: 'p' }]);

    await call(h, 'selection.wrap', 'strong');
    let p1 = (await call(h, 'doc.getNode', 'p1')) as {
      content: { text: string; marks?: unknown[] }[];
    };
    expect(p1.content.map((c) => [c.text, c.marks?.length ?? 0])).toEqual([
      ['Alpha ', 0],
      ['beta', 1],
      [' gamma.', 0],
    ]);
    await call(h, 'selection.unwrap', 'strong');
    p1 = (await call(h, 'doc.getNode', 'p1')) as typeof p1;
    expect(p1.content).toHaveLength(1);
    await call(h, 'selection.wrap', { link: '#n_1', note: true });
    p1 = (await call(h, 'doc.getNode', 'p1')) as typeof p1;
    expect(p1.content[1]!.marks).toEqual([{ type: 'link', attrs: { href: '#n_1', type: 'note' } }]);
    await call(h, 'selection.unwrap', 'link');
    await call(h, 'selection.wrap', { style: 'spaced' });
    p1 = (await call(h, 'doc.getNode', 'p1')) as typeof p1;
    expect(p1.content[1]!.marks).toEqual([{ type: 'style', attrs: { name: 'spaced' } }]);
    await expect(call(h, 'selection.wrap', 'blink')).rejects.toThrow('unknown mark');

    await call(h, 'selection.replaceText', 'BETA');
    expect(await textOfNode(h, 'p1')).toBe('Alpha BETA gamma.');
    await call(h, 'selection.set', { nodeId: 'p1', offset: 0 });
    await call(h, 'selection.replaceText', 'X');
    expect(await textOfNode(h, 'p1')).toBe('XAlpha BETA gamma.');
    await expect(call(h, 'selection.wrap', 'strong')).rejects.toThrow('nothing is selected');

    await call(h, 'selection.selectNode', 'p3');
    expect(((await call(h, 'selection.get')) as SelectionInfo).text).toBe('Second section beta.');
    await call(h, 'selection.scrollIntoView');
    await expect(call(h, 'selection.set', { nodeId: 'nope', offset: 0 })).rejects.toThrow(
      'unknown nodeId',
    );
    expect(h.store.getState().selectionNodeId).toBe('p3');
  });

  it('selectNode moves the window onto an unmounted section', async () => {
    const h = await harness(book(40));
    await call(h, 'selection.selectNode', 'xp39');
    expect(((await call(h, 'selection.get')) as SelectionInfo).text).toBe('Extra 39 beta');
  });

  it('set spans several text blocks (the harness --select-range uses the same helper)', async () => {
    const h = await harness();
    await call(h, 'selection.set', { nodeId: 'p1', offset: 6 }, { nodeId: 'p2b', offset: 5 });
    const selection = (await call(h, 'selection.get')) as SelectionInfo;
    expect(selection.nodes.map((n) => n.nodeId)).toEqual(['p1', 'p2', 'p2b']);
    expect(selection.text).toBe('beta gamma.\nBeta again, and beta once more.\nPlain');
    setBodySelection(
      getBodyController(h.store),
      { nodeId: 'p3', offset: 0 },
      { nodeId: 'p3', offset: 6 },
      'selectRange',
    );
    expect(((await call(h, 'selection.get')) as SelectionInfo).text).toBe('Second');
    expect(() =>
      setBodySelection(getBodyController(h.store), { nodeId: 'nope', offset: 0 }, undefined),
    ).toThrow('unknown nodeId');
  });
});

describe('ui.*, edit.*, env.*', () => {
  it('message / prompt / form open the modal dialogs and report UI activity', async () => {
    const h = await harness();
    h.dialogs.customAnswers.push('later', { prefix: 'n_' });
    const pressed = await call(h, 'ui.message', 'Hi', {
      buttons: [
        { id: 'now', label: 'Now' },
        { id: 'later', label: 'Later', cancel: true },
      ],
      icon: 'question',
    });
    expect(pressed).toBe('later');
    expect(h.dialogs.custom[0]!.name).toBe('ScriptMessageDialog');
    const options = h.dialogs.custom[0]!.props.options as {
      caption: string;
      buttons: { id: string; label: string }[];
    };
    expect(options.caption).toBe('Fixture');
    expect(options.buttons.map((b) => b.label)).toEqual(['Now', 'Later']);

    const form = await call(h, 'ui.form', {
      title: 'F',
      fields: [{ kind: 'text', id: 'prefix', label: 'Prefix' }],
    });
    expect(form).toEqual({ prefix: 'n_' });
    expect(h.dialogs.custom[1]!.name).toBe('ScriptFormDialog');
    await expect(call(h, 'ui.form', { title: 'F', fields: 'nope' })).rejects.toThrow('fields');

    // Standard ids get localised labels when the script gives none.
    h.dialogs.customAnswers.push('ok');
    await call(h, 'ui.message', 'Plain');
    const plain = h.dialogs.custom[2]!.props.options as { buttons: { label: string }[] };
    expect(plain.buttons[0]!.label).toBe('OK');

    // prompt: Cancel -> null, No -> '' (the original's yes/no/cancel InputBox), OK -> text.
    h.dialogs.customAnswers.push(
      { button: 'cancel', value: 'typed' },
      { button: 'no', value: 'typed' },
      { button: 'ok', value: 'typed' },
    );
    expect(await call(h, 'ui.prompt', 'Text?')).toBeNull();
    expect(await call(h, 'ui.prompt', 'Text?', { yesNoCancel: true })).toBe('');
    expect(await call(h, 'ui.prompt', 'Text?', { defaultValue: 'x' })).toBe('typed');
    expect(h.dialogs.custom[3]!.name).toBe('ScriptPromptDialog');
    expect(h.dialogs.custom[4]!.props.options).toMatchObject({
      prompt: 'Text?',
      caption: 'Fixture',
      buttons: 'yesNoCancel',
      testId: 'dialog-script-prompt',
    });
    expect(h.uiActivity).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
    ]);
  });

  it('hands the end of the run to the dialogs it opens', async () => {
    const runEnd: RunEnd = { ended: false, subscribe: () => () => {} };
    const h = await harness(book(), { runEnd });
    h.dialogs.customAnswers.push('ok', null, { button: 'cancel', value: '' });
    await call(h, 'ui.message', 'Hi');
    await call(h, 'ui.form', { title: 'F', fields: [] });
    await call(h, 'ui.prompt', 'Text?');
    expect(h.dialogs.custom.map((d) => d.props.runEnd)).toEqual([runEnd, runEnd, runEnd]);
  });

  it('status / progress drive the status bar and are cleared at the end unless sticky', async () => {
    const h = await harness();
    await call(h, 'ui.status', 'Working');
    expect(h.store.getState().statusMessage).toBe('Working');
    await call(h, 'ui.progress', 3, 10, 'Phase');
    expect(h.store.getState().progress).toEqual({
      jobId: 'script',
      phase: 'Phase',
      done: 3,
      total: 10,
    });
    expect(h.progress).toEqual([[3, 10, 'Phase']]);
    expect(await call(h, 'ui.progress', 4)).toEqual({ cancelled: false });
    h.api.finish();
    expect(h.store.getState().statusMessage).toBeNull();
    expect(h.store.getState().progress).toBeNull();

    await call(h, 'ui.status', 'Keep me', { sticky: true });
    expect(h.api.stickyStatus).toBe(true);
    h.api.finish();
    expect(h.store.getState().statusMessage).toBe('Keep me');
  });

  it('symbols come from the core, settings and the document language are read-only', async () => {
    const h = await harness();
    expect(await call(h, 'edit.symbols')).toEqual([
      { codepoint: 0x2014, name: 'Em dash' },
      { codepoint: 0x00a0, name: 'No-break space' },
    ]);
    expect(await call(h, 'edit.label', 'step')).toBeUndefined();
    expect(await call(h, 'env.settings')).toEqual({
      nbspDisplayChar: '\u00A0', // the original's default: the plain space, no marker
      pasteImageFormat: 'jpeg',
      jpegQuality: 90,
      uiLanguage: 'en',
    });
    expect(await call(h, 'env.docLanguage')).toBe('en');
  });

  it('rejects anything outside the allow-list and bad arguments', async () => {
    const h = await harness();
    await expect(call(h, 'window.open', 'x')).rejects.toThrow('unknown API method');
    await expect(call(h, 'doc.evil')).rejects.toThrow('unknown API method');
    await expect(call(h, 'doc.setText', 'p1')).rejects.toThrow('expected a string');
    await expect(call(h, 'ui.message')).rejects.toThrow('expected a string');
  });
});
