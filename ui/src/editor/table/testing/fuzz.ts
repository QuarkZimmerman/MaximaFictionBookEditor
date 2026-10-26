/**
 * The seeded fuzz of SC-003 (feature 006, US2 T073; C76; I27; U19; data-model §16.4; quickstart
 * §2, §13; research R1.12, R8.15): random table commands on random tables, each step checked by
 * an oracle - the schema, `assertTableValid`, `availability` against the plan, a regular table
 * staying regular, the positions outside the addressed lines keeping their owners' content
 * (except those *Delete row* gives up where it dissolves an overlap, `deletedRows`), no
 * character lost or invented, Undo and Redo giving back exact documents and, where the host
 * can, the core's validation.
 *
 * Two hosts run it: `createStateHost` over an `EditorState` with history (vitest,
 * `tests/unit/editor/table/fuzz.test.ts`) and `createTargetHost` over a table edit target - the
 * Body editor, with the undo coordinator and the core's `doc.validate` - which the page hook
 * `__mfbeTest.tables.fuzz` loads with a dynamic import while the test hooks are on (C76). By
 * the engine rule this module imports only the model and the editor; nothing imports it
 * statically.
 *
 * The mix (`FUZZ_MIX`) is R8.15's weights for US2's commands, the Tab row, Undo and Redo; later
 * stories append their entries.
 */

import type { Node as PMNode, Schema } from 'prosemirror-model';
import {
  TextSelection,
  type Command,
  type EditorState,
  type Selection,
  type Transaction,
} from 'prosemirror-state';
import { closeHistory, redo, undo, undoDepth } from 'prosemirror-history';

import { DISCRETE_STEP } from '../../commands/util';
import { nodeToModel } from '../../toModel';
import {
  availability,
  isAvailable,
  planCommand,
  type Availability,
  type TableCommandName,
  type TablePlan,
} from '../commands';
import {
  assertTableValid,
  commitTableEdit,
  gridCellNode,
  isRefusal,
  tableTarget,
  type TableAddress,
  type TableEdit,
  type Refusal,
} from '../edit';
import { gridOfNode } from '../grid';
import {
  insertionLine,
  moveBands,
  planDeleteColumns,
  planDeleteRows,
  planDuplicateColumns,
  planDuplicateRows,
  planInsertColumns,
  planInsertRows,
  planMoveColumns,
  planMoveRows,
  planTabRow,
  unitLines,
} from '../ops';
import { CellBlockSelection, gridCellPos } from '../selection';

/** The seeds of the vitest run (`MFBE_FUZZ_SEED` overrides them). */
export const FUZZ_SEEDS: readonly number[] = [6, 1006, 2006, 3006, 4006];

/** The commands after which a new start table comes, and the largest table kept. */
const TABLE_LIFETIME = 40;
const MAX_SIZE = 12;

/* ------------------------------------------------------------------------ */
/* Random numbers and start tables                                          */
/* ------------------------------------------------------------------------ */

/** The mulberry32 generator: numbers in [0, 1), the same sequence for the same seed. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A whole number in [0, n). */
function below(rng: () => number, n: number): number {
  return Math.min(n - 1, Math.floor(rng() * n));
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[below(rng, items.length)]!;
}

interface LayoutCell {
  row: number;
  left: number;
  colspan: number;
  rowspan: number;
  /** A span the commands count as 1 (spec Edge Cases, FR-047), written as it is. */
  odd?: { colspan?: number; rowspan?: number; unknownColspan?: string };
}

/** A regular layout of `rows` × `columns`: some merged rectangles, 1 × 1 cells elsewhere. */
function regularLayout(rng: () => number, rows: number, columns: number): LayoutCell[] {
  // The top row of the merge that covers a position, −1 for a free one.
  const top = new Int16Array(rows * columns).fill(-1);
  const merges: LayoutCell[] = [];
  const attempts = below(rng, 2 + Math.floor((rows * columns) / 8));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const height = 1 + below(rng, Math.min(3, rows));
    const width = 1 + below(rng, Math.min(3, columns));
    if (height * width === 1) continue;
    const r0 = below(rng, rows - height + 1);
    const c0 = below(rng, columns - width + 1);
    let free = true;
    for (let r = r0; r < r0 + height && free; r += 1) {
      for (let c = c0; c < c0 + width; c += 1) if (top[r * columns + c]! >= 0) free = false;
    }
    if (!free) continue;
    for (let r = r0; r < r0 + height; r += 1) {
      for (let c = c0; c < c0 + width; c += 1) top[r * columns + c] = r0;
    }
    // Every row the merge reaches into keeps an own cell (a row without cells is invalid).
    let keeps = true;
    for (let r = r0 + 1; r < r0 + height && keeps; r += 1) {
      keeps = false;
      for (let c = 0; c < columns; c += 1) {
        const t = top[r * columns + c]!;
        if (t < 0 || t === r) {
          keeps = true;
          break;
        }
      }
    }
    if (!keeps) {
      for (let r = r0; r < r0 + height; r += 1) {
        for (let c = c0; c < c0 + width; c += 1) top[r * columns + c] = -1;
      }
      continue;
    }
    merges.push({ row: r0, left: c0, colspan: width, rowspan: height });
  }
  const cells = [...merges];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      if (top[r * columns + c]! < 0) cells.push({ row: r, left: c, colspan: 1, rowspan: 1 });
    }
  }
  return cells.sort((a, b) => a.row - b.row || a.left - b.left);
}

/** The last row short by one or two positions, as the corpus census shows it. */
function shortenLastRow(rng: () => number, cells: LayoutCell[], rows: number): void {
  if (rows < 2) return;
  const width = 1 + below(rng, 2);
  let removed = 0;
  for (;;) {
    const own = cells.filter((cell) => cell.row === rows - 1);
    const last = own.at(-1);
    if (!last || own.length < 2 || last.colspan > width - removed) return;
    cells.splice(cells.indexOf(last), 1);
    removed += last.colspan;
    if (removed >= width) return;
  }
}

/** A synthetic overlap: a cell's colspan running into a rowspan from above. */
function addOverlap(rng: () => number, cells: LayoutCell[]): boolean {
  const pairs: [LayoutCell, LayoutCell][] = [];
  for (const tall of cells) {
    if (tall.rowspan < 2) continue;
    for (const cell of cells) {
      if (cell.row > tall.row && cell.row < tall.row + tall.rowspan) {
        if (cell.left + cell.colspan === tall.left) pairs.push([tall, cell]);
      }
    }
  }
  if (pairs.length === 0) return false;
  pick(rng, pairs)[1].colspan += 1;
  return true;
}

/** A synthetic rowspan past the last row. */
function addPastEnd(rng: () => number, cells: LayoutCell[], rows: number): void {
  const bottom = cells.filter((cell) => cell.row + cell.rowspan === rows);
  if (bottom.length > 0) pick(rng, bottom).rowspan += 1 + below(rng, 2);
}

/** Now and then a span the commands count as 1: `0`, `-1` or, unless `valid`, `"abc"`. */
function addOddSpan(rng: () => number, cells: LayoutCell[], valid: boolean): void {
  const single = cells.filter((cell) => cell.colspan === 1 && cell.rowspan === 1);
  if (single.length === 0) return;
  const cell = pick(rng, single);
  const kinds = valid ? 4 : 5;
  switch (below(rng, kinds)) {
    case 0:
      cell.odd = { colspan: 0 };
      break;
    case 1:
      cell.odd = { colspan: -1 };
      break;
    case 2:
      cell.odd = { rowspan: 0 };
      break;
    case 3:
      cell.odd = { rowspan: -1 };
      break;
    default:
      cell.odd = { unknownColspan: 'abc' };
  }
}

export interface StartTableOptions {
  /** Leave out the span `"abc"`, which the FB2 schema rejects (the page run validates). */
  valid?: boolean;
}

/**
 * A start table: 1 to 12 rows and columns; regular, with and without merged cells, or irregular
 * as the census shows it (the last row short by one or two positions) or synthetically (an
 * overlap, a rowspan past the last row); every cell holding a short unique text (some in
 * `strong`); unique `id`s, valid `align`, `valign` and `xml:lang` on some cells and `align` on
 * some rows; now and then a span counted as 1. Node ids from `nextId`.
 */
export function makeStartTable(
  rng: () => number,
  schema: Schema,
  nextId: () => string,
  { valid = false }: StartTableOptions = {},
): PMNode {
  const rows = 1 + below(rng, MAX_SIZE);
  const columns = 1 + below(rng, MAX_SIZE);
  const cells = regularLayout(rng, rows, columns);
  const shape = rng();
  if (shape < 0.2) shortenLastRow(rng, cells, rows);
  else if (shape < 0.325) {
    if (!addOverlap(rng, cells)) addPastEnd(rng, cells, rows);
  } else if (shape < 0.45) addPastEnd(rng, cells, rows);
  if (rng() < 0.3) addOddSpan(rng, cells, valid);
  const headerRow = rng() < 0.3;
  const headerColumn = rng() < 0.15;
  const { table, tr, td, th } = schema.nodes;
  const strong = schema.marks.strong!;
  const out: PMNode[] = [];
  for (let r = 0; r < rows; r += 1) {
    const own = cells
      .filter((cell) => cell.row === r)
      .map((cell) => {
        const nodeId = nextId();
        const header = (headerRow && r === 0) || (headerColumn && cell.left === 0);
        const text = `w${nodeId}`;
        return (header ? th! : td!).create(
          {
            nodeId,
            colspan: cell.odd?.colspan ?? (cell.colspan >= 2 ? cell.colspan : null),
            rowspan: cell.odd?.rowspan ?? (cell.rowspan >= 2 ? cell.rowspan : null),
            align: rng() < 0.15 ? pick(rng, ['left', 'right', 'center']) : null,
            valign: rng() < 0.1 ? pick(rng, ['top', 'middle', 'bottom']) : null,
            lang: rng() < 0.1 ? pick(rng, ['en', 'de', 'fr', 'ru']) : null,
            id: rng() < 0.1 ? `x${nodeId.replace(/[^A-Za-z0-9_.-]/g, '_')}` : null,
            extraAttrs: cell.odd?.unknownColspan
              ? { unknownAttrs: { colspan: cell.odd.unknownColspan } }
              : null,
          },
          schema.text(text, rng() < 0.2 ? [strong.create()] : undefined),
        );
      });
    out.push(
      tr!.create(
        { nodeId: nextId(), align: rng() < 0.2 ? pick(rng, ['left', 'right', 'center']) : null },
        own,
      ),
    );
  }
  return table!.create({ nodeId: nextId() }, out);
}

/* ------------------------------------------------------------------------ */
/* The mix                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * What a step addresses, for the locality check: rows map by their `tr`'s `nodeId`; columns by
 * `column`, the columns of `skipColumns` (`[from, to)`, the lines a column command acts on) and
 * the positions of `given` (those *Delete row* gives up, `deletedRows`) not compared.
 */
export interface FuzzLines {
  skipColumns?: readonly [number, number];
  /** A position (row, column) of the grid before that the step gives up. */
  given?(row: number, col: number): boolean;
  column(c: number): number;
}

export interface FuzzEntry {
  /** The command's name: a table command's, or `tabRow`, `undo`, `redo`. */
  name: string;
  /** The table command whose `availability` must agree with the plan. */
  command?: TableCommandName;
  weight: number;
  /** The plan the step runs through `planCommand`. */
  plan?: TablePlan;
  /** Where the caret goes: a random cell or block, or the table's last cell (the Tab row). */
  caret?: 'last';
  /** The lines the step addresses and its column map; null when it addresses none. */
  lines?(address: TableAddress): FuzzLines | null;
  /** The step removes cells (their text leaves with them). */
  removes?: boolean;
  /** New cells may hold the text of the cells they copy. */
  copies?: boolean;
}

const SAME_COLUMNS: FuzzLines = { column: (c) => c };
const rowLines = (): FuzzLines => SAME_COLUMNS;

/**
 * *Delete row* (data-model §4.5): rows map by node id, and the positions the step gives up are
 * not compared. The cells that stand in row b after the move - the cells that start in D and
 * cover rows below it, and the own cells of row b - cannot overlap there (document-model §4.3),
 * so of an overlap between two of them, the later cell running into the earlier one's columns
 * (§4.6), the later cell gives up its columns from the first column of the earlier one on, as
 * Repair reduces it (§4.11): the positions it owned there, in its rows from b on, lose that
 * owner under any plan (an empty position then, FR-035). Every other position keeps its owner.
 */
function deletedRows(address: TableAddress): FuzzLines | null {
  const { grid } = address;
  const unit = unitLines(address, 'row');
  if (!unit || grid.tooLarge) return SAME_COLUMNS;
  const [a, b] = unit;
  const together: number[] = [];
  grid.cells.forEach((cell, index) => {
    if (cell.row === b || (cell.row >= a && cell.row < b && cell.row + cell.rowsIn > b)) {
      together.push(index);
    }
  });
  const given = new Set<number>();
  for (const later of together) {
    const cell = grid.cells[later]!;
    const right = cell.left + cell.colspan;
    let from = right;
    for (const earlier of together) {
      const left = grid.cells[earlier]!.left;
      if (earlier < later && left > cell.left && left < from) from = left;
    }
    for (let r = b; r < cell.row + cell.rowsIn; r += 1) {
      for (let c = from; c < right; c += 1) {
        if (grid.owner(r, c) === later) given.add(r * grid.width + c);
      }
    }
  }
  if (given.size === 0) return SAME_COLUMNS;
  return { given: (r, c) => given.has(r * grid.width + c), column: (c) => c };
}

function insertedColumns(side: 'left' | 'right') {
  return (address: TableAddress): FuzzLines | null => {
    const insertion = insertionLine(address, 'column', side);
    if (!insertion) return null;
    const { line, count } = insertion;
    return { column: (c) => (c < line ? c : c + count) };
  };
}

function deletedColumns(address: TableAddress): FuzzLines | null {
  const unit = unitLines(address, 'column');
  if (!unit) return null;
  const [a, b] = unit;
  return { skipColumns: [a, b], column: (c) => (c < a ? c : c - (b - a)) };
}

function movedColumns(direction: 'left' | 'right') {
  return (address: TableAddress): FuzzLines | null => {
    const bands = moveBands(address, direction);
    if (!bands || isRefusal(bands)) return null;
    const from = Math.min(bands.unit[0], bands.band[0]);
    const to = Math.max(bands.unit[1], bands.band[1]);
    return { skipColumns: [from, to], column: (c) => c };
  };
}

function duplicatedColumns(address: TableAddress): FuzzLines | null {
  const unit = unitLines(address, 'column');
  if (!unit) return null;
  const [a, b] = unit;
  return { column: (c) => (c < b ? c : c + (b - a)) };
}

/**
 * The commands of the mix with R8.15's weights: the four inserts 5 each, *Delete row* 8 and
 * *Delete column* 7, the four moves 1.5 and the two duplicates 2 each; the Tab row 5 (a weight
 * chosen here); Undo 5 and Redo 5.
 */
export const FUZZ_MIX: FuzzEntry[] = [
  {
    name: 'insertRowAbove',
    command: 'insertRowAbove',
    weight: 5,
    plan: (address, ctx) => planInsertRows(address, { side: 'above' }, ctx),
    lines: rowLines,
  },
  {
    name: 'insertRowBelow',
    command: 'insertRowBelow',
    weight: 5,
    plan: (address, ctx) => planInsertRows(address, { side: 'below' }, ctx),
    lines: rowLines,
  },
  {
    name: 'insertColumnLeft',
    command: 'insertColumnLeft',
    weight: 5,
    plan: (address, ctx) => planInsertColumns(address, { side: 'left' }, ctx),
    lines: insertedColumns('left'),
  },
  {
    name: 'insertColumnRight',
    command: 'insertColumnRight',
    weight: 5,
    plan: (address, ctx) => planInsertColumns(address, { side: 'right' }, ctx),
    lines: insertedColumns('right'),
  },
  {
    name: 'deleteRow',
    command: 'deleteRow',
    weight: 8,
    plan: (address, ctx) => planDeleteRows(address, ctx),
    lines: deletedRows,
    removes: true,
  },
  {
    name: 'deleteColumn',
    command: 'deleteColumn',
    weight: 7,
    plan: (address, ctx) => planDeleteColumns(address, ctx),
    lines: deletedColumns,
    removes: true,
  },
  {
    name: 'moveRowUp',
    command: 'moveRowUp',
    weight: 1.5,
    plan: (address, ctx) => planMoveRows(address, { direction: 'up' }, ctx),
    lines: rowLines,
  },
  {
    name: 'moveRowDown',
    command: 'moveRowDown',
    weight: 1.5,
    plan: (address, ctx) => planMoveRows(address, { direction: 'down' }, ctx),
    lines: rowLines,
  },
  {
    name: 'moveColumnLeft',
    command: 'moveColumnLeft',
    weight: 1.5,
    plan: (address, ctx) => planMoveColumns(address, { direction: 'left' }, ctx),
    lines: movedColumns('left'),
  },
  {
    name: 'moveColumnRight',
    command: 'moveColumnRight',
    weight: 1.5,
    plan: (address, ctx) => planMoveColumns(address, { direction: 'right' }, ctx),
    lines: movedColumns('right'),
  },
  {
    name: 'duplicateRow',
    command: 'duplicateRow',
    weight: 2,
    plan: (address, ctx) => planDuplicateRows(address, ctx),
    lines: rowLines,
    copies: true,
  },
  {
    name: 'duplicateColumn',
    command: 'duplicateColumn',
    weight: 2,
    plan: (address, ctx) => planDuplicateColumns(address, ctx),
    lines: duplicatedColumns,
    copies: true,
  },
  {
    name: 'tabRow',
    weight: 5,
    plan: (address, ctx) => planTabRow(address, ctx),
    caret: 'last',
    lines: rowLines,
  },
  { name: 'undo', weight: 5 },
  { name: 'redo', weight: 5 },
];

/* ------------------------------------------------------------------------ */
/* Hosts                                                                    */
/* ------------------------------------------------------------------------ */

/** Where the fuzz runs: an editor state it selects in, runs commands on and undoes. */
export interface FuzzHost {
  state(): EditorState;
  select(selection: Selection): void;
  run(command: Command): boolean;
  undo(): boolean;
  redo(): boolean;
  nextId(): string;
  /** Puts a start table at the end of the book's first section, replacing the previous one. */
  putTable(table: PMNode): void;
  /** The core's error count of the document, when the host can ask. */
  validate?(): Promise<number>;
}

/** A transaction putting `table` at the end of the first section, in place of `previous`. */
function putTableTransaction(state: EditorState, table: PMNode, previous: string | null) {
  const tr = state.tr;
  if (previous) {
    const old = findTable(state.doc, previous);
    if (old) return tr.replaceWith(old.pos, old.pos + old.node.nodeSize, table);
  }
  let section: { node: PMNode; pos: number } | null = null;
  state.doc.descendants((node, pos) => {
    if (section) return false;
    if (node.type.name === 'section') {
      section = { node, pos };
      return false;
    }
    return true;
  });
  if (!section) throw new Error('fuzz: the document has no section');
  const { node, pos } = section as { node: PMNode; pos: number };
  return tr.insert(pos + node.nodeSize - 1, table);
}

/**
 * A host over an `EditorState` with history: it dispatches into the state, and a transaction
 * that carries `DISCRETE_STEP` closes the history group before it and after it, as the Body
 * controller does (T035); Undo and Redo are `prosemirror-history`'s.
 */
export function createStateHost(
  initial: EditorState,
  { nextId }: { nextId?: () => string } = {},
): FuzzHost {
  let state = initial;
  let closeNext = false;
  let previous: string | null = null;
  let counter = 0;
  const ids = nextId ?? (() => `fz${(counter += 1)}`);
  const apply = (tr: Transaction) => {
    const discrete = tr.docChanged && tr.getMeta(DISCRETE_STEP) === true;
    if (tr.docChanged && (closeNext || discrete)) closeHistory(tr);
    closeNext = discrete;
    state = state.applyTransaction(tr).state;
  };
  const plain = (tr: Transaction) => {
    state = state.applyTransaction(tr).state;
  };
  return {
    state: () => state,
    select: (selection) => apply(state.tr.setSelection(selection)),
    run: (command) => command(state, apply),
    undo: () => undo(state, plain),
    redo: () => redo(state, plain),
    nextId: ids,
    putTable(table) {
      apply(putTableTransaction(state, table, previous).setMeta(DISCRETE_STEP, true));
      previous = table.attrs.nodeId as string;
    },
  };
}

/** The structural part of a table edit target the target host needs (`TableEditTarget`). */
export interface FuzzTarget {
  readonly state: EditorState | null;
  run(command: Command): boolean;
  setSelection(tr: Transaction): void;
  nextNodeId(): string;
}

/**
 * A host over a table edit target (the Body editor in the page): commands and the start
 * tables run through the target, each one undo step; `undo` and `redo` are the undo
 * coordinator's, `validate` the core's.
 */
export function createTargetHost(
  target: FuzzTarget,
  hooks: { undo(): boolean; redo(): boolean; validate?: () => Promise<number> },
): FuzzHost {
  let previous: string | null = null;
  const state = () => {
    const current = target.state;
    if (!current) throw new Error('fuzz: the target shows no document');
    return current;
  };
  return {
    state,
    select: (selection) => target.setSelection(state().tr.setSelection(selection)),
    run: (command) => target.run(command),
    undo: () => hooks.undo(),
    redo: () => hooks.redo(),
    nextId: () => target.nextNodeId(),
    putTable(table) {
      target.run((current, dispatch) => {
        dispatch?.(putTableTransaction(current, table, previous).setMeta(DISCRETE_STEP, true));
        return true;
      });
      previous = table.attrs.nodeId as string;
    },
    ...(hooks.validate ? { validate: hooks.validate } : {}),
  };
}

/* ------------------------------------------------------------------------ */
/* The oracle                                                               */
/* ------------------------------------------------------------------------ */

function findTable(doc: PMNode, nodeId: string): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === 'table' && node.attrs.nodeId === nodeId) {
      found = { node, pos };
      return false;
    }
    return true;
  });
  return found;
}

/** The cells of a table by node id. */
function cellsById(table: PMNode): Map<string, PMNode> {
  const cells = new Map<string, PMNode>();
  table.forEach((row) => {
    if (row.type.name !== 'tr') return;
    row.forEach((cell) => {
      if (cell.type.name === 'td' || cell.type.name === 'th') {
        cells.set(cell.attrs.nodeId as string, cell);
      }
    });
  });
  return cells;
}

/**
 * FR-035: every position outside the step's addressed lines keeps its owner's content and kind
 * at its mapped position; rows map by their `tr`'s node id, removed rows are skipped, holes are
 * not compared (a command may fill them), nor are the positions the step gives up (`given`).
 */
function checkLocality(before: PMNode, after: PMNode, lines: FuzzLines): string | null {
  const g0 = gridOfNode(before);
  const g1 = gridOfNode(after);
  if (g0.tooLarge || g1.tooLarge) return null;
  const rowsAfter = new Map<string, number>();
  for (let r = 0; r < g1.height; r += 1) {
    rowsAfter.set(after.child(g1.rowChild[r]!).attrs.nodeId as string, r);
  }
  for (let r0 = 0; r0 < g0.height; r0 += 1) {
    const r1 = rowsAfter.get(before.child(g0.rowChild[r0]!).attrs.nodeId as string);
    if (r1 === undefined) continue;
    for (let c0 = 0; c0 < g0.width; c0 += 1) {
      const skip = lines.skipColumns;
      if (skip && c0 >= skip[0] && c0 < skip[1]) continue;
      if (lines.given?.(r0, c0)) continue;
      const o0 = g0.owner(r0, c0);
      if (o0 < 0) continue;
      const c1 = lines.column(c0);
      const o1 = g1.owner(r1, c1);
      const n0 = gridCellNode(before, g0, o0);
      if (o1 < 0)
        return `position (${r0}, ${c0}) of "${n0.textContent}" is a hole at (${r1}, ${c1})`;
      const n1 = gridCellNode(after, g1, o1);
      if (n0.type !== n1.type || !n0.content.eq(n1.content)) {
        return `position (${r0}, ${c0}) of "${n0.textContent}" holds "${n1.textContent}" (${n1.type.name}) at (${r1}, ${c1})`;
      }
    }
  }
  return null;
}

/**
 * No character lost or invented (vR1 corr 16): every cell present before and after keeps its
 * text; text leaves only with the cells a step removes; new cells are empty except the copies
 * of a duplicate, each holding the text of a cell it copies.
 */
function checkCharacters(before: PMNode, after: PMNode, entry: FuzzEntry): string | null {
  const old = cellsById(before);
  const next = cellsById(after);
  const texts = new Map<string, number>();
  for (const [id, cell] of old) {
    texts.set(cell.textContent, (texts.get(cell.textContent) ?? 0) + 1);
    const kept = next.get(id);
    if (!kept) {
      if (!entry.removes) return `the cell "${cell.textContent}" (${id}) was removed`;
      continue;
    }
    if (kept.textContent !== cell.textContent) {
      return `the cell ${id} holds "${kept.textContent}" instead of "${cell.textContent}"`;
    }
  }
  for (const [id, cell] of next) {
    if (old.has(id) || cell.textContent === '') continue;
    const left = texts.get(cell.textContent) ?? 0;
    if (!entry.copies || left === 0) {
      return `the new cell ${id} holds "${cell.textContent}", which no cell it copies held`;
    }
    texts.set(cell.textContent, left - 1);
  }
  return null;
}

function sameAvailability(answer: Availability, plan: TableEdit | Refusal): boolean {
  if (!isRefusal(plan)) return isAvailable(answer);
  return JSON.stringify(answer) === JSON.stringify(plan);
}

/** What a command step saw, for the oracle. */
export interface FuzzStepRecord {
  entry: FuzzEntry;
  /** The state with the step's selection, before the command. */
  before: EditorState;
  after: EditorState;
  tablePos: number;
  address: TableAddress;
  /** The plan's dry run on the selection's address. */
  dryRun: TableEdit | Refusal;
  /** `availability` of the entry's command, when it has one. */
  answer: Availability | null;
  /** The command's answer when run. */
  ran: boolean;
}

/**
 * The oracle of one command step (data-model §16.4): the availability agrees with the dry
 * run; a refused step (or a plan that changes nothing) changes nothing and adds no history
 * event; a step that acts gives a valid document and table (`check()`, `assertTableValid`), a
 * regular table stays regular (FR-046), the positions outside its lines keep their owners
 * (FR-035) and no character is lost or invented. Null when every check holds, else the reason.
 */
export function checkFuzzStep(record: FuzzStepRecord): string | null {
  const { entry, before, after, tablePos, address, dryRun, answer, ran } = record;
  if (answer && !sameAvailability(answer, dryRun)) {
    return `availability ${JSON.stringify(answer)} disagrees with the plan's ${
      isRefusal(dryRun) ? JSON.stringify(dryRun) : 'edit'
    }`;
  }
  let acts = !isRefusal(dryRun);
  if (acts) acts = commitTableEdit(before.tr, tablePos, dryRun as TableEdit) !== null;
  if (!acts) {
    if (ran) return 'a step that does not act ran';
    if (!after.doc.eq(before.doc)) return 'a step that does not act changed the document';
    if (undoDepth(after) !== undoDepth(before))
      return 'a step that does not act added a history event';
    return null;
  }
  if (!ran) return 'the command did not run although its plan acts';
  try {
    after.doc.check();
  } catch (error) {
    return `the document is not valid: ${String(error)}`;
  }
  const table = address.table;
  const next = after.doc.nodeAt(tablePos);
  if (!next || next.type.name !== 'table' || next.attrs.nodeId !== table.attrs.nodeId) {
    return 'the table is no longer where it was';
  }
  try {
    assertTableValid(table, next);
  } catch (error) {
    return String(error instanceof Error ? error.message : error);
  }
  if (gridOfNode(table).regular && !gridOfNode(next).regular) {
    return 'a regular table became irregular';
  }
  const lines = entry.lines?.(address) ?? null;
  if (lines) {
    const locality = checkLocality(table, next, lines);
    if (locality) return locality;
  }
  return checkCharacters(table, next, entry);
}

/* ------------------------------------------------------------------------ */
/* The run                                                                  */
/* ------------------------------------------------------------------------ */

/** How a step's selection is described in a failure. */
export type FuzzSelection =
  | { kind: 'caret'; cell: string; offset: number }
  | { kind: 'block'; anchor: string; head: string }
  | null;

export interface FuzzFailure {
  seed: number;
  /** From 0. */
  step: number;
  command: string;
  selection: FuzzSelection;
  reason: string;
  /** The table before and after the step, as model JSON. */
  before: unknown;
  after: unknown;
}

export interface FuzzReport {
  seed: number;
  /** The steps run. */
  steps: number;
  /** The steps the core validated. */
  validations: number;
  /** The first failure, which stops the run. */
  failures: FuzzFailure[];
  /** The commands drawn, in order. */
  commands: string[];
}

export interface FuzzOptions {
  seed: number;
  steps: number;
  mix?: readonly FuzzEntry[];
}

function draw(
  rng: () => number,
  mix: readonly FuzzEntry[],
  canUndo: boolean,
  canRedo: boolean,
): FuzzEntry {
  const open = mix.filter(
    (entry) => (entry.name !== 'undo' || canUndo) && (entry.name !== 'redo' || canRedo),
  );
  const total = open.reduce((sum, entry) => sum + entry.weight, 0);
  let at = rng() * total;
  for (const entry of open) {
    at -= entry.weight;
    if (at < 0) return entry;
  }
  return open[open.length - 1]!;
}

/** A caret at a random offset of a random cell or, one time in three, a random block. */
function randomSelection(rng: () => number, doc: PMNode, tablePos: number): Selection {
  const table = doc.nodeAt(tablePos)!;
  const grid = gridOfNode(table);
  const count = grid.cells.length;
  if (count >= 2 && rng() < 1 / 3) {
    const anchor = below(rng, count);
    let head = below(rng, count - 1);
    if (head >= anchor) head += 1;
    return CellBlockSelection.create(
      doc,
      gridCellPos(table, tablePos, grid, anchor),
      gridCellPos(table, tablePos, grid, head),
    );
  }
  const cellPos = gridCellPos(table, tablePos, grid, below(rng, count));
  const size = doc.nodeAt(cellPos)!.content.size;
  return TextSelection.create(doc, cellPos + 1 + below(rng, size + 1));
}

/** A caret at the end of the table's last cell in document order (the Tab row). */
function lastCellCaret(doc: PMNode, tablePos: number): Selection {
  const table = doc.nodeAt(tablePos)!;
  const grid = gridOfNode(table);
  const cellPos = gridCellPos(table, tablePos, grid, grid.cells.length - 1);
  return TextSelection.create(doc, cellPos + 1 + doc.nodeAt(cellPos)!.content.size);
}

function describeSelection(selection: Selection): FuzzSelection {
  if (selection instanceof CellBlockSelection) {
    return {
      kind: 'block',
      anchor: selection.$anchorCell.nodeAfter!.attrs.nodeId as string,
      head: selection.$headCell.nodeAfter!.attrs.nodeId as string,
    };
  }
  const cell = selection.$head.parent;
  return { kind: 'caret', cell: cell.attrs.nodeId as string, offset: selection.$head.parentOffset };
}

interface Done {
  before: PMNode;
  after: PMNode;
}

/**
 * Runs `steps` commands of `mix` drawn with `seed` on `host` and checks every step
 * (`checkFuzzStep`; for Undo and Redo the exact document; with `validate` an error count of
 * 0); the first failure stops the run. A new start table comes every 40 commands and whenever
 * the table passes 12 × 12; Undo is drawn only while the current table has a step to undo,
 * Redo only while one is undone.
 */
export async function runFuzz(
  host: FuzzHost,
  { seed, steps, mix = FUZZ_MIX }: FuzzOptions,
): Promise<FuzzReport> {
  const rng = mulberry32(seed);
  const report: FuzzReport = { seed, steps: 0, validations: 0, failures: [], commands: [] };
  const schema = host.state().schema;
  let tableId: string | null = null;
  let age = 0;
  let done: Done[] = [];
  let undone: Done[] = [];
  const fail = (
    step: number,
    command: string,
    selection: FuzzSelection,
    reason: string,
    before: PMNode | null,
    after: PMNode | null,
  ) => {
    report.failures.push({
      seed,
      step,
      command,
      selection,
      reason,
      before: before ? nodeToModel(before) : null,
      after: after ? nodeToModel(after) : null,
    });
  };
  for (let step = 0; step < steps; step += 1) {
    let current = tableId ? findTable(host.state().doc, tableId) : null;
    const grid = current ? gridOfNode(current.node) : null;
    if (!current || age >= TABLE_LIFETIME || grid!.height > MAX_SIZE || grid!.width > MAX_SIZE) {
      const table = makeStartTable(rng, schema, () => host.nextId(), { valid: !!host.validate });
      host.putTable(table);
      tableId = table.attrs.nodeId as string;
      current = findTable(host.state().doc, tableId);
      age = 0;
      done = [];
      undone = [];
      if (!current) {
        fail(step, 'putTable', null, 'the start table is not in the document', table, null);
        break;
      }
    }
    const entry = draw(rng, mix, done.length > 0, undone.length > 0);
    report.commands.push(entry.name);
    age += 1;
    let reason: string | null = null;
    let selection: FuzzSelection = null;
    const tableBefore = current.node;
    try {
      if (entry.name === 'undo' || entry.name === 'redo') {
        const last = (entry.name === 'undo' ? done : undone).pop()!;
        const ok = entry.name === 'undo' ? host.undo() : host.redo();
        const doc = host.state().doc;
        if (!ok) reason = `${entry.name} did nothing`;
        else if (!doc.eq(entry.name === 'undo' ? last.before : last.after)) {
          reason = `${entry.name} did not give back the document ${
            entry.name === 'undo' ? 'before' : 'after'
          } the step`;
        }
        (entry.name === 'undo' ? undone : done).push(last);
      } else {
        const start = host.state();
        host.select(
          entry.caret === 'last'
            ? lastCellCaret(start.doc, current.pos)
            : randomSelection(rng, start.doc, current.pos),
        );
        const before = host.state();
        selection = describeSelection(before.selection);
        const target = tableTarget(before);
        if (!target || target.tablePos !== current.pos) {
          reason = 'the selection does not address the table';
        } else {
          const ctx = { nextId: () => host.nextId() };
          const dryRun = entry.plan!(target.address, ctx);
          const answer = entry.command ? availability(before, entry.command) : null;
          const ran = host.run(planCommand(entry.plan!, ctx));
          const after = host.state();
          reason = checkFuzzStep({
            entry,
            before,
            after,
            tablePos: current.pos,
            address: target.address,
            dryRun,
            answer,
            ran,
          });
          if (!reason && !after.doc.eq(before.doc)) {
            done.push({ before: before.doc, after: after.doc });
            undone = [];
          }
        }
      }
    } catch (error) {
      reason = `threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`;
    }
    report.steps = step + 1;
    if (!reason && host.validate) {
      try {
        const errors = await host.validate();
        report.validations += 1;
        if (errors !== 0) reason = `the core found ${errors} errors`;
      } catch (error) {
        reason = `validation failed: ${String(error)}`;
      }
    }
    if (reason) {
      const now = tableId ? findTable(host.state().doc, tableId) : null;
      fail(step, entry.name, selection, reason, tableBefore, now?.node ?? null);
      break;
    }
  }
  return report;
}
