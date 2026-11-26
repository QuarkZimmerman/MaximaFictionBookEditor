/**
 * Viewport-scoped CodeMirror 6 visual hint for Maxima Library `<custom-info>` elements in Source
 * view (feature 021, FR-027, research.md R6).
 *
 * Highlights all 15 Maxima Library `<custom-info>` tags (6 contributor roles + 9 `ml*id` identity
 * tags) with a subtle theme-appropriate background and bottom hairline in both Light and Dark
 * themes while keeping every character 100% freely editable (zero edit protection).
 */

import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorState, RangeSetBuilder, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import type { SyntaxNode, Tree } from '@lezer/common';

import { MAXIMA_LIBRARY_CUSTOM_INFO_TYPES } from '@/features/description/maximaIdentities';

const maximaCustomInfoMark = Decoration.mark({ class: 'cm-maxima-custom-info' });

function stripXmlQuotes(raw: string): string {
  if (raw.length >= 2) {
    const first = raw[0];
    const last = raw[raw.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return raw.slice(1, -1);
    }
  }
  return raw;
}

function isMaximaCustomInfoTag(tagNode: SyntaxNode, state: EditorState): boolean {
  const tagNameNode = tagNode.getChild('TagName');
  if (!tagNameNode) return false;
  const tagName = state.sliceDoc(tagNameNode.from, tagNameNode.to);
  if (tagName !== 'custom-info' && !tagName.endsWith(':custom-info')) {
    return false;
  }

  for (let child = tagNode.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'Attribute') continue;
    const attrNameNode = child.getChild('AttributeName');
    const attrValueNode = child.getChild('AttributeValue');
    if (!attrNameNode || !attrValueNode) continue;
    const attrName = state.sliceDoc(attrNameNode.from, attrNameNode.to);
    if (attrName !== 'info-type') continue;
    const rawValue = state.sliceDoc(attrValueNode.from, attrValueNode.to);
    const infoType = stripXmlQuotes(rawValue).trim();
    return MAXIMA_LIBRARY_CUSTOM_INFO_TYPES.has(infoType);
  }
  return false;
}

export interface MaximaCustomInfoRange {
  from: number;
  to: number;
}

/**
 * Finds all Maxima Library `<custom-info>` elements intersecting `ranges` using the parsed Lezer
 * XML syntax tree. Pure and headless-testable without a DOM.
 */
export function findMaximaCustomInfoRanges(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
  tree: Tree = syntaxTree(state),
): MaximaCustomInfoRange[] {
  const seenFrom = new Set<number>();
  const found: MaximaCustomInfoRange[] = [];

  for (const { from, to } of ranges) {
    tree.iterate({
      from,
      to,
      enter(nodeRef) {
        if (nodeRef.name !== 'Element') return undefined;
        const element = nodeRef.node;
        const first = element.firstChild;
        if (!first || (first.name !== 'OpenTag' && first.name !== 'SelfClosingTag')) {
          return undefined;
        }
        if (isMaximaCustomInfoTag(first, state)) {
          if (!seenFrom.has(element.from) && element.to > element.from) {
            seenFrom.add(element.from);
            found.push({ from: element.from, to: element.to });
          }
          return false;
        }
        return undefined;
      },
    });
  }

  found.sort((a, b) => a.from - b.from || a.to - b.to);
  return found;
}

function buildDecorations(view: EditorView): DecorationSet {
  const visible = view.visibleRanges;
  if (visible.length === 0) return Decoration.none;
  const maxTo = visible[visible.length - 1]!.to;
  // Ensure the XML syntax tree covers the visible viewport synchronously (bounded to 50 ms) so
  // Maxima Library `<custom-info>` tags highlight on the very first painted frame after view switch.
  const tree = ensureSyntaxTree(view.state, maxTo, 50) ?? syntaxTree(view.state);
  const ranges = findMaximaCustomInfoRanges(view.state, visible, tree);
  const builder = new RangeSetBuilder<Decoration>();
  for (const r of ranges) {
    builder.add(r.from, r.to, maximaCustomInfoMark);
  }
  return builder.finish();
}

const maximaCustomInfoHighlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** Always-on, non-locking Source view color hint for Maxima Library `<custom-info>` elements. */
export function maximaCustomInfoHighlightExtension(): Extension {
  return maximaCustomInfoHighlightPlugin;
}
