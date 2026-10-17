/**
 * Feature 003 US4 (T044/T047): the "Dictionaries folder" row and the dictionary report of
 * Settings > View - default / chosen folder through `onChangeOther`, "..." through
 * `dialog.pickFolder`, "Open dictionaries folder" through `resources.openDictionariesFolder`,
 * the list of dictionaries in effect with their origin, the rejected files with their reason,
 * the note about a chosen folder that is missing or unreadable, the read-only variant without
 * `onChangeOther`, a core without the report, and the pure helpers of model.ts.
 */

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';

import { HotkeyMap } from '@/app/hotkeys';
import {
  dictionariesFolderProblem,
  dictionaryOriginLabel,
  dictionaryRejectionText,
} from '@/dialogs/settings/model';
import { ViewPage } from '@/dialogs/settings/ViewPage';
import { getSpellFeature } from '@/features/spell';
import { changeLanguage, initI18n } from '@/i18n';
import { actions } from '@/model/store';
import type { Settings, SpellDictionaryReport } from '@/rpc/types';

import { fakeRpc, makeContext, rpcError, type Responder } from '../features/testUtils';

import { defaultSettings } from './fixtures';

function dictionary(tag: string, source: string, folder = '/data/dictionaries') {
  return {
    tag,
    lang: tag.split('_')[0]!,
    name: tag,
    path: `${folder}/${tag}.aff`,
    dicPath: `${folder}/${tag}.dic`,
    source,
  };
}

const REPORT: SpellDictionaryReport = {
  dictionaries: [
    dictionary('en_US', 'bundled', '/res/dictionaries'),
    dictionary('ru_RU', 'bundled', '/res/dictionaries'),
    dictionary('de_DE', 'settings', '/chosen'),
    dictionary('pl_PL', 'user'),
  ],
  rejected: [
    { path: '/data/dictionaries/cs_CZ.aff', reason: 'partnerMissing' },
    { path: '/data/dictionaries/de_DE.aff', reason: 'shadowed', detail: 'settings' },
    { path: '/data/dictionaries/ru_RU.aff', reason: 'shadowed', detail: 'bundled' },
    { path: '/data/dictionaries/xx_XX.aff', reason: 'unsupportedEncoding', detail: 'X-UNKNOWN' },
    { path: '/data/dictionaries/fr_FR.dic', reason: 'unreadable' },
  ],
  folders: [
    { layer: 'settings', path: '/chosen', exists: true, readable: true, writable: true },
    { layer: 'user', path: '/data/dictionaries', exists: true, readable: true, writable: true },
    { layer: 'portable', path: '', exists: false, readable: false, writable: false },
    { layer: 'bundled', path: '/res/dictionaries', exists: true, readable: true, writable: false },
  ],
};

async function setup(options: {
  settings?: Settings;
  responses?: Record<string, Responder>;
  withOther?: boolean;
  connected?: boolean;
}) {
  await initI18n({ language: 'en' });
  await changeLanguage('en');
  const settings = options.settings ?? defaultSettings();
  const rpc = fakeRpc({
    'spell.dictionaryReport': REPORT,
    'resources.openDictionariesFolder': { path: '/data/dictionaries' },
    ...(options.responses ?? {}),
  });
  const ctx = await makeContext({
    rpc: options.connected === false ? null : rpc.client,
    hotkeys: new HotkeyMap('linux'),
  });
  actions.setConnection(ctx.store, options.connected === false ? 'disconnected' : 'connected');
  actions.setSettings(ctx.store, settings);
  const onChange = vi.fn();
  const onChangeOther = vi.fn();
  const user = userEvent.setup();
  // The report arrives asynchronously right after the mount: let it settle inside act.
  await act(async () => {
    render(
      <ViewPage
        draft={settings}
        onChange={onChange}
        onChangeOther={options.withOther === false ? undefined : onChangeOther}
        ctx={ctx}
      />,
    );
  });
  return { ctx, rpc, onChange, onChangeOther, user };
}

const reportCalls = (rpc: ReturnType<typeof fakeRpc>) =>
  rpc.calls.filter((call) => call.method === 'spell.dictionaryReport').length;

describe('Settings > View - dictionaries folder and report', () => {
  it('lists the dictionaries in effect with their origin and the rejected files with reasons', async () => {
    const { rpc } = await setup({});
    const list = await screen.findByTestId('settings-view-dictionaries-list');
    expect(reportCalls(rpc)).toBe(1);
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.querySelector('[data-role="tag"]')?.textContent)).toEqual([
      'en_US',
      'ru_RU',
      'de_DE',
      'pl_PL',
    ]);
    expect(items.map((item) => item.querySelector('[data-role="origin"]')?.textContent)).toEqual([
      'built in',
      'built in',
      'chosen folder',
      'user folder',
    ]);
    expect(screen.getByTestId('settings-view-dictionary-de_DE')).toHaveTextContent('chosen folder');

    const rejected = screen.getByTestId('settings-view-dictionaries-rejected');
    const reasons = within(rejected)
      .getAllByRole('listitem')
      .map((item) => [
        item.querySelector('[data-role="path"]')?.textContent,
        item.querySelector('[data-role="reason"]')?.textContent,
      ]);
    expect(reasons).toEqual([
      ['/data/dictionaries/cs_CZ.aff', 'partner file missing'],
      [
        '/data/dictionaries/de_DE.aff',
        "shadowed by the chosen folder's dictionary of the same tag",
      ],
      ['/data/dictionaries/ru_RU.aff', 'shadowed by the built-in dictionary of the same tag'],
      ['/data/dictionaries/xx_XX.aff', 'unsupported encoding (X-UNKNOWN)'],
      ['/data/dictionaries/fr_FR.dic', 'cannot be read'],
    ]);
    // The chosen folder exists and can be read: no problem note.
    expect(screen.queryByTestId('settings-view-dictionaries-folder-problem')).toBeNull();
  });

  it('offers default / chosen folder, "..." through dialog.pickFolder and the folder opener', async () => {
    const { rpc, onChangeOther, user } = await setup({
      responses: { 'dialog.pickFolder': { path: '/home/me/dicts' } },
    });
    await screen.findByTestId('settings-view-dictionaries-list');
    const useDefault = screen.getByTestId('settings-view-dictionaries-default');
    const useCustom = screen.getByTestId('settings-view-dictionaries-custom');
    const pathField = screen.getByTestId('settings-view-dictionaries-path');
    const browse = screen.getByTestId('settings-view-dictionaries-browse');
    expect(useDefault).toBeChecked();
    expect(useCustom).not.toBeChecked();
    expect(pathField).toBeDisabled();
    expect(browse).toBeDisabled();

    await user.click(useCustom);
    expect(useCustom).toBeChecked();
    expect(pathField).toBeEnabled();
    expect(browse).toBeEnabled();
    await user.click(browse);
    await waitFor(() =>
      expect(onChangeOther).toHaveBeenCalledWith({ dictionariesFolder: '/home/me/dicts' }),
    );
    const pick = rpc.calls.find((call) => call.method === 'dialog.pickFolder');
    expect(pick?.params).toEqual({ title: 'Specify the dictionaries folder' });

    await user.click(useDefault);
    expect(onChangeOther).toHaveBeenLastCalledWith({ dictionariesFolder: '' });
    expect(pathField).toBeDisabled();

    await user.click(screen.getByTestId('settings-view-dictionaries-open'));
    await waitFor(() =>
      expect(rpc.calls.some((call) => call.method === 'resources.openDictionariesFolder')).toBe(
        true,
      ),
    );
  });

  it('shows the chosen folder of the draft and reports a missing one from the saved report', async () => {
    const settings = defaultSettings();
    settings.other.dictionariesFolder = '/gone';
    const { user, onChangeOther } = await setup({
      settings,
      responses: {
        'spell.dictionaryReport': {
          ...REPORT,
          dictionaries: REPORT.dictionaries.filter((d) => d.source !== 'settings'),
          rejected: [],
          folders: [
            { layer: 'settings', path: '/gone', exists: false, readable: false, writable: false },
            ...REPORT.folders.slice(1),
          ],
        },
      },
    });
    const problem = await screen.findByTestId('settings-view-dictionaries-folder-problem');
    expect(problem).toHaveTextContent(
      'The chosen folder /gone does not exist; the default folder is used.',
    );
    expect(screen.getByTestId('settings-view-dictionaries-custom')).toBeChecked();
    expect(screen.getByTestId('settings-view-dictionaries-path')).toHaveValue('/gone');
    expect(screen.queryByTestId('settings-view-dictionaries-rejected')).toBeNull();
    // Typing a path edits the `other` section of the draft.
    await user.type(screen.getByTestId('settings-view-dictionaries-path'), '2');
    expect(onChangeOther).toHaveBeenLastCalledWith({ dictionariesFolder: '/gone2' });
  });

  it('is read-only without onChangeOther; the report and the opener still work', async () => {
    const { rpc } = await setup({ withOther: false });
    await screen.findByTestId('settings-view-dictionaries-list');
    expect(screen.getByTestId('settings-view-dictionaries-default')).toBeDisabled();
    expect(screen.getByTestId('settings-view-dictionaries-custom')).toBeDisabled();
    expect(screen.getByTestId('settings-view-dictionaries-path')).toBeDisabled();
    expect(screen.getByTestId('settings-view-dictionaries-browse')).toBeDisabled();
    expect(screen.getByTestId('settings-view-dictionaries-open')).toBeEnabled();
    expect(reportCalls(rpc)).toBe(1);
  });

  it('says the report is not available with an older core or without a connection', async () => {
    await setup({
      responses: { 'spell.dictionaryReport': rpcError(-32601, 'Method not found') },
    });
    const note = await screen.findByTestId('settings-view-dictionaries-unknown');
    await waitFor(() =>
      expect(note).toHaveTextContent('Dictionaries in effect: not available (core not connected)'),
    );
  });

  it('follows the spell feature: a refresh after Apply updates the list', async () => {
    const { ctx, rpc } = await setup({});
    await screen.findByTestId('settings-view-dictionary-pl_PL');
    rpc.responses['spell.dictionaryReport'] = {
      ...REPORT,
      dictionaries: [...REPORT.dictionaries, dictionary('uk_UA', 'bundled', '/res/dictionaries')],
    };
    await act(async () => {
      await getSpellFeature(ctx.store).refreshDictionaries(ctx.rpc);
    });
    await screen.findByTestId('settings-view-dictionary-uk_UA');
    expect(reportCalls(rpc)).toBe(2);
  });
});

describe('model helpers of the dictionary report', () => {
  const t = i18next.t.bind(i18next);

  beforeAll(async () => {
    await initI18n({ language: 'en' });
    await changeLanguage('en');
  });

  it('labels origins and reasons', () => {
    expect(dictionaryOriginLabel('bundled', t)).toBe('built in');
    expect(dictionaryOriginLabel('settings', t)).toBe('chosen folder');
    expect(dictionaryOriginLabel('user', t)).toBe('user folder');
    expect(dictionaryOriginLabel('portable', t)).toBe('portable folder');
    expect(dictionaryOriginLabel('other', t)).toBe('other');
    expect(dictionaryRejectionText({ reason: 'shadowed', detail: 'user' }, t)).toBe(
      "shadowed by the user folder's dictionary of the same tag",
    );
    expect(dictionaryRejectionText({ reason: 'shadowed' }, t)).toBe(
      'shadowed by a dictionary of the same tag',
    );
    expect(dictionaryRejectionText({ reason: 'unsupportedEncoding' }, t)).toBe(
      'unsupported encoding',
    );
    expect(dictionaryRejectionText({ reason: 'unsupportedEncoding', detail: 'KOI8-U' }, t)).toBe(
      'unsupported encoding (KOI8-U)',
    );
  });

  it('names the problem of the chosen folder', () => {
    expect(dictionariesFolderProblem(REPORT.folders, t)).toBeNull();
    expect(
      dictionariesFolderProblem(
        [{ layer: 'settings', path: '', exists: false, readable: false, writable: false }],
        t,
      ),
    ).toBeNull();
    expect(
      dictionariesFolderProblem(
        [{ layer: 'settings', path: '/x', exists: false, readable: false, writable: false }],
        t,
      ),
    ).toBe('The chosen folder /x does not exist; the default folder is used.');
    expect(
      dictionariesFolderProblem(
        [{ layer: 'settings', path: '/x', exists: true, readable: false, writable: false }],
        t,
      ),
    ).toBe('The chosen folder /x cannot be read; the default folder is used.');
  });
});
