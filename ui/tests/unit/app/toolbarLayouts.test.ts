/**
 * Toolbar layouts (feature 002 FR-062, FR-063): the original layouts are the defaults; a stored
 * layout shows only the items its toolbar offers (no unknown commands, no buttons of scripts
 * that are gone, each button once); a change is stored per toolbar at once, `null` returns a
 * toolbar to its original layout, and what the core reports for an earlier change never undoes
 * a later one.
 */

import { describe, expect, it } from 'vitest';

import { COMMANDS_TOOLBAR, COMMANDS_TOOLBAR_OFFERED } from '@/app/toolbarDefinitions';
import {
  availableButtons,
  LAST_SCRIPT,
  originalLayout,
  saveLayout,
  SEPARATOR,
  shownLayout,
  withHiddenItems,
} from '@/app/toolbarLayouts';
import { actions, createAppStore } from '@/model/store';

import { fakeRpc } from '../features/testUtils';
import { defaultSettings } from '../settings/fixtures';

const SCRIPTS = ['script.a', 'script.b'];

function settingsWith(layouts: Record<string, string[]>) {
  const settings = defaultSettings();
  settings.session.toolbarLayouts = layouts;
  return settings;
}

describe('toolbar layouts', () => {
  it('starts from the original layouts: the Commands toolbar, "Last script" alone', () => {
    expect(originalLayout('commands')).toEqual(COMMANDS_TOOLBAR.map((id) => id ?? SEPARATOR));
    expect(originalLayout('scripts')).toEqual([LAST_SCRIPT]);
    expect(shownLayout(null, 'commands')).toEqual(originalLayout('commands'));
    expect(shownLayout(defaultSettings(), 'scripts', SCRIPTS)).toEqual([LAST_SCRIPT]);
  });

  it('offers the original buttons, and "Last script" with the scripts that have an icon', () => {
    // The original's 31 buttons plus the AI assistant's (feature 005, research R8.6), then
    // Table... and the 24 table commands (feature 006, FR-041).
    expect(availableButtons('commands')).toHaveLength(57);
    expect(availableButtons('commands')).not.toContain(SEPARATOR);
    expect(availableButtons('commands')).toContain('ai.toggle');
    expect(availableButtons('commands').slice(0, 32)).toEqual(
      COMMANDS_TOOLBAR.filter((id) => id !== null),
    );
    expect(availableButtons('commands').slice(32)).toEqual(COMMANDS_TOOLBAR_OFFERED);
    expect(availableButtons('scripts', SCRIPTS)).toEqual([LAST_SCRIPT, ...SCRIPTS]);
  });

  it('offers Table... and the 24 table buttons, none of them in the original layout (feature 006)', async () => {
    expect(COMMANDS_TOOLBAR_OFFERED).toHaveLength(25);
    expect(COMMANDS_TOOLBAR_OFFERED[0]).toBe('insert.table');
    expect(COMMANDS_TOOLBAR_OFFERED.slice(1).every((id) => id.startsWith('table.'))).toBe(true);
    const original = originalLayout('commands');
    for (const id of COMMANDS_TOOLBAR_OFFERED) expect(original, id).not.toContain(id);
    // Not shown by default...
    expect(shownLayout(null, 'commands')).toEqual(original);
    expect(shownLayout(defaultSettings(), 'commands')).toEqual(original);
    // ...shown once the user stored it (the format is unchanged), dropped again by Reset.
    const store = createAppStore();
    actions.setSettings(store, settingsWith({}));
    const rpc = fakeRpc({ 'settings.set': {} });
    const layout = ['file.new', 'table.mergeCells', '-', 'insert.table'];
    await saveLayout({ store, rpc: rpc.client }, 'commands', layout);
    expect(shownLayout(store.getState().settings, 'commands')).toEqual(layout);
    await saveLayout({ store, rpc: rpc.client }, 'commands', null); // Reset
    expect(shownLayout(store.getState().settings, 'commands')).not.toContain('table.mergeCells');
    expect(shownLayout(store.getState().settings, 'commands')).toEqual(original);
  });

  it('puts the AI assistant button after the view buttons of the original layout', () => {
    // A customised layout stored before the button existed does not gain it by itself.
    const original = originalLayout('commands');
    expect(original.indexOf('ai.toggle')).toBe(original.indexOf('view.source') + 1);
    expect(original[original.indexOf('ai.toggle') + 1]).toBe(SEPARATOR);
    const stored = settingsWith({ commands: ['view.body', 'view.source', '-', 'file.save'] });
    expect(shownLayout(stored, 'commands')).toEqual(['view.body', 'view.source', '-', 'file.save']);
  });

  it('shows only what the toolbar offers, each button once', () => {
    const settings = settingsWith({
      commands: ['file.save', 'no.such.command', '-', 'file.save', 'script.a', '-'],
      scripts: ['script.gone', 'script.b', LAST_SCRIPT, 'file.new', 'script.b', '-'],
    });
    expect(shownLayout(settings, 'commands', SCRIPTS)).toEqual(['file.save', '-', '-']);
    expect(shownLayout(settings, 'scripts', SCRIPTS)).toEqual(['script.b', LAST_SCRIPT, '-']);
    // Before the catalogue is loaded no script is offered: its buttons wait.
    expect(shownLayout(settings, 'scripts')).toEqual([LAST_SCRIPT, '-']);
  });

  it('puts the hidden items of a layout back into an edited copy of its visible part (feature 005 US9)', () => {
    // The AI assistant's button while the assistant is disabled: neither the toolbar nor the
    // Customize dialog shows it, yet the stored layout keeps it after every edit, so it is
    // back in its place when the assistant is enabled again (FR-096, FR-097).
    const hidden = (item: string) => item === 'ai.toggle' || item === 'ai.other';
    const stored = ['file.new', 'view.body', 'view.source', 'ai.toggle', '-', 'edit.find'];
    const visible = stored.filter((item) => !hidden(item));
    expect(visible).toEqual(['file.new', 'view.body', 'view.source', '-', 'edit.find']);
    // Unchanged visible part: the stored layout as it was.
    expect(withHiddenItems(stored, visible, hidden)).toEqual(stored);
    // A button added before the anchor, a separator added after it: the hidden item follows
    // its anchor (the nearest button before it).
    expect(withHiddenItems(stored, ['file.save', ...visible], hidden)[4]).toBe('ai.toggle');
    expect(
      withHiddenItems(
        stored,
        ['file.new', 'view.body', 'view.source', '-', '-', 'edit.find'],
        hidden,
      ),
    ).toEqual(['file.new', 'view.body', 'view.source', 'ai.toggle', '-', '-', 'edit.find']);
    // The anchor moved: the hidden item moves with it.
    expect(
      withHiddenItems(stored, ['view.source', 'file.new', 'view.body', '-', 'edit.find'], hidden),
    ).toEqual(['view.source', 'ai.toggle', 'file.new', 'view.body', '-', 'edit.find']);
    // The anchor removed: the next button before it is the anchor.
    expect(withHiddenItems(stored, ['file.new', 'view.body', '-', 'edit.find'], hidden)).toEqual([
      'file.new',
      'view.body',
      'ai.toggle',
      '-',
      'edit.find',
    ]);
    // No button before it any more: it leads the layout; several hidden items keep their order.
    const leading = ['ai.toggle', 'ai.other', 'file.new', '-'];
    expect(withHiddenItems(leading, ['-', 'file.open'], hidden)).toEqual([
      'ai.toggle',
      'ai.other',
      '-',
      'file.open',
    ]);
    expect(withHiddenItems(['file.new', 'ai.toggle', 'ai.other', '-'], ['-'], hidden)).toEqual([
      'ai.toggle',
      'ai.other',
      '-',
    ]);
    // A layout without hidden items is the edited one; an edited list already holding the
    // item (a stale caller) gets no second copy.
    expect(withHiddenItems(['file.new', '-'], ['-', 'file.new'], hidden)).toEqual([
      '-',
      'file.new',
    ]);
    expect(withHiddenItems(stored, [...visible, 'ai.toggle'], hidden)).toEqual([
      ...visible,
      'ai.toggle',
    ]);
  });

  it('keeps the shown layout while a later change is on its way to the core', async () => {
    const store = createAppStore();
    actions.setSettings(store, settingsWith({}));
    const answers: (() => void)[] = [];
    const rpc = fakeRpc({
      'settings.set': () => new Promise((resolve) => answers.push(() => resolve({}))),
    });
    const first = saveLayout({ store, rpc: rpc.client }, 'commands', ['file.new']);
    const second = saveLayout({ store, rpc: rpc.client }, 'commands', ['file.open']);
    // The core reports the first change while the second is on its way: the second stays.
    actions.setSettings(store, settingsWith({ commands: ['file.new'] }));
    expect(store.getState().settings?.session.toolbarLayouts.commands).toEqual(['file.open']);
    answers[0]!();
    await first;
    actions.setSettings(store, settingsWith({ commands: ['file.open'] }));
    answers[1]!();
    await second;
    expect(store.getState().layoutSavesPending).toBe(0);
    // With no change on its way, the core's settings apply as they are.
    actions.setSettings(store, settingsWith({ commands: ['file.save'] }));
    expect(store.getState().settings?.session.toolbarLayouts.commands).toEqual(['file.save']);
  });

  it('stores a layout per toolbar at once; null restores the original', async () => {
    const store = createAppStore();
    actions.setSettings(store, settingsWith({ scripts: [LAST_SCRIPT, 'script.a'] }));
    const rpc = fakeRpc({ 'settings.set': {} });
    await saveLayout({ store, rpc: rpc.client }, 'commands', ['file.new', '-']);
    expect(store.getState().settings?.session.toolbarLayouts).toEqual({
      scripts: [LAST_SCRIPT, 'script.a'],
      commands: ['file.new', '-'],
    });
    await saveLayout({ store, rpc: rpc.client }, 'scripts', null);
    expect(store.getState().settings?.session.toolbarLayouts).toEqual({
      commands: ['file.new', '-'],
    });
    expect(rpc.calls).toEqual([
      {
        method: 'settings.set',
        params: { patch: { session: { toolbarLayouts: { commands: ['file.new', '-'] } } } },
      },
      {
        method: 'settings.set',
        params: { patch: { session: { toolbarLayouts: { scripts: null } } } },
      },
    ]);
  });
});
