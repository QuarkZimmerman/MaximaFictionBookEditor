/**
 * Picture layout (feature 007, US7; data-model §4, DP-4): marks every text block whose first
 * child is an inline picture with the class `fb-starts-with-picture`, which `pictures.css`
 * gives no first-line indent - a picture as wide as the text area would otherwise overflow by
 * the paragraph's 3em. (`:has()` would say it in CSS alone; the editor's stylesheets do not use
 * it, research R4.3.) Installed by both hosts' editor states: the Body view
 * (`createBodyEditorState`) and the annotation and history fields (`createRichFieldState`).
 * The marks are mapped through every transaction and only the changed text blocks are looked
 * at again.
 */

import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export const STARTS_WITH_PICTURE = 'fb-starts-with-picture';

export const pictureLayoutKey = new PluginKey<DecorationSet>('mfbe-picture-layout');

function startsWithPicture(block: PMNode): boolean {
  return block.firstChild?.type.name === 'inline_image';
}

function mark(block: PMNode, pos: number, out: Decoration[]): void {
  if (startsWithPicture(block)) {
    out.push(Decoration.node(pos, pos + block.nodeSize, { class: STARTS_WITH_PICTURE }));
  }
}

export function pictureLayoutDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    mark(node, pos, decorations);
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

/** The ranges of the new document that a transaction changed (new positions). */
function changedRanges(tr: Transaction): [number, number][] {
  const ranges: [number, number][] = [];
  const size = tr.doc.content.size;
  tr.mapping.maps.forEach((map, index) => {
    const rest = tr.mapping.slice(index + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      const from = Math.max(0, Math.min(rest.map(newStart, -1), size));
      const to = Math.max(from, Math.min(rest.map(newEnd, 1), size));
      ranges.push([from, to]);
    });
  });
  return ranges;
}

function updated(set: DecorationSet, tr: Transaction): DecorationSet {
  let next = set.map(tr.mapping, tr.doc);
  for (const [from, to] of changedRanges(tr)) {
    // The text blocks touching the change: their marks are decided again.
    const blocks: [PMNode, number][] = [];
    tr.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true;
      blocks.push([node, pos]);
      return false;
    });
    for (const [block, pos] of blocks) {
      // `find` also returns the neighbours' marks that touch this block's ends: only this
      // block's own (a node decoration starts where its node does) is decided again.
      next = next.remove(
        next
          .find(pos, pos + block.nodeSize)
          .filter((d) => d.from === pos && d.to === pos + block.nodeSize),
      );
      const added: Decoration[] = [];
      mark(block, pos, added);
      if (added.length) next = next.add(tr.doc, added);
    }
  }
  return next;
}

export function pictureLayoutPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: pictureLayoutKey,
    state: {
      init: (_config, state) => pictureLayoutDecorations(state.doc),
      apply: (tr, set) => (tr.docChanged ? updated(set, tr) : set),
    },
    props: {
      decorations: (state) => pictureLayoutKey.getState(state),
    },
  });
}
