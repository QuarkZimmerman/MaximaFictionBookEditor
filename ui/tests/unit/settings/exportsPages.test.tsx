/**
 * Feature 017 (T044; D18 to D22, DP-7): Settings > Exports - the Format list PDF, EPUB, Markdown, TXT; the TXT
 * page (encoding mode, the four lists from txt.encodings, byte-order mark, ZIP) and the Markdown page (Include
 * pictures), each default shown with Reset and Reset all.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { ExportsPage } from '@/dialogs/settings/ExportsPage';
import { changeLanguage, initI18n } from '@/i18n';
import type { Settings } from '@/rpc/types';

import { fakeRpc, makeContext } from '../features/testUtils';
import { defaultSettings } from './fixtures';

const ALL = [
  'utf-8',
  'ibm866',
  'iso-8859-2',
  'iso-8859-3',
  'iso-8859-4',
  'iso-8859-5',
  'iso-8859-6',
  'iso-8859-7',
  'iso-8859-8',
  'iso-8859-10',
  'iso-8859-13',
  'iso-8859-14',
  'iso-8859-15',
  'iso-8859-16',
  'koi8-r',
  'koi8-u',
  'macintosh',
  'windows-874',
  'windows-1250',
  'windows-1251',
  'windows-1252',
  'windows-1253',
  'windows-1254',
  'windows-1255',
  'windows-1256',
  'windows-1257',
  'windows-1258',
  'x-mac-cyrillic',
  'iso-8859-1',
];

async function setup() {
  await initI18n({ language: 'en' });
  await changeLanguage('en');
  const rpc = fakeRpc({
    'txt.encodings': () => ({
      all: ALL.map((name) => ({ name, labelKey: `txt.encoding.${name}` })),
      ru: ['utf-8', 'windows-1251', 'koi8-r', 'ibm866', 'iso-8859-5', 'koi8-u', 'x-mac-cyrillic'],
      uk: ['utf-8', 'windows-1251', 'koi8-u', 'x-mac-cyrillic'],
      en: ['utf-8', 'windows-1252', 'iso-8859-1', 'iso-8859-15', 'macintosh'],
    }),
    'pdf.fonts.list': () => ({ shipped: [], added: [] }),
  });
  const ctx = await makeContext({ rpc: rpc.client });
  const changes: { section: string; patch: unknown }[] = [];
  function Host() {
    const [draft, setDraft] = useState<Settings>(defaultSettings());
    return (
      <ExportsPage
        draft={draft}
        ctx={ctx}
        onChange={(section, patch) => {
          changes.push({ section, patch });
          setDraft((d) => ({ ...d, [section]: { ...(d[section] as object), ...patch } }));
        }}
      />
    );
  }
  render(<Host />);
  return { changes, user: userEvent.setup() };
}

describe('Settings > Exports (feature 017)', () => {
  it('lists PDF, EPUB, Markdown and TXT, opening on PDF', async () => {
    await setup();
    const format = screen.getByTestId('settings-exports-format');
    expect([...format.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'PDF',
      'EPUB',
      'Markdown',
      'TXT',
    ]);
    expect(format).toHaveValue('pdf');
    expect(screen.getByTestId('settings-pdf-zip')).not.toBeChecked();
  });

  it('the TXT page: the mode, the lists of each language, the boxes, Reset all', async () => {
    const { changes, user } = await setup();
    await user.selectOptions(screen.getByTestId('settings-exports-format'), 'txt');
    await waitFor(() =>
      expect(
        screen.getByTestId('settings-txt-encoding-ru').querySelectorAll('option'),
      ).toHaveLength(7),
    );
    expect(screen.getByTestId('settings-txt-mode-utf-8')).toBeChecked();
    expect(screen.getByTestId('settings-txt-encoding-ru')).toBeDisabled();
    expect(
      screen.getByTestId('settings-txt-encoding-other').querySelectorAll('option'),
    ).toHaveLength(29);
    await user.click(screen.getByTestId('settings-txt-mode-language'));
    expect(changes.at(-1)).toEqual({ section: 'txt', patch: { encodingMode: 'language' } });
    await user.selectOptions(screen.getByTestId('settings-txt-encoding-ru'), 'koi8-r');
    expect(changes.at(-1)?.patch).toEqual({
      encodings: { en: 'windows-1252', ru: 'koi8-r', uk: 'windows-1251', other: 'utf-8' },
    });
    await user.click(screen.getByTestId('settings-txt-bom'));
    expect(changes.at(-1)?.patch).toEqual({ bom: true });
    await user.click(screen.getByTestId('settings-txt-reset-all'));
    expect(changes.at(-1)?.patch).toEqual({
      encodingMode: 'utf-8',
      encodings: { en: 'windows-1252', ru: 'windows-1251', uk: 'windows-1251', other: 'utf-8' },
      bom: false,
      zip: false,
    });
    expect(screen.getByTestId('settings-txt-reset-all')).toBeDisabled();
  });

  it('the Markdown page: Include pictures, ticked out of the box', async () => {
    const { changes, user } = await setup();
    await user.selectOptions(screen.getByTestId('settings-exports-format'), 'markdown');
    expect(screen.getByTestId('settings-markdown-include-pictures')).toBeChecked();
    await user.click(screen.getByTestId('settings-markdown-include-pictures'));
    expect(changes.at(-1)).toEqual({ section: 'markdown', patch: { includePictures: false } });
    await user.click(screen.getByTestId('settings-markdown-reset-all'));
    expect(changes.at(-1)?.patch).toEqual({ includePictures: true });
  });
});
