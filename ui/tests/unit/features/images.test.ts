/**
 * T093/T094 - image flows: the Add-menu commands take over the stubs ("Insert clear image?"
 * with Don't ask again, file dialog + binary.add, Add Binary Object...), clipboard image paste
 * and drag-and-drop upload bytes with `POST /binary/{docId}` (never JSON) and insert an image
 * node at the caret, "Save image as..." exports through dialog.saveFile + binary.export, and
 * the binary bookkeeping helpers (reference counts, dangling refs, model updates). Feature 006
 * (US3, T081): the same flows put inline images into table cells through the active editing
 * target, and the block forms say why a cell refuses them (FR-024 to FR-026; I10).
 */

/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Fragment, Slice } from 'prosemirror-model';
import { TextSelection, type EditorState } from 'prosemirror-state';

import { createAppServices } from '@/app/services';
import { fb2Schema } from '@/editor/schema';
import {
  addBinaryToModel,
  danglingImageRefs,
  imageMimeType,
  isClearImageType,
  referenceCounts,
  removeBinaryFromModel,
  replaceBinariesInModel,
  uploadBinary,
} from '@/features/images/binaries';
import { handleImageDrop, installImageDragDrop } from '@/features/images/dragdrop';
import { insertImageAtCaret, type ImageTarget } from '@/features/images/insert';
import {
  handleImagePaste,
  imageFileFromDataTransfer,
  imageTargetFor,
  pasteImageFile,
} from '@/features/images/paste';
import {
  imageContextMenuItems,
  imageHrefForSaving,
  handleContextMenuTarget,
  suggestedFileName,
} from '@/features/images/saveAs';
import { activeTableTarget } from '@/features/tables/target';
import { initI18n } from '@/i18n';
import type {
  AnnotationNode,
  BinaryMeta,
  Document,
  SectionNode,
  TableNode,
} from '@/model/document';
import { actions, createAppStore } from '@/model/store';
import { getBodyController } from '@/views/body/bodyEditor';
import { contextMenuExtensions } from '@/views/body/contextMenuExtensions';
import { createRichFieldState } from '@/views/description/richFieldState';

import {
  fakeDocument,
  fakeRpc,
  fakeRunLock,
  makeContext,
  type FakeRpc,
  flowCalls,
} from './testUtils';

/** The clipboard fixtures of feature 006 (T018). */
const CLIPBOARD_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../tests/fixtures/clipboard',
);

beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }),
  });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  });
  document.elementFromPoint = () => null;
});

const META: BinaryMeta = {
  id: 'tiny.png',
  contentType: 'image/png',
  size: 89,
  width: 8,
  height: 6,
  decodable: true,
  willConvert: false,
  referenceCount: 0,
};

const SETTINGS = {
  schemaVersion: 1 as const,
  view: {} as never,
  other: {
    askOnNonClearImage: true,
    insertClearImages: false,
    pasteImageFormat: 'jpeg' as const,
    jpegQuality: 90,
  } as Record<string, unknown>,
  words: {} as never,
  session: { findHistory: [], replaceHistory: [] } as never,
};

async function harness(responses: Record<string, unknown> = {}, book: Document = fakeDocument()) {
  await initI18n({ language: 'en' });
  const store = createAppStore();
  const rpc: FakeRpc = fakeRpc({
    'settings.set': (params: unknown) => ({
      settings: {
        ...SETTINGS,
        other: { ...SETTINGS.other, ...(params as { patch: { other: object } }).patch.other },
      },
      restartRequired: false,
    }),
    'dialog.openFile': { paths: ['/pictures/tiny.png'] },
    'binary.add': META,
    ...responses,
  });
  const services = createAppServices({ store, rpc: rpc.client, platform: 'linux' });
  const ctx = await makeContext({ store, rpc: rpc.client, undo: services.undo });
  store.setState({ settings: SETTINGS as never, connection: 'connected' });
  actions.setDocument(store, book);
  const controller = getBodyController(store);
  const host = document.createElement('div');
  document.body.appendChild(host);
  controller.mount(host);
  caretIntoFirstParagraph(controller);
  const view = controller.editorView!;
  return { store, rpc, services, ctx, controller, host, view };
}

/** Puts the caret into the first paragraph of the first body (below the description blocks). */
function caretIntoFirstParagraph(controller: ReturnType<typeof getBodyController>): void {
  const view = controller.editorView!;
  let pos = 0;
  view.state.doc.forEach((child, offset) => {
    if (pos || child.type.name !== 'body') return;
    child.descendants((node, p) => {
      if (node.type.name === 'p' && !pos) pos = offset + 1 + p + 1;
      return !pos;
    });
  });
  controller.apply(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 2)));
}

/** jsdom has no DataTransfer: the subset the handlers read. */
function fakeTransfer(files: File[], text: Record<string, string> = {}): DataTransfer {
  return {
    files,
    items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
    types: [...(files.length ? ['Files'] : []), ...Object.keys(text)],
    getData: (type: string) => text[type] ?? '',
    dropEffect: 'none',
  } as unknown as DataTransfer;
}

function syntheticEvent<T extends Event>(
  type: string,
  target: EventTarget,
  props: Record<string, unknown>,
): T {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(event, key, { value, configurable: true });
  }
  Object.defineProperty(event, 'target', { value: target, configurable: true });
  return event as T;
}

function section(store: ReturnType<typeof createAppStore>): SectionNode {
  return store.getState().document!.bodies[0]!.content[0] as SectionNode;
}

function okFetch(meta: BinaryMeta = META) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(meta), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

describe('binary helpers', () => {
  it('uploads raw bytes with the content type and suggested id, never as JSON', async () => {
    const { calls, fetchImpl } = okFetch();
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const meta = await uploadBinary('d1', blob, {
      contentType: 'image/png',
      suggestedId: 'tiny.png',
      fetchImpl,
      baseUrl: '/',
    });
    expect(meta.id).toBe('tiny.png');
    expect(calls[0]!.url).toMatch(/^\/binary\/d1/);
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.body).toBe(blob);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('image/png');
    expect(headers['X-MFBE-Suggested-Id']).toBe('tiny.png');
    const failing = async () => new Response('nope', { status: 500 });
    await expect(
      uploadBinary('d1', blob, { contentType: 'image/png', fetchImpl: failing as never }),
    ).rejects.toThrow(/500/);
  });

  it('counts references, finds dangling refs and maintains the model list', () => {
    const store = createAppStore();
    const doc: Document = fakeDocument({
      binaries: [META],
      description: {
        ...fakeDocument().description,
        titleInfo: {
          ...fakeDocument().description.titleInfo,
          coverpage: [{ href: '#tiny.png' }, { href: '#gone' }],
        },
      },
    });
    (doc.bodies[0]!.content[0] as SectionNode).content.push({
      type: 'image',
      attrs: { nodeId: 'i1', href: '#tiny.png' },
    } as never);
    actions.setDocument(store, doc);
    expect(referenceCounts(doc).get('tiny.png')).toBe(2);
    expect(danglingImageRefs(doc)).toEqual(['#gone']);
    addBinaryToModel(store, { ...META, id: 'other.jpg' });
    expect(store.getState().document!.binaries.map((b) => b.id)).toEqual(['tiny.png', 'other.jpg']);
    expect(store.getState().modified).toBe(false);
    removeBinaryFromModel(store, 'tiny.png');
    expect(store.getState().document!.binaries.map((b) => b.id)).toEqual(['other.jpg']);
    expect(store.getState().modified).toBe(true);
    const before = store.getState().document;
    replaceBinariesInModel(store, [{ ...META, id: 'other.jpg' }]);
    expect(store.getState().document).toBe(before);
    replaceBinariesInModel(store, [META]);
    expect(store.getState().document!.binaries).toEqual([META]);
    expect(imageMimeType('a.TIF')).toBe('image/tiff');
    expect(imageMimeType('a.txt')).toBeNull();
    expect(isClearImageType('image/jpeg')).toBe(true);
    expect(isClearImageType('image/gif')).toBe(false);
    expect(suggestedFileName('cover', 'image/jpeg')).toBe('cover.jpg');
    expect(suggestedFileName('cover.png', 'image/png')).toBe('cover.png');
  });
});

describe('Add-menu image commands (T093)', () => {
  it('replaces the stubs; "Insert clear image?" No -> file dialog -> binary.add -> node', async () => {
    const { store, rpc, services, ctx } = await harness();
    for (const id of [
      'insert.image',
      'insert.inlineImage',
      'insert.sectionImage',
      'insert.binary',
    ]) {
      expect(services.commands.get(id)?.stub).toBeUndefined();
    }
    expect(services.commands.isEnabled('insert.image', ctx)).toBe(true);
    ctx.dialogs.messageAnswers.push('no');
    await services.commands.execute('insert.image', ctx);
    expect(ctx.dialogs.shown.at(-1)).toMatchObject({
      text: 'Insert clear image?',
      dontAskAgain: true,
      testId: 'dialog-insert-clear-image',
    });
    expect(flowCalls(rpc).map((c) => c.method)).toEqual(['dialog.openFile', 'binary.add']);
    // The original's image types plus WebP, "Supported images" selected, no "All files".
    expect(flowCalls(rpc)[0]!.params).toMatchObject({ selectedFilter: 0 });
    expect(
      (flowCalls(rpc)[0]!.params as { filters: { name: string }[] }).filters.map((f) => f.name),
    ).toEqual([
      'Supported images (*.jpg;*.jpeg;*.png)',
      'JPEG (*.jpg)',
      'PNG (*.png)',
      'Bitmap (*.bmp)',
      'GIF (*.gif)',
      'TIFF (*.tif)',
      'WebP (*.webp)',
    ]);
    expect(flowCalls(rpc)[1]!.params).toMatchObject({
      docId: 'doc-1',
      path: '/pictures/tiny.png',
      suggestedId: 'tiny.png',
    });
    expect(section(store).content.map((c) => c.type)).toEqual(['p', 'image']);
    expect(section(store).content[1]!.attrs).toMatchObject({ href: '#tiny.png' });
    expect(store.getState().document!.binaries).toEqual([META]);
    expect(store.getState().modified).toBe(true);
  });

  it('"Yes" inserts a clear image and "Don\'t ask again" persists the settings', async () => {
    const { store, rpc, services, ctx, controller } = await harness();
    ctx.dialogs.showMessageWithResult = async (options) => {
      ctx.dialogs.shown.push(options);
      return { button: 'yes', dontAskAgain: true };
    };
    await services.commands.execute('insert.sectionImage', ctx);
    expect(section(store).content[0]).toMatchObject({
      type: 'image',
      attrs: { href: '#undefined' },
    });
    expect(flowCalls(rpc).map((c) => c.method)).toEqual(['settings.set']);
    expect(flowCalls(rpc)[0]!.params).toEqual({
      patch: { other: { askOnNonClearImage: false, insertClearImages: true } },
    });
    expect(store.getState().settings?.other.askOnNonClearImage).toBe(false);
    // Not asked any more: the persisted answer applies (caret back into the paragraph first).
    const shown = ctx.dialogs.shown.length;
    caretIntoFirstParagraph(controller);
    await services.commands.execute('insert.image', ctx);
    expect(ctx.dialogs.shown.length).toBe(shown);
    expect(section(store).content.filter((c) => c.type === 'image')).toHaveLength(2);
  });

  it('Add Binary Object... embeds files without inserting a node', async () => {
    const { store, rpc, services, ctx } = await harness({
      'dialog.openFile': { paths: ['/pictures/a.gif', '/pictures/b.webp'] },
      'binary.add': (params: unknown) => ({
        ...META,
        id: (params as { suggestedId: string }).suggestedId,
        contentType: 'image/gif',
        willConvert: true,
      }),
    });
    expect(services.commands.isEnabled('insert.binary', ctx)).toBe(true);
    await services.commands.execute('insert.binary', ctx);
    // The original's list: All files first, "Supported images" selected, several files.
    expect(flowCalls(rpc)[0]).toMatchObject({
      method: 'dialog.openFile',
      params: { multiple: true, selectedFilter: 1 },
    });
    const filters = (flowCalls(rpc)[0]!.params as { filters: unknown[] }).filters;
    expect(filters).toHaveLength(8);
    expect(filters.slice(0, 2)).toEqual([
      { name: 'All files (*.*)', extensions: ['*'] },
      { name: 'Supported images (*.jpg;*.jpeg;*.png)', extensions: ['jpg', 'jpeg', 'png'] },
    ]);
    expect(store.getState().document!.binaries.map((b) => b.id)).toEqual(['a.gif', 'b.webp']);
    expect(section(store).content.map((c) => c.type)).toEqual(['p']);
    expect(store.getState().modified).toBe(true);
    expect(store.getState().statusMessage).toBe('2 binary objects added');
  });
});

describe('paste and drag-and-drop (T093)', () => {
  it('uploads a pasted image file over HTTP and inserts an inline image at the caret', async () => {
    const { store, controller, view } = await harness();
    const { calls, fetchImpl } = okFetch();
    const original = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const file = new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' });
      const data = fakeTransfer([file]);
      expect(imageFileFromDataTransfer(data)?.name).toBe('shot.png');
      const event = syntheticEvent<ClipboardEvent>('paste', view.dom.querySelector('p')!, {
        clipboardData: data,
      });
      expect(handleImagePaste(store, event)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]!.url).toContain('/binary/doc-1');
      expect((calls[0]!.init.headers as Record<string, string>)['Content-Type']).toBe('image/png');
      await vi.waitFor(() => {
        const p = section(store).content[0] as {
          content: { type: string; attrs?: { href?: string } }[];
        };
        expect(p.content.find((c) => c.type === 'inline-image')?.attrs?.href).toBe('#tiny.png');
      });
      expect(store.getState().document!.binaries).toEqual([META]);
      // A paste without an image is left to the editor.
      const textEvent = syntheticEvent<ClipboardEvent>('paste', view.dom.querySelector('p')!, {
        clipboardData: fakeTransfer([], { 'text/plain': 'hello' }),
      });
      expect(handleImagePaste(store, textEvent)).toBe(false);
      // Outside the editor nothing happens.
      const outside = syntheticEvent<ClipboardEvent>('paste', document.body, {
        clipboardData: data,
      });
      expect(handleImagePaste(store, outside)).toBe(false);
      void controller;
    } finally {
      globalThis.fetch = original;
    }
  });

  it('drops image files into the editor and reports upload failures in the status bar', async () => {
    const { store, view } = await harness();
    const { calls, fetchImpl } = okFetch({ ...META, id: 'dropped.jpg', contentType: 'image/jpeg' });
    const original = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    const off = installImageDragDrop(store);
    try {
      const data = fakeTransfer([
        new File([new Uint8Array([255, 216])], 'dropped.jpg', { type: 'image/jpeg' }),
      ]);
      const over = new Event('dragover', { bubbles: true, cancelable: true });
      Object.defineProperty(over, 'dataTransfer', { value: data });
      view.dom.querySelector('p')!.dispatchEvent(over);
      expect(over.defaultPrevented).toBe(true);
      expect(view.dom.classList.contains('mfbe-drop-target')).toBe(true);
      const drop = syntheticEvent<DragEvent>('drop', view.dom.querySelector('p')!, {
        dataTransfer: data,
        clientX: 5,
        clientY: 5,
      });
      const pending = handleImageDrop(store, drop);
      expect(pending).not.toBeNull();
      expect(await pending).toBe(1);
      expect(calls).toHaveLength(1);
      expect(view.dom.classList.contains('mfbe-drop-target')).toBe(false);
      expect(store.getState().document!.binaries.map((b) => b.id)).toEqual(['dropped.jpg']);

      globalThis.fetch = (async () => new Response('disk full', { status: 507 })) as never;
      const failing = syntheticEvent<DragEvent>('drop', view.dom.querySelector('p')!, {
        dataTransfer: data,
        clientX: 5,
        clientY: 5,
      });
      expect(await handleImageDrop(store, failing)).toBe(0);
      expect(store.getState().statusMessage).toMatch(/could not be embedded.*507/);
    } finally {
      off();
      globalThis.fetch = original;
    }
  });

  it('keeps the binary (and marks modified) when no image node fits at the caret', async () => {
    const { store, controller, view } = await harness();
    const { fetchImpl } = okFetch();
    const original = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      // Select the whole document: no inline / block position for an image.
      controller.apply(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, 0, view.state.doc.content.size),
        ),
      );
      const kind = await pasteImageFile(
        store,
        activeTableTarget(store)!,
        new Blob([new Uint8Array([1])], { type: 'image/png' }),
      );
      expect(kind === null || kind === 'section').toBe(true);
      expect(store.getState().document!.binaries).toEqual([META]);
      expect(store.getState().modified).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });
  it('an HTML table with text beside a picture is left to the clipboard router and nothing is uploaded; a picture alone in a Word table still pastes as a picture (feature 006, R5.9; data-model §8.9)', async () => {
    const { store, view } = await harness();
    const { calls, fetchImpl } = okFetch();
    const original = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const file = new File([new Uint8Array([137, 80, 78, 71])], 'tiny.png', { type: 'image/png' });
      const excel = readFileSync(path.join(CLIPBOARD_DIR, 'excel-win.html'), 'utf8');
      const withTable = syntheticEvent<ClipboardEvent>('paste', view.dom.querySelector('p')!, {
        clipboardData: fakeTransfer([file], { 'text/html': excel, 'text/plain': 'Region\t\tQ1' }),
      });
      expect(handleImagePaste(store, withTable)).toBe(false);
      expect(withTable.defaultPrevented).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(calls).toEqual([]);
      // A Word table whose only cell holds a picture and no text: the picture, as today.
      const pictureOnly =
        '<table class=MsoTableGrid><tr><td><p class=MsoNormal><img width=16 height=16 src="file:///C:/clip_image001.png"></p></td></tr></table>';
      const lone = syntheticEvent<ClipboardEvent>('paste', view.dom.querySelector('p')!, {
        clipboardData: fakeTransfer([file], { 'text/html': pictureOnly }),
      });
      expect(handleImagePaste(store, lone)).toBe(true);
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]!.url).toContain('/binary/doc-1');
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('Save image as... (T093)', () => {
  it('offers the entry for the selected or right-clicked image and exports through the core', async () => {
    const { store, rpc, services, ctx, controller, view } = await harness({
      'dialog.saveFile': { path: '/out/tiny.png' },
      'binary.export': {},
    });
    addBinaryToModel(store, META);
    // Insert an image node and select it.
    const image = fb2Schema.nodes.image!.create({ href: '#tiny.png' });
    // The first body follows the annotation / history blocks (feature 004).
    let bodyPos = 0;
    view.state.doc.forEach((child, offset) => {
      if (child.type.name === 'body' && !bodyPos) bodyPos = offset;
    });
    const sec = view.state.doc.nodeAt(bodyPos)!.firstChild!;
    const end = bodyPos + 1 + 1 + sec.content.size; // after the paragraph inside the section
    controller.apply(view.state.tr.replace(end, end, new Slice(Fragment.from(image), 0, 0)));
    expect(imageHrefForSaving(store, controller)).toBeNull();
    const figure = view.dom.querySelector('.fb-image')!;
    handleContextMenuTarget(store, figure);
    expect(imageHrefForSaving(store, controller)).toBe('#tiny.png');
    // The context-menu slot is registered and uses the remembered command context.
    expect(contextMenuExtensions.image).toBeDefined();
    services.commands.isEnabled('image.saveAs', ctx); // remembers ctx
    const items = imageContextMenuItems(store, services.commands, controller);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'save-image-as',
      label: 'Save image as...',
      enabled: true,
    });
    (items[0] as { run: () => void }).run();
    await vi.waitFor(() =>
      expect(flowCalls(rpc).map((c) => c.method)).toEqual(['dialog.saveFile', 'binary.export']),
    );
    expect(flowCalls(rpc)[0]!.params).toMatchObject({
      defaultPath: 'tiny.png',
      selectedFilter: 0,
      filters: [
        { name: 'JPEG files (*.jpg)', extensions: ['jpg'] },
        { name: 'PNG files (*.png)', extensions: ['png'] },
        { name: 'All files (*.*)', extensions: ['*'] },
      ],
    });
    expect(flowCalls(rpc)[1]!.params).toEqual({
      docId: 'doc-1',
      id: 'tiny.png',
      path: '/out/tiny.png',
    });
    expect(store.getState().statusMessage).toBe('Image saved to /out/tiny.png');
    // Not for the clear-image placeholder or unknown ids.
    handleContextMenuTarget(store, null);
    expect(imageHrefForSaving(store, controller)).toBeNull();
    expect(services.commands.isEnabled('image.saveAs', ctx)).toBe(false);
  });
});

/* ------------------------------------------------------------------------ */
/* Pictures in table cells (feature 006, US3)                               */
/* ------------------------------------------------------------------------ */

/** A 2 × 2 table with a header row after the first paragraph of the first section. */
function tableBook(): Document {
  const cell = (type: 'td' | 'th', nodeId: string, text: string) => ({
    type,
    attrs: { nodeId },
    content: [{ type: 'text' as const, text }],
  });
  const table: TableNode = {
    type: 'table',
    attrs: { nodeId: 't1' },
    content: [
      {
        type: 'tr',
        attrs: { nodeId: 'r1' },
        content: [cell('th', 'c1', 'Head A'), cell('th', 'c2', 'Head B')],
      },
      {
        type: 'tr',
        attrs: { nodeId: 'r2' },
        content: [cell('td', 'c3', 'Cell one'), cell('td', 'c4', 'Cell two')],
      },
    ],
  } as TableNode;
  const book = fakeDocument();
  (book.bodies[0]!.content[0] as SectionNode).content.push(table);
  return book;
}

/** The model's table of `tableBook()`: its cells as `kind:text[#href...]` in reading order. */
function cellsOf(store: ReturnType<typeof createAppStore>): string[] {
  const table = section(store).content.find((c) => c.type === 'table') as TableNode;
  return table.content.flatMap((row) =>
    row.content.map(
      (cell) =>
        `${cell.type}:` +
        (cell.content ?? [])
          .map((c) =>
            c.type === 'text' ? c.text : c.type === 'inline-image' ? `[${c.attrs.href}]` : '?',
          )
          .join(''),
    ),
  );
}

/** Puts the caret at the end of the text block whose text starts with `text`. */
function caretAtEndOf(controller: ReturnType<typeof getBodyController>, text: string): void {
  const view = controller.editorView!;
  let pos = -1;
  view.state.doc.descendants((node, p) => {
    if (pos >= 0) return false;
    if (node.isTextblock && node.textContent.startsWith(text)) {
      pos = p + 1 + node.content.size;
      return false;
    }
    return true;
  });
  if (pos < 0) throw new Error(`no text block "${text}"`);
  controller.apply(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
}

/** A fetch that answers an upload with a binary named after its suggested id. */
function namingFetch() {
  const calls: string[] = [];
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    const id = (init?.headers as Record<string, string>)['X-MFBE-Suggested-Id'] ?? 'x.png';
    calls.push(id);
    return new Response(JSON.stringify({ ...META, id }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

describe('pictures in table cells (feature 006, US3, T081)', () => {
  it('insertImageAtCaret in a td or a th gives inline on the Body target', async () => {
    const { store, controller } = await harness({}, tableBook());
    const target = activeTableTarget(store)!;
    caretAtEndOf(controller, 'Cell one');
    expect(insertImageAtCaret(target, { href: '#tiny.png' })).toBe('inline');
    caretAtEndOf(controller, 'Head B');
    expect(insertImageAtCaret(target, { href: '#tiny.png' })).toBe('inline');
    expect(cellsOf(store)).toEqual([
      'th:Head A',
      'th:Head B[#tiny.png]',
      'td:Cell one[#tiny.png]',
      'td:Cell two',
    ]);
  });

  it('a target with imagesOnlyInCells inserts nothing in a paragraph and an inline image in a cell', () => {
    const annotation = {
      type: 'annotation',
      attrs: { nodeId: 'a1' },
      content: [
        { type: 'p', attrs: { nodeId: 'a2' }, content: [{ type: 'text', text: 'A paragraph' }] },
        {
          type: 'table',
          attrs: { nodeId: 'a3' },
          content: [
            {
              type: 'tr',
              attrs: { nodeId: 'a4' },
              content: [
                {
                  type: 'td',
                  attrs: { nodeId: 'a5' },
                  content: [{ type: 'text', text: 'A cell' }],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as AnnotationNode;
    let ids = 0;
    let state: EditorState = createRichFieldState(annotation, () => `f${(ids += 1)}`);
    const target: ImageTarget = {
      get state() {
        return state;
      },
      view: null,
      dom: null,
      editable: true,
      imagesOnlyInCells: true,
      canRun: (cmd) => cmd(state),
      run: (cmd) =>
        cmd(state, (tr) => {
          state = state.apply(tr);
        }),
      setSelection: (tr) => {
        state = state.apply(tr);
      },
    };
    const endOf = (text: string) => {
      let pos = -1;
      state.doc.descendants((node, p) => {
        if (pos < 0 && node.isTextblock && node.textContent === text)
          pos = p + 1 + node.content.size;
        return pos < 0;
      });
      state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
    };
    endOf('A paragraph');
    const before = state.doc;
    expect(insertImageAtCaret(target, { href: '#a.png' })).toBeNull();
    expect(state.doc.eq(before)).toBe(true);
    endOf('A cell');
    expect(insertImageAtCaret(target, { href: '#a.png' })).toBe('inline');
    const cell = state.doc.child(1).child(0).child(0);
    expect(cell.type.name).toBe('td');
    expect(cell.lastChild?.type.name).toBe('inline_image');
    expect(state.doc.child(0).childCount).toBe(1); // the paragraph is unchanged
  });

  it("insert.image and insert.sectionImage are disabled in a cell with the reason 'a cell takes inline images only'; insert.inlineImage is enabled there", async () => {
    const { services, ctx, controller } = await harness({}, tableBook());
    for (const text of ['Cell one', 'Head A']) {
      caretAtEndOf(controller, text);
      expect(services.commands.isEnabled('insert.image', ctx)).toBe(false);
      expect(services.commands.isEnabled('insert.sectionImage', ctx)).toBe(false);
      expect(services.commands.isEnabled('insert.inlineImage', ctx)).toBe(true);
      expect(services.commands.unavailableReason('insert.image', ctx)).toBe(
        'a cell takes inline images only',
      );
      expect(services.commands.unavailableReason('insert.sectionImage', ctx)).toBe(
        'a cell takes inline images only',
      );
    }
    // In a paragraph directly in the section: available, no reason.
    caretAtEndOf(controller, 'Hello');
    expect(services.commands.isEnabled('insert.image', ctx)).toBe(true);
    expect(services.commands.unavailableReason('insert.image', ctx)).toBeNull();
    expect(services.commands.unavailableReason('insert.sectionImage', ctx)).toBeNull();
  });

  it('insert.inlineImage in a cell asks Insert clear image? and inserts the chosen binary in that cell', async () => {
    const { store, rpc, services, ctx, controller } = await harness({}, tableBook());
    caretAtEndOf(controller, 'Cell two');
    ctx.dialogs.messageAnswers.push('no');
    await services.commands.execute('insert.inlineImage', ctx);
    expect(ctx.dialogs.shown.at(-1)).toMatchObject({
      text: 'Insert clear image?',
      dontAskAgain: true,
      testId: 'dialog-insert-clear-image',
    });
    expect(flowCalls(rpc).map((c) => c.method)).toEqual(['dialog.openFile', 'binary.add']);
    expect(cellsOf(store)).toEqual([
      'th:Head A',
      'th:Head B',
      'td:Cell one',
      'td:Cell two[#tiny.png]',
    ]);
    expect(store.getState().document!.binaries).toEqual([META]);
    expect(store.getState().modified).toBe(true);
  });

  it("a pasted image file goes into the caret's cell", async () => {
    const { store, controller, view } = await harness({}, tableBook());
    const { calls, fetchImpl } = okFetch();
    const original = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      caretAtEndOf(controller, 'Cell one');
      const cell = view.dom.querySelectorAll('td')[0]!;
      const file = new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' });
      const event = syntheticEvent<ClipboardEvent>('paste', cell, {
        clipboardData: fakeTransfer([file]),
      });
      expect(handleImagePaste(store, event)).toBe(true);
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      await vi.waitFor(() =>
        expect(cellsOf(store)).toEqual([
          'th:Head A',
          'th:Head B',
          'td:Cell one[#tiny.png]',
          'td:Cell two',
        ]),
      );
    } finally {
      globalThis.fetch = original;
    }
  });

  it('three dropped files go into the cell in their order', async () => {
    const { store, controller, view } = await harness({}, tableBook());
    const { calls, fetchImpl } = namingFetch();
    const original = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      // jsdom has no layout for posAtCoords: the caret is put into the cell first.
      caretAtEndOf(controller, 'Cell two');
      const cell = view.dom.querySelectorAll('td')[1]!;
      const files = ['a.png', 'b.png', 'c.png'].map(
        (name) => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' }),
      );
      const drop = syntheticEvent<DragEvent>('drop', cell, {
        dataTransfer: fakeTransfer(files),
        clientX: 5,
        clientY: 5,
      });
      expect(await handleImageDrop(store, drop)).toBe(3);
      expect(calls).toEqual(['a.png', 'b.png', 'c.png']);
      expect(cellsOf(store)).toEqual([
        'th:Head A',
        'th:Head B',
        'td:Cell one',
        'td:Cell two[#a.png][#b.png][#c.png]',
      ]);
      // Each file is one insertion, one undo step.
      expect(controller.undoStep()).toBe(true);
      expect(cellsOf(store).at(-1)).toBe('td:Cell two[#a.png][#b.png]');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('imageTargetFor gives the Body target for an event inside the Body editor, and null outside it and under the run lock', async () => {
    const { store, view } = await harness({}, tableBook());
    const inside = view.dom.querySelector('td')!;
    expect(imageTargetFor(store, inside)).toBe(activeTableTarget(store));
    expect(imageTargetFor(store, view.dom.querySelector('p'))).toBe(activeTableTarget(store));
    expect(imageTargetFor(store, document.body)).toBeNull();
    expect(imageTargetFor(store, null)).toBeNull();
    actions.setRunLock(store, fakeRunLock());
    expect(imageTargetFor(store, inside)).toBeNull();
  });
});
