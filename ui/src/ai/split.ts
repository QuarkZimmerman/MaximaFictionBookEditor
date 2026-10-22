/**
 * The size rule of the assistant (feature 005 T044 / T056; ai-catalogue §3.7, §6.12; review
 * C13; FR-025, FR-035, FR-053): the token estimate `ceil(UTF-16 code units / 3)` with the
 * 4096-token reserve for the answer, applied **only** when a context length is known - the
 * editor never applies a limit of its own -, the halving of a selection along block boundaries
 * and, since T056, the one continuation protocol every read tool shares: results are cut into
 * **parts of whole units** (`read_part` / `get_selection`: the direct children of one parent;
 * `get_outline`: whole top-level entries with their subtrees; `find`: whole matches;
 * `get_schema`: whole lines), the splitter **descends** into a child that alone does not fit
 * (a huge section → its blocks, a poem → its stanzas, a table → its rows) and a single text
 * container that does not fit is `tooLarge`; every part names `from` / `to` and, when more
 * follows, `more: {cursor, remaining, hint}` with an opaque cursor (`after:<nodeId>`,
 * `offset:<n>`, `<file>:<line>`) the model copies back. The outline cut of the system message
 * and the history trimming of §6.12 steps 1 and 4 are pure helpers here too.
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

/**
 * The UTF-16 units one tool result may carry in an exchange whose other messages take
 * `fixedUnits`, for a known context length: `(contextLength − 4096) × 3 − fixedUnits`, or
 * `undefined` (no bound - results go whole) without a known length (the pre-emptive rule of
 * §3.7; `CatalogueDeps.resultBudget`).
 */
export function resultBudgetFor(
  fixedUnits: number,
  contextLength: number | undefined,
): number | undefined {
  if (contextLength === undefined || !Number.isFinite(contextLength) || contextLength <= 0) {
    return undefined;
  }
  return Math.max(0, (contextLength - ANSWER_RESERVE_TOKENS) * 3 - Math.max(0, fixedUnits));
}

/* ------------------------------------------------------------------------ */
/* Selection halving (§6.12 step 3)                                          */
/* ------------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------------ */
/* Cursors (§3.7: opaque to the model, which copies them back)                */
/* ------------------------------------------------------------------------ */

/** The three cursor forms: `after:<nodeId>`, `offset:<n>`, `<file>:<line>`. */
export type Cursor =
  | { kind: 'after'; nodeId: string }
  | { kind: 'offset'; offset: number }
  | { kind: 'line'; file: string; line: number };

/** The cursor string of a `Cursor`. */
export function encodeCursor(cursor: Cursor): string {
  switch (cursor.kind) {
    case 'after':
      return `after:${cursor.nodeId}`;
    case 'offset':
      return `offset:${cursor.offset}`;
    case 'line':
      return `${cursor.file}:${cursor.line}`;
  }
}

/**
 * Parses a cursor string: `after:<nodeId>` (a non-empty id), `offset:<n>` (a non-negative
 * integer), `<file>:<line>` (a file name and a non-negative line number, the file name holding
 * no `:`); `null` for anything else (the caller answers `invalidArguments`).
 */
export function decodeCursor(text: string): Cursor | null {
  if (typeof text !== 'string') return null;
  const after = /^after:(.+)$/.exec(text);
  if (after) return { kind: 'after', nodeId: after[1]! };
  const offset = /^offset:(\d{1,15})$/.exec(text);
  if (offset) return { kind: 'offset', offset: Number(offset[1]) };
  const line = /^([^:\s]+):(\d{1,15})$/.exec(text);
  if (line) return { kind: 'line', file: line[1]!, line: Number(line[2]) };
  return null;
}

/* ------------------------------------------------------------------------ */
/* Parts of whole units                                                      */
/* ------------------------------------------------------------------------ */

/** What one part is cut from: the units taken and the ones that follow. */
export interface Partition<T> {
  taken: T[];
  rest: T[];
}

export interface PartitionOptions<T> {
  /** The size of one unit as it travels (UTF-16 units of its JSON / XML, roughly). */
  sizeOf: (unit: T) => number;
  /** The budget of the whole part; `undefined` = no bound, everything is taken (FR-053). */
  limit: number | undefined;
  /** The part's fixed cost (the envelope around the units); default 0. */
  fixed?: number;
  /**
   * `true` (default): a first unit that alone exceeds the budget is **not** taken - the caller
   * descends into it or answers `tooLarge`. `false`: it is taken whole anyway (the outline's
   * and `find`'s units are never split further).
   */
  strict?: boolean;
}

/**
 * Takes whole units from the front of `units` while their sizes, with the fixed cost, stay
 * within `limit` (the unit of splitting is a block, a match, an entry or a line - never a
 * part of one). Without a limit everything is taken.
 */
export function partition<T>(units: readonly T[], options: PartitionOptions<T>): Partition<T> {
  const { sizeOf, limit } = options;
  if (limit === undefined || !Number.isFinite(limit)) return { taken: [...units], rest: [] };
  const strict = options.strict ?? true;
  const taken: T[] = [];
  let used = options.fixed ?? 0;
  for (const unit of units) {
    const size = sizeOf(unit);
    if (used + size > limit && (taken.length > 0 || strict)) break;
    taken.push(unit);
    used += size;
  }
  return { taken, rest: units.slice(taken.length) };
}

/** The outcome of `partitionTree`: a part under `parent`, or one leaf too large for any part. */
export type TreePartOutcome<T> =
  | { kind: 'part'; parent: T; taken: T[]; rest: T[]; descended: boolean }
  | { kind: 'tooLarge'; unit: T };

export interface TreePartitionOptions<T> extends Omit<PartitionOptions<T>, 'strict'> {
  /** True for a unit the splitter never descends into (a text container, an image, …). */
  isLeaf: (unit: T) => boolean;
  /** The direct children of a unit (the next level's units). */
  childrenOf: (unit: T) => T[];
}

/**
 * The first part of `units` (the direct children of `parent`) by the descent rule of §3.7:
 * whole units from the front within the budget; when the first unit alone does not fit the
 * splitter descends into it - that unit becomes the part's `parent` and its children the
 * units -, and a leaf that does not fit is `tooLarge`. `descended` tells whether the part's
 * parent is below the one given.
 */
export function partitionTree<T>(
  parent: T,
  units: readonly T[],
  options: TreePartitionOptions<T>,
): TreePartOutcome<T> {
  let current = parent;
  let pending: readonly T[] = units;
  let descended = false;
  for (;;) {
    const { taken, rest } = partition(pending, { ...options, strict: true });
    if (taken.length > 0 || pending.length === 0) {
      return { kind: 'part', parent: current, taken, rest, descended };
    }
    const first = pending[0]!;
    if (options.isLeaf(first)) return { kind: 'tooLarge', unit: first };
    descended = true;
    current = first;
    pending = options.childrenOf(first);
  }
}

/** The `more` member of a part (§3.7): the cursor, what remains and how to continue. */
export interface More {
  cursor: string;
  remaining: Record<string, number>;
  hint: string;
}

/** The hint every `more` carries: more follows, call the tool again with this cursor. */
export function moreHint(tool: string): string {
  return `More follows: call ${tool} again with the same arguments and this cursor for the next part.`;
}

export function moreOf(tool: string, cursor: Cursor, remaining: Record<string, number>): More {
  return { cursor: encodeCursor(cursor), remaining, hint: moreHint(tool) };
}

/* ------------------------------------------------------------------------ */
/* The outline cut and the history trimming (§6.12 steps 1 and 4)            */
/* ------------------------------------------------------------------------ */

/** What the outline cut needs of an entry: its id and the characters below it. */
export interface OutlineUnit {
  id: string;
  characters: number;
}

export type OutlineCut<E extends OutlineUnit> =
  { ok: true; entries: E[]; more?: More } | { ok: false; code: 'oversize'; entry: E };

/**
 * Cuts the outline of the system message to its first top-level entries, whole subtrees,
 * halving until `fits` accepts the prefix (§6.12 step 4; `fits` judges the entries' rendered
 * size together with the rest of the exchange). A cut outline carries `more` with the cursor
 * `after:<id of the last entry>` for `get_outline`. One top-level entry that alone does not fit
 * is `oversize`: the caller falls back to the bodies alone (`depth` 1) and, when that is still
 * refused, fails with the service's message.
 */
export function cutOutline<E extends OutlineUnit>(
  entries: readonly E[],
  fits: (prefix: readonly E[]) => boolean,
): OutlineCut<E> {
  if (entries.length === 0 || fits(entries)) return { ok: true, entries: [...entries] };
  let prefix: E[] = [...entries];
  while (prefix.length > 1 && !fits(prefix)) prefix = halve(prefix)[0];
  if (!fits(prefix)) return { ok: false, code: 'oversize', entry: prefix[0]! };
  const rest = entries.slice(prefix.length);
  return {
    ok: true,
    entries: prefix,
    more: moreOf(
      'get_outline',
      { kind: 'after', nodeId: prefix[prefix.length - 1]!.id },
      {
        entries: rest.length,
        characters: rest.reduce((sum, entry) => sum + entry.characters, 0),
      },
    ),
  };
}

/** The outcome of `trimTurns`: the turns kept and how many of the oldest were left out. */
export interface TrimmedTurns<T> {
  turns: T[];
  dropped: number;
}

/**
 * Trims the conversation's earlier turns, **oldest first, one at a time**, while any remain and
 * `fits` refuses the exchange carrying them (§6.12 step 1, FR-025). `dropped` feeds the
 * `history.trimmed` entry and the panel's "the oldest N turns were left out" notice; when no
 * turn is left and the exchange still does not fit, the caller goes on to step 2 (the
 * request's own growth).
 */
export function trimTurns<T>(
  turns: readonly T[],
  fits: (kept: readonly T[]) => boolean,
): TrimmedTurns<T> {
  let kept: T[] = [...turns];
  let dropped = 0;
  while (kept.length > 0 && !fits(kept)) {
    kept = kept.slice(1);
    dropped += 1;
  }
  return { turns: kept, dropped };
}
