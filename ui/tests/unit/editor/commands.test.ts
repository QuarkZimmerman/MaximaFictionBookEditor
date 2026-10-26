/**
 * Editor command unit tests (T055): every Add / Style command inserts the expected node at a
 * legal position and is disabled at illegal ones; mark toggles; paragraph styles; clone /
 * split / merge / remove-outer; footnote creation (`n_<N>` in the notes body); links.
 */

import { Node as PMNode, type Mark } from 'prosemirror-model';
import { EditorState, NodeSelection, TextSelection, type Command } from 'prosemirror-state';

import {
  addAnnotation,
  addEpigraph,
  addSectionImage,
  addTextAuthor,
  addTitle,
  insertBodyAtEnd,
  insertCite,
  insertImage,
  insertInlineImage,
  insertPoem,
} from '@/editor/commands/insert';
import {
  appendNoteSection,
  canCreateLink,
  collectIds,
  findReference,
  gotoFootnote,
  gotoReference,
  nextNoteNumber,
  removeLink,
  setLink,
} from '@/editor/commands/links';
import {
  currentParagraphStyle,
  markActive,
  setNamedStyle,
  setParagraphStyle,
  toggleInlineMark,
} from '@/editor/commands/marks';
import {
  cloneContainer,
  mergeContainers,
  removeOuterContainer,
  splitContainer,
} from '@/editor/commands/structure';
import {
  canInsertTable,
  gotoNextCell,
  gotoPreviousCell,
  insertTable,
  setNodeAttr,
} from '@/editor/commands/table';
import { enterCommand } from '@/editor/keymap';
import { nodeToModel } from '@/editor/toModel';
import { nodeIdPlugin } from '@/editor/plugins/nodeIds';
import { fb2Schema, FIXED_BLOCK_IDS } from '@/editor/schema';

const { nodes: N, marks: M } = fb2Schema;

/* ------------------------------------------------------------------------ */
/* Fixtures                                                                 */
/* ------------------------------------------------------------------------ */

function p(text = '', attrs: Record<string, unknown> | null = null) {
  return N.p!.create(attrs, text ? fb2Schema.text(text) : undefined);
}
function title(...lines: string[]) {
  return N.title!.create(
    null,
    lines.map((line) => p(line)),
  );
}
function section(children: PMNode[], attrs: Record<string, unknown> | null = null) {
  return N.section!.create(attrs, children);
}
function body(children: PMNode[], attrs: Record<string, unknown> | null = null) {
  return N.body!.create(attrs, children);
}
function doc(...bodies: PMNode[]) {
  return N.doc!.create(null, bodies);
}

/** State with the caret at `pos` (or a range). */
function stateAt(docNode: PMNode, from: number, to = from): EditorState {
  const state = EditorState.create({ doc: docNode });
  return state.apply(state.tr.setSelection(TextSelection.create(docNode, from, to)));
}

/** Position of the first occurrence of `text` in the document (start of the match). */
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

/** Runs a command and returns the resulting state (or null when the command refused). */
function run(state: EditorState, command: Command): EditorState | null {
  let next: EditorState | null = null;
  const ok = command(state, (tr) => {
    next = state.apply(tr);
  });
  if (!ok) return null;
  if (!next) throw new Error('command returned true without dispatching');
  return next;
}

function names(node: PMNode): string[] {
  const out: string[] = [];
  node.forEach((child) => out.push(child.type.name));
  return out;
}

const simpleBook = doc(
  body([title('Book'), section([title('One'), p('First paragraph.'), p('Second paragraph.')])]),
);

/* ------------------------------------------------------------------------ */
/* Add menu                                                                 */
/* ------------------------------------------------------------------------ */

describe('Add menu commands (T059)', () => {
  it('addTitle inserts a title into a section without one and is disabled when one exists', () => {
    const untitled = doc(body([section([p('Text')])]));
    const state = stateAt(untitled, posOf(untitled, 'Text'));
    const next = run(state, addTitle)!;
    expect(names(next.doc.child(0).child(0))).toEqual(['title', 'p']);
    expect(next.doc.child(0).child(0).child(0).childCount).toBe(1);
    // caret inside the new title line
    expect(next.selection.$from.parent.type.name).toBe('p');
    expect(next.selection.$from.node(-1).type.name).toBe('title');
    // Already titled: disabled.
    expect(addTitle(stateAt(simpleBook, posOf(simpleBook, 'First')))).toBe(false);
    expect(next.doc.check()).toBeUndefined();
  });

  it('addTitle uses the selected text as the title line', () => {
    const untitled = doc(body([section([p('Chapter heading'), p('Body text')])]));
    const from = posOf(untitled, 'Chapter heading');
    const next = run(stateAt(untitled, from, from + 'Chapter heading'.length), addTitle)!;
    const sec = next.doc.child(0).child(0);
    expect(sec.child(0).type.name).toBe('title');
    expect(sec.child(0).textContent).toBe('Chapter heading');
    expect(sec.child(1).textContent).toBe(''); // the paragraph lost its text
    expect(next.doc.check()).toBeUndefined();
  });

  it('addEpigraph goes after the title, addAnnotation after epigraphs, one annotation per section', () => {
    let state = stateAt(simpleBook, posOf(simpleBook, 'First'));
    state = run(state, addEpigraph)!;
    const sec = () => state.doc.child(0).child(1);
    expect(names(sec())).toEqual(['title', 'epigraph', 'p', 'p']);
    expect(state.selection.$from.node(-1).type.name).toBe('epigraph');
    // Inside the epigraph the annotation command does not apply (its container is the epigraph).
    expect(addAnnotation(state)).toBe(false);
    state = run(stateAt(state.doc, posOf(state.doc, 'First')), addAnnotation)!;
    expect(names(sec())).toEqual(['title', 'epigraph', 'annotation', 'p', 'p']);
    expect(addAnnotation(state)).toBe(false);
    expect(state.doc.check()).toBeUndefined();
    // Epigraph on the body: after the body title.
    const onBody = stateAt(simpleBook, posOf(simpleBook, 'Book'));
    const withEpigraph = run(onBody, addEpigraph)!;
    expect(names(withEpigraph.doc.child(0))).toEqual(['title', 'epigraph', 'section']);
  });

  it('addEpigraph is disabled inside a cite (not allowed by the schema)', () => {
    const d = doc(body([section([N.cite!.create(null, p('Quote'))])]));
    expect(addEpigraph(stateAt(d, posOf(d, 'Quote')))).toBe(false);
  });

  it('addTextAuthor appends to cite/epigraph/poem and is disabled when one is the last child', () => {
    const d = doc(body([section([N.cite!.create(null, p('Quote'))])]));
    const next = run(stateAt(d, posOf(d, 'Quote')), addTextAuthor)!;
    const cite = next.doc.child(0).child(0).child(0);
    expect(names(cite)).toEqual(['p', 'text_author']);
    expect(addTextAuthor(next)).toBe(false);
    // Not inside a cite/epigraph/poem: disabled.
    expect(addTextAuthor(stateAt(simpleBook, posOf(simpleBook, 'First')))).toBe(false);
  });

  it('insertImage adds a block image after the paragraph, never as the first block', () => {
    const next = run(
      stateAt(simpleBook, posOf(simpleBook, 'First')),
      insertImage({ href: '#pic.jpg' }),
    )!;
    expect(names(next.doc.child(0).child(1))).toEqual(['title', 'p', 'image', 'p']);
    expect(next.selection).toBeInstanceOf(NodeSelection);
    // In a section whose only paragraph would be followed by the image: fine (image is 2nd).
    // Inside a title paragraph: disabled.
    expect(insertImage()(stateAt(simpleBook, posOf(simpleBook, 'One')))).toBe(false);
    expect(next.doc.check()).toBeUndefined();
  });

  it('insertInlineImage inserts at the caret in paragraphs and titles but not in a table cell of a title', () => {
    const next = run(
      stateAt(simpleBook, posOf(simpleBook, 'paragraph.')),
      insertInlineImage({ href: '#i.png' }),
    )!;
    const para = next.doc.child(0).child(1).child(1);
    expect(para.childCount).toBe(3);
    expect(para.child(1).type.name).toBe('inline_image');
    expect(run(stateAt(simpleBook, posOf(simpleBook, 'One')), insertInlineImage())).not.toBeNull();
  });

  it('addSectionImage adds the header image once (body: first; section: after title/epigraphs)', () => {
    let state = stateAt(simpleBook, posOf(simpleBook, 'First'));
    state = run(state, addSectionImage({ href: '#a.jpg' }))!;
    expect(names(state.doc.child(0).child(1))).toEqual(['title', 'image', 'p', 'p']);
    expect(addSectionImage()(state)).toBe(false);
    const onBody = run(
      stateAt(simpleBook, posOf(simpleBook, 'Book')),
      addSectionImage({ href: '#c.jpg' }),
    )!;
    expect(names(onBody.doc.child(0))).toEqual(['image', 'title', 'section']);
    expect(onBody.doc.check()).toBeUndefined();
  });

  it('insertPoem turns the selected paragraphs into stanzas (blank lines separate them)', () => {
    const d = doc(
      body([
        section([
          p('Roses are red'),
          p('Violets are blue'),
          N.empty_line!.create(),
          p('Sugar is sweet'),
          p('After'),
        ]),
      ]),
    );
    const from = posOf(d, 'Roses');
    const to = posOf(d, 'Sugar is sweet') + 'Sugar is sweet'.length;
    const next = run(stateAt(d, from, to), insertPoem)!;
    const sec = next.doc.child(0).child(0);
    expect(names(sec)).toEqual(['poem', 'p']);
    const poem = sec.child(0);
    expect(names(poem)).toEqual(['stanza', 'stanza']);
    expect(poem.child(0).childCount).toBe(2);
    expect(poem.child(0).child(0).type.name).toBe('v');
    expect(poem.child(1).textContent).toBe('Sugar is sweet');
    expect(next.doc.check()).toBeUndefined();
  });

  it('insertPoem / insertCite with a caret insert an empty container after the paragraph', () => {
    const state = stateAt(simpleBook, posOf(simpleBook, 'First'));
    const poem = run(state, insertPoem)!;
    expect(names(poem.doc.child(0).child(1))).toEqual(['title', 'p', 'poem', 'p']);
    expect(poem.selection.$from.parent.type.name).toBe('v');
    const cite = run(state, insertCite)!;
    expect(names(cite.doc.child(0).child(1))).toEqual(['title', 'p', 'cite', 'p']);
    expect(cite.selection.$from.node(-1).type.name).toBe('cite');
    // Not allowed in a title.
    expect(insertCite(stateAt(simpleBook, posOf(simpleBook, 'One')))).toBe(false);
    expect(insertPoem(stateAt(simpleBook, posOf(simpleBook, 'One')))).toBe(false);
  });

  it('insertCite keeps paragraphs / subtitles and is disabled inside a cite', () => {
    const d = doc(body([section([p('A'), N.subtitle!.create(null, fb2Schema.text('S')), p('B')])]));
    const next = run(stateAt(d, posOf(d, 'A'), posOf(d, 'B') + 1), insertCite)!;
    expect(names(next.doc.child(0).child(0))).toEqual(['cite']);
    expect(names(next.doc.child(0).child(0).child(0))).toEqual(['p', 'subtitle', 'p']);
    expect(insertCite(stateAt(next.doc, posOf(next.doc, 'S')))).toBe(false);
  });

  it('insertTable inserts rows (+ header) after the paragraph; Tab navigates and appends rows', () => {
    const state = stateAt(simpleBook, posOf(simpleBook, 'First'));
    expect(canInsertTable(state)).toBe(true);
    let next = run(state, insertTable(2, true))!;
    const sec = next.doc.child(0).child(1);
    expect(names(sec)).toEqual(['title', 'p', 'table', 'p']);
    const table = sec.child(2);
    expect(table.childCount).toBe(3);
    expect(table.child(0).child(0).type.name).toBe('th');
    expect(table.child(1).child(0).type.name).toBe('td');
    expect(next.selection.$from.parent.type.name).toBe('th');
    next = run(next, gotoNextCell)!;
    expect(next.selection.$from.parent.type.name).toBe('td');
    next = run(next, gotoNextCell)!;
    next = run(next, gotoNextCell)!; // past the last cell: a new row
    expect(next.doc.child(0).child(1).child(2).childCount).toBe(4);
    next = run(next, gotoPreviousCell)!;
    expect(next.selection.$from.parent.type.name).toBe('td');
    expect(canInsertTable(next)).toBe(false); // inside the table
    expect(canInsertTable(stateAt(simpleBook, posOf(simpleBook, 'One')))).toBe(false);
    expect(next.doc.check()).toBeUndefined();
  });

  it('setNodeAttr edits table / cell attributes (Table bar)', () => {
    const state = run(stateAt(simpleBook, posOf(simpleBook, 'First')), insertTable(1, false))!;
    const tablePos = state.selection.$from.before(state.selection.$from.depth - 2);
    const cellPos = state.selection.$from.before();
    let next = run(state, setNodeAttr(tablePos, 'id', 't1'))!;
    next = run(next, setNodeAttr(cellPos, 'colspan', 2))!;
    next = run(next, setNodeAttr(cellPos, 'align', 'center'))!;
    const table = next.doc.nodeAt(tablePos)!;
    expect(table.attrs.id).toBe('t1');
    expect(next.doc.nodeAt(cellPos)!.attrs).toMatchObject({ colspan: 2, align: 'center' });
    expect(setNodeAttr(cellPos, 'nonsense', 'x')(next)).toBe(false);
  });

  it('insertBodyAtEnd appends a body with a title and a section', () => {
    const next = run(stateAt(simpleBook, posOf(simpleBook, 'First')), insertBodyAtEnd)!;
    expect(next.doc.childCount).toBe(2);
    expect(names(next.doc.child(1))).toEqual(['title', 'section']);
    expect(next.selection.$from.node(1)).toBe(next.doc.child(1));
    expect(next.doc.check()).toBeUndefined();
  });
});

/* ------------------------------------------------------------------------ */
/* Style menu                                                               */
/* ------------------------------------------------------------------------ */

describe('Style commands (T058)', () => {
  it('toggles inline marks on a selection and reports the active state', () => {
    const from = posOf(simpleBook, 'First');
    const state = stateAt(simpleBook, from, from + 5);
    const bold = run(state, toggleInlineMark('strong'))!;
    expect(markActive(bold, M.strong!)).toBe(true);
    expect(bold.doc.nodeAt(from)!.marks.map((m) => m.type.name)).toEqual(['strong']);
    const plain = run(bold, toggleInlineMark('strong'))!;
    expect(markActive(plain, M.strong!)).toBe(false);
    for (const name of ['emphasis', 'strikethrough', 'sub', 'sup', 'code'] as const) {
      const marked = run(state, toggleInlineMark(name))!;
      expect(markActive(marked, M[name]!)).toBe(true);
    }
    // Marks cannot be applied with the selection across an image node selection.
    const imageDoc = doc(body([section([p('x'), N.image!.create({ href: '#a' })])]));
    const nodeSel = EditorState.create({ doc: imageDoc }).apply(
      EditorState.create({ doc: imageDoc }).tr.setSelection(NodeSelection.create(imageDoc, 5)),
    );
    expect(toggleInlineMark('strong')(nodeSel)).toBe(false);
  });

  it('applies and clears the named style mark', () => {
    const from = posOf(simpleBook, 'Second');
    const state = stateAt(simpleBook, from, from + 6);
    const styled = run(state, setNamedStyle('note'))!;
    expect(styled.doc.nodeAt(from)!.marks[0]!.attrs).toEqual({ name: 'note', lang: null });
    const cleared = run(styled, setNamedStyle(''))!;
    expect(cleared.doc.nodeAt(from)!.marks).toHaveLength(0);
    expect(setNamedStyle('x')(stateAt(simpleBook, from))).toBe(false); // needs a selection
  });

  it('converts paragraphs between Normal / Subtitle / Text author where the schema allows', () => {
    const state = stateAt(simpleBook, posOf(simpleBook, 'Second'));
    expect(currentParagraphStyle(state)).toBe('normal');
    const subtitle = run(state, setParagraphStyle('subtitle'))!;
    expect(subtitle.doc.child(0).child(1).child(2).type.name).toBe('subtitle');
    expect(currentParagraphStyle(subtitle)).toBe('subtitle');
    const normal = run(subtitle, setParagraphStyle('normal'))!;
    expect(normal.doc.child(0).child(1).child(2).type.name).toBe('p');
    // Text author is not allowed directly in a section.
    expect(setParagraphStyle('textAuthor')(state)).toBe(false);
    // ... but is in a cite, only as the last paragraph.
    const citeDoc = doc(body([section([N.cite!.create(null, [p('Quote'), p('Author')])])]));
    expect(setParagraphStyle('textAuthor')(stateAt(citeDoc, posOf(citeDoc, 'Quote')))).toBe(false);
    const authored = run(
      stateAt(citeDoc, posOf(citeDoc, 'Author')),
      setParagraphStyle('textAuthor'),
    )!;
    expect(names(authored.doc.child(0).child(0).child(0))).toEqual(['p', 'text_author']);
    // Normal in a stanza means a verse; subtitle in a title is not allowed.
    const poemDoc = doc(
      body([
        section([
          N.poem!.create(null, N.stanza!.create(null, N.v!.create(null, fb2Schema.text('line')))),
        ]),
      ]),
    );
    const verse = stateAt(poemDoc, posOf(poemDoc, 'line'));
    expect(currentParagraphStyle(verse)).toBe('normal');
    expect(setParagraphStyle('subtitle')(stateAt(simpleBook, posOf(simpleBook, 'One')))).toBe(
      false,
    );
  });
});

/* ------------------------------------------------------------------------ */
/* Containers                                                               */
/* ------------------------------------------------------------------------ */

describe('Container operations (T060)', () => {
  it('cloneContainer adds an empty sibling of the same kind after the current one', () => {
    const next = run(stateAt(simpleBook, posOf(simpleBook, 'First')), cloneContainer)!;
    expect(names(next.doc.child(0))).toEqual(['title', 'section', 'section']);
    const clone = next.doc.child(0).child(2);
    expect(names(clone)).toEqual(['title', 'p']);
    expect(clone.textContent).toBe('');
    expect(next.selection.$from.node(2)).toBe(clone);
    // From the title of the section: the section is cloned too (GetCP skips titles).
    expect(run(stateAt(simpleBook, posOf(simpleBook, 'One')), cloneContainer)).not.toBeNull();
    // Body title: not clonable.
    expect(cloneContainer(stateAt(simpleBook, posOf(simpleBook, 'Book')))).toBe(false);
    expect(next.doc.check()).toBeUndefined();
  });

  it('splitContainer splits a section at the caret (text after the caret moves)', () => {
    const pos = posOf(simpleBook, 'Second');
    const next = run(stateAt(simpleBook, pos), splitContainer)!;
    const bodyNode = next.doc.child(0);
    expect(names(bodyNode)).toEqual(['title', 'section', 'section']);
    expect(bodyNode.child(1).textContent).toBe('OneFirst paragraph.');
    expect(bodyNode.child(2).textContent).toBe('Second paragraph.');
    expect(names(bodyNode.child(2))).toEqual(['p']);
    expect(next.selection.$from.node(2)).toBe(bodyNode.child(2));
    // At the very start of the section: refused.
    const untitled = doc(body([section([p('First'), p('Second')])]));
    expect(splitContainer(stateAt(untitled, posOf(untitled, 'First')))).toBe(false);
    expect(run(stateAt(untitled, posOf(untitled, 'Second')), splitContainer)).not.toBeNull();
    // In a title: refused.
    expect(splitContainer(stateAt(simpleBook, posOf(simpleBook, 'One')))).toBe(false);
    expect(next.doc.check()).toBeUndefined();
  });

  it('splitContainer makes the selected text the title of the new section', () => {
    const from = posOf(simpleBook, 'Second');
    const next = run(stateAt(simpleBook, from, from + 'Second'.length), splitContainer)!;
    const second = next.doc.child(0).child(2);
    expect(names(second)).toEqual(['title', 'p']);
    expect(second.child(0).textContent).toBe('Second');
    expect(second.child(1).textContent).toBe(' paragraph.');
    expect(next.doc.check()).toBeUndefined();
  });

  it('splitContainer splits stanzas', () => {
    const poemDoc = doc(
      body([
        section([
          N.poem!.create(
            null,
            N.stanza!.create(null, [
              N.v!.create(null, fb2Schema.text('one')),
              N.v!.create(null, fb2Schema.text('two')),
            ]),
          ),
        ]),
      ]),
    );
    const next = run(stateAt(poemDoc, posOf(poemDoc, 'two')), splitContainer)!;
    const poem = next.doc.child(0).child(0).child(0);
    expect(names(poem)).toEqual(['stanza', 'stanza']);
    expect(poem.child(0).textContent).toBe('one');
    expect(poem.child(1).textContent).toBe('two');
    expect(next.doc.check()).toBeUndefined();
  });

  it('mergeContainers appends the next section (its title becomes subtitles)', () => {
    const d = doc(
      body([
        section([title('A'), p('a1')]),
        section([title('B'), N.epigraph!.create(null, p('e')), p('b1')]),
      ]),
    );
    const next = run(stateAt(d, posOf(d, 'a1')), mergeContainers)!;
    expect(names(next.doc.child(0))).toEqual(['section']);
    expect(names(next.doc.child(0).child(0))).toEqual(['title', 'p', 'subtitle', 'p']);
    expect(next.doc.child(0).child(0).child(2).textContent).toBe('B');
    // Last section: nothing to merge with.
    expect(mergeContainers(next)).toBe(false);
    expect(next.doc.check()).toBeUndefined();
  });

  it('mergeContainers nests the next section when the current one holds sections', () => {
    const d = doc(
      body([section([title('Part'), section([p('x')])]), section([title('Next'), p('y')])]),
    );
    const next = run(stateAt(d, posOf(d, 'Part')), mergeContainers)!;
    const part = next.doc.child(0).child(0);
    expect(names(part)).toEqual(['title', 'section', 'section']);
    expect(part.child(2).textContent).toBe('Nexty');
    expect(next.doc.check()).toBeUndefined();
  });

  it('mergeContainers merges stanzas and cites (text authors become paragraphs)', () => {
    const d = doc(
      body([
        section([
          N.cite!.create(null, [p('q1'), N.text_author!.create(null, fb2Schema.text('ta'))]),
          N.cite!.create(null, [p('q2')]),
        ]),
      ]),
    );
    const next = run(stateAt(d, posOf(d, 'q1')), mergeContainers)!;
    expect(names(next.doc.child(0).child(0).child(0))).toEqual(['p', 'p', 'p']);
    expect(next.doc.check()).toBeUndefined();
  });

  it('removeOuterContainer replaces a section of sections by its children', () => {
    const d = doc(body([section([title('Part'), section([p('x')]), section([p('y')])])]));
    const next = run(stateAt(d, posOf(d, 'Part')), removeOuterContainer)!;
    expect(names(next.doc.child(0))).toEqual(['section', 'section']);
    expect(removeOuterContainer(stateAt(simpleBook, posOf(simpleBook, 'First')))).toBe(false);
    expect(next.doc.check()).toBeUndefined();
  });
});

/* ------------------------------------------------------------------------ */
/* Links and footnotes                                                      */
/* ------------------------------------------------------------------------ */

describe('Links and footnotes (T061)', () => {
  it('setLink / removeLink work on selections and on the link run at the caret', () => {
    const from = posOf(simpleBook, 'First');
    expect(canCreateLink(stateAt(simpleBook, from))).toBe(false);
    const linked = run(stateAt(simpleBook, from, from + 5), setLink('#target'))!;
    const mark = linked.doc.nodeAt(from)!.marks[0]!;
    expect(mark.type.name).toBe('link');
    expect(mark.attrs).toEqual({ href: '#target', type: null, xlinkType: null });
    // Caret inside the link: editable / removable.
    const caret = stateAt(linked.doc, from + 2);
    expect(canCreateLink(caret)).toBe(true);
    const retargeted = run(caret, setLink('http://example.org'))!;
    expect(retargeted.doc.nodeAt(from)!.marks[0]!.attrs.href).toBe('http://example.org');
    const removed = run(retargeted, removeLink)!;
    expect(removed.doc.nodeAt(from)!.marks).toHaveLength(0);
    expect(removeLink(removed)).toBe(false);
  });

  it('bold and a link applied to a selected inline image reach its model marks', () => {
    // Feature 006 (FR-067; vR9 N3): ProseMirror puts formatting and links on a selected
    // picture; the conversion now carries them to the model (and so to the file).
    const picture = N.inline_image!.create({ nodeId: 'i1', href: '#pic.png' });
    const d = doc(
      body([section([N.p!.create({ nodeId: 'p1' }, [fb2Schema.text('see '), picture])])]),
    );
    const at = posOf(d, 'see') + 4;
    expect(d.nodeAt(at)!.type).toBe(N.inline_image);
    const selected = EditorState.create({ doc: d }).apply(
      EditorState.create({ doc: d }).tr.setSelection(NodeSelection.create(d, at)),
    );
    const bold = run(selected, toggleInlineMark('strong'))!;
    const linked = run(
      bold.apply(bold.tr.setSelection(NodeSelection.create(bold.doc, at))),
      setLink('#n_1', 'note'),
    )!;
    const image = linked.doc.nodeAt(at)!;
    expect(image.marks.map((m) => m.type.name)).toEqual(['strong', 'link']);
    expect(nodeToModel(image)).toEqual({
      type: 'inline-image',
      attrs: { nodeId: 'i1', href: '#pic.png' },
      marks: [{ type: 'strong' }, { type: 'link', attrs: { href: '#n_1', type: 'note' } }],
    });
    // The paragraph's text is untouched.
    expect(linked.doc.nodeAt(posOf(d, 'see'))!.marks).toEqual([]);
  });

  it("setLink keeps the link's xlinkType when it changes href or type", () => {
    // Feature 006 (FR-064): a link read with xlink:type keeps it through an edit of its target
    // or its kind; a new link gets none.
    const read = M.link!.create({ href: '#s1', type: null, xlinkType: 'simple' });
    const d = doc(
      body([
        section([N.p!.create(null, [fb2Schema.text('see '), fb2Schema.text('here', [read])])]),
      ]),
    );
    const from = posOf(d, 'here');
    const linkAt = (state: EditorState) =>
      state.doc.nodeAt(from)!.marks.find((m) => m.type === M.link)!.attrs;
    // The caret in the link: href changed, then the type.
    const retargeted = run(stateAt(d, from + 2), setLink('#s2'))!;
    expect(linkAt(retargeted)).toEqual({ href: '#s2', type: null, xlinkType: 'simple' });
    const asNote = run(stateAt(retargeted.doc, from + 1), setLink('#n_1', 'note'))!;
    expect(linkAt(asNote)).toEqual({ href: '#n_1', type: 'note', xlinkType: 'simple' });
    // A selection over the link: the same.
    const selected = run(stateAt(asNote.doc, from, from + 4), setLink('#s3'))!;
    expect(linkAt(selected)).toEqual({ href: '#s3', type: null, xlinkType: 'simple' });
    // A new link over plain text gets none.
    const fresh = run(stateAt(d, posOf(d, 'see'), posOf(d, 'see') + 3), setLink('#s4'))!;
    expect(fresh.doc.nodeAt(posOf(d, 'see'))!.marks[0]!.attrs).toEqual({
      href: '#s4',
      type: null,
      xlinkType: null,
    });
  });

  it('numbers footnotes n_<N> after the highest existing one and creates the notes body', () => {
    expect(nextNoteNumber([])).toBe(1);
    expect(nextNoteNumber(['n_1', 'n_7', 'x', 'n_3'])).toBe(8);
    const state = stateAt(simpleBook, posOf(simpleBook, 'First'));
    const ids = collectIds(state.doc);
    const n = nextNoteNumber(ids);
    const result = appendNoteSection(state.tr, n, 'Notes')!;
    expect(result.id).toBe('n_1');
    const next = state.apply(result.tr);
    expect(next.doc.childCount).toBe(2);
    const notes = next.doc.child(1);
    expect(notes.attrs.name).toBe('notes');
    expect(names(notes)).toEqual(['title', 'section']);
    expect(notes.child(0).textContent).toBe('Notes');
    expect(notes.child(1).attrs.id).toBe('n_1');
    expect(notes.child(1).child(0).textContent).toBe('1');
    // A second note goes into the existing notes body.
    const again = appendNoteSection(next.tr, nextNoteNumber(collectIds(next.doc)), null)!;
    expect(again.id).toBe('n_2');
    const after = next.apply(again.tr);
    expect(after.doc.child(1).childCount).toBe(3);
    expect(after.doc.check()).toBeUndefined();
  });

  it('gotoFootnote jumps to the note text and gotoReference back to the link', () => {
    const d = doc(
      body([section([p('See note'), p('x')])]),
      body([title('Notes'), section([title('1'), p('The note.')], { id: 'n_1' })], {
        name: 'notes',
      }),
    );
    const from = posOf(d, 'note');
    const linked = run(stateAt(d, from, from + 4), setLink('#n_1', 'note'))!;
    const jumped = run(stateAt(linked.doc, from + 1), gotoFootnote)!;
    expect(jumped.selection.$from.parent.textContent).toBe('The note.');
    const back = run(jumped, gotoReference)!;
    expect(back.selection.from).toBe(from + 4); // right after the reference
    // Missing target: the command reports false ("Reference not found." is shown by the feature).
    const dangling = run(stateAt(d, from, from + 4), setLink('#nowhere'))!;
    expect(gotoFootnote(stateAt(dangling.doc, from + 1))).toBe(false);
  });

  it('gotoReference finds a note reference made of a picture alone', () => {
    // Feature 006 (FR-067 as amended at /speckit-analyze): the reference is an inline image
    // carrying the note's link mark; the caret lands right after the picture.
    const noteLink = M.link!.create({ href: '#n_1', type: 'note' });
    const otherLink = M.link!.create({ href: '#n_2', type: 'note' });
    const picture = (marks: readonly Mark[] = []) =>
      N.inline_image!.create({ href: '#pic.png' }, null, marks);
    const d = doc(
      body([
        section([
          N.p!.create(null, [fb2Schema.text('Other '), picture([otherLink])]),
          N.p!.create(null, [fb2Schema.text('Plain '), picture()]),
          N.p!.create(null, [fb2Schema.text('See the picture '), picture([noteLink])]),
        ]),
      ]),
      body([title('Notes'), section([title('1'), p('The note.')], { id: 'n_1' })], {
        name: 'notes',
      }),
    );
    const at = posOf(d, 'See the picture ') + 'See the picture '.length;
    expect(d.nodeAt(at)!.type).toBe(N.inline_image);
    expect(findReference(d, 'n_1')).toEqual({ from: at, to: at + 1 });
    const inNote = stateAt(d, posOf(d, 'The note.') + 3);
    const back = run(inNote, gotoReference)!;
    expect(back.selection.empty).toBe(true);
    expect(back.selection.from).toBe(at + 1); // right after the picture
    expect(back.selection.$from.parent.textContent).toBe('See the picture ');
    // A picture with another link, or without marks, is no reference to n_1.
    expect(findReference(d, 'n_3')).toBeNull();
    const withoutNote = doc(
      body([
        section([
          N.p!.create(null, [fb2Schema.text('Other '), picture([otherLink])]),
          N.p!.create(null, [fb2Schema.text('Plain '), picture()]),
        ]),
      ]),
      body([title('Notes'), section([title('1'), p('The note.')], { id: 'n_1' })], {
        name: 'notes',
      }),
    );
    expect(findReference(withoutNote, 'n_1')).toBeNull();
    expect(gotoReference(stateAt(withoutNote, posOf(withoutNote, 'The note.') + 1))).toBe(false);
    // The first reference in document order wins, text or picture.
    const textFirst = doc(
      body([
        section([
          N.p!.create(null, [fb2Schema.text('note', [noteLink])]),
          N.p!.create(null, [picture([noteLink])]),
        ]),
      ]),
      body([section([p('The note.')], { id: 'n_1' })], { name: 'notes' }),
    );
    const word = posOf(textFirst, 'note');
    expect(findReference(textFirst, 'n_1')).toEqual({ from: word, to: word + 4 });
  });
});

/* ------------------------------------------------------------------------ */
/* Annotation and history blocks (feature 004, US2)                         */
/* ------------------------------------------------------------------------ */

describe('commands inside the annotation and history blocks (004 US2)', () => {
  function blockBook() {
    return N.doc!.create(null, [
      N.annotation_block!.create({ nodeId: FIXED_BLOCK_IDS.annotation }, [
        p('Annotation text'),
        p('Second line'),
      ]),
      N.history_block!.create({ nodeId: FIXED_BLOCK_IDS.history }, [p('History text')]),
      body([title('Book'), section([title('One'), p('First paragraph.')])]),
    ]);
  }

  it('offers paragraph, subtitle, poem, cite and table and keeps the section commands unavailable', () => {
    const d = blockBook();
    const inAnnotation = stateAt(d, posOf(d, 'Annotation text'));
    const inHistory = stateAt(d, posOf(d, 'History text'));
    for (const state of [inAnnotation, inHistory]) {
      // Section-level commands: add title / epigraph / annotation / section image / block
      // image, clone / split / merge / remove outer - all unavailable.
      expect(addTitle(state)).toBe(false);
      expect(addEpigraph(state)).toBe(false);
      expect(addAnnotation(state)).toBe(false);
      expect(addSectionImage()(state)).toBe(false);
      expect(insertImage()(state)).toBe(false);
      expect(addTextAuthor(state)).toBe(false);
      expect(cloneContainer(state)).toBe(false);
      expect(splitContainer(state)).toBe(false);
      expect(mergeContainers(state)).toBe(false);
      expect(removeOuterContainer(state)).toBe(false);
      expect(setParagraphStyle('textAuthor')(state)).toBe(false);
      // The annotation content model: subtitle, poem, cite, table, inline image and marks.
      expect(setParagraphStyle('subtitle')(state)).toBe(true);
      expect(insertPoem(state)).toBe(true);
      expect(insertCite(state)).toBe(true);
      expect(canInsertTable(state)).toBe(true);
      expect(insertInlineImage()(state)).toBe(true);
      expect(toggleInlineMark('strong')(state)).toBe(true);
    }
    const subtitled = run(inAnnotation, setParagraphStyle('subtitle'))!;
    expect(names(subtitled.doc.child(0))).toEqual(['subtitle', 'p']);
    expect(setParagraphStyle('normal')(subtitled)).toBe(true);
    const poem = run(inHistory, insertPoem)!;
    expect(names(poem.doc.child(1))).toEqual(['p', 'poem']);
    expect(poem.doc.check()).toBeUndefined();
    const cite = run(inHistory, insertCite)!;
    expect(names(cite.doc.child(1))).toEqual(['p', 'cite']);
    const table = run(inHistory, insertTable(1, false))!;
    expect(names(table.doc.child(1))).toEqual(['p', 'table']);
    expect(table.doc.check()).toBeUndefined();
  });

  it('Enter on the empty trailing paragraph of a block does not leave the block', () => {
    const d = N.doc!.create(null, [
      N.annotation_block!.create({ nodeId: FIXED_BLOCK_IDS.annotation }, [p('Text'), p('')]),
      N.history_block!.create({ nodeId: FIXED_BLOCK_IDS.history }, [p('History')]),
      body([section([p('Body')])]),
    ]);
    const base = EditorState.create({ doc: d, plugins: [nodeIdPlugin()] });
    const emptyLine = d.child(0).nodeSize - 2; // inside the trailing empty paragraph
    const state = base.apply(base.tr.setSelection(TextSelection.create(d, emptyLine)));
    expect(state.selection.$from.parent.content.size).toBe(0);
    const next = run(state, enterCommand)!;
    // The caret is still in the annotation block (an empty line and a new paragraph, as in a
    // section); nothing moved into the history block or the body.
    expect(next.selection.$from.node(1).type.name).toBe('annotation_block');
    expect(names(next.doc.child(0))).toEqual(['p', 'empty_line', 'p']);
    expect(names(next.doc.child(1))).toEqual(['p']);
    expect(next.doc.check()).toBeUndefined();
  });
});
