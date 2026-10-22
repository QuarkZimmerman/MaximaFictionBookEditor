/**
 * Toolbar layouts (feature 002 FR-062, FR-063): the original layouts are the defaults; a stored
 * layout shows only the items its toolbar offers (no unknown commands, no buttons of scripts
 * that are gone, each button once); a change is stored per toolbar at once, `null` returns a
 * toolbar to its original layout, and what the core reports for an earlier change never undoes
 * a later one.
 */

import { describe, expect, it } from 'vitest';

import { COMMANDS_TOOLBAR } from '@/app/toolbarDefinitions';
import {
  availableButtons,
  LAST_SCRIPT,
  originalLayout,
  saveLayout,
  SEPARATOR,
  shownLayout,
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
    // The original's 31 buttons plus the AI assistant's (feature 005, research R8.6).
    expect(availableButtons('commands')).toHaveLength(32);
    expect(availableButtons('commands')).not.toContain(SEPARATOR);
    expect(availableButtons('commands')).toContain('ai.toggle');
    expect(availableButtons('scripts', SCRIPTS)).toEqual([LAST_SCRIPT, ...SCRIPTS]);
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
