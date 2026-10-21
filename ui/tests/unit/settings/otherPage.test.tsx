/**
 * Settings > Other, the "Open File" group's keyboard layout option (feature 004 US11, FR-090,
 * FR-091; data-model §11.2): the list of the system's layouts read through
 * `system.keyboardLayouts` when the dialog opens, the current one preselected, id and name
 * stored together on OK; a stored layout the system no longer lists shown as "(not installed)"
 * and kept until another is picked; `supported: false` (a Wayland session, no shell) - and a
 * core without the method - disabling the two controls under the note while the rest of the
 * group works; the controls disabled without a note while the list loads. The pure choice
 * helper is covered on its own.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { createCommandRegistry } from '@/app/commands';
import { HotkeyMap } from '@/app/hotkeys';
import { SettingsDialog } from '@/dialogs/SettingsDialog';
import { keyboardLayoutChoice } from '@/dialogs/settings/model';
import { registerSettingsRuntime } from '@/features/settings/apply';
import { changeLanguage, initI18n } from '@/i18n';
import { actions } from '@/model/store';
import type { KeyboardLayoutList, Settings } from '@/rpc/types';

import {
  fakeRpc,
  makeContext,
  rpcError,
  type FakeRpc,
  type Responder,
} from '../features/testUtils';

import { defaultSettings, mergeSettings } from './fixtures';

const SEED: KeyboardLayoutList = {
  supported: true,
  layouts: [
    { id: 'test-en', name: 'English (United States)' },
    { id: 'test-ru', name: 'Russian' },
  ],
  current: 'test-en',
};

async function setup(options: {
  layouts?: Responder;
  other?: Partial<Settings['other']>;
  language?: 'en' | 'ru' | 'uk';
}) {
  await initI18n({ language: options.language ?? 'en' });
  await changeLanguage(options.language ?? 'en');
  let current = defaultSettings();
  current = { ...current, other: { ...current.other, ...(options.other ?? {}) } };
  const responses: Record<string, Responder> = {
    'settings.get': () => current,
    'settings.set': (params: unknown) => {
      current = mergeSettings(current, (params as { patch: unknown }).patch);
      return { settings: current, restartRequired: false };
    },
    'hotkeys.get': [],
    'hotkeys.set': { collisions: [] },
    'resources.genres': { effectiveSources: [], issues: [] },
  };
  if (options.layouts !== undefined) responses['system.keyboardLayouts'] = options.layouts;
  const rpc = fakeRpc(responses);
  const ctx = await makeContext({ rpc: rpc.client, hotkeys: new HotkeyMap('linux') });
  actions.setConnection(ctx.store, 'connected');
  actions.setSettings(ctx.store, current);
  const feature = registerSettingsRuntime(
    { store: ctx.store, hotkeys: ctx.hotkeys, commands: createCommandRegistry() },
    { root: document.createElement('div'), window: null, search: '' },
  );
  await feature.attach(rpc.client);
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<SettingsDialog ctx={ctx} feature={feature} onClose={onClose} initialPage="other" />);
  await screen.findByTestId('settings-page-other');
  return { ctx, rpc, user, onClose, current: () => current };
}

function patches(rpc: FakeRpc): Record<string, unknown>[] {
  return rpc.calls
    .filter((call) => call.method === 'settings.set')
    .map((call) => (call.params as { patch: Record<string, unknown> }).patch);
}

function optionTexts(select: HTMLElement): [string | null, string | null][] {
  return within(select)
    .getAllByRole('option')
    .map((option) => [option.getAttribute('value'), option.textContent]);
}

describe('Settings > Other - the keyboard layout option (feature 004 US11)', () => {
  it('lists the system layouts with the current one preselected, off by default, and stores id and name on OK', async () => {
    const { rpc, user, onClose, current } = await setup({ layouts: SEED });
    const group = screen.getByTestId('settings-other-open-file');
    expect(within(group).getByTestId('settings-other-restore-position')).toBeInTheDocument();
    expect(group).toHaveTextContent('Restore Position');
    expect(group).toHaveTextContent('Switch keyboard layout when a document is opened');
    expect(group).toHaveTextContent('Layout:');
    const checkbox = screen.getByTestId('settings-other-switch-layout');
    const select = screen.getByTestId('settings-other-layout');
    expect(checkbox).not.toBeChecked();
    await waitFor(() => expect(select).toBeEnabled());
    expect(checkbox).toBeEnabled();
    expect(optionTexts(select)).toEqual([
      ['test-en', 'English (United States)'],
      ['test-ru', 'Russian'],
    ]);
    expect(select).toHaveValue('test-en'); // the current layout
    expect(screen.queryByTestId('settings-other-layout-note')).not.toBeInTheDocument();
    // The list is read when the dialog opens, once.
    expect(rpc.calls.filter((c) => c.method === 'system.keyboardLayouts')).toHaveLength(1);

    await user.selectOptions(select, 'test-ru');
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    await user.click(screen.getByTestId('dialog-settings-button-ok'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(patches(rpc)).toEqual([
      {
        other: {
          switchKeyboardLayout: true,
          keyboardLayoutId: 'test-ru',
          keyboardLayoutName: 'Russian',
        },
      },
    ]);
    expect(current().other).toMatchObject({
      switchKeyboardLayout: true,
      keyboardLayoutId: 'test-ru',
      keyboardLayoutName: 'Russian',
    });
    // Nothing is activated from the dialog: the switch waits for the next document opened.
    expect(rpc.calls.map((c) => c.method)).not.toContain('system.activateKeyboardLayout');
  });

  it('ticking the option without a stored choice adopts the layout shown in the list', async () => {
    const { rpc, user, onClose } = await setup({ layouts: SEED });
    const select = screen.getByTestId('settings-other-layout');
    await waitFor(() => expect(select).toBeEnabled());
    await user.click(screen.getByTestId('settings-other-switch-layout'));
    await user.click(screen.getByTestId('dialog-settings-button-ok'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(patches(rpc)).toEqual([
      {
        other: {
          switchKeyboardLayout: true,
          keyboardLayoutId: 'test-en',
          keyboardLayoutName: 'English (United States)',
        },
      },
    ]);
  });

  it('shows a stored layout the system no longer lists as not installed and keeps it until another is picked', async () => {
    const { rpc, user, onClose } = await setup({
      layouts: { supported: true, layouts: [SEED.layouts[0]!], current: 'test-en' },
      other: {
        switchKeyboardLayout: true,
        keyboardLayoutId: 'test-ru',
        keyboardLayoutName: 'Russian',
      },
    });
    const select = screen.getByTestId('settings-other-layout');
    await waitFor(() => expect(select).toBeEnabled());
    expect(optionTexts(select)).toEqual([
      ['test-en', 'English (United States)'],
      ['test-ru', 'Russian (not installed)'],
    ]);
    expect(select).toHaveValue('test-ru');
    expect(screen.getByTestId('settings-other-switch-layout')).toBeChecked();
    expect(screen.queryByTestId('settings-other-layout-note')).not.toBeInTheDocument();

    // Cancel: the choice is kept as stored, nothing is written.
    await user.click(screen.getByTestId('dialog-settings-button-cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(patches(rpc)).toEqual([]);
  });

  it('a stored id without a name is shown by its id; picking the installed layout replaces it', async () => {
    const { rpc, user, onClose } = await setup({
      layouts: SEED,
      other: { switchKeyboardLayout: true, keyboardLayoutId: '00000407', keyboardLayoutName: '' },
    });
    const select = screen.getByTestId('settings-other-layout');
    await waitFor(() => expect(select).toBeEnabled());
    expect(optionTexts(select)).toEqual([
      ['test-en', 'English (United States)'],
      ['test-ru', 'Russian'],
      ['00000407', '00000407 (not installed)'],
    ]);
    expect(select).toHaveValue('00000407');
    await user.selectOptions(select, 'test-ru');
    // The extra entry goes as soon as a listed layout is chosen.
    expect(optionTexts(select)).toEqual([
      ['test-en', 'English (United States)'],
      ['test-ru', 'Russian'],
    ]);
    await user.click(screen.getByTestId('dialog-settings-button-ok'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(patches(rpc)).toEqual([
      { other: { keyboardLayoutId: 'test-ru', keyboardLayoutName: 'Russian' } },
    ]);
  });

  it.each([
    ['a Wayland session', { supported: false, reason: 'wayland', layouts: [] } as Responder],
    ['no shell', { supported: false, reason: 'noShell', layouts: [] } as Responder],
    ['a core without the method', rpcError(-32601, 'Method not found') as Responder],
  ])(
    'with %s the controls are disabled under the note, the stored values stay and the rest of the group works',
    async (_label, layouts) => {
      const { rpc, user, onClose, current } = await setup({
        layouts,
        other: {
          switchKeyboardLayout: true,
          keyboardLayoutId: 'test-ru',
          keyboardLayoutName: 'Russian',
        },
      });
      const note = await screen.findByTestId('settings-other-layout-note');
      expect(note).toHaveTextContent('The system offers no way to switch the layout');
      expect(note).toHaveClass('mfbe-settings-note');
      const checkbox = screen.getByTestId('settings-other-switch-layout');
      const select = screen.getByTestId('settings-other-layout');
      expect(checkbox).toBeDisabled();
      expect(checkbox).toBeChecked(); // the stored value, untouched
      expect(select).toBeDisabled();
      expect(optionTexts(select)).toEqual([['test-ru', 'Russian']]);

      await user.click(screen.getByTestId('settings-other-restore-position'));
      await user.click(screen.getByTestId('dialog-settings-button-ok'));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(patches(rpc)).toEqual([{ other: { restorePosition: false } }]);
      expect(current().other).toMatchObject({
        switchKeyboardLayout: true,
        keyboardLayoutId: 'test-ru',
        keyboardLayoutName: 'Russian',
      });
    },
  );

  it('while the list loads the controls are disabled without a note', async () => {
    let answer: ((list: KeyboardLayoutList) => void) | null = null;
    const pending = new Promise<KeyboardLayoutList>((resolve) => {
      answer = resolve;
    });
    await setup({ layouts: () => pending });
    const checkbox = screen.getByTestId('settings-other-switch-layout');
    const select = screen.getByTestId('settings-other-layout');
    expect(checkbox).toBeDisabled();
    expect(select).toBeDisabled();
    expect(screen.queryByTestId('settings-other-layout-note')).not.toBeInTheDocument();
    answer!(SEED);
    await waitFor(() => expect(select).toBeEnabled());
    expect(checkbox).toBeEnabled();
    expect(select).toHaveValue('test-en');
  });

  it('shows the Russian and Ukrainian texts', async () => {
    const { user } = await setup({
      layouts: { supported: true, layouts: [SEED.layouts[0]!], current: 'test-en' },
      other: {
        switchKeyboardLayout: true,
        keyboardLayoutId: 'test-ru',
        keyboardLayoutName: 'Russian',
      },
      language: 'ru',
    });
    const group = screen.getByTestId('settings-other-open-file');
    expect(group).toHaveTextContent('Опции открытия');
    expect(group).toHaveTextContent('Менять раскладку клавиатуры при открытии документа');
    expect(group).toHaveTextContent('Раскладка:');
    const select = screen.getByTestId('settings-other-layout');
    await waitFor(() => expect(select).toBeEnabled());
    expect(optionTexts(select)).toContainEqual(['test-ru', 'Russian (не установлена)']);
    await user.click(screen.getByTestId('dialog-settings-button-cancel'));
  });
});

describe('keyboardLayoutChoice (model)', () => {
  it('loading or unsupported: only the stored choice, not ready', () => {
    expect(keyboardLayoutChoice(null, '', '')).toEqual({ options: [], shownId: '', ready: false });
    expect(keyboardLayoutChoice(null, 'test-ru', 'Russian')).toEqual({
      options: [{ id: 'test-ru', name: 'Russian', notInstalled: false }],
      shownId: 'test-ru',
      ready: false,
    });
    expect(
      keyboardLayoutChoice({ supported: false, reason: 'wayland', layouts: [] }, 'x', ''),
    ).toEqual({
      options: [{ id: 'x', name: 'x', notInstalled: false }],
      shownId: 'x',
      ready: false,
    });
  });

  it('supported: the list, the stored id or current or the first shown, a missing id appended', () => {
    expect(keyboardLayoutChoice(SEED, '', '')).toMatchObject({ shownId: 'test-en', ready: true });
    expect(keyboardLayoutChoice({ ...SEED, current: undefined }, '', '')).toMatchObject({
      shownId: 'test-en',
    });
    expect(keyboardLayoutChoice({ ...SEED, current: 'gone' }, '', '')).toMatchObject({
      shownId: 'test-en',
    });
    expect(keyboardLayoutChoice(SEED, 'test-ru', 'Russian')).toMatchObject({ shownId: 'test-ru' });
    expect(keyboardLayoutChoice(SEED, 'test-de', 'German')).toEqual({
      options: [
        { id: 'test-en', name: 'English (United States)', notInstalled: false },
        { id: 'test-ru', name: 'Russian', notInstalled: false },
        { id: 'test-de', name: 'German', notInstalled: true },
      ],
      shownId: 'test-de',
      ready: true,
    });
    // A system with one layout only: the one entry.
    expect(keyboardLayoutChoice({ supported: true, layouts: [SEED.layouts[1]!] }, '', '')).toEqual({
      options: [{ id: 'test-ru', name: 'Russian', notInstalled: false }],
      shownId: 'test-ru',
      ready: true,
    });
    // An empty but supported list: nothing to show, nothing selected.
    expect(keyboardLayoutChoice({ supported: true, layouts: [] }, '', '')).toEqual({
      options: [],
      shownId: '',
      ready: true,
    });
  });
});
