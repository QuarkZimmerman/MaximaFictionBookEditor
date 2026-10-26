/**
 * The Source view's table rule (feature 006, T055; FR-061 "Where" and "Unavailable"; US1
 * sc.10; I23; C3, C37, C38; data-model §7.3 "SourceVerdict" and "The rule"; research R4.2 to
 * R4.4): every verdict code of `sourceTablePoint` on headless CodeMirror states - `loading`,
 * `failed` and `analysing` from the context and an incomplete tree; `notWellFormed` with the
 * line of the first problem (an unclosed element at its start tag, C37's cheap checks, the
 * core's parse error); `inTag`, `inMarkup`, `outsideRoot` and `inText`; `ok` and `notAllowed`
 * between elements by the content-model automata, without the Body view's heading-part guard
 * (C3), and leniently in a parent that is invalid elsewhere (C38); and the bounded walk back
 * to the nearest synchronising child equal to a full walk from the parent's first child.
 */

import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState } from '@codemirror/state';

import { FB2_ELEMENTS } from '@/views/source/completion';
import { contentModelOf, step } from '@/views/source/contentModel';
import { sourceLanguage } from '@/views/source/extensions';
import type { SourceLoadStatus } from '@/views/source/sourceEditor';
import {
  modelStateBefore,
  sourceTablePoint,
  type SourceTableContext,
  type SourceVerdict,
} from '@/views/source/tablePoint';

/* ------------------------------------------------------------------------ */
/* Texts and helpers                                                        */
/* ------------------------------------------------------------------------ */

const FB2_NS = 'http://www.gribuser.ru/xml/fictionbook/2.0';

/** A book in the writer's layout (a tab per level); line numbers in the comments. */
const LINES = [
  '<?xml version="1.0" encoding="utf-8"?>', // 1
  `<FictionBook xmlns="${FB2_NS}" xmlns:l="http://www.w3.org/1999/xlink">`, // 2
  '\t<description>', // 3
  '\t\t<title-info>', // 4
  '\t\t\t<genre>prose_classic</genre>', // 5
  '\t\t\t<annotation>', // 6
  '\t\t\t\t<p>Annotation</p>', // 7
  '\t\t\t</annotation>', // 8
  '\t\t</title-info>', // 9
  '\t</description>', // 10
  '\t<body>', // 11
  '\t\t<section id="s1">', // 12
  '\t\t\t<title>', // 13
  '\t\t\t\t<p>One</p>', // 14
  '\t\t\t</title>', // 15
  '\t\t\t<epigraph>', // 16
  '\t\t\t\t<p>Epigraph</p>', // 17
  '\t\t\t</epigraph>', // 18
  '\t\t\t<p>First &amp; &#160;foremost</p>', // 19
  '\t\t\t<p>Second</p>', // 20
  '\t\t\t<cite>', // 21
  '\t\t\t\t<p>Cited</p>', // 22
  '\t\t\t\t<text-author>Author</text-author>', // 23
  '\t\t\t</cite>', // 24
  '\t\t</section>', // 25
  '\t\t<section>', // 26
  '\t\t\t<title>', // 27
  '\t\t\t\t<p>Two</p>', // 28
  '\t\t\t</title>', // 29
  '\t\t\t<image l:href="#pic.png"/>', // 30
  '\t\t\t<p>Text</p>', // 31
  '\t\t\t<p></p>', // 32
  '\t\t</section>', // 33
  '\t</body>', // 34
  '\t<binary id="pic.png" content-type="image/png">\u2026120 bytes\u2026</binary>', // 35
  '</FictionBook>', // 36
  '',
];
const BOOK = LINES.join('\n');

const READY: SourceTableContext = { status: 'ready', parseError: null };

/** Offset of the `nth` occurrence of `needle` in `text`. */
function offsetOf(text: string, needle: string, nth = 0): number {
  let at = -1;
  for (let i = 0; i <= nth; i += 1) {
    at = text.indexOf(needle, at + 1);
    if (at < 0) throw new Error(`"${needle}" (${nth}) not in the text`);
  }
  return at;
}

/** Offset right after the `nth` occurrence of `needle`. */
const after = (text: string, needle: string, nth = 0) =>
  offsetOf(text, needle, nth) + needle.length;

/** 1-based line of an offset. */
const lineAt = (text: string, offset: number) => text.slice(0, offset).split('\n').length;

/** `text` with the first occurrence of `from` replaced by `to`. */
function edit(text: string, from: string, to: string): string {
  const at = offsetOf(text, from);
  return text.slice(0, at) + to + text.slice(at + from.length);
}

/** A headless state of the Source view's language, its syntax tree complete unless told. */
function stateOf(doc: string, pos = 0, complete = true): EditorState {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(pos),
    extensions: [sourceLanguage()],
  });
  if (complete) ensureSyntaxTree(state, state.doc.length, 10_000);
  return state;
}

function verdictAt(doc: string, at: number, context: SourceTableContext = READY): SourceVerdict {
  return sourceTablePoint(stateOf(doc, at), context);
}

const code = (doc: string, at: number) => verdictAt(doc, at).code;

/** The `ok` verdict of a point in the parent element whose start tag is `openTag` (nth). */
function okIn(doc: string, at: number, openTag: string, name: string, prefix = '', nth = 0) {
  const from = offsetOf(doc, openTag, nth);
  const openTo = from + openTag.length;
  const closeTag = `</${prefix ? `${prefix}:` : ''}${name}>`;
  // The matching end tag: the first one after the start tag at the same nesting (the texts
  // here never nest a parent in itself between the point and its end).
  const closeFrom = doc.indexOf(closeTag, Math.max(at, openTo));
  return {
    code: 'ok',
    pos: at,
    parent: { name, from, openTo, closeFrom, to: closeFrom + closeTag.length },
    prefix,
  };
}

/* ------------------------------------------------------------------------ */
/* Loading, failure, analysis                                               */
/* ------------------------------------------------------------------------ */

describe('sourceTablePoint: the load status and the syntax tree', () => {
  const between = after(BOOK, '<p>First &amp; &#160;foremost</p>');

  it('answers loading while the text is not loaded (status idle or loading) and failed for a failed load', () => {
    const state = stateOf(BOOK, between);
    const at = (status: SourceLoadStatus) => sourceTablePoint(state, { status, parseError: null });
    expect(at('idle')).toEqual({ code: 'loading' });
    expect(at('loading')).toEqual({ code: 'loading' });
    expect(at('failed')).toEqual({ code: 'failed' });
    expect(at('ready').code).toBe('ok');
  });

  it('answers analysing while the tree does not reach the end of the text, then judges', () => {
    // Far longer than the 3,000 characters CodeMirror parses when a state is created.
    const paragraphs = Array.from({ length: 2_000 }, (_, i) => `\t\t\t<p>Paragraph ${i}</p>`);
    const long = edit(
      BOOK,
      '\t\t\t<p>Second</p>',
      ['\t\t\t<p>Second</p>', ...paragraphs].join('\n'),
    );
    const state = stateOf(long, between, false);
    expect(sourceTablePoint(state, READY)).toEqual({ code: 'analysing' });
    // The load status comes first.
    expect(sourceTablePoint(state, { status: 'loading', parseError: null })).toEqual({
      code: 'loading',
    });
    ensureSyntaxTree(state, state.doc.length, 10_000);
    expect(sourceTablePoint(state, READY).code).toBe('ok');
  });

  it('takes the end of the main selection as the point, and `at` when given', () => {
    // A selection from the paragraph's text to the point after it, in both directions: its end
    // (`to`) is the point between the paragraphs.
    const inText = offsetOf(BOOK, 'foremost');
    for (const [anchor, head] of [
      [inText, between],
      [between, inText],
    ] as const) {
      const selected = EditorState.create({
        doc: BOOK,
        selection: EditorSelection.single(anchor, head),
        extensions: [sourceLanguage()],
      });
      ensureSyntaxTree(selected, selected.doc.length, 10_000);
      expect(sourceTablePoint(selected, READY).code).toBe('ok');
      expect(sourceTablePoint(selected, READY, inText).code).toBe('inText');
    }
  });
});

/* ------------------------------------------------------------------------ */
/* Well-formedness                                                          */
/* ------------------------------------------------------------------------ */

describe('sourceTablePoint: notWellFormed with the line of the first problem', () => {
  const at = after(BOOK, '<p>First &amp; &#160;foremost</p>');

  function lineOf(doc: string, point = at): number {
    const verdict = verdictAt(doc, Math.min(point, doc.length));
    expect(verdict.code).toBe('notWellFormed');
    return (verdict as { line: number }).line;
  }

  it('is well-formed as written: references to the five entities and character references stay allowed', () => {
    expect(code(BOOK, at)).toBe('ok');
  });

  it('reports a broken closing tag on its line', () => {
    // One `>` deleted: Lezer notices it at the next tag, the problem is the tag on line 20.
    expect(lineOf(edit(BOOK, '<p>Second</p>', '<p>Second</p'))).toBe(20);
  });

  it('reports an unclosed element at its start tag', () => {
    expect(lineOf(edit(BOOK, '\t\t\t</epigraph>\n', ''))).toBe(16);
    // ... also at the end of the text, where no ancestor closes it.
    expect(lineOf(edit(BOOK, '</FictionBook>', ''), 10)).toBe(2);
  });

  it('reports a mismatched closing tag', () => {
    expect(lineOf(edit(BOOK, '<p>Second</p>', '<p>Second</q>'))).toBe(20);
  });

  it('reports a duplicate attribute name in a tag', () => {
    expect(lineOf(edit(BOOK, '<section id="s1">', '<section id="s1" id="s2">'))).toBe(12);
  });

  it('reports `<` inside an attribute value', () => {
    expect(lineOf(edit(BOOK, 'l:href="#pic.png"', 'l:href="#pic<png"'))).toBe(30);
  });

  it('reports an entity reference other than the five predefined ones', () => {
    expect(lineOf(edit(BOOK, '<p>Second</p>', '<p>Second&nbsp;</p>'))).toBe(20);
    expect(lineOf(edit(BOOK, 'id="s1"', 'id="&nbsp;"'))).toBe(12);
  });

  it('reports an illegal XML character in text', () => {
    expect(lineOf(edit(BOOK, '<p>Text</p>', '<p>Te\u0001xt</p>'))).toBe(31);
    expect(lineOf(edit(BOOK, '<p>Text</p>', '<p>Te\uFFFExt</p>'))).toBe(31);
  });

  it('reports a second top-level element and top-level text', () => {
    expect(lineOf(`${BOOK}<extra/>\n`)).toBe(37);
    expect(lineOf(`${BOOK}\ntrailing words\n`)).toBe(38);
    // White space and comments around the root element are fine.
    expect(code(`${BOOK}\n<!-- end -->\n\n`, at)).toBe('ok');
  });

  it('reports the core’s parse error of this text with its line, before anything else', () => {
    const verdict = verdictAt(BOOK, at, { status: 'ready', parseError: { line: 7 } });
    expect(verdict).toEqual({ code: 'notWellFormed', line: 7 });
    // The load status still comes first.
    expect(verdictAt(BOOK, at, { status: 'loading', parseError: { line: 7 } }).code).toBe(
      'loading',
    );
  });

  it('gives the first of several problems', () => {
    const broken = edit(
      edit(BOOK, 'l:href="#pic.png"', 'l:href="#pic<png"'),
      '<p>Second</p>',
      '<p>Second</p',
    );
    expect(lineOf(broken)).toBe(20);
  });
});

/* ------------------------------------------------------------------------ */
/* Tags, markup, the root, text                                             */
/* ------------------------------------------------------------------------ */

describe('sourceTablePoint: inTag, inMarkup, outsideRoot and inText', () => {
  it('answers inTag strictly inside open, close and self-closing tags, attribute values included', () => {
    expect(code(BOOK, offsetOf(BOOK, '<section id="s1">') + 3)).toBe('inTag');
    expect(code(BOOK, offsetOf(BOOK, '"s1"') + 2)).toBe('inTag');
    expect(code(BOOK, offsetOf(BOOK, '</p>', 4) + 1)).toBe('inTag');
    expect(code(BOOK, offsetOf(BOOK, '<image') + 8)).toBe('inTag');
    expect(code(BOOK, after(BOOK, '<image l:href="#pic.png"') + 1)).toBe('inTag');
    // A self-closed container has no point inside (R4 open point 4).
    const selfClosed = edit(BOOK, '<p>Text</p>', '<p>Text</p><annotation/>');
    expect(code(selfClosed, offsetOf(selfClosed, '<annotation/>') + 11)).toBe('inTag');
  });

  it('does not count a tag’s own `<` or the position right after its `>` as inside', () => {
    expect(code(BOOK, offsetOf(BOOK, '<p>Second'))).toBe('ok');
    expect(code(BOOK, after(BOOK, '<p>Second</p>'))).toBe('ok');
    expect(code(BOOK, after(BOOK, '<section id="s1">'))).toBe('notAllowed');
  });

  it('answers inMarkup in a comment, a CDATA section, the XML declaration and a doctype', () => {
    expect(code(BOOK, 5)).toBe('inMarkup');
    const commented = edit(
      BOOK,
      '\t\t\t<p>Second</p>',
      '\t\t\t<!-- a note -->\n\t\t\t<p>Second</p>',
    );
    expect(code(commented, offsetOf(commented, 'a note'))).toBe('inMarkup');
    // Right before the comment the point is between the section's elements.
    expect(code(commented, offsetOf(commented, '<!--'))).toBe('ok');
    const cdata = edit(BOOK, '<p>Text</p>', '<p><![CDATA[raw]]></p>');
    expect(code(cdata, offsetOf(cdata, 'raw') + 1)).toBe('inMarkup');
    const doctype = edit(BOOK, '<FictionBook', '<!DOCTYPE FictionBook>\n<FictionBook');
    expect(code(doctype, offsetOf(doctype, 'DOCTYPE') + 2)).toBe('inMarkup');
    expect(code(doctype, after(doctype, '<!DOCTYPE FictionBook>'))).toBe('outsideRoot');
  });

  it('answers outsideRoot before and after the root element', () => {
    expect(code(BOOK, 0)).toBe('outsideRoot');
    expect(code(BOOK, after(BOOK, '?>'))).toBe('outsideRoot');
    expect(code(BOOK, offsetOf(BOOK, '<FictionBook'))).toBe('outsideRoot');
    expect(code(BOOK, after(BOOK, '</FictionBook>'))).toBe('outsideRoot');
    expect(code(BOOK, BOOK.length)).toBe('outsideRoot');
  });

  it('answers inText in text, next to it and in a binary placeholder', () => {
    expect(code(BOOK, offsetOf(BOOK, 'Second') + 2)).toBe('inText');
    expect(code(BOOK, offsetOf(BOOK, 'Second'))).toBe('inText');
    expect(code(BOOK, after(BOOK, 'Second'))).toBe('inText');
    expect(code(BOOK, offsetOf(BOOK, 'foremost'))).toBe('inText');
    expect(code(BOOK, offsetOf(BOOK, '&amp;') + 2)).toBe('inText');
    expect(code(BOOK, offsetOf(BOOK, '\u2026120') + 3)).toBe('inText');
    expect(code(BOOK, after(BOOK, 'content-type="image/png">'))).toBe('inText');
    // Character data around the point counts up to the nearest tags, CDATA included.
    const cdata = edit(BOOK, '<p>Text</p>', '<p><![CDATA[raw]]></p>');
    expect(code(cdata, after(cdata, '<p><![CDATA[raw]]>'))).toBe('inText');
  });
});

/* ------------------------------------------------------------------------ */
/* Between elements                                                         */
/* ------------------------------------------------------------------------ */

describe('sourceTablePoint: between elements, by the content models', () => {
  it('allows </p>|<p> in a section, with the point, the parent and its prefix', () => {
    const at = after(BOOK, '<p>First &amp; &#160;foremost</p>');
    expect(verdictAt(BOOK, at)).toEqual(okIn(BOOK, at, '<section id="s1">', 'section'));
    // ... and in the white space of the next line, before the paragraph.
    const indented = offsetOf(BOOK, '\t<p>Second');
    expect(verdictAt(BOOK, indented)).toEqual(okIn(BOOK, indented, '<section id="s1">', 'section'));
  });

  it('gives the prefix of a book with fb: prefixes and of a book without a namespace', () => {
    const prefixed =
      `<fb:FictionBook xmlns:fb="${FB2_NS}"><fb:description/><fb:body><fb:section>` +
      '<fb:p>a</fb:p><fb:p>b</fb:p></fb:section></fb:body></fb:FictionBook>';
    const at = after(prefixed, '<fb:p>a</fb:p>');
    expect(verdictAt(prefixed, at)).toEqual(okIn(prefixed, at, '<fb:section>', 'section', 'fb'));
    const bare = '<FictionBook><body><section><p>a</p><p>b</p></section></body></FictionBook>';
    const bareAt = after(bare, '<p>a</p>');
    expect(verdictAt(bare, bareAt)).toEqual(okIn(bare, bareAt, '<section>', 'section'));
  });

  it('allows a table between </title> and a heading <image>, as the schema reads it (C3)', () => {
    const at = after(BOOK, '</title>', 1);
    expect(verdictAt(BOOK, at)).toEqual(okIn(BOOK, at, '<section>', 'section'));
  });

  it('allows a table in an annotation, a history and a cite before its text-author', () => {
    const annotation = after(BOOK, '<annotation>');
    expect(verdictAt(BOOK, annotation)).toEqual(
      okIn(BOOK, annotation, '<annotation>', 'annotation'),
    );
    const withHistory = edit(
      BOOK,
      '\t\t</title-info>',
      '\t\t</title-info>\n\t\t<document-info>\n\t\t\t<history>\n\t\t\t\t<p>Changed</p>\n\t\t\t</history>\n\t\t</document-info>',
    );
    const history = after(withHistory, '<p>Changed</p>');
    expect(verdictAt(withHistory, history)).toEqual(
      okIn(withHistory, history, '<history>', 'history'),
    );
    const cite = after(BOOK, '<p>Cited</p>');
    expect(verdictAt(BOOK, cite)).toEqual(okIn(BOOK, cite, '<cite>', 'cite'));
  });

  it('refuses </title>|<epigraph>, a point after a cite’s <text-author> and the other parents', () => {
    expect(verdictAt(BOOK, after(BOOK, '</title>'))).toEqual({
      code: 'notAllowed',
      element: 'section',
    });
    expect(verdictAt(BOOK, after(BOOK, '</text-author>'))).toEqual({
      code: 'notAllowed',
      element: 'cite',
    });
    expect(verdictAt(BOOK, after(BOOK, '<title>'))).toEqual({
      code: 'notAllowed',
      element: 'title',
    });
    expect(verdictAt(BOOK, after(BOOK, '</section>'))).toEqual({
      code: 'notAllowed',
      element: 'body',
    });
    expect(verdictAt(BOOK, after(BOOK, '</description>'))).toEqual({
      code: 'notAllowed',
      element: 'FictionBook',
    });
    expect(verdictAt(BOOK, after(BOOK, '<epigraph>'))).toEqual({
      code: 'notAllowed',
      element: 'epigraph',
    });
    expect(verdictAt(BOOK, after(BOOK, '<p></p>') - 4)).toEqual({
      code: 'notAllowed',
      element: 'p',
    });
    // A section's content may not start with an image, and subsections exclude content.
    const subsections =
      `<FictionBook xmlns="${FB2_NS}"><body><section><title><p>T</p></title>` +
      '<section><p>a</p></section><section><p>b</p></section></section></body></FictionBook>';
    expect(verdictAt(subsections, after(subsections, '</title>'))).toEqual({
      code: 'notAllowed',
      element: 'section',
    });
    expect(verdictAt(subsections, after(subsections, '</section>'))).toEqual({
      code: 'notAllowed',
      element: 'section',
    });
  });

  it('refuses a parent of another namespace', () => {
    const other = edit(BOOK, '<section id="s1">', '<section id="s1" xmlns="urn:example:other">');
    expect(verdictAt(other, after(other, '<p>First &amp; &#160;foremost</p>'))).toEqual({
      code: 'notAllowed',
      element: 'section',
    });
    const prefixed = edit(
      BOOK,
      '\t\t<section>\n',
      '\t\t<section>\n\t\t\t<x:section xmlns:x="urn:example:other"><x:p>a</x:p><x:p>b</x:p></x:section>\n',
    );
    expect(verdictAt(prefixed, after(prefixed, '<x:p>a</x:p>'))).toEqual({
      code: 'notAllowed',
      element: 'section',
    });
  });

  it('still allows a table where it adds no new error in a parent invalid elsewhere (C38)', () => {
    const book = (section: string) =>
      `<FictionBook xmlns="${FB2_NS}"><body><section>${section}</section></body></FictionBook>`;
    const lateTitle = book('<title><p>T</p></title><p>a</p><p>b</p><title><p>late</p></title>');
    expect(code(lateTitle, after(lateTitle, '<p>a</p>'))).toBe('ok');
    const bogus = book('<p>a</p><bogus/><p>b</p><p>c</p>');
    expect(code(bogus, after(bogus, '<p>b</p>'))).toBe('ok');
    expect(code(bogus, after(bogus, '<bogus/>'))).toBe('ok');
    // ... but not where the table itself would be refused or would refuse what follows.
    const epigraph = book('<title><p>T</p></title><epigraph><p>e</p></epigraph><p>a</p><bogus/>');
    expect(code(epigraph, after(epigraph, '</title>'))).toBe('notAllowed');
    const heading = book(
      '<title><p>T</p></title><image/><annotation><p>a</p></annotation><p>b</p>',
    );
    expect(code(heading, after(heading, '</title>'))).toBe('notAllowed');
    expect(code(heading, after(heading, '</annotation>'))).toBe('ok');
  });
});

/* ------------------------------------------------------------------------ */
/* The bounded walk                                                         */
/* ------------------------------------------------------------------------ */

describe('modelStateBefore: the bounded walk back equals a full walk', () => {
  interface Gap {
    parent: string;
    point: number;
    before: string[];
  }

  /** Every gap between the element children of each parent that may hold a table. */
  function gaps(state: EditorState): Gap[] {
    const tree = ensureSyntaxTree(state, state.doc.length, 10_000)!;
    const name = (tag: { from: number; to: number } | null) =>
      tag ? state.sliceDoc(tag.from, tag.to).replace(/^.*:/, '') : '';
    const out: Gap[] = [];
    tree.iterate({
      enter(node) {
        if (node.name !== 'Element') return;
        const open = node.node.firstChild;
        if (!open || open.name !== 'OpenTag') return;
        const parent = name(open.getChild('TagName'));
        if (!FB2_ELEMENTS.elements[parent]?.children.includes('table')) return;
        const before: string[] = [];
        out.push({ parent, point: open.to, before: [] });
        for (let child = open.nextSibling; child; child = child.nextSibling) {
          if (child.name !== 'Element') continue;
          const tag = child.firstChild!;
          before.push(name(tag.getChild('TagName')));
          out.push({ parent, point: child.to, before: [...before] });
        }
      },
    });
    return out;
  }

  /** The full lenient run from the parent's first child: a refused child leaves the state. */
  function fullWalk(parent: string, names: string[]): number {
    const model = contentModelOf(parent)!;
    let state = 0;
    for (const child of names) state = step(model, state, child) ?? state;
    return state;
  }

  const texts = {
    book: BOOK,
    images:
      `<FictionBook xmlns="${FB2_NS}" xmlns:l="http://www.w3.org/1999/xlink"><body><section>` +
      '<title><p>t</p></title><epigraph><p>e</p></epigraph><image l:href="#h"/><p>a</p>' +
      '<image l:href="#1"/><image l:href="#2"/><image l:href="#3"/><image l:href="#4"/>' +
      '<p>b</p><image l:href="#5"/><image l:href="#6"/></section></body></FictionBook>',
    cites:
      `<FictionBook xmlns="${FB2_NS}"><description><title-info><annotation><p>a</p>` +
      '<cite><p>c</p><text-author>t</text-author></cite><empty-line/><table><tr><td>x</td></tr></table>' +
      '</annotation></title-info></description><body><section><p>a</p><cite><p>a</p><poem>' +
      '<stanza><v>v</v></stanza></poem><subtitle>s</subtitle><empty-line/><table><tr><td>x</td>' +
      '</tr></table><text-author>t1</text-author><text-author>t2</text-author></cite></section>' +
      '</body></FictionBook>',
  };

  it.each(Object.keys(texts))('on %s', (key) => {
    const state = stateOf(texts[key as keyof typeof texts]);
    const all = gaps(state);
    expect(all.length).toBeGreaterThan(8);
    for (const gap of all) {
      expect(modelStateBefore(state, gap.point), `${gap.parent} after ${gap.before}`).toBe(
        fullWalk(gap.parent, gap.before),
      );
    }
  });

  it('is null for a point that is not between the children of a parent with a model', () => {
    const state = stateOf(BOOK);
    expect(modelStateBefore(state, offsetOf(BOOK, 'Second') + 1)).toBeNull();
    expect(modelStateBefore(state, offsetOf(BOOK, '<section id="s1">') + 3)).toBeNull();
    expect(modelStateBefore(state, 0)).toBeNull();
    // `strong` is declared twice with different content models: it has none (vR4:35).
    const strong = edit(
      BOOK,
      '<p>Text</p>',
      '<p><strong><emphasis>a</emphasis><emphasis>b</emphasis></strong></p>',
    );
    const inStrong = stateOf(strong);
    expect(modelStateBefore(inStrong, after(strong, '<emphasis>a</emphasis>'))).toBeNull();
    // A title has a model of its own: the state after its first paragraph.
    expect(modelStateBefore(state, after(BOOK, '<p>One</p>'))).toBe(
      step(contentModelOf('title')!, 0, 'p'),
    );
  });

  it('reports the line helper of these tests correctly', () => {
    expect(lineAt(BOOK, offsetOf(BOOK, '<p>Second'))).toBe(20);
  });
});
