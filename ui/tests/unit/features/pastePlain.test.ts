/**
 * Feature 009, User Story 4 (T054): Edit > Paste as plain text (FR-040 to FR-045, DP-13). The
 * Body view takes the clipboard's text as paragraphs through the paste router, removed by one
 * Undo; a plain field takes it as typed; with no text nothing changes and the status bar says
 * so; the command is unavailable while a script runs; its default key is Mod+Shift+V.
 */
import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_HOTKEYS } from '@/app/hotkeys';
import { followTextFieldFocus } from '@/app/textFields';
import { FBE_DEFAULT_HOTKEYS } from '@/app/defaultHotkeys';
import { actions } from '@/model/store';

import { caretIn, removeHarnessHosts, tablesHarness } from './tablesHarness';
import { fakeRunLock } from './testUtils';

function clipboardWith(text: string | null): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      readText: async () => {
        if (text === null) throw new Error('denied');
        return text;
      },
      read: async () => [],
    },
  });
}

/** The text of each paragraph of the Body editor. */
function paragraphs(view: { state: { doc: { descendants: (f: (n: never) => void) => void } } }) {
  const out: string[] = [];
  view.state.doc.descendants((node: never) => {
    const n = node as { type: { name: string }; textContent: string };
    if (n.type.name === 'p') out.push(n.textContent);
  });
  return out;
}

describe('Paste as plain text (feature 009, User Story 4)', () => {
  afterEach(() => removeHarnessHosts());

  it('the Body view takes the text as paragraphs, removed by one Undo', async () => {
    const h = await tablesHarness();
    caretIn(h, 'p2', 'After'.length);
    clipboardWith('First line\nSecond line');
    const before = h.view.state.doc;
    await act(async () => {
      await h.services.commands.execute('edit.pastePlain', h.ctx);
    });
    const texts = paragraphs(h.view as never);
    expect(texts.some((t) => t.includes('First line'))).toBe(true);
    expect(texts).toContain('Second line');
    await act(async () => {
      await h.services.commands.execute('edit.undo', h.ctx);
    });
    expect(h.view.state.doc.eq(before)).toBe(true);
  });

  it('with no text on the clipboard nothing changes and the status bar says so', async () => {
    const h = await tablesHarness();
    caretIn(h, 'p1', 0);
    clipboardWith('');
    const before = h.view.state.doc;
    await act(async () => {
      await h.services.commands.execute('edit.pastePlain', h.ctx);
    });
    expect(h.view.state.doc).toBe(before);
    expect(h.store.getState().statusMessage).toBe('The Clipboard holds no text.');
  });

  it('a plain field of the Description view takes the text as typed', async () => {
    const h = await tablesHarness();
    const input = document.createElement('input');
    input.setAttribute('data-testid', 'description-book-title');
    const view = document.createElement('div');
    view.setAttribute('data-testid', 'description-view');
    view.appendChild(input);
    document.body.appendChild(view);
    const exec = document.execCommand;
    const stopFollowing = followTextFieldFocus();
    try {
      actions.setActiveView(h.store, 'description');
      clipboardWith('Plain words');
      const spy = vi.fn(() => true);
      document.execCommand = spy;
      input.focus();
      await act(async () => {
        await h.services.commands.execute('edit.pastePlain', h.ctx);
      });
      expect(spy).toHaveBeenCalledWith('insertText', false, 'Plain words');
    } finally {
      document.execCommand = exec;
      stopFollowing();
      view.remove();
    }
  });

  it('is unavailable while a script runs, like Paste', async () => {
    const h = await tablesHarness();
    caretIn(h, 'p1', 0);
    expect(h.services.commands.isEnabled('edit.pastePlain', h.ctx)).toBe(true);
    actions.setRunLock(h.store, fakeRunLock());
    expect(h.services.commands.isEnabled('edit.pastePlain', h.ctx)).toBe(false);
    expect(h.services.commands.isEnabled('edit.paste', h.ctx)).toBe(false);
  });

  it('has the default key Mod+Shift+V in both hotkey tables', () => {
    expect(DEFAULT_HOTKEYS.find((e) => e.commandId === 'edit.pastePlain')?.keys).toBe(
      'Mod+Shift+V',
    );
    expect(FBE_DEFAULT_HOTKEYS.find((e) => e.commandId === 'edit.pastePlain')?.group).toBe('edit');
  });
});
