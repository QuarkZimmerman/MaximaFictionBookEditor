/**
 * Keeps every structural node of the editor document addressable: nodes created by editing
 * commands (new paragraphs, sections, tables...) arrive without `nodeId`; this plugin appends a
 * transaction that assigns `ui_N` ids to them so that find/replace, the Document Tree, caret
 * restore and the status-bar path can refer to them before the core re-parses the document.
 * Only the ranges touched by the transactions are scanned.
 */

import { Plugin, PluginKey, type Transaction } from 'prosemirror-state';

import { createNodeIdGenerator } from '../schema';

export const nodeIdPluginKey = new PluginKey('mfbe-node-ids');

export function nodeIdPlugin(nextId: () => string = createNodeIdGenerator()): Plugin {
  return new Plugin({
    key: nodeIdPluginKey,
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const ranges: [number, number][] = [];
      for (const tr of transactions) {
        for (const map of tr.mapping.maps) {
          map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
            ranges.push([newStart, newEnd]);
          });
        }
      }
      if (ranges.length === 0) return null;
      let fix: Transaction | null = null;
      const seen = new Set<number>();
      const size = newState.doc.content.size;
      for (const [start, end] of ranges) {
        const from = Math.max(0, Math.min(start, size));
        const to = Math.max(from, Math.min(end, size));
        newState.doc.nodesBetween(from, to, (node, pos) => {
          if (node.isText || seen.has(pos)) return;
          seen.add(pos);
          if (node.type.spec.attrs?.nodeId && !node.attrs.nodeId) {
            fix ??= newState.tr;
            fix.setNodeMarkup(pos, undefined, { ...node.attrs, nodeId: nextId() }, node.marks);
          }
        });
      }
      if (!fix) return null;
      (fix as Transaction).setMeta('addToHistory', false);
      return fix;
    },
  });
}
