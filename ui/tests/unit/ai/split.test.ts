// @vitest-environment node
/**
 * The size rule (feature 005 T041, T051 / T056; ai-catalogue §3.7, §6.12; review C13; FR-025,
 * FR-035, FR-053): a selection halved along block boundaries - never cut inside a paragraph,
 * order kept -, one oversize block → `tooLarge`, the estimate `ceil(UTF-16 units / 3)` with the
 * 4096 reserve applied only with a known context length; the continuation protocol's parts of
 * whole units with descent into a huge child, the cursors `after:<nodeId>` / `offset:<n>` /
 * `<file>:<line>` round-tripping, the outline cut at top-level entries with `more`, and the
 * history trimming oldest first with the count of turns left out.
 */

import {
  ANSWER_RESERVE_TOKENS,
  cutOutline,
  decodeCursor,
  encodeCursor,
  estimateTokens,
  fitsContext,
  halve,
  moreOf,
  partition,
  partitionTree,
  resultBudgetFor,
  splitSelection,
  splitSelectionForContext,
  trimTurns,
  type Cursor,
} from '@/ai/split';

const block = (id: string, units: number) => ({ id, units });

describe('the token estimate', () => {
  it('is ceil(UTF-16 code units / 3)', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('abcd')).toBe(2);
    // Cyrillic letters are one UTF-16 unit each; an astral character two.
    expect(estimateTokens('Привет')).toBe(2);
    expect(estimateTokens('😀')).toBe(1);
  });

  it('applies the 4096 reserve only with a known context length', () => {
    expect(ANSWER_RESERVE_TOKENS).toBe(4096);
    expect(fitsContext(10_000_000, undefined)).toBe(true);
    expect(fitsContext(3 * (8192 - 4096), 8192)).toBe(true);
    expect(fitsContext(3 * (8192 - 4096) + 1, 8192)).toBe(false);
    expect(fitsContext(0, 0)).toBe(true); // an unusable length is no length
  });
});

describe('splitSelection', () => {
  const blocks = [
    block('a', 100),
    block('b', 100),
    block('c', 100),
    block('d', 100),
    block('e', 100),
  ];

  it('keeps a selection that fits as one part', () => {
    expect(splitSelection(blocks, () => true)).toEqual({ ok: true, parts: [blocks] });
    expect(splitSelection([], () => false)).toEqual({ ok: true, parts: [[]] });
  });

  it('halves along block boundaries, order kept, until every part fits', () => {
    const outcome = splitSelection(blocks, (units) => units <= 200);
    expect(outcome.ok).toBe(true);
    const parts = (outcome as { parts: { id: string; units: number }[][] }).parts;
    expect(parts.map((part) => part.map((b) => b.id))).toEqual([['a', 'b'], ['c'], ['d', 'e']]);
    expect(parts.flat().map((b) => b.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    for (const part of parts)
      expect(part.reduce((s, b) => s + b.units, 0)).toBeLessThanOrEqual(200);
  });

  it('never cuts inside a block: one block that alone does not fit is tooLarge', () => {
    const outcome = splitSelection(
      [block('a', 50), block('big', 500), block('c', 50)],
      (units) => units <= 200,
    );
    expect(outcome).toEqual({ ok: false, code: 'tooLarge', block: block('big', 500) });
  });

  it('halve gives the first half the extra block', () => {
    expect(halve([1, 2, 3])).toEqual([[1, 2], [3]]);
    expect(halve([1])).toEqual([[1], []]);
  });
});

describe('splitSelectionForContext', () => {
  it('splits nothing without a known context length (FR-053)', () => {
    const blocks = [block('a', 1_000_000), block('b', 1_000_000)];
    expect(splitSelectionForContext(blocks, 5000, undefined)).toEqual({
      ok: true,
      parts: [blocks],
    });
  });

  it('splits against contextLength − 4096 tokens including the fixed cost of the exchange', () => {
    // 8192 tokens → 4096 for content → 12288 units; the fixed cost takes 3000 of them.
    const blocks = [block('a', 6000), block('b', 6000), block('c', 6000)];
    const outcome = splitSelectionForContext(blocks, 3000, 8192);
    expect(outcome.ok).toBe(true);
    expect((outcome as { parts: { id: string }[][] }).parts.map((p) => p.map((b) => b.id))).toEqual(
      [['a'], ['b'], ['c']],
    );
    expect(splitSelectionForContext([block('huge', 20_000)], 0, 8192)).toMatchObject({
      ok: false,
      code: 'tooLarge',
    });
  });
});

describe('the result budget of the pre-emptive rule (§3.7)', () => {
  it('is undefined without a known context length and (contextLength − 4096) × 3 − fixed with one', () => {
    expect(resultBudgetFor(1000, undefined)).toBeUndefined();
    expect(resultBudgetFor(1000, 0)).toBeUndefined();
    expect(resultBudgetFor(1000, Number.NaN)).toBeUndefined();
    expect(resultBudgetFor(0, 8192)).toBe(4096 * 3);
    expect(resultBudgetFor(3000, 8192)).toBe(4096 * 3 - 3000);
    expect(resultBudgetFor(100_000, 8192)).toBe(0); // never negative
  });
});

describe('cursors (§3.7: opaque to the model, copied back)', () => {
  it('round-trips the three forms', () => {
    const cursors: Cursor[] = [
      { kind: 'after', nodeId: 'n42' },
      { kind: 'after', nodeId: 'sc_7' },
      { kind: 'offset', offset: 0 },
      { kind: 'offset', offset: 1234 },
      { kind: 'line', file: 'FictionBook.xsd', line: 120 },
      { kind: 'line', file: 'FictionBookGenres.xsd', line: 0 },
    ];
    for (const cursor of cursors) {
      expect(decodeCursor(encodeCursor(cursor)), JSON.stringify(cursor)).toEqual(cursor);
    }
    expect(encodeCursor({ kind: 'after', nodeId: 'n42' })).toBe('after:n42');
    expect(encodeCursor({ kind: 'offset', offset: 12 })).toBe('offset:12');
    expect(encodeCursor({ kind: 'line', file: 'FictionBook.xsd', line: 3 })).toBe(
      'FictionBook.xsd:3',
    );
  });

  it('rejects anything that is not one of the forms', () => {
    for (const text of [
      '',
      'after:',
      'offset:',
      'offset:-1',
      'offset:x',
      'nope',
      ':12',
      'a b:3',
      'FictionBook.xsd',
    ]) {
      expect(decodeCursor(text), text).toBeNull();
    }
    expect(decodeCursor('offset:007')).toEqual({ kind: 'offset', offset: 7 });
  });
});

describe('partition (parts of whole units)', () => {
  const units = [block('a', 100), block('b', 100), block('c', 100)];
  const sizeOf = (u: { units: number }) => u.units;

  it("takes everything without a limit (FR-053: nothing is pre-split on the editor's own)", () => {
    expect(partition(units, { sizeOf, limit: undefined })).toEqual({ taken: units, rest: [] });
    expect(partition(units, { sizeOf, limit: Number.POSITIVE_INFINITY })).toEqual({
      taken: units,
      rest: [],
    });
  });

  it('takes whole units from the front within the limit, counting the fixed cost', () => {
    expect(partition(units, { sizeOf, limit: 250 })).toEqual({
      taken: [units[0], units[1]],
      rest: [units[2]],
    });
    expect(partition(units, { sizeOf, limit: 250, fixed: 60 })).toEqual({
      taken: [units[0]],
      rest: [units[1], units[2]],
    });
    expect(partition(units, { sizeOf, limit: 300 })).toEqual({ taken: units, rest: [] });
    expect(partition([], { sizeOf, limit: 10 })).toEqual({ taken: [], rest: [] });
  });

  it('strict: a first unit that alone exceeds the limit is not taken; non-strict takes it whole', () => {
    const big = [block('big', 500), block('b', 10)];
    expect(partition(big, { sizeOf, limit: 200 })).toEqual({ taken: [], rest: big });
    expect(partition(big, { sizeOf, limit: 200, strict: false })).toEqual({
      taken: [big[0]],
      rest: [big[1]],
    });
  });
});

describe('partitionTree (descent into a huge child, §3.7)', () => {
  interface Unit {
    id: string;
    size: number;
    leaf: boolean;
    children: Unit[];
  }
  const leaf = (id: string, size: number): Unit => ({ id, size, leaf: true, children: [] });
  const node = (id: string, children: Unit[]): Unit => ({
    id,
    size: children.reduce((s, c) => s + c.size, 0) + 10,
    leaf: false,
    children,
  });
  const poem = node('poem', [
    node('stanza1', [leaf('v1', 80), leaf('v2', 80)]),
    node('stanza2', [leaf('v3', 80), leaf('v4', 80)]),
  ]);
  const section = node('section', [node('title', [leaf('t', 20)]), poem, leaf('p', 50)]);
  const options = (limit: number | undefined) => ({
    sizeOf: (u: Unit) => u.size,
    limit,
    fixed: 0,
    isLeaf: (u: Unit) => u.leaf,
    childrenOf: (u: Unit) => u.children,
  });
  const ids = (units: Unit[]) => units.map((u) => u.id);

  it('takes the direct children whole when they fit', () => {
    const out = partitionTree(section, section.children, options(undefined));
    expect(out.kind).toBe('part');
    if (out.kind !== 'part') return;
    expect(out.parent).toBe(section);
    expect(ids(out.taken)).toEqual(['title', 'poem', 'p']);
    expect(out.rest).toEqual([]);
    expect(out.descended).toBe(false);
  });

  it('cuts between direct children first; descends into a child that alone does not fit', () => {
    const first = partitionTree(section, section.children, options(200));
    expect(first).toMatchObject({ kind: 'part', descended: false });
    if (first.kind !== 'part') return;
    expect(ids(first.taken)).toEqual(['title']);
    expect(ids(first.rest)).toEqual(['poem', 'p']);
    // The next part starts at the poem, which alone does not fit: its stanzas are the units.
    const second = partitionTree(section, first.rest, options(200));
    expect(second).toMatchObject({ kind: 'part', descended: true });
    if (second.kind !== 'part') return;
    expect(second.parent.id).toBe('poem');
    expect(ids(second.taken)).toEqual(['stanza1']);
    expect(ids(second.rest)).toEqual(['stanza2']);
    // Two levels down when a stanza does not fit either: its verses, one per part.
    const deep = partitionTree(section, first.rest, options(100));
    expect(deep).toMatchObject({ kind: 'part', descended: true });
    if (deep.kind !== 'part') return;
    expect(deep.parent.id).toBe('stanza1');
    expect(ids(deep.taken)).toEqual(['v1']);
    expect(ids(deep.rest)).toEqual(['v2']);
  });

  it('a single leaf that does not fit is tooLarge, never cut', () => {
    expect(partitionTree(section, section.children, options(15))).toEqual({
      kind: 'tooLarge',
      unit: leaf('t', 20),
    });
    expect(partitionTree(poem, [leaf('huge', 1000)], options(999))).toEqual({
      kind: 'tooLarge',
      unit: leaf('huge', 1000),
    });
    // An empty unit list is an empty part, not an error.
    expect(partitionTree(poem, [], options(10))).toMatchObject({
      kind: 'part',
      taken: [],
      rest: [],
    });
  });
});

describe('moreOf', () => {
  it('carries the cursor, what remains and the hint naming the tool', () => {
    const more = moreOf(
      'read_part',
      { kind: 'after', nodeId: 'n7' },
      { blocks: 3, characters: 900 },
    );
    expect(more).toEqual({
      cursor: 'after:n7',
      remaining: { blocks: 3, characters: 900 },
      hint: expect.stringContaining('read_part'),
    });
    expect(more.hint).toMatch(/More follows/);
    expect(moreOf('find', { kind: 'offset', offset: 40 }, { matches: 260 }).cursor).toBe(
      'offset:40',
    );
  });
});

describe('cutOutline (§6.12 step 4)', () => {
  const entry = (id: string, characters: number) => ({ id, characters, children: [] });
  const entries = [entry('b1', 400), entry('b2', 400), entry('b3', 400), entry('b4', 400)];
  const within = (limit: number) => (prefix: readonly { characters: number }[]) =>
    prefix.reduce((s, e) => s + e.characters, 0) <= limit;

  it('keeps an outline that fits whole, without more', () => {
    expect(cutOutline(entries, within(2000))).toEqual({ ok: true, entries });
    expect(cutOutline([], within(0))).toEqual({ ok: true, entries: [] });
  });

  it('halves at top-level entries until the prefix fits and says how to get the rest', () => {
    const cut = cutOutline(entries, within(900));
    expect(cut.ok).toBe(true);
    if (!cut.ok) return;
    expect(cut.entries.map((e) => e.id)).toEqual(['b1', 'b2']);
    expect(cut.more).toEqual({
      cursor: 'after:b2',
      remaining: { entries: 2, characters: 800 },
      hint: expect.stringContaining('get_outline'),
    });
    const one = cutOutline(entries, within(400));
    expect(one.ok && one.entries.map((e) => e.id)).toEqual(['b1']);
    expect(one.ok && one.more?.cursor).toBe('after:b1');
  });

  it('one top-level entry that alone does not fit is oversize (the caller falls back to the bodies alone)', () => {
    expect(cutOutline(entries, within(100))).toEqual({
      ok: false,
      code: 'oversize',
      entry: entries[0],
    });
  });
});

describe('trimTurns (§6.12 step 1, FR-025)', () => {
  const turns = ['t1', 't2', 't3', 't4'];

  it('drops nothing when the exchange fits', () => {
    expect(trimTurns(turns, () => true)).toEqual({ turns, dropped: 0 });
    expect(trimTurns([], () => false)).toEqual({ turns: [], dropped: 0 });
  });

  it('drops the oldest turns first, one at a time, and counts them', () => {
    expect(trimTurns(turns, (kept) => kept.length <= 2)).toEqual({
      turns: ['t3', 't4'],
      dropped: 2,
    });
    expect(trimTurns(turns, (kept) => kept.length <= 3)).toEqual({
      turns: ['t2', 't3', 't4'],
      dropped: 1,
    });
  });

  it("drops every turn when nothing fits - the caller goes on to the request's own content", () => {
    expect(trimTurns(turns, () => false)).toEqual({ turns: [], dropped: 4 });
  });
});
