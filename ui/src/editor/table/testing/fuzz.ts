/**
 * The seeded fuzz of SC-003 (feature 006, US2 T073; C76; I27; U19; data-model §16.4; quickstart
 * §2, §13; research R1.12, R8.15): random table commands on random tables, each step checked by
 * an oracle - the schema, `assertTableValid`, `availability` against the plan, an available
 * insertion, duplication or move acting (`grows`, `moves`), a regular table staying regular, the
 * positions outside the addressed lines keeping their owners' content (except those *Delete row*
 * gives up where it dissolves an overlap, `deletedRows`), no character lost or invented, Undo and
 * Redo giving back exact documents and, where the host can, the core's validation.
 *
 * Two hosts run it: `createStateHost` over an `EditorState` with history (vitest,
 * `tests/unit/editor/table/fuzz.test.ts`) and `createTargetHost` over a table edit target - the
 * Body editor, with the undo coordinator and the core's `doc.validate` - which the page hook
 * `__mfbeTest.tables.fuzz` loads with a dynamic import while the test hooks are on (C76). By
 * the engine rule this module imports only the model and the editor; nothing imports it
 * statically.
 *
 * The mix (`FUZZ_MIX`) is R8.15's weights for US2's commands, the Tab row, Undo and Redo; later
 * stories append their entries. US4 adds the block clear, the cut and the paste of a block
 * (SC-003; U19): the generator keeps its own clipboard - a cut block, or a copy of a drawn block
 * or of the whole current table - and pastes it through the router's `pasteTransaction`. US5
 * adds *Merge cells* on a drawn block and *Split cell* on a drawn caret, in a merged cell in half
 * of the draws (R8.15's "merge 10, split 10"), both through `planCommand`, which asks nothing
 * (the FR-015 question is the host's, C13). US6 adds the five header commands on a drawn caret
 * or block (R8.15's "header commands 10", 2 each) with a kind-only oracle (`checkKindStep`):
 * positions keep their owners, the target cells keep their content, node id and every attribute
 * and change only their kind, every other cell keeps its kind (FR-019). US7 adds the Table bar's
 * attribute changes on a drawn caret or block (8 of R8.15's "attributes 10", `xml:lang`
 * included; the span route's 2 come with US8) and its id edits (U19), each a plan of `attrs.ts`
 * whose value is drawn per step - a fresh id, an invalid one, one the book holds, the target's
 * own, a language tag or `de_DE` -, with an attribute oracle (`checkAttrStep`): the value that
 * must be refused is refused, positions keep their owners, cells their node id and content, only
 * the targets' attributes change; and after every step no FB2 id occurs twice in the document.
 * US8 adds *Repair table* on a drawn caret (R8.15's "repair 5"; refused with `regular` on a
 * regular table) with its oracle (`checkRepairStep`: the table regular, every cell kept with its
 * node id, content and reading order, every new cell an empty `td`), and the span route of the
 * Table bar - colspan and rowspan, the 2 of "attributes 10" US7 left - with each value drawn per
 * step from 1 to past the edge, the current one and an empty field's 1 included, and its oracle
 * (`checkSpanStep`: outside the head cell's old and new rectangles every cell keeps its content
 * and kind, a growth joins the removed cells' content into the head cell as a merge does, a shrink
 * adds empty cells only); a refusal changes nothing and adds no history event. US9 adds *Select
 * table*, *Delete table* and the two paragraph commands, run as ProseMirror commands with their
 * own oracle (`runWholeStep`). With them the mix is SC-003's final one (T187): each of the 24
 * names of `TABLE_COMMAND_NAMES` has an entry (`fuzz.test.ts`, "the mix holds every table
 * command").
 */

import { Fragment, Slice, type Node as PMNode, type Schema } from 'prosemirror-model';
import {
  NodeSelection,
  TextSelection,
  type Command,
  type EditorState,
  type Selection,
  type Transaction,
} from 'prosemirror-state';
import { closeHistory, redo, undo, undoDepth } from 'prosemirror-history';

import { pasteTransaction, dedupeIds } from '../../clipboard/route';
import { DISCRETE_STEP } from '../../commands/util';
import { nodeToModel } from '../../toModel';
import { headCell, planCellAttrs, planRowAlign, planSpan, planTableAttrs } from '../attrs';
import {
  availability,
  deleteTableCommand,
  isAvailable,
  paragraphCommand,
  selectTableCommand,
  TABLE_COMMAND_NAMES,
  TABLE_SELECTION_COMMANDS,
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
  type RefusalCode,
} from '../edit';
import { gridOfNode, type GridCell, type Rect } from '../grid';
import {
  checkSplit,
  insertionLine,
  moveBands,
  planDeleteColumns,
  planDeleteRows,
  planDuplicateColumns,
  planDuplicateRows,
  planInsertColumns,
  planInsertRows,
  planMerge,
  planMoveColumns,
  planMoveRows,
  planRepair,
  planSetKind,
  planSplit,
  planTabRow,
  planToggleHeaderCell,
  planToggleHeaderLines,
  pasteBlockPlan,
  planClearBlock,
  normalisePastedBlock,
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
  /**
   * Where the caret goes: a random cell or block, the table's last cell (the Tab row), always a
   * random block (the block commands), or a caret in a random cell - in a merged cell in half of
   * the draws, when the table has one (*Split cell*).
   */
  caret?: 'last' | 'block' | 'merged';
  /** The lines the step addresses and its column map; null when it addresses none. */
  lines?(address: TableAddress): FuzzLines | null;
  /**
   * The step inserts or duplicates rows or columns: on a table whose every row holds a cell it
   * acts whenever its plan answers an edit - a new row left without a cell of its own is
   * compacted away (FR-046), never the whole step (FR-037; data-model §4.5).
   */
  grows?: boolean;
  /**
   * The step moves rows or columns: it acts whenever its plan answers an edit - a move that
   * would change nothing, a column move that moves no row, is refused with a reason (FR-037,
   * FR-043; data-model §4.5).
   */
  moves?: boolean;
  /** The step removes cells (their text leaves with them). */
  removes?: boolean;
  /** New cells may hold the text of the cells they copy. */
  copies?: boolean;
  /** US4: the block's cells lose their text (clear, cut); `cut` puts the block on the clipboard. */
  clears?: 'clear' | 'cut';
  /** US4: the step pastes the generator's clipboard through the router. */
  pastes?: boolean;
  /** US5: *Merge cells* - its own locality and character oracle (`checkMergeStep`). */
  merges?: boolean;
  /** US5: *Split cell* - its own locality oracle (`checkSplitStep`). */
  splits?: boolean;
  /**
   * US6: a header command - the kind-only oracle (`checkKindStep`) with the cells the step may
   * change, read from the address before it; null when it addresses none.
   */
  kinds?(address: TableAddress): KindTargets | null;
  /** US7: a Table-bar attribute change - its value drawn per step, the attribute oracle. */
  attr?: FuzzAttr;
  /** US8: *Repair table* - its own oracle (`checkRepairStep`). */
  repairs?: boolean;
  /** US8: the Table bar's colspan or rowspan - its value drawn per step, the span oracle. */
  span?: 'colspan' | 'rowspan';
  /**
   * US9: a whole-table command run as a ProseMirror command instead of a plan, with its own
   * oracle (`runWholeStep`).
   */
  whole?: WholeTableCommand;
}

/** US9's whole-table commands in the fuzz. */
export type WholeTableCommand = 'select' | 'delete' | 'paragraphBefore' | 'paragraphAfter';

/**
 * US7: what an attribute step sets - `name` on the target cells (`cells`: every cell of the
 * block, or the caret's), on the head cell (`head`, the id), on the target rows (`rows`) or on
 * the table (`table`) - and how its value is drawn.
 */
export interface FuzzAttr {
  scope: 'cells' | 'head' | 'rows' | 'table';
  name: 'align' | 'valign' | 'style' | 'lang' | 'id';
  draw(rng: () => number, input: FuzzAttrInput): FuzzAttrValue;
}

export interface FuzzAttrInput {
  address: TableAddress;
  /** The book's ids (`FuzzHost.bookIds()`). */
  bookIds: ReadonlySet<string>;
  /** A valid id no element of the book uses: `fz<n>`. */
  fresh(): string;
}

export interface FuzzAttrValue {
  value: string;
  /** The refusal the plan must answer; none: the plan answers an edit (perhaps a no-op). */
  refusal?: RefusalCode;
}

/**
 * The cells a header command may change (indices in the grid before it) and the kind they have
 * afterwards: `'flip'` - *Toggle header cell*'s one cell takes the other kind -, `'toggle'` - all
 * of them `td` when all were `th`, otherwise all `th` (FR-018) -, or the kind itself.
 */
export interface KindTargets {
  cells: ReadonlySet<number>;
  kind: 'td' | 'th' | 'flip' | 'toggle';
}

/** The generator's clipboard (US4): the table a cut or a copy left, as `content()` gives it. */
export interface FuzzClipboard {
  table: PMNode | null;
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

/** The grid cell whose top-left position is `at` (US6), found among the cells' own places. */
function cellStartingAt(address: TableAddress, at: { row: number; col: number } | undefined) {
  if (!at) return -1;
  return address.grid.cells.findIndex((cell) => cell.row === at.row && cell.left === at.col);
}

/** *Toggle header cell* (US6): the head cell of a block, else the caret's cell, flips. */
function headCellTarget(address: TableAddress): KindTargets | null {
  const index = cellStartingAt(address, address.rect ? address.head : address.caret);
  return index < 0 ? null : { cells: new Set([index]), kind: 'flip' };
}

/** *Make header cells* and *Make normal cells* (US6): every cell of a block, else the caret's. */
function blockTargets(kind: 'td' | 'th') {
  return (address: TableAddress): KindTargets | null => {
    const { grid, rect } = address;
    if (rect) return grid.tooLarge ? null : { cells: new Set(grid.cellsIn(rect)), kind };
    const index = cellStartingAt(address, address.caret);
    return index < 0 ? null : { cells: new Set([index]), kind };
  };
}

/**
 * *Toggle header row* and *Toggle header column* (US6): the owners of every position of the
 * block's rows (columns), else of the caret cell's top row (left column), toggled together.
 */
function lineTargets(axis: 'row' | 'column') {
  return (address: TableAddress): KindTargets | null => {
    const { grid, rect, caret } = address;
    if (grid.tooLarge) return null;
    let from: number;
    let to: number;
    if (rect) [from, to] = axis === 'row' ? [rect.top, rect.bottom] : [rect.left, rect.right];
    else if (caret)
      [from, to] = axis === 'row' ? [caret.row, caret.row + 1] : [caret.col, caret.col + 1];
    else return null;
    const cells = new Set<number>();
    for (let r = 0; r < grid.height; r += 1) {
      for (let c = 0; c < grid.width; c += 1) {
        const at = axis === 'row' ? r : c;
        if (at < from || at >= to) continue;
        const owner = grid.owner(r, c);
        if (owner >= 0) cells.add(owner);
      }
    }
    return { cells, kind: 'toggle' };
  };
}

/** US7: one of `values`. */
function drawnOf(values: readonly string[]) {
  return (rng: () => number): FuzzAttrValue => ({ value: pick(rng, values) });
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LETTERS_DIGITS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** US7: a random language tag: 1-8 letters, then up to two parts of 1-8 letters or digits. */
function drawnTag(rng: () => number): string {
  const part = (chars: string) => {
    let out = '';
    const length = 1 + below(rng, 8);
    for (let i = 0; i < length; i += 1) out += chars[below(rng, chars.length)];
    return out;
  };
  let tag = part(LETTERS);
  const parts = below(rng, 3);
  for (let i = 0; i < parts; i += 1) tag += `-${part(LETTERS_DIGITS)}`;
  return tag;
}

/** US7, *Cell language*: `de`, `en-GB`, a drawn tag, `''` (removal) or `de_DE`, refused. */
function drawnLang(rng: () => number): FuzzAttrValue {
  switch (below(rng, 5)) {
    case 0:
      return { value: 'de' };
    case 1:
      return { value: 'en-GB' };
    case 2:
      return { value: drawnTag(rng) };
    case 3:
      return { value: '' };
    default:
      return { value: 'de_DE', refusal: 'invalid-lang' };
  }
}

/** The id of the head cell (US7): the cell that holds `$head`, else the caret's. */
function headCellId(address: TableAddress): string | null {
  const index = cellStartingAt(address, address.head ?? address.caret);
  if (index < 0) return null;
  const id = gridCellNode(address.table, address.grid, index).attrs.id;
  return typeof id === 'string' && id !== '' ? id : null;
}

/**
 * US7, the Table-bar id edits (U19): a fresh valid id; an invalid one (`1t`, `a b`); an id the
 * book holds - another element's, refused -; the target's own id (no change); or `''`, which
 * removes it.
 */
function drawnId(own: (address: TableAddress) => string | null) {
  return (rng: () => number, input: FuzzAttrInput): FuzzAttrValue => {
    const mine = own(input.address);
    switch (below(rng, 6)) {
      case 0:
        return { value: input.fresh() };
      case 1:
        return { value: '1t', refusal: 'invalid-id' };
      case 2:
        return { value: 'a b', refusal: 'invalid-id' };
      case 3: {
        const held = [...input.bookIds].filter((id) => id !== mine);
        if (held.length === 0) return { value: input.fresh() };
        return { value: pick(rng, held), refusal: 'duplicate-id' };
      }
      case 4:
        return { value: mine ?? '' };
      default:
        return { value: '' };
    }
  };
}

const ALIGNS = ['left', 'right', 'center', ''] as const;
const VALIGNS = ['top', 'middle', 'bottom', ''] as const;
/** Styles: trimmed (` padded `) and removed (`''`) too. */
const STYLES = ['wide', 'narrow', ' padded ', ''] as const;

/** The plan of an attribute step with its drawn value (US7). */
function attrPlan(attr: FuzzAttr, value: string): TablePlan {
  switch (attr.scope) {
    case 'cells':
    case 'head':
      return (address, ctx) => planCellAttrs(address, { [attr.name]: value }, ctx);
    case 'rows':
      return (address, ctx) => planRowAlign(address, { align: value }, ctx);
    default:
      return (address, ctx) => planTableAttrs(address, { [attr.name]: value }, ctx);
  }
}

/**
 * SC-003's final command mix (T187): every command of user stories 1 to 9 - each of the 24
 * table commands of `TABLE_COMMAND_NAMES` through an entry of its own, and the Tab row, the
 * block clear, cut and paste, the Table bar's attribute plans, its span route and its id edits -
 * in this order, which fixes what a seed draws. R8.15's weights: inserts 20 (the four inserts 5
 * each), deletes 15 (*Delete row* 8, *Delete column* 7), merge 10, split 10, header commands 10
 * (the five 2 each), attributes 10 (*Cell align* 2, *Cell valign* 1, *Cell style* 1, *Cell
 * language* 2 - `xml:lang` -, *Row align* 1, *Table style* 1, and the span route's colspan 1 and
 * rowspan 1), moves and duplicates 10 (the four moves 1.5 each, the two duplicates 2 each),
 * repair 5, Undo 5 and Redo 5; and the weights the stories gave their additions, which R8.15
 * leaves open: the Tab row 5 (US2), the block clear 3, the cut 2 and the paste 5 (US4), the id
 * edits *Cell ID* 1 and *Table ID* 1 (US7; U19), *Select table* 2, *Delete table* 1 and the two
 * paragraph commands 1 each (US9). The weights add up to 122.
 */
export const FUZZ_MIX: readonly FuzzEntry[] = [
  {
    name: 'insertRowAbove',
    command: 'insertRowAbove',
    weight: 5,
    plan: (address, ctx) => planInsertRows(address, { side: 'above' }, ctx),
    lines: rowLines,
    grows: true,
  },
  {
    name: 'insertRowBelow',
    command: 'insertRowBelow',
    weight: 5,
    plan: (address, ctx) => planInsertRows(address, { side: 'below' }, ctx),
    lines: rowLines,
    grows: true,
  },
  {
    name: 'insertColumnLeft',
    command: 'insertColumnLeft',
    weight: 5,
    plan: (address, ctx) => planInsertColumns(address, { side: 'left' }, ctx),
    lines: insertedColumns('left'),
    grows: true,
  },
  {
    name: 'insertColumnRight',
    command: 'insertColumnRight',
    weight: 5,
    plan: (address, ctx) => planInsertColumns(address, { side: 'right' }, ctx),
    lines: insertedColumns('right'),
    grows: true,
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
    moves: true,
  },
  {
    name: 'moveRowDown',
    command: 'moveRowDown',
    weight: 1.5,
    plan: (address, ctx) => planMoveRows(address, { direction: 'down' }, ctx),
    lines: rowLines,
    moves: true,
  },
  {
    name: 'moveColumnLeft',
    command: 'moveColumnLeft',
    weight: 1.5,
    plan: (address, ctx) => planMoveColumns(address, { direction: 'left' }, ctx),
    lines: movedColumns('left'),
    moves: true,
  },
  {
    name: 'moveColumnRight',
    command: 'moveColumnRight',
    weight: 1.5,
    plan: (address, ctx) => planMoveColumns(address, { direction: 'right' }, ctx),
    lines: movedColumns('right'),
    moves: true,
  },
  {
    name: 'duplicateRow',
    command: 'duplicateRow',
    weight: 2,
    plan: (address, ctx) => planDuplicateRows(address, ctx),
    lines: rowLines,
    copies: true,
    grows: true,
  },
  {
    name: 'duplicateColumn',
    command: 'duplicateColumn',
    weight: 2,
    plan: (address, ctx) => planDuplicateColumns(address, ctx),
    lines: duplicatedColumns,
    copies: true,
    grows: true,
  },
  {
    name: 'tabRow',
    weight: 5,
    plan: (address, ctx) => planTabRow(address, ctx),
    caret: 'last',
    lines: rowLines,
    grows: true,
  },
  // US4 (SC-003; U19): the block clear (Delete on a drawn block), the cut and the paste.
  {
    name: 'clearBlock',
    weight: 3,
    plan: (address, ctx) => planClearBlock(address, ctx),
    caret: 'block',
    clears: 'clear',
  },
  {
    name: 'cutBlock',
    weight: 2,
    plan: (address, ctx) => planClearBlock(address, ctx),
    caret: 'block',
    clears: 'cut',
  },
  { name: 'pasteBlock', weight: 5, pastes: true, removes: true, copies: true },
  // US5 (SC-003; R8.15's weights): Merge cells always on a drawn block, Split cell on a drawn
  // caret, put into a merged cell in half of the draws so that the split acts.
  {
    name: 'mergeCells',
    command: 'mergeCells',
    weight: 10,
    plan: (address, ctx) => planMerge(address, ctx),
    caret: 'block',
    merges: true,
  },
  {
    name: 'splitCell',
    command: 'splitCell',
    weight: 10,
    plan: (address, ctx) => planSplit(address, ctx),
    caret: 'merged',
    splits: true,
  },
  // US6 (SC-003; R8.15's "header commands 10"): the five header commands on a drawn caret or
  // block, each checked by the kind-only oracle, so the fuzz also proves FR-019 at random.
  {
    name: 'toggleHeaderCell',
    command: 'toggleHeaderCell',
    weight: 2,
    plan: (address, ctx) => planToggleHeaderCell(address, ctx),
    kinds: headCellTarget,
  },
  {
    name: 'makeHeaderCells',
    command: 'makeHeaderCells',
    weight: 2,
    plan: (address, ctx) => planSetKind(address, { kind: 'th' }, ctx),
    kinds: blockTargets('th'),
  },
  {
    name: 'makeNormalCells',
    command: 'makeNormalCells',
    weight: 2,
    plan: (address, ctx) => planSetKind(address, { kind: 'td' }, ctx),
    kinds: blockTargets('td'),
  },
  {
    name: 'toggleHeaderRow',
    command: 'toggleHeaderRow',
    weight: 2,
    plan: (address, ctx) => planToggleHeaderLines(address, { axis: 'row' }, ctx),
    kinds: lineTargets('row'),
  },
  {
    name: 'toggleHeaderColumn',
    command: 'toggleHeaderColumn',
    weight: 2,
    plan: (address, ctx) => planToggleHeaderLines(address, { axis: 'column' }, ctx),
    kinds: lineTargets('column'),
  },
  // US7 (SC-003; R8.15's "attributes 10", `xml:lang` included; U19): the Table bar's fields on
  // a drawn caret or block, each value drawn per step, checked by the attribute oracle.
  { name: 'cellAlign', weight: 2, attr: { scope: 'cells', name: 'align', draw: drawnOf(ALIGNS) } },
  {
    name: 'cellValign',
    weight: 1,
    attr: { scope: 'cells', name: 'valign', draw: drawnOf(VALIGNS) },
  },
  { name: 'cellStyle', weight: 1, attr: { scope: 'cells', name: 'style', draw: drawnOf(STYLES) } },
  { name: 'cellLang', weight: 2, attr: { scope: 'cells', name: 'lang', draw: drawnLang } },
  { name: 'rowAlign', weight: 1, attr: { scope: 'rows', name: 'align', draw: drawnOf(ALIGNS) } },
  {
    name: 'tableStyle',
    weight: 1,
    attr: { scope: 'table', name: 'style', draw: drawnOf(STYLES) },
  },
  { name: 'cellId', weight: 1, attr: { scope: 'head', name: 'id', draw: drawnId(headCellId) } },
  {
    name: 'tableId',
    weight: 1,
    attr: {
      scope: 'table',
      name: 'id',
      draw: drawnId((address) => {
        const id = address.table.attrs.id;
        return typeof id === 'string' && id !== '' ? id : null;
      }),
    },
  },
  // US8 (SC-003; R8.15's "repair 5" and the span route's 2 of "attributes 10"): *Repair table*
  // with a caret in a drawn cell, and the Table bar's colspan and rowspan on a drawn caret or
  // block, each value drawn per step.
  {
    name: 'repair',
    command: 'repair',
    weight: 5,
    plan: (address, ctx) => planRepair(address, ctx),
    repairs: true,
  },
  { name: 'colspan', weight: 1, span: 'colspan' },
  { name: 'rowspan', weight: 1, span: 'rowspan' },
  { name: 'undo', weight: 5 },
  { name: 'redo', weight: 5 },
  // US9 (SC-003; weights chosen here, R8.15 gives none): *Select table* (2), whose next draw
  // acts on the selected table - *Delete table*, or one of the commands outside
  // `TABLE_SELECTION_COMMANDS`, which must refuse with `tableSelected` -, *Delete table* (1),
  // after which a new start table comes, and the two paragraph commands (1 each); each a
  // ProseMirror command with its own oracle (`runWholeStep`).
  { name: 'select', command: 'select', weight: 2, whole: 'select' },
  { name: 'delete', command: 'delete', weight: 1, whole: 'delete' },
  { name: 'paragraphBefore', command: 'paragraphBefore', weight: 1, whole: 'paragraphBefore' },
  { name: 'paragraphAfter', command: 'paragraphAfter', weight: 1, whole: 'paragraphAfter' },
];

/**
 * US8: a span field's value for the head cell of `address` - 1 (an empty field) and the current
 * value in some draws, otherwise from 1 to one past the table's edge, which the plan refuses.
 */
function drawSpan(rng: () => number, address: TableAddress, axis: 'colspan' | 'rowspan'): number {
  const head = headCell(address);
  const { grid } = address;
  if (!head || grid.tooLarge) return 1;
  const cell = grid.cells[head.index]!;
  const roll = rng();
  if (roll < 0.15) return 1;
  if (roll < 0.3) return axis === 'colspan' ? cell.colspan : cell.rowspan;
  const limit = axis === 'colspan' ? grid.width - cell.left : grid.height - cell.row;
  return 1 + Math.floor(rng() * (limit + 1));
}

/* ------------------------------------------------------------------------ */
/* The whole-table steps (US9)                                              */
/* ------------------------------------------------------------------------ */

/** True for an empty `p` whose node id is a string the document `before` does not hold. */
function freshEmptyParagraph(node: PMNode | null | undefined, before: PMNode): boolean {
  if (!node || node.type.name !== 'p' || node.content.size > 0) return false;
  const id = node.attrs.nodeId;
  if (typeof id !== 'string' || id === '') return false;
  let used = false;
  before.descendants((child) => {
    if (child.attrs.nodeId === id) used = true;
    return !used;
  });
  return !used;
}

/**
 * The oracle of *Delete table* (data-model §4.5 `table.delete`; C24): the table gone, an empty
 * `p` with a fresh node id in its place exactly where the container's content model then needs
 * a block, and every other part of the document identical - the characters of the table's cells
 * the only ones removed (vR1 corr 16).
 */
function checkDeleteStep(before: EditorState, after: EditorState, tablePos: number): string | null {
  const table = before.doc.nodeAt(tablePos)!;
  const $table = before.doc.resolve(tablePos);
  const rest: PMNode[] = [];
  $table.parent.forEach((child, _offset, index) => {
    if (index !== $table.index()) rest.push(child);
  });
  const needs =
    !$table.parent.type.validContent(Fragment.from(rest)) ||
    ($table.depth === 0 && rest.length === 0);
  const end = tablePos + table.nodeSize;
  const filled = needs ? 2 : 0;
  if (!before.doc.slice(0, tablePos).eq(after.doc.slice(0, tablePos))) {
    return 'delete changed the document before the table';
  }
  if (!before.doc.slice(end).eq(after.doc.slice(tablePos + filled))) {
    return 'delete changed the document after the table';
  }
  if (needs && !freshEmptyParagraph(after.doc.nodeAt(tablePos), before.doc)) {
    return 'delete left no empty paragraph where the container needs a block';
  }
  if (!needs && after.doc.content.size !== before.doc.content.size - table.nodeSize) {
    return 'delete put something in the place of a table its container does without';
  }
  return null;
}

/**
 * The oracle of *Paragraph before / after table* (FR-033): the table the same node and one empty
 * `p` with a fresh node id directly before (after) it, the rest of the document identical.
 */
function checkParagraphStep(
  before: EditorState,
  after: EditorState,
  tablePos: number,
  side: 'before' | 'after',
): string | null {
  const table = before.doc.nodeAt(tablePos)!;
  const at = side === 'before' ? tablePos : tablePos + table.nodeSize;
  if (!freshEmptyParagraph(after.doc.nodeAt(at), before.doc)) {
    return `no empty paragraph with a fresh node id ${side} the table`;
  }
  const tableAfter = after.doc.nodeAt(side === 'before' ? tablePos + 2 : tablePos);
  if (tableAfter !== table) return `the table is not the same node after the paragraph ${side} it`;
  if (!before.doc.slice(0, at).eq(after.doc.slice(0, at))) return 'the document before it changed';
  if (!before.doc.slice(at).eq(after.doc.slice(at + 2))) return 'the document after it changed';
  return null;
}

/**
 * One step of a whole-table command (US9): availability ok for the caret or block on the table,
 * the command run through the host, and its oracle; *Select table* changes nothing but the
 * selection - a `NodeSelection` of the table -, and then either *Delete table* or a command
 * outside `TABLE_SELECTION_COMMANDS`, which refuses with `tableSelected`, acts on it. `deleted`
 * when the table went (the run then puts a new start table).
 */
function runWholeStep(
  host: FuzzHost,
  rng: () => number,
  kind: WholeTableCommand,
  before: EditorState,
  tablePos: number,
  ctx: { nextId(): string },
): { reason: string | null; deleted: boolean } {
  const answer = availability(before, kind);
  if (!isAvailable(answer)) {
    return { reason: `${kind} is unavailable: ${JSON.stringify(answer)}`, deleted: false };
  }
  const deleteStep = (state: EditorState) => {
    if (!host.run(deleteTableCommand(ctx))) return { reason: 'delete did not run', deleted: false };
    return { reason: checkDeleteStep(state, host.state(), tablePos), deleted: true };
  };
  if (kind === 'paragraphBefore' || kind === 'paragraphAfter') {
    const side = kind === 'paragraphBefore' ? 'before' : 'after';
    if (!host.run(paragraphCommand(side, ctx)))
      return { reason: `${kind} did not run`, deleted: false };
    return { reason: checkParagraphStep(before, host.state(), tablePos, side), deleted: false };
  }
  if (kind === 'delete') return deleteStep(before);
  if (!host.run(selectTableCommand)) return { reason: 'select did not run', deleted: false };
  const selected = host.state();
  if (!selected.doc.eq(before.doc))
    return { reason: 'select changed the document', deleted: false };
  if (!(selected.selection instanceof NodeSelection) || selected.selection.from !== tablePos) {
    return { reason: 'select did not select the table as a node', deleted: false };
  }
  if (rng() < 0.5) return deleteStep(selected);
  const others = TABLE_COMMAND_NAMES.filter((name) => !TABLE_SELECTION_COMMANDS.has(name));
  const name = pick(rng, others);
  const refusal = availability(selected, name);
  if (!('refused' in refusal) || refusal.refused !== 'tableSelected') {
    return {
      reason: `${name} on a selected table answered ${JSON.stringify(refusal)}`,
      deleted: false,
    };
  }
  return { reason: null, deleted: false };
}

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
  /** The book's ids, for the pasted ids (US4; C47). */
  bookIds(): ReadonlySet<string>;
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
    bookIds: () => {
      const found = new Set<string>();
      state.doc.descendants((node) => {
        if (typeof node.attrs.id === 'string' && node.attrs.id !== '') found.add(node.attrs.id);
        return true;
      });
      return found;
    },
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
  hooks: {
    undo(): boolean;
    redo(): boolean;
    validate?: () => Promise<number>;
    bookIds?: () => ReadonlySet<string>;
  },
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
    bookIds: () => hooks.bookIds?.() ?? new Set<string>(),
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
function checkCharacters(
  before: PMNode,
  after: PMNode,
  entry: FuzzEntry,
  extra: PMNode | null = null,
): string | null {
  const old = cellsById(before);
  const next = cellsById(after);
  const texts = new Map<string, number>();
  // A pasted block brings its cells' texts (US4).
  if (extra) {
    for (const cell of cellsById(extra).values()) {
      texts.set(cell.textContent, (texts.get(cell.textContent) ?? 0) + 1);
    }
  }
  for (const [id, cell] of old) {
    texts.set(cell.textContent, (texts.get(cell.textContent) ?? 0) + 1);
    const kept = next.get(id);
    if (!kept) {
      if (!entry.removes) return `the cell "${cell.textContent}" (${id}) was removed`;
      continue;
    }
    if (kept.textContent !== cell.textContent && !(entry.clears && kept.textContent === '')) {
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
  /** US4: the block a paste step pasted, as the plan read it. */
  clipboard?: PMNode | null;
  /** US7: the value an attribute step drew, with the refusal it must answer. */
  attrValue?: FuzzAttrValue;
  /** US8: the value a span step drew. */
  spanValue?: number;
}

/** The cells of a table (its rows' `td` and `th` children), in reading order. */
function tableCells(table: PMNode): PMNode[] {
  const out: PMNode[] = [];
  table.forEach((row) => {
    if (row.type.name !== 'tr') return;
    row.forEach((cell) => {
      if (cell.type.name === 'td' || cell.type.name === 'th') out.push(cell);
    });
  });
  return out;
}

/** True for a cell without content and without an attribute but its node id. */
function plainEmpty(cell: PMNode): boolean {
  return (
    cell.content.size === 0 &&
    Object.entries(cell.attrs).every(([key, value]) => key === 'nodeId' || value === null)
  );
}

/**
 * US8's repair oracle (FR-034; C16; document-model §4.11): the table is regular, every cell of
 * the table before keeps its node id, its content, its kind and its place in reading order, and
 * every new cell is an empty `td` without attributes.
 */
function checkRepairStep(before: PMNode, after: PMNode): string | null {
  if (!gridOfNode(after).regular) return 'the repaired table is not regular';
  const old = tableCells(before);
  const ids = new Set(old.map((cell) => cell.attrs.nodeId));
  const now = tableCells(after);
  const kept = now.filter((cell) => ids.has(cell.attrs.nodeId));
  if (kept.length !== old.length) return 'Repair table lost a cell';
  for (let index = 0; index < old.length; index += 1) {
    const was = old[index]!;
    const is = kept[index]!;
    if (is.attrs.nodeId !== was.attrs.nodeId) return 'Repair table changed the reading order';
    if (is.content !== was.content) return `the cell ${String(was.attrs.nodeId)} lost its content`;
    if (is.type !== was.type) return `the cell ${String(was.attrs.nodeId)} changed its kind`;
  }
  for (const cell of now) {
    if (ids.has(cell.attrs.nodeId)) continue;
    if (cell.type.name !== 'td' || !plainEmpty(cell)) {
      return 'a cell Repair table added is not an empty td without attributes';
    }
  }
  return null;
}

/**
 * US8's span oracle (FR-036, FR-035; data-model §4.7): every cell outside the head cell's old
 * rectangle and its new one extended to whole cells keeps its node id, content and kind; a growth
 * keeps the head cell, its content first, and takes in the content of every cell it removes, as
 * a merge does; a shrink keeps the head cell's content and adds empty cells only - of its kind, or
 * the hole fill's plain `td`s.
 */
function checkSpanStep(
  before: PMNode,
  after: PMNode,
  address: TableAddress,
  axis: 'colspan' | 'rowspan',
  value: number,
): string | null {
  const head = headCell(address);
  if (!head) return 'a span step acted without a head cell';
  const { grid } = address;
  const cell = grid.cells[head.index]!;
  const oldRect: Rect = {
    top: cell.row,
    left: cell.left,
    bottom: cell.row + cell.rowsIn,
    right: cell.left + cell.colspan,
  };
  const grows = value > (axis === 'colspan' ? cell.colspan : cell.rowspan);
  const rect = grows
    ? grid.extend(
        axis === 'colspan'
          ? { ...oldRect, right: cell.left + value }
          : { ...oldRect, bottom: cell.row + value },
      )
    : oldRect;
  const meets = (index: number, r: Rect) => {
    const other = grid.cells[index]!;
    return (
      other.row < r.bottom &&
      other.row + other.rowsIn > r.top &&
      other.left < r.right &&
      other.left + other.colspan > r.left
    );
  };
  const now = new Map(tableCells(after).map((one) => [one.attrs.nodeId as string, one]));
  const oldIds = new Set<string>();
  const removed: string[] = [];
  for (let index = 0; index < grid.cells.length; index += 1) {
    const node = gridCellNode(before, grid, index);
    const id = node.attrs.nodeId as string;
    oldIds.add(id);
    if (index === head.index) continue;
    const kept = now.get(id);
    if (meets(index, oldRect) || meets(index, rect)) {
      if (!kept && node.textContent !== '') removed.push(node.textContent);
      continue;
    }
    if (!kept) return `the cell ${id} outside the span's rectangles went`;
    if (kept.content !== node.content)
      return `the cell ${id} outside the span's rectangles changed`;
    if (kept.type !== node.type)
      return `the cell ${id} outside the span's rectangles changed its kind`;
  }
  const keeper = now.get(head.node.attrs.nodeId as string);
  if (!keeper) return 'the head cell went';
  if (grows) {
    const text = keeper.textContent;
    if (!text.startsWith(head.node.textContent)) return 'the head cell lost its own content';
    for (const part of removed) {
      if (!text.includes(part)) return `the content "${part}" of a merged cell was lost`;
    }
    return null;
  }
  if (keeper.content !== head.node.content) return 'the head cell changed its content';
  for (const [id, one] of now) {
    if (oldIds.has(id)) continue;
    const ofKind = one.type === head.node.type && one.content.size === 0;
    if (!ofKind && !(one.type.name === 'td' && plainEmpty(one))) {
      return 'a cell the split added is not an empty cell of the head cell’s kind';
    }
  }
  return null;
}

/**
 * US4's locality (FR-035): after a clear or a cut, the block's positions keep their owner's node
 * id and kind and lose their content, every other position keeps its owner's content and kind;
 * after a paste, every position outside the target rectangle T keeps its owner's content and kind
 * - a cell that crossed T's edge left empty pieces of its kind, its content in its top-left
 * piece, and its positions a later cell overlapped to that cell, with that cell's kind and
 * content, or to an empty piece of that cell's kind when it crossed T too (the split, §4.5
 * `table.splitCell`) - and T's rows hold the pasted block's cells (content, kind) where the
 * block starts them, less the rows of T the paste compacts, which only rows where the block
 * starts no cell can be (data-model §8.4 step 5).
 */
function checkBlockLocality(
  before: PMNode,
  after: PMNode,
  rect: Rect,
  pasted: PMNode | null,
): string | null {
  const g0 = gridOfNode(before);
  const g1 = gridOfNode(after);
  if (g0.tooLarge || g1.tooLarge) return null;
  const rowsAfter = new Map<string, number>();
  for (let r = 0; r < g1.height; r += 1) {
    rowsAfter.set(after.child(g1.rowChild[r]!).attrs.nodeId as string, r);
  }
  const inside = (r: number, c: number) =>
    r >= rect.top && r < rect.bottom && c >= rect.left && c < rect.right;
  // Where each cell stood before: a split crossing cell's position may go to a later cell that
  // overlapped it there (an irregular table's overlap resolved).
  const before0 = new Map<unknown, number>();
  g0.cells.forEach((_cell, index) => {
    before0.set(gridCellNode(before, g0, index).attrs.nodeId, index);
  });
  const coveredBefore = (node: PMNode, r: number, c: number) => {
    const index = before0.get(node.attrs.nodeId);
    if (index === undefined) return false;
    const cell = g0.cells[index]!;
    return (
      cell.row <= r && r < cell.row + cell.rowsIn && cell.left <= c && c < cell.left + cell.colspan
    );
  };
  const meetsT = (cell: GridCell) =>
    cell.row < rect.bottom &&
    cell.row + cell.rowsIn > rect.top &&
    cell.left < rect.right &&
    cell.left + cell.colspan > rect.left;
  /** The kinds of the cells over (r, c) before that cross T: the paste splits each of them. */
  const crossingKinds = (r: number, c: number) => {
    const kinds = new Set<string>();
    for (const cell of g0.cells) {
      const over =
        cell.row <= r &&
        r < cell.row + cell.rowsIn &&
        cell.left <= c &&
        c < cell.left + cell.colspan;
      if (over && meetsT(cell)) kinds.add(cell.kind);
    }
    return kinds;
  };
  for (let r0 = 0; r0 < g0.height; r0 += 1) {
    const r1 = rowsAfter.get(before.child(g0.rowChild[r0]!).attrs.nodeId as string);
    if (r1 === undefined) continue;
    for (let c = 0; c < g0.width; c += 1) {
      const o0 = g0.owner(r0, c);
      if (o0 < 0) continue;
      const n0 = gridCellNode(before, g0, o0);
      const o1 = g1.owner(r1, c);
      if (inside(r0, c)) {
        if (pasted) continue;
        if (o1 < 0) return `the block's position (${r0}, ${c}) is a hole`;
        const n1 = gridCellNode(after, g1, o1);
        if (n1.attrs.nodeId !== n0.attrs.nodeId || n1.type !== n0.type || n1.content.size > 0) {
          return `the block's position (${r0}, ${c}) is not its cleared cell`;
        }
        continue;
      }
      if (o1 < 0) return `position (${r0}, ${c}) of "${n0.textContent}" is a hole`;
      const n1 = gridCellNode(after, g1, o1);
      const crossed = pasted !== null && meetsT(g0.cells[o0]!);
      // The split of a crossing cell (data-model §8.4 step 2) leaves an empty piece of its kind
      // at each of its other positions, but none where a later cell overlapped it: that cell
      // covers the position then, with its own kind and content (§4.5 `table.splitCell`,
      // FR-035) - or, when it crosses T too and is split in turn, an empty piece of its kind.
      if (crossed && n1.attrs.nodeId !== n0.attrs.nodeId && coveredBefore(n1, r0, c)) continue;
      if (crossed && n1.content.size === 0 && crossingKinds(r0, c).has(n1.type.name)) continue;
      if (n0.type !== n1.type) return `position (${r0}, ${c}) changed its kind`;
      if (!n0.content.eq(n1.content)) {
        return `position (${r0}, ${c}) of "${n0.textContent}" holds "${n1.textContent}"`;
      }
    }
  }
  if (pasted) {
    const gB = gridOfNode(pasted);
    // T's rows in the table after: B's rows less the rows of T the plan compacted (data-model
    // §8.4 step 5, decision 1) - only a row where B starts no cell can lose all its cells. The
    // oracle looks for a monotone mapping of B's rows onto the rows from `rect.top` on that drops
    // exactly that many rows, each one where B starts no cell.
    const lost = Math.max(g0.height, rect.top + gB.height) - g1.height;
    /**
     * Row i of B at row r after: each cell B starts in row i stands there - starting in row r -
     * with its kind and content at its column; a row where B starts no cell brings nothing, so
     * the cells starting there inside T are empty (B's holes filled).
     */
    const holds = (i: number, r: number): boolean => {
      if (r >= g1.height) return false;
      for (let ob = gB.rowStart[i]!; ob < gB.rowStart[i + 1]!; ob += 1) {
        const cell = gB.cells[ob]!;
        const o1 = g1.owner(r, rect.left + cell.left);
        if (o1 < 0 || g1.cells[o1]!.row !== r) return false;
        const nb = gridCellNode(pasted, gB, ob);
        const n1 = gridCellNode(after, g1, o1);
        if (nb.type !== n1.type || !nb.content.eq(n1.content)) return false;
      }
      if (gB.rowStart[i]! < gB.rowStart[i + 1]!) return true;
      for (let o1 = g1.rowStart[r]!; o1 < g1.rowStart[r + 1]!; o1 += 1) {
        const left = g1.cells[o1]!.left;
        if (left >= rect.left && left < rect.right) {
          if (gridCellNode(after, g1, o1).content.size > 0) return false;
        }
      }
      return true;
    };
    // The numbers of rows dropped so far for which B's rows up to i map.
    let dropped = new Set<number>([0]);
    for (let i = 0; i < gB.height; i += 1) {
      const next = new Set<number>();
      const startsNone = gB.rowStart[i] === gB.rowStart[i + 1];
      for (const k of dropped) {
        if (holds(i, rect.top + i - k)) next.add(k);
        if (startsNone && k < lost) next.add(k + 1);
      }
      if (next.size === 0) {
        return `T's row for row ${i} of the pasted block does not hold its cells`;
      }
      dropped = next;
    }
    if (!dropped.has(lost)) {
      return `the paste dropped ${lost} rows of T, not only rows where the block starts no cell`;
    }
  }
  return null;
}

/**
 * US5's oracle of *Merge cells* (FR-013, FR-014, FR-035; decision 1): positions outside the
 * extended rectangle keep their owner's content and kind; the keeper - the owner of the
 * rectangle's top-left position, else its first cell in reading order - keeps its node id, kind,
 * `id`, `style`, `lang`, `align` and `valign` and holds the parts' join in reading order (the
 * non-empty contents with one unmarked space between two of them; the character oracle of vR1
 * corr 16 counts merged cells); the rectangle's other cells are gone, every other cell keeps its
 * text and a new cell (a hole fill) is empty; the keeper covers the rectangle's width and its
 * height less the compacted rows; and the rectangle's rows other than its top one that held only
 * its cells are compacted, the others kept (rows map by node id).
 */
function checkMergeStep(before: PMNode, after: PMNode, address: TableAddress): string | null {
  const g0 = gridOfNode(before);
  const g1 = gridOfNode(after);
  if (g0.tooLarge || g1.tooLarge || !address.rect) return null;
  const rect = g0.extend(address.rect);
  const cells = g0.cellsIn(rect);
  const owner = g0.owner(rect.top, rect.left);
  const keeperIndex = owner >= 0 ? owner : cells[0]!;
  const keeper = gridCellNode(before, g0, keeperIndex);
  const inside = (r: number, c: number) =>
    r >= rect.top && r < rect.bottom && c >= rect.left && c < rect.right;
  const locality = checkLocality(before, after, { given: inside, column: (c) => c });
  if (locality) return locality;
  const old = cellsById(before);
  const next = cellsById(after);
  const merged = next.get(keeper.attrs.nodeId as string);
  if (!merged) return 'the keeper is gone';
  if (merged.type !== keeper.type) return 'the keeper changed its kind';
  for (const name of ['id', 'style', 'lang', 'align', 'valign']) {
    if ((merged.attrs[name] ?? null) !== (keeper.attrs[name] ?? null)) {
      return `the keeper lost its ${name}`;
    }
  }
  const joined: PMNode[] = [];
  const blockIds = new Set<string>();
  for (const index of [keeperIndex, ...cells.filter((index) => index !== keeperIndex)]) {
    const node = gridCellNode(before, g0, index);
    blockIds.add(node.attrs.nodeId as string);
    if (node.content.size === 0) continue;
    if (joined.length > 0) joined.push(before.type.schema.text(' '));
    node.content.forEach((child) => {
      joined.push(child);
    });
  }
  if (!merged.content.eq(Fragment.from(joined))) {
    return `the merged cell holds "${merged.textContent}", not the parts' join`;
  }
  for (const [id, cell] of old) {
    const kept = next.get(id);
    if (blockIds.has(id)) {
      if (kept && id !== keeper.attrs.nodeId) return `the block's cell ${id} is still there`;
      continue;
    }
    if (!kept) return `the cell "${cell.textContent}" (${id}) outside the block was removed`;
    if (kept.textContent !== cell.textContent) {
      return `the cell ${id} holds "${kept.textContent}" instead of "${cell.textContent}"`;
    }
  }
  for (const [id, cell] of next) {
    if (!old.has(id) && cell.content.size > 0) return `the new cell ${id} holds content`;
  }
  const rowsAfter = new Set<unknown>();
  after.forEach((child) => {
    rowsAfter.add(child.attrs.nodeId);
  });
  let compacted = 0;
  for (let r = rect.top; r < rect.bottom; r += 1) {
    const id = before.child(g0.rowChild[r]!).attrs.nodeId;
    let own = 0;
    let onlyBlock = true;
    for (let index = g0.rowStart[r]!; index < g0.rowStart[r + 1]!; index += 1) {
      own += 1;
      if (!cells.includes(index)) onlyBlock = false;
    }
    const goes = r > rect.top && own > 0 && onlyBlock;
    if (goes) compacted += 1;
    if (rowsAfter.has(id) === goes) {
      return `row ${r} of the block was ${goes ? 'kept' : 'removed'}`;
    }
  }
  const at = g1.cells.findIndex(
    (_cell, index) => gridCellNode(after, g1, index).attrs.nodeId === keeper.attrs.nodeId,
  );
  const cell = g1.cells[at]!;
  if (
    cell.colspan !== rect.right - rect.left ||
    cell.rowsIn !== rect.bottom - rect.top - compacted
  ) {
    return `the merged cell covers ${cell.rowsIn} × ${cell.colspan}, not the block`;
  }
  return null;
}

/**
 * US5's oracle of *Split cell* (FR-016, FR-035): every position keeps its owner's content and
 * kind except the split cell's own other positions; the cell keeps its node id, content, kind and
 * every attribute but its spans, which it no longer writes; each of its other positions is owned
 * by a new empty cell of its kind, or by a later cell that overlapped the cell there (an
 * irregular table's overlap) - no row is added or removed.
 */
function checkSplitStep(before: PMNode, after: PMNode, address: TableAddress): string | null {
  const g0 = gridOfNode(before);
  const g1 = gridOfNode(after);
  if (g0.tooLarge || g1.tooLarge || !address.caret) return null;
  const index = g0.owner(address.caret.row, address.caret.col);
  if (index < 0) return 'the caret stands in no cell';
  const cell = g0.cells[index]!;
  const node = gridCellNode(before, g0, index);
  const own = (r: number, c: number) =>
    g0.owner(r, c) === index && !(r === cell.row && c === cell.left);
  const locality = checkLocality(before, after, { given: own, column: (c) => c });
  if (locality) return locality;
  if (after.childCount !== before.childCount) return 'a split added or removed a row';
  const old = cellsById(before);
  const kept = cellsById(after).get(node.attrs.nodeId as string);
  if (!kept || kept.type !== node.type || !kept.content.eq(node.content)) {
    return 'the split cell lost its kind or content';
  }
  if (kept.attrs.colspan !== null || kept.attrs.rowspan !== null) {
    return 'the split cell still writes a span';
  }
  for (const name of ['id', 'style', 'lang', 'align', 'valign']) {
    if ((kept.attrs[name] ?? null) !== (node.attrs[name] ?? null)) {
      return `the split cell lost its ${name}`;
    }
  }
  for (let r = cell.row; r < cell.row + cell.rowsIn; r += 1) {
    for (let c = cell.left; c < cell.left + cell.colspan; c += 1) {
      if (!own(r, c)) continue;
      const o1 = g1.owner(r, c);
      if (o1 < 0) return `the split cell's position (${r}, ${c}) is a hole`;
      const piece = gridCellNode(after, g1, o1);
      const id = piece.attrs.nodeId as string;
      if (!old.has(id)) {
        if (piece.content.size > 0 || piece.type !== node.type) {
          return `the new cell at (${r}, ${c}) is not an empty cell of the split cell's kind`;
        }
        continue;
      }
      const index0 = g0.cells.findIndex(
        (_cell, at) => gridCellNode(before, g0, at).attrs.nodeId === id,
      );
      const other = g0.cells[index0];
      const covered =
        other !== undefined &&
        index0 > index &&
        other.row <= r &&
        r < other.row + other.rowsIn &&
        other.left <= c &&
        c < other.left + other.colspan;
      if (!covered) return `the split cell's position (${r}, ${c}) went to the cell ${id}`;
    }
  }
  return null;
}

/**
 * US6's kind-only oracle (FR-019, FR-035): the table keeps every child in its place - each row
 * with its attributes and its children, every non-row and non-cell child unchanged - and every
 * cell its node id and every attribute and its content, so every position keeps its owner (no
 * shift); the cells outside `targets` keep their kind, and the targets have the kind the
 * command gives them.
 */
function checkKindStep(before: PMNode, after: PMNode, targets: KindTargets): string | null {
  if (after.childCount !== before.childCount) return 'a header command added or removed a child';
  const isCell = (node: PMNode) => node.type.name === 'td' || node.type.name === 'th';
  const sameAttrs = (a: PMNode, b: PMNode) => JSON.stringify(a.attrs) === JSON.stringify(b.attrs);
  for (let index = 0; index < before.childCount; index += 1) {
    const was = before.child(index);
    const is = after.child(index);
    if (was.type.name !== 'tr') {
      if (!is.eq(was)) return `the table's child ${index}, not a row, changed`;
      continue;
    }
    if (is.type !== was.type || !sameAttrs(is, was) || is.childCount !== was.childCount) {
      return `the row ${String(was.attrs.nodeId)} changed beyond the kinds of its cells`;
    }
    for (let at = 0; at < was.childCount; at += 1) {
      const cell = was.child(at);
      const now = is.child(at);
      const id = String(cell.attrs.nodeId);
      if (!isCell(cell)) {
        if (!now.eq(cell)) return `a child of the row ${String(was.attrs.nodeId)} changed`;
        continue;
      }
      if (!isCell(now)) return `the cell ${id} is no longer a cell`;
      if (!sameAttrs(now, cell)) return `the cell ${id} changed an attribute`;
      if (!now.content.eq(cell.content))
        return `the cell "${cell.textContent}" changed its content`;
    }
  }
  const g0 = gridOfNode(before);
  const g1 = gridOfNode(after);
  if (JSON.stringify(g1.summary) !== JSON.stringify(g0.summary)) return 'the grid summary changed';
  if (!g0.tooLarge && !g1.tooLarge) {
    for (let r = 0; r < g0.height; r += 1) {
      for (let c = 0; c < g0.width; c += 1) {
        const o0 = g0.owner(r, c);
        const o1 = g1.owner(r, c);
        const id0 = o0 < 0 ? null : gridCellNode(before, g0, o0).attrs.nodeId;
        const id1 = o1 < 0 ? null : gridCellNode(after, g1, o1).attrs.nodeId;
        if (id0 !== id1) return `position (${r}, ${c}) changed its owner`;
      }
    }
  }
  const allHeaders = [...targets.cells].every((index) => g0.cells[index]!.kind === 'th');
  const wantedFor = (was: 'td' | 'th'): 'td' | 'th' => {
    if (targets.kind === 'flip') return was === 'th' ? 'td' : 'th';
    if (targets.kind === 'toggle') return allHeaders ? 'td' : 'th';
    return targets.kind;
  };
  for (let index = 0; index < g0.cells.length; index += 1) {
    const was = g0.cells[index]!.kind;
    const is = g1.cells[index]!.kind;
    const id = String(gridCellNode(before, g0, index).attrs.nodeId);
    if (!targets.cells.has(index)) {
      if (is !== was) return `the cell ${id}, not one of the command's, changed its kind`;
      continue;
    }
    if (is !== wantedFor(was)) return `the cell ${id} is a ${is}, not a ${wantedFor(was)}`;
  }
  return null;
}

/** The first FB2 id that occurs twice in `doc`, or null (FR-046: ids are unique in the book). */
function duplicateId(doc: PMNode): string | null {
  const seen = new Set<string>();
  let twice: string | null = null;
  doc.descendants((node) => {
    if (twice !== null) return false;
    const id = node.isText ? null : node.attrs.id;
    if (typeof id === 'string' && id !== '') {
      if (seen.has(id)) twice = id;
      else seen.add(id);
    }
    return true;
  });
  return twice;
}

/**
 * US7's attribute oracle (FR-021, FR-035; data-model §4.7): the table keeps every child in its
 * place - every non-row and non-cell child unchanged, every row its node id and its cells -, and
 * every cell its kind, node id, content and spans, so every position keeps its owner; only the
 * step's attribute changes and only on its targets: every cell of the block or the caret's cell
 * (`cells`), the head cell (`head`), the rows of the block or the caret cell's row (`rows`), the
 * table (`table`) - a language may also drop the shadowed `xml:lang` of `extraAttrs`, never kept
 * beside it -; and each target holds the drawn value, trimmed, or none for an empty one.
 */
function checkAttrStep(
  before: PMNode,
  after: PMNode,
  attr: FuzzAttr,
  value: string,
  address: TableAddress,
): string | null {
  const g0 = gridOfNode(before);
  const wanted = value.trim() === '' ? null : value.trim();
  const cells = new Set<string>();
  const rows = new Set<number>();
  const addCell = (index: number) => {
    if (index < 0) return;
    const cell = g0.cells[index]!;
    cells.add(`${g0.rowChild[cell.row]!}:${cell.index}`);
  };
  if (attr.scope === 'cells') {
    if (address.rect) for (const index of g0.cellsIn(address.rect)) addCell(index);
    else addCell(cellStartingAt(address, address.caret));
  } else if (attr.scope === 'head') {
    addCell(cellStartingAt(address, address.head ?? address.caret));
  } else if (attr.scope === 'rows') {
    const from = address.rect?.top ?? address.caret?.row ?? 0;
    const to = address.rect?.bottom ?? (address.caret ? address.caret.row + 1 : 0);
    for (let r = from; r < to && r < g0.height; r += 1) rows.add(g0.rowChild[r]!);
  }
  /** The first attribute other than `allowed` whose value differs, or null. */
  const changedKey = (was: PMNode, is: PMNode, allowed: readonly string[]) => {
    for (const key of new Set([...Object.keys(was.attrs), ...Object.keys(is.attrs)])) {
      if (allowed.includes(key)) continue;
      if (JSON.stringify(was.attrs[key] ?? null) !== JSON.stringify(is.attrs[key] ?? null)) {
        return key;
      }
    }
    return null;
  };
  const holds = (node: PMNode) => {
    if ((node.attrs[attr.name] ?? null) !== wanted) return false;
    if (attr.name !== 'lang') return true;
    const unknown = (node.attrs.extraAttrs as { unknownAttrs?: Record<string, unknown> } | null)
      ?.unknownAttrs;
    return !unknown || !('{http://www.w3.org/XML/1998/namespace}lang' in unknown);
  };
  const tableKey = changedKey(before, after, attr.scope === 'table' ? [attr.name] : []);
  if (tableKey) return `the table's ${tableKey} changed`;
  if (attr.scope === 'table' && !holds(after)) return `the table's ${attr.name} is not the value`;
  if (after.childCount !== before.childCount) return 'an attribute step added or removed a child';
  const isCell = (node: PMNode) => node.type.name === 'td' || node.type.name === 'th';
  const cellNames = attr.name === 'lang' ? ['lang', 'extraAttrs'] : [attr.name];
  for (let index = 0; index < before.childCount; index += 1) {
    const was = before.child(index);
    const is = after.child(index);
    if (was.type.name !== 'tr') {
      if (!is.eq(was)) return `the table's child ${index}, not a row, changed`;
      continue;
    }
    const rowId = String(was.attrs.nodeId);
    if (is.type !== was.type || is.childCount !== was.childCount) {
      return `the row ${rowId} changed beyond its attributes`;
    }
    const rowKey = changedKey(was, is, rows.has(index) ? ['align'] : []);
    if (rowKey) return `the row ${rowId} changed its ${rowKey}`;
    let hasCell = false;
    for (let at = 0; at < was.childCount; at += 1) {
      const cell = was.child(at);
      const now = is.child(at);
      if (!isCell(cell)) {
        if (!now.eq(cell)) return `a child of the row ${rowId} changed`;
        continue;
      }
      hasCell = true;
      const id = String(cell.attrs.nodeId);
      if (now.type !== cell.type) return `the cell ${id} changed its kind`;
      if (!now.content.eq(cell.content))
        return `the cell "${cell.textContent}" changed its content`;
      const target = cells.has(`${index}:${at}`);
      const key = changedKey(cell, now, target ? cellNames : []);
      if (key) return `the cell ${id} changed its ${key}`;
      if (target && !holds(now)) return `the cell ${id} does not hold the ${attr.name} drawn`;
    }
    if (rows.has(index) && hasCell && !holds(is)) return `the row ${rowId} does not hold the align`;
  }
  const summary = (node: PMNode) => ({ ...gridOfNode(node).summary, id: undefined });
  if (JSON.stringify(summary(after)) !== JSON.stringify(summary(before))) {
    return 'the grid summary changed';
  }
  return null;
}

/** Every row of the table holds a cell: only an invalid book has a row without one. */
function rowsHoldCells(table: PMNode): boolean {
  let holds = true;
  table.forEach((row) => {
    if (row.type.name !== 'tr') return;
    let cell = false;
    row.forEach((child) => {
      if (child.type.name === 'td' || child.type.name === 'th') cell = true;
    });
    if (!cell) holds = false;
  });
  return holds;
}

/**
 * The oracle of one command step (data-model §16.4): the availability agrees with the dry
 * run; a refused step (or a plan that changes nothing) changes nothing and adds no history
 * event - an attribute step's value refused exactly when it must be (US7) -, while an insertion
 * or duplication that is not refused always acts on a table whose every row holds a cell
 * (`grows`; FR-037, FR-046), and a move that is not refused always acts (`moves`; FR-037,
 * FR-043); a step that acts gives a valid document and table (`check()`, `assertTableValid`),
 * no FB2 id twice in the document, a regular table stays regular (FR-046), the positions
 * outside its lines keep their owners (FR-035) and no character is lost or invented. Null when
 * every check holds, else the reason.
 */
export function checkFuzzStep(record: FuzzStepRecord): string | null {
  const {
    entry,
    before,
    after,
    tablePos,
    address,
    dryRun,
    answer,
    ran,
    clipboard,
    attrValue,
    spanValue,
  } = record;
  if (answer && !sameAvailability(answer, dryRun)) {
    return `availability ${JSON.stringify(answer)} disagrees with the plan's ${
      isRefusal(dryRun) ? JSON.stringify(dryRun) : 'edit'
    }`;
  }
  if (attrValue) {
    const refused = isRefusal(dryRun) ? dryRun.refused : null;
    if ((attrValue.refusal ?? null) !== refused) {
      return attrValue.refusal
        ? `${JSON.stringify(attrValue.value)} was not refused with ${attrValue.refusal} (${refused ?? 'an edit'})`
        : `${JSON.stringify(attrValue.value)} was refused with ${refused}`;
    }
  }
  let acts = !isRefusal(dryRun);
  if (acts) acts = commitTableEdit(before.tr, tablePos, dryRun as TableEdit) !== null;
  if (!acts) {
    if (!isRefusal(dryRun) && (entry.moves || (entry.grows && rowsHoldCells(address.table)))) {
      return 'the command is available but its plan changes nothing';
    }
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
  const edit = dryRun as TableEdit;
  try {
    assertTableValid(table, next, edit.allowedIds, edit.pastedIrregular);
  } catch (error) {
    return String(error instanceof Error ? error.message : error);
  }
  // A paste of a block copied from an irregular table brings its irregularity (decision 4).
  if (gridOfNode(table).regular && !gridOfNode(next).regular && !edit.pastedIrregular) {
    return 'a regular table became irregular';
  }
  const twice = duplicateId(after.doc);
  if (twice !== null) return `the FB2 id ${twice} occurs twice in the document`;
  if (entry.attr && attrValue) {
    return checkAttrStep(table, next, entry.attr, attrValue.value, address);
  }
  if (entry.repairs) return checkRepairStep(table, next);
  if (entry.span) return checkSpanStep(table, next, address, entry.span, spanValue ?? 1);
  if (entry.merges) return checkMergeStep(table, next, address);
  if (entry.splits) {
    return checkSplitStep(table, next, address) ?? checkCharacters(table, next, entry);
  }
  if (entry.kinds) {
    const targets = entry.kinds(address);
    if (!targets) return 'a header command acted without a cell to act on';
    return checkKindStep(table, next, targets);
  }
  if (entry.clears || entry.pastes) {
    let rect = address.rect;
    if (entry.pastes && clipboard) {
      const gB = gridOfNode(
        normalisePastedBlock(clipboard, { keepRows: true }, { nextId: () => '' }),
      );
      const top = address.rect?.top ?? address.caret?.row ?? 0;
      const left = address.rect?.left ?? address.caret?.col ?? 0;
      rect = { top, left, bottom: top + gB.height, right: left + gB.width };
    }
    if (rect) {
      const locality = checkBlockLocality(
        table,
        next,
        rect,
        entry.pastes ? (clipboard ?? null) : null,
      );
      if (locality) return locality;
    }
    return checkCharacters(table, next, entry, clipboard ?? null);
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

/** A random block of two different cells of the table, or null for a table of one cell. */
function randomBlock(rng: () => number, doc: PMNode, tablePos: number): CellBlockSelection | null {
  const table = doc.nodeAt(tablePos)!;
  const grid = gridOfNode(table);
  const count = grid.cells.length;
  if (count < 2 || grid.tooLarge) return null;
  const anchor = below(rng, count);
  let head = below(rng, count - 1);
  if (head >= anchor) head += 1;
  return CellBlockSelection.create(
    doc,
    gridCellPos(table, tablePos, grid, anchor),
    gridCellPos(table, tablePos, grid, head),
  );
}

/**
 * A caret for *Split cell* (US5): in half of the draws at a random offset of a random merged
 * cell - one that owns a second position (`checkSplit`) - when the table has one; otherwise at a
 * random offset of a random cell.
 */
function splitCaret(rng: () => number, doc: PMNode, tablePos: number): Selection {
  const table = doc.nodeAt(tablePos)!;
  const grid = gridOfNode(table);
  let index = -1;
  if (rng() < 0.5 && !grid.tooLarge) {
    const merged: number[] = [];
    grid.cells.forEach((cell, at) => {
      const answer = checkSplit({ table, grid, caret: { row: cell.row, col: cell.left } });
      if (!isRefusal(answer)) merged.push(at);
    });
    if (merged.length > 0) index = pick(rng, merged);
  }
  if (index < 0) index = below(rng, grid.cells.length);
  const cellPos = gridCellPos(table, tablePos, grid, index);
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
  const clipboard: FuzzClipboard = { table: null };
  // The fresh ids of the id edits (US7): `fz<n>`, counted over the run.
  let freshIds = 0;
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
            : entry.caret === 'block'
              ? (randomBlock(rng, start.doc, current.pos) ??
                randomSelection(rng, start.doc, current.pos))
              : entry.caret === 'merged'
                ? splitCaret(rng, start.doc, current.pos)
                : randomSelection(rng, start.doc, current.pos),
        );
        const before = host.state();
        selection = describeSelection(before.selection);
        const target = tableTarget(before);
        if (!target || target.tablePos !== current.pos) {
          reason = 'the selection does not address the table';
        } else {
          const ctx = { nextId: () => host.nextId(), bookIds: host.bookIds() };
          if (entry.whole) {
            const whole = runWholeStep(host, rng, entry.whole, before, current.pos, ctx);
            reason = whole.reason;
            const after = host.state();
            if (!reason && !after.doc.eq(before.doc)) {
              done.push({ before: before.doc, after: after.doc });
              undone = [];
            }
            // A deleted table: a new start table comes with the next step.
            if (!reason && whole.deleted) tableId = null;
          } else {
            if (entry.clears === 'cut' && before.selection instanceof CellBlockSelection) {
              clipboard.table = before.selection.content().content.firstChild;
            }
            if (entry.pastes && (!clipboard.table || rng() < 0.5)) {
              // A copy of a drawn block, or of the whole current table.
              const block = randomBlock(rng, before.doc, current.pos);
              clipboard.table =
                block && rng() < 0.7 ? block.content().content.firstChild : current.node;
            }
            const pasted = entry.pastes ? clipboard.table : null;
            // US7: the attribute step's value, drawn with the run's generator.
            const attrValue = entry.attr
              ? entry.attr.draw(rng, {
                  address: target.address,
                  bookIds: ctx.bookIds,
                  fresh: () => {
                    let id: string;
                    do {
                      freshIds += 1;
                      id = `fz${freshIds}`;
                    } while (ctx.bookIds.has(id));
                    return id;
                  },
                })
              : undefined;
            // US8: the span step's value, drawn with the run's generator.
            const span = entry.span;
            const spanValue = span ? drawSpan(rng, target.address, span) : undefined;
            const plan: TablePlan = entry.pastes
              ? (address, c) => pasteBlockPlan(address, dedupeIds(pasted!, ctx.bookIds), c)
              : entry.attr
                ? attrPlan(entry.attr, attrValue!.value)
                : span
                  ? (address, c) => planSpan(address, { axis: span, value: spanValue! }, c)
                  : entry.plan!;
            const dryRun = plan(target.address, ctx);
            const answer = entry.command ? availability(before, entry.command) : null;
            const ran = host.run(
              entry.pastes
                ? (state, dispatch) => {
                    const tr = pasteTransaction(
                      state,
                      { kind: 'own', slice: new Slice(Fragment.from(pasted!), 0, 0) },
                      { bookIds: () => ctx.bookIds, nextNodeId: ctx.nextId, message: () => {} },
                    );
                    if (!tr || !tr.docChanged) return false;
                    dispatch?.(tr);
                    return true;
                  }
                : planCommand(plan, ctx),
            );
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
              clipboard: pasted,
              attrValue,
              spanValue,
            });
            if (reason && attrValue) reason += ` (the value ${JSON.stringify(attrValue.value)})`;
            if (reason && spanValue !== undefined) reason += ` (the value ${spanValue})`;
            if (!reason && !after.doc.eq(before.doc)) {
              done.push({ before: before.doc, after: after.doc });
              undone = [];
            }
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
