/**
 * Source view syntax-tree helpers (T078/T079/T080) on a headless CodeMirror state: matching
 * tag lookup, wrong-tag (syntax error) positions, fold-level computation and the fold/unfold
 * level commands, the navigation line highlight, overtype input, binary placeholder matching,
 * the font setting parser and the Find/Replace target.
 */

import { foldGutter, foldedRanges } from '@codemirror/language';
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import {
  BINARY_PLACEHOLDER,
  collapseLevel,
  elementFoldRangesAtDepth,
  expandLevel,
  findTagPair,
  firstSyntaxError,
  highlightLineEffect,
  highlightedLine,
  highlightedLineField,
  lineColumnAt,
  matchedTagDecorations,
  matchingTagPosition,
  nextSyntaxError,
  offsetForLineColumn,
  overtypeExtension,
  parseSourceFont,
  sourceLanguage,
  syntaxErrorPositions,
  type EditorTarget,
} from '@/views/source/extensions';
import {
  createSourceSearchTarget,
  expandReplacement,
  findMatches,
} from '@/views/source/searchTarget';

const BOOK = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
  <description>
    <title-info>
      <genre>prose</genre>
      <book-title>Alpha</book-title>
    </title-info>
  </description>
  <body>
    <section id="s1">
      <title><p>One</p></title>
      <p>First <strong>bold</strong> paragraph.</p>
      <empty-line/>
    </section>
    <section>
      <p>Second</p>
    </section>
  </body>
  <binary id="cover.jpg" content-type="image/jpeg">\u20261234 bytes\u2026</binary>
</FictionBook>
`;

/** A headless state with the XML language (and folding so fold effects have a field). */
function stateOf(doc: string, extra: unknown[] = []): EditorState {
  return EditorState.create({
    doc,
    extensions: [sourceLanguage(), foldGutter(), highlightedLineField, ...(extra as never[])],
  });
}

/** Dispatch target over a headless state (what the controller uses while unmounted). */
function headless(initial: EditorState): EditorTarget & { current: EditorState } {
  const target = {
    current: initial,
    get state() {
      return target.current;
    },
    dispatch(spec: TransactionSpec) {
      target.current = target.current.update(spec).state;
    },
  };
  return target;
}

const indexOf = (text: string, needle: string, nth = 0): number => {
  let pos = -1;
  for (let i = 0; i <= nth; i += 1) pos = text.indexOf(needle, pos + 1);
  return pos;
};

describe('matching tags (Go to matching tag)', () => {
  const state = stateOf(BOOK);

  it('finds the closing tag from inside the opening tag and back', () => {
    const openSection = indexOf(BOOK, '<section id="s1">');
    const closeSection = indexOf(BOOK, '</section>');
    // cursor inside the attribute of the opening tag
    const pair = findTagPair(state, openSection + 10)!;
    expect(pair.kind).toBe('matched');
    expect(pair.at).toBe('open');
    expect(pair.open).toEqual({ from: openSection, to: openSection + '<section id="s1">'.length });
    expect(pair.close).toEqual({ from: closeSection, to: closeSection + '</section>'.length });
    // the target is the name of the closing tag (after "</")
    expect(matchingTagPosition(state, openSection + 10)).toBe(closeSection + 2);
    // and from the closing tag back to the opening tag name (after "<")
    expect(matchingTagPosition(state, closeSection + 3)).toBe(openSection + 1);
    // tag ends are inclusive on both sides
    expect(matchingTagPosition(state, openSection)).toBe(closeSection + 2);
    expect(matchingTagPosition(state, closeSection + '</section>'.length)).toBe(openSection + 1);
  });

  it('reports self-closing tags and text positions', () => {
    const emptyLine = indexOf(BOOK, '<empty-line/>');
    const pair = findTagPair(state, emptyLine + 3)!;
    expect(pair.kind).toBe('selfClosing');
    expect(matchingTagPosition(state, emptyLine + 3)).toBeNull();
    const text = indexOf(BOOK, 'First');
    expect(findTagPair(state, text + 2)).toBeNull();
    expect(matchingTagPosition(state, text + 2)).toBeNull();
  });

  it('highlights the pair around the cursor (and nothing for a selection or text)', () => {
    const openStrong = indexOf(BOOK, '<strong>');
    const decorations = matchedTagDecorations(
      state.update({ selection: EditorSelection.cursor(openStrong + 2) }).state,
    );
    const ranges: [number, number][] = [];
    decorations.between(0, BOOK.length, (from, to) => {
      ranges.push([from, to]);
    });
    expect(ranges).toEqual([
      [openStrong, openStrong + '<strong>'.length],
      [indexOf(BOOK, '</strong>'), indexOf(BOOK, '</strong>') + '</strong>'.length],
    ]);
    expect(matchedTagDecorations(state).size).toBe(0); // cursor at 0: processing instruction
    const selected = state.update({
      selection: EditorSelection.range(openStrong, openStrong + 3),
    }).state;
    expect(matchedTagDecorations(selected).size).toBe(0);
  });
});

describe('wrong tags (syntax errors)', () => {
  const BROKEN = `<?xml version="1.0"?>
<FictionBook>
  <body>
    <section>
      <p>never closed
    </section>
    <p>ok</p>
    </stray>
  </body>
</FictionBook>
`;

  it('is empty for well-formed XML', () => {
    expect(syntaxErrorPositions(stateOf(BOOK))).toEqual([]);
    expect(firstSyntaxError(stateOf(BOOK))).toBeNull();
    expect(nextSyntaxError(stateOf(BOOK), 10)).toBeNull();
  });

  it('reports the unclosed element and the stray closing tag, in order, with wrapping', () => {
    const state = stateOf(BROKEN);
    const unclosed = indexOf(BROKEN, '<p>never');
    const stray = indexOf(BROKEN, '</stray>');
    expect(syntaxErrorPositions(state)).toEqual([unclosed, stray]);
    expect(firstSyntaxError(state)).toBe(unclosed);
    expect(nextSyntaxError(state, 0)).toBe(unclosed);
    expect(nextSyntaxError(state, unclosed)).toBe(stray); // strictly after the cursor
    expect(nextSyntaxError(state, stray)).toBe(unclosed); // wraps to the first
    const pair = findTagPair(state, unclosed + 1)!;
    expect(pair.kind).toBe('unclosed');
    expect(findTagPair(state, stray + 2)!.kind).toBe('mismatched');
  });
});

describe('fold levels (Collapse/Expand N tree levels)', () => {
  it('computes the element ranges per nesting depth (root = 0)', () => {
    const state = stateOf(BOOK);
    const root = elementFoldRangesAtDepth(state, 0);
    expect(root).toHaveLength(1);
    expect(root[0]!.from).toBe(BOOK.indexOf('>', BOOK.indexOf('<FictionBook')) + 1);
    expect(root[0]!.to).toBe(indexOf(BOOK, '</FictionBook>'));
    // description and body are multi-line; the binary is a one-line element
    expect(elementFoldRangesAtDepth(state, 1)).toHaveLength(2);
    // title-info and the two sections
    expect(elementFoldRangesAtDepth(state, 2)).toHaveLength(3);
    // genre/book-title/title/p/empty-line/p are one-line elements: nothing to fold
    expect(elementFoldRangesAtDepth(state, 3)).toEqual([]);
    expect(elementFoldRangesAtDepth(state, 8)).toEqual([]);
  });

  it('folds and unfolds exactly the elements of one level, moving the cursor out of a fold', () => {
    const target = headless(
      stateOf(BOOK).update({ selection: EditorSelection.cursor(indexOf(BOOK, 'First')) }).state,
    );
    expect(collapseLevel(target, 3)).toBe(3);
    expect(foldedRanges(target.state).size).toBe(3);
    // the cursor was inside the first section: it now sits at the start of that fold
    const section = elementFoldRangesAtDepth(target.state, 2)[1]!;
    expect(target.state.selection.main.head).toBe(section.from);
    // folding the same level again changes nothing
    expect(collapseLevel(target, 3)).toBe(0);
    expect(collapseLevel(target, 2)).toBe(2);
    expect(foldedRanges(target.state).size).toBe(5);
    expect(expandLevel(target, 3)).toBe(3);
    expect(foldedRanges(target.state).size).toBe(2);
    expect(expandLevel(target, 3)).toBe(0);
    expect(expandLevel(target, 2)).toBe(2);
    expect(foldedRanges(target.state).size).toBe(0);
    // level 1 is the root element: the whole document collapses to one line
    expect(collapseLevel(target, 1)).toBe(1);
    expect(expandLevel(target, 1)).toBe(1);
  });
});

describe('navigation line highlight', () => {
  it('is set by the effect and cleared by user edits or cursor moves', () => {
    const target = headless(stateOf(BOOK));
    target.dispatch({ effects: highlightLineEffect.of(5) });
    expect(highlightedLine(target.state)).toBe(5);
    // a programmatic selection keeps it
    target.dispatch({ selection: EditorSelection.cursor(3) });
    expect(highlightedLine(target.state)).toBe(5);
    // the user moving the cursor ends it
    target.dispatch({ selection: EditorSelection.cursor(4), userEvent: 'select' });
    expect(highlightedLine(target.state)).toBeNull();
    target.dispatch({ effects: highlightLineEffect.of(2) });
    target.dispatch({ changes: { from: 0, insert: 'x' } });
    expect(highlightedLine(target.state)).toBeNull();
    target.dispatch({ effects: highlightLineEffect.of(2) });
    target.dispatch({ effects: highlightLineEffect.of(null) });
    expect(highlightedLine(target.state)).toBeNull();
    // out of range lines are ignored
    target.dispatch({ effects: highlightLineEffect.of(9999) });
    expect(highlightedLine(target.state)).toBeNull();
  });
});

describe('line/column helpers', () => {
  it('converts both ways and clamps', () => {
    const state = stateOf('ab\ncd\n');
    expect(offsetForLineColumn(state, 2, 2)).toBe(4);
    expect(offsetForLineColumn(state, 2, 99)).toBe(5);
    expect(offsetForLineColumn(state, 99, 1)).toBe(6);
    expect(offsetForLineColumn(state, 0, 0)).toBe(0);
    expect(lineColumnAt(state, 4)).toEqual({ line: 2, column: 2 });
    expect(lineColumnAt(state, 999)).toEqual({ line: 3, column: 1 });
  });
});

describe('binary placeholders', () => {
  it('matches the elided form written by doc.toXml', () => {
    const line = '  <binary id="a.jpg" content-type="image/jpeg">\u20261234 bytes\u2026</binary>';
    const match = BINARY_PLACEHOLDER.exec(line)!;
    expect(match[1]).toBe('  <binary id="a.jpg" content-type="image/jpeg">');
    expect(match[2]).toBe('\u20261234 bytes\u2026');
    expect(match[3]).toBe('1234');
    expect(BINARY_PLACEHOLDER.test('<binary id="a">AAAA</binary>')).toBe(false);
    expect(BINARY_PLACEHOLDER.test('<p>\u202612 bytes\u2026</p>')).toBe(false);
  });
});

describe('parseSourceFont', () => {
  it('accepts family, family+size and size-first forms', () => {
    expect(parseSourceFont('')).toEqual({ family: null, size: null });
    expect(parseSourceFont(undefined)).toEqual({ family: null, size: null });
    expect(parseSourceFont('Consolas')).toEqual({ family: 'Consolas', size: null });
    expect(parseSourceFont('Consolas, 12')).toEqual({ family: 'Consolas', size: 12 });
    expect(parseSourceFont('Courier New 11')).toEqual({ family: '"Courier New"', size: 11 });
    expect(parseSourceFont('Courier New, 12pt')).toEqual({ family: '"Courier New"', size: 16 });
    expect(parseSourceFont('14px Fira Code')).toEqual({ family: '"Fira Code"', size: 14 });
    expect(parseSourceFont('13')).toEqual({ family: null, size: 13 });
    expect(parseSourceFont('"DejaVu Sans Mono", 10')).toEqual({
      family: '"DejaVu Sans Mono"',
      size: 10,
    });
  });
});

describe('overtype mode', () => {
  beforeAll(() => {
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }),
    });
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    });
  });

  it('replaces the character after the cursor while typing, never past the line end', () => {
    let overtype = true;
    const view = new EditorView({
      state: EditorState.create({
        doc: 'abcd\nef',
        extensions: [overtypeExtension(() => overtype)],
        selection: EditorSelection.cursor(1),
      }),
      parent: document.body,
    });
    const handlers = view.state.facet(EditorView.inputHandler);
    const input = (text: string) => {
      const { from, to } = view.state.selection.main;
      const handled = handlers.some((h) => h(view, from, to, text, () => view.state.update()));
      if (!handled) view.dispatch({ changes: { from, to, insert: text } });
    };
    input('X');
    expect(view.state.doc.toString()).toBe('aXcd\nef');
    expect(view.state.selection.main.head).toBe(2);
    input('YZW'); // longer than the rest of the line: replaces "cd" only
    expect(view.state.doc.toString()).toBe('aXYZW\nef');
    input('!'); // at the end of the line: inserts
    expect(view.state.doc.toString()).toBe('aXYZW!\nef');
    overtype = false;
    view.dispatch({ selection: EditorSelection.cursor(0) });
    input('i');
    expect(view.state.doc.toString()).toBe('iaXYZW!\nef');
    view.destroy();
  });
});

describe('SourceSearchTarget', () => {
  const TEXT = 'Alpha beta Beta alphabet\n<p>beta</p>\n';

  it('finds literal, case-sensitive, whole-word and regular-expression matches', () => {
    const state = stateOf(TEXT);
    expect(findMatches(state, 'beta').map((m) => m.from)).toEqual([6, 11, 28]);
    expect(findMatches(state, 'beta', { matchCase: true }).map((m) => m.from)).toEqual([6, 28]);
    expect(findMatches(state, 'alpha', { wholeWord: true }).map((m) => m.from)).toEqual([0]);
    expect(findMatches(state, 'b\\w+a', { regex: true }).map((m) => m.from)).toEqual([6, 11, 28]);
    expect(findMatches(state, '(', { regex: true })).toEqual([]); // invalid pattern
    expect(findMatches(state, '')).toEqual([]);
  });

  it('expands $1 / $& in regular-expression replacements', () => {
    const [hit] = findMatches(stateOf(TEXT), '(al)(pha)', { regex: true });
    expect(expandReplacement('[$2-$1]', hit!, true)).toBe('[pha-Al]');
    expect(expandReplacement('<$&>', hit!, true)).toBe('<Alpha>');
    expect(expandReplacement('$1', hit!, false)).toBe('$1');
  });

  it('findNext selects forwards with wrapping, upwards, and replace/replaceAll edit the text', () => {
    const target = headless(stateOf(TEXT));
    const search = createSourceSearchTarget(() => target);
    expect(search.findNext('beta')).toBe(true);
    expect([target.state.selection.main.from, target.state.selection.main.to]).toEqual([6, 10]);
    expect(search.findNext('beta')).toBe(true);
    expect(target.state.selection.main.from).toBe(11);
    expect(search.findNext('beta')).toBe(true);
    expect(target.state.selection.main.from).toBe(28);
    expect(search.findNext('beta')).toBe(true); // wraps
    expect(target.state.selection.main.from).toBe(6);
    expect(search.findNext('beta', { wrap: false, direction: 'up' })).toBe(false);
    expect(search.findNext('beta', { direction: 'up' })).toBe(true); // wraps backwards
    expect(target.state.selection.main.from).toBe(28);
    expect(search.findNext('nothing')).toBe(false);
    expect(search.currentSelection()).toEqual({ from: 28, to: 32, line: 2, column: 4 });

    // replace: the selection is a match -> replaced, next match selected
    expect(search.replace('beta', 'gamma')).toBe(true);
    expect(target.state.doc.toString()).toBe('Alpha beta Beta alphabet\n<p>gamma</p>\n');
    expect(target.state.selection.main.from).toBe(6);
    // replace with a non-matching selection only moves to the next match
    target.dispatch({ selection: EditorSelection.cursor(0) });
    expect(search.replace('Beta', 'x', { matchCase: true })).toBe(false);
    expect(target.state.selection.main.from).toBe(11);
    expect(search.replaceAll('beta', 'delta')).toBe(2);
    expect(target.state.doc.toString()).toBe('Alpha delta delta alphabet\n<p>gamma</p>\n');
    expect(search.replaceAll('zzz', 'y')).toBe(0);
    expect(search.replaceAll('(al)pha', '$1fa', { regex: true })).toBe(2);
    expect(target.state.doc.toString()).toBe('Alfa delta delta alfabet\n<p>gamma</p>\n');
  });
});
