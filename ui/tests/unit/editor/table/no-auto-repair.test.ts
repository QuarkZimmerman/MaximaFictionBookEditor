/**
 * No automatic repair (feature 006, US2 T074; FR-035; R1.7; data-model §4.4, §5.4; quickstart
 * §2, §13): beside a regular table, every irregular case of `grid-vectors.json` stays the same
 * node through typing, caret moves, a text selection across two cells (normalised into a block),
 * a block made as Shift+Arrow makes it, Undo and Redo of those edits and every command of
 * `GUARDED_COMMANDS` on the regular table, in a state with every Body plugin; no transaction a
 * plugin appends carries a step, and after a command on the irregular table itself an empty
 * transaction appends nothing. Later stories append their commands to `GUARDED_COMMANDS`: US4
 * (T098) the block clear, the cut and the paste of a block - run on a block of the regular
 * table -, and the guard's edits gain Delete, Backspace, type-over and the clear a composition
 * makes on a block of the regular table; US5 (T106) *Merge cells* on a block of the regular table
 * and *Split cell* on the cell that merge made; US6 (T112) the five header commands - *Make
 * normal cells* on a block of the regular table made header cells first -, which on the irregular
 * table itself leave its problems as they were, since a kind change moves no position; US7
 * (T120) the attribute plans `planCellAttrs` (on a block of the regular table), `planRowAlign`
 * and `planTableAttrs`, which on the irregular table itself leave its problems as they were too:
 * attributes move no position (quickstart §8).
 */

/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Node as PMNode } from 'prosemirror-model';
import { redo, undo } from 'prosemirror-history';
import { Fragment, Slice } from 'prosemirror-model';
import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';

import { DISCRETE_STEP } from '@/editor/commands/util';
import { nodeFromModel, type ModelNodeJson } from '@/editor/fromModel';
import { fb2Schema, findNodeById } from '@/editor/schema';
import { planCellAttrs, planRowAlign, planSpan, planTableAttrs } from '@/editor/table/attrs';
import { planCommand, type TablePlan } from '@/editor/table/commands';
import { pasteTransaction } from '@/editor/clipboard/route';
import { gridOfNode } from '@/editor/table/grid';
import {
  pasteBlockPlan,
  planClearBlock,
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
  planToggleHeaderCell,
  planToggleHeaderLines,
} from '@/editor/table/ops';
import { CellBlockSelection } from '@/editor/table/selection';
import { createBodyEditorState } from '@/views/body/bodyEditor';

const N = fb2Schema.nodes;

/** A 2 × 2 block as the clipboard holds it (US4). */
function clipboardBlock() {
  return N.table!.create(null, [
    N.tr!.create(null, [
      N.td!.create(null, fb2Schema.text('a')),
      N.td!.create(null, fb2Schema.text('b')),
    ]),
    N.tr!.create(null, [
      N.td!.create(null, fb2Schema.text('c')),
      N.td!.create(null, fb2Schema.text('d')),
    ]),
  ]);
}

/**
 * The commands the guard runs on the regular table: US2's twelve; later stories append (US4:
 * the block clear and the cut on a block, `block`; the paste of a block, through the router;
 * US5: *Merge cells* on a block, and *Split cell* with the caret in a merged cell, `merged` -
 * the block from `g-0-0` to `g-1-1` merged first; US6: the five header commands, `kind` - their
 * irregular table keeps its problems -, *Make header cells* and *Make normal cells* on a block,
 * the latter on the block made header cells first, `headers`; US7: the three attribute plans,
 * `attrs` - their irregular table keeps its problems too -, the cells' on a block).
 */
const GUARDED_COMMANDS: {
  name: string;
  plan: TablePlan;
  block?: boolean;
  merged?: boolean;
  headers?: boolean;
  kind?: boolean;
  attrs?: boolean;
}[] = [
  { name: 'insertRowAbove', plan: (a, c) => planInsertRows(a, { side: 'above' }, c) },
  { name: 'insertRowBelow', plan: (a, c) => planInsertRows(a, { side: 'below' }, c) },
  { name: 'deleteRow', plan: (a, c) => planDeleteRows(a, c) },
  { name: 'insertColumnLeft', plan: (a, c) => planInsertColumns(a, { side: 'left' }, c) },
  { name: 'insertColumnRight', plan: (a, c) => planInsertColumns(a, { side: 'right' }, c) },
  { name: 'deleteColumn', plan: (a, c) => planDeleteColumns(a, c) },
  { name: 'moveRowUp', plan: (a, c) => planMoveRows(a, { direction: 'up' }, c) },
  { name: 'moveRowDown', plan: (a, c) => planMoveRows(a, { direction: 'down' }, c) },
  { name: 'moveColumnLeft', plan: (a, c) => planMoveColumns(a, { direction: 'left' }, c) },
  { name: 'moveColumnRight', plan: (a, c) => planMoveColumns(a, { direction: 'right' }, c) },
  { name: 'duplicateRow', plan: (a, c) => planDuplicateRows(a, c) },
  { name: 'duplicateColumn', plan: (a, c) => planDuplicateColumns(a, c) },
  { name: 'clearBlock', plan: (a, c) => planClearBlock(a, c), block: true },
  { name: 'cutBlock', plan: (a, c) => planClearBlock(a, c), block: true },
  { name: 'pasteBlock', plan: (a, c) => pasteBlockPlan(a, clipboardBlock(), c) },
  { name: 'mergeCells', plan: (a, c) => planMerge(a, c), block: true },
  // US8 (T135): the span route of the Table bar - colspan 2 merges the caret's cell with the next.
  { name: 'planSpan', plan: (a, c) => planSpan(a, { axis: 'colspan', value: 2 }, c) },
  { name: 'splitCell', plan: (a, c) => planSplit(a, c), merged: true },
  { name: 'toggleHeaderCell', plan: (a, c) => planToggleHeaderCell(a, c), kind: true },
  {
    name: 'makeHeaderCells',
    plan: (a, c) => planSetKind(a, { kind: 'th' }, c),
    block: true,
    kind: true,
  },
  {
    name: 'makeNormalCells',
    plan: (a, c) => planSetKind(a, { kind: 'td' }, c),
    block: true,
    headers: true,
    kind: true,
  },
  {
    name: 'toggleHeaderRow',
    plan: (a, c) => planToggleHeaderLines(a, { axis: 'row' }, c),
    kind: true,
  },
  {
    name: 'toggleHeaderColumn',
    plan: (a, c) => planToggleHeaderLines(a, { axis: 'column' }, c),
    kind: true,
  },
  {
    name: 'cellAttrs',
    plan: (a, c) =>
      planCellAttrs(a, { align: 'center', valign: 'bottom', style: 'guard', lang: 'de' }, c),
    block: true,
    attrs: true,
  },
  { name: 'rowAlign', plan: (a, c) => planRowAlign(a, { align: 'right' }, c), attrs: true },
  {
    name: 'tableAttrs',
    plan: (a, c) => planTableAttrs(a, { id: 'guard-table', style: 'guard' }, c),
    attrs: true,
  },
];

const VECTORS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../tests/fixtures/tables',
);

interface VectorCase {
  name: string;
  table: { rows: ({ type?: string; attrs?: Record<string, unknown> }[] | { type: string })[] };
  expect: { regular: boolean };
}

/** A vectors table as a ProseMirror table whose node ids start with `prefix`. */
function vectorTable(table: VectorCase['table'], prefix: string): PMNode {
  let next = 0;
  const nodeId = () => `${prefix}${(next += 1)}`;
  const raw = () => ({ type: 'raw-xml', attrs: { nodeId: nodeId(), xml: '<x/>', inline: false } });
  return nodeFromModel({
    type: 'table',
    attrs: { nodeId: `${prefix}table` },
    content: table.rows.map((row) =>
      Array.isArray(row)
        ? {
            type: 'tr',
            attrs: { nodeId: nodeId() },
            content: row.map((cell) =>
              cell.type === 'raw-xml'
                ? raw()
                : {
                    type: cell.type ?? 'td',
                    attrs: { nodeId: nodeId(), ...(cell.attrs ?? {}) },
                    content: [],
                  },
            ),
          }
        : raw(),
    ),
  } as unknown as ModelNodeJson)!;
}

/** The regular 3 × 3 table `g`, its cells `g-<row>-<column>` holding `r<row>c<column>`. */
function regularTable(): PMNode {
  return N.table!.create(
    { nodeId: 'g' },
    [0, 1, 2].map((r) =>
      N.tr!.create(
        { nodeId: `g-r${r}` },
        [0, 1, 2].map((c) => N.td!.create({ nodeId: `g-${r}-${c}` }, fb2Schema.text(`r${r}c${c}`))),
      ),
    ),
  );
}

const vectors = JSON.parse(readFileSync(path.join(VECTORS, 'grid-vectors.json'), 'utf8')) as {
  cases: VectorCase[];
};
const irregular = vectors.cases.filter((one) => !one.expect.regular);

/** Applies `tr`, expecting every appended transaction to change the selection only. */
function apply(state: EditorState, tr: Transaction): EditorState {
  const { state: next, transactions } = state.applyTransaction(tr);
  for (const appended of transactions.slice(1)) expect(appended.steps).toHaveLength(0);
  return next;
}

function posOf(state: EditorState, nodeId: string): number {
  const found = findNodeById(state.doc, nodeId);
  if (!found) throw new Error(`no node ${nodeId}`);
  return found.pos;
}

function tableOf(state: EditorState): PMNode {
  return state.doc.nodeAt(posOf(state, 'xtable'))!;
}

/** Runs `plan` through `planCommand` as the host does, one discrete step. */
function runPlan(state: EditorState, plan: TablePlan): { state: EditorState; ran: boolean } {
  let next = state;
  let counter = 0;
  const ran = planCommand(plan, { nextId: () => `n${(counter += 1)}` })(state, (tr) => {
    expect(tr.getMeta(DISCRETE_STEP)).toBe(true);
    next = apply(state, tr);
  });
  return { state: next, ran };
}

describe('no automatic repair (R1.7, FR-035)', () => {
  it('covers the irregular cases of the shared vectors', () => {
    expect(irregular.length).toBeGreaterThan(10);
    expect(GUARDED_COMMANDS).toHaveLength(26);
  });

  for (const one of irregular) {
    it(`${one.name}: edits and commands beside it leave it the same node`, () => {
      const doc = N.doc!.create(
        null,
        N.body!.create(
          { nodeId: 'b' },
          N.section!.create({ nodeId: 's' }, [
            N.p!.create({ nodeId: 'p1' }, fb2Schema.text('before')),
            regularTable(),
            vectorTable(one.table, 'x'),
            N.p!.create({ nodeId: 'p2' }, fb2Schema.text('after')),
          ]),
        ),
      );
      let state = createBodyEditorState(doc, { getNbspChar: () => '\u00b7' });
      const original = tableOf(state);
      const same = () => expect(tableOf(state)).toBe(original);
      // Typing in a cell of the regular table, and caret moves.
      state = apply(state, state.tr.insertText('typed', posOf(state, 'g-1-1') + 1));
      same();
      state = apply(
        state,
        state.tr.setSelection(TextSelection.create(state.doc, posOf(state, 'g-0-0') + 2)),
      );
      same();
      // A text selection across two cells becomes a block (the plugin's normalisation).
      state = apply(
        state,
        state.tr.setSelection(
          TextSelection.create(state.doc, posOf(state, 'g-0-0') + 1, posOf(state, 'g-1-2') + 2),
        ),
      );
      expect(state.selection).toBeInstanceOf(CellBlockSelection);
      same();
      // A block as Shift+Arrow makes it: the next grid cell.
      state = apply(
        state,
        state.tr.setSelection(
          CellBlockSelection.create(state.doc, posOf(state, 'g-2-0'), posOf(state, 'g-2-1')),
        ),
      );
      same();
      // Undo and Redo of the typing.
      expect(undo(state, (tr) => (state = apply(state, tr)))).toBe(true);
      same();
      expect(redo(state, (tr) => (state = apply(state, tr)))).toBe(true);
      same();
      // Every guarded command on the regular table, from its middle cell.
      // Delete and Backspace (both `deleteSelection`), type-over and the clear a composition
      // makes, on a block of the regular table.
      for (const edit of [
        (tr: Transaction) => tr.deleteSelection(),
        (tr: Transaction) => tr.insertText('x'),
        (tr: Transaction) =>
          tr.replaceSelection(new Slice(Fragment.from(fb2Schema.text('y')), 0, 0)),
      ]) {
        const onBlock = apply(
          state,
          state.tr.setSelection(
            CellBlockSelection.create(state.doc, posOf(state, 'g-0-0'), posOf(state, 'g-1-1')),
          ),
        );
        const edited = apply(onBlock, edit(onBlock.tr));
        expect(tableOf(edited)).toBe(original);
      }
      // The paste of a block through the router, with the caret in the regular table.
      const caretIn = apply(
        state,
        state.tr.setSelection(TextSelection.create(state.doc, posOf(state, 'g-1-1') + 1)),
      );
      let counter = 0;
      const pasteTr = pasteTransaction(
        caretIn,
        { kind: 'own', slice: new Slice(Fragment.from(clipboardBlock()), 0, 0) },
        { bookIds: () => new Set(), nextNodeId: () => `q${(counter += 1)}`, message: () => {} },
      )!;
      expect(tableOf(apply(caretIn, pasteTr))).toBe(original);
      for (const { name, plan, block, merged, headers } of GUARDED_COMMANDS) {
        let start = state;
        if (merged || headers) {
          // The block from g-0-0 to g-1-1 merged first, so the caret stands in a merged cell, or
          // made header cells first, so that Make normal cells has cells to convert.
          const onBlock = apply(
            state,
            state.tr.setSelection(
              CellBlockSelection.create(state.doc, posOf(state, 'g-0-0'), posOf(state, 'g-1-1')),
            ),
          );
          const first = runPlan(
            onBlock,
            merged ? planMerge : (a, c) => planSetKind(a, { kind: 'th' }, c),
          );
          expect(first.ran, name).toBe(true);
          expect(tableOf(first.state), name).toBe(original);
          start = first.state;
        }
        const at = apply(
          start,
          start.tr.setSelection(
            block
              ? CellBlockSelection.create(start.doc, posOf(start, 'g-0-0'), posOf(start, 'g-1-1'))
              : TextSelection.create(start.doc, posOf(start, merged ? 'g-0-0' : 'g-1-1') + 1),
          ),
        );
        const result = runPlan(at, plan);
        expect(result.ran, name).toBe(true);
        expect(tableOf(result.state), name).toBe(original);
        const back = apply(result.state, result.state.tr);
        expect(tableOf(back), name).toBe(original);
      }
      // A command on the irregular table itself: afterwards an empty transaction appends nothing;
      // a header command or an attribute plan leaves its problems as they were (a kind or an
      // attribute change moves no position).
      const firstCell = original.firstChild?.firstChild;
      if (firstCell && (firstCell.type.name === 'td' || firstCell.type.name === 'th')) {
        const inside = apply(
          state,
          state.tr.setSelection(
            TextSelection.create(state.doc, posOf(state, firstCell.attrs.nodeId as string) + 1),
          ),
        );
        const grid = gridOfNode(original);
        let converted = 0;
        let attributed = 0;
        for (const { name, plan, kind, attrs } of GUARDED_COMMANDS) {
          const result = runPlan(inside, plan);
          const { transactions } = result.state.applyTransaction(result.state.tr);
          expect(transactions).toHaveLength(1);
          if (!kind && !attrs) continue;
          const after = gridOfNode(tableOf(result.state));
          expect(after.summary, name).toEqual(
            name === 'tableAttrs' ? { ...grid.summary, id: 'guard-table' } : grid.summary,
          );
          expect(after.problems, name).toEqual(grid.problems);
          if (result.ran && kind) converted += 1;
          if (result.ran && attrs) attributed += 1;
        }
        // Toggle header cell, Make header cells or Make normal cells, and the two toggles act;
        // so do the three attribute plans, on the caret's cell, its row and the table.
        expect(converted).toBeGreaterThanOrEqual(4);
        expect(attributed).toBe(3);
      }
    });
  }

  it('Repair table on one irregular table leaves every other table of the document the same node (US8 sc.4)', () => {
    const tables = irregular.map((one, index) => vectorTable(one.table, `r${index}-`));
    const doc = N.doc!.create(
      null,
      N.body!.create(
        { nodeId: 'b' },
        N.section!.create({ nodeId: 's' }, [regularTable(), ...tables]),
      ),
    );
    for (let index = 0; index < tables.length; index += 1) {
      const id = `r${index}-table`;
      const at = findNodeById(doc, id)!.pos;
      let first = -1;
      doc.nodeAt(at)!.descendants((node, offset) => {
        if (first < 0 && (node.type.name === 'td' || node.type.name === 'th'))
          first = at + 1 + offset;
        return first < 0;
      });
      const start = createBodyEditorState(doc, { getNbspChar: () => '\u00b7' });
      const state = start.apply(start.tr.setSelection(TextSelection.create(doc, first + 1)));
      const result = runPlan(state, planRepair);
      expect(result.ran, irregular[index]!.name).toBe(true);
      const repaired = result.state.doc.nodeAt(findNodeById(result.state.doc, id)!.pos)!;
      expect(gridOfNode(repaired).regular, irregular[index]!.name).toBe(true);
      result.state.doc.descendants((node) => {
        if (node.type.name !== 'table') return true;
        if (node.attrs.nodeId !== id) {
          expect(node, `${irregular[index]!.name}: ${String(node.attrs.nodeId)}`).toBe(
            doc.nodeAt(findNodeById(doc, node.attrs.nodeId as string)!.pos),
          );
        }
        return false;
      });
    }
  });
});
