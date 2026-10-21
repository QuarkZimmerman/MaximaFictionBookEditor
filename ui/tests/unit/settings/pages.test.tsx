/**
 * Settings dialog pages (T128): field <-> settings mapping, range validation (`jpegQuality`
 * 1-100, `bodyFontSize` 6-96), the restart prompt and the restart flow of feature 003 US3
 * (`app.restart` with the open document's path after the save prompt; the page reload of
 * browser mode on 1070; the failure message on 1071), the Hotkeys page collision / reserved /
 * default flows against a `HotkeyMap`, and the Words page exclusion-list validation.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { createCommandRegistry, type CommandContext } from '@/app/commands';
import { HotkeyMap } from '@/app/hotkeys';
import { SettingsDialog, type SettingsPageId } from '@/dialogs/SettingsDialog';
import { installBodyEditor } from '@/features/editing';
import { registerSettingsRuntime, type SettingsFeature } from '@/features/settings/apply';
import { changeLanguage, initI18n } from '@/i18n';
import { actions } from '@/model/store';
import type { Settings } from '@/rpc/types';

import {
  fakeDocument,
  fakeRpc,
  makeContext,
  rpcError,
  type FakeDialogs,
  type FakeRpc,
  type Responder,
} from '../features/testUtils';

import { defaultSettings, mergeSettings } from './fixtures';

interface Harness {
  ctx: CommandContext & { dialogs: FakeDialogs };
  rpc: FakeRpc;
  feature: SettingsFeature;
  root: HTMLElement;
  onClose: ReturnType<typeof vi.fn>;
  user: ReturnType<typeof userEvent.setup>;
  current: () => Settings;
  reloads: string[];
}

async function setup(
  options: {
    page?: SettingsPageId;
    settings?: Settings;
    restartOnLanguage?: boolean;
    /** Extra RPC answers (`app.restart`, `doc.save`...). */
    responses?: Record<string, Responder>;
  } = {},
): Promise<Harness> {
  await initI18n({ language: 'en' });
  await changeLanguage('en');
  let current = options.settings ?? defaultSettings();
  const rpc = fakeRpc({
    ...(options.responses ?? {}),
    'settings.get': () => current,
    'settings.set': (params: unknown) => {
      const before = current.view.uiLanguage;
      current = mergeSettings(current, (params as { patch: unknown }).patch);
      return {
        settings: current,
        restartRequired: (options.restartOnLanguage ?? true) && current.view.uiLanguage !== before,
      };
    },
    'hotkeys.get': [],
    'hotkeys.set': { collisions: [] },
    'resources.genres': {
      effectiveSources: [
        { source: 'standard', path: '', entries: 186 },
        {
          source: 'bundled:10-fbe-legacy.genres.tsv',
          path: '/res/10-fbe-legacy.genres.tsv',
          layer: 'bundled',
          entries: 7,
        },
      ],
      issues: [],
    },
    'words.exclusions': (params: unknown) => {
      const p = (params ?? {}) as { add?: string[]; remove?: string[] };
      exclusions = [...exclusions.filter((w) => !(p.remove ?? []).includes(w)), ...(p.add ?? [])];
      return { words: exclusions };
    },
  });
  let exclusions = ['alpha', 'beta-gamma'];
  const ctx = await makeContext({ rpc: rpc.client, hotkeys: new HotkeyMap('linux') });
  actions.setConnection(ctx.store, 'connected');
  actions.setSettings(ctx.store, current);
  const commands = createCommandRegistry();
  const root = document.createElement('div');
  const feature = registerSettingsRuntime(
    { store: ctx.store, hotkeys: ctx.hotkeys, commands },
    { root, window: null, search: '' },
  );
  await feature.attach(rpc.client);
  const onClose = vi.fn();
  const user = userEvent.setup();
  const reloads: string[] = [];
  render(
    <SettingsDialog
      ctx={ctx}
      feature={feature}
      onClose={onClose}
      initialPage={options.page}
      reloadPage={(url) => reloads.push(url)}
    />,
  );
  await screen.findByTestId('settings-page-view');
  return { ctx, rpc, feature, root, onClose, user, current: () => current, reloads };
}

function settingsSetCalls(rpc: FakeRpc): { patch: Record<string, unknown> }[] {
  return rpc.calls
    .filter((call) => call.method === 'settings.set')
    .map((call) => call.params as { patch: Record<string, unknown> });
}

describe('SettingsDialog - View / Other / Words mapping', () => {
  it('shows the four pages and sends one patch with the changed leaves on OK', async () => {
    const { rpc, user, onClose, ctx, root } = await setup();
    for (const page of ['view', 'other', 'hotkeys', 'words']) {
      expect(screen.getByTestId(`settings-tab-${page}`)).toBeInTheDocument();
    }

    // View page: body font / size / colour, a source option, spelling.
    await user.clear(screen.getByTestId('settings-view-body-font'));
    await user.type(screen.getByTestId('settings-view-body-font'), 'Arial');
    fireEvent.change(screen.getByTestId('settings-view-body-font-size'), {
      target: { value: '18' },
    });
    fireEvent.change(screen.getByTestId('settings-view-text-color'), {
      target: { value: '#112233' },
    });
    await user.click(screen.getByTestId('settings-view-source-line-numbers'));
    await user.click(screen.getByTestId('settings-view-spell-enabled'));
    await user.click(screen.getByTestId('settings-view-fast-mode'));

    // Other page.
    await user.click(screen.getByTestId('settings-tab-other'));
    await user.selectOptions(screen.getByTestId('settings-other-encoding'), 'windows-1251');
    await user.click(screen.getByTestId('settings-other-keep-encoding'));
    await user.click(screen.getByTestId('settings-other-restore-position'));
    await user.selectOptions(screen.getByTestId('settings-other-image-format'), 'png');
    fireEvent.change(screen.getByTestId('settings-other-jpeg-quality'), {
      target: { value: '75' },
    });
    await user.selectOptions(screen.getByTestId('settings-other-nbsp'), '\u25A1');
    await user.click(screen.getByTestId('settings-other-ask-non-clear'));
    await user.click(screen.getByTestId('settings-other-insert-clear'));
    // Custom scripts folder: untick "Default folder" and type a path.
    await user.click(screen.getByTestId('settings-other-scripts-default'));
    await user.type(screen.getByTestId('settings-other-scripts-path'), '/tmp/scripts');
    await waitFor(() =>
      expect(screen.getByTestId('settings-other-genre-sources')).toHaveTextContent(
        'standard list (186)',
      ),
    );
    expect(screen.getByTestId('settings-other-genre-sources')).toHaveTextContent(
      '10-fbe-legacy.genres.tsv from the bundled layer (7)',
    );

    // Words page.
    await user.click(screen.getByTestId('settings-tab-words'));
    await user.click(screen.getByTestId('settings-words-show-exclusions'));

    await user.click(screen.getByTestId('dialog-settings-button-ok'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const calls = settingsSetCalls(rpc);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.patch).toEqual({
      view: {
        bodyFont: 'Arial',
        bodyFontSize: 18,
        bodyTextColor: '#112233',
        sourceLineNumbers: false,
        spellEnabled: false,
        fastMode: true,
      },
      other: {
        defaultEncoding: 'windows-1251',
        keepEncoding: true,
        restorePosition: false,
        pasteImageFormat: 'png',
        jpegQuality: 75,
        nbspDisplayChar: '\u25A1',
        askOnNonClearImage: false,
        insertClearImages: true,
        scriptsFolder: '/tmp/scripts',
      },
      words: { showExclusionsInWordsDialog: true },
    });
    // The store got the new settings and the Body CSS variables follow (T133).
    const state = ctx.store.getState();
    expect(state.settings?.view.bodyFont).toBe('Arial');
    expect(state.fastMode).toBe(true);
    expect(root.style.getPropertyValue('--mfbe-body-font-family')).toBe('Arial');
    expect(root.style.getPropertyValue('--mfbe-body-font-size')).toBe('18px');
    expect(root.style.getPropertyValue('--mfbe-body-fg')).toBe('#112233');
  });

  it('offers System / Light / Dark themes and applies the choice on OK', async () => {
    const { rpc, user, onClose, ctx, root } = await setup();
    const select = screen.getByTestId('settings-view-theme');
    expect(select).toHaveValue('system');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['System', 'Light', 'Dark']);
    // The colour pickers explain that black on white means "theme colours".
    expect(screen.getByTestId('settings-view-colors-hint')).toHaveTextContent(/follows the theme/);
    expect(root.dataset.theme).toBe('light'); // jsdom has no matchMedia: system = light

    await user.selectOptions(select, 'dark');
    expect(select).toHaveValue('dark');
    expect(root.dataset.theme).toBe('light'); // the draft is not applied before OK / Apply

    await user.click(screen.getByTestId('dialog-settings-button-ok'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const calls = settingsSetCalls(rpc);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.patch).toEqual({ view: { theme: 'dark' } });
    expect(ctx.store.getState().settings?.view.theme).toBe('dark');
    // Applied at once, no restart: the runtime wrote the theme on the root.
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
    // The default Body colours are not written as overrides (the theme palette applies).
    expect(root.style.getPropertyValue('--mfbe-body-fg')).toBe('');
    expect(root.style.getPropertyValue('--mfbe-body-bg')).toBe('');
  });

  it('offers the five version-check schedules (feature 003 US5) and applies the choice on OK', async () => {
    const { rpc, user, onClose, ctx } = await setup({ page: 'other' });
    const select = screen.getByTestId('settings-other-version-check');
    // The default: once a month (FR-040), for new and for older settings files alike.
    expect(select).toHaveValue('monthly');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => [o.getAttribute('value'), o.textContent]),
    ).toEqual([
      ['everyStart', 'at every start'],
      ['daily', 'once a day'],
      ['weekly', 'once a week'],
      ['monthly', 'once a month'],
      ['never', 'never'],
    ]);
    expect(screen.getByText('Version check')).toBeInTheDocument();

    await user.selectOptions(select, 'never');
    expect(select).toHaveValue('never');
    await user.click(screen.getByTestId('dialog-settings-button-ok'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const calls = settingsSetCalls(rpc);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.patch).toEqual({ other: { versionCheck: 'never' } });
    expect(ctx.store.getState().settings?.other.versionCheck).toBe('never');
  });

  it('Cancel discards the draft without calling settings.set', async () => {
    const { rpc, user, onClose } = await setup();
    await user.type(screen.getByTestId('settings-view-body-font'), 'Georgia');
    await user.click(screen.getByTestId('dialog-settings-button-cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(settingsSetCalls(rpc)).toHaveLength(0);
  });

  it('rejects jpegQuality outside 1-100 and bodyFontSize outside 6-96', async () => {
    const { rpc, user, onClose } = await setup({ page: 'other' });
    const quality = screen.getByTestId('settings-other-jpeg-quality');
    fireEvent.change(quality, { target: { value: '0' } });
    await user.click(screen.getByTestId('dialog-settings-button-ok'));
    const errors = await screen.findByTestId('settings-errors');
    expect(
      within(errors).getByText(/JPEG quality must be a whole number between 1 and 100/),
    ).toBeInTheDocument();
    expect(errors.querySelector('[data-field="other.jpegQuality"]')).not.toBeNull();
    expect(settingsSetCalls(rpc)).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.change(quality, { target: { value: '101' } });
    await user.click(screen.getByTestId('dialog-settings-button-apply'));
    expect(screen.getByTestId('settings-errors')).toBeInTheDocument();
    expect(settingsSetCalls(rpc)).toHaveLength(0);

    await user.click(screen.getByTestId('settings-tab-view'));
    fireEvent.change(screen.getByTestId('settings-view-body-font-size'), {
      target: { value: '5' },
    });
    fireEvent.change(quality, { target: { value: '100' } });
    await user.click(screen.getByTestId('dialog-settings-button-apply'));
    expect(
      screen.getByTestId('settings-errors').querySelector('[data-field="view.bodyFontSize"]'),
    ).not.toBeNull();
    expect(settingsSetCalls(rpc)).toHaveLength(0);

    fireEvent.change(screen.getByTestId('settings-view-body-font-size'), {
      target: { value: '96' },
    });
    await user.click(screen.getByTestId('dialog-settings-button-apply'));
    await waitFor(() => expect(settingsSetCalls(rpc)).toHaveLength(1));
    expect(settingsSetCalls(rpc)[0]!.patch).toEqual({
      view: { bodyFontSize: 96 },
      other: { jpegQuality: 100 },
    });
    expect(screen.queryByTestId('settings-errors')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled(); // Apply keeps the dialog open
  });

  it('shows the restart prompt when the core reports restartRequired (language change)', async () => {
    const { ctx, user, onClose, rpc } = await setup();
    ctx.dialogs.messageAnswers.push('no');
    await user.selectOptions(screen.getByTestId('settings-view-language'), 'ru');
    await user.click(screen.getByTestId('dialog-settings-button-ok'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await waitFor(() => expect(ctx.dialogs.shown).toHaveLength(1));
    // The prompt is shown in the language that was just selected (Russian here).
    expect(ctx.dialogs.shown[0]!.text).toMatch(/must be restarted|перезагрузки программы/i);
    expect(ctx.dialogs.shown[0]!.buttons).toBe('yesNo');
    // "No": the application keeps running (nothing is restarted or quit).
    expect(ctx.store.getState().settings?.view.uiLanguage).toBe('ru');
    expect(rpc.calls.map((c) => c.method)).not.toContain('app.restart');
    expect(rpc.calls.map((c) => c.method)).not.toContain('app.quit');
  });
});

/** The restart flow of feature 003 US3 (rpc-api.md §3.1 app.restart). */
describe('SettingsDialog - "Restart now?" restarts the editor', () => {
  const restartCalls = (rpc: FakeRpc) => rpc.calls.filter((c) => c.method === 'app.restart');

  /** Yes in the restart prompt; `thenAnswer` answers the save prompt that may follow. */
  async function chooseLanguageAndAnswerYes(harness: Harness, thenAnswer?: 'no' | 'cancel') {
    const { ctx, user, onClose } = harness;
    ctx.dialogs.messageAnswers.push('yes');
    if (thenAnswer) ctx.dialogs.messageAnswers.push(thenAnswer);
    await user.selectOptions(screen.getByTestId('settings-view-language'), 'ru');
    await user.click(screen.getByTestId('dialog-settings-button-ok'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  }

  it('Yes with a saved book asks the shell to restart with that book', async () => {
    const harness = await setup({ responses: { 'app.restart': {} } });
    actions.setDocument(harness.ctx.store, fakeDocument({ path: '/books/книга.fb2' }));
    await chooseLanguageAndAnswerYes(harness);
    await waitFor(() => expect(restartCalls(harness.rpc)).toHaveLength(1));
    expect(restartCalls(harness.rpc)[0]!.params).toEqual({ reopen: '/books/книга.fb2' });
    // An unmodified document: no save prompt, no quit of our own (the shell quits).
    expect(harness.ctx.dialogs.shown.map((m) => m.testId)).toEqual(['dialog-restart-prompt']);
    expect(harness.rpc.calls.map((c) => c.method)).not.toContain('app.quit');
    expect(harness.reloads).toEqual([]);
  });

  it('Yes remembers the Body position of the book before the restart (feature 004 US8)', async () => {
    const harness = await setup({
      responses: {
        'app.restart': rpcError(1070, 'app.restartUnavailable', { reason: 'no shell' }),
        'doc.position': {},
        'doc.watch': {},
      },
    });
    const { ctx, rpc } = harness;
    const controller = installBodyEditor({
      commands: createCommandRegistry(),
      rpc: rpc.client,
      undo: ctx.undo,
      carets: ctx.carets!,
      store: ctx.store,
      hotkeys: ctx.hotkeys,
    });
    actions.setDocument(ctx.store, fakeDocument({ path: '/books/a.fb2' }));
    expect(controller.setCaret({ view: 'body', nodeId: 'n3', offset: 4 })).toBe(true);
    await chooseLanguageAndAnswerYes(harness);
    await waitFor(() => expect(harness.reloads).toHaveLength(1));
    const methods = rpc.calls.map((c) => c.method);
    const remembered = rpc.calls.find((c) => c.method === 'doc.position');
    expect(remembered?.params).toEqual({
      docId: 'doc-1',
      position: { path: 'body[1]/section[1]/p[1]', offset: 4 },
    });
    expect(methods.indexOf('doc.position')).toBeLessThan(methods.indexOf('app.restart'));
    // The browser-mode reload (1070) follows the same hand-off: one remember, before it.
    expect(rpc.calls.filter((c) => c.method === 'doc.position')).toHaveLength(1);
  });

  it("Yes with a never-saved document carries no path; Don't save comes first", async () => {
    const harness = await setup({ responses: { 'app.restart': {} } });
    actions.setDocument(harness.ctx.store, fakeDocument({ path: undefined }));
    harness.ctx.store.setState({ modified: true });
    await chooseLanguageAndAnswerYes(harness, 'no'); // the save prompt after Yes: Don't save
    await waitFor(() => expect(restartCalls(harness.rpc)).toHaveLength(1));
    expect(restartCalls(harness.rpc)[0]!.params).toEqual({});
    expect(harness.ctx.dialogs.shown.map((m) => m.testId)).toEqual([
      'dialog-restart-prompt',
      'save-changes-prompt',
    ]);
  });

  it('Cancel in the save prompt abandons the restart', async () => {
    const harness = await setup({ responses: { 'app.restart': {} } });
    actions.setDocument(harness.ctx.store, fakeDocument({ path: '/books/a.fb2' }));
    harness.ctx.store.setState({ modified: true });
    await chooseLanguageAndAnswerYes(harness, 'cancel');
    await waitFor(() =>
      expect(harness.ctx.dialogs.shown.map((m) => m.testId)).toEqual([
        'dialog-restart-prompt',
        'save-changes-prompt',
      ]),
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(restartCalls(harness.rpc)).toEqual([]);
    expect(harness.reloads).toEqual([]);
    expect(harness.ctx.store.getState().modified).toBe(true);
  });

  it('without a shell (1070) the page reloads itself with the document to reopen', async () => {
    const harness = await setup({
      responses: {
        'app.restart': rpcError(1070, 'app.restartUnavailable', { reason: 'no shell' }),
      },
    });
    actions.setDocument(harness.ctx.store, fakeDocument({ path: '/books/a b.fb2' }));
    await chooseLanguageAndAnswerYes(harness);
    await waitFor(() => expect(harness.reloads).toHaveLength(1));
    const url = new URL(harness.reloads[0]!);
    expect(url.searchParams.get('open')).toBe('/books/a b.fb2');
    expect(url.origin + url.pathname).toBe(window.location.origin + window.location.pathname);
    // No error is shown: this is the browser-mode restart, not a failure.
    expect(harness.ctx.dialogs.shown.map((m) => m.testId)).toEqual(['dialog-restart-prompt']);
  });

  it('without a shell and without a saved document the reload carries no open=', async () => {
    const harness = await setup({
      responses: { 'app.restart': rpcError(1070, 'app.restartUnavailable') },
    });
    actions.setDocument(harness.ctx.store, fakeDocument({ path: undefined }));
    await chooseLanguageAndAnswerYes(harness);
    await waitFor(() => expect(harness.reloads).toHaveLength(1));
    expect(new URL(harness.reloads[0]!).searchParams.has('open')).toBe(false);
  });

  it('a shell that could not start the new instance (1071) is reported and the editor stays', async () => {
    const harness = await setup({
      responses: {
        'app.restart': rpcError(1071, 'app.restartFailed', {
          reason: 'posix_spawn: No such file or directory',
        }),
      },
    });
    actions.setDocument(harness.ctx.store, fakeDocument({ path: '/books/a.fb2' }));
    await chooseLanguageAndAnswerYes(harness);
    await waitFor(() => expect(harness.ctx.dialogs.shown).toHaveLength(2));
    const failure = harness.ctx.dialogs.shown[1]!;
    expect(failure.testId).toBe('dialog-restart-failed');
    expect(failure.icon).toBe('error');
    expect(failure.text).toMatch(/could not be restarted|Не удалось перезапустить/);
    expect(failure.text).toContain('posix_spawn: No such file or directory');
    expect(harness.reloads).toEqual([]);
    expect(harness.rpc.calls.map((c) => c.method)).not.toContain('app.quit');
  });
});

describe('SettingsDialog - Hotkeys page', () => {
  const keyY = { key: 'y', code: 'KeyY', ctrlKey: true };

  it('reports collisions, rejects reserved chords, assigns and restores defaults', async () => {
    const { ctx, user, feature, rpc, onClose } = await setup({ page: 'hotkeys' });
    await user.click(screen.getByTestId('settings-hotkeys-group-edit'));
    await user.click(screen.getByTestId('settings-hotkeys-command-edit.undo'));
    expect(screen.getByTestId('settings-hotkeys-current')).toHaveTextContent('Ctrl+Z');
    expect(screen.getByTestId('settings-hotkeys-description')).toHaveTextContent(
      'Undo the last action',
    );

    // Ctrl+Y is Redo's: "Assigned to ...".
    const capture = screen.getByTestId('settings-hotkeys-capture');
    capture.focus();
    fireEvent.keyDown(capture, keyY);
    expect(capture).toHaveValue('Ctrl+Y');
    expect(screen.getByTestId('settings-hotkeys-collision')).toHaveTextContent(
      'Assigned to "Edit \\ Redo"',
    );
    expect(screen.getByTestId('settings-hotkeys-assign')).toBeEnabled();

    // A platform-reserved chord: "Wrong shortcut!" and Assign disabled.
    fireEvent.keyDown(capture, { key: 'F4', code: 'F4', altKey: true });
    expect(capture).toHaveValue('Wrong shortcut!');
    expect(screen.getByTestId('settings-hotkeys-collision')).toHaveTextContent('Wrong shortcut!');
    expect(screen.getByTestId('settings-hotkeys-assign')).toBeDisabled();

    // A free chord: "Not assigned to other command".
    fireEvent.keyDown(capture, { key: 'k', code: 'KeyK', ctrlKey: true, shiftKey: true });
    expect(screen.getByTestId('settings-hotkeys-collision')).toHaveTextContent(
      'Not assigned to other command',
    );

    // Assign Ctrl+Y to Undo: Redo loses it (scratch map only until OK).
    fireEvent.keyDown(capture, keyY);
    await user.click(screen.getByTestId('settings-hotkeys-assign'));
    expect(screen.getByTestId('settings-hotkeys-current')).toHaveTextContent('Ctrl+Y');
    expect(screen.getByTestId('settings-hotkeys-command-edit.redo')).not.toHaveTextContent(
      'Ctrl+Y',
    );
    expect(feature.hotkeys.get('edit.undo')).toBe('Ctrl+Z'); // live map untouched so far

    // Default on Redo collides with Undo now: the "Replace?" prompt, answered Yes.
    ctx.dialogs.messageAnswers.push('yes');
    await user.click(screen.getByTestId('settings-hotkeys-command-edit.redo'));
    await user.click(screen.getByTestId('settings-hotkeys-default'));
    await waitFor(() => expect(ctx.dialogs.shown).toHaveLength(1));
    expect(ctx.dialogs.shown[0]!.text).toBe(
      'Default hotkey for this command was assigned to "Edit \\ Undo"! Replace?',
    );
    await waitFor(() =>
      expect(screen.getByTestId('settings-hotkeys-current')).toHaveTextContent('Ctrl+Y'),
    );
    expect(screen.getByTestId('settings-hotkeys-command-edit.undo')).not.toHaveTextContent('Ctrl+');

    // Delete removes the chord of the selected command.
    await user.click(screen.getByTestId('settings-hotkeys-delete'));
    expect(screen.getByTestId('settings-hotkeys-current')).toHaveTextContent('None');

    // OK copies the scratch overrides into the live map and persists them.
    await user.click(screen.getByTestId('dialog-settings-button-ok'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(feature.hotkeys.get('edit.redo')).toBeUndefined();
    expect(feature.hotkeys.get('edit.undo')).toBeUndefined();
    const set = rpc.calls.find((call) => call.method === 'hotkeys.set');
    expect(set).toBeDefined();
    const bindings = (set!.params as { bindings: { commandId: string; keys: string }[] }).bindings;
    expect(bindings).toEqual(
      expect.arrayContaining([
        { commandId: 'edit.undo', keys: '', source: 'user' },
        { commandId: 'edit.redo', keys: '', source: 'user' },
      ]),
    );
  });

  it('lists the eight groups of the original dialog and sorts commands by name', async () => {
    await setup({ page: 'hotkeys' });
    const groups = within(screen.getByTestId('settings-hotkeys-groups')).getAllByRole('option');
    expect(groups.map((g) => g.textContent)).toEqual([
      'File',
      'Edit',
      'Navigation',
      'Style',
      'View',
      'Tools',
      'Symbols',
      'Scripts',
    ]);
    const commands = within(screen.getByTestId('settings-hotkeys-commands')).getAllByRole('option');
    const names = commands.map((c) => c.firstElementChild?.textContent ?? '');
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(names).toContain('Open');
  });
});

describe('SettingsDialog - Words page', () => {
  it('validates new exclusion words, reports duplicates and adds valid ones', async () => {
    const { ctx, user, rpc } = await setup({ page: 'words' });
    await screen.findByTestId('settings-words-row-alpha');
    expect(screen.getByTestId('settings-words-row-beta-gamma')).toBeInTheDocument();

    const input = screen.getByTestId('settings-words-new');
    await user.type(input, 'ab1');
    await user.click(screen.getByTestId('settings-words-add'));
    expect(ctx.dialogs.shown.at(-1)?.text).toBe(
      "New exclusion word must contain only alpha characters and one '-' between them!",
    );
    await user.clear(input);
    await user.type(input, 'two--hyphens');
    await user.click(screen.getByTestId('settings-words-add'));
    expect(ctx.dialogs.shown.at(-1)?.text).toMatch(/only alpha characters/);
    await user.clear(input);
    await user.type(input, 'alpha');
    await user.click(screen.getByTestId('settings-words-add'));
    expect(ctx.dialogs.shown.at(-1)?.text).toBe('This word is already in list!');
    expect(
      rpc.calls.filter(
        (c) => c.method === 'words.exclusions' && c.params && 'add' in (c.params as object),
      ),
    ).toHaveLength(0);

    await user.clear(input);
    await user.type(input, 'слово-два{Enter}');
    await screen.findByTestId('settings-words-row-слово-два');
    const add = rpc.calls.find(
      (c) => c.method === 'words.exclusions' && c.params && 'add' in (c.params as object),
    );
    expect(add?.params).toEqual({ add: ['слово-два'] });
    expect(input).toHaveValue('');

    // Select All + Remove selected (confirmed).
    ctx.dialogs.messageAnswers.push('yes');
    await user.click(screen.getByTestId('settings-words-select-all'));
    await user.click(screen.getByTestId('settings-words-remove'));
    await waitFor(() => expect(screen.getByTestId('settings-words-empty')).toBeInTheDocument());
    const remove = rpc.calls.find(
      (c) => c.method === 'words.exclusions' && c.params && 'remove' in (c.params as object),
    );
    expect((remove?.params as { remove: string[] }).remove.sort()).toEqual(
      ['alpha', 'beta-gamma', 'слово-два'].sort(),
    );
  });
});

describe('SettingsDialog - without settings', () => {
  it('loads settings.get when the store has none yet', async () => {
    await initI18n({ language: 'en' });
    const settings = defaultSettings();
    const rpc = fakeRpc({ 'settings.get': settings, 'hotkeys.get': [] });
    const ctx = await makeContext({ rpc: rpc.client });
    const feature = registerSettingsRuntime(
      { store: ctx.store, hotkeys: ctx.hotkeys },
      { root: document.createElement('div'), window: null, search: '' },
    );
    render(<SettingsDialog ctx={ctx} feature={feature} onClose={() => {}} />);
    await screen.findByTestId('settings-page-view');
    expect(ctx.store.getState().settings).toEqual(settings);
    expect(rpc.calls.some((c) => c.method === 'settings.get')).toBe(true);
    await act(async () => {});
  });
});
