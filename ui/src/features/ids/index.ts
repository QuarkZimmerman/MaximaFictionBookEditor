/**
 * Feature 011 (D51): the marks of the elements that have an id - the Body view's `#id` tabs and the
 * tree's `#` badge on sections - follow `view.showIds` (on by default; *View > Show Ids*). The
 * setting is mirrored as the `mfbe-show-ids` class of the page's root, which the marks' CSS reads.
 */
import type { FeatureContext } from '@/app/services';

export const SHOW_IDS_CLASS = 'mfbe-show-ids';

export function registerIdsFeature(ctx: FeatureContext): void {
  const { store } = ctx;
  const sync = () => {
    const shown = store.getState().settings?.view?.showIds !== false;
    document.documentElement.classList.toggle(SHOW_IDS_CLASS, shown);
  };
  sync();
  store.subscribe(sync);
}
