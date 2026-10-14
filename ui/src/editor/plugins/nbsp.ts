/**
 * Non-breaking space marker (Settings > Other > Non-breaking space, feature 002 FR-040 to
 * FR-044). The original editor replaced U+00A0 with the chosen display character in the edited
 * text and back at save time; here every NBSP keeps its real character in the document - so the
 * book's own □ ▫ ◦ are never touched - and gets an inline decoration `span.fb-nbsp[data-char]`
 * whose marker `styles.css` paints over the invisible space. As in the original, the marker
 * also stands for the space on the clipboard: copied text carries the marker character, pasted
 * marker characters become NBSPs (`transformCopied` / `transformPasted`; the Body editor's own
 * clipboard paths call `markersToNbsp`). The plain space (U+00A0 itself, the default) shows no
 * marker. Decorations are mapped through every transaction and only the changed text blocks
 * are scanned again.
 */

import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export const NBSP = ' ';
/** The original's default: the plain non-breaking space, i.e. no marker. */
export const DEFAULT_NBSP_DISPLAY_CHAR = NBSP;
/** The original's visible markers: □ ▫ ◦ (any other setting shows no marker). */
export const NBSP_MARKERS: readonly string[] = ['□', '▫', '◦'];

/** The marker character of a display-character setting, or null for the plain space. */
export function nbspMarker(displayChar: string | null | undefined): string | null {
  return displayChar && NBSP_MARKERS.includes(displayChar) ? displayChar : null;
}

export const nbspPluginKey = new PluginKey<DecorationSet>('mfbe-nbsp');

function addDecorations(node: PMNode, offset: number, marker: string, out: Decoration[]): void {
  node.descendants((child, pos) => {
    if (!child.isText || !child.text) return true;
    const text = child.text;
    let index = text.indexOf(NBSP);
    while (index >= 0) {
      const from = offset + pos + index;
      out.push(Decoration.inline(from, from + 1, { class: 'fb-nbsp', 'data-char': marker }));
      index = text.indexOf(NBSP, index + 1);
    }
    return false;
  });
}

export function nbspDecorations(doc: PMNode, displayChar: string): DecorationSet {
  const marker = nbspMarker(displayChar);
  if (!marker) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  addDecorations(doc, 0, marker, decorations);
  return DecorationSet.create(doc, decorations);
}

/** The ranges of the new document that a transaction changed, widened to whole text blocks. */
function changedBlocks(tr: Transaction): [number, number][] {
  const ranges: [number, number][] = [];
  tr.mapping.maps.forEach((map, index) => {
    const rest = tr.mapping.slice(index + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      const from = Math.max(0, Math.min(rest.map(newStart, -1), tr.doc.content.size));
      const to = Math.max(from, Math.min(rest.map(newEnd, 1), tr.doc.content.size));
      const $from = tr.doc.resolve(from);
      const $to = tr.doc.resolve(to);
      ranges.push([$from.start($from.depth), $to.end($to.depth)]);
    });
  });
  return ranges;
}

function updateDecorations(
  decorations: DecorationSet,
  tr: Transaction,
  marker: string,
): DecorationSet {
  let set = decorations.map(tr.mapping, tr.doc);
  for (const [from, to] of changedBlocks(tr)) {
    set = set.remove(set.find(from, to));
    const added: Decoration[] = [];
    tr.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText || !node.text) return true;
      let index = node.text.indexOf(NBSP);
      while (index >= 0) {
        const at = pos + index;
        if (at >= from && at < to) {
          added.push(Decoration.inline(at, at + 1, { class: 'fb-nbsp', 'data-char': marker }));
        }
        index = node.text.indexOf(NBSP, index + 1);
      }
      return false;
    });
    if (added.length > 0) set = set.add(tr.doc, added);
  }
  return set;
}

function mapText(fragment: Fragment, change: (text: string) => string): Fragment {
  const children: PMNode[] = [];
  fragment.forEach((node) => {
    if (node.isText) {
      const text = change(node.text ?? '');
      children.push(text === node.text ? node : node.type.schema.text(text, node.marks));
    } else {
      children.push(node.copy(mapText(node.content, change)));
    }
  });
  return Fragment.from(children);
}

/** NBSPs of a slice shown as the marker character (copied text, as in the original). */
export function nbspToMarker(slice: Slice, marker: string | null): Slice {
  if (!marker) return slice;
  const content = mapText(slice.content, (text) => text.split(NBSP).join(marker));
  return new Slice(content, slice.openStart, slice.openEnd);
}

/** Marker characters of pasted text turned into NBSPs (as the original did on paste). */
export function markersToNbsp(slice: Slice, marker: string | null): Slice {
  if (!marker) return slice;
  const content = mapText(slice.content, (text) => text.split(marker).join(NBSP));
  return new Slice(content, slice.openStart, slice.openEnd);
}

interface NbspPluginSpec {
  getDisplayChar: () => string;
}

/** The marker character in effect for an editor state (null: plain space or no plugin). */
export function currentNbspMarker(state: EditorState): string | null {
  const plugin = nbspPluginKey.get(state);
  if (!plugin) return null;
  return nbspMarker((plugin.spec as unknown as NbspPluginSpec).getDisplayChar());
}

/**
 * `getDisplayChar` is read on every update so the setting can change without re-creating the
 * editor; dispatch a transaction with `setMeta(nbspPluginKey, 'refresh')` to repaint all markers.
 */
export function nbspMarkerPlugin(getDisplayChar: () => string): Plugin<DecorationSet> {
  const spec = {
    key: nbspPluginKey,
    getDisplayChar,
    state: {
      init: (_config: unknown, state: EditorState) => nbspDecorations(state.doc, getDisplayChar()),
      apply(tr: Transaction, decorations: DecorationSet, _old: EditorState, state: EditorState) {
        if (tr.getMeta(nbspPluginKey) === 'refresh') {
          return nbspDecorations(state.doc, getDisplayChar());
        }
        if (!tr.docChanged) return decorations;
        const marker = nbspMarker(getDisplayChar());
        return marker ? updateDecorations(decorations, tr, marker) : DecorationSet.empty;
      },
    },
    props: {
      decorations(state: EditorState) {
        return nbspPluginKey.getState(state);
      },
      transformCopied: (slice: Slice) => nbspToMarker(slice, nbspMarker(getDisplayChar())),
      transformPasted: (slice: Slice) => markersToNbsp(slice, nbspMarker(getDisplayChar())),
    },
  };
  return new Plugin<DecorationSet>(spec);
}
