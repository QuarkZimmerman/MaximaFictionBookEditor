/**
 * CodeMirror 6 extensions of the Source view (T079, FR-060) and the pure syntax-tree helpers
 * behind the navigation commands (T080):
 *
 *  - toggleable line numbers, soft wrap, syntax highlighting, white-space marks
 *    (`highlightWhitespace`) and end-of-line marks (a widget after every line break);
 *  - matched-tag highlighting: the opening/closing tag pair around the cursor, computed from the
 *    Lezer XML tree (`findTagPair`), unmatched tags in an error style;
 *  - fold/unfold by nesting level (`collapseLevel` / `expandLevel`, FBE's "Collapse N tree
 *    levels": level 1 is the root element, level 2 its children...);
 *  - `<binary>` placeholders (`…1234 bytes…` from `doc.toXml({elideBinaries: true})`) rendered
 *    as inert atomic widgets;
 *  - Insert-key overtype mode (replaces the character after the cursor while typing);
 *  - a transient line highlight used when navigating to a validation issue;
 *  - `firstSyntaxError` / `nextSyntaxError` (Go to wrong tag without a core) and
 *    `matchingTagPosition` (Go to matching tag);
 *  - `parseSourceFont` for the `view.sourceFont` setting ("Family", "Family, 12", "12px Family").
 *
 * Everything here works on a headless `EditorState` where possible so it can be unit-tested
 * without a DOM.
 */

import { xml } from '@codemirror/lang-xml';
import {
  ensureSyntaxTree,
  foldEffect,
  foldedRanges,
  syntaxTree,
  unfoldEffect,
} from '@codemirror/language';
import {
  EditorSelection,
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
  type Range,
  type Text,
  type TransactionSpec,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  highlightActiveLineGutter,
  highlightSpecialChars,
  highlightWhitespace,
  lineNumbers,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import type { NodeSet, SyntaxNode, Tree, TreeBuffer } from '@lezer/common';

import { NBSP } from '@/editor/plugins/nbsp';

import { sourceHighlightExtension } from './theme';

/** Something that holds an editor state and accepts transactions (an `EditorView` or headless). */
export interface EditorTarget {
  readonly state: EditorState;
  dispatch(spec: TransactionSpec): void;
}

/* ------------------------------------------------------------------------ */
/* Language and simple toggles                                              */
/* ------------------------------------------------------------------------ */

/** The XML language (always on: folding, tag matching and navigation need the syntax tree). */
export function sourceLanguage(): Extension {
  return xml({ autoCloseTags: false });
}

/** Syntax highlighting; `dark` picks the highlight style of the dark interface theme. */
export const highlightExtension = (on: boolean, dark = false): Extension =>
  sourceHighlightExtension(on, dark);

export const lineNumbersExtension = (on: boolean): Extension =>
  on ? [lineNumbers(), highlightActiveLineGutter()] : [];

export const wrapExtension = (on: boolean): Extension => (on ? EditorView.lineWrapping : []);

export const whitespaceExtension = (on: boolean): Extension => (on ? highlightWhitespace() : []);

/**
 * Non-breaking-space marker in the Source view (feature 002 FR-042): every U+00A0 is shown as
 * the chosen marker (□ ▫ ◦) through CodeMirror's special-character rendering, as the original
 * showed its display character in the source; copied text carries the marker and pasted marker
 * characters become U+00A0 (feature 002 FR-043). Nothing for the plain space (null).
 */
export function nbspSourceExtension(marker: string | null): Extension {
  if (!marker) return [];
  return [
    highlightSpecialChars({
      addSpecialChars: /\u00a0/g,
      render: (code, description, placeholder) => {
        const span = document.createElement('span');
        span.className = code === 0xa0 ? 'cm-nbspMarker' : 'cm-specialChar';
        span.textContent = code === 0xa0 ? marker : placeholder;
        if (description) span.title = description;
        return span;
      },
    }),
    EditorView.clipboardOutputFilter.of((text) => text.split(NBSP).join(marker)),
    EditorView.clipboardInputFilter.of((text) => text.split(marker).join(NBSP)),
  ];
}

/* ------------------------------------------------------------------------ */
/* End-of-line marks                                                        */
/* ------------------------------------------------------------------------ */

class EolWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'mfbe-source-eol';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = '\u00B6';
    return span;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

const eolWidget = Decoration.widget({ widget: new EolWidget(), side: 1 });

function eolDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = view.state;
  for (const { from, to } of view.visibleRanges) {
    let line = doc.lineAt(from);
    for (;;) {
      // The last line has no line break after it.
      if (line.number < doc.lines) builder.add(line.to, line.to, eolWidget);
      if (line.to >= to || line.number >= doc.lines) break;
      line = doc.line(line.number + 1);
    }
  }
  return builder.finish();
}

const eolMarksPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = eolDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = eolDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

export const eolMarksExtension = (on: boolean): Extension => (on ? eolMarksPlugin : []);

/* ------------------------------------------------------------------------ */
/* Tags: lookup, matching, errors                                           */
/* ------------------------------------------------------------------------ */

const TAG_NODES = new Set(['OpenTag', 'CloseTag', 'SelfClosingTag', 'MismatchedCloseTag']);

export interface TextRange {
  from: number;
  to: number;
}

export type TagPairKind = 'matched' | 'unclosed' | 'selfClosing' | 'mismatched';

export interface TagPair {
  kind: TagPairKind;
  /** The tag the cursor is in. */
  at: 'open' | 'close';
  open: TextRange;
  /** Missing for self-closing tags, unclosed elements and stray closing tags. */
  close: TextRange | null;
  /** Range of the tag name of the counterpart (where "Go to matching tag" moves the cursor). */
  target: TextRange | null;
}

/** A complete syntax tree of the state (forces the parse, bounded by `timeout` ms). */
export function fullSyntaxTree(state: EditorState, timeout = 5000): Tree {
  return ensureSyntaxTree(state, state.doc.length, timeout) ?? syntaxTree(state);
}

function tagNodeAround(node: SyntaxNode | null, pos: number): SyntaxNode | null {
  for (let cur = node; cur; cur = cur.parent) {
    if (TAG_NODES.has(cur.name) && cur.from <= pos && cur.to >= pos) return cur;
  }
  return null;
}

/**
 * The innermost tag (`<...>`, `</...>`, `<.../>`) whose text contains `pos` (ends inclusive).
 * Uses the complete tree unless one is given (the highlighter passes the tree parsed so far so
 * cursor moves never block on a huge document).
 */
export function tagAt(state: EditorState, pos: number, tree?: Tree): SyntaxNode | null {
  const t = tree ?? fullSyntaxTree(state);
  return tagNodeAround(t.resolveInner(pos, -1), pos) ?? tagNodeAround(t.resolveInner(pos, 1), pos);
}

function nameRange(tag: SyntaxNode): TextRange {
  const name = tag.getChild('TagName');
  return name ? { from: name.from, to: name.to } : { from: tag.from + 1, to: tag.from + 1 };
}

/** The opening/closing tag pair the position is in, or null when the cursor is not in a tag. */
export function findTagPair(state: EditorState, pos: number, tree?: Tree): TagPair | null {
  const tag = tagAt(state, pos, tree);
  if (!tag) return null;
  const range = (node: SyntaxNode): TextRange => ({ from: node.from, to: node.to });
  if (tag.name === 'SelfClosingTag') {
    return { kind: 'selfClosing', at: 'open', open: range(tag), close: null, target: null };
  }
  if (tag.name === 'MismatchedCloseTag') {
    return { kind: 'mismatched', at: 'close', open: range(tag), close: range(tag), target: null };
  }
  const element = tag.parent;
  if (!element || element.name !== 'Element') return null;
  const openTag = element.firstChild;
  const last = element.lastChild;
  if (!openTag || openTag.name !== 'OpenTag') return null;
  if (tag.name === 'OpenTag') {
    if (last && last.name === 'CloseTag') {
      return {
        kind: 'matched',
        at: 'open',
        open: range(openTag),
        close: range(last),
        target: nameRange(last),
      };
    }
    return { kind: 'unclosed', at: 'open', open: range(openTag), close: null, target: null };
  }
  // CloseTag
  return {
    kind: 'matched',
    at: 'close',
    open: range(openTag),
    close: range(tag),
    target: nameRange(openTag),
  };
}

/** Where "Go to matching tag" moves the cursor from `pos`, or null when there is no partner. */
export function matchingTagPosition(state: EditorState, pos: number): number | null {
  const pair = findTagPair(state, pos);
  return pair?.target ? pair.target.from : null;
}

/** Positions of the XML syntax problems in document order (unclosed, stray or broken tags). */
export function syntaxErrorPositions(state: EditorState): number[] {
  const tree = fullSyntaxTree(state);
  const out: number[] = [];
  tree.iterate({
    enter(node) {
      if (node.name === 'MissingCloseTag') {
        // The wrong tag is the element that is never closed: report its opening tag.
        const element = node.node.parent;
        out.push(element && element.name === 'Element' ? element.from : node.from);
      } else if (node.name === 'MismatchedCloseTag' || node.type.isError) {
        out.push(node.from);
      }
      return undefined;
    },
  });
  return [...new Set(out)].sort((a, b) => a - b);
}

/** First syntax problem of the document, or null when the XML is well-formed for the parser. */
export function firstSyntaxError(state: EditorState): number | null {
  const positions = syntaxErrorPositions(state);
  return positions.length > 0 ? positions[0]! : null;
}

/** Next syntax problem strictly after `pos` (wrapping to the first one), like FBE's command. */
export function nextSyntaxError(state: EditorState, pos: number): number | null {
  const positions = syntaxErrorPositions(state);
  if (positions.length === 0) return null;
  return positions.find((p) => p > pos) ?? positions[0]!;
}

/* ------------------------------------------------------------------------ */
/* Well-formedness of the whole text (feature 006, C37)                     */
/* ------------------------------------------------------------------------ */

/** The entities XML predefines; any other reference needs a DTD the Source text never has. */
const PREDEFINED_ENTITIES = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);

/**
 * A character XML 1.0 does not allow (`Char`): a control character other than tab, line feed
 * and carriage return, a lone surrogate, U+FFFE or U+FFFF.
 */
const ILLEGAL_CHARACTER = /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u;

/** Whether a code point is an XML 1.0 `Char`. */
function isXmlChar(code: number): boolean {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

/** The code point of a character reference (`&#…;`, `&#x…;`), NaN when it has none. */
export function characterReferenceValue(text: string): number {
  const match = /^&#(x[0-9a-fA-F]+|[0-9]+);$/.exec(text);
  if (!match) return Number.NaN;
  const digits = match[1]!;
  return digits[0] === 'x' ? parseInt(digits.slice(1), 16) : parseInt(digits, 10);
}

/** First problem relative to the subtree's start, -1 for none, per Lezer `Tree`/`TreeBuffer`. */
const problemCache = new WeakMap<Tree | TreeBuffer, number>();
/** The answer of `syntaxErrorState` per complete tree. */
const stateCache = new WeakMap<Tree, { line: number } | null>();

/** What the scan does with a node type (one table per Lezer node set). */
const OTHER = 0;
const ERROR = 1;
const MISMATCHED = 2;
const TAG = 3;
const ELEMENT = 4;
const ENTITY_REFERENCE = 5;
const CHARACTER_REFERENCE = 6;
const ATTRIBUTE_NAME = 7;
const ATTRIBUTE_VALUE = 8;
const SELF_CLOSING = 9;
const CLOSE_TAG = 10;

const KIND_OF_NAME: Readonly<Record<string, number>> = {
  MismatchedCloseTag: MISMATCHED,
  OpenTag: TAG,
  CloseTag: CLOSE_TAG,
  SelfClosingTag: SELF_CLOSING,
  Element: ELEMENT,
  EntityReference: ENTITY_REFERENCE,
  CharacterReference: CHARACTER_REFERENCE,
  AttributeName: ATTRIBUTE_NAME,
  AttributeValue: ATTRIBUTE_VALUE,
};

const kindTables = new WeakMap<NodeSet, Uint8Array>();

function kindsOf(set: NodeSet): Uint8Array {
  let kinds = kindTables.get(set);
  if (!kinds) {
    const table = new Uint8Array(set.types.length);
    set.types.forEach((type, id) => {
      table[id] = type.isError ? ERROR : (KIND_OF_NAME[type.name] ?? OTHER);
    });
    kindTables.set(set, table);
    kinds = table;
  }
  return kinds;
}

/** Whether a reference (`&name;`, `&#…;`) may stand in the text: the five entities, legal characters. */
function referenceAllowed(kind: number, reference: string): boolean {
  return kind === ENTITY_REFERENCE
    ? PREDEFINED_ENTITIES.has(reference.slice(1, -1))
    : isXmlChar(characterReferenceValue(reference));
}

/**
 * Whether the buffer's tag at `index` is broken: an error node in it, an attribute name given
 * twice, `<` in an attribute value, a reference in a value the text may not hold. `text` is the
 * buffer's text (the buffer's offsets index it).
 */
function bufferTagBroken(
  data: Uint16Array,
  kinds: Uint8Array,
  index: number,
  text: string,
): boolean {
  const end = data[index + 3]!;
  let names: string[] | null = null;
  for (let i = index + 4; i < end; i += 4) {
    switch (kinds[data[i]!]) {
      case ERROR:
        return true;
      case ATTRIBUTE_NAME: {
        const name = text.slice(data[i + 1]!, data[i + 2]!);
        if (names?.includes(name)) return true;
        (names ??= []).push(name);
        break;
      }
      case ATTRIBUTE_VALUE:
        if (text.slice(data[i + 1]!, data[i + 2]!).includes('<')) return true;
        break;
      case ENTITY_REFERENCE:
      case CHARACTER_REFERENCE:
        if (!referenceAllowed(kinds[data[i]!]!, text.slice(data[i + 1]!, data[i + 2]!))) {
          return true;
        }
        break;
      default:
        break;
    }
  }
  return false;
}

/** True when the buffer's `Element` at `index` ends in its closing tag or is self-closing. */
function bufferElementClosed(data: Uint16Array, kinds: Uint8Array, index: number): boolean {
  const end = data[index + 3]!;
  const first = index + 4;
  if (first >= end) return false;
  if (kinds[data[first]!] === SELF_CLOSING) return true;
  let last = first;
  for (let i = first; i < end; i = data[i + 3]!) last = i;
  return kinds[data[last]!] === CLOSE_TAG;
}

/**
 * The first problem among the buffer's nodes, relative to the buffer's start (-1: none). One
 * slice of the buffer's text: a character XML does not allow is a problem wherever it stands
 * (it is one in text, in a tag, in a comment), and the nodes are read from it.
 */
function bufferProblem(buffer: TreeBuffer, base: number, doc: Text): number {
  const cached = problemCache.get(buffer);
  if (cached !== undefined) return cached;
  const data = buffer.buffer;
  const kinds = kindsOf(buffer.set);
  const text = doc.sliceString(base, base + buffer.length);
  const illegal = text.search(ILLEGAL_CHARACTER);
  const limit = illegal < 0 ? Number.POSITIVE_INFINITY : illegal;
  let found = illegal;
  // Prefix order is document order: the first problem met is the first in the text.
  scan: for (let i = 0; i < data.length;) {
    const from = data[i + 1]!;
    if (from >= limit) break;
    switch (kinds[data[i]!]) {
      case ERROR:
      case MISMATCHED:
        found = from;
        break scan;
      case TAG:
      case CLOSE_TAG:
      case SELF_CLOSING:
        // A broken tag counts at its start, the line the user has to correct.
        if (bufferTagBroken(data, kinds, i, text)) {
          found = from;
          break scan;
        }
        i = data[i + 3]!;
        continue;
      case ELEMENT:
        // An unclosed element counts at its start tag (as `syntaxErrorPositions` reports it).
        if (!bufferElementClosed(data, kinds, i)) {
          found = from;
          break scan;
        }
        break;
      case ENTITY_REFERENCE:
      case CHARACTER_REFERENCE:
        if (!referenceAllowed(kinds[data[i]!]!, text.slice(from, data[i + 2]!))) {
          found = from;
          break scan;
        }
        break;
      default:
        break;
    }
    i += 4;
  }
  problemCache.set(buffer, found);
  return found;
}

/** The descendants of a tree-allocated tag, as a buffer scan would see them. */
function treeTagBroken(tree: Tree, base: number, doc: Text): boolean {
  const names: string[] = [];
  const cursor = tree.cursor();
  if (!cursor.firstChild()) return false;
  for (;;) {
    const from = base + cursor.from;
    const to = base + cursor.to;
    if (cursor.type.isError) return true;
    switch (cursor.name) {
      case 'AttributeName': {
        const name = doc.sliceString(from, to);
        if (names.includes(name)) return true;
        names.push(name);
        break;
      }
      case 'AttributeValue':
        if (doc.sliceString(from, to).includes('<')) return true;
        break;
      case 'EntityReference':
      case 'CharacterReference':
        if (!referenceAllowed(KIND_OF_NAME[cursor.name]!, doc.sliceString(from, to))) return true;
        break;
      default:
        break;
    }
    if (cursor.firstChild()) continue;
    while (!cursor.nextSibling()) {
      if (!cursor.parent() || cursor.tree === tree) return false;
    }
  }
}

/** The first problem in a tree-allocated node, relative to its start (-1: none). */
function treeProblem(tree: Tree, base: number, doc: Text): number {
  const cached = problemCache.get(tree);
  if (cached !== undefined) return cached;
  let found = -1;
  const type = tree.type;
  const kind = type.isError ? ERROR : (KIND_OF_NAME[type.name] ?? OTHER);
  if (kind === ERROR || kind === MISMATCHED) {
    found = 0;
  } else if (kind === TAG || kind === CLOSE_TAG || kind === SELF_CLOSING) {
    const illegal = doc.sliceString(base, base + tree.length).search(ILLEGAL_CHARACTER);
    found = treeTagBroken(tree, base, doc) ? 0 : illegal;
  } else if (
    kind === ELEMENT &&
    tree.topNode.firstChild?.name !== 'SelfClosingTag' &&
    tree.topNode.lastChild?.name !== 'CloseTag'
  ) {
    found = 0;
  } else if (tree.children.length === 0) {
    // A long leaf (text, a comment, a CDATA section) the parser did not put in a buffer.
    const text = doc.sliceString(base, base + tree.length);
    found =
      kind === ENTITY_REFERENCE || kind === CHARACTER_REFERENCE
        ? referenceAllowed(kind, text)
          ? -1
          : 0
        : text.search(ILLEGAL_CHARACTER);
  } else {
    for (let i = 0; i < tree.children.length && found < 0; i += 1) {
      const child = tree.children[i]!;
      const at = tree.positions[i]!;
      // A `TreeBuffer` holds its nodes in a flat array, a `Tree` its children.
      const inner =
        'buffer' in child
          ? bufferProblem(child, base + at, doc)
          : treeProblem(child, base + at, doc);
      if (inner >= 0) found = at + inner;
    }
  }
  problemCache.set(tree, found);
  return found;
}

/**
 * The first problem of the document level: a second root element, character data outside the
 * root element, or no root element at all (absolute offset, -1 for none).
 */
function topLevelProblem(tree: Tree, doc: Text): number {
  let elements = 0;
  for (let child = tree.topNode.firstChild; child; child = child.nextSibling) {
    switch (child.name) {
      case 'Element':
        elements += 1;
        if (elements > 1) return child.from;
        break;
      case 'Text': {
        const index = doc.sliceString(child.from, child.to).search(/[^ \t\r\n]/);
        if (index >= 0) return child.from + index;
        break;
      }
      case 'EntityReference':
      case 'CharacterReference':
      case 'Cdata':
        return child.from;
      default:
        break;
    }
  }
  return elements === 0 ? 0 : -1;
}

/**
 * Whether the Source text is well-formed as far as the editor can tell (feature 006, FR-061
 * "Unavailable"; C37; data-model §7.3), for a complete syntax tree (`tree`, by default the one
 * the parser has completed, else the tree parsed so far): the line of the first problem - an
 * error node (a broken tag at the tag's start), a `MismatchedCloseTag`, an unclosed element at
 * its start tag (as `syntaxErrorPositions` reports it), or one of C37's cheap checks the parser
 * does not make: several top-level elements or top-level text, an attribute name given twice in
 * a tag, `<` inside an attribute value, a character XML does not allow, an entity reference
 * other than the five predefined ones (character references stay allowed) - or null. One walk
 * over the tree, its results cached per Lezer `Tree` and `TreeBuffer`: an edit rescans only
 * the nodes the parser made anew. Ill-formed text the parser still accepts (an undeclared
 * prefix, `--` in a comment) is the recorded deviation; the core reports it when the user
 * leaves the view.
 */
export function syntaxErrorState(
  state: EditorState,
  tree: Tree = ensureSyntaxTree(state, state.doc.length, 0) ?? syntaxTree(state),
): { line: number } | null {
  if (stateCache.has(tree)) return stateCache.get(tree)!;
  const doc = state.doc;
  const inTree = treeProblem(tree, 0, doc);
  const top = topLevelProblem(tree, doc);
  const first = inTree < 0 ? top : top < 0 ? inTree : Math.min(inTree, top);
  const answer = first < 0 ? null : { line: doc.lineAt(Math.min(first, doc.length)).number };
  stateCache.set(tree, answer);
  return answer;
}

/* ------------------------------------------------------------------------ */
/* Matched-tag highlighting                                                 */
/* ------------------------------------------------------------------------ */

const matchedTagMark = Decoration.mark({ class: 'mfbe-source-tag-match' });
const unmatchedTagMark = Decoration.mark({ class: 'mfbe-source-tag-unmatched' });

export function matchedTagDecorations(state: EditorState): DecorationSet {
  const { main } = state.selection;
  if (!main.empty) return Decoration.none;
  // The tree parsed so far: highlighting must never stall the cursor on a huge document.
  const pair = findTagPair(state, main.head, syntaxTree(state));
  if (!pair) return Decoration.none;
  const ranges: Range<Decoration>[] = [];
  if (pair.kind === 'matched' && pair.close) {
    ranges.push(matchedTagMark.range(pair.open.from, pair.open.to));
    ranges.push(matchedTagMark.range(pair.close.from, pair.close.to));
  } else if (pair.kind === 'selfClosing') {
    ranges.push(matchedTagMark.range(pair.open.from, pair.open.to));
  } else {
    ranges.push(unmatchedTagMark.range(pair.open.from, pair.open.to));
  }
  return Decoration.set(ranges, true);
}

const matchedTagsPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = matchedTagDecorations(view.state);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.selectionSet) {
        this.decorations = matchedTagDecorations(update.state);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

export const matchedTagsExtension = (on: boolean): Extension => (on ? matchedTagsPlugin : []);

/* ------------------------------------------------------------------------ */
/* Folding by nesting level                                                 */
/* ------------------------------------------------------------------------ */

/** The foldable range of an `Element` node (between its tags), null for one-line elements. */
export function elementFoldRange(element: SyntaxNode, state: EditorState): TextRange | null {
  const first = element.firstChild;
  const last = element.lastChild;
  if (!first || first.name !== 'OpenTag' || !last) return null;
  const from = first.to;
  const to = last.name === 'CloseTag' ? last.from : element.to;
  if (to <= from) return null;
  // Only ranges that continue past the end of the opening tag's line can be folded.
  if (to <= state.doc.lineAt(from).to) return null;
  return { from, to };
}

/**
 * Fold ranges of the elements at nesting `depth` (0 = the root element, 1 = its children...),
 * in document order.
 */
export function elementFoldRangesAtDepth(state: EditorState, depth: number): TextRange[] {
  const tree = fullSyntaxTree(state);
  const out: TextRange[] = [];
  let current = -1;
  tree.iterate({
    enter(node) {
      if (node.name !== 'Element') return undefined;
      if (current + 1 === depth) {
        const range = elementFoldRange(node.node, state);
        if (range) out.push(range);
        return false; // `leave` is not called for skipped nodes
      }
      current += 1;
      return undefined;
    },
    leave(node) {
      if (node.name === 'Element') current -= 1;
    },
  });
  return out;
}

function isFolded(state: EditorState, range: TextRange): boolean {
  let found = false;
  foldedRanges(state).between(range.from, range.to, (from, to) => {
    if (from === range.from && to === range.to) {
      found = true;
      return false;
    }
    return undefined;
  });
  return found;
}

/**
 * Folds every element of nesting level `level` (1-based, 1 = the root element) that is not
 * folded yet; the cursor leaves the folded regions. Returns the number of ranges folded.
 */
export function collapseLevel(view: EditorTarget, level: number): number {
  const { state } = view;
  const ranges = elementFoldRangesAtDepth(state, level - 1).filter((r) => !isFolded(state, r));
  if (ranges.length === 0) return 0;
  const head = state.selection.main.head;
  const covering = ranges.find((r) => r.from < head && head < r.to);
  view.dispatch({
    effects: ranges.map((range) => foldEffect.of(range)),
    selection: covering ? EditorSelection.cursor(covering.from) : undefined,
  });
  return ranges.length;
}

/** Unfolds every folded element of nesting level `level`. Returns the number of ranges unfolded. */
export function expandLevel(view: EditorTarget, level: number): number {
  const { state } = view;
  const ranges = elementFoldRangesAtDepth(state, level - 1).filter((r) => isFolded(state, r));
  if (ranges.length === 0) return 0;
  view.dispatch({ effects: ranges.map((range) => unfoldEffect.of(range)) });
  return ranges.length;
}

/* ------------------------------------------------------------------------ */
/* Binary placeholders                                                      */
/* ------------------------------------------------------------------------ */

/** `<binary id="x" content-type="image/jpeg">…1234 bytes…</binary>` (one line). */
export const BINARY_PLACEHOLDER = /^(\s*<binary\b[^>]*>)(\u2026(\d+) bytes\u2026)(<\/binary>)/u;

class BinaryPlaceholderWidget extends WidgetType {
  constructor(
    private readonly size: number,
    private readonly label: (size: number) => string,
  ) {
    super();
  }

  override eq(other: BinaryPlaceholderWidget): boolean {
    return other.size === this.size;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'mfbe-source-binary';
    span.setAttribute('data-testid', 'source-binary-placeholder');
    span.setAttribute('data-size', String(this.size));
    span.textContent = this.label(this.size);
    return span;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

function binaryDecorations(view: EditorView, label: (size: number) => string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = view.state;
  for (const { from, to } of view.visibleRanges) {
    let line = doc.lineAt(from);
    for (;;) {
      const match = BINARY_PLACEHOLDER.exec(line.text);
      if (match) {
        const start = line.from + match[1]!.length;
        const end = start + match[2]!.length;
        builder.add(
          start,
          end,
          Decoration.replace({
            widget: new BinaryPlaceholderWidget(Number(match[3]), label),
            inclusive: false,
          }),
        );
      }
      if (line.to >= to || line.number >= doc.lines) break;
      line = doc.line(line.number + 1);
    }
  }
  return builder.finish();
}

/** Renders the `…N bytes…` binary placeholders as inert widgets the cursor skips over. */
export function binaryPlaceholdersExtension(label: (size: number) => string): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = binaryDecorations(view, label);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = binaryDecorations(update.view, label);
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
      provide: (plugin) =>
        EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
    },
  );
  return plugin;
}

/* ------------------------------------------------------------------------ */
/* Overtype (Insert key)                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Overtype mode: typed characters replace the character after the cursor (never past the end of
 * the line). `isOvertype` is read on every input so the status pane's INS/OVR state (store
 * `insertMode`) is the single source of truth.
 */
export function overtypeExtension(isOvertype: () => boolean): Extension {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (!isOvertype() || from !== to || text.length === 0 || /[\n\r]/.test(text)) return false;
    if (!view.state.selection.main.empty) return false;
    const line = view.state.doc.lineAt(from);
    const replaceTo = Math.min(from + text.length, line.to);
    view.dispatch({
      changes: { from, to: replaceTo, insert: text },
      selection: { anchor: from + text.length },
      scrollIntoView: true,
      userEvent: 'input.type',
    });
    return true;
  });
}

/* ------------------------------------------------------------------------ */
/* Transient line highlight (navigation target)                             */
/* ------------------------------------------------------------------------ */

/** Sets (1-based line number) or clears (null) the navigation highlight. */
export const highlightLineEffect = StateEffect.define<number | null>();

const targetLineDecoration = Decoration.line({ class: 'mfbe-source-target-line' });

function targetLineSet(state: EditorState, line: number): DecorationSet {
  if (line < 1 || line > state.doc.lines) return Decoration.none;
  return Decoration.set([targetLineDecoration.range(state.doc.line(line).from)]);
}

export const highlightedLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes);
    let set = false;
    for (const effect of tr.effects) {
      if (effect.is(highlightLineEffect)) {
        next = effect.value === null ? Decoration.none : targetLineSet(tr.state, effect.value);
        set = true;
      }
    }
    // Editing or moving the cursor by hand ends the highlight.
    if (!set && (tr.docChanged || (tr.selection && tr.isUserEvent('select')))) {
      next = Decoration.none;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** The current navigation highlight line (1-based), or null (tests). */
export function highlightedLine(state: EditorState): number | null {
  const set = state.field(highlightedLineField, false);
  if (!set) return null;
  const cursor = set.iter();
  return cursor.value ? state.doc.lineAt(cursor.from).number : null;
}

/* ------------------------------------------------------------------------ */
/* Font setting                                                             */
/* ------------------------------------------------------------------------ */

export interface SourceFont {
  /** CSS font-family, or null for the default monospace stack. */
  family: string | null;
  /** Size in CSS pixels, or null for the default. */
  size: number | null;
}

/**
 * Parses the `view.sourceFont` setting: "Consolas", "Consolas, 12", "Courier New 11pt",
 * "12px Fira Code". The empty string means "use the defaults".
 */
export function parseSourceFont(value: string | null | undefined): SourceFont {
  const text = (value ?? '').trim();
  if (!text) return { family: null, size: null };
  const trailing = /^(.*?)[,\s]+(\d+(?:\.\d+)?)\s*(px|pt)?$/i.exec(text);
  const leading = /^(\d+(?:\.\d+)?)\s*(px|pt)?\s+(.+)$/i.exec(text);
  let family = text;
  let size: number | null = null;
  if (trailing) {
    family = trailing[1]!.trim();
    size = toPixels(Number(trailing[2]), trailing[3]);
  } else if (leading) {
    family = leading[3]!.trim();
    size = toPixels(Number(leading[1]), leading[2]);
  } else if (/^\d+(?:\.\d+)?\s*(px|pt)?$/i.test(text)) {
    const match = /^(\d+(?:\.\d+)?)\s*(px|pt)?$/i.exec(text)!;
    return { family: null, size: toPixels(Number(match[1]), match[2]) };
  }
  family = family.replace(/^["']|["']$/g, '').trim();
  return { family: family ? quoteFamily(family) : null, size };
}

function toPixels(value: number, unit: string | undefined): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const px = unit?.toLowerCase() === 'pt' ? (value * 4) / 3 : value;
  return Math.round(px * 10) / 10;
}

function quoteFamily(family: string): string {
  return /[\s,]/.test(family) && !/^["']/.test(family) ? `"${family}"` : family;
}

/* ------------------------------------------------------------------------ */
/* Convenience                                                              */
/* ------------------------------------------------------------------------ */

/** 1-based line/column -> document offset (clamped to the text). */
export function offsetForLineColumn(state: EditorState, line: number, column: number): number {
  const lineNumber = Math.min(Math.max(line, 1), state.doc.lines);
  const info = state.doc.line(lineNumber);
  return Math.min(info.from + Math.max(column - 1, 0), info.to);
}

/** Document offset -> 1-based line/column. */
export function lineColumnAt(state: EditorState, pos: number): { line: number; column: number } {
  const clamped = Math.min(Math.max(pos, 0), state.doc.length);
  const line = state.doc.lineAt(clamped);
  return { line: line.number, column: clamped - line.from + 1 };
}
