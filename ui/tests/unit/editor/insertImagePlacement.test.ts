/**
 * Feature 009, User Story 8 (T078): where Add > Image puts a block picture in a paragraph
 * directly in a section (data-model §11) - before it at its start, after it at its end, between
 * its halves inside it (the second half without an `id`), in place of an empty paragraph; a
 * selection uses its start; one transaction, so one undo step; nowhere else than before.
 */
import { Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';

import { insertImage } from '@/editor/commands/insert';
import { fb2Schema } from '@/editor/schema';

const { nodes: N } = fb2Schema;

const p = (text = '', attrs: Record<string, unknown> | null = null) =>
  N.p!.create(attrs, text ? fb2Schema.text(text) : undefined);
const title = (line: string) => N.title!.create(null, [p(line)]);
const book = (...children: PMNode[]) =>
  N.doc!.create(null, [N.body!.create(null, [title('Book'), N.section!.create(null, children)])]);

function posOf(docNode: PMNode, text: string): number {
  let found = -1;
  docNode.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isText && node.text!.includes(text)) found = pos + node.text!.indexOf(text);
    return found < 0;
  });
  if (found < 0) throw new Error(`text "${text}" not found`);
  return found;
}

/** Runs Add > Image with the selection `from`..`to`; the transactions it dispatched. */
function insertAt(docNode: PMNode, from: number, to = from) {
  const base = EditorState.create({ doc: docNode });
  const state = base.apply(base.tr.setSelection(TextSelection.create(docNode, from, to)));
  const transactions: Transaction[] = [];
  const ok = insertImage({ href: '#pic.png' })(state, (tr) => transactions.push(tr));
  const next = transactions.reduce((s, tr) => s.apply(tr), state);
  const section = next.doc.child(0).child(1);
  const blocks: string[] = [];
  section.forEach((child) =>
    blocks.push(child.type.name === 'p' ? `p:${child.textContent}` : child.type.name),
  );
  return { ok, transactions, blocks, section, doc: next.doc };
}

const first = () => book(title('One'), p('First paragraph.', { id: 'p1' }), p('Second.'));

describe('Add > Image in a paragraph directly in a section (data-model §11)', () => {
  it('at the start of the paragraph: before it', () => {
    const doc = first();
    expect(insertAt(doc, posOf(doc, 'First')).blocks).toEqual([
      'title',
      'image',
      'p:First paragraph.',
      'p:Second.',
    ]);
  });

  it('at its end: after it', () => {
    const doc = first();
    const end = posOf(doc, 'First') + 'First paragraph.'.length;
    expect(insertAt(doc, end).blocks).toEqual([
      'title',
      'p:First paragraph.',
      'image',
      'p:Second.',
    ]);
  });

  it('inside it: between its halves, the second half without an id, in one transaction', () => {
    const doc = first();
    const result = insertAt(doc, posOf(doc, 'paragraph.'));
    expect(result.blocks).toEqual(['title', 'p:First ', 'image', 'p:paragraph.', 'p:Second.']);
    expect(result.section.child(1).attrs.id).toBe('p1');
    expect(result.section.child(3).attrs.id ?? null).toBeNull();
    expect(result.transactions).toHaveLength(1);
    expect(result.doc.check()).toBeUndefined();
  });

  it('in an empty paragraph: in its place', () => {
    const doc = book(title('One'), p('Before.'), p(''), p('After.'));
    const empty = posOf(doc, 'Before.') + 'Before.'.length + 2;
    expect(insertAt(doc, empty).blocks).toEqual(['title', 'p:Before.', 'image', 'p:After.']);
  });

  it('a subtitle follows the same rules', () => {
    const doc = book(
      title('One'),
      p('Text.'),
      N.subtitle!.create(null, fb2Schema.text('Sub title')),
    );
    const result = insertAt(doc, posOf(doc, 'title'));
    expect(result.section.childCount).toBe(5);
    expect(result.section.child(3).type.name).toBe('image');
    expect(result.section.child(2).textContent).toBe('Sub ');
    expect(result.section.child(4).textContent).toBe('title');
  });

  it('a selection uses its start', () => {
    const doc = first();
    const result = insertAt(doc, posOf(doc, 'paragraph.'), posOf(doc, 'Second') + 3);
    expect(result.blocks).toEqual(['title', 'p:First ', 'image', 'p:paragraph.', 'p:Second.']);
  });

  it('where no block picture may stand, nothing changes', () => {
    const doc = first();
    const result = insertAt(doc, posOf(doc, 'One'));
    expect(result.ok).toBe(false);
    expect(result.transactions).toHaveLength(0);
  });
});
