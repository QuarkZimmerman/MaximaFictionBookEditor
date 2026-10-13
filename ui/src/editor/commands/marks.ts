/**
 * Inline and paragraph style commands (T058).
 *
 *  - `toggleInlineMark(name)`: strong / emphasis / strikethrough / sub / sup / code toggles
 *    (prosemirror-commands `toggleMark`: a selection gets the mark unless it already has it
 *    everywhere; a caret toggles the stored mark for the next typed text).
 *  - `setNamedStyle(name)` / `clearNamedStyle`: the FB2 `style` mark (`<style name="...">`).
 *  - `setParagraphStyle('normal' | 'subtitle' | 'textAuthor')`: the Style menu conversions with
 *    the original editor's rules (`StyleCheck` in main.js): Normal applies inside sections,
 *    titles, epigraphs, stanzas (where "normal" is a verse), cites and annotations; Subtitle in
 *    sections, stanzas, cites and annotations; Text author in cites, epigraphs and poems - and
 *    only where the FB2 content model accepts the resulting element at that position.
 */

import { toggleMark } from 'prosemirror-commands';
import type { MarkType, Node as PMNode, NodeType } from 'prosemirror-model';
import type { Command, EditorState } from 'prosemirror-state';

import { M, N, PARAGRAPH_TYPES } from './util';

export type InlineMarkName = 'strong' | 'emphasis' | 'strikethrough' | 'sub' | 'sup' | 'code';
export type ParagraphStyle = 'normal' | 'subtitle' | 'textAuthor';

export const INLINE_MARKS: readonly InlineMarkName[] = [
  'strong',
  'emphasis',
  'strikethrough',
  'sub',
  'sup',
  'code',
];

/** True when `type` is active at the caret (stored marks) or over the whole selection. */
export function markActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks ?? $from.marks());
  let active = true;
  let sawText = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;
    sawText = true;
    if (!type.isInSet(node.marks)) active = false;
  });
  return sawText && active;
}

/** The selection sits in inline content (marks can be applied). */
export function inInlineContent(state: EditorState): boolean {
  const { $from, $to } = state.selection;
  return $from.parent.inlineContent && $to.parent.inlineContent;
}

export function toggleInlineMark(name: InlineMarkName): Command {
  const type = M[name]!;
  return (state, dispatch, view) => {
    if (!inInlineContent(state)) return false;
    return toggleMark(type)(state, dispatch, view);
  };
}

/** Applies the named `style` mark to the selection (replacing any other named style). */
export function setNamedStyle(name: string): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection;
    if (empty || !inInlineContent(state)) return false;
    if (dispatch) {
      const tr = state.tr.removeMark(from, to, M.style!);
      if (name) tr.addMark(from, to, M.style!.create({ name }));
      dispatch(tr);
    }
    return true;
  };
}

export const clearNamedStyle: Command = setNamedStyle('');

/* ------------------------------------------------------------------------ */
/* Paragraph styles                                                         */
/* ------------------------------------------------------------------------ */

const NORMAL_PARENTS = new Set(['section', 'title', 'epigraph', 'stanza', 'cite', 'annotation']);
const SUBTITLE_PARENTS = new Set(['section', 'stanza', 'cite', 'annotation']);
const TEXT_AUTHOR_PARENTS = new Set(['cite', 'epigraph', 'poem']);

interface ParagraphRef {
  pos: number;
  node: PMNode;
  parent: PMNode;
  index: number;
}

/** Paragraph-like blocks covered by the selection (with their parents). */
function selectedParagraphs(state: EditorState): ParagraphRef[] {
  const { from, to } = state.selection;
  const refs: ParagraphRef[] = [];
  state.doc.nodesBetween(from, to, (node, pos, parent, index) => {
    if (PARAGRAPH_TYPES.has(node.type.name) && parent) {
      refs.push({ pos, node, parent, index });
      return false;
    }
    return !node.isTextblock;
  });
  return refs;
}

/** Target node type of `style` inside `parentName`, or null when the style does not apply. */
export function paragraphTypeFor(style: ParagraphStyle, parentName: string): NodeType | null {
  switch (style) {
    case 'normal':
      if (!NORMAL_PARENTS.has(parentName)) return null;
      return parentName === 'stanza' ? N.v! : N.p!;
    case 'subtitle':
      return SUBTITLE_PARENTS.has(parentName) ? N.subtitle! : null;
    case 'textAuthor':
      return TEXT_AUTHOR_PARENTS.has(parentName) ? N.text_author! : null;
  }
}

/** The paragraph style currently applied at the caret (for Style menu check marks). */
export function currentParagraphStyle(state: EditorState): ParagraphStyle | null {
  const parent = state.selection.$head.parent;
  switch (parent.type.name) {
    case 'p':
    case 'v':
      return 'normal';
    case 'subtitle':
      return 'subtitle';
    case 'text_author':
      return 'textAuthor';
    default:
      return null;
  }
}

/**
 * Converts the selected paragraphs to `style`. Enabled only when every selected paragraph can
 * legally take the resulting type at its position (the FB2 order rules).
 */
export function setParagraphStyle(style: ParagraphStyle): Command {
  return (state, dispatch) => {
    const refs = selectedParagraphs(state);
    if (refs.length === 0) return false;
    const plan: { ref: ParagraphRef; type: NodeType }[] = [];
    for (const ref of refs) {
      const type = paragraphTypeFor(style, ref.parent.type.name);
      if (!type) return false;
      if (ref.node.type !== type && !ref.parent.canReplaceWith(ref.index, ref.index + 1, type)) {
        return false;
      }
      plan.push({ ref, type });
    }
    // Already in that style: enabled (as in the original) but nothing to change.
    if (dispatch && plan.some(({ ref, type }) => ref.node.type !== type)) {
      const tr = state.tr;
      for (const { ref, type } of plan) {
        if (ref.node.type === type) continue;
        const attrs = {
          nodeId: ref.node.attrs.nodeId,
          extraAttrs: ref.node.attrs.extraAttrs,
          id: ref.node.attrs.id,
          lang: ref.node.attrs.lang,
          style: ref.node.attrs.style,
        };
        tr.setNodeMarkup(tr.mapping.map(ref.pos), type, attrs, ref.node.marks);
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}
