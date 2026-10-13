/**
 * Fast mode (T154, FR-025) - the decision: **kept**, as a reduced-fidelity rendering of the
 * Body view, like the original editor's `main_fast.css` (View > Fast Mode, F5; also the
 * checkbox on the Settings > View page).
 *
 * What it changes (CSS only, `editor/styles.css`, class `mfbe-body-view--fast` on the Body
 * root): no section/epigraph/cite/poem frames and backgrounds, titles as plain bold text, no
 * coloured text, tables without cell backgrounds, image previews collapsed to a placeholder
 * box (nothing to lay out, scale or paint), no non-breaking-space markers. The document, the
 * section window and every command behave exactly as in normal mode: Fast mode trades
 * decoration and image rendering for paint speed on large books.
 *
 * The state lives in `settings.view.fastMode` (persisted by the core) and is mirrored in
 * `store.fastMode`; toggling writes the setting through `settings.set` and applies the result,
 * falling back to a session-only toggle when the core is unreachable.
 */

import type { CommandContext } from '@/app/commands';
import { actions, type AppStore } from '@/model/store';

/** Class applied on the Body view root while Fast mode is on. */
export const FAST_MODE_CLASS = 'mfbe-body-view--fast';

/** Class list fragment for the Body view root. */
export function fastModeClassName(fastMode: boolean): string {
  return fastMode ? ` ${FAST_MODE_CLASS}` : '';
}

/** Applies or removes the class on an existing element (node views, tests). */
export function applyFastMode(element: Element | null, fastMode: boolean): void {
  element?.classList.toggle(FAST_MODE_CLASS, fastMode);
}

/** Keeps `element` in sync with `store.fastMode`; returns the unsubscribe function. */
export function bindFastMode(store: AppStore, element: Element): () => void {
  applyFastMode(element, store.getState().fastMode);
  return store.subscribe((state, previous) => {
    if (state.fastMode !== previous.fastMode) applyFastMode(element, state.fastMode);
  });
}

/**
 * View > Fast Mode: flips the setting and persists it (`settings.set({view: {fastMode}})`);
 * the core answers with the effective settings, which also update `store.fastMode`. Without a
 * connected core the toggle applies to the session only.
 */
export async function toggleFastMode(ctx: Pick<CommandContext, 'store' | 'rpc'>): Promise<boolean> {
  const { store, rpc } = ctx;
  const fastMode = !store.getState().fastMode;
  actions.toggleFastMode(store); // immediate feedback; the settings answer confirms it
  if (rpc && store.getState().connection === 'connected') {
    try {
      const result = await rpc.call('settings.set', { patch: { view: { fastMode } } });
      actions.setSettings(store, result.settings);
    } catch {
      // persistence is best effort; the session keeps the toggled state
    }
  }
  return store.getState().fastMode;
}
