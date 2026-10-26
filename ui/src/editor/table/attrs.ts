/**
 * The attribute plans and the id and language checks (feature 006, US7; I13; C8, C19, C67;
 * FR-020 to FR-022, FR-035, FR-046, FR-047; data-model §1.5, §1.8, §2.5, §4.4, §4.7, §10.2;
 * document-model.md §1.4; research R1.1, R2.8). The Table bar, the fuzz and the assistant run
 * them through `planCommand` like every other plan:
 *
 * - `planCellAttrs` sets `align`, `valign`, `style` and `lang` on every cell of a block, on the
 *   owners of the assistant's whole lines (each cell once, never extended; C67) or on the caret's
 *   cell, and `id` on the head cell only (FR-021; C14);
 * - `planRowAlign` sets `align` on every row of a block, of the assistant's rows or the caret
 *   cell's row;
 * - `planTableAttrs` sets the table's `id` and `style`;
 * - `planSpan` (US8; FR-036) sets the head cell's colspan or rowspan as *Merge cells* and *Split
 *   cell* would: a larger value merges the cells of the extended rectangle into it, a smaller one
 *   splits off the freed positions, a span past the table's edge or a growth that a merged cell
 *   above or to the left reaches is refused.
 *
 * Values are trimmed and an empty value removes the attribute. An id must be an NCName that no
 * other element of the book uses (`isNcName`; the book's ids arrive in `PlanContext.bookIds`,
 * C8), a language a language tag (`isLanguageTag`): a refusal changes nothing. A changed cell or
 * row keeps its node id and its content fragment, every other node stays the same object, and a
 * value equal to the current one in every target changes nothing, which `commitTableEdit`
 * answers with null - no step, no undo entry (data-model §4.7). The caret's and the head cell
 * are found through `cellAtTopLeft`, never through the owner map, so the plans work on a table
 * too large for it there, while lines or a block refuse with `too-large` (data-model §2.5); the
 * table's own attributes read no position at all. By the engine rule this module imports only
 * `ui/src/model/` and `ui/src/editor/`.
 */

import { Fragment, type Attrs, type Node as PMNode } from 'prosemirror-model';

import { ALIGN_VALUES, VALIGN_VALUES } from '../commands/table';

import {
  gridCellNode,
  withSpans,
  type PlanContext,
  type Refusal,
  type TableAddress,
  type TableEdit,
} from './edit';
import { caretAt, cellAtTopLeft, keptFocus, lineOwners, linesOf, planMerge, splitOff } from './ops';

/* ------------------------------------------------------------------------ */
/* The checks (I13; data-model §10.2)                                       */
/* ------------------------------------------------------------------------ */

/**
 * An NCName of XML 1.0 Fifth Edition: productions [4] (NameStartChar), [4a] (NameChar) and [5]
 * (Name) without `:` - no spaces, not starting with a digit, a hyphen or a full stop (FR-022).
 * These are the classes the core's validator, libxml2, applies to `xs:ID` (U16;
 * `tests/fixtures/tables/ncnames.json` holds the names that show them).
 */
const NC_NAME =
  /^[A-Z_a-z\u{C0}-\u{D6}\u{D8}-\u{F6}\u{F8}-\u{2FF}\u{370}-\u{37D}\u{37F}-\u{1FFF}\u{200C}-\u{200D}\u{2070}-\u{218F}\u{2C00}-\u{2FEF}\u{3001}-\u{D7FF}\u{F900}-\u{FDCF}\u{FDF0}-\u{FFFD}\u{10000}-\u{EFFFF}][-.0-9A-Z_a-z\u{B7}\u{C0}-\u{D6}\u{D8}-\u{F6}\u{F8}-\u{37D}\u{37F}-\u{1FFF}\u{200C}-\u{200D}\u{203F}-\u{2040}\u{2070}-\u{218F}\u{2C00}-\u{2FEF}\u{3001}-\u{D7FF}\u{F900}-\u{FDCF}\u{FDF0}-\u{FFFD}\u{10000}-\u{EFFFF}]*$/u;

/** The `xs:language` pattern (`resources/schema/FictionBookLang.xsd:4`). */
const LANGUAGE_TAG = /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/;

/** True for a valid FB2 identifier: an XML NCName (FR-022). */
export function isNcName(s: string): boolean {
  return NC_NAME.test(s);
}

/** True for a language tag as `xml:lang` takes it (FR-020); `''` is no tag (it removes). */
export function isLanguageTag(s: string): boolean {
  return LANGUAGE_TAG.test(s);
}

/* ------------------------------------------------------------------------ */
/* The language setter (C19; data-model §1.5)                               */
/* ------------------------------------------------------------------------ */

/** The key under which release 0.0.5 kept a cell's `xml:lang` among its unknown attributes. */
export const XML_LANG_KEY = '{http://www.w3.org/XML/1998/namespace}lang';

/**
 * Attributes with the cell language written the one way a plan may write it, the twin of
 * `withSpans`: on a copy, `lang` set (`null` or `''` removes it), then - whatever the new value -
 * `extraAttrs.unknownAttrs[XML_LANG_KEY]` deleted, then an emptied `unknownAttrs`, then an
 * emptied `extraAttrs`. `attrsToModel` returns `extraAttrs.unknownAttrs` whole, so the old text
 * would otherwise come back, or be written beside the new value. The input is never changed.
 */
export function withLang(attrs: Attrs, lang: string | null): Attrs {
  const out: Record<string, unknown> = {
    ...attrs,
    lang: lang === null || lang === '' ? null : lang,
  };
  const extra = attrs.extraAttrs as Record<string, unknown> | null | undefined;
  const unknown = extra?.unknownAttrs as Record<string, unknown> | null | undefined;
  if (extra && unknown && typeof unknown === 'object' && XML_LANG_KEY in unknown) {
    const nextUnknown = { ...unknown };
    delete nextUnknown[XML_LANG_KEY];
    const nextExtra: Record<string, unknown> = { ...extra };
    if (Object.keys(nextUnknown).length > 0) nextExtra.unknownAttrs = nextUnknown;
    else delete nextExtra.unknownAttrs;
    out.extraAttrs = Object.keys(nextExtra).length > 0 ? nextExtra : null;
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Targets (C14, C67; data-model §2.5, §4.1)                                */
/* ------------------------------------------------------------------------ */

const TOO_LARGE: Refusal = { refused: 'too-large' };

/** Lines or a block on a table too large for the owner map: those read positions (§2.5). */
function readsPositions(address: TableAddress): boolean {
  return (!!address.lines || !!address.rect) && address.grid.tooLarge;
}

/**
 * The cells the block-wide values reach, as indices in `grid.cells`: the owners of the
 * assistant's whole `lines`, each once and never extended (`lineOwners`; C67), else the cells
 * of the block's rectangle (`cellsIn`; extended already), else the caret's cell
 * (`cellAtTopLeft`); `too-large` for lines or a block on a table too large for the owner map.
 * The Table bar shows the value these cells share.
 */
export function cellTargets(address: TableAddress): number[] | Refusal {
  const { table, grid } = address;
  if (readsPositions(address)) return TOO_LARGE;
  if (address.lines) {
    const lines = linesOf(address, address.lines.axis);
    return lines ? lineOwners(grid, address.lines.axis, lines[0], lines[1]) : [];
  }
  if (address.rect) return grid.cellsIn(address.rect);
  const found = address.caret ? cellAtTopLeft(grid, table, address.caret) : null;
  return found ? [found.index] : [];
}

/**
 * The head cell (FR-021; C14): the cell at `address.head` - the cell that holds `$head` -, else
 * the caret's cell, found without the owner map; null without one.
 */
export function headCell(address: TableAddress): { index: number; node: PMNode } | null {
  const at = address.head ?? address.caret;
  return at ? cellAtTopLeft(address.grid, address.table, at) : null;
}

/**
 * The rows `planRowAlign` reaches, as grid rows: the rows `[top, bottom)` of the block, the
 * assistant's rows (lines of axis `row`; column lines address none), else the caret cell's row;
 * only rows that hold a cell - a row without one (invalid books only) stays as read (FR-035).
 * `too-large` for lines or a block on a table too large for the owner map.
 */
export function rowTargets(address: TableAddress): number[] | Refusal {
  const { grid } = address;
  if (readsPositions(address)) return TOO_LARGE;
  let from: number;
  let to: number;
  if (address.lines) {
    const lines = linesOf(address, 'row');
    if (!lines) return [];
    [from, to] = lines;
  } else if (address.rect) {
    from = address.rect.top;
    to = address.rect.bottom;
  } else {
    const row = address.caret?.row;
    if (row === undefined || !Number.isInteger(row) || row < 0 || row >= grid.height) return [];
    from = row;
    to = row + 1;
  }
  const rows: number[] = [];
  for (let r = Math.max(0, from); r < to && r < grid.height; r += 1) {
    if (grid.rowStart[r]! < grid.rowStart[r + 1]!) rows.push(r);
  }
  return rows;
}

/* ------------------------------------------------------------------------ */
/* Values                                                                   */
/* ------------------------------------------------------------------------ */

/** A text value: absent stays absent, `null` and a blank text remove, others are trimmed. */
function textValue(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * An `align` or `valign` value from its enumeration (the Table bar's lists); anything else is a
 * caller's error - the assistant's handler checks its arguments (US11).
 */
function enumValue(
  value: string | null | undefined,
  values: readonly string[],
  name: string,
): string | null | undefined {
  const text = textValue(value);
  if (text && !values.includes(text)) {
    throw new RangeError(`${name}: ${JSON.stringify(value)} is not one of ${values.join(', ')}`);
  }
  return text;
}

/** The FB2 ids no attribute may take: the book's and those of the table's own nodes. */
function takenIds(table: PMNode, ctx: PlanContext): Set<string> {
  const ids = new Set<string>(ctx.bookIds ?? []);
  const add = (node: PMNode) => {
    const id = node.attrs.id;
    if (typeof id === 'string' && id !== '') ids.add(id);
  };
  add(table);
  table.descendants((node) => {
    if (!node.isText) add(node);
    return true;
  });
  return ids;
}

/**
 * The refusal of an id that is no NCName, or that another element than the target - whose own
 * id is `own` - uses; null for an acceptable id (C8).
 */
function idRefusal(
  id: string | null | undefined,
  own: unknown,
  table: PMNode,
  ctx: PlanContext,
): Refusal | null {
  if (!id) return null;
  if (!isNcName(id)) return { refused: 'invalid-id' };
  if (id !== own && takenIds(table, ctx).has(id)) {
    return { refused: 'duplicate-id', params: { id } };
  }
  return null;
}

interface CellValues {
  align?: string | null;
  valign?: string | null;
  style?: string | null;
  lang?: string | null;
  id?: string | null;
}

/** `attrs` with the given values, the language through `withLang`; null when nothing changes. */
function cellAttrsWith(attrs: Attrs, values: CellValues): Attrs | null {
  let next: Attrs = attrs;
  const set = (name: 'align' | 'valign' | 'style' | 'id', value: string | null | undefined) => {
    if (value !== undefined && (next[name] ?? null) !== value) next = { ...next, [name]: value };
  };
  set('align', values.align);
  set('valign', values.valign);
  set('style', values.style);
  set('id', values.id);
  if (values.lang !== undefined) {
    const lang = withLang(next, values.lang);
    if ((next.lang ?? null) !== lang.lang || lang.extraAttrs !== next.extraAttrs) next = lang;
  }
  return next === attrs ? null : next;
}

/** The table's child list with the cells of `changed` (grid index → new node) in place. */
function withCells(table: PMNode, address: TableAddress, changed: Map<number, PMNode>): PMNode[] {
  const { grid } = address;
  const byRow = new Map<number, Map<number, PMNode>>();
  for (const [index, node] of changed) {
    const cell = grid.cells[index]!;
    const rowChild = grid.rowChild[cell.row]!;
    let cells = byRow.get(rowChild);
    if (!cells) {
      cells = new Map();
      byRow.set(rowChild, cells);
    }
    cells.set(cell.index, node);
  }
  const rows: PMNode[] = [];
  table.forEach((row, _offset, index) => {
    const cells = byRow.get(index);
    if (!cells) {
      rows.push(row);
      return;
    }
    const children: PMNode[] = [];
    row.forEach((child, _at, childIndex) => {
      children.push(cells.get(childIndex) ?? child);
    });
    rows.push(row.type.create(row.attrs, Fragment.from(children), row.marks));
  });
  return rows;
}

/* ------------------------------------------------------------------------ */
/* The plans (data-model §4.7)                                              */
/* ------------------------------------------------------------------------ */

/** The values `planCellAttrs` takes: an absent member changes nothing, `''` or `null` removes. */
export interface CellAttrValues {
  /** `left`, `right` or `center`. */
  align?: string | null;
  /** `top`, `middle` or `bottom`. */
  valign?: string | null;
  style?: string | null;
  /** A language tag. */
  lang?: string | null;
  /** The head cell's id: an NCName no other element of the book uses. */
  id?: string | null;
}

/**
 * *Cell align*, *Cell valign*, *Cell style*, *Cell language* and *Cell ID* (data-model §4.7;
 * FR-020 to FR-022): `align`, `valign`, `style` and `lang` on every target cell (`cellTargets`:
 * the owners of the assistant's lines, the block's cells or the caret's cell), `id` on the head
 * cell only (`headCell`). `too-large` first, for lines or a block on a table too large for the
 * owner map; then `invalid-lang` for a language that is no language tag, `invalid-id` for an id
 * that is no NCName and `duplicate-id` for an id another element of the book (`ctx.bookIds`) or
 * of the table uses - the head cell's own id excepted (C8). A changed cell is the same node type
 * over the new attributes with its content fragment and marks (`nodeId` kept, so a caret keeps
 * its offset; data-model §4.3), the language written through `withLang`; its row is copied, every
 * other row and cell stays the same object. A new id is the edit's `allowedIds`. Focus kept: the
 * block or the caret.
 */
export function planCellAttrs(
  address: TableAddress,
  values: CellAttrValues,
  ctx: PlanContext,
): TableEdit | Refusal {
  const { table, grid } = address;
  if (readsPositions(address)) return TOO_LARGE;
  const wide: CellValues = {
    align: enumValue(values.align, ALIGN_VALUES, 'align'),
    valign: enumValue(values.valign, VALIGN_VALUES, 'valign'),
    style: textValue(values.style),
    lang: textValue(values.lang),
  };
  const id = textValue(values.id);
  if (wide.lang && !isLanguageTag(wide.lang)) {
    return { refused: 'invalid-lang', params: { value: wide.lang } };
  }
  const head = id !== undefined ? headCell(address) : null;
  const refusal = idRefusal(id, head?.node.attrs.id, table, ctx);
  if (refusal) return refusal;
  const changed = new Map<number, PMNode>();
  const blockWide =
    wide.align !== undefined ||
    wide.valign !== undefined ||
    wide.style !== undefined ||
    wide.lang !== undefined;
  if (blockWide) {
    const targets = cellTargets(address);
    if (!Array.isArray(targets)) return targets;
    for (const index of targets) {
      const node = gridCellNode(table, grid, index);
      const attrs = cellAttrsWith(node.attrs, wide);
      if (attrs) changed.set(index, node.type.create(attrs, node.content, node.marks));
    }
  }
  if (head && id !== undefined) {
    const node = changed.get(head.index) ?? head.node;
    const attrs = cellAttrsWith(node.attrs, { id });
    if (attrs) changed.set(head.index, node.type.create(attrs, node.content, node.marks));
  }
  const edit: TableEdit = {
    rows: withCells(table, address, changed),
    focus: keptFocus(address),
    removedIds: [],
  };
  if (id && head && id !== head.node.attrs.id) edit.allowedIds = [id];
  return edit;
}

/**
 * *Row align* (data-model §4.7; FR-020, FR-021): `align` on every target row (`rowTargets`: the
 * block's rows, the assistant's rows or the caret cell's row); each changed row is the same
 * node type over the new attributes with its content fragment as it is - its cells the same
 * objects -, every other row stays the same object. `too-large` for lines or a block on a table
 * too large for the owner map. Focus kept.
 */
export function planRowAlign(
  address: TableAddress,
  values: { align: string | null },
  ctx: PlanContext,
): TableEdit | Refusal {
  void ctx;
  const { table, grid } = address;
  if (readsPositions(address)) return TOO_LARGE;
  const align = enumValue(values.align, ALIGN_VALUES, 'align');
  const targets = rowTargets(address);
  if (!Array.isArray(targets)) return targets;
  const rows: PMNode[] = [];
  table.forEach((child) => {
    rows.push(child);
  });
  if (align !== undefined) {
    for (const r of targets) {
      const index = grid.rowChild[r]!;
      const row = rows[index]!;
      if ((row.attrs.align ?? null) === align) continue;
      rows[index] = row.type.create({ ...row.attrs, align }, row.content, row.marks);
    }
  }
  return { rows, focus: keptFocus(address), removedIds: [] };
}

/**
 * *Table ID* and *Table Style* (data-model §4.7; FR-020, FR-022): the table's `id` and `style`
 * through `tableAttrs` - present only when they change -, every row the same object. The id is
 * checked as a cell's is, the table's own id excepted; a new id is the edit's `allowedIds`. It
 * reads no position, so it works on any table (data-model §2.5). Focus kept.
 */
export function planTableAttrs(
  address: TableAddress,
  values: { id?: string | null; style?: string | null },
  ctx: PlanContext,
): TableEdit | Refusal {
  const { table } = address;
  const id = textValue(values.id);
  const style = textValue(values.style);
  const refusal = idRefusal(id, table.attrs.id, table, ctx);
  if (refusal) return refusal;
  let attrs: Attrs = table.attrs;
  if (id !== undefined && (attrs.id ?? null) !== id) attrs = { ...attrs, id };
  if (style !== undefined && (attrs.style ?? null) !== style) attrs = { ...attrs, style };
  const rows: PMNode[] = [];
  table.forEach((child) => {
    rows.push(child);
  });
  const edit: TableEdit = { rows, focus: keptFocus(address), removedIds: [] };
  if (attrs !== table.attrs) edit.tableAttrs = attrs;
  if (id && id !== table.attrs.id) edit.allowedIds = [id];
  return edit;
}

/* ------------------------------------------------------------------------ */
/* The span plan (US8; FR-036; data-model §4.7)                             */
/* ------------------------------------------------------------------------ */

/** A span field's axis: the head cell's colspan or rowspan. */
export type SpanAxis = 'colspan' | 'rowspan';

/**
 * *colspan* and *rowspan* of the Table bar, and the assistant's span attributes (data-model §4.7;
 * FR-036, FR-035, FR-046; C13, C17, C19; analyze decisions 3 and 6): on the head cell
 * (`address.head`, else the caret's cell) - `too-large` before anything else, then:
 * 1. `value` must be a whole number of 1 or more (the field refuses anything else itself, an
 *    empty field meaning 1; another value is a caller's error, a `RangeError`);
 * 2. `left + value > W` (colspan) or `row + value > R` (rowspan) refuses with `span-past-edge`
 *    `{axis: 'column' | 'row'}`;
 * 3. a value above the cell's effective span merges as *Merge cells* would over the new
 *    rectangle extended to whole cells (`planMerge`; the other span may grow too, R1.5) - unless
 *    the extension reaches above the cell's top row or left of its first column, where a merged
 *    cell that starts there would own the rectangle: then `merge-needs-block` and nothing
 *    changes; when the extended rectangle holds no other cell, only holes of an irregular table,
 *    the cell takes them (FR-035). The merged cell is always the edited one: its content first,
 *    then the others' in reading order, joined with single spaces (C17), their ids in
 *    `removedIds` for the host's FR-015 question, rows left without a cell compacted;
 * 4. a smaller value splits off the positions the cell no longer keeps (`splitOff`): empty cells
 *    of its kind, `align`, `valign` and `lang`, without `id`, `style` or `extraAttrs`, placed
 *    with the hole fill, positions an earlier cell owns getting nothing;
 * 5. the same value changes nothing (every row the same object).
 * Spans are written through `withSpans`: 1 is never written and a span kept in `unknownAttrs`
 * goes (C19). Focus: a caret in the head cell.
 */
export function planSpan(
  address: TableAddress,
  options: { axis: SpanAxis; value: number },
  ctx: PlanContext,
): TableEdit | Refusal {
  const { table, grid } = address;
  if (grid.tooLarge) return TOO_LARGE;
  const { axis, value } = options;
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${axis}: ${JSON.stringify(value)} is not a whole number of 1 or more`);
  }
  const unchanged = (): PMNode[] => {
    const rows: PMNode[] = [];
    table.forEach((child) => {
      rows.push(child);
    });
    return rows;
  };
  const head = headCell(address);
  if (!head) return { rows: unchanged(), focus: keptFocus(address), removedIds: [] };
  const cell = grid.cells[head.index]!;
  const focus = caretAt(cell.row, cell.left);
  if (axis === 'colspan' ? cell.left + value > grid.width : cell.row + value > grid.height) {
    return { refused: 'span-past-edge', params: { axis: axis === 'colspan' ? 'column' : 'row' } };
  }
  const current = axis === 'colspan' ? cell.colspan : cell.rowspan;
  if (value === current) return { rows: unchanged(), focus, removedIds: [] };
  if (value < current) {
    const keep = axis === 'colspan' ? { colspan: value } : { rowspan: value };
    return { rows: splitOff(unchanged(), grid, head.index, keep, ctx), focus, removedIds: [] };
  }
  const rect =
    axis === 'colspan'
      ? { top: cell.row, left: cell.left, bottom: cell.row + cell.rowsIn, right: cell.left + value }
      : {
          top: cell.row,
          left: cell.left,
          bottom: cell.row + value,
          right: cell.left + cell.colspan,
        };
  const extended = grid.extend(rect);
  if (extended.top < cell.row || extended.left < cell.left) return { refused: 'merge-needs-block' };
  if (grid.cellsIn(extended).length < 2) {
    // Only holes beside the cell (an irregular table): it covers them now (FR-035).
    const attrs =
      axis === 'colspan'
        ? withSpans(head.node.attrs, extended.right - extended.left)
        : withSpans(head.node.attrs, undefined, extended.bottom - extended.top);
    const node = head.node.type.create(attrs, head.node.content, head.node.marks);
    return {
      rows: withCells(table, address, new Map([[head.index, node]])),
      focus,
      removedIds: [],
    };
  }
  return planMerge({ ...address, rect: extended }, ctx);
}
