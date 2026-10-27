/**
 * Copy out (feature 006; FR-060; C43; U32; I1; `contracts/resource-formats.md` §20; data-model
 * §8.8; research R5 items 9 to 11, R5.10, R5.11): what a copied table or block of cells gives
 * other programs besides the editor's own JSON flavour - an HTML table with the same rows,
 * header cells, spans and alignment, and tab-separated text. The clipboard plugin passes these
 * to ProseMirror as its `clipboardSerializer`, `clipboardTextSerializer` and `transformCopied`.
 *
 * - **HTML** (`tableClipboardSerializer`): the schema's serializer with `table`, `tr`, `td` and
 *   `th` written for other programs - the schema's `toDOM` is left as it is -; the root's
 *   `fb-table` class keeps a table copied in one window the editor's own in another (C43).
 * - **`transformCopied`** strips node ids and turns text selected inside one cell into that
 *   cell's inline content, so it is copied as text, not as a one-cell table.
 * - **Text** (`clipboardText`): `''` for a slice without a table, so ProseMirror's default text
 *   stays; otherwise one line per grid row with a field per position.
 * - Pictures in cells travel as the editor's own markup only, without image data (R5.10).
 *
 * The module imports only `ui/src/editor/`; its import from `plugins/clipboard.ts` is used at
 * call time only.
 */

import { DOMSerializer, Slice, type DOMOutputSpec, type Node as PMNode } from 'prosemirror-model';

import { withoutNodeIds } from '../plugins/clipboard';
import { fb2Schema } from '../schema';
import { effectiveColspan, effectiveRowspan, gridOfNode } from '../table/grid';

/** `text-align` and `vertical-align` as CSS, or null. */
function alignCss(align: unknown, valign: unknown): string | null {
  const parts: string[] = [];
  if (typeof align === 'string' && align !== '') parts.push(`text-align:${align}`);
  if (typeof valign === 'string' && valign !== '') parts.push(`vertical-align:${valign}`);
  return parts.length > 0 ? parts.join(';') : null;
}

/** `data-id` and `data-style` from a node's `id` and `style`. */
function idAndStyle(node: PMNode, attrs: Record<string, string>): void {
  if (node.attrs.id) attrs['data-id'] = String(node.attrs.id);
  if (node.attrs.style) attrs['data-style'] = String(node.attrs.style);
}

/** The table: a visible border for word processors and spreadsheets, its class, a `tbody`. */
function tableToDom(node: PMNode): DOMOutputSpec {
  const attrs: Record<string, string> = {
    border: '1',
    style: 'border-collapse:collapse',
    class: 'fb-table',
  };
  idAndStyle(node, attrs);
  return ['table', attrs, ['tbody', 0]];
}

/** A row: its `align` as the attribute and as CSS. */
function rowToDom(node: PMNode): DOMOutputSpec {
  const attrs: Record<string, string> = {};
  const align = node.attrs.align as string | null;
  if (align) {
    attrs.align = align;
    attrs.style = alignCss(align, null)!;
  }
  return ['tr', attrs, 0];
}

/**
 * A cell: its class, the effective spans only above 1 (I1: 1, `null`, 0 and a value kept in
 * `unknownAttrs` are not written, 5000 is written as 1000), `align` and `valign` as attributes
 * and as CSS, `lang`, `data-id` and `data-style` - never a node id.
 */
function cellToDom(tag: 'td' | 'th') {
  return (node: PMNode): DOMOutputSpec => {
    const attrs: Record<string, string> = { class: `fb-${tag}` };
    const colspan = effectiveColspan(node.attrs.colspan);
    const rowspan = effectiveRowspan(node.attrs.rowspan);
    if (colspan > 1) attrs.colspan = String(colspan);
    if (rowspan > 1) attrs.rowspan = String(rowspan);
    const { align, valign, lang } = node.attrs as Record<string, unknown>;
    if (typeof align === 'string' && align !== '') attrs.align = align;
    if (typeof valign === 'string' && valign !== '') attrs.valign = valign;
    const css = alignCss(align, valign);
    if (css) attrs.style = css;
    if (lang !== null && lang !== undefined) attrs.lang = String(lang);
    idAndStyle(node, attrs);
    return [tag, attrs, 0];
  };
}

/** The HTML of a copy (data-model §8.8): the schema's serializer, the table nodes overridden. */
export const tableClipboardSerializer = new DOMSerializer(
  {
    ...DOMSerializer.nodesFromSchema(fb2Schema),
    table: tableToDom,
    tr: rowToDom,
    td: cellToDom('td'),
    th: cellToDom('th'),
  },
  DOMSerializer.marksFromSchema(fb2Schema),
);

/**
 * The copied slice as the clipboard gets it: without node ids, and - when it is text inside one
 * cell, open into `table > tr > td | th` - that cell's inline content, `new Slice(cell.content,
 * 0, 0)`, so it is copied as text, not as a one-cell table. The JSON flavour keeps the
 * selection's own slice (`ui/src/editor/plugins/clipboard.ts`).
 */
export function transformCopied(slice: Slice): Slice {
  const stripped = new Slice(withoutNodeIds(slice.content), slice.openStart, slice.openEnd);
  let { content, openStart, openEnd } = stripped;
  const path: string[] = [];
  while (openStart > 0 && openEnd > 0 && content.childCount === 1) {
    const only = content.firstChild!;
    if (only.isInline || only.isLeaf) break;
    const name = only.type.name;
    if (
      (name === 'td' || name === 'th') &&
      path[path.length - 1] === 'tr' &&
      path[path.length - 2] === 'table'
    ) {
      return new Slice(only.content, 0, 0);
    }
    path.push(name);
    content = only.content;
    openStart -= 1;
    openEnd -= 1;
  }
  return stripped;
}

/** A cell's text as a field: tabs, CR and LF become spaces, inline images give nothing. */
function fieldOf(cell: PMNode): string {
  return cell.textContent.replace(/[\t\r\n]/g, ' ');
}

/**
 * A table as tab-separated text (resource-formats.md §20; U32): one line per grid row of W
 * fields joined by `\t` - a cell's text at its top-left position, an empty field for every other
 * position it covers and for every hole -, the lines joined by `\n` with none after the last.
 * A table too large for the owner map gives its rows' own cells, one line per row.
 */
function tableText(table: PMNode): string {
  const grid = gridOfNode(table);
  const lines: string[] = [];
  for (let r = 0; r < grid.height; r += 1) {
    const row = table.child(grid.rowChild[r]!);
    const own = (index: number) => fieldOf(row.child(grid.cells[index]!.index));
    if (grid.tooLarge) {
      const fields: string[] = [];
      for (let index = grid.rowStart[r]!; index < grid.rowStart[r + 1]!; index += 1) {
        fields.push(own(index));
      }
      lines.push(fields.join('\t'));
      continue;
    }
    const fields = new Array<string>(grid.width).fill('');
    for (let index = grid.rowStart[r]!; index < grid.rowStart[r + 1]!; index += 1) {
      fields[grid.cells[index]!.left] = own(index);
    }
    lines.push(fields.join('\t'));
  }
  return lines.join('\n');
}

/**
 * The plain text of a copy (data-model §8.8): `''` for a slice without a table, so
 * `serializeForClipboard` keeps ProseMirror's default text; otherwise every text block its text
 * and every table its tab-separated text (`tableText`), the blocks joined by `\n\n`, LF on every
 * platform (U32), nothing quoted.
 */
export function clipboardText(slice: Slice): string {
  let hasTable = false;
  slice.content.descendants((node) => {
    if (node.type.name === 'table') hasTable = true;
    return !hasTable;
  });
  if (!hasTable) return '';
  const blocks: string[] = [];
  const visit = (node: PMNode) => {
    if (node.type.name === 'table') blocks.push(tableText(node));
    else if (node.isTextblock) blocks.push(node.textContent);
    else if (!node.isLeaf) node.forEach(visit);
  };
  slice.content.forEach(visit);
  return blocks.join('\n\n');
}
