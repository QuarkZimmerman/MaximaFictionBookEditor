/**
 * While a platform file dialog is open the editor takes no input (feature 002): the interface
 * root is inert, keys reach no handler, and the element focused before gets the focus back.
 */

import { installFileDialogBlock, type FileDialogState } from '@/app/fileDialogBlock';

class FakeState implements FileDialogState {
  fileDialogOpen = false;
  private readonly listeners = new Set<(open: boolean) => void>();

  onFileDialog(listener: (open: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  set(open: boolean): void {
    this.fileDialogOpen = open;
    for (const listener of this.listeners) listener(open);
  }
}

describe('file dialog block', () => {
  let root: HTMLElement;
  let editor: HTMLTextAreaElement;

  beforeEach(() => {
    root = document.createElement('div');
    editor = document.createElement('textarea');
    root.append(editor);
    document.body.append(root);
  });

  afterEach(() => {
    root.remove();
  });

  it('makes the interface inert and swallows keys while a file dialog is open', () => {
    const state = new FakeState();
    const remove = installFileDialogBlock(state, root);
    const seen: string[] = [];
    const hotkeys = (event: KeyboardEvent) => seen.push(event.key);
    document.addEventListener('keydown', hotkeys, { capture: true });
    try {
      editor.focus();
      state.set(true);
      expect(root.hasAttribute('inert')).toBe(true);
      const key = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true });
      editor.dispatchEvent(key);
      expect(key.defaultPrevented).toBe(true);
      expect(seen).toEqual([]);

      state.set(false);
      expect(root.hasAttribute('inert')).toBe(false);
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
      expect(seen).toEqual(['a']);
    } finally {
      document.removeEventListener('keydown', hotkeys, { capture: true });
      remove();
    }
  });

  it('gives the focus back to the element focused before the dialog', () => {
    const state = new FakeState();
    const remove = installFileDialogBlock(state, root);
    editor.focus();
    state.set(true);
    // The browser moves the focus out of an inert subtree.
    editor.blur();
    expect(document.activeElement).toBe(document.body);
    state.set(false);
    expect(document.activeElement).toBe(editor);
    remove();
  });

  it('leaves the focus alone when something else took it, and blocks from the start', () => {
    const state = new FakeState();
    state.fileDialogOpen = true;
    const remove = installFileDialogBlock(state, root);
    expect(root.hasAttribute('inert')).toBe(true);
    const other = document.createElement('input');
    document.body.append(other);
    other.focus();
    state.set(false);
    expect(document.activeElement).toBe(other);
    other.remove();

    // Removing the block while a dialog is open releases the page.
    state.set(true);
    remove();
    expect(root.hasAttribute('inert')).toBe(false);
    state.set(false);
  });
});
