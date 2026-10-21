/**
 * The "untouched new document" of the description import (feature 004 US4, FR-033; data-model
 * §4.2): a never-saved document whose description still equals, by content, the state its
 * template and the editor's own filling-in gave it. The comparison goes through the clean
 * projection of the Description view (`cleanDescription(formFromDescription(x))`) with the
 * node ids of the annotation and history stripped and the key order ignored - so an edit
 * undone back to the starting value leaves the document untouched, a Body-block edit of the
 * annotation counts (the same datum), body-text edits do not count at all.
 */

import type { Description } from '@/model/document';
import type { AppState } from '@/model/store';
import { cleanDescription, formFromDescription } from '@/views/description/model';

/** `value` without its `nodeId` attributes, every property with an `undefined` value dropped. */
function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'nodeId' || item === undefined) continue;
      out[key] = strip(item);
    }
    return out;
  }
  return value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length) return false;
    return keys.every((key) => key in right && deepEqual(left[key], right[key]));
  }
  return false;
}

/** The clean projection of a description without node ids: what "equal by content" compares. */
export function comparableDescription(description: Description): unknown {
  return strip(cleanDescription(formFromDescription(description)));
}

/**
 * True when the two descriptions are the same by content: their clean projections equal with
 * the node ids stripped and whatever the key order.
 */
export function equalDescriptions(a: Description, b: Description): boolean {
  return deepEqual(comparableDescription(a), comparableDescription(b));
}

/**
 * The silent-import case (FR-033): a document never saved whose description still equals its
 * baseline; false without a document, without a baseline (an opened book) or once saved.
 */
export function isUntouchedNewDocument(
  state: Pick<AppState, 'document' | 'path' | 'newDocumentBaseline'>,
): boolean {
  if (!state.document || state.path !== null || !state.newDocumentBaseline) return false;
  return equalDescriptions(state.document.description, state.newDocumentBaseline);
}
