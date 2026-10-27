/**
 * The warning mark of an irregular table (feature 006, T126; FR-057; US8 sc.7, sc.8, sc.10;
 * C52, C54; I3, I15; data-model §1.4, §3.3, §3.4; research R6.1 to R6.3): a `TableView` made by
 * `createTableNodeViews(options)` draws, exactly while its table is irregular - a too-large one
 * included -, a zero-height `caption.fb-table-mark-host` as the table's first child, outside the
 * content DOM, holding the mark with its name and tooltip from `options.describe`; updates follow
 * the node and the interface language; mutations and events inside the caption are the view's
 * own; a mousedown on the mark keeps the caret and a click asks for the popover. The schema's
 * `toDOM` and the model know nothing of it, so Copy, Save and the Source view never see it.
 */

/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DOMSerializer, Fragment, type Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeViewConstructor } from 'prosemirror-view';

import { nodeFromModel, type ModelNodeJson } from '@/editor/fromModel';
import { createTableNodeViews, TableView, type TableViewOptions } from '@/editor/nodeviews/table';
import { fb2Schema } from '@/editor/schema';
import { gridOfNode, type TableSummary } from '@/editor/table/grid';
import { nodeToModel } from '@/editor/toModel';

const VECTORS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../tests/fixtures/tables',
);

interface VectorCase {
  name: string;
  table: {
    attrs?: Record<string, unknown>;
    rows: ({ type?: string; attrs?: Record<string, unknown> }[] | { type: string })[];
  };
  expect: { regular: boolean };
}

const cases = (
  JSON.parse(readFileSync(path.join(VECTORS, 'grid-vectors.json'), 'utf8')) as {
    cases: VectorCase[];
  }
).cases;

/** A vectors table as a ProseMirror table (node ids `v1`, `v2`, …; the cells hold their ids). */
function vectorTable(table: VectorCase['table']): PMNode {
  let next = 0;
  const nodeId = () => `v${(next += 1)}`;
  const raw = () => ({ type: 'raw-xml', attrs: { nodeId: nodeId(), xml: '<x/>', inline: false } });
  return nodeFromModel({
    type: 'table',
    attrs: { nodeId: nodeId(), ...(table.attrs ?? {}) },
    content: table.rows.map((row) =>
      Array.isArray(row)
        ? {
            type: 'tr',
            attrs: { nodeId: nodeId() },
            content: row.map((cell) => {
              if (cell.type === 'raw-xml') return raw();
              const id = nodeId();
              return {
                type: cell.type ?? 'td',
                attrs: { nodeId: id, ...(cell.attrs ?? {}) },
                content: [{ type: 'text', text: id }],
              };
            }),
          }
        : raw(),
    ),
  } as unknown as ModelNodeJson)!;
}

const N = fb2Schema.nodes;

function td(nodeId: string, attrs: Record<string, unknown> = {}): PMNode {
  return N.td!.create({ nodeId, ...attrs }, fb2Schema.text(nodeId));
}

/** `[a, b] / [c, d]`, or `[a, b] / [c]` with a short second row. */
function small(short: boolean, id: string | null = null): PMNode {
  return N.table!.create({ nodeId: 't', id }, [
    N.tr!.create({ nodeId: 'r0' }, [td('a'), td('b')]),
    N.tr!.create({ nodeId: 'r1' }, short ? [td('c')] : [td('c'), td('d')]),
  ]);
}

/** A stub `describe`: the summary in the texts, in the language of `state.lang`. */
function stub(state: { lang: string }) {
  return vi.fn((summary: TableSummary) => ({
    name: `${state.lang}:name ${summary.rows}x${summary.columns}/${summary.shortRows}/${summary.overlaps}/${summary.pastEnd}${summary.id ? ` ${summary.id}` : ''}`,
    tooltip: `${state.lang}:tooltip ${summary.shortRows}`,
  }));
}

/** The table view of `node` from the factory with `options`. */
function viewOf(node: PMNode, options?: TableViewOptions): TableView {
  const views = createTableNodeViews(options);
  const factory = views.table as NodeViewConstructor;
  return factory(node, {} as EditorView, () => 0, [], undefined as never) as TableView;
}

function captionOf(view: TableView): HTMLElement | null {
  return view.dom.querySelector(':scope > caption');
}

describe('the table mark (TableView with options)', () => {
  it('draws the caption, the mark and the badge on every irregular vector case and on no regular one', () => {
    const state = { lang: 'en' };
    const describe = stub(state);
    let marked = 0;
    for (const one of cases) {
      const node = vectorTable(one.table);
      const view = viewOf(node, { describe });
      const caption = captionOf(view);
      if (one.expect.regular) {
        expect(caption, one.name).toBeNull();
        expect(view.dom.hasAttribute('data-irregular'), one.name).toBe(false);
        continue;
      }
      marked += 1;
      expect(caption, one.name).not.toBeNull();
      // The first child of the table, before the tbody, outside the content DOM.
      expect(view.dom.firstElementChild, one.name).toBe(caption);
      expect(caption!.nextElementSibling, one.name).toBe(view.contentDOM);
      expect(view.contentDOM.contains(caption), one.name).toBe(false);
      expect(caption!.className).toBe('fb-table-mark-host');
      expect(caption!.getAttribute('contenteditable')).toBe('false');
      const mark = caption!.querySelector(':scope > span.fb-table-mark')!;
      expect(mark, one.name).not.toBeNull();
      const texts = describe.mock.results.at(-1)!.value as { name: string; tooltip: string };
      expect(texts.name).toContain(`${gridOfNode(node).summary.rows}x`);
      expect(mark.getAttribute('role')).toBe('img');
      expect(mark.getAttribute('aria-label')).toBe(texts.name);
      expect(mark.getAttribute('title')).toBe(texts.tooltip);
      expect(mark.getAttribute('data-testid')).toBe('body-table-mark');
      const badge = mark.querySelector(':scope > span.mfbe-table-mark-badge')!;
      expect(badge.getAttribute('aria-hidden')).toBe('true');
      expect(badge.textContent).toBe('!');
      expect(view.dom.getAttribute('data-irregular'), one.name).toBe('true');
      expect(describe).toHaveBeenLastCalledWith(gridOfNode(node).summary);
    }
    expect(marked).toBeGreaterThan(10);
  });

  it('marks a too-large irregular table too', () => {
    const cells = Array.from({ length: 4195 }, (_, index) => td(`w${index}`, { colspan: 1000 }));
    const node = N.table!.create({ nodeId: 'big' }, [
      N.tr!.create({ nodeId: 'r0' }, cells),
      N.tr!.create({ nodeId: 'r1' }, [td('x')]),
    ]);
    expect(gridOfNode(node).tooLarge).toBe(true);
    const view = viewOf(node, { describe: stub({ lang: 'en' }) });
    expect(captionOf(view)).not.toBeNull();
    expect(view.dom.getAttribute('data-irregular')).toBe('true');
  });

  it('update: a regular node removes the caption and the attribute, another irregular one renders its texts; the language listener renders them again', () => {
    const state = { lang: 'en' };
    const listeners: (() => void)[] = [];
    const unsubscribe = vi.fn();
    const view = viewOf(small(true), {
      describe: stub(state),
      onLanguageChange: (listener) => {
        listeners.push(listener);
        return unsubscribe;
      },
    });
    const label = () => view.dom.querySelector('.fb-table-mark')?.getAttribute('aria-label');
    expect(label()).toBe('en:name 2x2/1/0/0');
    expect(view.update(small(false))).toBe(true);
    expect(captionOf(view)).toBeNull();
    expect(view.dom.hasAttribute('data-irregular')).toBe(false);
    expect(view.update(small(true, 'named'))).toBe(true);
    expect(label()).toBe('en:name 2x2/1/0/0 named');
    // Another irregular table: its own texts.
    const overlap = N.table!.create({ nodeId: 't' }, [
      N.tr!.create({ nodeId: 'r0' }, [td('a'), td('b', { rowspan: 2 })]),
      N.tr!.create({ nodeId: 'r1' }, [td('c', { colspan: 2 })]),
    ]);
    expect(view.update(overlap)).toBe(true);
    expect(label()).toBe('en:name 2x2/0/1/0');
    // A language change: the texts again, in the new language.
    expect(listeners).toHaveLength(1);
    state.lang = 'ru';
    listeners[0]!();
    expect(label()).toBe('ru:name 2x2/0/1/0');
    expect(view.dom.querySelector('.fb-table-mark')?.getAttribute('title')).toBe('ru:tooltip 0');
    // destroy unsubscribes.
    view.destroy();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('ignores every mutation inside the caption and stops every event inside it; a mousedown on the mark is prevented and a click asks for the popover', () => {
    const activate = vi.fn();
    const view = viewOf(small(true), { describe: stub({ lang: 'en' }), onMarkActivate: activate });
    const caption = captionOf(view)!;
    const mark = caption.querySelector('.fb-table-mark') as HTMLElement;
    const badge = mark.querySelector('.mfbe-table-mark-badge')!;
    const mutation = (type: string, target: Node) =>
      ({ type, target }) as unknown as MutationRecord;
    expect(view.ignoreMutation(mutation('childList', caption))).toBe(true);
    expect(view.ignoreMutation(mutation('attributes', mark))).toBe(true);
    expect(view.ignoreMutation(mutation('characterData', badge.firstChild!))).toBe(true);
    expect(view.ignoreMutation(mutation('childList', view.contentDOM))).toBe(false);
    const inMark = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    mark.dispatchEvent(inMark);
    expect(inMark.defaultPrevented).toBe(true);
    expect(view.stopEvent(inMark)).toBe(true);
    const inCell = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    view.contentDOM.firstElementChild?.dispatchEvent(inCell);
    expect(view.stopEvent(inCell)).toBe(false);
    mark.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(activate).toHaveBeenCalledTimes(1);
    const info = activate.mock.calls[0]![0] as { tableNodeId: string; anchor: DOMRect };
    expect(info.tableNodeId).toBe('t');
    expect(typeof info.anchor.bottom).toBe('number');
  });

  it('without options no mark is drawn; the schema’s DOM and the model hold neither caption nor mark', () => {
    const plain = new TableView(small(true));
    expect(captionOf(plain)).toBeNull();
    expect(viewOf(small(true)).dom.querySelector('caption')).toBeNull();
    const node = small(true, 't2');
    const marked = viewOf(node, { describe: stub({ lang: 'en' }) });
    expect(captionOf(marked)).not.toBeNull();
    const host = document.createElement('div');
    host.appendChild(DOMSerializer.fromSchema(fb2Schema).serializeFragment(Fragment.from(node)));
    expect(host.querySelector('caption')).toBeNull();
    expect(host.querySelector('.fb-table-mark')).toBeNull();
    expect(host.innerHTML).not.toContain('caption');
    const model = JSON.stringify(nodeToModel(node));
    expect(model).not.toContain('caption');
    expect(model).not.toContain('mark');
  });
});
