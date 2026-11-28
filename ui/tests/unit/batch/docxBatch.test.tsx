/**
 * Feature 023 (T038): unit tests for Batch Converter DOCX state (`configState`, `paths`,
 * `exportSummary`), `BatchExportSettingsDialog` with `'docx'` (`hideZip`), and lazy
 * `loadBatchAdapter` dispatch in both directions.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { BatchExportSettingsDialog } from '@/features/batch/BatchExportSettingsDialog';
import { loadBatchAdapter } from '@/features/batch/adapters/registry';
import {
  applyBatchExportSettingsPatch,
  createInitialBatchConfig,
  extractExportSettingsFromGlobal,
  mergeBatchExportSettings,
  reduceBatchConfig,
} from '@/features/batch/engine/configState';
import { formatActiveExportSummary } from '@/features/batch/engine/exportSummary';
import { resolveTargetExtension } from '@/features/batch/engine/paths';
import { BATCH_BOOK_FORMATS } from '@/features/batch/engine/types';
import { DOCX_DEFAULTS } from '@/features/docx/docxSettingsSchema';
import i18next, { changeLanguage, initI18n } from '@/i18n';
import type { Settings } from '@/rpc/types';

import { makeContext } from '../features/testUtils';

beforeAll(async () => {
  await initI18n({ language: 'en' });
  await changeLanguage('en');
});
afterEach(cleanup);

function makeSettings(docx?: Partial<NonNullable<Settings['docx']>>): Settings {
  return {
    schemaVersion: 1,
    docx: { ...DOCX_DEFAULTS, ...docx },
  } as Settings;
}

describe('Batch Converter DOCX integration', () => {
  it('includes docx across BATCH_BOOK_FORMATS, target extensions, zip defaults, and export summary', () => {
    expect(BATCH_BOOK_FORMATS).toContain('docx');
    expect(
      resolveTargetExtension({ direction: 'fb2ToExport', exportFormat: 'docx', zipOutput: false }),
    ).toBe('.docx');
    expect(
      resolveTargetExtension({ direction: 'fb2ToExport', exportFormat: 'docx', zipOutput: true }),
    ).toBe('.zip');

    const settings = makeSettings({
      defaultPageSize: 'letter',
      fontFamily: 'Cambria',
      textSizePt: 11,
      zip: true,
    });
    const cfg = createInitialBatchConfig(4, settings);
    expect(cfg.importFormats.docx).toBe(true);
    const switched = reduceBatchConfig(
      cfg,
      { type: 'setExportFormat', format: 'docx' },
      4,
      settings,
    );
    expect(switched.exportFormat).toBe('docx');
    expect(switched.zipOutput).toBe(true);

    const summary = formatActiveExportSummary('docx', settings, false, i18next.t);
    expect(summary).toContain('Cambria');
    expect(summary).toContain('11 pt');
  });

  it('clones and merges batch-only docx export settings without mutating global Settings', () => {
    const globalSettings = makeSettings({ defaultPageSize: 'a4', fontFamily: 'Georgia' });
    const seed = extractExportSettingsFromGlobal(globalSettings);
    const patched = applyBatchExportSettingsPatch(seed, {
      docx: { defaultPageSize: 'a5', fontFamily: 'custom', customFontFamily: 'Palatino' },
    });
    const merged = mergeBatchExportSettings(globalSettings, patched);
    expect(merged?.docx?.defaultPageSize).toBe('a5');
    expect(merged?.docx?.customFontFamily).toBe('Palatino');
    expect(globalSettings.docx?.defaultPageSize).toBe('a4');
  });

  it('renders DocxPage inside BatchExportSettingsDialog with hideZip and strips zip from patch', async () => {
    const onSave = vi.fn();
    const ctx = await makeContext();
    render(
      <BatchExportSettingsDialog
        ctx={ctx}
        format="docx"
        effectiveSettings={makeSettings({ zip: true })}
        onApply={vi.fn()}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId('settings-page-docx')).toBeTruthy();
    expect(screen.queryByTestId('settings-docx-zip')).toBeNull();

    fireEvent.change(screen.getByTestId('settings-docx-notes'), { target: { value: 'endnotes' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0]?.[0] as Record<string, Record<string, unknown>>;
    expect(saved.docx?.notesPlacement).toBe('endnotes');
    expect(saved.docx).not.toHaveProperty('zip');
  });

  it('dispatches lazy docx adapters in both directions', async () => {
    const toDocx = await loadBatchAdapter('fb2ToExport', 'docx');
    const fromDocx = await loadBatchAdapter('importToFb2', 'docx');
    expect(typeof toDocx).toBe('function');
    expect(typeof fromDocx).toBe('function');
  });
});
