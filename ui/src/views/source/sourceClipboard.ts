/**
 * Paste in the Source view, shared by its right-click menu and the Edit menu (feature 002): as in
 * the original's source editor, the clipboard's text replaces the selection.
 */

import type { EditorView } from '@codemirror/view';

import { clipboardText } from '@/app/textFields';

/** Puts `text` in place of the selection, as a paste (also Paste as plain text, feature 009). */
export function insertIntoSource(view: EditorView, text: string): void {
  view.focus();
  view.dispatch({
    ...view.state.replaceSelection(text),
    scrollIntoView: true,
    userEvent: 'input.paste',
  });
}

/** Pastes the clipboard's text at the selection; the browser's paste when it cannot be read. */
export async function pasteIntoSource(view: EditorView): Promise<void> {
  view.focus();
  const text = await clipboardText();
  if (text === null) {
    document.execCommand('paste');
    return;
  }
  insertIntoSource(view, text);
}
