/**
 * T093/T094 - image flows: the Add-menu commands take over the stubs ("Insert clear image?"
 * with Don't ask again, file dialog + binary.add, Add Binary Object...), clipboard image paste
 * and drag-and-drop upload bytes with `POST /binary/{docId}` (never JSON) and insert an image
 * node at the caret, "Save image as..." exports through dialog.saveFile + binary.export, and
 * the binary bookkeeping helpers (reference counts, dangling refs, model updates).
 */

import { Fragment, Slice } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';

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
import {
  handleImagePaste,
  imageFileFromDataTransfer,
  pasteImageFile,
} from '@/features/images/paste';
import {
  imageContextMenuItems,
  imageHrefForSaving,
  handleContextMenuTarget,
  suggestedFileName,
} from '@/features/images/saveAs';
import { initI18n } from '@/i18n';
import type { BinaryMeta, Document, SectionNode } from '@/model/document';
import { actions, createAppStore } from '@/model/store';
import { getBodyController } from '@/views/body/bodyEditor';
import { contextMenuExtensions } from '@/views/body/contextMenuExtensions';

import { fakeDocument, fakeRpc, makeContext, type FakeRpc, flowCalls } from './testUtils';

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

async function harness(responses: Record<string, unknown> = {}) {
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
  actions.setDocument(store, fakeDocument());
  const controller = getBodyController(store);
  const host = document.createElement('div');
  document.body.appendChild(host);
  controller.mount(host);
  caretIntoFirstParagraph(controller);
  const view = controller.editorView!;
  return { store, rpc, services, ctx, controller, host, view };
}

function caretIntoFirstParagraph(controller: ReturnType<typeof getBodyController>): void {
  const view = controller.editorView!;
  let pos = 0;
  view.state.doc.descendants((node, p) => {
    if (node.type.name === 'p' && !pos) pos = p + 1;
    return !pos;
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
    expect(flowCalls(rpc)[0]).toMatchObject({
      method: 'dialog.openFile',
      params: { multiple: true },
    });
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
        controller,
        new Blob([new Uint8Array([1])], { type: 'image/png' }),
      );
      expect(kind === null || kind === 'section').toBe(true);
      expect(store.getState().document!.binaries).toEqual([META]);
      expect(store.getState().modified).toBe(true);
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
    const sec = view.state.doc.firstChild!.firstChild!;
    const end = 1 + 1 + sec.content.size; // after the paragraph inside the section
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
    expect(flowCalls(rpc)[0]!.params).toMatchObject({ defaultPath: 'tiny.png' });
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
