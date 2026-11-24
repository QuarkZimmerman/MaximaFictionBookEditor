/**
 * Feature 020 (T040, US3): Vitest unit tests for Settings -> Imports and Settings -> OCR pages:
 * - Imports tab: 5 top-level formats, PDF Use OCR default true, informational note on other 4
 * - OCR tab: Default/Custom folder selector, Auto-detect checkbox, 10 bundled packs with eng+rus
 *   checked by default, overridesBundled badge, clickable ExternalLink, passedOver diagnostics,
 *   and installed-pack intersection validation rejecting 0 enabled installed languages
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { ImportsPage } from '@/dialogs/settings/ImportsPage';
import { OCR_DOWNLOAD_URL, OcrPage } from '@/dialogs/settings/OcrPage';
import { validateSettings } from '@/dialogs/settings/model';
import { changeLanguage, initI18n } from '@/i18n';
import type { OcrCatalogReport, Settings } from '@/rpc/types';

import { fakeRpc, makeContext } from '../features/testUtils';
import { defaultSettings } from '../settings/fixtures';

const BUNDLED_CODES = ['eng', 'rus', 'ukr', 'deu', 'fra', 'spa', 'ita', 'por', 'pol', 'bel'];

function makeReport(overrides: Partial<OcrCatalogReport> = {}): OcrCatalogReport {
  return {
    packs: BUNDLED_CODES.map((code, i) => ({
      code,
      fb2Lang: code.slice(0, 2),
      script: code === 'rus' || code === 'ukr' || code === 'bel' ? 'cyrillic' : 'latin',
      layer: code === 'rus' ? 'settings' : 'bundled',
      path: `/ocr/${code}.traineddata`,
      sizeBytes: (i + 2) * 1024 * 1024,
      overridesBundled: code === 'rus',
      bundled: true,
    })),
    osdAvailable: true,
    osdLayer: 'bundled',
    activeFolder: '/user/ocr',
    customFolder: '',
    customFolderIssue: null,
    passedOver: [{ layer: 'user', path: '/user/ocr/broken.traineddata', reason: 'corrupt' }],
    ...overrides,
  };
}

describe('Settings -> Imports page (T040)', () => {
  it('lists all 5 top-level formats, defaults PDF Use OCR to true, and shows note on other 4', async () => {
    await initI18n({ language: 'en' });
    await changeLanguage('en');
    const changes: unknown[] = [];

    function Host() {
      const [draft, setDraft] = useState<Settings>(defaultSettings());
      return (
        <ImportsPage
          draft={draft}
          onChange={(patch) => {
            changes.push(patch);
            setDraft((d) => ({
              ...d,
              imports: { pdf: { useOcr: d.imports?.pdf.useOcr ?? true, ...patch.pdf } },
            }));
          }}
        />
      );
    }

    const user = userEvent.setup();
    render(<Host />);

    const select = screen.getByTestId('settings-imports-format');
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'PDF',
      'EPUB',
      'Markdown',
      'TXT',
      'MOBI',
    ]);
    expect(select).toHaveValue('pdf');

    const useOcr = screen.getByTestId('settings-imports-pdf-use-ocr');
    expect(useOcr).toBeChecked();
    await user.click(useOcr);
    expect(useOcr).not.toBeChecked();
    expect(changes.at(-1)).toEqual({ pdf: { useOcr: false } });

    for (const fmt of ['epub', 'markdown', 'txt', 'mobi']) {
      await user.selectOptions(select, fmt);
      expect(screen.getByTestId('settings-imports-none')).toHaveTextContent(
        'no import settings yet',
      );
    }
  });
});

describe('Settings -> OCR page and validation (T040)', () => {
  it('renders folder controls, clickable ExternalLink, 10 packs with eng+rus checked, override badge, and passedOver diagnostics', async () => {
    const i18n = await initI18n({ language: 'en' });
    await changeLanguage('en');
    const openedUrls: string[] = [];
    const openedFolders: number[] = [];
    const rpc = fakeRpc({
      'app.openUrl': (params: unknown) => {
        openedUrls.push((params as { url: string }).url);
        return {};
      },
      'resources.openOcrFolder': () => {
        openedFolders.push(1);
        return {};
      },
    });
    const ctx = await makeContext({ rpc: rpc.client });
    const report = makeReport();

    function Host() {
      const [draft, setDraft] = useState<Settings>(defaultSettings());
      return (
        <OcrPage
          draft={draft}
          onChange={(patch) => setDraft((d) => ({ ...d, ocr: { ...d.ocr!, ...patch } }))}
          ctx={ctx}
          report={report}
          reportKnown
        />
      );
    }

    const user = userEvent.setup();
    render(<Host />);

    // Default folder selected, path input disabled
    expect(screen.getByTestId('settings-ocr-folder-default')).toBeChecked();
    expect(screen.getByTestId('settings-ocr-folder-path')).toBeDisabled();

    // Auto-detect checked by default
    expect(screen.getByTestId('settings-ocr-auto-detect')).toBeChecked();

    // Clickable external download link points to Tesseract tessdoc Data-Files page
    const link = screen.getByTestId('settings-ocr-download-link');
    expect(link).toHaveAttribute('href', OCR_DOWNLOAD_URL);
    await user.click(link);
    await waitFor(() => expect(openedUrls).toEqual([OCR_DOWNLOAD_URL]));

    // Open OCR folder calls resources.openOcrFolder
    await user.click(screen.getByTestId('settings-ocr-open-folder'));
    await waitFor(() => expect(openedFolders).toHaveLength(1));

    // All 10 bundled packs listed; eng & rus checked by default, others unchecked
    for (const code of BUNDLED_CODES) {
      const cb = screen.getByTestId(`settings-ocr-lang-${code}`);
      if (code === 'eng' || code === 'rus') expect(cb).toBeChecked();
      else expect(cb).not.toBeChecked();
    }

    // Override badge displayed on rus (overridesBundled: true)
    expect(screen.getByTestId('settings-ocr-override-rus')).toHaveTextContent('Overrides bundled');

    // Ignored / corrupt file listed in passedOver diagnostics
    expect(screen.getByTestId('settings-ocr-passed-over')).toHaveTextContent('broken.traineddata');

    // Installed-pack intersection validation rejects 0 enabled installed packs
    const invalidDraft = defaultSettings({
      ocr: { folder: '', autoDetect: true, enabledLanguages: ['nonexistent'] },
    });
    const errs = validateSettings(invalidDraft, i18n.t.bind(i18n), report);
    expect(errs.some((e) => e.field === 'ocr.enabledLanguages')).toBe(true);

    const validDraft = defaultSettings({
      ocr: { folder: '', autoDetect: true, enabledLanguages: ['eng'] },
    });
    expect(validateSettings(validDraft, i18n.t.bind(i18n), report)).toEqual([]);
  });
});
