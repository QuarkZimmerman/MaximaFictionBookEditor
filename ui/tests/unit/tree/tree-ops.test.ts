/**
 * T082/T083 - Document Tree operations on nested fixtures: expected order after Move Right /
 * Move With Children / Move Left / Merge / Delete, schema validity of the result (ProseMirror
 * `createChecked` through `docFromModel` + `check()`), the reversible step, and the refusals.
 */

import { docFromModel, type ModelNodeJson } from '@/editor/fromModel';
import {
  canRunTreeOp,
  deleteNode,
  locateNode,
  mergeWithNext,
  moveLeft,
  moveRight,
  moveWithChildren,
  runTreeOp,
  TREE_OPS,
  wrapBlocksInSection,
} from '@/features/treeOps';
import type { BodyNode, Document } from '@/model/document';

import { fakeDocument } from '../features/testUtils';

/* ------------------------------------------------------------------------ */
/* Fixture builders                                                         */
/* ------------------------------------------------------------------------ */

let counter = 0;
const id = (name: string) => `${name}`;
const text = (value: string): ModelNodeJson => ({ type: 'text', text: value });
const p = (value: string, nodeId = `p${(counter += 1)}`): ModelNodeJson => ({
  type: 'p',
  attrs: { nodeId },
  content: [text(value)],
});
const title = (value: string, nodeId = `t${(counter += 1)}`): ModelNodeJson => ({
  type: 'title',
  attrs: { nodeId },
  content: [p(value)],
});
const epigraph = (value: string): ModelNodeJson => ({
  type: 'epigraph',
  attrs: { nodeId: `e${(counter += 1)}` },
  content: [p(value)],
});
const section = (name: string, content: ModelNodeJson[]): ModelNodeJson => ({
  type: 'section',
  attrs: { nodeId: id(name) },
  content,
});

/**
 * body
 *   title "Book"
 *   A: title, p
 *   B: title, B1(title, p), B2(title, p)
 *   C: title, p, p
 *   D: title, epigraph, p
 */
function nestedDocument(): Document {
  counter = 0;
  const body: ModelNodeJson = {
    type: 'body',
    attrs: { nodeId: 'body1' },
    content: [
      title('Book', 'tBook'),
      section('A', [title('A', 'tA'), p('a1', 'pA1')]),
      section('B', [
        title('B', 'tB'),
        section('B1', [title('B1', 'tB1'), p('b1', 'pB1')]),
        section('B2', [title('B2', 'tB2'), p('b2', 'pB2')]),
      ]),
      section('C', [title('C', 'tC'), p('c1', 'pC1'), p('c2', 'pC2')]),
      section('D', [title('D', 'tD'), epigraph('ep'), p('d1', 'pD1')]),
    ],
  };
  return fakeDocument({ bodies: [body as unknown as BodyNode] });
}

function twoBodies(): Document {
  const doc = nestedDocument();
  const notes: ModelNodeJson = {
    type: 'body',
    attrs: { nodeId: 'body2', name: 'notes' },
    content: [section('N1', [title('N1'), p('n1')])],
  };
  return { ...doc, bodies: [...doc.bodies, notes as unknown as BodyNode] };
}

/** `type[nodeId]` outline of a node, children in brackets. */
function outline(node: ModelNodeJson): string {
  const own = node.attrs?.nodeId ? `${node.type}[${String(node.attrs.nodeId)}]` : node.type;
  const children = (node.content ?? []).filter((c) => c.type !== 'text');
  if (children.length === 0) return own;
  return `${own}(${children.map(outline).join(' ')})`;
}

function bodyOutline(doc: Document, index = 0): string {
  return outline(doc.bodies[index] as unknown as ModelNodeJson);
}

/** Section ids in document order (depth-first). */
function sectionOrder(doc: Document): string[] {
  const out: string[] = [];
  const visit = (node: ModelNodeJson) => {
    if (node.type === 'section') out.push(String(node.attrs?.nodeId));
    for (const child of node.content ?? []) visit(child);
  };
  for (const body of doc.bodies) visit(body as unknown as ModelNodeJson);
  return out;
}

/** Schema validity through the ProseMirror conversion (`createChecked`) and `Node.check()`. */
function expectValid(doc: Document): void {
  const { node, report } = docFromModel(doc);
  expect(report.problems).toEqual([]);
  expect(() => node.check()).not.toThrow();
}

const ids = () => {
  let n = 0;
  return () => `new${(n += 1)}`;
};

/* ------------------------------------------------------------------------ */

describe('tree operations - Move Right', () => {
  it('makes the section a child of its previous sibling and promotes its own children', () => {
    const doc = nestedDocument();
    const result = moveRight(doc, 'B', { nextId: ids() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A's paragraph is wrapped into a nested section (CreateNestedSection), then B without its
    // children, then B's former children at the same level.
    expect(bodyOutline(result.model)).toBe(
      'body[body1](title[tBook](p[p1]) ' +
        'section[A](title[tA](p[p2]) section[new1](p[pA1]) section[B](title[tB](p[p3]) p[new2]) ' +
        'section[B1](title[tB1](p[p4]) p[pB1]) section[B2](title[tB2](p[p5]) p[pB2])) ' +
        'section[C](title[tC](p[p6]) p[pC1] p[pC2]) ' +
        'section[D](title[tD](p[p7]) epigraph[e8](p[p9]) p[pD1]))',
    );
    expect(sectionOrder(result.model)).toEqual(['A', 'new1', 'B', 'B1', 'B2', 'C', 'D']);
    expect(result.selectNodeId).toBe('B');
    expectValid(result.model);
    // The step is reversible and relative to the model.
    expect(result.step.revert(result.model)).toEqual(doc);
    expect(result.step.apply(doc)).toEqual(result.model);
  });

  it('appends to a previous sibling that already has nested sections without wrapping', () => {
    const doc = nestedDocument();
    const result = moveRight(doc, 'C', { nextId: ids() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sectionOrder(result.model)).toEqual(['A', 'B', 'B1', 'B2', 'C', 'D']);
    const b = locateNode(result.model, 'B')!.node;
    expect(outline(b)).toBe(
      'section[B](title[tB](p[p3]) section[B1](title[tB1](p[p4]) p[pB1]) ' +
        'section[B2](title[tB2](p[p5]) p[pB2]) section[C](title[tC](p[p6]) p[pC1] p[pC2]))',
    );
    expectValid(result.model);
  });

  it('refuses the first section (no previous sibling) and non-sections', () => {
    const doc = nestedDocument();
    expect(moveRight(doc, 'A')).toEqual({ ok: false, reason: 'noPreviousSibling' });
    expect(moveRight(doc, 'B1')).toEqual({ ok: false, reason: 'noPreviousSibling' });
    expect(moveRight(doc, 'tA')).toEqual({ ok: false, reason: 'notASection' });
    expect(moveRight(doc, 'nope')).toEqual({ ok: false, reason: 'notFound' });
    expect(canRunTreeOp('moveRight', doc, 'A')).toBe(false);
    expect(canRunTreeOp('moveRight', doc, 'B')).toBe(true);
  });
});

describe('tree operations - Move With Children', () => {
  it('moves the whole subtree into the previous sibling', () => {
    const doc = nestedDocument();
    const result = moveWithChildren(doc, 'B', { nextId: ids() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sectionOrder(result.model)).toEqual(['A', 'new1', 'B', 'B1', 'B2', 'C', 'D']);
    const a = locateNode(result.model, 'A')!.node;
    expect(outline(a)).toBe(
      'section[A](title[tA](p[p2]) section[new1](p[pA1]) ' +
        'section[B](title[tB](p[p3]) section[B1](title[tB1](p[p4]) p[pB1]) ' +
        'section[B2](title[tB2](p[p5]) p[pB2])))',
    );
    expectValid(result.model);
    expect(result.step.revert(result.model)).toEqual(doc);
  });

  it('works through runTreeOp and keeps deeper nesting valid', () => {
    const doc = nestedDocument();
    const first = runTreeOp('moveWithChildren', doc, 'B2', { nextId: ids() });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(sectionOrder(first.model)).toEqual(['A', 'B', 'B1', 'new1', 'B2', 'C', 'D']);
    expectValid(first.model);
    const second = runTreeOp('moveWithChildren', first.model, 'C', { nextId: ids() });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(sectionOrder(second.model)).toEqual(['A', 'B', 'B1', 'new1', 'B2', 'C', 'D']);
    expectValid(second.model);
  });
});

describe('tree operations - Move Left', () => {
  it('lifts the section after its parent and takes the following siblings as children', () => {
    const doc = nestedDocument();
    const result = moveLeft(doc, 'B1', { nextId: ids() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sectionOrder(result.model)).toEqual(['A', 'B', 'B1', 'new1', 'B2', 'C', 'D']);
    // B kept its title and got an empty paragraph (a section needs content); B1's paragraph was
    // wrapped so that B2 can follow it as a nested section.
    expect(outline(locateNode(result.model, 'B')!.node)).toBe(
      'section[B](title[tB](p[p3]) p[new2])',
    );
    expect(outline(locateNode(result.model, 'B1')!.node)).toBe(
      'section[B1](title[tB1](p[p4]) section[new1](p[pB1]) section[B2](title[tB2](p[p5]) p[pB2]))',
    );
    expectValid(result.model);
    expect(result.step.revert(result.model)).toEqual(doc);
  });

  it('lifts the last nested section unchanged', () => {
    const doc = nestedDocument();
    const result = moveLeft(doc, 'B2', { nextId: ids() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sectionOrder(result.model)).toEqual(['A', 'B', 'B1', 'B2', 'C', 'D']);
    expect(outline(locateNode(result.model, 'B')!.node)).toBe(
      'section[B](title[tB](p[p3]) section[B1](title[tB1](p[p4]) p[pB1]))',
    );
    expect(result.model.bodies[0]!.content.map((c) => String(c.attrs.nodeId))).toEqual([
      'tBook',
      'A',
      'B',
      'B2',
      'C',
      'D',
    ]);
    expectValid(result.model);
  });

  it('refuses top-level sections of a body', () => {
    const doc = nestedDocument();
    expect(moveLeft(doc, 'A')).toEqual({ ok: false, reason: 'cannotLift' });
    expect(canRunTreeOp('moveLeft', doc, 'A')).toBe(false);
    expect(canRunTreeOp('moveLeft', doc, 'B1')).toBe(true);
  });
});

describe('tree operations - Merge', () => {
  it('appends a flat next section: title becomes subtitles, epigraphs are dropped', () => {
    const doc = nestedDocument();
    const result = mergeWithNext(doc, 'C');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(outline(locateNode(result.model, 'C')!.node)).toBe(
      'section[C](title[tC](p[p6]) p[pC1] p[pC2] subtitle[p7] p[pD1])',
    );
    expect(sectionOrder(result.model)).toEqual(['A', 'B', 'B1', 'B2', 'C']);
    expect(result.selectNodeId).toBe('C');
    expectValid(result.model);
    expect(result.step.revert(result.model)).toEqual(doc);
  });

  it('flattens a nested next section into a flat current section', () => {
    const doc = nestedDocument();
    const result = mergeWithNext(doc, 'A');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(outline(locateNode(result.model, 'A')!.node)).toBe(
      'section[A](title[tA](p[p2]) p[pA1] subtitle[p3] subtitle[p4] p[pB1] subtitle[p5] p[pB2])',
    );
    expectValid(result.model);
  });

  it('nests a flat next section under a current section with children', () => {
    const doc = nestedDocument();
    const result = mergeWithNext(doc, 'B');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sectionOrder(result.model)).toEqual(['A', 'B', 'B1', 'B2', 'C', 'D']);
    expect(outline(locateNode(result.model, 'B')!.node)).toBe(
      'section[B](title[tB](p[p3]) section[B1](title[tB1](p[p4]) p[pB1]) ' +
        'section[B2](title[tB2](p[p5]) p[pB2]) section[C](title[tC](p[p6]) p[pC1] p[pC2]))',
    );
    expectValid(result.model);
  });

  it('moves the header items of a nested next section into its first nested section', () => {
    const doc = nestedDocument();
    // Make C nested too, then merge B (nested) with C (nested): C's title goes into C1.
    const c = locateNode(doc, 'C')!.node;
    const nestedC: ModelNodeJson = {
      ...c,
      content: [
        c.content![0]!,
        section('C1', [p('c1', 'pC1')]),
        section('C2', [title('C2', 'tC2'), p('c2', 'pC2')]),
      ],
    };
    const bodies = doc.bodies.map((body) => ({
      ...body,
      content: body.content.map((child) => (child.attrs.nodeId === 'C' ? nestedC : child)),
    })) as unknown as BodyNode[];
    const prepared = { ...doc, bodies };
    expectValid(prepared);
    const result = mergeWithNext(prepared, 'B');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(outline(locateNode(result.model, 'B')!.node)).toBe(
      'section[B](title[tB](p[p3]) section[B1](title[tB1](p[p4]) p[pB1]) ' +
        'section[B2](title[tB2](p[p5]) p[pB2]) section[C1](title[tC](p[p6]) p[pC1]) ' +
        'section[C2](title[tC2](p[p10]) p[pC2]))',
    );
    expectValid(result.model);
  });

  it('refuses when there is no following section', () => {
    const doc = nestedDocument();
    expect(mergeWithNext(doc, 'D')).toEqual({ ok: false, reason: 'noNextSibling' });
    expect(mergeWithNext(doc, 'B2')).toEqual({ ok: false, reason: 'noNextSibling' });
    expect(canRunTreeOp('merge', doc, 'D')).toBe(false);
    expect(canRunTreeOp('merge', doc, 'B1')).toBe(true);
  });
});

describe('tree operations - Delete', () => {
  it('removes a nested section and keeps the parent valid', () => {
    const doc = nestedDocument();
    const first = deleteNode(doc, 'B1', { nextId: ids() });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(sectionOrder(first.model)).toEqual(['A', 'B', 'B2', 'C', 'D']);
    expect(first.selectNodeId).toBe('B2');
    expectValid(first.model);
    const second = deleteNode(first.model, 'B2', { nextId: ids() });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // The emptied section gets an empty paragraph so that it stays schema-valid.
    expect(outline(locateNode(second.model, 'B')!.node)).toBe(
      'section[B](title[tB](p[p3]) p[new1])',
    );
    expect(second.selectNodeId).toBe('B');
    expectValid(second.model);
    expect(second.step.revert(second.model)).toEqual(first.model);
  });

  it('removes leaf elements (title, epigraph) and whole top-level sections', () => {
    const doc = nestedDocument();
    const noTitle = deleteNode(doc, 'tA');
    expect(noTitle.ok).toBe(true);
    if (!noTitle.ok) return;
    expect(outline(locateNode(noTitle.model, 'A')!.node)).toBe('section[A](p[pA1])');
    expectValid(noTitle.model);
    const located = locateNode(doc, 'D')!;
    const epigraphId = String(located.node.content![1]!.attrs!.nodeId);
    const noEpigraph = deleteNode(doc, epigraphId);
    expect(noEpigraph.ok).toBe(true);
    if (!noEpigraph.ok) return;
    expect(outline(locateNode(noEpigraph.model, 'D')!.node)).toBe(
      'section[D](title[tD](p[p7]) p[pD1])',
    );
    expectValid(noEpigraph.model);
    const noSection = deleteNode(doc, 'C');
    expect(noSection.ok).toBe(true);
    if (!noSection.ok) return;
    expect(sectionOrder(noSection.model)).toEqual(['A', 'B', 'B1', 'B2', 'D']);
    expect(noSection.selectNodeId).toBe('D');
    expectValid(noSection.model);
  });

  it('keeps at least one section per body and one body per book', () => {
    const doc = twoBodies();
    expect(deleteNode(doc, 'N1')).toEqual({ ok: false, reason: 'lastSection' });
    expect(canRunTreeOp('delete', doc, 'N1')).toBe(false);
    const removedBody = deleteNode(doc, 'body2');
    expect(removedBody.ok).toBe(true);
    if (!removedBody.ok) return;
    expect(removedBody.model.bodies).toHaveLength(1);
    expect(removedBody.selectNodeId).toBe('body1');
    expect(removedBody.step.revert(removedBody.model)).toEqual(doc);
    expect(deleteNode(removedBody.model, 'body1')).toEqual({ ok: false, reason: 'lastBody' });
    expect(canRunTreeOp('delete', removedBody.model, 'body1')).toBe(false);
  });
});

describe('tree operations - helpers and sequences', () => {
  it('wrapBlocksInSection wraps everything from the first block on', () => {
    const s = section('S', [title('S'), epigraph('e'), p('one'), p('two')]);
    const wrapped = wrapBlocksInSection(s, ids());
    expect(outline(wrapped)).toMatch(
      /^section\[S\]\(title\[t\d+\]\(p\[p\d+\]\) epigraph\[e\d+\]\(p\[p\d+\]\) section\[new1\]\(p\[p\d+\] p\[p\d+\]\)\)$/,
    );
    const headerOnly = section('T', [title('T')]);
    expect(wrapBlocksInSection(headerOnly)).toBe(headerOnly);
  });

  it('every operation on every section of the fixture yields a valid document or a refusal', () => {
    const doc = nestedDocument();
    for (const op of TREE_OPS) {
      for (const sectionId of sectionOrder(doc)) {
        const result = runTreeOp(op, doc, sectionId, { nextId: ids() });
        expect(result.ok).toBe(canRunTreeOp(op, doc, sectionId));
        if (result.ok) {
          expectValid(result.model);
          expect(result.step.revert(result.model)).toEqual(doc);
        }
      }
    }
  });

  it('elements the tree does not show (table rows) cannot be deleted; images and tables can', () => {
    const doc = nestedDocument();
    const table: ModelNodeJson = {
      type: 'table',
      attrs: { nodeId: 'tbl' },
      content: [
        {
          type: 'tr',
          attrs: { nodeId: 'row' },
          content: [{ type: 'td', attrs: { nodeId: 'cell' }, content: [text('x')] }],
        },
      ],
    };
    const image: ModelNodeJson = { type: 'image', attrs: { nodeId: 'img', href: '#pic.png' } };
    const c = locateNode(doc, 'C')!.node;
    const withTable = {
      ...doc,
      bodies: doc.bodies.map((body) => ({
        ...body,
        content: body.content.map((child) =>
          child.attrs.nodeId === 'C'
            ? ({ ...c, content: [...c.content!, table, image] } as unknown as typeof child)
            : child,
        ),
      })),
    } as Document;
    expectValid(withTable);
    expect(deleteNode(withTable, 'row')).toEqual({ ok: false, reason: 'cannotDelete' });
    expect(canRunTreeOp('delete', withTable, 'row')).toBe(false);
    const noTable = deleteNode(withTable, 'tbl');
    expect(noTable.ok).toBe(true);
    if (!noTable.ok) return;
    expectValid(noTable.model);
    const noImage = deleteNode(noTable.model, 'img');
    expect(noImage.ok).toBe(true);
    if (!noImage.ok) return;
    expect(outline(locateNode(noImage.model, 'C')!.node)).toBe(
      'section[C](title[tC](p[p6]) p[pC1] p[pC2])',
    );
    expectValid(noImage.model);
  });
});
