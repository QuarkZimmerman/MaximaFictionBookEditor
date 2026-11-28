/**
 * Feature 023 (T034): component & dirty-tracking tests for `DocxPage` and `settingsPatch`
 * covering all 9 DOCX controls, custom margin & custom font reveal/validation, per-field Reset,
 * Reset all, and `hideZip` mode (for Batch Converter).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DocxPage } from '@/dialogs/settings/DocxPage';
import { validateSettings } from '@/dialogs/settings/model';
import { DOCX_DEFAULTS } from '@/features/docx/docxSettingsSchema';
import { isEmptyPatch, settingsPatch } from '@/features/settings/apply';
import i18next, { changeLanguage, initI18n } from '@/i18n';
import type { Settings } from '@/rpc/types';

beforeAll(async () => {
  await initI18n({ language: 'en' });
  await changeLanguage('en');
});
afterEach(cleanup);

function makeSettings(docxOverrides?: Partial<NonNullable<Settings['docx']>>): Settings {
  return {
    schemaVersion: 1,
    view: {
      uiLanguage: 'en',
      theme: 'system',
      bodyFont: 'Georgia',
      bodyFontSize: 16,
      bodyTextColor: '#000000',
      bodyBackground: '#ffffff',
      sourceFont: 'Consolas, 12',
      sourceWrap: true,
      sourceLineNumbers: true,
      sourceHighlight: true,
      fastMode: false,
      nbspDisplay: '\u00A0',
      spellCheck: true,
      spellExtraDictionaries: [],
      statusBarPanes: { position: true, encoding: true, validation: true },
    },
    other: {
      defaultEncoding: 'utf-8',
      jpegQuality: 90,
      defaultImageFormat: 'jpeg',
      keepBackup: false,
      openFromOutside: 'newCopy',
      versionCheck: 'monthly',
      genresFolder: '',
      dictionariesFolder: '',
      scriptsFolder: '',
      switchLayoutOnOpen: false,
      layoutId: '',
      layoutName: '',
    },
    words: { exclusions: [] },
    session: {
      toolbars: { main: true, format: true, scripts: true },
      treeVisible: true,
      treeWidth: 240,
      aiPanelVisible: false,
      aiPanelWidth: 320,
    },
    docx: { ...DOCX_DEFAULTS, ...docxOverrides },
  } as unknown as Settings;
}

describe('Settings > Exports > DOCX (DocxPage)', () => {
  it('renders all defaults, reveals custom margin and custom font inputs, and wires per-field Reset and Reset all', () => {
    const onChange = vi.fn();
    const { rerender } = render(<DocxPage draft={makeSettings()} onChange={onChange} />);

    expect((screen.getByTestId('settings-docx-page-size') as HTMLSelectElement).value).toBe('a4');
    expect((screen.getByTestId('settings-docx-margins') as HTMLSelectElement).value).toBe(
      'standard',
    );
    expect(screen.queryByTestId('settings-docx-custom-margin')).toBeNull();
    expect((screen.getByTestId('settings-docx-font-family') as HTMLSelectElement).value).toBe(
      'Georgia',
    );
    expect(screen.queryByTestId('settings-docx-custom-font-family')).toBeNull();
    expect((screen.getByTestId('settings-docx-text-size') as HTMLSelectElement).value).toBe('12');
    expect((screen.getByTestId('settings-docx-toc') as HTMLSelectElement).value).toBe('afterTitle');
    expect((screen.getByTestId('settings-docx-notes') as HTMLSelectElement).value).toBe(
      'footnotes',
    );
    expect((screen.getByTestId('settings-docx-zip') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId('settings-docx-reset-all') as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.change(screen.getByTestId('settings-docx-margins'), { target: { value: 'custom' } });
    expect(onChange).toHaveBeenCalledWith({ margins: 'custom' });

    fireEvent.change(screen.getByTestId('settings-docx-font-family'), {
      target: { value: 'custom' },
    });
    expect(onChange).toHaveBeenCalledWith({ fontFamily: 'custom' });

    // Re-render with non-default custom settings
    rerender(
      <DocxPage
        draft={makeSettings({
          defaultPageSize: 'letter',
          margins: 'custom',
          customMargin: 30,
          fontFamily: 'custom',
          customFontFamily: 'Palatino',
          textSizePt: 14,
          tocPlacement: 'end',
          notesPlacement: 'endnotes',
          zip: true,
        })}
        onChange={onChange}
      />,
    );

    expect((screen.getByTestId('settings-docx-custom-margin') as HTMLInputElement).value).toBe(
      '30',
    );
    expect((screen.getByTestId('settings-docx-custom-font-family') as HTMLInputElement).value).toBe(
      'Palatino',
    );
    expect((screen.getByTestId('settings-docx-reset-all') as HTMLButtonElement).disabled).toBe(
      false,
    );

    fireEvent.click(screen.getByTestId('settings-docx-reset-notes'));
    expect(onChange).toHaveBeenCalledWith({ notesPlacement: 'footnotes' });

    fireEvent.click(screen.getByTestId('settings-docx-reset-all'));
    expect(onChange).toHaveBeenLastCalledWith({ ...DOCX_DEFAULTS });
  });

  it('hides the ZIP checkbox in hideZip mode and leaves zip untouched on Reset all', () => {
    const onChange = vi.fn();
    render(
      <DocxPage
        draft={makeSettings({ defaultPageSize: 'a5', zip: true })}
        onChange={onChange}
        hideZip
      />,
    );
    expect(screen.queryByTestId('settings-docx-zip')).toBeNull();
    fireEvent.click(screen.getByTestId('settings-docx-reset-all'));
    const lastPatch = onChange.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(lastPatch).not.toHaveProperty('zip');
    expect(lastPatch.defaultPageSize).toBe('a4');
  });

  it('tracks dirty changes accurately in settingsPatch and validates customMargin range', () => {
    const base = makeSettings();
    const modified = makeSettings({ fontFamily: 'custom', customFontFamily: 'Bookerly' });
    const patch = settingsPatch(base, modified);
    expect(isEmptyPatch(patch)).toBe(false);
    expect(patch.docx).toEqual({ fontFamily: 'custom', customFontFamily: 'Bookerly' });

    const reverted = makeSettings({ fontFamily: 'Georgia', customFontFamily: '' });
    expect(isEmptyPatch(settingsPatch(base, reverted))).toBe(true);

    const invalid = makeSettings({ margins: 'custom', customMargin: 99 });
    const errs = validateSettings(invalid, i18next.t);
    expect(errs.some((e) => e.field === 'docx.customMargin')).toBe(true);
  });
});
