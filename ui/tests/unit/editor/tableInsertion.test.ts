/**
 * The placement rule of FR-004 (feature 006, T051; I9; C3, C25, C26; decision 4; data-model
 * §7.1, §7.2; quickstart §1, §13 "placement and availability"; research R2.10, R2.17):
 * `findTablePoint` and `findTablePointAt` over the matrix of FR-004 (a) to (c), a selected
 * block image, a non-empty selection; `applyTablePoint` with `createTable` (the halves of a
 * split, the caret in the first cell, `[caption paragraph, table]`, `scrollIntoView`); every
 * result valid; and SC-002's unit oracle - a seeded property test over random valid documents
 * at every caret position against the candidates of C26, written here independently of the
 * module.
 */

import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { EditorState, NodeSelection, Selection, TextSelection } from 'prosemirror-state';

import {
  applyTablePoint,
  findTablePoint,
  findTablePointAt,
  headingEnd,
  insertTableCommand,
  type TablePoint,
} from '@/editor/commands/tableInsertion';
import { fb2Schema, FIXED_BLOCK_IDS, findNodeById } from '@/editor/schema';
import { createTable } from '@/editor/table/ops';

const N = fb2Schema.nodes;

/* ------------------------------------------------------------------------ */
/* Builders                                                                 */
/* ------------------------------------------------------------------------ */

type Attrs = Record<string, unknown>;

const text = (value: string) => (value ? fb2Schema.text(value) : undefined);
const p = (nodeId: string, value = '', attrs: Attrs = {}) =>
  N.p!.create({ nodeId, ...attrs }, text(value));
const subtitle = (nodeId: string, value = '') => N.subtitle!.create({ nodeId }, text(value));
const ta = (nodeId: string, value = 'Author') => N.text_author!.create({ nodeId }, text(value));
const v = (nodeId: string, value = 'Line') => N.v!.create({ nodeId }, text(value));
const title = (nodeId: string, ...lines: PMNode[]) => N.title!.create({ nodeId }, lines);
const epigraph = (nodeId: string, ...children: PMNode[]) =>
  N.epigraph!.create({ nodeId }, children);
const cite = (nodeId: string, ...children: PMNode[]) => N.cite!.create({ nodeId }, children);
const annotation = (nodeId: string, ...children: PMNode[]) =>
  N.annotation!.create({ nodeId }, children);
const image = (nodeId: string) => N.image!.create({ nodeId, href: '#i.png' });
const section = (nodeId: string, ...children: PMNode[]) => N.section!.create({ nodeId }, children);
const td = (nodeId: string, value = '') => N.td!.create({ nodeId }, text(value));
const table = (nodeId: string, ...rows: PMNode[][]) =>
  N.table!.create(
    { nodeId },
    rows.map((cells, index) => N.tr!.create({ nodeId: `${nodeId}-r${index}` }, cells)),
  );
const poem = (nodeId: string, ...children: PMNode[]) => N.poem!.create({ nodeId }, children);
const stanza = (nodeId: string, ...verses: PMNode[]) => N.stanza!.create({ nodeId }, verses);

/** A book with every kind of place FR-004 names (checked valid). */
function placementBook(): PMNode {
  const doc = N.doc!.createChecked(null, [
    N.annotation_block!.create({ nodeId: FIXED_BLOCK_IDS.annotation }, [
      p('ann', 'Annotation text'),
    ]),
    N.history_block!.create({ nodeId: FIXED_BLOCK_IDS.history }, [p('hist', 'History text')]),
    N.body!.create({ nodeId: 'b' }, [
      title('bt', p('btp', 'Book')),
      epigraph(
        'be',
        p('bep', 'Body epigraph'),
        cite('bec', p('becp', 'Cite in the epigraph'), ta('beca')),
      ),
      section(
        's1',
        title('s1t', p('s1tp', 'One')),
        p('p1', 'First paragraph'),
        p('pid', 'Split me here', { id: 'x1', style: 'lead', lang: 'en' }),
        p('pe'),
        subtitle('st'),
        subtitle('sn', 'Sub'),
        poem('poem', stanza('stz', v('v1')), ta('pta', 'Poet')),
        cite('c1', p('c1p', 'Quote'), ta('c1a', 'Cited')),
        table('t1', [td('ca', 'a'), td('cb', 'b')]),
        p('p9', 'Last'),
        image('img1'),
      ),
      section(
        's2',
        title('s2t', p('s2tp', 'Two')),
        epigraph('s2e', p('s2ep', 'Epigraph')),
        image('himg'),
        annotation('s2a', p('s2ap', 'Section annotation')),
        p('s2p', 'Text'),
      ),
      section('s3', title('s3t', p('s3tp', 'Parent')), section('s31', p('s31p', 'Child'))),
    ]),
  ]);
  doc.check();
  return doc;
}

const before = (doc: PMNode, nodeId: string) => findNodeById(doc, nodeId)!.pos;
const after = (doc: PMNode, nodeId: string) => {
  const found = findNodeById(doc, nodeId)!;
  return found.pos + found.node.nodeSize;
};
/** The position at `offset` inside the text block `nodeId`. */
const inside = (doc: PMNode, nodeId: string, offset = 0) => before(doc, nodeId) + 1 + offset;
const endIn = (doc: PMNode, nodeId: string) =>
  inside(doc, nodeId, findNodeById(doc, nodeId)!.node.content.size);

function stateAt(doc: PMNode, selection: Selection): EditorState {
  return EditorState.create({ doc, selection });
}

function counter(prefix = 'n'): () => string {
  let next = 1;
  return () => `${prefix}${next++}`;
}

function names(node: PMNode): string[] {
  const out: string[] = [];
  node.forEach((child) => out.push(child.type.name));
  return out;
}

/* ------------------------------------------------------------------------ */
/* The matrix of FR-004                                                     */
/* ------------------------------------------------------------------------ */

describe('findTablePoint: (a) at the caret of a paragraph or a subtitle', () => {
  const doc = placementBook();

  it('replaces an empty paragraph, goes before a block at its start and after it at its end', () => {
    expect(findTablePoint(doc, inside(doc, 'pe'))).toEqual({
      kind: 'replace',
      from: before(doc, 'pe'),
      to: after(doc, 'pe'),
    });
    expect(findTablePoint(doc, inside(doc, 'p1'))).toEqual({
      kind: 'insert',
      pos: before(doc, 'p1'),
    });
    expect(findTablePoint(doc, inside(doc, 'sn'))).toEqual({
      kind: 'insert',
      pos: before(doc, 'sn'),
    });
    expect(findTablePoint(doc, endIn(doc, 'p1'))).toEqual({
      kind: 'insert',
      pos: after(doc, 'p1'),
    });
    expect(findTablePoint(doc, endIn(doc, 'sn'))).toEqual({
      kind: 'insert',
      pos: after(doc, 'sn'),
    });
  });

  it('puts the table after an empty subtitle - "before" is for a non-empty block only (C25)', () => {
    expect(findTablePoint(doc, inside(doc, 'st'))).toEqual({
      kind: 'insert',
      pos: after(doc, 'st'),
    });
  });

  it('splits a block in its middle (sc.2)', () => {
    const at = inside(doc, 'pid', 5);
    expect(findTablePoint(doc, at)).toEqual({ kind: 'split', pos: at });
  });

  it('takes a table inside a cite of an epigraph and inside the Body view’s blocks', () => {
    expect(findTablePoint(doc, endIn(doc, 'becp'))).toEqual({
      kind: 'insert',
      pos: after(doc, 'becp'),
    });
    expect(findTablePoint(doc, endIn(doc, 'ann'))).toEqual({
      kind: 'insert',
      pos: after(doc, 'ann'),
    });
    expect(findTablePoint(doc, inside(doc, 'hist'))).toEqual({
      kind: 'insert',
      pos: before(doc, 'hist'),
    });
    expect(findTablePoint(doc, endIn(doc, 's2ap'))).toEqual({
      kind: 'insert',
      pos: after(doc, 's2ap'),
    });
  });
});

describe('findTablePoint: (b) the nearest following point, outwards', () => {
  const doc = placementBook();

  it("goes from a section's title or epigraph to the first point after its heading part (C3)", () => {
    expect(findTablePoint(doc, inside(doc, 's1tp', 1))).toEqual({
      kind: 'insert',
      pos: before(doc, 'p1'),
    });
    // A heading image and an annotation: the table after the annotation, the image stays the
    // heading image.
    for (const id of ['s2tp', 's2ep']) {
      expect(findTablePoint(doc, inside(doc, id, 2)), id).toEqual({
        kind: 'insert',
        pos: before(doc, 's2p'),
      });
    }
    expect(headingEnd(findNodeById(doc, 's2')!.node)).toBe(4);
    expect(headingEnd(findNodeById(doc, 's1')!.node)).toBe(1);
    expect(headingEnd(findNodeById(doc, 's31')!.node)).toBe(0);
  });

  it('goes after a poem from its lines, after a cite from its text-author line, after a table from a cell', () => {
    for (const id of ['v1', 'pta']) {
      expect(findTablePoint(doc, inside(doc, id, 1)), id).toEqual({
        kind: 'insert',
        pos: after(doc, 'poem'),
      });
    }
    expect(findTablePoint(doc, inside(doc, 'c1a'))).toEqual({
      kind: 'insert',
      pos: after(doc, 'c1'),
    });
    expect(findTablePoint(doc, inside(doc, 'ca', 1))).toEqual({
      kind: 'insert',
      pos: after(doc, 't1'),
    });
  });

  it("searches a rich field's annotation document last", () => {
    const field = N.annotation!.createChecked({ nodeId: 'f' }, [
      p('fp', 'Field'),
      cite('fc', p('fcp', 'Quote'), ta('fca')),
      poem('fpoem', stanza('fs', v('fv'))),
    ]);
    expect(findTablePoint(field, endIn(field, 'fp'))).toEqual({
      kind: 'insert',
      pos: after(field, 'fp'),
    });
    expect(findTablePoint(field, inside(field, 'fca'))).toEqual({
      kind: 'insert',
      pos: after(field, 'fc'),
    });
    expect(findTablePoint(field, inside(field, 'fv'))).toEqual({
      kind: 'insert',
      pos: after(field, 'fpoem'),
    });
  });
});

describe('findTablePoint: (c) no point', () => {
  const doc = placementBook();

  it('finds none in the title of a section with subsections, the body’s title and a paragraph of its epigraph', () => {
    expect(findTablePoint(doc, inside(doc, 's3tp', 2))).toBeNull();
    expect(findTablePoint(doc, inside(doc, 'btp'))).toBeNull();
    expect(findTablePoint(doc, endIn(doc, 'btp'))).toBeNull();
    expect(findTablePoint(doc, inside(doc, 'bep', 3))).toBeNull();
    // The cite of that epigraph's text-author line: nothing after the cite in an epigraph.
    expect(findTablePoint(doc, inside(doc, 'beca'))).toBeNull();
  });
});

describe('findTablePointAt: the selection’s end', () => {
  const doc = placementBook();

  it('takes the gap after a selected block image, the heading part skipped', () => {
    const content = stateAt(doc, NodeSelection.create(doc, before(doc, 'img1')));
    expect(findTablePointAt(content)).toEqual({ kind: 'insert', pos: after(doc, 'img1') });
    const heading = stateAt(doc, NodeSelection.create(doc, before(doc, 'himg')));
    expect(findTablePointAt(heading)).toEqual({ kind: 'insert', pos: before(doc, 's2p') });
  });

  it('uses the end of a non-empty selection and insertTableCommand keeps the selected text (decision 4)', () => {
    const from = inside(doc, 'p1', 6);
    const to = inside(doc, 'pid', 5);
    const state = stateAt(doc, TextSelection.create(doc, from, to));
    expect(findTablePointAt(state)).toEqual({ kind: 'split', pos: to });
    let next: EditorState | null = null;
    const nextId = counter();
    expect(
      insertTableCommand(createTable(1, 2, false, false, nextId), nextId)(state, (tr) => {
        next = state.apply(tr);
      }),
    ).toBe(true);
    const result = next as unknown as EditorState;
    result.doc.check();
    expect(findNodeById(result.doc, 'p1')!.node.textContent).toBe('First paragraph');
    const sec = findNodeById(result.doc, 's1')!.node;
    expect(names(sec).slice(0, 5)).toEqual(['title', 'p', 'p', 'table', 'p']);
    expect(sec.child(2).textContent).toBe('Split');
    expect(sec.child(4).textContent).toBe(' me here');
    // The caret in the table's first cell.
    expect(result.selection.empty).toBe(true);
    expect(result.selection.$from.parent).toBe(sec.child(3).child(0).child(0));
    expect(result.selection.$from.parentOffset).toBe(0);
  });

  it('answers false and dispatches nothing without a point', () => {
    const state = stateAt(doc, TextSelection.create(doc, inside(doc, 'btp', 1)));
    const dispatch = vi.fn();
    const nextId = counter();
    expect(
      insertTableCommand(createTable(1, 1, false, false, nextId), nextId)(state, dispatch),
    ).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------ */
/* applyTablePoint and the inserted table                                   */
/* ------------------------------------------------------------------------ */

describe('applyTablePoint', () => {
  it('splits like Enter: the first half keeps id, style, lang and nodeId; the second style and lang', () => {
    const doc = placementBook();
    const at = inside(doc, 'pid', 5);
    const nextId = counter('ui_');
    const tr = applyTablePoint(
      EditorState.create({ doc }).tr,
      { kind: 'split', pos: at },
      createTable(2, 2, true, false, counter('t_')),
      nextId,
    );
    tr.doc.check();
    const sec = findNodeById(tr.doc, 's1')!.node;
    const index = names(sec).indexOf('table');
    const first = sec.child(index - 1);
    const second = sec.child(index + 1);
    expect(first.attrs).toMatchObject({ nodeId: 'pid', id: 'x1', style: 'lead', lang: 'en' });
    expect(first.textContent).toBe('Split');
    expect(second.attrs).toMatchObject({ nodeId: 'ui_1', id: null, style: 'lead', lang: 'en' });
    expect(second.textContent).toBe(' me here');
    // Without a generator the host's node-id plugin names the second half.
    const plain = applyTablePoint(
      EditorState.create({ doc }).tr,
      { kind: 'split', pos: at },
      createTable(1, 1, false, false, counter('t_')),
    );
    const plainSection = findNodeById(plain.doc, 's1')!.node;
    expect(plainSection.child(names(plainSection).indexOf('table') + 1).attrs.nodeId).toBeNull();
  });

  it('puts a caret in the first cell of the table, also after a caption paragraph, and scrolls', () => {
    const doc = placementBook();
    const nextId = counter('t_');
    for (const point of [
      { kind: 'insert', pos: after(doc, 'p1') },
      { kind: 'replace', from: before(doc, 'pe'), to: after(doc, 'pe') },
      { kind: 'split', pos: inside(doc, 'p1', 3) },
    ] satisfies TablePoint[]) {
      const tableNode = createTable(3, 2, false, true, nextId);
      const tr = applyTablePoint(EditorState.create({ doc }).tr, point, tableNode, nextId);
      tr.doc.check();
      expect(tr.scrolledIntoView, point.kind).toBe(true);
      const $from = tr.selection.$from;
      expect(tr.selection.empty).toBe(true);
      expect($from.parent.type.name, point.kind).toBe('th');
      expect($from.parentOffset).toBe(0);
      expect($from.node($from.depth - 2).attrs.nodeId).toBe(tableNode.attrs.nodeId);
    }
    // [caption paragraph, table], as a paste brings it (data-model §8).
    const tableNode = createTable(1, 1, false, false, nextId);
    const caption = p('cap', 'Caption');
    const tr = applyTablePoint(
      EditorState.create({ doc }).tr,
      { kind: 'insert', pos: after(doc, 'p1') },
      Fragment.from([caption, tableNode]),
    );
    tr.doc.check();
    const sec = findNodeById(tr.doc, 's1')!.node;
    expect(names(sec).slice(0, 5)).toEqual(['title', 'p', 'p', 'table', 'p']);
    expect(sec.child(2).attrs.nodeId).toBe('cap');
    expect(tr.selection.$from.parent).toBe(sec.child(3).child(0).child(0));
  });

  it('inserts at every point of the matrix and keeps the document valid', () => {
    const doc = placementBook();
    const nextId = counter('t_');
    const positions = [
      inside(doc, 'pe'),
      inside(doc, 'p1'),
      endIn(doc, 'p1'),
      inside(doc, 'st'),
      inside(doc, 'pid', 4),
      inside(doc, 's1tp'),
      inside(doc, 's2ep', 1),
      inside(doc, 'v1'),
      inside(doc, 'c1a'),
      inside(doc, 'cb', 1),
      endIn(doc, 'becp'),
      endIn(doc, 'ann'),
      endIn(doc, 'hist'),
      inside(doc, 's31p'),
    ];
    for (const pos of positions) {
      const point = findTablePoint(doc, pos);
      expect(point, `a point at ${pos}`).not.toBeNull();
      const tr = applyTablePoint(
        EditorState.create({ doc }).tr,
        point!,
        createTable(2, 3, true, true, nextId),
        nextId,
      );
      expect(() => tr.doc.check(), `valid after ${pos}`).not.toThrow();
      expect(tr.selection.$from.parent.type.name).toBe('th');
    }
  });
});

/* ------------------------------------------------------------------------ */
/* SC-002's unit oracle (C26): a seeded property test                       */
/* ------------------------------------------------------------------------ */

/** mulberry32, the fuzz's generator (data-model §16.4). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random valid documents of the Body view and of a rich field. */
function generator(seed: number) {
  const random = mulberry32(seed);
  const chance = (probability: number) => random() < probability;
  const between = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
  const id = counter('g');
  const words = ['', 'a', 'ab', 'abc'];
  const word = (allowEmpty = true) => words[between(allowEmpty ? 0 : 1, words.length - 1)]!;
  const para = () => N.p!.create({ nodeId: id() }, text(word()));
  const sub = () => N.subtitle!.create({ nodeId: id() }, text(word()));
  const author = () => N.text_author!.create({ nodeId: id() }, text(word(false)));
  const emptyLine = () => N.empty_line!.create({ nodeId: id() });
  const tbl = () =>
    N.table!.create(
      { nodeId: id() },
      Array.from({ length: between(1, 2) }, () =>
        N.tr!.create(
          { nodeId: id() },
          Array.from({ length: between(1, 3) }, () =>
            (chance(0.3) ? N.th! : N.td!).create({ nodeId: id() }, text(word())),
          ),
        ),
      ),
    );
  const ttl = () =>
    N.title!.create(
      { nodeId: id() },
      Array.from({ length: between(1, 2) }, () => N.p!.create({ nodeId: id() }, text(word(false)))),
    );
  const pm = () =>
    N.poem!.create({ nodeId: id() }, [
      ...(chance(0.4) ? [ttl()] : []),
      ...Array.from({ length: between(1, 2) }, () =>
        N.stanza!.create(
          { nodeId: id() },
          Array.from({ length: between(1, 2) }, () => N.v!.create({ nodeId: id() }, text(word()))),
        ),
      ),
      ...(chance(0.4) ? [author()] : []),
    ]);
  const ct = (depth: number): PMNode => {
    const items = Array.from({ length: between(0, 3) }, () => {
      const kind = between(0, 4);
      if (kind === 0) return sub();
      if (kind === 1) return emptyLine();
      if (kind === 2 && depth < 2) return pm();
      if (kind === 3) return tbl();
      return para();
    });
    return N.cite!.create({ nodeId: id() }, [
      ...items,
      ...Array.from({ length: between(0, 2) }, author),
    ]);
  };
  const annotationItems = (min: number) =>
    Array.from({ length: between(min, 3) }, () => {
      const kind = between(0, 5);
      if (kind === 0) return pm();
      if (kind === 1) return ct(1);
      if (kind === 2) return sub();
      if (kind === 3) return tbl();
      if (kind === 4) return emptyLine();
      return para();
    });
  const epi = () =>
    N.epigraph!.create({ nodeId: id() }, [
      ...Array.from({ length: between(0, 2) }, () => {
        const kind = between(0, 3);
        if (kind === 0) return ct(1);
        if (kind === 1) return pm();
        if (kind === 2) return emptyLine();
        return para();
      }),
      ...Array.from({ length: between(0, 1) }, author),
    ]);
  const block = (first: boolean): PMNode => {
    const kind = between(0, first ? 5 : 6);
    if (kind === 0) return pm();
    if (kind === 1) return sub();
    if (kind === 2) return ct(1);
    if (kind === 3) return emptyLine();
    if (kind === 4) return tbl();
    if (kind === 6) return N.image!.create({ nodeId: id(), href: '#i.png' });
    return para();
  };
  const sec = (depth: number): PMNode => {
    const children: PMNode[] = [];
    if (chance(0.7)) children.push(ttl());
    for (let i = between(0, 2); i > 0; i -= 1) children.push(epi());
    if (chance(0.35)) children.push(N.image!.create({ nodeId: id(), href: '#h.png' }));
    if (chance(0.35)) children.push(N.annotation!.create({ nodeId: id() }, annotationItems(0)));
    if (depth < 2 && chance(0.3)) {
      for (let i = between(1, 2); i > 0; i -= 1) children.push(sec(depth + 1));
    } else {
      children.push(block(true));
      for (let i = between(0, 4); i > 0; i -= 1) children.push(block(false));
    }
    return N.section!.create({ nodeId: id() }, children);
  };
  const bodyDoc = (): PMNode => {
    const top: PMNode[] = [];
    if (chance(0.5)) {
      top.push(
        N.annotation_block!.create({ nodeId: FIXED_BLOCK_IDS.annotation }, annotationItems(1)),
      );
    }
    if (chance(0.5)) {
      top.push(N.history_block!.create({ nodeId: FIXED_BLOCK_IDS.history }, annotationItems(1)));
    }
    for (let b = between(1, 2); b > 0; b -= 1) {
      top.push(
        N.body!.create({ nodeId: id() }, [
          ...(chance(0.7) ? [ttl()] : []),
          ...(chance(0.4) ? [epi()] : []),
          ...Array.from({ length: between(1, 3) }, () => sec(0)),
        ]),
      );
    }
    return N.doc!.createChecked(null, top);
  };
  const fieldDoc = (): PMNode => N.annotation!.createChecked({ nodeId: id() }, annotationItems(1));
  return { bodyDoc, fieldDoc, chance };
}

/** The index after a section's heading part, written here independently of the module. */
function oracleHeadingEnd(node: PMNode): number {
  let index = 0;
  const at = (i: number) => (i < node.childCount ? node.child(i).type.name : null);
  if (at(index) === 'title') index += 1;
  while (at(index) === 'epigraph') index += 1;
  if (at(index) === 'image') index += 1;
  if (at(index) === 'annotation') index += 1;
  return index;
}

/**
 * The candidates of C26 at a caret `pos` in a text block: (a)'s point for a `p` or a
 * `subtitle`, then at each level up to the document the gaps after the caret's ancestor, never
 * descending, a section's heading part skipped.
 */
function oracleCandidates(doc: PMNode, pos: number): TablePoint[] {
  const $pos = doc.resolve(pos);
  const out: TablePoint[] = [];
  const depth = $pos.depth;
  const block = $pos.parent;
  if (block.type.name === 'p' || block.type.name === 'subtitle') {
    const start = $pos.before(depth);
    const end = $pos.after(depth);
    if (block.type.name === 'p' && block.content.size === 0) {
      out.push({ kind: 'replace', from: start, to: end });
    } else if ($pos.parentOffset === block.content.size) {
      out.push({ kind: 'insert', pos: end });
    } else if ($pos.parentOffset === 0) {
      out.push({ kind: 'insert', pos: start });
    } else {
      out.push({ kind: 'split', pos });
    }
  }
  for (let level = depth - 1; level >= 0; level -= 1) {
    const holder = $pos.node(level);
    let gap = $pos.index(level) + 1;
    if (holder.type.name === 'section') gap = Math.max(gap, oracleHeadingEnd(holder));
    let at = $pos.start(level);
    for (let i = 0; i < gap; i += 1) at += holder.child(i).nodeSize;
    for (; gap <= holder.childCount; gap += 1) {
      out.push({ kind: 'insert', pos: at });
      if (gap < holder.childCount) at += holder.child(gap).nodeSize;
    }
  }
  return out;
}

/**
 * The container a candidate puts the table into, before the change: its depth, its child count
 * and the position the table must stand at afterwards; with the number of children it gains.
 */
function landingOf(doc: PMNode, point: TablePoint) {
  if (point.kind === 'split') {
    const $pos = doc.resolve(point.pos);
    return {
      depth: $pos.depth - 1,
      count: $pos.node($pos.depth - 1).childCount,
      at: point.pos + 1,
      gain: 2,
    };
  }
  const at = point.kind === 'insert' ? point.pos : point.from;
  const $pos = doc.resolve(at);
  return {
    depth: $pos.depth,
    count: $pos.parent.childCount,
    at,
    gain: point.kind === 'insert' ? 1 : 0,
  };
}

/**
 * A candidate passes when, after `applyTablePoint`, the table stands at its place in the same
 * container - not wrapped, and the container not split or closed by ProseMirror's fitting of
 * an insertion that does not fit there - and the document is valid.
 */
function passes(state: EditorState, point: TablePoint): boolean {
  const nextId = counter('c_');
  const landing = landingOf(state.doc, point);
  try {
    const tr = applyTablePoint(state.tr, point, createTable(1, 1, false, false, nextId), nextId);
    const $at = tr.doc.resolve(landing.at);
    if ($at.depth !== landing.depth) return false;
    if ($at.parent.childCount !== landing.count + landing.gain) return false;
    if ($at.nodeAfter?.type.name !== 'table') return false;
    tr.doc.check();
    return true;
  } catch {
    return false;
  }
}

/** Every caret position of every text block. */
function caretPositions(doc: PMNode): number[] {
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    for (let offset = 0; offset <= node.content.size; offset += 1) positions.push(pos + 1 + offset);
    return false;
  });
  return positions;
}

describe('SC-002: the unit oracle (C26)', () => {
  it('findTablePoint gives the first passing candidate, or none, at every caret position of random documents', () => {
    const { bodyDoc, fieldDoc, chance } = generator(6);
    let checked = 0;
    let none = 0;
    let splits = 0;
    const failures: string[] = [];
    for (let round = 0; round < 300; round += 1) {
      const doc = chance(0.8) ? bodyDoc() : fieldDoc();
      // The carets of one text block share all their outward candidates, and a candidate's
      // verdict depends on the document only: each is tried once per document.
      const state = EditorState.create({ doc });
      const verdicts = new Map<string, boolean>();
      const passesOnce = (point: TablePoint) => {
        const key = JSON.stringify(point);
        let verdict = verdicts.get(key);
        if (verdict === undefined) {
          verdict = passes(state, point);
          verdicts.set(key, verdict);
        }
        return verdict;
      };
      for (const pos of caretPositions(doc)) {
        const expected = oracleCandidates(doc, pos).find(passesOnce) ?? null;
        const actual = findTablePoint(doc, pos);
        checked += 1;
        if (!expected) none += 1;
        else if (expected.kind === 'split') splits += 1;
        if (JSON.stringify(actual) !== JSON.stringify(expected) && failures.length < 20) {
          const $pos = doc.resolve(pos);
          failures.push(
            `round ${round}, ${$pos.parent.type.name} ${String($pos.parent.attrs.nodeId)} at ${$pos.parentOffset}: ${JSON.stringify(actual)} instead of ${JSON.stringify(expected)}`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThan(3000);
    // Both outcomes occur: the documents exercise (a), (b) and (c).
    expect(none).toBeGreaterThan(0);
    expect(splits).toBeGreaterThan(0);
  });
});
