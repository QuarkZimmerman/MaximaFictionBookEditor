/**
 * The content-model automata of the FB2 elements (feature 006, FR-061; I24; C35;
 * resource-formats.md §12; data-model §7.3 "Content models"): the member `model` of the
 * generated table `fb2Elements.json` (`tools/fb2-schema-elements.py`, kept current by CI's
 * `--check` and pinned to libxml2 by `tests/core/test_content_models.cpp`) - per element the
 * minimal deterministic automaton of its content model over its child elements, built from
 * `resources/schema/*.xsd` alone. `next[s][name]` is the state after a child `name` in state
 * `s` (a missing entry: not allowed there), state 0 is the start and `final` lists the states
 * the content may end in. The eight names declared with different content models (`code`,
 * `emphasis`, `publisher`, `strikethrough`, `strong`, `style`, `sub`, `sup`) have none.
 *
 * Only the Source view's table rule (`tablePoint.ts`) reads the automata, to enable *Add →
 * Table*; validation stays in the core (constitution III; C35).
 */

import { FB2_ELEMENTS } from './completion';

export interface ContentModel {
  /** The states the content may end in, ascending. */
  final: number[];
  /**
   * Per state, the state after each child element allowed there (`Record<string, number>` in
   * resource-formats.md §12; typed as partial because a missing entry means "not allowed" -
   * and the JSON import types a row's absent names as optional).
   */
  next: Partial<Record<string, number>>[];
}

/** The automaton of the element `name` (its local name), null when it has none. */
export function contentModelOf(name: string): ContentModel | null {
  return FB2_ELEMENTS.elements[name]?.model ?? null;
}

/** The state after a child `name` in `state`, undefined when the child is not allowed there. */
export function step(model: ContentModel, state: number, name: string): number | undefined {
  const row = model.next[state];
  if (!row || !Object.prototype.hasOwnProperty.call(row, name)) return undefined;
  return row[name];
}

/** Whether the content may end in `state`. */
export function isFinal(model: ContentModel, state: number): boolean {
  return model.final.includes(state);
}

const syncCache = new WeakMap<ContentModel, ReadonlyMap<string, number>>();

/**
 * The synchronising symbols of an automaton with their one target: the children whose every
 * transition leads to the same state, so the state after such a child is known without the
 * children before it - in `section` every child but `image` (a heading image or a content
 * image). The table rule walks back to the nearest of them instead of to the first child.
 */
export function syncTargets(model: ContentModel): ReadonlyMap<string, number> {
  const cached = syncCache.get(model);
  if (cached) return cached;
  const targets = new Map<string, number>();
  const mixed = new Set<string>();
  for (const row of model.next) {
    for (const [name, target] of Object.entries(row)) {
      if (target === undefined || mixed.has(name)) continue;
      const known = targets.get(name);
      if (known === undefined) {
        targets.set(name, target);
      } else if (known !== target) {
        targets.delete(name);
        mixed.add(name);
      }
    }
  }
  const sorted = new Map(
    [...targets].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ) as ReadonlyMap<string, number>;
  syncCache.set(model, sorted);
  return sorted;
}
