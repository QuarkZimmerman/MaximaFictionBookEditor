/**
 * The seeded fuzz of SC-003, the oracle layer (feature 006, US2 T073; FR-035, FR-045, FR-046;
 * C76; data-model §16.4; quickstart §2, §13; research R1.12, R8.15): 1,000 random commands per
 * seed of `FUZZ_SEEDS` and of `REGRESSION_SEEDS` - or the seed `MFBE_FUZZ_SEED` alone
 * (`MFBE_FUZZ_SEED=<n> npx vitest run tests/unit/editor/table/fuzz.test.ts`) - through an
 * `EditorState` made by `createBodyEditorState`, with every Body plugin, the table plugin
 * included, and history; every step checked by the generator's oracle. A failure prints its
 * seed, step, command, selection and the table before and after it as model JSON.
 */

/// <reference types="node" />
import { EditorState, TextSelection } from 'prosemirror-state';

import { fb2Schema } from '@/editor/schema';
import { commitTableEdit, isRefusal, tableTarget, type TableEdit } from '@/editor/table/edit';
import { gridOfNode } from '@/editor/table/grid';
import { pasteBlockPlan } from '@/editor/table/ops';
import {
  FUZZ_MIX,
  FUZZ_SEEDS,
  checkFuzzStep,
  createStateHost,
  runFuzz,
  type FuzzReport,
} from '@/editor/table/testing/fuzz';
import { createBodyEditorState } from '@/views/body/bodyEditor';

import { docOf, idGenerator, p, pos, table } from './helpers';

const N = fb2Schema.nodes;

/** A book of one section holding one paragraph, in the Body editor's state. */
function startState() {
  const doc = N.doc!.create(
    null,
    N.body!.create(
      { nodeId: 'b1' },
      N.section!.create({ nodeId: 's1' }, [
        N.p!.create({ nodeId: 'p1' }, fb2Schema.text('Only text.')),
      ]),
    ),
  );
  return createBodyEditorState(doc, { getNbspChar: () => '\u00b7' });
}

function failureText(report: FuzzReport): string {
  return JSON.stringify(report.failures[0] ?? null, null, 1);
}

/**
 * Exploratory seeds that once failed, kept as fixed cases: 222 and 302 broke the locality of
 * *Delete row* where it moves the earlier cell of an overlap into a row whose later cell spans
 * more rows than the moved one - the cells right of the positions that cell gave up moved left
 * (data-model §4.5, FR-007, FR-035); 658 found *Duplicate row* available and changing nothing
 * on a valid table: a row of the copy lay wholly under the cell that crosses line b and grows
 * over the copy, and under copies from the rows above, and the plan gave up the whole copy
 * instead of removing that row (FR-037, FR-046; `[X rowspan 2, Y rowspan 2, Q] / [Z rowspan 2]
 * / [P, R]` from X to Y in `ops.test.ts`). 50 and 820 (*Split cell*) and 358 (a paste, whose
 * split of a crossing cell is the same) put a piece where a later cell of a row below the split
 * cell's top row overlapped it and still covers the position in a row it spans - the piece
 * pushed the cells after it to the right (FR-007, FR-035; `[a, S rowspan 3, b] / [X colspan 2
 * rowspan 2, c] / [d]` in `ops.test.ts` and `pasteBlock.test.ts`). 217, 352, 454, 615 and 924
 * found the paste oracle asking a position of a split crossing cell to keep its kind where the
 * split gives it to a later cell of the other kind that overlapped it there, and 3876 where
 * that cell, crossing T too, leaves an empty piece of its kind there (data-model §8.4 step 2,
 * §4.5 `table.splitCell`; the cases below). 945 moved, with *Move column left*, a merged cell of
 * the bands out of a row that reaches them into a row that does not, which then pushed a cell
 * outside the bands (FR-007, FR-035; data-model §4.5 `table.moveColumnLeft`; the rows a cell of
 * the bands joins move or stay together, `ops.test.ts`). 185 (*Move column right* from a caret),
 * 291 (*Move column left* from a block) and 1940 (*Move column right* from a block whose top row
 * no merged cell joins to another) found a column move available where it moved no row - each
 * row that reaches both bands joined by a merged cell of the bands to a row that does not -, now
 * refused with `merged-crosses-border` for rows (FR-037, FR-043; `[A, B rowspan 2, C] / [D]` in
 * `ops.test.ts`).
 */
const REGRESSION_SEEDS: readonly number[] = [
  222, 302, 658, 50, 820, 358, 217, 352, 454, 615, 924, 3876, 945, 185, 291, 1940,
];

const seeds = process.env.MFBE_FUZZ_SEED
  ? [Number(process.env.MFBE_FUZZ_SEED)]
  : [...FUZZ_SEEDS, ...REGRESSION_SEEDS];

describe('the seeded fuzz of SC-003 (oracle layer)', () => {
  for (const seed of seeds) {
    it(`seed ${seed}: 1,000 commands without a failure`, { timeout: 120_000 }, async () => {
      const report = await runFuzz(createStateHost(startState()), { seed, steps: 1000 });
      expect(report.failures, failureText(report)).toEqual([]);
      expect(report.steps).toBe(1000);
      expect(report.commands).toHaveLength(1000);
      // No core in vitest: nothing is validated there (the journey validates every step).
      expect(report.validations).toBe(0);
    });
  }

  it('the same seed draws the same commands', { timeout: 60_000 }, async () => {
    const first = await runFuzz(createStateHost(startState()), { seed: 6, steps: 50 });
    const second = await runFuzz(createStateHost(startState()), { seed: 6, steps: 50 });
    expect(first.failures, failureText(first)).toEqual([]);
    expect(second).toEqual(first);
    const other = await runFuzz(createStateHost(startState()), { seed: 1006, steps: 50 });
    expect(other.commands).not.toEqual(first.commands);
  });
});

describe('the oracle on minimised cases', () => {
  it('a paste whose split of a crossing cell gives a position to a later cell of the other kind that overlapped it there passes (data-model §8.4 step 2, §4.5 `table.splitCell`; fuzz seeds 217, 352, 454, 615, 924)', () => {
    // Positions from 0: S at (0, 1), rowspan 2, crosses the bottom edge of T, the position
    // (0, 1); the header cell X at (1, 0), colspan 2, runs into S's column. The split leaves
    // (1, 1) to X, a th where S was a td.
    const target = table('t', [
      [{ text: 'a' }, { text: 'S', rowspan: 2 }],
      [{ kind: 'th', text: 'X', colspan: 2 }],
    ]);
    const block = table('b', [[{ text: 'z' }]]);
    const doc = docOf(p('before', 'p1'), target, p('after', 'p2'));
    const before = EditorState.create({
      doc,
      selection: TextSelection.create(doc, pos(doc, 't-0-1') + 1),
    });
    const found = tableTarget(before)!;
    const dryRun = pasteBlockPlan(found.address, block, {
      nextId: idGenerator('n'),
      bookIds: new Set<string>(),
    });
    if (isRefusal(dryRun)) throw new Error(`refused: ${JSON.stringify(dryRun)}`);
    const after = before.apply(commitTableEdit(before.tr, found.tablePos, dryRun as TableEdit)!);
    const next = after.doc.nodeAt(found.tablePos)!;
    const grid = gridOfNode(next);
    expect(next.child(1).child(0).textContent).toBe('X');
    expect(grid.cells[grid.owner(1, 1)]!.kind).toBe('th');
    expect(grid.regular).toBe(true);
    expect(
      checkFuzzStep({
        entry: FUZZ_MIX.find((entry) => entry.name === 'pasteBlock')!,
        before,
        after,
        tablePos: found.tablePos,
        address: found.address,
        dryRun,
        answer: null,
        ran: true,
        clipboard: block,
      }),
    ).toBeNull();
  });

  it('when that later cell crosses T too, its own split leaves an empty piece of its kind there, which passes (data-model §8.4 step 2, §4.5 `table.splitCell`; fuzz seed 3876)', () => {
    // Positions from 0: the header cell A at (0, 2), rowspan 3, and B at (1, 1), colspan 2,
    // rowspan 2, which runs into A's column at (1, 2) and (2, 2), both cross the top edge of
    // T = row 2. A's split leaves (1, 2) to B, whose split puts an empty td there.
    const target = table('t', [
      [{ text: 'a' }, { text: 'b' }, { kind: 'th', text: 'A', rowspan: 3 }],
      [{ text: 'c' }, { text: 'B', colspan: 2, rowspan: 2 }],
      [{ text: 'd' }],
    ]);
    const block = table('b', [[{ text: 'z1' }, { text: 'z2' }, { text: 'z3' }]]);
    const doc = docOf(p('before', 'p1'), target, p('after', 'p2'));
    const before = EditorState.create({
      doc,
      selection: TextSelection.create(doc, pos(doc, 't-2-0') + 1),
    });
    const found = tableTarget(before)!;
    const dryRun = pasteBlockPlan(found.address, block, {
      nextId: idGenerator('n'),
      bookIds: new Set<string>(),
    });
    if (isRefusal(dryRun)) throw new Error(`refused: ${JSON.stringify(dryRun)}`);
    const after = before.apply(commitTableEdit(before.tr, found.tablePos, dryRun as TableEdit)!);
    const next = after.doc.nodeAt(found.tablePos)!;
    const grid = gridOfNode(next);
    const piece = next.child(1).child(2);
    expect(grid.cells[grid.owner(1, 2)]!.kind).toBe('td');
    expect([piece.type.name, piece.content.size]).toEqual(['td', 0]);
    expect(next.child(2).textContent).toBe('z1z2z3');
    expect(grid.regular).toBe(true);
    expect(
      checkFuzzStep({
        entry: FUZZ_MIX.find((entry) => entry.name === 'pasteBlock')!,
        before,
        after,
        tablePos: found.tablePos,
        address: found.address,
        dryRun,
        answer: null,
        ran: true,
        clipboard: block,
      }),
    ).toBeNull();
  });
});
