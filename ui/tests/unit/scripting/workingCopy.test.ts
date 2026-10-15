/**
 * Feature 002 T056 - the working copy of a script run: the node index kept current by every
 * write (positions after inserts and removals, replaced and removed subtrees), documents
 * handed out (the starting document, a shown state) never changed by later writes, and writes
 * after a hand-out copying only the nodes on the way to the change.
 */

import type { ModelNodeJson } from '@/editor/fromModel';
import type { BodyNode, Document } from '@/model/document';
import { WorkingCopy } from '@/scripting/workingCopy';

import { fakeDocument } from '../features/testUtils';

function p(nodeId: string, text: string): ModelNodeJson {
  return { type: 'p', attrs: { nodeId }, content: [{ type: 'text', text }] };
}

function section(nodeId: string, children: ModelNodeJson[]): ModelNodeJson {
  return { type: 'section', attrs: { nodeId }, content: children };
}

function book(): Document {
  const body = {
    type: 'body',
    attrs: { nodeId: 'b1' },
    content: [
      section('s1', [p('p1', 'one'), p('p2', 'two'), p('p3', 'three')]),
      section('s2', [section('s2a', [p('p4', 'four')])]),
    ],
  } as unknown as BodyNode;
  const notes = {
    type: 'body',
    attrs: { nodeId: 'b2', name: 'notes' },
    content: [section('n1', [p('np1', 'note')])],
  } as unknown as BodyNode;
  return { ...fakeDocument(), bodies: [body, notes] };
}

const texts = (doc: Document, sectionIndex = 0) =>
  (
    (doc.bodies[0]!.content[sectionIndex] as unknown as ModelNodeJson).content as ModelNodeJson[]
  ).map((child) => child.content?.[0]?.text);

describe('WorkingCopy', () => {
  it('finds nodes with their parent, siblings and position', () => {
    const copy = new WorkingCopy(book());
    const place = copy.place('p2')!;
    expect(place.node.attrs?.nodeId).toBe('p2');
    expect(place.parent?.attrs?.nodeId).toBe('s1');
    expect(place.index).toBe(1);
    expect(place.siblings.map((s) => s.attrs?.nodeId)).toEqual(['p1', 'p2', 'p3']);
    const body = copy.place('b2')!;
    expect(body.parent).toBeNull();
    expect(body.index).toBe(1);
    expect(copy.place('nope')).toBeUndefined();
    expect(copy.changed).toBe(false);
  });

  it('keeps positions and the index current through inserts, removals and replacements', () => {
    const copy = new WorkingCopy(book());
    copy.insert('before', 'p1', p('x0', 'zero'));
    copy.insert('after', 'p3', p('x4', 'last'));
    copy.insert('append', 's1', p('x5', 'appended'));
    expect(texts(copy.document)).toEqual(['zero', 'one', 'two', 'three', 'last', 'appended']);
    expect(copy.place('p3')!.index).toBe(3);
    copy.remove('p1');
    expect(copy.place('p1')).toBeUndefined();
    expect(copy.place('p3')!.index).toBe(2);
    // A replaced subtree leaves the index; the new one (here with the same id) enters it.
    copy.replace('s2', section('s2', [p('p9', 'nine')]));
    expect(copy.place('s2a')).toBeUndefined();
    expect(copy.place('p4')).toBeUndefined();
    expect(copy.place('p9')!.parent?.attrs?.nodeId).toBe('s2');
    // Bodies are inserted next to bodies and removed (the first stays protected by the API).
    copy.insert('after', 'b2', {
      type: 'body',
      attrs: { nodeId: 'b3', name: 'comments' },
      content: [],
    });
    expect(copy.document.bodies.map((b) => b.attrs.nodeId)).toEqual(['b1', 'b2', 'b3']);
    copy.remove('b2');
    expect(copy.place('np1')).toBeUndefined();
    expect(copy.place('b3')!.index).toBe(1);
    expect(copy.changed).toBe(true);
  });

  it('never changes a document it handed out', () => {
    const start = book();
    const startJson = JSON.stringify(start);
    const copy = new WorkingCopy(start);
    copy.replace('p2', p('p2', 'TWO'));
    copy.insert('append', 's2a', p('x1', 'more'));
    expect(JSON.stringify(start)).toBe(startJson);
    expect(copy.pending).toBe(true);

    const shown = copy.release();
    const shownJson = JSON.stringify(shown);
    expect(copy.pending).toBe(false);
    copy.replace('p3', p('p3', 'THREE'));
    copy.remove('p4');
    copy.setDescription({ ...shown.description, outputs: [] });
    expect(JSON.stringify(shown)).toBe(shownJson);
    expect(texts(copy.document)).toEqual(['one', 'TWO', 'THREE']);
    expect(texts(shown)).toEqual(['one', 'TWO', 'three']);
  });

  it('copies only the nodes on the way to a change; untouched parts stay shared', () => {
    const start = book();
    const copy = new WorkingCopy(start);
    copy.replace('p4', p('p4', 'FOUR'));
    const doc = copy.document;
    expect(doc).not.toBe(start);
    expect(doc.bodies[1]).toBe(start.bodies[1]);
    expect(doc.bodies[0]!.content[0]).toBe(start.bodies[0]!.content[0]);
    expect(doc.bodies[0]!.content[1]).not.toBe(start.bodies[0]!.content[1]);
    // Further writes below the copied nodes change them in place until the next hand-out.
    const s2 = doc.bodies[0]!.content[1];
    copy.insert('after', 's2a', section('s2b', [p('p5', 'five')]));
    expect(copy.document.bodies[0]!.content[1]).toBe(s2);
  });

  it('takes over a document changed outside it', () => {
    const copy = new WorkingCopy(book());
    copy.release();
    const next = { ...book(), bodies: [book().bodies[1]!] };
    copy.reset(next);
    expect(copy.pending).toBe(true);
    expect(copy.place('p1')).toBeUndefined();
    expect(copy.place('np1')!.parent?.attrs?.nodeId).toBe('n1');
  });
});
