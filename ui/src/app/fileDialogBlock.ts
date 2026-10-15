/**
 * While one of the platform's file dialogs is open, the editor takes no input, as behind the
 * original's modal dialogs (feature 002): the page is inert - no clicks, no focus - and keys go
 * nowhere. Windows and macOS make their dialogs modal to the editor window themselves; on Linux
 * the editor window is not a GTK window, so clicks would reach it. Nothing changes visually; the
 * element focused before gets the focus back when the dialog closes.
 */

/** Whether a file dialog is open, and its changes (`RpcClient`). */
export interface FileDialogState {
  readonly fileDialogOpen: boolean;
  onFileDialog(listener: (open: boolean) => void): () => void;
}

const KEY_EVENTS = ['keydown', 'keypress', 'keyup'] as const;

/**
 * Makes `root` (the element that holds the whole interface) inert while `state` reports an open
 * file dialog; returns the function that removes the block.
 */
export function installFileDialogBlock(
  state: FileDialogState,
  root: HTMLElement,
  win: Window = window,
): () => void {
  let focused: HTMLElement | null = null;
  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const block = () => {
    const active = win.document.activeElement as HTMLElement | null;
    focused = active && active !== win.document.body && root.contains(active) ? active : null;
    root.setAttribute('inert', '');
    for (const type of KEY_EVENTS) win.addEventListener(type, swallow, true);
  };

  const release = () => {
    root.removeAttribute('inert');
    for (const type of KEY_EVENTS) win.removeEventListener(type, swallow, true);
    const active = win.document.activeElement;
    if (focused?.isConnected && (active === null || active === win.document.body)) {
      focused.focus({ preventScroll: true });
    }
    focused = null;
  };

  if (state.fileDialogOpen) block();
  const off = state.onFileDialog((open) => (open ? block() : release()));
  return () => {
    off();
    if (root.hasAttribute('inert')) release();
  };
}
