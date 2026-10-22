/**
 * The size rule of the assistant (feature 005 T044; ai-catalogue §3.7, §6.12 step 3; review
 * C13; FR-035, FR-053): the token estimate `ceil(UTF-16 code units / 3)` with the 4096-token
 * reserve for the answer, applied **only** when a context length is known - the editor never
 * applies a limit of its own - and the halving of a selection along block boundaries: a part
 * is a run of whole sibling blocks (`p`, `v`, `subtitle`, … are never cut); a single block that
 * alone does not fit is `tooLarge` (FR-035: reported and left unchanged). US3's T056 extends
 * this module with the splitting of tool results, the outline and the history.
 */

/** Tokens kept free for the model's answer (ai-catalogue §3.7). */
export const ANSWER_RESERVE_TOKENS = 4096;

/** `tokens ≈ ceil(UTF-16 units / 3)` (R3 §6.8 measured 2.1–3.5 units per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/**
 * Whether an exchange of `units` UTF-16 code units fits a context length: without a known
 * length always (FR-053 - nothing is pre-split), else when the estimate stays within
 * `contextLength − 4096`.
 */
export function fitsContext(units: number, contextLength: number | undefined): boolean {
  if (contextLength === undefined || !Number.isFinite(contextLength) || contextLength <= 0) {
    return true;
  }
  return Math.ceil(units / 3) <= contextLength - ANSWER_RESERVE_TOKENS;
}

/** A block of a selection as the splitter sees it: its id and the size of its FB2 form. */
export interface SizedBlock {
  id: string;
  /** UTF-16 code units of the block as it travels (its FB2 XML). */
  units: number;
}

export type SplitOutcome<B extends SizedBlock> =
  { ok: true; parts: B[][] } | { ok: false; code: 'tooLarge'; block: B };

/** Halves a list of blocks along a block boundary (the first half gets the extra block). */
export function halve<B>(blocks: readonly B[]): [B[], B[]] {
  const middle = Math.ceil(blocks.length / 2);
  return [blocks.slice(0, middle), blocks.slice(middle)];
}

/**
 * Splits a selection into parts that each fit `fits` (a predicate over the UTF-16 units a part
 * carries - the caller adds the exchange's fixed cost): halving by blocks until every part
 * fits, order kept, never cutting inside a block. A single block that does not fit alone ends
 * the split with `tooLarge` naming it. An empty selection is one empty part.
 */
export function splitSelection<B extends SizedBlock>(
  blocks: readonly B[],
  fits: (units: number) => boolean,
): SplitOutcome<B> {
  const total = (part: readonly B[]) => part.reduce((sum, block) => sum + block.units, 0);
  const parts: B[][] = [];
  const pending: B[][] = [[...blocks]];
  while (pending.length > 0) {
    const part = pending.shift()!;
    if (fits(total(part)) || part.length === 0) {
      parts.push(part);
      continue;
    }
    if (part.length === 1) return { ok: false, code: 'tooLarge', block: part[0]! };
    const [left, right] = halve(part);
    pending.unshift(left, right);
  }
  return { ok: true, parts };
}

/**
 * The parts of a selection for a known context length: every part's FB2 form, together with
 * `fixedUnits` (the system message, the instruction and the rest of the exchange), must fit
 * `contextLength − 4096` tokens. Without a context length the selection is one part.
 */
export function splitSelectionForContext<B extends SizedBlock>(
  blocks: readonly B[],
  fixedUnits: number,
  contextLength: number | undefined,
): SplitOutcome<B> {
  if (contextLength === undefined) return { ok: true, parts: [[...blocks]] };
  return splitSelection(blocks, (units) => fitsContext(fixedUnits + units, contextLength));
}
