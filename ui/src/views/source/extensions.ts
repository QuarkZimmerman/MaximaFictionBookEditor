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
import type { SyntaxNode, Tree } from '@lezer/common';

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
