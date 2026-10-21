/**
 * Boundary protection of the annotation and history blocks (feature 004, US2; spec FR-012,
 * data-model §2.3). The blocks belong to the Body view's one editing surface: a selection may
 * span a block boundary and body text and be copied, but deleting it is refused - a Cut of it
 * still copies the selection, only its deletion is refused - so that the blocks and the bodies
 * stay what the schema requires.
 *
 * The plugin's `filterTransaction` refuses a document-changing transaction when the window
 * mounts the blocks (the document starts with a block node) and either
 *  - one of its replace steps spans two top-level children (a delete or paste across a block
 *    boundary - also across the boundary to the bodies), or
 *  - afterwards the document no longer begins with the same block node types, a block has no
 *    content, or a body is gone,
 * unless the transaction carries the controller's own mark (`markControllerTransaction`): the
 * model shown by `showModel`, a `commitStep` patch, a block rebuild, an undo / redo replay.
 * Mark changes (Select All + Bold), insertions and edits inside one top-level child pass -
 * ProseMirror's own corrective transactions (an IME replace, the node id plugin's appended
 * transaction) touch one child at a time.
 */

import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import { ReplaceAroundStep, ReplaceStep } from 'prosemirror-transform';

import { blockKindOf } from '../schema';

export const blockBoundaryKey = new PluginKey('mfbe-block-boundary');

/** Meta key of the transactions the Body controller builds itself. */
export const CONTROLLER_TRANSACTION = 'mfbe-controller';

/** Marks `tr` as the controller's own: the boundary filter lets it through. */
export function markControllerTransaction(tr: Transaction): Transaction {
  return tr.setMeta(CONTROLLER_TRANSACTION, true);
}

export function isControllerTransaction(tr: Transaction): boolean {
  return tr.getMeta(CONTROLLER_TRANSACTION) === true;
}

/** Node type names of the blocks at the start of `doc`, in order. */
function leadingBlockTypes(doc: PMNode): string[] {
  const types: string[] = [];
  for (let i = 0; i < doc.childCount; i += 1) {
    if (!blockKindOf(doc.child(i).type.name)) break;
    types.push(doc.child(i).type.name);
  }
  return types;
}

function bodyCount(doc: PMNode): number {
  let count = 0;
  doc.forEach((child) => {
    if (child.type.name === 'body') count += 1;
  });
  return count;
}

/**
 * True when a replace step of `tr` touches two top-level children of the document it applied
 * to: the first child touched is the one around `from` (or after it, at depth 0), the last the
 * one around `to` (or before it, at depth 0).
 */
export function crossesTopLevelBoundary(tr: Transaction): boolean {
  return tr.steps.some((step, index) => {
    if (!(step instanceof ReplaceStep) && !(step instanceof ReplaceAroundStep)) return false;
    const { from, to } = step;
    if (from >= to) return false;
    const doc = tr.docs[index]!;
    const $from = doc.resolve(from);
    const $to = doc.resolve(to);
    const first = $from.index(0);
    const last = $to.depth > 0 ? $to.index(0) : $to.index(0) - 1;
    return first < last;
  });
}

/**
 * True when `after` keeps what `before` had at its start: the same block node types, each with
 * content, and no body fewer (Add > Body may add one).
 */
export function keepsBlocks(before: PMNode, after: PMNode): boolean {
  const expected = leadingBlockTypes(before);
  if (expected.length === 0) return true;
  for (let i = 0; i < expected.length; i += 1) {
    const child = after.maybeChild(i);
    if (!child || child.type.name !== expected[i] || child.childCount === 0) return false;
  }
  return bodyCount(after) >= bodyCount(before);
}

export function blockBoundaryPlugin(): Plugin {
  return new Plugin({
    key: blockBoundaryKey,
    filterTransaction(tr, state) {
      if (!tr.docChanged || isControllerTransaction(tr)) return true;
      if (leadingBlockTypes(state.doc).length === 0) return true;
      if (crossesTopLevelBoundary(tr)) return false;
      return keepsBlocks(state.doc, tr.doc);
    },
  });
}
