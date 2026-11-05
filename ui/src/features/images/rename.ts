/**
 * Renaming a binary object (feature 009, User Story 7; FR-070 to FR-075, data-model §10): a new
 * id that is an XML NCName (Unicode letters allowed) and unused by every id of the whole model;
 * every reference to it rewritten - picture and inline picture addresses, link marks, the cover
 * pictures of title-info and src-title-info, the annotation and history fields - in the whole
 * model, the parts outside the Body view included; the core re-keys the object (`binary.rename`).
 * It is one undo entry, whose undo and redo rename the object back and forth.
 */

import type { CommandContext } from '@/app/commands';
import { collectModelIds } from '@/features/footnotes';
import type { BinaryMeta, Document } from '@/model/document';
import { actions } from '@/model/store';

/** An XML NCName: a letter or `_` first, then letters, digits, `.`, `-` and `_`. */
const NCNAME = /^[\p{L}_][\p{L}\p{N}\p{M}._\-\u00B7\u203F\u2040]*$/u;

/**
 * Why `value` cannot become the id of the binary now called `current` (an i18n key), or null
 * when it can (the current id itself included: nothing to do).
 */
export function newIdProblem(model: Document, current: string, value: string): string | null {
  if (value === current) return null;
  if (!NCNAME.test(value)) return 'descriptionForm.binaries.idInvalid';
  const ids = collectModelIds(model);
  for (const binary of model.binaries) ids.add(binary.id);
  return ids.has(value) ? 'descriptionForm.binaries.idTaken' : null;
}

/** `value` with every `href` equal to `from` set to `to` (unchanged parts kept as they are). */
function rewriteHrefs(value: unknown, from: string, to: string): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item) => {
      const next = rewriteHrefs(item, from, to);
      changed ||= next !== item;
      return next;
    });
    return changed ? out : value;
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const next = key === 'href' && item === from ? to : rewriteHrefs(item, from, to);
      changed ||= next !== item;
      out[key] = next;
    }
    return changed ? out : value;
  }
  return value;
}

/**
 * The model with the binary `oldId` called `newId`: its metadata (`meta` when the core gave
 * it) and every `#oldId` reference - ids are unique in a book, so each one points at the binary.
 */
export function renamedModel(
  model: Document,
  oldId: string,
  newId: string,
  meta?: BinaryMeta,
): Document {
  const rewritten = rewriteHrefs(model, `#${oldId}`, `#${newId}`) as Document;
  return {
    ...rewritten,
    binaries: rewritten.binaries.map((binary) =>
      binary.id === oldId ? (meta ?? { ...binary, id: newId }) : binary,
    ),
  };
}

/** Renames the binary `oldId` to `newId` in the core and the model, as one undo entry. */
export async function renameBinary(
  ctx: CommandContext,
  oldId: string,
  newId: string,
): Promise<void> {
  const { store, rpc, undo } = ctx;
  const state = store.getState();
  if (!rpc || !state.docId || !state.document || oldId === newId) return;
  const docId = state.docId;
  const before = state.document;
  const meta = await rpc.call('binary.rename', { docId, id: oldId, newId });
  const after = renamedModel(before, oldId, newId, meta);
  actions.updateDocument(store, after);
  undo.recordSnapshot('description', ctx.t('descriptionForm.binaries.renameUndo'), {
    undo: () => {
      void rpc
        .call('binary.rename', { docId, id: newId, newId: oldId })
        .then(() => actions.updateDocument(store, before))
        .catch(() => undefined);
    },
    redo: () => {
      void rpc
        .call('binary.rename', { docId, id: oldId, newId })
        .then(() => actions.updateDocument(store, after))
        .catch(() => undefined);
    },
  });
  actions.setStatusMessage(
    store,
    ctx.t('descriptionForm.binaries.renamed', { from: oldId, to: newId }),
  );
}
