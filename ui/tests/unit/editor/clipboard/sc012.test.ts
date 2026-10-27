/**
 * SC-012's round trip (feature 006, T141; FR-059, FR-060; SC-012; C43; U32;
 * `contracts/resource-formats.md` §20; data-model §8.5, §8.8): for each clipboard fixture of
 * T018 with its `expected.json` - convert, copy out, convert again:
 *  1. the paste after a section's paragraph - into the empty paragraph that follows it, so the
 *     paste's blocks are exactly what it adds - through the router (`pasteTransaction` with
 *     `{kind: 'foreign', html}`) inserts exactly `blocks` in document order;
 *  2. the copy-out HTML of each resulting table converts back through `parseForeignHtml` to the
 *     same grid;
 *  3. the copy's text of the inserted blocks (`clipboardText`) equals `tsv`.
 */

/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';

import { clipboardText, tableClipboardSerializer } from '@/editor/clipboard/copyOut';
import { parseForeignHtml } from '@/editor/clipboard/foreignHtml';
import { pasteTransaction, type ClipboardOptions } from '@/editor/clipboard/route';
import { isRefusal } from '@/editor/table/edit';
import { effectiveColspan, effectiveRowspan, gridOfNode } from '@/editor/table/grid';
import { regularisePastedTable } from '@/editor/table/ops';
import { createBodyEditorState } from '@/views/body/bodyEditor';

import { docOf, idGenerator, p, pos } from '../table/helpers';

const CLIPBOARD_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../tests/fixtures/clipboard',
);

const FIXTURES = [
  'word-win',
  'writer',
  'calc',
  'excel-win',
  'gdocs',
  'gsheets',
  'firefox-web',
  'irregular-web',
  'mixed',
] as const;

interface ExpectedCell {
  k: 'td' | 'th';
  t: string;
  cs?: number;
  rs?: number;
  al?: string;
  va?: string;
  m?: string[];
}

type ExpectedBlock =
  { p: { text: string; marks?: string[] } } | { table: { rows: ExpectedCell[][] } };

function fixture(name: string): { html: string; blocks: ExpectedBlock[]; tsv: string } {
  const html = readFileSync(path.join(CLIPBOARD_DIR, `${name}.html`), 'utf8');
  const expected = JSON.parse(
    readFileSync(path.join(CLIPBOARD_DIR, `${name}.expected.json`), 'utf8'),
  ) as { blocks: ExpectedBlock[]; tsv: string };
  return { html, ...expected };
}

function marksOf(node: PMNode): string[] {
  const found = new Set<string>();
  node.descendants((child) => {
    for (const mark of child.marks) found.add(mark.type.name);
    return true;
  });
  return [...found].sort();
}

function rowsOf(table: PMNode): ExpectedCell[][] {
  const rows: ExpectedCell[][] = [];
  table.forEach((row) => {
    const cells: ExpectedCell[] = [];
    row.forEach((cell) => {
      const out: ExpectedCell = { k: cell.type.name as 'td' | 'th', t: cell.textContent };
      const colspan = effectiveColspan(cell.attrs.colspan);
      const rowspan = effectiveRowspan(cell.attrs.rowspan);
      if (colspan > 1) out.cs = colspan;
      if (rowspan > 1) out.rs = rowspan;
      if (cell.attrs.align !== null) out.al = cell.attrs.align as string;
      if (cell.attrs.valign !== null) out.va = cell.attrs.valign as string;
      const marks = marksOf(cell);
      if (marks.length > 0) out.m = marks;
      cells.push(out);
    });
    rows.push(cells);
  });
  return rows;
}

function blockOf(node: PMNode): ExpectedBlock {
  if (node.type.name === 'table') return { table: { rows: rowsOf(node) } };
  const marks = marksOf(node);
  return { p: marks.length > 0 ? { text: node.textContent, marks } : { text: node.textContent } };
}

function options(): ClipboardOptions {
  return { bookIds: () => new Set(), nextNodeId: idGenerator('sc'), message: () => {} };
}

/** The editor's own HTML of a table, as the copy writes it. */
function copyOutHtml(table: PMNode): string {
  const wrap = document.createElement('div');
  wrap.appendChild(tableClipboardSerializer.serializeFragment(Fragment.from(table), { document }));
  return wrap.innerHTML;
}

describe('SC-012: convert, copy out, convert again', () => {
  for (const name of FIXTURES) {
    it(`${name}: the paste inserts exactly its blocks; each table’s copy converts back to the same grid; the copy’s text is its tsv`, () => {
      const { html, blocks, tsv } = fixture(name);
      const doc = docOf(p('A paragraph of the section.', 'a1'), p('', 'a2'), p('After.', 'a3'));
      const opts = options();
      let state = createBodyEditorState(doc, { getNbspChar: () => '\u00a0', clipboard: opts });
      state = state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, pos(state.doc, 'a2') + 1)),
      );
      const tr = pasteTransaction(state, { kind: 'foreign', html }, opts);
      expect(tr, name).not.toBeNull();
      const next = state.apply(tr!);
      next.doc.check();
      // The section's children between its first and its last paragraph: the paste's blocks.
      const section = next.doc.child(0).child(0);
      const children: PMNode[] = [];
      section.forEach((child) => children.push(child));
      expect(children[0]!.textContent).toBe('A paragraph of the section.');
      expect(children[children.length - 1]!.textContent).toBe('After.');
      const inserted = children.slice(1, -1);
      expect(inserted.map(blockOf), name).toEqual(blocks);
      for (const node of inserted) {
        if (node.type.name !== 'table') continue;
        expect(gridOfNode(node).regular, name).toBe(true);
        // The copy-out HTML converts back to the same grid.
        const back = parseForeignHtml(copyOutHtml(node));
        const parts = back.parts.filter((part) => part.kind === 'table');
        expect(parts, name).toHaveLength(1);
        const part = parts[0]!;
        if (part.kind !== 'table') throw new Error('not a table part');
        const again = regularisePastedTable(
          part.table,
          { foreign: true, keepRows: false },
          { nextId: idGenerator('again') },
        );
        if (isRefusal(again)) throw new Error(`refused: ${again.refused}`);
        expect(rowsOf(again), name).toEqual(rowsOf(node));
      }
      // The copy's text of the inserted blocks.
      expect(clipboardText(new Slice(Fragment.from(inserted), 0, 0)), name).toBe(tsv);
    });
  }
});
