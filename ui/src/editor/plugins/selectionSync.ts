/**
 * The editor state and the browser selection kept in step where the focus moves.
 *
 * ProseMirror learns of a selection made with the keyboard (Shift+End) or the mouse only from the
 * browser's `selectionchange` event, which arrives asynchronously - on a loaded machine after the
 * input that follows. Two of its behaviours then lost the user's selection:
 *
 * - It drops that event once the editor has lost the focus (prosemirror-view,
 *   `DOMObserver.onSelectionChange` checks `hasFocusAndSelection`): a press on the menu bar
 *   opened a menu that took the focus first, the new selection was lost for good and the menu
 *   judged the caret the selection had replaced (a script that needs a selection stayed
 *   disabled); a toolbar button, a hotkey or the editor's own keymap acted on the previous one.
 *   While the editor has the focus, a press outside it and every key therefore first have the
 *   selection read (`readDomSelection`), in the capture phase on the document - before the menu
 *   bar, a toolbar, the application's hotkeys or the editor's keymaps see the event. A press
 *   inside the editor is left to ProseMirror, and so is a key during a composition.
 * - 20 ms after the editor gains the focus, it writes its own selection back into the DOM when the
 *   browser's differs from the last one it read (`handlers.focus`, meant for a focus by Tab or
 *   script): after a press that focused the editor, the keys typed at once (Home, Shift+End) were
 *   undone when the browser reported them after those 20 ms. A press into the editor while
 *   another element has the focus therefore gives it the focus itself first (`focusForPress`).
 */

import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

/** The parts of ProseMirror's (internal) view state used here. */
interface ViewInternals {
  focused?: boolean;
  domObserver?: { forceFlush?(): void; flush?(): void };
}

/**
 * Makes ProseMirror read the browser selection (and any DOM change it has not read yet) now, as
 * the `selectionchange` event would; nothing while the editor does not have the focus, where
 * ProseMirror ignores the browser selection, or while a composition runs, which ProseMirror
 * reads when it ends.
 */
export function readDomSelection(view: EditorView): void {
  if (!view.hasFocus() || view.composing) return;
  const observer = (view as unknown as ViewInternals).domObserver;
  observer?.forceFlush?.(); // a read ProseMirror scheduled on a timer comes first
  observer?.flush?.();
}

/**
 * Gives the editor the focus for a press into it, before the browser does. ProseMirror's
 * `focus()` writes its selection into the DOM, so the browser, finding the editor focused, puts
 * its caret where the press is - focused by the press itself, it would put a caret at the start of
 * the editable root first, the document start, which ProseMirror reads as the new selection when
 * the click changes nothing in its state (a click on the picture that a selection kept from
 * before a view switch holds). The view is marked focused beforehand, as ProseMirror's focus
 * handler marks it, so that the handler skips its restore 20 ms later: the press itself places
 * the selection. Undone when the focus did not move (an element that cannot take it).
 */
function focusForPress(view: EditorView): void {
  const internals = view as unknown as ViewInternals;
  internals.focused = true;
  view.dom.classList.add('ProseMirror-focused');
  view.focus();
  if (!view.hasFocus()) {
    internals.focused = false;
    view.dom.classList.remove('ProseMirror-focused');
  }
}

export function selectionSyncPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown(view) {
          if (view.editable && !view.hasFocus()) focusForPress(view);
          return false;
        },
      },
    },
    view(view) {
      const root = view.root as Document | ShadowRoot;
      const onPress = (event: Event) => {
        if (event.target instanceof Node && view.dom.contains(event.target)) return;
        readDomSelection(view);
      };
      const onKey = (event: Event) => {
        const key = event as KeyboardEvent;
        if (key.isComposing || key.keyCode === 229) return;
        readDomSelection(view);
      };
      root.addEventListener('pointerdown', onPress, true);
      root.addEventListener('mousedown', onPress, true);
      root.addEventListener('keydown', onKey, true);
      return {
        destroy() {
          root.removeEventListener('pointerdown', onPress, true);
          root.removeEventListener('mousedown', onPress, true);
          root.removeEventListener('keydown', onKey, true);
        },
      };
    },
  });
}
