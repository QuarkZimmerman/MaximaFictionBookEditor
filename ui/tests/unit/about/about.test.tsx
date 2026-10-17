/**
 * About dialog (T149, FR-126 / FR-131; feature 002 FR-095 to FR-098): product name, version,
 * build stamp, platform and engine versions from `app.info`, the repository link, the GNU GPL
 * version 3 notices (copyright, no warranty, where to read the licence) and the original's
 * contributor notice word for word, "Open log folder" with the headless (1050) fallback.
 * Feature 003 (T024, FR-004 / FR-033): every dictionary of `spell.dictionaries()` is listed
 * with its tag and origin and its `spell.dictionaryLicense` notice (`about-dictionary-<tag>`).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { createCommandRegistry } from '@/app/commands';
import { HotkeyMap } from '@/app/hotkeys';
import { AboutDialog, REPOSITORY_URL } from '@/dialogs/AboutDialog';
import { registerSettingsFeature } from '@/features/settings';
import { changeLanguage, initI18n } from '@/i18n';
import { CaretRegistry } from '@/model/caret';
import { UndoCoordinator } from '@/model/undo';
import type { UiLanguage } from '@/rpc/types';

import { fakeRpc, makeContext, rpcError, type Responder } from '../features/testUtils';

// A text area's value has LF line ends; a Windows checkout gives the file CRLF.
const CONTRIBUTORS = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../CONTRIBUTORS.txt'),
  'utf8',
)
  .replace(/\r\n/g, '\n')
  .replace(/\n$/, '');

const INFO = {
  version: '0.0.1',
  build: '2026-10-13T00:00:00Z+abc1234',
  platform: 'linux',
  cefVersion: '131.0.0',
  uiLanguage: 'en',
  dataDir: '/home/user/.local/share/maxfbeditor',
  logDir: '/home/user/.local/state/maxfbeditor/logs',
  resourceLayers: [],
  apiVersion: 1,
};

/** `spell.dictionaries()` as the core answers it (rpc-api.md §3.4): built in first, then the folders. */
const DICTIONARIES = [
  {
    tag: 'en_US',
    lang: 'en',
    name: 'en_US',
    path: '/opt/mfbe/resources/dictionaries/en_US.aff',
    dicPath: '/opt/mfbe/resources/dictionaries/en_US.dic',
    readmePath: '/opt/mfbe/resources/dictionaries/en_US.txt',
    source: 'bundled',
  },
  {
    tag: 'ru_RU',
    lang: 'ru',
    name: 'ru_RU',
    path: '/opt/mfbe/resources/dictionaries/ru_RU.aff',
    dicPath: '/opt/mfbe/resources/dictionaries/ru_RU.dic',
    readmePath: '/opt/mfbe/resources/dictionaries/ru_RU.txt',
    source: 'bundled',
  },
  {
    tag: 'uk_UA',
    lang: 'uk',
    name: 'uk_UA',
    path: '/opt/mfbe/resources/dictionaries/uk_UA.aff',
    dicPath: '/opt/mfbe/resources/dictionaries/uk_UA.dic',
    readmePath: '/opt/mfbe/resources/dictionaries/uk_UA.txt',
    source: 'bundled',
  },
  {
    tag: 'de_DE',
    lang: 'de',
    name: 'de_DE',
    path: '/home/user/.local/share/maxfbeditor/dictionaries/de_DE.aff',
    dicPath: '/home/user/.local/share/maxfbeditor/dictionaries/de_DE.dic',
    source: 'user',
  },
  {
    tag: 'pl_PL',
    lang: 'pl',
    name: 'pl_PL',
    path: '/media/stick/mfbe/user/dictionaries/pl_PL.aff',
    dicPath: '/media/stick/mfbe/user/dictionaries/pl_PL.dic',
    readmePath: '/media/stick/mfbe/user/dictionaries/pl_PL.txt',
    source: 'portable',
  },
  {
    tag: 'fr_FR',
    lang: 'fr',
    name: 'fr_FR',
    path: '/home/user/Dictionaries/fr_FR.aff',
    dicPath: '/home/user/Dictionaries/fr_FR.dic',
    readmePath: '/home/user/Dictionaries/fr_FR.txt',
    source: 'settings',
  },
];

const NOTICES: Record<string, string> = {
  en_US:
    'en_US Hunspell Dictionary\nVersion 2020.12.07\n\nREADME file for English Hunspell dictionaries derived from SCOWL.\n',
  ru_RU: '* Copyright (c) 1997-2008, Alexander I. Lebedev\n\nAll rights reserved.\n',
  uk_UA:
    'Ukrainian spelling dictionary (uk_UA) for Hunspell\n\nThe Hunspell dictionary files are distributed under the Mozilla Public License (MPL) 1.1.\n',
  pl_PL: 'Polish dictionary notice.\n',
  fr_FR: 'Dictionnaire français - licence MPL 2.0.\n',
};

/** `spell.dictionaryLicense({tag})` as the core answers it: `{tag, text, path?}`, 1020 for an unknown tag. */
function dictionaryLicense(params: unknown) {
  const { tag } = params as { tag: string };
  const dictionary = DICTIONARIES.find((d) => d.tag === tag);
  if (!dictionary) return rpcError(1020, 'spell.dictionaryUnavailable', { lang: tag });
  const text = NOTICES[tag];
  return text === undefined
    ? { tag, text: '' }
    : { tag, text, path: dictionary.readmePath ?? `${tag}.txt` };
}

async function setup(
  options: {
    info?: unknown;
    openError?: Error;
    rpc?: boolean;
    language?: UiLanguage;
    dictionaries?: Responder;
    license?: Responder;
  } = {},
) {
  const language = options.language ?? 'en';
  await initI18n({ language });
  await changeLanguage(language);
  const rpc = fakeRpc({
    'app.info': options.info ?? INFO,
    'app.openLogFolder': options.openError ?? {},
    'spell.dictionaries': options.dictionaries ?? DICTIONARIES,
    'spell.dictionaryLicense': options.license ?? dictionaryLicense,
  });
  const ctx = await makeContext({ rpc: options.rpc === false ? null : rpc.client });
  const onClose = vi.fn();
  render(<AboutDialog ctx={ctx} onClose={onClose} />);
  // Let `app.info` and the dictionary notices arrive (the fake RPC answers in microtasks; the
  // notices need several of them) before the tests look at the dialog.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { ctx, rpc, onClose, user: userEvent.setup() };
}

describe('AboutDialog', () => {
  it('shows name, version, build, platform, engine, repository link and the GPL-3.0 notices', async () => {
    await setup();
    expect(screen.getByTestId('about-name')).toHaveTextContent('Maxima Fiction Book Editor');
    await waitFor(() =>
      expect(screen.getByTestId('about-version')).toHaveTextContent('Version 0.0.1'),
    );
    expect(screen.getByTestId('about-build')).toHaveTextContent('2026-10-13T00:00:00Z+abc1234');
    expect(screen.getByTestId('about-platform')).toHaveTextContent('linux');
    expect(screen.getByTestId('about-engine')).toHaveTextContent('CEF 131.0.0');
    expect(screen.getByTestId('about-api-version')).toHaveTextContent('1');
    const link = screen.getByTestId('about-repository');
    expect(link).toHaveAttribute('href', REPOSITORY_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    expect(screen.getByTestId('about-licence')).toHaveTextContent(
      'Licence: GNU General Public License version 3 (GPL-3.0-only)',
    );
    expect(screen.getByTestId('about-copyright')).toHaveTextContent(
      'Copyright © 2026 Quark Zimmerman',
    );
    expect(screen.getByTestId('about-based-on')).toHaveTextContent('FictionBook Editor 2.7');
    expect(screen.getByTestId('about-gpl-notice')).toHaveTextContent(/WITHOUT ANY WARRANTY/);
    const licenceLink = screen.getByTestId('about-licence-link');
    expect(licenceLink).toHaveAttribute('href', 'https://www.gnu.org/licenses/gpl-3.0.html');
    expect(licenceLink).toHaveAttribute('target', '_blank');
    expect(screen.getByTestId('about-log-folder')).toHaveTextContent(INFO.logDir);
    // The original's contributor notice, word for word, in a read-only box.
    const contributors = screen.getByTestId('about-contributors');
    expect(contributors).toHaveValue(CONTRIBUTORS);
    expect(contributors).toHaveAttribute('readonly');
    expect(CONTRIBUTORS).toContain('Copyright © 2003 Mike Matsnev');
    expect(screen.getByTestId('dialog-about').textContent ?? '').not.toMatch(/\bMIT\b/);
  });

  it('opens the log folder through app.openLogFolder and closes with Close / Escape', async () => {
    const { rpc, user, onClose } = await setup();
    await user.click(screen.getByTestId('about-open-log-folder'));
    await waitFor(() => expect(rpc.calls.some((c) => c.method === 'app.openLogFolder')).toBe(true));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('explains where the log folder is when no shell can open it (1050)', async () => {
    const { ctx, user } = await setup({
      openError: rpcError(1050, 'dialog.unavailable', { reason: 'no shell' }),
    });
    await waitFor(() => expect(screen.getByTestId('about-build')).toHaveTextContent('abc1234'));
    await user.click(screen.getByTestId('about-open-log-folder'));
    await waitFor(() => expect(ctx.dialogs.shown).toHaveLength(1));
    expect(ctx.dialogs.shown[0]!.text).toContain(INFO.logDir);
    expect(ctx.dialogs.shown[0]!.text).toMatch(/cannot be opened from here/);
  });

  it('falls back to the bundled UI version without a core', async () => {
    await setup({ rpc: false });
    expect(screen.getByTestId('about-version')).toHaveTextContent('Version 0.1.0-test');
    expect(screen.getByTestId('about-build')).toHaveTextContent('unknown');
    expect(screen.getByTestId('about-open-log-folder')).toBeDisabled();
    expect(screen.getByTestId('about-log-folder')).toHaveTextContent(
      'unknown (core not connected)',
    );
    expect(screen.getByTestId('about-dictionaries-caption')).toHaveTextContent(
      'Spelling dictionaries and their notices: unknown (core not connected)',
    );
    expect(screen.queryByTestId('about-dictionaries')).toBeNull();
  });

  describe('spelling dictionaries (FR-004, FR-033)', () => {
    it('lists every dictionary with its tag, origin and notice, in the order of the core', async () => {
      const { rpc } = await setup();
      const box = await screen.findByTestId('about-dictionaries');
      expect(box).toHaveAttribute('role', 'region');
      expect(box).toHaveAttribute('tabindex', '0');
      expect(box).toHaveAttribute(
        'aria-labelledby',
        screen.getByTestId('about-dictionaries-caption').id,
      );
      expect(screen.getByTestId('about-dictionaries-caption')).toHaveTextContent(
        /^Spelling dictionaries and their notices:$/,
      );

      const sections = within(box).getAllByTestId(/^about-dictionary-[A-Za-z_]+$/);
      expect(sections.map((section) => section.dataset['testid'])).toEqual([
        'about-dictionary-en_US',
        'about-dictionary-ru_RU',
        'about-dictionary-uk_UA',
        'about-dictionary-de_DE',
        'about-dictionary-pl_PL',
        'about-dictionary-fr_FR',
      ]);

      // Tag and origin (built in, user folder, portable folder, chosen folder).
      expect(screen.getByTestId('about-dictionary-uk_UA-tag')).toHaveTextContent(/^uk_UA$/);
      expect(screen.getByTestId('about-dictionary-uk_UA-source')).toHaveTextContent(/^built in$/);
      expect(screen.getByTestId('about-dictionary-uk_UA')).toHaveTextContent(/uk_UA \(built in\)/);
      expect(screen.getByTestId('about-dictionary-de_DE-source')).toHaveTextContent(
        /^user folder$/,
      );
      expect(screen.getByTestId('about-dictionary-pl_PL-source')).toHaveTextContent(
        /^portable folder$/,
      );
      expect(screen.getByTestId('about-dictionary-fr_FR-source')).toHaveTextContent(
        /^chosen folder$/,
      );

      // The notice text as the core read it (without the file's final newline).
      expect(screen.getByTestId('about-dictionary-uk_UA-notice').textContent).toBe(
        NOTICES['uk_UA']!.replace(/\n$/, ''),
      );
      expect(screen.getByTestId('about-dictionary-uk_UA')).toHaveTextContent(
        'Mozilla Public License (MPL) 1.1',
      );
      expect(screen.getByTestId('about-dictionary-en_US-notice').textContent).toContain(
        'derived from SCOWL',
      );
      expect(screen.getByTestId('about-dictionary-ru_RU-notice').textContent).toContain(
        'Alexander I. Lebedev',
      );
      // A dictionary without a notice file is listed all the same.
      expect(screen.getByTestId('about-dictionary-de_DE-notice')).toHaveTextContent(
        'This dictionary has no notice file.',
      );

      // One spell.dictionaryLicense({tag}) per dictionary.
      const licenceCalls = rpc.calls.filter((c) => c.method === 'spell.dictionaryLicense');
      expect(licenceCalls.map((c) => (c.params as { tag: string }).tag)).toEqual(
        DICTIONARIES.map((d) => d.tag),
      );
      expect(rpc.calls.filter((c) => c.method === 'spell.dictionaries')).toHaveLength(1);
    });

    it('says so when no dictionary is installed', async () => {
      await setup({ dictionaries: [] });
      await waitFor(() =>
        expect(screen.getByTestId('about-dictionaries-caption')).toHaveTextContent(
          'Spelling dictionaries and their notices: no dictionaries are installed.',
        ),
      );
      expect(screen.queryByTestId('about-dictionaries')).toBeNull();
    });

    it('keeps the dictionaries unknown when the core cannot list them', async () => {
      await setup({ dictionaries: rpcError(-32603, 'spell service not initialised') });
      await waitFor(() =>
        expect(screen.getByTestId('about-dictionaries-caption')).toHaveTextContent(
          'unknown (core not connected)',
        ),
      );
      expect(screen.queryByTestId('about-dictionaries')).toBeNull();
    });

    it('still lists a dictionary whose notice cannot be read', async () => {
      await setup({
        license: rpcError(1020, 'spell.dictionaryUnavailable', { reason: 'unknown dictionary' }),
      });
      const section = await screen.findByTestId('about-dictionary-uk_UA');
      expect(section).toHaveTextContent('uk_UA');
      expect(section).toHaveTextContent('built in');
      expect(screen.getByTestId('about-dictionary-uk_UA-notice')).toHaveTextContent(
        'This dictionary has no notice file.',
      );
      expect(screen.getAllByTestId(/^about-dictionary-[A-Za-z_]+$/)).toHaveLength(
        DICTIONARIES.length,
      );
    });

    it('names the origins in the interface language (Ukrainian)', async () => {
      await setup({ language: 'uk' });
      await screen.findByTestId('about-dictionary-fr_FR');
      expect(screen.getByTestId('about-dictionaries-caption')).toHaveTextContent(
        'Орфографічні словники та їхні ліцензійні повідомлення:',
      );
      expect(screen.getByTestId('about-dictionary-uk_UA-source')).toHaveTextContent('вбудований');
      expect(screen.getByTestId('about-dictionary-de_DE-source')).toHaveTextContent(
        'тека користувача',
      );
      expect(screen.getByTestId('about-dictionary-pl_PL-source')).toHaveTextContent(
        'тека портативної копії',
      );
      expect(screen.getByTestId('about-dictionary-fr_FR-source')).toHaveTextContent('вибрана тека');
      expect(screen.getByTestId('about-dictionary-de_DE-notice')).toHaveTextContent(
        'Цей словник не має файлу повідомлення.',
      );
      // The notice itself is the dictionary's own text, never translated.
      expect(screen.getByTestId('about-dictionary-uk_UA-notice').textContent).toBe(
        NOTICES['uk_UA']!.replace(/\n$/, ''),
      );
    });

    it('tolerates an older core: the name stands in for the tag, no licence method', async () => {
      const { rpc } = await setup({
        dictionaries: [
          { lang: 'en', name: 'en_US', source: 'bundled' },
          { tag: 'ru_RU', lang: 'ru', name: 'ru_RU', source: 'bundled' },
        ],
        license: rpcError(-32601, 'Method not found: spell.dictionaryLicense'),
      });
      const box = await screen.findByTestId('about-dictionaries');
      expect(
        within(box)
          .getAllByTestId(/^about-dictionary-[A-Za-z_]+$/)
          .map((section) => section.dataset['testid']),
      ).toEqual(['about-dictionary-en_US', 'about-dictionary-ru_RU']);
      expect(screen.getByTestId('about-dictionary-en_US-tag')).toHaveTextContent(/^en_US$/);
      expect(screen.getByTestId('about-dictionary-en_US-notice')).toHaveTextContent(
        'This dictionary has no notice file.',
      );
      expect(rpc.calls.filter((c) => c.method === 'spell.dictionaryLicense')).toHaveLength(2);
    });

    it('shows a layer name it does not know as the core sends it', async () => {
      await setup({
        dictionaries: [{ tag: 'be_BY', lang: 'be', name: 'be_BY', source: 'network' }],
        license: { tag: 'be_BY', text: 'Belarusian notice.' },
      });
      await screen.findByTestId('about-dictionary-be_BY');
      expect(screen.getByTestId('about-dictionary-be_BY-source')).toHaveTextContent(/^network$/);
      expect(screen.getByTestId('about-dictionary-be_BY-notice')).toHaveTextContent(
        'Belarusian notice.',
      );
    });
  });

  it('is wired to the help.about command by the settings feature', async () => {
    const { ctx } = await setup({ rpc: false });
    const commands = createCommandRegistry();
    registerSettingsFeature({
      commands,
      undo: new UndoCoordinator(),
      carets: new CaretRegistry(),
      store: ctx.store,
      hotkeys: new HotkeyMap('linux'),
    });
    const about = commands.get('help.about')!;
    expect(about.stub).toBeUndefined();
    expect(commands.get('tools.settings')!.stub).toBeUndefined();
    await commands.execute('help.about', ctx);
    expect(ctx.dialogs.custom.map((d) => d.name)).toEqual(['AboutDialog']);
  });
});
