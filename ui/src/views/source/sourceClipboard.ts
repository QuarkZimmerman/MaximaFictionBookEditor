/**
 * Paste in the Source view, shared by its right-click menu and the Edit menu (feature 002): as in
 * the original's source editor, the clipboard's text replaces the selection.
 */

import type { EditorView } from '@codemirror/view';

import { clipboardText } from '@/app/textFields';

/** Pastes the clipboard's text at the selection; the browser's paste when it cannot be read. */
export async function pasteIntoSource(view: EditorView): Promise<void> {
  view.focus();
  const text = await clipboardText();
  if (text === null) {
    document.execCommand('paste');
    return;
  }
  view.dispatch({
    ...view.state.replaceSelection(text),
    scrollIntoView: true,
    userEvent: 'input.paste',
  });
}
