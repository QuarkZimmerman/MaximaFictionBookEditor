/**
 * The Edit menu's clipboard commands on tables (feature 006, T144; FR-059, FR-025, FR-032; R5.9;
 * C24; data-model §8.8, §8.9; research R5 items 8 and 11, R5.12), on the services and the Body
 * controller of the tables harness, with `navigator.clipboard.read` and `write` mocked:
 *  - Edit → Paste of a clipboard holding an HTML table with text and a picture of it puts the
 *    table at the caret's FR-004 point and uploads nothing; a lone picture still pastes as one;
 *  - Edit → Cut of a selected section's only table, when the synchronous cut fails, writes the
 *    three flavours through the asynchronous fallback and removes the table through the *Delete
 *    table* transform - an empty paragraph takes its place (C24) -, one undo step;
 *  - Edit → Copy of a selected table stays available while a script holds the run lock.
 */

/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { act } from '@testing-library/react';
import { NodeSelection } from 'prosemirror-state';

import { MFBE_CLIPBOARD_WEB_MIME } from '@/editor/plugins/clipboard';
import { findNodeById } from '@/editor/schema';
import type { BinaryMeta, Document } from '@/model/document';
import { actions } from '@/model/store';

import {
  caretIn,
  modelTable,
  posOf,
  removeHarnessHosts,
  select,
  tableDocument,
  tablesHarness,
  type TablesHarness,
} from './tablesHarness';
import { fakeRunLock } from './testUtils';

const CLIPBOARD_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../tests/fixtures/clipboard',
);

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const META: BinaryMeta = {
  id: 'tiny.png',
  contentType: 'image/png',
  size: 8,
  width: 8,
  height: 6,
  decodable: true,
  willConvert: false,
  referenceCount: 0,
};

/** What the mocked asynchronous clipboard gives to `read` and received from `write`. */
interface FakeClipboard {
  written: Record<string, Blob>[];
  setItems(items: Record<string, Blob>[]): void;
}

/** `navigator.clipboard` with `read` and `write`, and a `ClipboardItem` jsdom lacks. */
function mockClipboard(): FakeClipboard {
  let items: Record<string, Blob>[] = [];
  const written: Record<string, Blob>[] = [];
  class FakeClipboardItem {
    constructor(readonly entries: Record<string, Blob>) {}
    get types(): string[] {
      return Object.keys(this.entries);
    }
    getType(type: string): Promise<Blob> {
      return Promise.resolve(this.entries[type]!);
    }
  }
  vi.stubGlobal('ClipboardItem', FakeClipboardItem);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      read: async () => items.map((entries) => new FakeClipboardItem(entries)),
      write: async (list: FakeClipboardItem[]) => {
        for (const item of list) written.push(item.entries);
      },
    },
  });
  return {
    written,
    setItems(next) {
      items = next;
    },
  };
}

/** `fetch` answering `POST /binary/…` with `META`, its calls recorded. */
function mockFetch(): { url: string; method: string }[] {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET' });
    return new Response(JSON.stringify(META), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return calls;
}

/** The type names of the first section's children. */
function sectionShape(harness: TablesHarness): string[] {
  const out: string[] = [];
  findNodeById(harness.controller.editorState!.doc, 's1')!.node.forEach((child) => {
    out.push(child.type.name === 'p' ? `p:${child.textContent}` : child.type.name);
  });
  return out;
}

/** A book whose first section holds only the 2 × 2 table `t1`, and a second section. */
function onlyTableBook(): Document {
  const base = tableDocument();
  return tableDocument({
    bodies: [
      {
        type: 'body',
        attrs: { nodeId: 'b1' },
        content: [
          { type: 'section', attrs: { nodeId: 's1' }, content: [modelTable('t1', 2, 2)] },
          {
            type: 'section',
            attrs: { nodeId: 's2' },
            content: [
              { type: 'p', attrs: { nodeId: 'p9' }, content: [{ type: 'text', text: 'Next' }] },
            ],
          },
        ],
      },
    ] as Document['bodies'],
    description: base.description,
  });
}

let originalExecCommand: typeof document.execCommand | undefined;

beforeEach(() => {
  originalExecCommand = document.execCommand;
});

afterEach(() => {
  removeHarnessHosts();
  vi.unstubAllGlobals();
  document.execCommand = originalExecCommand!;
  delete (navigator as unknown as Record<string, unknown>).clipboard;
});

describe('Edit → Paste: an HTML table with text wins over a picture beside it (R5.9; data-model §8.9)', () => {
  it('puts the table at the caret’s FR-004 point and adds no binary; a lone picture still pastes as a picture', async () => {
    const harness = await tablesHarness();
    const { services, ctx, store } = harness;
    const clipboard = mockClipboard();
    const calls = mockFetch();
    const excel = readFileSync(path.join(CLIPBOARD_DIR, 'excel-win.html'), 'utf8');
    clipboard.setItems([
      {
        'text/html': new Blob([excel], { type: 'text/html' }),
        'text/plain': new Blob(['Region\t\tQ1\tQ2'], { type: 'text/plain' }),
        'image/png': new Blob([PNG], { type: 'image/png' }),
      },
    ]);
    act(() => caretIn(harness, 'p1', 'Before'.length));
    await act(async () => {
      expect(await services.commands.execute('edit.paste', ctx)).toBe(true);
    });
    expect(sectionShape(harness)).toEqual(['p:Before', 'table', 'table', 'p:After']);
    const pasted = findNodeById(harness.controller.editorState!.doc, 's1')!.node.child(1);
    expect(pasted.childCount).toBe(3);
    expect(pasted.textContent).toContain('Region');
    expect(calls).toEqual([]);
    expect(store.getState().document!.binaries).toEqual([]);

    // A lone picture: uploaded and inserted at the caret, as today.
    clipboard.setItems([{ 'image/png': new Blob([PNG], { type: 'image/png' }) }]);
    act(() => caretIn(harness, 'p2', 'After'.length));
    await act(async () => {
      await services.commands.execute('edit.paste', ctx);
    });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toContain('/binary/');
    await vi.waitFor(() =>
      expect(store.getState().document!.binaries.map((binary) => binary.id)).toEqual(['tiny.png']),
    );
  });
});

describe('Edit → Cut and Edit → Copy of a selected table (C24; data-model §8.8)', () => {
  it('Cut of a section’s only table, the synchronous cut failing: the three flavours through the asynchronous fallback, the table removed through the Delete table transform, an empty paragraph in its place, one undo step', async () => {
    const harness = await tablesHarness(onlyTableBook());
    const { services, ctx, controller } = harness;
    const clipboard = mockClipboard();
    document.execCommand = vi.fn(() => false);
    act(() =>
      select(harness, NodeSelection.create(controller.editorState!.doc, posOf(harness, 't1'))),
    );
    expect(services.commands.isEnabled('edit.cut', ctx)).toBe(true);
    const entries = services.undo.entries().length;
    await act(async () => {
      await services.commands.execute('edit.cut', ctx);
    });
    expect(clipboard.written).toHaveLength(1);
    const written = clipboard.written[0]!;
    expect(Object.keys(written).sort()).toEqual(
      [MFBE_CLIPBOARD_WEB_MIME, 'text/html', 'text/plain'].sort(),
    );
    expect(await written['text/plain']!.text()).toBe('r0c0\tr0c1\nr1c0\tr1c1');
    const html = await written['text/html']!.text();
    expect(html).toMatch(/<table border="1" style="border-collapse: ?collapse;?" class="fb-table"/);
    expect(html).not.toContain('data-node-id');
    const json = JSON.parse(await written[MFBE_CLIPBOARD_WEB_MIME]!.text()) as {
      format: string;
      version: number;
    };
    expect(json).toMatchObject({ format: 'mfbe-fb2', version: 1 });
    // The table went; an empty paragraph took its place, with the caret in it.
    const section = findNodeById(controller.editorState!.doc, 's1')!.node;
    expect(section.childCount).toBe(1);
    expect(section.child(0).type.name).toBe('p');
    expect(section.child(0).content.size).toBe(0);
    expect(controller.editorState!.selection.$head.parent).toBe(section.child(0));
    expect(services.undo.entries().length).toBe(entries + 1);
  });

  it('Copy of a selected table stays available while a script holds the run lock; Cut does not', async () => {
    const harness = await tablesHarness();
    const { services, ctx, controller, store } = harness;
    act(() =>
      select(harness, NodeSelection.create(controller.editorState!.doc, posOf(harness, 't1'))),
    );
    expect(services.commands.isEnabled('edit.copy', ctx)).toBe(true);
    actions.setRunLock(store, fakeRunLock('script'));
    expect(services.commands.isEnabled('edit.copy', ctx)).toBe(true);
    expect(services.commands.isEnabled('edit.cut', ctx)).toBe(false);
  });
});
