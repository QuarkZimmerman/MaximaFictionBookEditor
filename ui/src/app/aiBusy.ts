/**
 * The assistant's busy pointer (feature 008, FR-080 to FR-085, research R12): while an
 * assistant's request computes - not while it waits for the user in one of its dialogs - the
 * pointer over the document pane is the arrow with a turning atom. The frames are the files of
 * `public/cursors/` (tools/draw_ai_cursor.py); `useAiBusyPointer` swaps them through the CSS
 * property `--mfbe-ai-cursor`, about 8 a second, in the theme's palette, and keeps the still
 * frame under reduced motion.
 */

import { useEffect, type RefObject } from 'react';

export const AI_CURSOR_FRAMES = 12;
/** About 8 frames a second: one turn of the electrons in 1.5 s (FR-081). */
export const AI_CURSOR_FRAME_MS = 125;

/** The CSS cursor value of a frame (`null` = the still one), with the busy pointer as fallback. */
export function aiCursorValue(frame: number | null, dark: boolean): string {
  const theme = dark ? 'dark' : 'light';
  const name = frame === null ? 'static' : String((frame % AI_CURSOR_FRAMES) + 1).padStart(2, '0');
  return `url("./cursors/ai-busy-${theme}-${name}.svg") 2 2, progress`;
}

/** An assistant's request is at work and no dialog of it waits for the user. */
export function isAiBusy(runKind: string | null | undefined, modalOpen: boolean): boolean {
  return runKind === 'ai' && !modalOpen;
}

/** Animates `--mfbe-ai-cursor` on the element while `active`; removes it afterwards. */
export function useAiBusyPointer(element: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    if (!active) {
      node.style.removeProperty('--mfbe-ai-cursor');
      return;
    }
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dark = () => document.documentElement.dataset.theme === 'dark';
    let frame = 0;
    const paint = () =>
      node.style.setProperty('--mfbe-ai-cursor', aiCursorValue(reduced ? null : frame, dark()));
    paint();
    const timer = reduced
      ? null
      : window.setInterval(() => {
          frame = (frame + 1) % AI_CURSOR_FRAMES;
          paint();
        }, AI_CURSOR_FRAME_MS);
    return () => {
      if (timer !== null) window.clearInterval(timer);
      node.style.removeProperty('--mfbe-ai-cursor');
    };
  }, [element, active]);
}
