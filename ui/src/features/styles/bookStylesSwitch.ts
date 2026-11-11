/**
 * Feature 012 (US4; D36, D39; contracts/book-styles.md §1): what View > Show Book Styles switches. The
 * Body view carries the class `mfbe-book-styles` while the setting is on and Fast mode is off (Fast mode
 * wins), and one generated `<style>` holds the book's stylesheets translated for the Body view. The
 * translation (`bookStyles.ts`, with css-tree) is loaded the first time the switch is on, and the sheet
 * is rebuilt only when the book's stylesheets change - not on text edits.
 */

import type { FeatureContext } from '@/app/services';
import type { Stylesheet } from '@/model/document';

/** The class on the Body view's container while the book's styles are drawn. */
export const BOOK_STYLES_CLASS = 'mfbe-book-styles';
const STYLE_ID = 'mfbe-book-styles';

/** Whether the book's styles are drawn: the setting on and Fast mode off (D39). */
export function bookStylesShown(state: {
  fastMode: boolean;
  settings?: { view?: { showBookStyles?: boolean } } | null;
}): boolean {
  return state.settings?.view?.showBookStyles === true && !state.fastMode;
}

export function registerBookStylesFeature(ctx: FeatureContext): void {
  let drawn: readonly Stylesheet[] | null = null;
  let generation = 0;
  const apply = async (): Promise<void> => {
    const state = ctx.store.getState();
    const sheets = bookStylesShown(state) ? (state.document?.stylesheets ?? []) : null;
    if (sheets === drawn) return;
    drawn = sheets;
    const current = ++generation;
    let element = document.getElementById(STYLE_ID);
    if (!sheets) {
      element?.remove();
      return;
    }
    const { bookStylesCss } = await import('./bookStyles');
    if (current !== generation) return;
    if (!element) {
      element = document.createElement('style');
      element.id = STYLE_ID;
      document.head.appendChild(element);
    }
    element.textContent = bookStylesCss(sheets).css;
  };
  ctx.store.subscribe(() => {
    void apply();
  });
  void apply();
}
