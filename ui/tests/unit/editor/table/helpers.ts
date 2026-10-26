/**
 * Builders for the table engine's unit tests (feature 006): tables of ProseMirror nodes whose
 * cells carry the node ids `<prefix>-<row>-<cell>` and the texts `r<row>c<cell>`, raw children
 * of invalid books, a document around them, and node-id generators.
 */

import type { Node as PMNode } from 'prosemirror-model';

import { fb2Schema, findNodeById } from '@/editor/schema';

export const N = fb2Schema.nodes;

export interface CellSpec {
  kind?: 'td' | 'th';
  text?: string;
  colspan?: unknown;
  rowspan?: unknown;
  id?: string;
  style?: string;
  lang?: string;
  align?: string;
  valign?: string;
  extraAttrs?: Record<string, unknown>;
}

/** A row: its cells, or `{align, cells}`; `'raw'` for a raw-xml child (of the table or a row). */
export type RowSpec =
  (CellSpec | 'raw')[] | { align?: string; cells: (CellSpec | 'raw')[] } | 'raw';

export function raw(nodeId: string): PMNode {
  return N.raw_xml!.create({ nodeId, xml: '<x/>' });
}

export function cellNode(nodeId: string, spec: CellSpec, text: string): PMNode {
  return N[spec.kind ?? 'td']!.create(
    {
      nodeId,
      colspan: spec.colspan ?? null,
      rowspan: spec.rowspan ?? null,
      id: spec.id ?? null,
      style: spec.style ?? null,
      lang: spec.lang ?? null,
      align: spec.align ?? null,
      valign: spec.valign ?? null,
      extraAttrs: spec.extraAttrs ?? null,
    },
    text === '' ? undefined : fb2Schema.text(text),
  );
}

/** A table (built unchecked, as `nodeFromModel` keeps an invalid one). */
export function table(
  prefix: string,
  rows: RowSpec[],
  attrs: Record<string, unknown> = {},
): PMNode {
  return N.table!.create(
    { nodeId: prefix, ...attrs },
    rows.map((spec, r) => {
      if (spec === 'raw') return raw(`${prefix}-x${r}`);
      const cells = Array.isArray(spec) ? spec : spec.cells;
      const align = Array.isArray(spec) ? null : (spec.align ?? null);
      return N.tr!.create(
        { nodeId: `${prefix}-r${r}`, align },
        cells.map((cell, c) =>
          cell === 'raw'
            ? raw(`${prefix}-x${r}-${c}`)
            : cellNode(`${prefix}-${r}-${c}`, cell, cell.text ?? `r${r}c${c}`),
        ),
      );
    }),
  );
}

/** `rows` × `columns` plain cells. */
export function plainRows(rows: number, columns: number): RowSpec[] {
  return Array.from({ length: rows }, () => Array.from({ length: columns }, () => ({})));
}

export function p(text: string, nodeId: string): PMNode {
  return N.p!.create({ nodeId }, text ? fb2Schema.text(text) : undefined);
}

export function docOf(...blocks: PMNode[]): PMNode {
  return N.doc!.create(
    null,
    N.body!.create({ nodeId: 'b' }, N.section!.create({ nodeId: 's' }, blocks)),
  );
}

export function pos(doc: PMNode, nodeId: string): number {
  const found = findNodeById(doc, nodeId);
  if (!found) throw new Error(`no node ${nodeId}`);
  return found.pos;
}

export function nodeOf(doc: PMNode, nodeId: string): PMNode {
  return doc.nodeAt(pos(doc, nodeId))!;
}

/** A node-id generator `new1`, `new2`, … */
export function idGenerator(prefix = 'new'): () => string {
  let next = 0;
  return () => `${prefix}${(next += 1)}`;
}

/** The children of a node. */
export function childrenOf(node: PMNode): PMNode[] {
  const out: PMNode[] = [];
  node.forEach((child) => {
    out.push(child);
  });
  return out;
}

/** `row` with its child `index` replaced (or removed when `cell` is null). */
export function withChild(row: PMNode, index: number, cell: PMNode | null): PMNode {
  const children = childrenOf(row);
  if (cell) children[index] = cell;
  else children.splice(index, 1);
  return row.type.create(row.attrs, children, row.marks);
}

/** A cell with new text, the same node id and attributes. */
export function retyped(cell: PMNode, text: string): PMNode {
  return cell.type.create(cell.attrs, text ? fb2Schema.text(text) : undefined, cell.marks);
}
