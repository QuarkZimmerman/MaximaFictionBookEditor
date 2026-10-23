/**
 * Feature 002 T056 - the working copy of a script run: the node index kept current by every
 * write (positions after inserts and removals, replaced and removed subtrees), documents
 * handed out (the starting document, a shown state) never changed by later writes, and writes
 * after a hand-out copying only the nodes on the way to the change. Feature 005 T027
 * (data-model §6.2): `checkpoint()` in O(1) and `rollback()` to it - the document, the node
 * index and the flags as they were, after replacements, inserts, removals, a description
 * change and a `reset()`; two checkpoints in a row.
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

describe('WorkingCopy checkpoint and rollback (feature 005 T027)', () => {
  it('a checkpoint is the current document handed out in O(1), with the flags as they are', () => {
    const copy = new WorkingCopy(book());
    const fresh = copy.checkpoint();
    // No clone: the document object itself, nothing changed yet.
    expect(fresh.document).toBe(copy.document);
    expect(fresh).toEqual({ document: copy.document, changed: false, pending: false });

    copy.replace('p2', p('p2', 'TWO'));
    expect(copy.changed).toBe(true);
    expect(copy.pending).toBe(true);
    const dirty = copy.checkpoint();
    expect(dirty.document).toBe(copy.document);
    expect(dirty.changed).toBe(true);
    // Not a release: the write is still pending for the next show of the document.
    expect(dirty.pending).toBe(true);
    expect(copy.pending).toBe(true);
    expect(copy.changed).toBe(true);
  });

  it("a checkpoint's document is never mutated by the writes that follow", () => {
    const copy = new WorkingCopy(book());
    copy.replace('p1', p('p1', 'ONE'));
    const cp = copy.checkpoint();
    const json = JSON.stringify(cp.document);
    copy.replace('p2', p('p2', 'TWO'));
    copy.insert('append', 's1', p('x1', 'appended'));
    copy.insert('before', 'p4', p('x2', 'before four'));
    copy.remove('p3');
    copy.setDescription({ ...cp.document.description, outputs: [] });
    // The next writes change the copies in place, still not the checkpoint's nodes.
    copy.replace('x1', p('x1', 'APPENDED'));
    expect(JSON.stringify(cp.document)).toBe(json);
    expect(texts(copy.document)).toEqual(['ONE', 'TWO', 'APPENDED']);
    expect(texts(cp.document)).toEqual(['ONE', 'two', 'three']);
  });

  it('rollback restores the document, the node index and the flags after replace, insert, remove and setDescription', () => {
    const start = book();
    const copy = new WorkingCopy(start);
    const cp = copy.checkpoint();
    copy.replace('p2', p('p2', 'TWO'));
    copy.insert('after', 'p3', p('x4', 'last'));
    copy.insert('append', 's2a', p('x5', 'deeper'));
    copy.remove('p1');
    copy.setDescription({ ...start.description, outputs: [] });
    expect(texts(copy.document)).toEqual(['TWO', 'three', 'last']);
    expect(copy.place('p1')).toBeUndefined();
    expect(copy.place('x4')!.index).toBe(2);

    copy.rollback(cp);
    expect(copy.document).toBe(start);
    expect(copy.changed).toBe(false);
    expect(copy.pending).toBe(false);
    expect(texts(copy.document)).toEqual(['one', 'two', 'three']);
    expect(copy.document.description).toBe(start.description);
    // The index describes the restored document: the removed node is back at its place, the
    // inserted ones are gone, positions are those of the checkpoint.
    expect(copy.place('p1')!.index).toBe(0);
    expect(copy.place('p2')!.node.content?.[0]?.text).toBe('two');
    expect(copy.place('p3')!.index).toBe(2);
    expect(copy.place('x4')).toBeUndefined();
    expect(copy.place('x5')).toBeUndefined();
    expect(copy.place('s2a')!.node.content).toHaveLength(1);
    // Writing on after the rollback works on the restored tree and leaves the checkpoint alone.
    copy.insert('before', 'p1', p('x0', 'zero'));
    expect(texts(copy.document)).toEqual(['zero', 'one', 'two', 'three']);
    expect(copy.place('p3')!.index).toBe(3);
    expect(texts(start)).toEqual(['one', 'two', 'three']);
    expect(copy.changed).toBe(true);
    expect(copy.pending).toBe(true);
  });

  it('restores the flags of a checkpoint taken mid-way (changed, pending) and keeps a released state released', () => {
    const copy = new WorkingCopy(book());
    copy.replace('p1', p('p1', 'ONE'));
    const shown = copy.release();
    expect(copy.pending).toBe(false);
    const cp = copy.checkpoint();
    expect(cp).toEqual({ document: shown, changed: true, pending: false });
    copy.remove('p2');
    expect(copy.pending).toBe(true);
    copy.rollback(cp);
    expect(copy.document).toBe(shown);
    expect(copy.changed).toBe(true);
    expect(copy.pending).toBe(false);
    expect(texts(copy.document)).toEqual(['ONE', 'two', 'three']);
  });

  it('two checkpoints in a row: each restores its own state, in any order', () => {
    const copy = new WorkingCopy(book());
    const first = copy.checkpoint();
    copy.replace('p1', p('p1', 'ONE'));
    const second = copy.checkpoint();
    expect(second.document).not.toBe(first.document);
    copy.replace('p2', p('p2', 'TWO'));
    expect(texts(copy.document)).toEqual(['ONE', 'TWO', 'three']);

    copy.rollback(second);
    expect(texts(copy.document)).toEqual(['ONE', 'two', 'three']);
    expect(copy.changed).toBe(true);
    copy.rollback(first);
    expect(texts(copy.document)).toEqual(['one', 'two', 'three']);
    expect(copy.changed).toBe(false);
    // Forward again to the later checkpoint: still intact.
    copy.rollback(second);
    expect(texts(copy.document)).toEqual(['ONE', 'two', 'three']);
    expect(copy.place('p1')!.node.content?.[0]?.text).toBe('ONE');
    // A checkpoint survives its own rollback: the same one can be returned to twice.
    copy.remove('p3');
    copy.rollback(second);
    expect(texts(copy.document)).toEqual(['ONE', 'two', 'three']);
  });

  it("rolls back a reset() made since the checkpoint (a nested script run's result)", () => {
    const copy = new WorkingCopy(book());
    copy.replace('p1', p('p1', 'ONE'));
    const cp = copy.checkpoint();
    // A nested run hands its result back; the request takes it over...
    const inner = new WorkingCopy(cp.document);
    inner.insert('append', 's1', p('x1', 'from the script'));
    inner.remove('p2');
    copy.reset(inner.release());
    expect(texts(copy.document)).toEqual(['ONE', 'three', 'from the script']);
    expect(copy.place('x1')!.parent?.attrs?.nodeId).toBe('s1');
    // ...and the validity hook rejects it: back to the checkpoint, index included.
    copy.rollback(cp);
    expect(copy.document).toBe(cp.document);
    expect(texts(copy.document)).toEqual(['ONE', 'two', 'three']);
    expect(copy.place('x1')).toBeUndefined();
    expect(copy.place('p2')!.index).toBe(1);
    expect(copy.changed).toBe(true);
    expect(copy.pending).toBe(true);
  });
});
