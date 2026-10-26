/**
 * The seeded fuzz of SC-003, the oracle layer (feature 006, US2 T073; FR-035, FR-045, FR-046;
 * C76; data-model §16.4; quickstart §2, §13; research R1.12, R8.15): 1,000 random commands per
 * seed of `FUZZ_SEEDS` - or the seed `MFBE_FUZZ_SEED` alone (`MFBE_FUZZ_SEED=<n> npx vitest run
 * tests/unit/editor/table/fuzz.test.ts`) - through an `EditorState` made by
 * `createBodyEditorState`, with every Body plugin, the table plugin included, and history; every
 * step checked by the generator's oracle. A failure prints its seed, step, command, selection
 * and the table before and after it as model JSON.
 */

/// <reference types="node" />
import { fb2Schema } from '@/editor/schema';
import { FUZZ_SEEDS, createStateHost, runFuzz, type FuzzReport } from '@/editor/table/testing/fuzz';
import { createBodyEditorState } from '@/views/body/bodyEditor';

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

const seeds = process.env.MFBE_FUZZ_SEED ? [Number(process.env.MFBE_FUZZ_SEED)] : FUZZ_SEEDS;

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
