/**
 * Editing feature tests (T055/T070): the registrar replaces the editing stubs, enable states
 * follow the schema position, commands edit the model through the (headless) Body controller,
 * footnote creation builds `n_<N>` in the notes body as one undo entry, Replace All is one undo
 * entry, Find Next wraps and reports, incremental search drives the status bar, NBSP and symbol
 * commands insert characters, and the Body history survives view switches.
 */

import { createInstance } from 'i18next';
import { NodeSelection } from 'prosemirror-state';

import type { CommandContext } from '@/app/commands';
import { createAppServices, type AppServices } from '@/app/services';
import { collectTextblocks, replaceTextblocksInModel } from '@/features/search/bodyTarget';
import { getSearchSession } from '@/features/search/search';
import { IncrementalSearch } from '@/features/search/incremental';
import { getSymbolsFeature } from '@/features/editing';
import { findNodeById } from '@/editor/schema';
import { initI18n } from '@/i18n';
import type { BodyNode, Document, SectionNode } from '@/model/document';
import { actions, createAppStore } from '@/model/store';
import { getBodyController } from '@/views/body/bodyEditor';

import { fakeDialogs, fakeDocument, fakeRpc, type FakeDialogs } from './testUtils';

function paragraph(nodeId: string, text: string, marks?: unknown[]) {
  return {
    type: 'p' as const,
    attrs: { nodeId },
    content: [{ type: 'text' as const, text, ...(marks ? { marks } : {}) }],
  } as SectionNode['content'][number];
}

function twoSectionBook(): Document {
  const base = fakeDocument();
  const body: BodyNode = {
    type: 'body',
    attrs: { nodeId: 'b1' },
    content: [
      { type: 'title', attrs: { nodeId: 't0' }, content: [paragraph('t0p', 'Book')] },
      {
        type: 'section',
        attrs: { nodeId: 's1' },
        content: [
          { type: 'title', attrs: { nodeId: 't1' }, content: [paragraph('t1p', 'One')] },
          paragraph('p1', 'Alpha beta gamma.'),
          paragraph('p2', 'Beta again, and Beta once more.'),
        ],
      },
      {
        type: 'section',
        attrs: { nodeId: 's2' },
        content: [paragraph('p3', 'Second section beta.')],
      },
    ] as BodyNode['content'],
  };
  return { ...base, bodies: [body] };
}

interface Harness {
  services: AppServices;
  ctx: CommandContext & { dialogs: FakeDialogs };
  store: ReturnType<typeof createAppStore>;
  calls: { method: string; params: unknown }[];
}

async function harness(
  document: Document | null = twoSectionBook(),
  rpcResponses: Record<string, unknown> = {},
): Promise<Harness> {
  const i18n = await initI18n({ instance: createInstance(), react: false, language: 'en' });
  const store = createAppStore();
  const rpc = fakeRpc({
    'settings.set': (params: unknown) => ({ settings: null, restartRequired: false, params }),
    ...rpcResponses,
  });
  const services = createAppServices({ store, rpc: rpc.client, platform: 'linux' });
  const dialogs = fakeDialogs();
  const ctx: CommandContext & { dialogs: FakeDialogs } = {
    store,
    rpc: rpc.client,
    undo: services.undo,
    dialogs,
    hotkeys: services.hotkeys,
    carets: services.carets,
    t: i18n.t,
    version: 'test',
  };
  actions.setConnection(store, 'connected');
  if (document) actions.setDocument(store, document);
  return { services, ctx, store, calls: rpc.calls };
}

/** Text of the text block `nodeId` in the document model. */
function modelText(h: Harness, nodeId: string): string {
  let found = '';
  const visit = (n: { attrs?: { nodeId?: string }; content?: { text?: string }[] }) => {
    if (n.attrs?.nodeId === nodeId) found = (n.content ?? []).map((c) => c.text ?? '').join('');
    (n.content as unknown as (typeof n)[])?.forEach(visit);
  };
  h.store.getState().document!.bodies.forEach((b) => visit(b as never));
  return found;
}

/** Puts the caret inside the text block `nodeId` at `offset`. */
function caret(h: Harness, nodeId: string, offset = 0, to?: number): void {
  const controller = getBodyController(h.store);
  if (to === undefined) expect(controller.setCaret({ view: 'body', nodeId, offset })).toBe(true);
  else expect(controller.selectRange(nodeId, offset, to)).toBe(true);
}

function sectionNames(h: Harness, index = 0): string[] {
  const body = h.store.getState().document!.bodies[0]!;
  const section = body.content.filter((c) => c.type === 'section')[index] as SectionNode;
  return section.content.map((c) => c.type);
}

describe('editing feature registration', () => {
  it('replaces every editing stub and keeps the ids / icons', async () => {
    const { services } = await harness(null);
    const ids = [
      'insert.body',
      'insert.title',
      'insert.epigraph',
      'insert.annotation',
      'insert.textAuthor',
      'insert.image',
      'insert.inlineImage',
      'insert.poem',
      'insert.cite',
      'insert.table',
      'insert.sectionImage',
      'style.normal',
      'style.textAuthor',
      'style.subtitle',
      'style.link',
      'style.footnote',
      'style.removeLink',
      'style.strong',
      'style.emphasis',
      'style.strikethrough',
      'style.sub',
      'style.sup',
      'style.code',
      'edit.cut',
      'edit.copy',
      'edit.paste',
      'edit.find',
      'edit.findNext',
      'edit.replace',
      'edit.incrementalSearch',
      'edit.gotoFootnote',
      'edit.clone',
      'edit.split',
      'edit.merge',
      'edit.removeOuter',
      'edit.insertNbsp',
      'nav.selectId',
      'nav.selectHref',
      'nav.selectTableId',
    ];
    for (const id of ids) {
      const command = services.commands.get(id);
      expect(command, id).toBeDefined();
      expect(command!.stub, id).toBeUndefined();
    }
    // `insert.binary` belongs to US7 and stays a stub.
    expect(services.commands.get('insert.binary')?.stub).toBeUndefined();
    expect(services.commands.get('insert.table')?.icon).toBe('id_insert_table');
    expect(services.undo.hasView('body')).toBe(true);
    expect(services.carets.has('body')).toBe(true);
    expect(services.hotkeys.get('edit.insertNbsp')).toBe('Ctrl+Shift+Space');
  });

  it('disables everything without a document and computes enable states from the schema position', async () => {
    const h = await harness(null);
    const { services, ctx } = h;
    expect(services.commands.isEnabled('insert.title', ctx)).toBe(false);
    expect(services.commands.isEnabled('style.strong', ctx)).toBe(false);
    expect(services.commands.isEnabled('edit.find', ctx)).toBe(false);

    actions.setDocument(h.store, twoSectionBook());
    caret(h, 'p1', 3);
    expect(services.commands.isEnabled('insert.title', ctx)).toBe(false); // section has a title
    expect(services.commands.isEnabled('insert.epigraph', ctx)).toBe(true);
    expect(services.commands.isEnabled('insert.annotation', ctx)).toBe(true);
    expect(services.commands.isEnabled('insert.textAuthor', ctx)).toBe(false); // not in a cite/poem
    expect(services.commands.isEnabled('insert.poem', ctx)).toBe(true);
    expect(services.commands.isEnabled('insert.table', ctx)).toBe(true);
    expect(services.commands.isEnabled('edit.clone', ctx)).toBe(true);
    expect(services.commands.isEnabled('edit.split', ctx)).toBe(true);
    expect(services.commands.isEnabled('edit.merge', ctx)).toBe(true);
    expect(services.commands.isEnabled('edit.removeOuter', ctx)).toBe(false);
    expect(services.commands.isEnabled('style.strong', ctx)).toBe(true);
    expect(services.commands.isEnabled('style.link', ctx)).toBe(false); // caret, no link
    expect(services.commands.isEnabled('style.footnote', ctx)).toBe(true);
    expect(services.commands.isEnabled('edit.copy', ctx)).toBe(false); // nothing selected
    expect(services.commands.isEnabled('edit.find', ctx)).toBe(true);
    caret(h, 'p1', 0, 5);
    expect(services.commands.isEnabled('style.link', ctx)).toBe(true);
    expect(services.commands.isEnabled('edit.copy', ctx)).toBe(true);
    // Commands are Body-view only.
    actions.setActiveView(h.store, 'source');
    expect(services.commands.isEnabled('insert.epigraph', ctx)).toBe(false);
    caret(h, 'p3');
    actions.setActiveView(h.store, 'body');
    expect(services.commands.isEnabled('insert.title', ctx)).toBe(true); // second section: no title
    expect(services.commands.isEnabled('edit.merge', ctx)).toBe(false); // last section
  });

  it('runs Add / Style commands against the model and records undo entries (headless)', async () => {
    const h = await harness();
    const { services, ctx, store } = h;
    caret(h, 'p1', 2);
    await services.commands.execute('insert.epigraph', ctx);
    expect(sectionNames(h)).toEqual(['title', 'epigraph', 'p', 'p']);
    expect(store.getState().modified).toBe(true);
    expect(services.undo.canUndo).toBe(true);
    caret(h, 'p2', 0);
    await services.commands.execute('style.subtitle', ctx);
    expect(sectionNames(h)).toEqual(['title', 'epigraph', 'p', 'subtitle']);
    expect(services.commands.isChecked('style.subtitle', ctx)).toBe(true);
    caret(h, 'p1', 0, 5);
    await services.commands.execute('style.strong', ctx);
    const p1 = (store.getState().document!.bodies[0]!.content[1] as SectionNode).content[2] as {
      content: { marks?: { type: string }[] }[];
    };
    expect(p1.content[0]!.marks).toEqual([{ type: 'strong' }]);
    expect(services.commands.isChecked('style.strong', ctx)).toBe(true);
    // Three edits -> three undo steps, reverted in order.
    expect(services.undo.undoDepth).toBe(3);
    services.undo.undo();
    services.undo.undo();
    services.undo.undo();
    expect(sectionNames(h)).toEqual(['title', 'p', 'p']);
    expect(services.undo.canRedo).toBe(true);
    services.undo.redo();
    expect(sectionNames(h)).toEqual(['title', 'epigraph', 'p', 'p']);
  });

  it('creates a footnote n_<N> in a new notes body as one undo entry, numbering after existing ones', async () => {
    const h = await harness();
    const { services, ctx, store } = h;
    caret(h, 'p1', 6, 10); // "beta"
    await services.commands.execute('style.footnote', ctx);
    let doc = store.getState().document!;
    expect(doc.bodies).toHaveLength(2);
    const notes = doc.bodies[1]!;
    expect(notes.attrs.name).toBe('notes');
    expect(notes.content[0]!.type).toBe('title');
    const note = notes.content[1] as SectionNode;
    expect(note.attrs.id).toBe('n_1');
    expect((note.content[0] as { content: unknown[] }).content).toEqual([
      { type: 'p', attrs: expect.objectContaining({}), content: [{ type: 'text', text: '1' }] },
    ]);
    const linked = (doc.bodies[0]!.content[1] as SectionNode).content[1] as {
      content: { text: string; marks?: unknown[] }[];
    };
    const run = linked.content.find((c) => c.text === 'beta')!;
    expect(run.marks).toEqual([{ type: 'link', attrs: { href: '#n_1', type: 'note' } }]);
    // The caret moved into the note's text paragraph.
    expect(store.getState().selectionPath).toBe('body[2]/section[1]/p[1]');
    expect(services.undo.undoDepth).toBe(1);
    // Second footnote from a caret: "[2]" link text, same notes body.
    caret(h, 'p3', 7);
    await services.commands.execute('style.footnote', ctx);
    doc = store.getState().document!;
    expect(doc.bodies).toHaveLength(2);
    expect((doc.bodies[1]!.content[2] as SectionNode).attrs.id).toBe('n_2');
    const p3 = (doc.bodies[0]!.content[2] as SectionNode).content[0] as {
      content: { text: string }[];
    };
    expect(p3.content.map((c) => c.text).join('')).toBe('Second [2]section beta.');
    // Undo removes the whole footnote (link + section) at once.
    services.undo.undo();
    doc = store.getState().document!;
    expect(doc.bodies[1]!.content).toHaveLength(2);
    services.undo.undo();
    expect(store.getState().document!.bodies).toHaveLength(1);
  });

  it('goes to the footnote and back, and reports a missing reference', async () => {
    const h = await harness();
    const { services, ctx, store } = h;
    caret(h, 'p1', 6, 10);
    await services.commands.execute('style.footnote', ctx);
    // Back from the note to the reference.
    await services.commands.execute('edit.gotoFootnote', ctx);
    expect(store.getState().selectionPath).toBe('body[1]/section[1]/p[1]');
    const controller = getBodyController(store);
    expect(controller.editorState!.selection.$from.parentOffset).toBe(10); // after "beta"
    // From the reference to the note.
    caret(h, 'p1', 8);
    await services.commands.execute('edit.gotoFootnote', ctx);
    expect(store.getState().selectionPath).toBe('body[2]/section[1]/p[1]');
    // Dangling link: "Reference not found."
    caret(h, 'p2', 0, 4);
    const { setLink } = await import('@/editor/commands/links');
    controller.execute(setLink('#nowhere'));
    caret(h, 'p2', 2);
    await services.commands.execute('edit.gotoFootnote', ctx);
    expect(ctx.dialogs.shown.at(-1)?.text).toBe('Reference not found.');
  });

  it('inserts a non-breaking space and symbols from resources.symbols', async () => {
    const h = await harness(twoSectionBook(), {
      'resources.symbols': [
        { codepoint: 8212, names: { en: 'Em dash', ru: 'Длинное тире' } },
        {
          codepoint: 160,
          names: { en: 'Non-breaking space', ru: 'Неразрывный пробел' },
          defaultHotkey: 'Ctrl+Alt+N',
        },
      ],
    });
    const { services, ctx, store } = h;
    caret(h, 'p1', 5);
    await services.commands.execute('edit.insertNbsp', ctx);
    const text = () =>
      (
        (store.getState().document!.bodies[0]!.content[1] as SectionNode).content[1] as {
          content: { text: string }[];
        }
      ).content
        .map((c) => c.text)
        .join('');
    expect(text()).toBe('Alpha\u00A0 beta gamma.');
    await getSymbolsFeature(store)!.load(ctx.rpc!);
    expect(services.commands.get('symbol.1')?.label).toBe('Em dash (\u2014)');
    expect(services.hotkeys.get('symbol.2')).toBe('Ctrl+Alt+N');
    await services.commands.execute('symbol.1', ctx);
    expect(text()).toBe('Alpha\u00A0\u2014 beta gamma.');
  });

  it('tolerates a core without resources.symbols', async () => {
    const h = await harness();
    await getSymbolsFeature(h.store)!.load(h.ctx.rpc!);
    expect(h.services.commands.get('symbol.1')).toBeUndefined();
  });
});

describe('images and windowed documents', () => {
  it('inserts images: clear placeholder, binary.add result, or the file name when the core lacks binary.add', async () => {
    let addBinary: unknown = new (await import('@/rpc/client')).RpcError(
      -32601,
      'Method not found',
    );
    const h = await harness(twoSectionBook(), {
      'dialog.openFile': { paths: ['/pictures/cover.jpg'] },
      'binary.add': () => addBinary,
    });
    const { services, ctx, store } = h;
    // "Insert clear image?" -> No -> file dialog -> binary.add missing -> #cover.jpg reference.
    ctx.dialogs.messageAnswers.push('no');
    caret(h, 'p1', 3);
    await services.commands.execute('insert.image', ctx);
    expect(ctx.dialogs.shown.at(-1)?.text).toBe('Insert clear image?');
    let section = store.getState().document!.bodies[0]!.content[1] as SectionNode;
    expect(section.content.map((c) => c.type)).toEqual(['title', 'p', 'image', 'p']);
    expect(section.content[2]!.attrs).toMatchObject({ href: '#cover.jpg' });
    expect(store.getState().statusMessage).toContain('#cover.jpg');
    // With binary.add available the new binary is referenced and listed.
    addBinary = {
      id: 'cover_1.jpg',
      contentType: 'image/jpeg',
      size: 10,
      decodable: true,
      willConvert: false,
      referenceCount: 1,
    };
    ctx.dialogs.messageAnswers.push('no');
    caret(h, 'p3', 2);
    await services.commands.execute('insert.inlineImage', ctx);
    const p3 = (store.getState().document!.bodies[0]!.content[2] as SectionNode).content[0] as {
      content: { type: string; attrs?: { href?: string } }[];
    };
    expect(p3.content.find((c) => c.type === 'inline-image')?.attrs?.href).toBe('#cover_1.jpg');
    expect(store.getState().document!.binaries.map((b) => b.id)).toEqual(['cover_1.jpg']);
    // "Yes" inserts a clear image (the placeholder reference edited through the Links bar).
    ctx.dialogs.messageAnswers.push('yes');
    caret(h, 'p1', 0);
    await services.commands.execute('insert.sectionImage', ctx);
    section = store.getState().document!.bodies[0]!.content[1] as SectionNode;
    expect(section.content[1]).toMatchObject({ type: 'image', attrs: { href: '#undefined' } });
  });

  it('creates the footnote through a model step when the notes body is not mounted (windowed book)', async () => {
    const big = twoSectionBook();
    const body = big.bodies[0]!;
    const sections = Array.from({ length: 60 }, (_, i) => ({
      type: 'section' as const,
      attrs: { nodeId: `w${i}` },
      content: [paragraph(`wp${i}`, `Windowed section ${i} text.`)],
    }));
    big.bodies = [{ ...body, content: [...body.content, ...sections] as BodyNode['content'] }];
    const h = await harness(big);
    const { services, ctx, store } = h;
    const controller = getBodyController(store);
    expect(controller.currentWindow?.wholeBook).toBe(false);
    caret(h, 'p1', 6, 10);
    await services.commands.execute('style.footnote', ctx);
    let doc = store.getState().document!;
    expect(doc.bodies).toHaveLength(2);
    expect((doc.bodies[1]!.content[1] as SectionNode).attrs.id).toBe('n_1');
    // The caret stays on the reference (the note is not mounted); Go to footnote reaches it.
    expect(store.getState().selectionPath).toBe('body[1]/section[1]/p[1]');
    // Two entries (the link in the editor, the note in the model) in one undo group.
    const entries = services.undo.entries();
    expect(entries.map((e) => e.view)).toEqual(['body', 'body-model']);
    expect(entries[0]!.groupId).toBe(entries[1]!.groupId);
    // One Undo removes link and note together.
    services.undo.undo();
    doc = store.getState().document!;
    expect(doc.bodies).toHaveLength(1);
    const p1 = (doc.bodies[0]!.content[1] as SectionNode).content[1] as {
      content: { marks?: unknown[] }[];
    };
    expect(p1.content.every((c) => !c.marks)).toBe(true);
    // Redo restores both; Go to footnote then moves the window to the note and back.
    services.undo.redo();
    expect(store.getState().document!.bodies).toHaveLength(2);
    await services.commands.execute('edit.gotoFootnote', ctx);
    expect(store.getState().selectionPath).toBe('body[2]/section[1]/p[1]');
    await services.commands.execute('edit.gotoFootnote', ctx);
    expect(store.getState().selectionPath).toBe('body[1]/section[1]/p[1]');
    // Moving the window reset the editor history; the model step is still undoable.
    expect(services.undo.entries().map((e) => e.view)).toEqual(['body-model']);
  });
});

describe('find / replace (T066)', () => {
  it('finds forward with wrap-around, respects whole words / case / regex and reports failures', async () => {
    const h = await harness();
    const { services, ctx, store } = h;
    const session = getSearchSession(store);
    caret(h, 'p1', 0);
    const opts = {
      query: 'beta',
      wholeWord: false,
      matchCase: false,
      regex: false,
      direction: 'down' as const,
    };
    expect(session.find(opts)).toBe(true);
    const controller = getBodyController(store);
    const selected = () => controller.getContext().selectedText;
    expect(selected()).toBe('beta');
    expect(store.getState().selectionPath).toBe('body[1]/section[1]/p[1]');
    expect(session.find(opts)).toBe(true);
    expect(selected()).toBe('Beta'); // case-insensitive, p2 first hit
    expect(session.find(opts)).toBe(true); // p2 second hit
    expect(session.find(opts)).toBe(true);
    expect(store.getState().selectionPath).toBe('body[1]/section[2]/p[1]'); // unmounted-safe, next section
    expect(session.find(opts)).toBe(true); // wraps to p1
    expect(store.getState().selectionPath).toBe('body[1]/section[1]/p[1]');
    // Match case: only the lowercase ones (p1 + p3) exist.
    expect(session.find({ ...opts, matchCase: true })).toBe(true);
    expect(store.getState().selectionPath).toBe('body[1]/section[2]/p[1]');
    // Whole word: "Alpha" but not "Alph".
    expect(session.find({ ...opts, query: 'Alph', wholeWord: true })).toBe(false);
    expect(session.find({ ...opts, query: 'alpha', wholeWord: true })).toBe(true);
    // Regex.
    expect(session.find({ ...opts, query: 'g[a-z]+ma', regex: true })).toBe(true);
    expect(selected()).toBe('gamma');
    // Direction up from p3 reaches p2's last Beta.
    caret(h, 'p3', 0);
    expect(session.find({ ...opts, direction: 'up' })).toBe(true);
    expect(store.getState().selectionPath).toBe('body[1]/section[1]/p[2]');
    expect(controller.editorState!.selection.$from.parentOffset).toBe(16);
    // Find Next command with a missing string reports "Cannot find the string".
    session.options = { ...opts, query: 'nothing here' };
    await services.commands.execute('edit.findNext', ctx);
    expect(ctx.dialogs.shown.at(-1)?.text).toBe("Cannot find the string 'nothing here'.");
  });

  it('Replace replaces the current match then finds the next; Replace All is one undo entry', async () => {
    const h = await harness();
    const { services, store, ctx } = h;
    const session = getSearchSession(store);
    caret(h, 'p1', 0);
    const opts = {
      query: 'beta',
      wholeWord: false,
      matchCase: false,
      regex: false,
      direction: 'down' as const,
    };
    expect(session.find(opts)).toBe(true);
    const result = session.replace(opts, 'delta');
    expect(result).toEqual({ replaced: true, found: true });
    const textOf = (nodeId: string) => {
      let found = '';
      const visit = (n: { attrs?: { nodeId?: string }; content?: { text?: string }[] }) => {
        if (n.attrs?.nodeId === nodeId) found = (n.content ?? []).map((c) => c.text ?? '').join('');
        (n.content as unknown as (typeof n)[])?.forEach(visit);
      };
      store.getState().document!.bodies.forEach((b) => visit(b as never));
      return found;
    };
    expect(textOf('p1')).toBe('Alpha delta gamma.');
    const depthBefore = services.undo.undoDepth;
    const count = session.replaceAll(
      { ...opts, regex: true, query: '(b)eta' },
      '$U$1$Qravo',
      'Replace All',
    );
    expect(count).toBe(3);
    expect(textOf('p2')).toBe('Bravo again, and Bravo once more.');
    expect(textOf('p3')).toBe('Second section Bravo.');
    expect(services.undo.undoDepth).toBe(depthBefore + 1);
    services.undo.undo();
    expect(textOf('p2')).toBe('Beta again, and Beta once more.');
    expect(textOf('p3')).toBe('Second section beta.');
    expect(session.replaceAll(opts, 'x')).toBe(3);
    await session.reportReplaceAll(ctx, 3);
    expect(ctx.dialogs.shown.at(-1)?.text).toBe('3 replacements done.');
  });

  it('walks the annotation, the history, then the bodies, and replaces inside the description (004 US2)', async () => {
    const book = twoSectionBook();
    const annotationNode = {
      type: 'annotation' as const,
      attrs: { nodeId: 'ann' },
      content: [paragraph('annP1', 'Beta in the annotation.'), paragraph('annP2', 'Second.')],
    };
    const historyNode = {
      type: 'annotation' as const,
      attrs: { nodeId: 'hist', lang: 'ru' },
      content: [paragraph('histP1', 'Beta in the history.')],
    };
    const document: Document = {
      ...book,
      description: {
        ...book.description,
        titleInfo: { ...book.description.titleInfo, annotation: annotationNode as never },
        documentInfo: { ...book.description.documentInfo, history: historyNode as never },
      },
    };
    expect(collectTextblocks(document).map((block) => block.nodeId)).toEqual([
      'annP1',
      'annP2',
      'histP1',
      't0p',
      't1p',
      'p1',
      'p2',
      'p3',
    ]);
    const replaced = replaceTextblocksInModel(
      document,
      new Map([
        ['histP1', paragraph('histP1', 'Delta in the history.') as never],
        ['p3', paragraph('p3', 'Second section delta.') as never],
      ]),
    );
    expect(replaced.description.documentInfo.history).toMatchObject({
      attrs: { nodeId: 'hist', lang: 'ru' },
      content: [{ attrs: { nodeId: 'histP1' }, content: [{ text: 'Delta in the history.' }] }],
    });
    expect(replaced.description.titleInfo.annotation).toBe(annotationNode);
    expect(replaced.bodies[0]).not.toBe(document.bodies[0]);
    expect(collectTextblocks(replaced).find((b) => b.nodeId === 'p3')!.text).toBe(
      'Second section delta.',
    );
    // Nothing to replace: the same model object comes back.
    expect(replaceTextblocksInModel(document, new Map())).toBe(document);

    // Through the search session: Find reaches the blocks first, Replace changes the history.
    const h = await harness(document);
    const { store } = h;
    const session = getSearchSession(store);
    caret(h, 'p1', 0);
    const opts = {
      query: 'beta',
      wholeWord: false,
      matchCase: false,
      regex: false,
      direction: 'down' as const,
    };
    // From p1 downwards: p1, p2 (twice), p3, then wrapping to the annotation and the history.
    expect(session.find(opts)).toBe(true);
    expect(session.find(opts)).toBe(true);
    expect(session.find(opts)).toBe(true);
    expect(session.find(opts)).toBe(true);
    expect(store.getState().selectionPath).toBe('body[1]/section[2]/p[1]');
    expect(session.find(opts)).toBe(true); // wrapped to the top of the document
    expect(store.getState().selectionPath).toBe('title-info/annotation[1]/p[1]');
    expect(session.find(opts)).toBe(true);
    expect(store.getState().selectionPath).toBe('document-info/history[1]/p[1]');
    expect(session.replace(opts, 'Gamma')).toEqual({ replaced: true, found: true });
    const history = store.getState().document!.description.documentInfo.history!;
    expect((history.content[0] as { content: { text: string }[] }).content[0]!.text).toBe(
      'Gamma in the history.',
    );
    expect(history.attrs.lang).toBe('ru');
    expect(store.getState().document!.description.titleInfo.annotation).toBe(annotationNode);
    h.services.undo.undo();
    const reverted = store.getState().document!.description.documentInfo.history!;
    expect((reverted.content[0] as { content: { text: string }[] }).content[0]!.text).toBe(
      'Beta in the history.',
    );
  });

  it('persists the find / replace histories (last 20, most recent first) through settings.set', async () => {
    const h = await harness();
    const { store, ctx } = h;
    const session = getSearchSession(store);
    const settings = { session: { findHistory: ['old'], replaceHistory: [] } } as never;
    store.setState({ settings });
    await session.remember(ctx, 'find', 'beta');
    expect(session.findHistory).toEqual(['beta', 'old']);
    await session.remember(ctx, 'find', 'old');
    expect(session.findHistory).toEqual(['old', 'beta']);
    for (let i = 0; i < 25; i += 1) await session.remember(ctx, 'replace', `r${i}`);
    expect(session.replaceHistory).toHaveLength(20);
    expect(session.replaceHistory[0]).toBe('r24');
  });

  it('incremental search selects matches while typing and drives the status bar', async () => {
    const h = await harness();
    const { store, ctx } = h;
    const session = getSearchSession(store);
    const incremental = new IncrementalSearch(store, session);
    caret(h, 'p1', 0);
    incremental.toggle(ctx);
    expect(incremental.isActive).toBe(true);
    expect(store.getState().statusMessage).toBe('Incremental Search: ');
    const key = (k: string) =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }),
      );
    key('g');
    key('a');
    expect(store.getState().statusMessage).toBe('Incremental Search: ga');
    const controller = getBodyController(store);
    expect(controller.getContext().selectedText).toBe('ga');
    expect(store.getState().selectionPath).toBe('body[1]/section[1]/p[1]');
    key('z');
    expect(store.getState().statusMessage).toBe('Failing Incremental Search: gaz');
    key('Backspace');
    expect(store.getState().statusMessage).toBe('Incremental Search: ga');
    key('m');
    expect(controller.getContext().selectedText).toBe('gam');
    key('Enter');
    expect(incremental.isActive).toBe(false);
    expect(store.getState().statusMessage).toBeNull();
    expect(controller.getContext().selectedText).toBe('gam'); // accepted
    // Escape cancels back to the anchor.
    incremental.toggle(ctx);
    key('S');
    expect(controller.getContext().selectedText).toBe('S');
    key('Escape');
    expect(incremental.isActive).toBe(false);
    expect(controller.getContext().selectedText).toBe('gam');
  });
});

describe('find / replace as in the original (feature 002)', () => {
  const opts = {
    query: 'beta',
    wholeWord: false,
    matchCase: false,
    regex: false,
    direction: 'down' as const,
  };

  it('beeps when a search continues from the other end of the document', async () => {
    const h = await harness(twoSectionBook(), { 'app.beep': {} });
    const session = getSearchSession(h.store);
    const beeps = () => h.calls.filter((call) => call.method === 'app.beep');
    caret(h, 'p3', 0);
    expect(session.find(opts)).toBe(true);
    expect(beeps()).toHaveLength(0);
    expect(session.find(opts)).toBe(true);
    expect(h.store.getState().selectionPath).toBe('body[1]/section[1]/p[1]');
    expect(beeps()).toHaveLength(1);
    expect(beeps()[0]!.params).toEqual({ kind: 'searchWrap' });
  });

  it('starts from a selected picture, after it (down) or before it (up)', async () => {
    const book = twoSectionBook();
    const section = book.bodies[0]!.content[1] as SectionNode;
    section.content.splice(2, 0, {
      type: 'image',
      attrs: { nodeId: 'img1', href: '#pic.png' },
    } as SectionNode['content'][number]);
    const h = await harness(book);
    const session = getSearchSession(h.store);
    const controller = getBodyController(h.store);
    const selectPicture = () => {
      const state = controller.editorState!;
      const picture = findNodeById(state.doc, 'img1')!;
      controller.apply(state.tr.setSelection(NodeSelection.create(state.doc, picture.pos)));
    };
    selectPicture();
    expect(session.find(opts)).toBe(true);
    expect(h.store.getState().selectionPath).toBe('body[1]/section[1]/p[2]');
    expect(controller.editorState!.selection.$from.parentOffset).toBe(0);
    selectPicture();
    expect(session.find({ ...opts, direction: 'up' })).toBe(true);
    expect(h.store.getState().selectionPath).toBe('body[1]/section[1]/p[1]');
  });

  it('Replace is an undo step of its own between the typing before and after it', async () => {
    const h = await harness();
    const { services, store } = h;
    const controller = getBodyController(store);
    const session = getSearchSession(store);
    const type = (text: string, nodeId: string) => {
      const state = controller.editorState!;
      controller.apply(state.tr.insertText(text, findNodeById(state.doc, nodeId)!.pos + 1));
    };
    type('X', 'p1');
    caret(h, 'p1', 0);
    expect(session.find(opts)).toBe(true);
    expect(session.replace(opts, 'delta')).toEqual({ replaced: true, found: true });
    expect(modelText(h, 'p1')).toBe('XAlpha delta gamma.');
    type('Y', 'p1');
    expect(modelText(h, 'p1')).toBe('YXAlpha delta gamma.');
    services.undo.undo();
    expect(modelText(h, 'p1')).toBe('XAlpha delta gamma.');
    services.undo.undo();
    expect(modelText(h, 'p1')).toBe('XAlpha beta gamma.');
    services.undo.undo();
    expect(modelText(h, 'p1')).toBe('Alpha beta gamma.');
    services.undo.redo();
    services.undo.redo();
    expect(modelText(h, 'p1')).toBe('XAlpha delta gamma.');
  });

  it('a replacement stays undoable when the next match lies outside the mounted window', async () => {
    const base = fakeDocument();
    const sections = Array.from({ length: 45 }, (_, i) => ({
      type: 'section' as const,
      attrs: { nodeId: `s${i + 1}` },
      content: [paragraph(`p${i + 1}`, i === 1 || i === 43 ? 'a beta here' : 'filler')],
    }));
    const h = await harness({
      ...base,
      bodies: [{ type: 'body', attrs: { nodeId: 'b1' }, content: sections } as BodyNode],
    });
    const controller = getBodyController(h.store);
    const session = getSearchSession(h.store);
    caret(h, 'p2', 0);
    expect(controller.currentWindow?.wholeBook).toBe(false);
    expect(session.find(opts)).toBe(true);
    expect(session.replace(opts, 'delta')).toEqual({ replaced: true, found: true });
    expect(h.store.getState().selectionPath).toBe('body[1]/section[44]/p[1]');
    expect(modelText(h, 'p2')).toBe('a delta here');
    h.services.undo.undo();
    expect(modelText(h, 'p2')).toBe('a beta here');
  });
});

describe('undo across views (T070)', () => {
  it('keeps the Body history while another view is active and switches back on undo', async () => {
    const h = await harness();
    const { services, ctx, store } = h;
    caret(h, 'p1', 2);
    await services.commands.execute('insert.epigraph', ctx);
    expect(sectionNames(h)).toEqual(['title', 'epigraph', 'p', 'p']);
    actions.setActiveView(store, 'description');
    services.undo.boundary('description');
    expect(services.undo.canUndo).toBe(true);
    services.undo.undo();
    expect(store.getState().activeView).toBe('body');
    expect(sectionNames(h)).toEqual(['title', 'p', 'p']);
    services.undo.redo();
    expect(sectionNames(h)).toEqual(['title', 'epigraph', 'p', 'p']);
  });

  it('Add body appends a body with title and section (whole-book) and the Edit menu states follow', async () => {
    const h = await harness();
    const { services, ctx, store } = h;
    caret(h, 'p1', 2);
    expect(services.commands.isEnabled('edit.undo', ctx)).toBe(false);
    await services.commands.execute('insert.body', ctx);
    expect(store.getState().document!.bodies).toHaveLength(2);
    expect(store.getState().document!.bodies[1]!.content.map((c) => c.type)).toEqual([
      'title',
      'section',
    ]);
    expect(services.commands.isEnabled('edit.undo', ctx)).toBe(true);
    expect(services.commands.isEnabled('edit.redo', ctx)).toBe(false);
    await services.commands.execute('edit.undo', ctx);
    expect(store.getState().document!.bodies).toHaveLength(1);
    expect(services.commands.isEnabled('edit.redo', ctx)).toBe(true);
  });
});
