/**
 * Feature 004, US2 (T021) - the annotation and history blocks of the Body view: the block
 * nodes built from the model (`blockFromModel`), the write-back rule (`blockToModel` yields
 * `undefined` only when every paragraph is empty; a block is written back only when its node
 * identity changed), the boundary filter (cross-boundary deletes and Select All + Delete are
 * refused, deletes inside one block or confined to the bodies pass, the controller's own
 * transactions, IME-style replace steps and the node id plugin's appended transaction pass),
 * and the window helpers for the fixed ids (`locateSection`, `windowAround`, no blocks in a
 * notes-body window).
 */

import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { AllSelection, EditorState, TextSelection, type Transaction } from 'prosemirror-state';

import { markControllerTransaction } from '@/editor/plugins/blockBoundary';
import { FIXED_BLOCK_IDS, fb2Schema } from '@/editor/schema';
import { blockToModel } from '@/editor/toModel';
import {
  blockFromModel,
  createWindow,
  leadingBlocks,
  locateSection,
  replaceSectionsInModel,
  windowAround,
  windowSliceUnchanged,
} from '@/editor/virtualization';
import type { AnnotationNode, BodyNode, Document } from '@/model/document';
import { createBodyEditorState } from '@/views/body/bodyEditor';

import { fakeDocument } from '../features/testUtils';

const { nodes: N } = fb2Schema;

/* ------------------------------------------------------------------------ */
/* Fixtures                                                                 */
/* ------------------------------------------------------------------------ */

function paragraph(nodeId: string, text: string) {
  return {
    type: 'p' as const,
    attrs: { nodeId },
    content: text ? [{ type: 'text' as const, text }] : [],
  };
}

function annotation(nodeId: string, texts: string[], extra: Record<string, unknown> = {}) {
  return {
    type: 'annotation',
    attrs: { nodeId, ...extra },
    content: texts.map((text, index) => paragraph(`${nodeId}p${index + 1}`, text)),
  } as unknown as AnnotationNode;
}

function body(nodeId: string, sections: number, name?: string): BodyNode {
  const content: BodyNode['content'] = [
    {
      type: 'title',
      attrs: { nodeId: `${nodeId}t` },
      content: [paragraph(`${nodeId}tp`, `Title of ${nodeId}`)],
    },
  ];
  for (let i = 1; i <= sections; i += 1) {
    content.push({
      type: 'section',
      attrs: { nodeId: `${nodeId}s${i}` },
      content: [paragraph(`${nodeId}s${i}p`, `Section ${i} of ${nodeId}`)],
    });
  }
  return { type: 'body', attrs: name ? { nodeId, name } : { nodeId }, content };
}

/** A small book with an annotation, a history and two bodies (whole-book mode). */
function book(overrides: Partial<Document['description']['titleInfo']> = {}): Document {
  const base = fakeDocument();
  return {
    ...base,
    description: {
      ...base.description,
      titleInfo: {
        ...base.description.titleInfo,
        annotation: annotation('nA', ['First annotation line.', 'Second annotation line.']),
        ...overrides,
      },
      documentInfo: {
        ...base.description.documentInfo,
        history: annotation('nH', ['v1 - created'], { lang: 'ru' }),
      },
    },
    bodies: [body('nB', 2), body('nN', 1, 'notes')],
  };
}

/** Editor state of the whole-book window of `model` with the Body plugins installed. */
function stateOf(model: Document): { state: EditorState; window: ReturnType<typeof createWindow> } {
  const window = createWindow(model);
  const state = createBodyEditorState(window.doc, { getNbspChar: () => '\u00b7' });
  return { state, window };
}

/** Start position of the text `text` inside the document. */
function posOf(doc: PMNode, text: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isText && node.text!.includes(text)) found = pos + node.text!.indexOf(text);
    return found < 0;
  });
  if (found < 0) throw new Error(`text "${text}" not found`);
  return found;
}

/** Applies `tr` through the plugins; true when the document changed. */
function applied(state: EditorState, tr: Transaction): { state: EditorState; changed: boolean } {
  const next = state.applyTransaction(tr).state;
  return { state: next, changed: next.doc !== state.doc };
}

function kinds(doc: PMNode): string[] {
  const out: string[] = [];
  doc.forEach((child) => out.push(child.type.name));
  return out;
}

/* ------------------------------------------------------------------------ */
/* blockFromModel / blockToModel                                            */
/* ------------------------------------------------------------------------ */

describe('blockFromModel', () => {
  it('gives an absent node one empty paragraph with a UI id under the fixed block id', () => {
    const node = blockFromModel('annotation', undefined);
    expect(node.type.name).toBe('annotation_block');
    expect(node.attrs.nodeId).toBe(FIXED_BLOCK_IDS.annotation);
    expect(node.childCount).toBe(1);
    expect(node.child(0).type).toBe(N.p);
    expect(node.child(0).content.size).toBe(0);
    expect(String(node.child(0).attrs.nodeId)).toMatch(/^ui_/);
  });

  it('shows a present-but-empty node as one empty paragraph and keeps its attributes', () => {
    const node = blockFromModel('history', annotation('nH', [], { lang: 'ru', id: 'h1' }));
    expect(node.type.name).toBe('history_block');
    expect(node.attrs.nodeId).toBe(FIXED_BLOCK_IDS.history);
    expect(node.attrs.lang).toBe('ru');
    expect(node.attrs.id).toBe('h1');
    expect(node.childCount).toBe(1);
    expect(node.child(0).content.size).toBe(0);
  });

  it('converts the content of a text node, paragraphs keeping their core ids', () => {
    const node = blockFromModel('annotation', annotation('nA', ['One', 'Two']));
    expect(node.childCount).toBe(2);
    expect(node.child(0).attrs.nodeId).toBe('nAp1');
    expect(node.child(1).textContent).toBe('Two');
    expect(node.attrs.nodeId).toBe(FIXED_BLOCK_IDS.annotation);
  });
});

describe('blockToModel', () => {
  it('is undefined only when every paragraph is empty', () => {
    expect(blockToModel(blockFromModel('annotation', undefined))).toBeUndefined();
    const twoEmpty = N.annotation_block!.create({ nodeId: FIXED_BLOCK_IDS.annotation }, [
      N.p!.create(),
      N.p!.create(),
    ]);
    expect(blockToModel(twoEmpty)).toBeUndefined();
    const emptyLine = N.annotation_block!.create({ nodeId: FIXED_BLOCK_IDS.annotation }, [
      N.p!.create(),
      N.empty_line!.create(),
    ]);
    expect(blockToModel(emptyLine)?.content.map((c) => c.type)).toEqual(['p', 'empty-line']);
    const text = blockToModel(
      blockFromModel('history', annotation('nH', ['Text'], { lang: 'ru' })),
    );
    expect(text).toMatchObject({ type: 'annotation', attrs: { lang: 'ru' } });
    expect(text!.content).toHaveLength(1);
  });

  it('never leaks the fixed block id into the model and keeps the root id it is given', () => {
    const node = blockFromModel('annotation', annotation('nA', ['Text']));
    expect(blockToModel(node)!.attrs.nodeId).toBeUndefined();
    expect(blockToModel(node, 'nA')!.attrs.nodeId).toBe('nA');
    expect(Object.values(blockToModel(node, 'nA')!.attrs)).not.toContain(
      FIXED_BLOCK_IDS.annotation,
    );
  });
});

/* ------------------------------------------------------------------------ */
/* Window and write-back                                                    */
/* ------------------------------------------------------------------------ */

describe('block windows', () => {
  it('mounts the blocks above the first body in whole-book mode and in the window of body 0', () => {
    const model = book();
    const whole = createWindow(model);
    expect(kinds(whole.doc)).toEqual(['annotation_block', 'history_block', 'body', 'body']);
    expect(whole.blocks.annotation).toBe(whole.doc.child(0));
    expect(whole.blocks.history).toBe(whole.doc.child(1));
    const windowed = createWindow(model, { forceWindowed: true, bodyIndex: 0, windowSize: 1 });
    expect(kinds(windowed.doc)).toEqual(['annotation_block', 'history_block', 'body']);
    expect(windowed.blocks.annotation).not.toBeNull();
    // A notes-body window shows no blocks.
    const notes = createWindow(model, { forceWindowed: true, bodyIndex: 1 });
    expect(kinds(notes.doc)).toEqual(['body']);
    expect(notes.blocks).toEqual({ annotation: null, history: null });
    expect(leadingBlocks(notes.doc)).toEqual({ annotation: null, history: null });
  });

  it('shows the two blocks alone for a document without a body', () => {
    const model = { ...book(), bodies: [] };
    const window = createWindow(model);
    expect(window.wholeBook).toBe(true);
    expect(kinds(window.doc)).toEqual(['annotation_block', 'history_block']);
    expect(window.doc.child(0).textContent).toContain('First annotation line.');
  });

  it('locates the fixed ids and the description nodes in the window of body 0', () => {
    const model = book();
    expect(locateSection(model, FIXED_BLOCK_IDS.annotation)).toEqual({
      bodyIndex: 0,
      sectionIndex: 0,
    });
    expect(locateSection(model, FIXED_BLOCK_IDS.history)).toEqual({
      bodyIndex: 0,
      sectionIndex: 0,
    });
    expect(locateSection(model, 'nAp2')).toEqual({ bodyIndex: 0, sectionIndex: 0 });
    expect(locateSection(model, 'nHp1')).toEqual({ bodyIndex: 0, sectionIndex: 0 });
    expect(locateSection(model, 'nNs1p')).toEqual({ bodyIndex: 1, sectionIndex: 0 });
    expect(locateSection(model, 'nope')).toBeNull();
    const around = windowAround(model, FIXED_BLOCK_IDS.history, { forceWindowed: true });
    expect(around).toMatchObject({ bodyIndex: 0, start: 0 });
    expect(around!.blocks.history).not.toBeNull();
    expect(windowAround(model, 'nHp1', { forceWindowed: true })!.bodyIndex).toBe(0);
  });

  it('writes a block back only when its node identity changed', () => {
    const model = book();
    const { state, window } = stateOf(model);
    // Untouched document: nothing written back, the description object is the same.
    const same = replaceSectionsInModel(model, window, state.doc);
    expect(same.model.description).toBe(model.description);

    // Typing in the annotation changes that block only; the history keeps its identity.
    const pos = posOf(state.doc, 'Second annotation line.');
    const typed = state.apply(state.tr.insertText('Edited ', pos));
    const result = replaceSectionsInModel(model, window, typed.doc);
    const { titleInfo, documentInfo } = result.model.description;
    expect(titleInfo.annotation).not.toBe(model.description.titleInfo.annotation);
    expect(titleInfo.annotation!.attrs.nodeId).toBe('nA');
    expect(
      (titleInfo.annotation!.content[1] as { content: { text: string }[] }).content[0]!.text,
    ).toBe('Edited Second annotation line.');
    expect(documentInfo.history).toBe(model.description.documentInfo.history);
    expect(result.model.bodies).toEqual(model.bodies);
    // The window now represents the edited block: a second write-back of the same document
    // changes nothing more.
    expect(result.window.blocks.annotation).toBe(typed.doc.child(0));
    const again = replaceSectionsInModel(result.model, result.window, typed.doc);
    expect(again.model.description).toBe(result.model.description);
  });

  it('keeps a present-but-empty node as read until its block is edited, then drops an emptied one', () => {
    const empty = annotation('nH', [], { lang: 'ru' });
    const model = book();
    model.description.documentInfo.history = empty;
    const { state, window } = stateOf(model);
    // An edit elsewhere (the annotation) leaves the empty history exactly as read.
    const elsewhere = state.apply(state.tr.insertText('X', posOf(state.doc, 'First')));
    const kept = replaceSectionsInModel(model, window, elsewhere.doc);
    expect(kept.model.description.documentInfo.history).toBe(empty);
    // Typed into and emptied again: the next write-back drops the element. The history block
    // follows the annotation block; its first paragraph's content starts two positions in.
    const pos = elsewhere.doc.child(0).nodeSize + 2;
    expect(elsewhere.doc.resolve(pos).parent.type).toBe(N.p);
    expect(elsewhere.doc.resolve(pos).node(1).type.name).toBe('history_block');
    const typed = elsewhere.apply(elsewhere.tr.insertText('tmp', pos));
    const afterTyping = replaceSectionsInModel(kept.model, kept.window, typed.doc);
    expect(afterTyping.model.description.documentInfo.history?.content).toHaveLength(1);
    expect(afterTyping.model.description.documentInfo.history?.attrs.lang).toBe('ru');
    const emptied = typed.apply(typed.tr.delete(pos, pos + 3));
    const afterEmptying = replaceSectionsInModel(
      afterTyping.model,
      afterTyping.window,
      emptied.doc,
    );
    expect(afterEmptying.model.description.documentInfo.history).toBeUndefined();
  });

  it('compares the description nodes in windowSliceUnchanged when the blocks are mounted', () => {
    const model = book();
    const window = createWindow(model);
    const sameBodies = {
      ...model,
      description: {
        ...model.description,
        titleInfo: { ...model.description.titleInfo, annotation: annotation('nA', ['Other']) },
      },
    };
    expect(windowSliceUnchanged(model, sameBodies, window)).toBe(false);
    expect(windowSliceUnchanged(model, { ...model }, window)).toBe(true);
    // A notes-body window does not mount the blocks: a description change is outside it.
    const notes = createWindow(model, { forceWindowed: true, bodyIndex: 1 });
    expect(windowSliceUnchanged(model, sameBodies, notes)).toBe(true);
  });
});

/* ------------------------------------------------------------------------ */
/* Boundary filter                                                          */
/* ------------------------------------------------------------------------ */

describe('block boundary filter', () => {
  it('passes deletes inside a block and deletes confined to the bodies', () => {
    const { state } = stateOf(book());
    const inBlock = posOf(state.doc, 'First annotation line.');
    const insideBlock = applied(state, state.tr.delete(inBlock, inBlock + 5));
    expect(insideBlock.changed).toBe(true);
    expect(insideBlock.state.doc.child(0).textContent).toContain('annotation line.');
    const inBody = posOf(state.doc, 'Section 1 of nB');
    const insideBody = applied(state, state.tr.delete(inBody, inBody + 7));
    expect(insideBody.changed).toBe(true);
    // Across two paragraphs of one block: joined, still inside the block.
    const from = posOf(state.doc, 'annotation line.') + 'annotation line.'.length;
    const to = posOf(state.doc, 'Second');
    const joined = applied(state, state.tr.delete(from, to));
    expect(joined.changed).toBe(true);
    expect(kinds(joined.state.doc)).toEqual(['annotation_block', 'history_block', 'body', 'body']);
  });

  it('refuses a delete across a block boundary and Select All + Delete', () => {
    const { state } = stateOf(book());
    const from = posOf(state.doc, 'Second annotation line.');
    const to = posOf(state.doc, 'v1 - created') + 2;
    const crossing = applied(state, state.tr.delete(from, to));
    expect(crossing.changed).toBe(false);
    const intoBody = applied(
      state,
      state.tr.delete(posOf(state.doc, 'v1 - created'), posOf(state.doc, 'Title of nB') + 3),
    );
    expect(intoBody.changed).toBe(false);
    const all = state.apply(state.tr.setSelection(new AllSelection(state.doc)));
    const deleted = applied(all, all.tr.deleteSelection());
    expect(deleted.changed).toBe(false);
    const replaced = applied(
      all,
      all.tr.replaceSelectionWith(N.p!.create(null, fb2Schema.text('x'))),
    );
    expect(replaced.changed).toBe(false);
    // Select All itself works and the selection can be read for the clipboard.
    expect(all.selection.content().content.childCount).toBe(4);
  });

  it('lets the controller rebuild the blocks and passes IME-style replace steps', () => {
    const { state } = stateOf(book());
    // The controller's own transaction (showModel / commitStep / a rebuild) may change anything.
    const history = state.doc.child(1);
    const historyEnd = history.nodeSize + state.doc.child(0).nodeSize;
    const removal = markControllerTransaction(
      state.tr.delete(state.doc.child(0).nodeSize, historyEnd),
    );
    expect(applied(state, removal).changed).toBe(true);
    // An IME composition replaces a range of one paragraph by new text.
    const from = posOf(state.doc, 'First');
    const ime = state.tr.replaceWith(from, from + 5, fb2Schema.text('Первая'));
    const composed = applied(state, ime);
    expect(composed.changed).toBe(true);
    expect(composed.state.doc.child(0).textContent).toContain('Первая annotation line.');
  });

  it("passes the node id plugin's appended transaction after a split inside a block", () => {
    const { state } = stateOf(book());
    const at = posOf(state.doc, 'annotation line.');
    const selected = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
    // The keymap's split clears the id of the new paragraph; the node id plugin assigns one.
    const { state: split, transactions } = selected.applyTransaction(
      selected.tr.split(at, 1, [{ type: N.p!, attrs: { nodeId: null } }]),
    );
    expect(transactions.length).toBeGreaterThan(1); // the node id plugin appended one
    expect(split.doc.child(0).childCount).toBe(3);
    const ids = new Set<string>();
    split.doc.child(0).forEach((child) => ids.add(String(child.attrs.nodeId)));
    expect(ids.size).toBe(3);
    expect([...ids].every((id) => id.length > 0 && id !== 'null')).toBe(true);
  });

  it('keeps one empty paragraph when the whole content of a block is deleted, and lets Add > Body through', () => {
    const { state } = stateOf(book());
    const annotationNode = state.doc.child(0);
    const emptied = applied(
      state,
      state.tr.replaceWith(1, annotationNode.nodeSize - 1, Fragment.empty),
    );
    expect(emptied.changed).toBe(true);
    expect(emptied.state.doc.child(0).type.name).toBe('annotation_block');
    expect(emptied.state.doc.child(0).childCount).toBe(1);
    expect(emptied.state.doc.child(0).child(0).content.size).toBe(0);
    expect(blockToModel(emptied.state.doc.child(0))).toBeUndefined();
    const added = applied(
      state,
      state.tr.insert(
        state.doc.content.size,
        N.body!.create(null, N.section!.create(null, N.p!.create())),
      ),
    );
    expect(added.changed).toBe(true);
    expect(kinds(added.state.doc)).toEqual([
      'annotation_block',
      'history_block',
      'body',
      'body',
      'body',
    ]);
  });
});
