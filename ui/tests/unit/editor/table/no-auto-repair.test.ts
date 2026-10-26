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
 * and *Split cell* on the cell that merge made.
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
import { planCommand, type TablePlan } from '@/editor/table/commands';
import { pasteTransaction } from '@/editor/clipboard/route';
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
  planSplit,
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
 * the block from `g-0-0` to `g-1-1` merged first).
 */
const GUARDED_COMMANDS: { name: string; plan: TablePlan; block?: boolean; merged?: boolean }[] = [
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
  { name: 'splitCell', plan: (a, c) => planSplit(a, c), merged: true },
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
    expect(GUARDED_COMMANDS).toHaveLength(17);
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
      for (const { name, plan, block, merged } of GUARDED_COMMANDS) {
        let start = state;
        if (merged) {
          // The block from g-0-0 to g-1-1 merged first, so the caret stands in a merged cell.
          const onBlock = apply(
            state,
            state.tr.setSelection(
              CellBlockSelection.create(state.doc, posOf(state, 'g-0-0'), posOf(state, 'g-1-1')),
            ),
          );
          const merge = runPlan(onBlock, planMerge);
          expect(merge.ran, name).toBe(true);
          expect(tableOf(merge.state), name).toBe(original);
          start = merge.state;
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
      // A command on the irregular table itself: afterwards an empty transaction appends nothing.
      const firstCell = original.firstChild?.firstChild;
      if (firstCell && (firstCell.type.name === 'td' || firstCell.type.name === 'th')) {
        const inside = apply(
          state,
          state.tr.setSelection(
            TextSelection.create(state.doc, posOf(state, firstCell.attrs.nodeId as string) + 1),
          ),
        );
        for (const { plan } of GUARDED_COMMANDS) {
          const result = runPlan(inside, plan);
          const { transactions } = result.state.applyTransaction(result.state.tr);
          expect(transactions).toHaveLength(1);
        }
      }
    });
  }
});
