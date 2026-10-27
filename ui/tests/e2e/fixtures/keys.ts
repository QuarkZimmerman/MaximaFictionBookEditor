/**
 * Keyboard chords of the end-to-end journeys on every platform. On macOS the editor's `Mod`
 * shortcuts and the clipboard use Cmd (src/app/hotkeys.ts), labels read Option for Alt and Cmd
 * for Meta, a few defaults differ, and the caret moves to the line start/end with Cmd+Left/Right
 * (Home and End only scroll).
 */

import type { Page } from '@playwright/test';

export const MAC = process.platform === 'darwin';

/** Modifier of the `Mod` shortcuts: the editor's own ones and the clipboard. */
export const MOD = MAC ? 'Meta' : 'Control';

/** How the UI writes the `Mod` modifier in shortcut labels. */
export const MOD_LABEL = MAC ? 'Cmd' : 'Ctrl';

/** Caret to the start / end of the line; Shift-extended selection to the end of the line. */
export const LINE_START = MAC ? 'Meta+ArrowLeft' : 'Home';
export const LINE_END = MAC ? 'Meta+ArrowRight' : 'End';
export const SELECT_TO_LINE_END = MAC ? 'Meta+Shift+ArrowRight' : 'Shift+End';

/** Edit > Replace: Option+Cmd+F on macOS, where Cmd+H hides the application. */
export const REPLACE = MAC ? 'Alt+Meta+f' : 'Control+h';

/** A chord the platform reserves, so it can never be assigned. */
export const RESERVED_CHORD = MAC ? 'Meta+q' : 'Alt+F4';

/**
 * A shortcut label as the UI shows it, from a chord written with `Mod` for the platform
 * modifier: modifiers in the UI's order (Ctrl, Alt, Shift, Meta), Alt read as Option and Meta
 * as Cmd on macOS.
 */
export function label(chord: string): string {
  const parts = chord.split('+');
  const key = parts.pop() ?? '';
  const mods = new Set(parts.map((part) => (part === 'Mod' ? MOD_LABEL : part)));
  const shown = ['Ctrl', 'Alt', 'Shift', 'Cmd']
    .filter((mod) => mods.has(mod))
    .map((mod) => (mod === 'Alt' && MAC ? 'Option' : mod));
  return [...shown, key].join('+');
}

/**
 * Alt+letter, as a dialog's accelerator: a letter the US keyboard does not have (the Russian
 * interface's accelerators) is sent through the DevTools protocol as the key that types it.
 */
export async function pressAlt(page: Page, letter: string): Promise<void> {
  if (/^[a-z0-9]$/i.test(letter)) {
    await page.keyboard.press(`Alt+${letter}`);
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 1, key: letter });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 1, key: letter });
  } finally {
    await cdp.detach();
  }
}

/**
 * A composition, as an input method or a dead key makes it (feature 006, U39; quickstart §4
 * open point 15), sent through the DevTools protocol of Playwright's Chromium at the focused
 * element's selection: each of `steps` as the composition's current text
 * (`Input.imeSetComposition`, its caret at the end), then `commit` as the committed text
 * (`Input.insertText`, which ends the composition). An input method spells `に`, `にほ`, `にほん`
 * and commits `日本`; a dead key composes `´` and commits `é`.
 */
export async function compose(page: Page, steps: readonly string[], commit: string): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  try {
    for (const step of steps) {
      await cdp.send('Input.imeSetComposition', {
        text: step,
        selectionStart: step.length,
        selectionEnd: step.length,
      });
    }
    await cdp.send('Input.insertText', { text: commit });
  } finally {
    await cdp.detach();
  }
}
