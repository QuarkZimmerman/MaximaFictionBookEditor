/**
 * The assistant's table tools (feature 006, US11; contracts/ai-catalogue.md §3.9, Δ§1.1, Δ§1.2,
 * Δ§3.5, Δ§3.7; data-model §15.1, §15.2; research R7.1 to R7.5; FR-049 to FR-052): `read_table`
 * gives a table as a grid of rows and columns numbered from 1, a large table in parts of whole
 * rows; `edit_table` runs the user's own table plans by grid position. Part of the lazy
 * `ai-assistant` chunk; the table engine comes from the main bundle (the allowed direction).
 *
 * The module and `catalogue.ts` import each other: everything of `catalogue.ts` is used inside
 * the functions only, which run once both modules are evaluated.
 */

import type { McpServer } from '@modelcontextprotocol/server';
import type { Node as PMNode } from 'prosemirror-model';
import { z } from 'zod';

import { nodeFromModel, type ModelNodeJson } from '@/editor/fromModel';
import { planCellAttrs, planRowAlign, planSpan, planTableAttrs } from '@/editor/table/attrs';
import {
  applyTableEdit,
  gridCellNode,
  isRefusal,
  type PlanContext,
  type Refusal,
  type TableAddress,
  type TableEdit,
} from '@/editor/table/edit';
import { gridOfModel, gridOfNode, type GridCell, type TableGrid } from '@/editor/table/grid';
import {
  lineOwners,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
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
} from '@/editor/table/ops';
import { attrsToModel, nodeToModel } from '@/editor/toModel';
import type { InlineNode, TableNode } from '@/model/document';
import { collectBookIds, countLinksTo } from '@/model/ids';

import {
  cursorArg,
  defineTool,
  formatArg,
  nodeInfoSchema,
  ToolError,
  type AnyObject,
  type ToolContext,
} from '../catalogue';
import { decodeCursor, moreOf, partition } from '../split';
import { englishTableProblems } from '../tables';

import { characterCount, inlineText, nodeIdOf, nodeInfo, pathOf, type Entry } from './model';
import { writeAt } from './write';

/* ------------------------------------------------------------------------ */
/* Shared                                                                   */
/* ------------------------------------------------------------------------ */

/** The hint of a reference that is no table, row or cell (ai-catalogue §3.9 "Conventions"). */
export const TABLE_REFERENCE_HINT =
  'pass a table, or a row or cell of it; read_part lists cells with their ids';

/** The fixed cost of a part's envelope against the budget (as `read_part`'s). */
const PART_ENVELOPE_UNITS = 240;

/** The schema attributes `read_table` shows, by node (§3.9 "Attributes"). */
const TABLE_ATTRS = ['id', 'style'] as const;
const ROW_ATTRS = ['align'] as const;
const CELL_ATTRS = ['id', 'style', 'align', 'valign', 'lang'] as const;

/** The description of `read_table`, verbatim (ai-catalogue §3.9; 994 characters). */
const READ_TABLE_DESCRIPTION =
  'Returns one table as a grid of rows and columns with merged cells resolved. table: the table\'s id or path, or the id of any row or cell in it. For every grid row: its id, attributes and grid - the id of the cell that covers each column, null where no cell does - and its cells: each cell whose top-left position is in that row, with id, kind (th header cell, td normal cell), row and column of its top-left position, colspan and rowspan (when above 1), attributes and content (format "text", the default, or "fb2xml" for FictionBook inline XML). above lists the cells that start in an earlier row and reach into the rows read. Rows and columns are numbered from 1, as edit_table takes them. regular false means rows of different widths, overlapping cells or spans past the last row; problems names them. fromRow / toRow read those rows only: for a large table, read the rows you need. A table too large for one answer comes in parts of whole rows: pass more.cursor back with the same arguments.';

/** The description of `edit_table`, verbatim (ai-catalogue §3.9; 991 characters). */
const EDIT_TABLE_DESCRIPTION =
  'Changes one table with the editor\'s own table commands, addressed by grid position: rows and columns numbered from 1 as read_table shows them; a merged cell is reached through any position it covers. One call is one change, checked against the FB2 schema; an "error" answer means nothing changed. op: insertRows / insertColumns (row or column, where before|after, count), deleteRows / deleteColumns, moveRows (direction up|down) / moveColumns (left|right), duplicateRows / duplicateColumns (the copy goes below / to the right), merge (a block of cells), split (a merged cell), setKind (kind th|td), setAttributes (attrs of the cells, the rows or the table, see of; "" removes one), repair (an irregular table). rows / columns: how many rows or columns are addressed (default 1); row without column means whole rows, column without row whole columns. Inserted cells are empty: fill them with set_text, using the ids in newCells. confirmationRequired: tell the user, who decides in the editor.';

/** The table a reference names: the table itself, or the table of a row or a cell. */
export function tableEntry(ctx: ToolContext, reference: string): Entry {
  const entry = ctx.resolve(reference, 'table');
  let current: Entry | null = entry;
  if (current.node.type === 'td' || current.node.type === 'th') current = current.parent;
  if (current && current.node.type === 'tr') current = current.parent;
  if (!current || current.node.type !== 'table') {
    throw new ToolError(
      'invalidArguments',
      `${reference} is a "${entry.node.type}", not a table, a row or a cell of one.`,
      { hint: TABLE_REFERENCE_HINT },
    );
  }
  return current;
}

/** The node's attributes of `names` that are non-empty strings, or undefined for none. */
function shownAttrs(
  node: ModelNodeJson,
  names: readonly string[],
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const name of names) {
    const value = node.attrs?.[name];
    if (typeof value === 'string' && value !== '') out[name] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The row node of grid row r and the cell node of grid cell `index`. */
function rowNode(table: ModelNodeJson, grid: TableGrid, r: number): ModelNodeJson {
  return table.content![grid.rowChild[r]!]!;
}

function cellNode(table: ModelNodeJson, grid: TableGrid, index: number): ModelNodeJson {
  const cell = grid.cells[index]!;
  return rowNode(table, grid, cell.row).content![cell.index]!;
}

/* ------------------------------------------------------------------------ */
/* read_table (§3.9, Δ§3.7)                                                  */
/* ------------------------------------------------------------------------ */

interface CellView {
  id: string;
  kind: 'td' | 'th';
  row: number;
  column: number;
  colspan?: number;
  rowspan?: number;
  attrs?: Record<string, string>;
  overlaps?: true;
  pastEnd?: true;
  text?: string;
  xml?: string;
}

/** A cell as `read_table` gives it: its top-left position from 1, spans above 1, its content. */
function cellView(
  table: ModelNodeJson,
  grid: TableGrid,
  index: number,
  format: 'text' | 'fb2xml',
): CellView {
  const cell: GridCell = grid.cells[index]!;
  const node = cellNode(table, grid, index);
  const view: CellView = {
    id: nodeIdOf(node),
    kind: cell.kind,
    row: cell.row + 1,
    column: cell.left + 1,
  };
  if (cell.colspan > 1) view.colspan = cell.colspan;
  if (cell.rowspan > 1) view.rowspan = cell.rowspan;
  const attrs = shownAttrs(node, CELL_ATTRS);
  if (attrs) view.attrs = attrs;
  if (cell.overlaps) view.overlaps = true;
  if (cell.pastEnd) view.pastEnd = true;
  if (format === 'text') view.text = inlineText((node.content ?? []) as InlineNode[]);
  return view;
}

/**
 * The ids of the cells covering each column of grid row r (`null` for a hole): built from the
 * cells' column intervals in reading order, a position two cells cover keeping the earlier one
 * - never through `owner()`, which a table too large for the owner map does not have.
 */
function rowGrid(table: ModelNodeJson, grid: TableGrid, r: number): (string | null)[] {
  const out = new Array<string | null>(grid.width).fill(null);
  for (let index = 0; index < grid.rowStart[r + 1]!; index += 1) {
    const cell = grid.cells[index]!;
    if (cell.row + cell.rowsIn <= r) continue;
    const id = nodeIdOf(cellNode(table, grid, index));
    for (let c = cell.left; c < Math.min(cell.left + cell.colspan, grid.width); c += 1) {
      if (out[c] === null) out[c] = id;
    }
  }
  return out;
}

/** Fills `xml` of the views: one `fragmentToXml` per non-empty cell, all issued together. */
async function withXml(
  ctx: ToolContext,
  table: ModelNodeJson,
  grid: TableGrid,
  views: { view: CellView; index: number }[],
): Promise<void> {
  await Promise.all(
    views.map(async ({ view, index }) => {
      view.xml = await ctx.xmlOf(cellNode(table, grid, index).content ?? []);
    }),
  );
}

/** `read_table` (ai-catalogue §3.9, Δ§3.7; data-model §15.1). */
async function readTable(
  ctx: ToolContext,
  args: {
    table: string;
    format: 'text' | 'fb2xml';
    fromRow?: number;
    toRow?: number;
    cursor?: string;
  },
): Promise<AnyObject> {
  const entry = tableEntry(ctx, args.table);
  const table = entry.node;
  const grid = gridOfModel(table as unknown as TableNode);
  const height = grid.height;
  const expected = { rowCount: height, columnCount: grid.width };
  const from = args.fromRow ?? 1;
  const requestedTo = args.toRow ?? height;
  if (from < 1 || from > height || requestedTo < from) {
    throw new ToolError(
      'invalidArguments',
      `the rows ${from} to ${requestedTo} are not a window of the table's rows 1 to ${height}: fromRow must lie in 1 to ${height} and toRow must not lie below fromRow`,
      { expected },
    );
  }
  const to = Math.min(requestedTo, height);
  let start = from - 1;
  if (args.cursor) {
    const cursor = decodeCursor(args.cursor);
    let at = -1;
    if (cursor?.kind === 'after') {
      for (let r = from - 1; r < to; r += 1) {
        if (nodeIdOf(rowNode(table, grid, r)) === cursor.nodeId) at = r;
      }
    }
    if (at < 0) {
      throw new ToolError('invalidArguments', `unknown cursor "${args.cursor}"`, {
        hint: 'Pass more.cursor of the previous part unchanged, with the same arguments.',
      });
    }
    start = at + 1;
  }
  const units: number[] = [];
  for (let r = start; r < to; r += 1) units.push(r);
  const built = new Map<number, { row: AnyObject; cells: { view: CellView; index: number }[] }>();
  const rowOf = (r: number) => {
    let found = built.get(r);
    if (!found) {
      const node = rowNode(table, grid, r);
      const cells: { view: CellView; index: number }[] = [];
      for (let index = grid.rowStart[r]!; index < grid.rowStart[r + 1]!; index += 1) {
        cells.push({ view: cellView(table, grid, index, args.format), index });
      }
      const attrs = shownAttrs(node, ROW_ATTRS);
      found = {
        row: {
          row: r + 1,
          id: nodeIdOf(node),
          ...(attrs ? { attrs } : {}),
          grid: rowGrid(table, grid, r),
          cells: cells.map((cell) => cell.view),
        },
        cells,
      };
      built.set(r, found);
    }
    return found;
  };
  const { taken, rest } = partition(units, {
    // A row's size: its object with its cells' content (the XML's size is unknown before the
    // round trip; the text stands in for it).
    sizeOf: (r) => {
      const { row, cells } = rowOf(r);
      const xml =
        args.format === 'fb2xml'
          ? cells.reduce(
              (sum, cell) => sum + characterCount(cellNode(table, grid, cell.index)) * 2,
              0,
            )
          : 0;
      return JSON.stringify(row).length + xml;
    },
    limit: ctx.budget(),
    fixed: PART_ENVELOPE_UNITS,
    strict: true,
  });
  if (taken.length === 0 && units.length > 0) {
    const node = rowNode(table, grid, units[0]!);
    const rowEntry = ctx.entryOf(nodeIdOf(node));
    const info = rowEntry
      ? nodeInfo(rowEntry)
      : { id: nodeIdOf(node), path: `${pathOf(entry)}/tr[${units[0]! + 1}]`, type: 'tr' };
    throw new ToolError(
      'tooLarge',
      `The row ${info.path} alone is larger than one answer admits.`,
      { node: info, characters: characterCount(node), hint: 'read its cells with read_part' },
    );
  }
  const rows = taken.map((r) => rowOf(r));
  const first = taken[0] ?? start;
  const above: { view: CellView; index: number }[] = [];
  for (let index = 0; index < (grid.rowStart[first] ?? 0); index += 1) {
    const cell = grid.cells[index]!;
    if (cell.row + cell.rowsIn > first) {
      above.push({ view: cellView(table, grid, index, args.format), index });
    }
  }
  if (args.format === 'fb2xml') {
    await withXml(ctx, table, grid, [...rows.flatMap((row) => row.cells), ...above]);
  }
  const attrs = shownAttrs(table, TABLE_ATTRS);
  const out: AnyObject = {
    table: nodeInfo(entry),
    ...(attrs ? { attrs } : {}),
    rowCount: height,
    columnCount: grid.width,
    regular: grid.regular,
    ...(grid.regular ? {} : { problems: englishTableProblems(grid.summary) }),
    format: args.format,
    fromRow: first + 1,
    toRow: (taken[taken.length - 1] ?? first) + 1,
    rows: rows.map((row) => row.row),
    ...(above.length > 0 ? { above: above.map((cell) => cell.view) } : {}),
  };
  if (rest.length > 0) {
    const last = taken[taken.length - 1]!;
    out.more = moreOf(
      'read_table',
      { kind: 'after', nodeId: nodeIdOf(rowNode(table, grid, last)) },
      {
        rows: rest.length,
        characters: rest.reduce((sum, r) => sum + characterCount(rowNode(table, grid, r)), 0),
      },
    );
  }
  return out;
}

/** Registers `read_table` (after the script read tools, Δ§1.2). */
export function registerTableReadTools(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    'read_table',
    {
      title: 'Read a table',
      description: READ_TABLE_DESCRIPTION,
      inputSchema: z.object({
        table: z
          .string()
          .min(1)
          .describe('the table, or a row or cell in it: a nodeId or a structural path'),
        format: formatArg,
        fromRow: z.coerce
          .number()
          .int()
          .optional()
          .describe('the first grid row to read, from 1 (default 1)'),
        toRow: z.coerce
          .number()
          .int()
          .optional()
          .describe('the last grid row to read (default the last row)'),
        cursor: cursorArg,
      }),
      outputSchema: z.looseObject({
        table: nodeInfoSchema,
        rowCount: z.number(),
        columnCount: z.number(),
        regular: z.boolean(),
        rows: z.array(z.looseObject({})),
      }),
      annotations: { readOnlyHint: true },
    },
    (args) => readTable(ctx, args),
  );
}

/* ------------------------------------------------------------------------ */
/* edit_table (§3.9, Δ§1.4, Δ§3.5; data-model §15.2)                          */
/* ------------------------------------------------------------------------ */

/** The thirteen operations, in the contract's order (§3.9 "The thirteen commands"). */
export const TABLE_OPS = [
  'insertRows',
  'insertColumns',
  'deleteRows',
  'deleteColumns',
  'moveRows',
  'moveColumns',
  'duplicateRows',
  'duplicateColumns',
  'merge',
  'split',
  'setKind',
  'setAttributes',
  'repair',
] as const;

export type TableOp = (typeof TABLE_OPS)[number];

interface EditArgs {
  table: string;
  op: TableOp;
  row?: number;
  column?: number;
  rows?: number;
  columns?: number;
  count?: number;
  where?: 'before' | 'after';
  direction?: 'up' | 'down' | 'left' | 'right';
  kind?: 'th' | 'td';
  of?: 'cells' | 'rows' | 'table';
  attrs?: {
    align?: string;
    valign?: string;
    style?: string;
    lang?: string;
    id?: string;
    colspan?: number | '';
    rowspan?: number | '';
  };
}

const ROW = 'integer, a grid row from 1';
const COLUMN = 'integer, a grid column from 1';

/** The members each op takes, as the `expected` of a missing one names them. */
const OP_MEMBERS: Record<TableOp, Record<string, string>> = {
  insertRows: { row: ROW, where: 'before | after', count: 'integer, 1 to 999 (default 1)' },
  insertColumns: { column: COLUMN, where: 'before | after', count: 'integer, 1 to 64 (default 1)' },
  deleteRows: { row: ROW, rows: 'integer (default 1)' },
  deleteColumns: { column: COLUMN, columns: 'integer (default 1)' },
  moveRows: { row: ROW, rows: 'integer (default 1)', direction: 'up | down' },
  moveColumns: { column: COLUMN, columns: 'integer (default 1)', direction: 'left | right' },
  duplicateRows: { row: ROW, rows: 'integer (default 1)' },
  duplicateColumns: { column: COLUMN, columns: 'integer (default 1)' },
  merge: { row: ROW, column: COLUMN, rows: 'integer (default 1)', columns: 'integer (default 1)' },
  split: { row: ROW, column: COLUMN },
  setKind: { kind: 'th | td', row: ROW, column: COLUMN, rows: 'integer', columns: 'integer' },
  setAttributes: {
    attrs: '{align, valign, style, lang, id, colspan, rowspan}',
    of: 'cells (default) | rows | table',
    row: ROW,
    column: COLUMN,
  },
  repair: {},
};

/** The attributes each `of` takes (§3.9 "Attributes"). */
const OF_ATTRS: Record<'cells' | 'rows' | 'table', readonly string[]> = {
  cells: ['align', 'valign', 'style', 'lang', 'id', 'colspan', 'rowspan'],
  rows: ['align'],
  table: ['id', 'style'],
};

const LINK_HINT =
  'Nothing was changed. Tell the user: the user can merge these cells in the editor, which asks for confirmation; a block whose top-left cell is the linked cell keeps its id.';

/** A plan's refusal as the envelope the model reads: `notAllowed` or `invalidArguments`, with `reason`. */
function refusalError(refusal: Refusal, args: EditArgs, expected: AnyObject): ToolError {
  const reason = refusal.refused;
  const fail = (message: string, hint?: string, extra: AnyObject = {}) =>
    new ToolError(
      reason === 'invalid-id' || reason === 'duplicate-id' || reason === 'invalid-lang'
        ? 'invalidArguments'
        : 'notAllowed',
      message,
      { reason, ...(hint ? { hint } : {}), ...extra },
    );
  const removeTable = 'To remove the table, use remove_node on it.';
  switch (refusal.refused) {
    case 'only-row':
      return fail('The table has only one row.', removeTable);
    case 'all-rows':
      return fail('Deleting these rows would leave the table without a row.', removeTable);
    case 'only-column':
      return fail('The table has only one column.', removeTable);
    case 'all-columns':
      return fail('Deleting these columns would leave the table without a column.', removeTable);
    case 'merged-crosses-border':
      return fail(
        `A merged cell crosses the border of the ${refusal.params.axis === 'row' ? 'rows' : 'columns'} to move.`,
        'Move a range that holds the whole merged cell - read_table gives its row, column and spans - or split it first.',
      );
    case 'no-neighbour': {
      const where = {
        up: 'no row above',
        down: 'no row below',
        left: 'no column to the left',
        right: 'no column to the right',
      }[refusal.params.direction];
      return fail(`There is ${where} to exchange with.`);
    }
    case 'not-merged':
      return fail(
        `The cell at row ${args.row}, column ${args.column} is not merged.`,
        'split works on a cell with colspan or rowspan above 1.',
      );
    case 'needs-block':
      return fail(
        'The block holds only one cell.',
        'Give rows and columns so that the block covers at least two cells.',
      );
    case 'regular':
      return fail('The table is regular; there is nothing to repair.');
    case 'span-past-edge':
      return fail(
        `The span would reach past the last ${refusal.params.axis} of the table.`,
        undefined,
        { expected },
      );
    case 'merge-needs-block':
      return fail(
        'A merged cell starts above or to the left of this cell, so its span cannot grow from here.',
        'Use op merge with the row, column, rows and columns of the cells to join.',
      );
    case 'too-large':
      return fail('The table is too large to edit with the table commands.', 'Tell the user.');
    case 'invalid-id':
      return fail(
        `"${args.attrs?.id ?? ''}" is not a valid id: an XML name, without spaces, not starting with a digit.`,
        'Use another id, or "" to remove it.',
      );
    case 'duplicate-id':
      return fail(`Another element of the book already has the id "${refusal.params.id}".`);
    case 'invalid-lang':
      return fail(`"${refusal.params.value}" is not a language tag such as en, ru or pt-BR.`);
  }
}

/** What a call plans before the hook: the detached table, its grid and the plan's edit. */
interface Prepared {
  pm: PMNode;
  grid: TableGrid;
  edit: TableEdit;
}

/** Steps 2 and 3 (§3.9 "How a call runs"): the checks against the grid, the address, the plan. */
function prepare(ctx: ToolContext, entry: Entry, args: EditArgs): Prepared {
  const pm = nodeFromModel(entry.node);
  if (!pm || pm.type.name !== 'table') {
    throw new ToolError('internal', `${pathOf(entry)} cannot be read as a table`);
  }
  const grid = gridOfNode(pm);
  const height = grid.height;
  const width = grid.width;
  const expected = { rowCount: height, columnCount: width };
  const of = args.of ?? 'cells';
  if (grid.tooLarge && !(args.op === 'setAttributes' && of === 'table')) {
    throw refusalError({ refused: 'too-large' }, args, expected);
  }
  const invalid = (message: string, extra: AnyObject = { expected }) =>
    new ToolError('invalidArguments', message, extra);
  const missing = (member: string) =>
    invalid(`${args.op} needs ${member}.`, { expected: OP_MEMBERS[args.op] });
  const rows = args.rows ?? 1;
  const columns = args.columns ?? 1;
  const checkRow = (needed: boolean) => {
    if (args.row === undefined) {
      if (needed) throw missing('row');
      return;
    }
    if (args.row < 1 || args.row > height) {
      throw invalid(`row ${args.row} is outside the table's rows 1 to ${height}.`);
    }
    if (rows < 1) throw invalid(`rows ${rows} must be at least 1.`);
    if (args.row + rows - 1 > height) {
      throw invalid(
        `row + rows - 1 = ${args.row + rows - 1} is past the table's last row ${height}.`,
      );
    }
  };
  const checkColumn = (needed: boolean) => {
    if (args.column === undefined) {
      if (needed) throw missing('column');
      return;
    }
    if (args.column < 1 || args.column > width) {
      throw invalid(`column ${args.column} is outside the table's columns 1 to ${width}.`);
    }
    if (columns < 1) throw invalid(`columns ${columns} must be at least 1.`);
    if (args.column + columns - 1 > width) {
      throw invalid(
        `column + columns - 1 = ${args.column + columns - 1} is past the table's last column ${width}.`,
      );
    }
  };
  const checkCount = (limit: number) => {
    const count = args.count ?? 1;
    if (count < 1 || count > limit) {
      throw invalid(`count ${count} is outside 1 to ${limit}.`);
    }
    return count;
  };
  const rowLines = () => ({ axis: 'row' as const, from: args.row! - 1, to: args.row! - 1 + rows });
  const columnLines = () => ({
    axis: 'column' as const,
    from: args.column! - 1,
    to: args.column! - 1 + columns,
  });
  const base: TableAddress = { table: pm, grid };
  /** setKind / setAttributes of cells: whole lines for one member, an extended block for both (C67). */
  const cellsAddress = (): TableAddress => {
    if (args.row === undefined && args.column === undefined) {
      throw invalid(`${args.op} needs row, column or both.`, { expected: OP_MEMBERS[args.op] });
    }
    checkRow(false);
    checkColumn(false);
    if (args.row !== undefined && args.column !== undefined) {
      const rect = grid.extend({
        top: args.row - 1,
        left: args.column - 1,
        bottom: args.row - 1 + rows,
        right: args.column - 1 + columns,
      });
      return { ...base, rect };
    }
    return { ...base, lines: args.row !== undefined ? rowLines() : columnLines() };
  };
  const context: PlanContext = {
    nextId: () => ctx.deps.nextNodeId(),
    bookIds: collectBookIds(ctx.document),
  };
  let edit: TableEdit | Refusal;
  switch (args.op) {
    case 'insertRows':
    case 'insertColumns': {
      const isRow = args.op === 'insertRows';
      if (isRow) checkRow(true);
      else checkColumn(true);
      if (!args.where) throw missing('where');
      const count = checkCount(isRow ? MAX_TABLE_ROWS : MAX_TABLE_COLUMNS);
      edit = isRow
        ? planInsertRows(
            { ...base, lines: { axis: 'row', from: args.row! - 1, to: args.row! } },
            { side: args.where === 'before' ? 'above' : 'below', count },
            context,
          )
        : planInsertColumns(
            { ...base, lines: { axis: 'column', from: args.column! - 1, to: args.column! } },
            { side: args.where === 'before' ? 'left' : 'right', count },
            context,
          );
      break;
    }
    case 'deleteRows':
    case 'moveRows':
    case 'duplicateRows': {
      checkRow(true);
      const address = { ...base, lines: rowLines() };
      if (args.op === 'deleteRows') edit = planDeleteRows(address, context);
      else if (args.op === 'duplicateRows') edit = planDuplicateRows(address, context);
      else {
        if (args.direction !== 'up' && args.direction !== 'down')
          throw missing('direction up | down');
        edit = planMoveRows(address, { direction: args.direction }, context);
      }
      break;
    }
    case 'deleteColumns':
    case 'moveColumns':
    case 'duplicateColumns': {
      checkColumn(true);
      const address = { ...base, lines: columnLines() };
      if (args.op === 'deleteColumns') edit = planDeleteColumns(address, context);
      else if (args.op === 'duplicateColumns') edit = planDuplicateColumns(address, context);
      else {
        if (args.direction !== 'left' && args.direction !== 'right') {
          throw missing('direction left | right');
        }
        edit = planMoveColumns(address, { direction: args.direction }, context);
      }
      break;
    }
    case 'merge': {
      if (args.row === undefined && args.column === undefined) {
        throw invalid('merge needs row and column.', { expected: OP_MEMBERS.merge });
      }
      checkRow(true);
      checkColumn(true);
      edit = planMerge(
        {
          ...base,
          rect: {
            top: args.row! - 1,
            left: args.column! - 1,
            bottom: args.row! - 1 + rows,
            right: args.column! - 1 + columns,
          },
        },
        context,
      );
      break;
    }
    case 'split': {
      if (args.row === undefined && args.column === undefined) {
        throw invalid('split needs row and column.', { expected: OP_MEMBERS.split });
      }
      checkRow(true);
      checkColumn(true);
      const owner = grid.owner(args.row! - 1, args.column! - 1);
      if (owner < 0) {
        throw invalid(`no cell covers row ${args.row}, column ${args.column}.`);
      }
      const cell = grid.cells[owner]!;
      edit = planSplit({ ...base, caret: { row: cell.row, col: cell.left } }, context);
      break;
    }
    case 'setKind': {
      if (!args.kind) throw missing('kind');
      edit = planSetKind(cellsAddress(), { kind: args.kind }, context);
      break;
    }
    case 'setAttributes': {
      const attrs = args.attrs ?? {};
      const given = Object.entries(attrs)
        .filter(([, value]) => value !== undefined)
        .map(([name]) => name);
      if (given.length === 0) throw missing('attrs');
      const refused = given.filter((name) => !OF_ATTRS[of].includes(name));
      if (refused.length > 0) {
        throw invalid(`of: ${of} takes ${OF_ATTRS[of].join(', ')}, not ${refused.join(', ')}.`, {
          expected: { of, attrs: OF_ATTRS[of] },
        });
      }
      if (of === 'table') {
        edit = planTableAttrs(
          base,
          {
            ...(attrs.id === undefined ? {} : { id: attrs.id }),
            ...(attrs.style === undefined ? {} : { style: attrs.style }),
          },
          context,
        );
        break;
      }
      if (of === 'rows') {
        checkRow(true);
        edit = planRowAlign(
          { ...base, lines: rowLines() },
          { align: attrs.align || null },
          context,
        );
        break;
      }
      const spans = given.filter((name) => name === 'colspan' || name === 'rowspan');
      if (spans.length > 0 && given.length > 1) {
        throw invalid(
          'a span is changed alone: give one of colspan and rowspan and nothing else.',
          {
            expected: { attrs: { colspan: 'integer of 1 or more, or ""' } },
          },
        );
      }
      const address = cellsAddress();
      let head: { row: number; col: number } | undefined;
      if (spans.length > 0 || attrs.id !== undefined) {
        const targets = address.lines
          ? lineOwners(grid, address.lines.axis, address.lines.from, address.lines.to)
          : grid.cellsIn(address.rect!);
        if (targets.length !== 1) {
          throw invalid(
            `${spans[0] ?? 'id'} needs an address of exactly one cell; this one holds ${targets.length}: address a single cell.`,
          );
        }
        const cell = grid.cells[targets[0]!]!;
        head = { row: cell.row, col: cell.left };
      }
      if (spans.length > 0) {
        const axis = spans[0] as 'colspan' | 'rowspan';
        const raw = attrs[axis];
        const value = raw === '' ? 1 : raw!;
        if (!Number.isInteger(value) || value < 1) {
          throw invalid(`${axis} ${String(raw)} must be a whole number of 1 or more, or "".`);
        }
        edit = planSpan({ ...address, head, caret: head }, { axis, value }, context);
        break;
      }
      edit = planCellAttrs(
        { ...address, ...(head ? { head } : {}) },
        {
          ...(attrs.align === undefined ? {} : { align: attrs.align || null }),
          ...(attrs.valign === undefined ? {} : { valign: attrs.valign || null }),
          ...(attrs.style === undefined ? {} : { style: attrs.style }),
          ...(attrs.lang === undefined ? {} : { lang: attrs.lang }),
          ...(attrs.id === undefined ? {} : { id: attrs.id }),
        },
        context,
      );
      break;
    }
    case 'repair':
      edit = planRepair(base, context);
      break;
  }
  if (isRefusal(edit)) throw refusalError(edit, args, expected);
  return { pm, grid, edit };
}

/** True when the edit changes no row and no table attribute (step 5). */
function changesNothing(pm: PMNode, edit: TableEdit): boolean {
  if (edit.rows.length !== pm.childCount) return false;
  if (!edit.rows.every((row, index) => row === pm.child(index))) return false;
  if (!edit.tableAttrs) return true;
  const keys = new Set([...Object.keys(pm.attrs), ...Object.keys(edit.tableAttrs)]);
  return [...keys].every((key) => (pm.attrs[key] ?? null) === (edit.tableAttrs![key] ?? null));
}

/** The node ids of the cells of a table node. */
function cellIds(table: PMNode): Set<string> {
  const ids = new Set<string>();
  table.forEach((row) => {
    row.forEach((cell) => {
      const id = cell.attrs.nodeId;
      if ((cell.type.name === 'td' || cell.type.name === 'th') && typeof id === 'string')
        ids.add(id);
    });
  });
  return ids;
}

/** The result's table facts and focus (§3.9 "Output") from a table node and the plan's focus. */
function facts(
  table: PMNode,
  focus: TableEdit['focus'],
): {
  rowCount: number;
  columnCount: number;
  regular: boolean;
  problems?: string;
  focus: AnyObject;
} {
  const grid = gridOfNode(table);
  const { top, left } = focus.rect;
  let owner = -1;
  if (grid.height > 0 && grid.width > 0) {
    const row = Math.min(top, grid.height - 1);
    if (!grid.tooLarge) owner = grid.owner(row, Math.min(left, grid.width - 1));
    if (owner < 0) owner = grid.rowStart[row] ?? -1;
  }
  const id = owner >= 0 && owner < grid.cells.length ? nodeIdOfCell(table, grid, owner) : '';
  return {
    rowCount: grid.height,
    columnCount: grid.width,
    regular: grid.regular,
    ...(grid.regular ? {} : { problems: englishTableProblems(grid.summary) }),
    focus: { row: top + 1, column: left + 1, id },
  };
}

function nodeIdOfCell(table: PMNode, grid: TableGrid, index: number): string {
  const id = gridCellNode(table, grid, index).attrs.nodeId;
  return typeof id === 'string' ? id : '';
}

/** `edit_table` (§3.9 "How a call runs", steps 1 to 8). */
async function editTable(ctx: ToolContext, args: EditArgs): Promise<AnyObject> {
  // 1. Resolve; the strike key names the table, or the reference as given.
  let entry: Entry;
  try {
    entry = tableEntry(ctx, args.table);
  } catch (error) {
    return ctx.change(`edit_table:${args.op}@${args.table}`, () => Promise.reject(error));
  }
  const tableId = nodeIdOf(entry.node);
  const key = `edit_table:${args.op}@${tableId}`;
  // 2 and 3. The checks against the grid, the address and the plan.
  let prepared: Prepared;
  try {
    prepared = prepare(ctx, entry, args);
  } catch (error) {
    return ctx.change(key, () => Promise.reject(error));
  }
  const { pm, edit } = prepared;
  // 4. Links (FR-052): a merge or a span growth that removes link targets asks the user.
  if (edit.removedIds.length > 0 && (args.op === 'merge' || args.op === 'setAttributes')) {
    const linked = edit.removedIds.filter((id) => countLinksTo(ctx.document, [id]) > 0);
    if (linked.length > 0) {
      const links = countLinksTo(ctx.document, linked);
      const error = new ToolError(
        'confirmationRequired',
        `The change removes cells whose ids are link targets: ${linked.join(', ')} (${links === 1 ? '1 link would lose its target' : `${links} links would lose their target`}).`,
        { links, ids: linked, hint: LINK_HINT },
      );
      return ctx.change(key, () => Promise.reject(error));
    }
  }
  // 5. No change: a success without the hook.
  if (changesNothing(pm, edit)) {
    return {
      table: nodeInfo(entry),
      op: args.op,
      ...facts(pm, edit.focus),
      changed: false,
    };
  }
  // 6 to 8. One change: the new table, written last; the hook validates the copy.
  return ctx.change(key, async () => {
    const next = applyTableEdit(pm, edit);
    next.check();
    const oldRows = new Map<PMNode, ModelNodeJson>();
    pm.forEach((child, _offset, index) => {
      const json = entry.node.content?.[index];
      if (json) oldRows.set(child, json);
    });
    const node: ModelNodeJson = {
      ...entry.node,
      attrs: edit.tableAttrs ? attrsToModel(next) : entry.node.attrs,
      content: edit.rows.map((row) => oldRows.get(row) ?? nodeToModel(row)),
    };
    writeAt(ctx.deps.copy, entry, { kind: 'replace', node });
    const before = cellIds(pm);
    const after = cellIds(next);
    const grid = gridOfNode(next);
    const fresh: AnyObject[] = [];
    let newCellCount = 0;
    grid.cells.forEach((cell, index) => {
      const id = nodeIdOfCell(next, grid, index);
      if (before.has(id)) return;
      newCellCount += 1;
      if (fresh.length < MAX_NEW_CELLS)
        fresh.push({ row: cell.row + 1, column: cell.left + 1, id });
    });
    let removedCells = 0;
    for (const id of before) if (!after.has(id)) removedCells += 1;
    const written = ctx.entryOf(tableId);
    return {
      table: written ? nodeInfo(written) : nodeInfo(entry),
      op: args.op,
      ...facts(next, edit.focus),
      ...(newCellCount > 0 ? { newCells: fresh, newCellCount } : {}),
      ...(removedCells > 0 ? { removedCells } : {}),
    };
  });
}

/** The new cells a result lists at most (`newCellCount` stays exact; open point 5). */
const MAX_NEW_CELLS = 20;

/** Registers `edit_table` (after the structural change tools, Δ§1.2). */
export function registerTableChangeTools(server: McpServer, ctx: ToolContext): void {
  const integer = (what: string) => z.coerce.number().int().optional().describe(what);
  const span = (what: string) =>
    z
      .union([z.literal(''), z.coerce.number().int()])
      .optional()
      .describe(what);
  defineTool(
    server,
    'edit_table',
    {
      title: 'Change a table',
      description: EDIT_TABLE_DESCRIPTION,
      inputSchema: z.object({
        table: z
          .string()
          .min(1)
          .describe('the table, or a row or cell in it: a nodeId or a structural path'),
        op: z.enum(TABLE_OPS).describe('the table command'),
        row: integer('the first grid row addressed, from 1'),
        column: integer('the first grid column addressed, from 1'),
        rows: integer('how many rows are addressed (default 1)'),
        columns: integer('how many columns are addressed (default 1)'),
        count: integer('inserts: how many rows (1-999) or columns (1-64), default 1'),
        where: z.enum(['before', 'after']).optional().describe('inserts: before or after'),
        direction: z
          .enum(['up', 'down', 'left', 'right'])
          .optional()
          .describe('moves: up / down for rows, left / right for columns'),
        kind: z.enum(['th', 'td']).optional().describe('setKind: header (th) or normal (td) cells'),
        of: z
          .enum(['cells', 'rows', 'table'])
          .optional()
          .describe('setAttributes: the attributes of the cells (default), the rows or the table'),
        attrs: z
          .object({
            align: z.enum(['left', 'right', 'center', '']).optional(),
            valign: z.enum(['top', 'middle', 'bottom', '']).optional(),
            style: z.string().optional(),
            lang: z.string().optional(),
            id: z.string().optional(),
            colspan: span('a whole number of 1 or more; "" means 1'),
            rowspan: span('a whole number of 1 or more; "" means 1'),
          })
          .optional()
          .describe('setAttributes: the values; "" removes an attribute'),
      }),
      outputSchema: z.looseObject({ table: nodeInfoSchema, op: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    (args) => editTable(ctx, args as EditArgs),
  );
}
