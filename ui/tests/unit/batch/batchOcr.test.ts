/**
 * Feature 020 (T048; US4, FR-020..FR-023): unit tests for Batch Converter PDF OCR config state,
 * control enable/disable helpers, 0-language validation blocking Start, scheduler OCR count and
 * itemised `BatchOcrReportEntry` aggregation, and saved plain-text report OCR section formatting.
 */

import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';

import type { CommandContext } from '@/app/commands';
import type { BatchAdapterFn } from '@/features/batch/adapters/adapterTypes';
import {
  createInitialBatchConfig,
  isBatchPdfOcrControlsEnabled,
  isBatchPdfOcrLanguagesEnabled,
  reduceBatchConfig,
  validateBatchConfig,
} from '@/features/batch/engine/configState';
import { formatBatchReportText } from '@/features/batch/engine/reportFormat';
import { startBatchRun } from '@/features/batch/engine/scheduler';
import type {
  BatchDiscoveredItem,
  BatchJobConfig,
  BatchReport,
} from '@/features/batch/engine/types';
import { initI18n } from '@/i18n';
import type { Settings } from '@/rpc/types';

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    schemaVersion: 1,
    imports: { pdf: { useOcr: true } },
    ocr: { folder: '', autoDetect: true, enabledLanguages: ['eng', 'rus'] },
    ...overrides,
  } as Settings;
}

describe('batch PDF OCR configuration & validation', () => {
  it('initializes batch OCR config from global Settings and enables controls only when To FB2 + PDF (+ Use OCR)', () => {
    const settings = makeSettings({
      imports: { pdf: { useOcr: false } },
      ocr: { folder: '', autoDetect: false, enabledLanguages: ['eng', 'deu'] },
    });

    let cfg = createInitialBatchConfig(4, settings);
    expect(cfg.pdfUseOcr).toBe(false);
    expect(cfg.ocrAutoDetect).toBe(false);
    expect(cfg.ocrLanguages).toEqual(['eng', 'deu']);
    // Direction starts as fb2ToExport -> PDF OCR controls disabled.
    expect(isBatchPdfOcrControlsEnabled(cfg)).toBe(false);
    expect(isBatchPdfOcrLanguagesEnabled(cfg)).toBe(false);

    // Switch to To FB2 (PDF checked by default) -> Use OCR toggle enabled, language controls off while pdfUseOcr=false.
    cfg = reduceBatchConfig(cfg, { type: 'setDirection', direction: 'importToFb2' }, 4, settings);
    expect(isBatchPdfOcrControlsEnabled(cfg)).toBe(true);
    expect(isBatchPdfOcrLanguagesEnabled(cfg)).toBe(false);

    // Check Use OCR -> language controls enabled.
    cfg = reduceBatchConfig(cfg, { type: 'setPdfUseOcr', checked: true }, 4, settings);
    expect(isBatchPdfOcrControlsEnabled(cfg)).toBe(true);
    expect(isBatchPdfOcrLanguagesEnabled(cfg)).toBe(true);

    // Uncheck PDF format -> both Use OCR and language controls disabled.
    cfg = reduceBatchConfig(
      cfg,
      { type: 'setImportFormat', format: 'pdf', checked: false },
      4,
      settings,
    );
    expect(isBatchPdfOcrControlsEnabled(cfg)).toBe(false);
    expect(isBatchPdfOcrLanguagesEnabled(cfg)).toBe(false);
  });

  it('blocks Start with batch.validation.noOcrLanguage when PDF + Use OCR are active and zero installed languages are checked', () => {
    const settings = makeSettings();
    let cfg = createInitialBatchConfig(4, settings);
    cfg = reduceBatchConfig(cfg, { type: 'setDirection', direction: 'importToFb2' }, 4, settings);
    cfg = reduceBatchConfig(cfg, { type: 'setSourceDir', path: '/books/src' }, 4, settings);
    expect(validateBatchConfig(cfg, ['eng', 'rus', 'deu'])).toBeNull();

    // Uncheck all OCR languages -> blocked.
    cfg = reduceBatchConfig(cfg, { type: 'setOcrLanguages', languages: [] }, 4, settings);
    expect(validateBatchConfig(cfg, ['eng', 'rus', 'deu'])).toBe('batch.validation.noOcrLanguage');
    expect(validateBatchConfig(cfg)).toBe('batch.validation.noOcrLanguage');

    // Only an uninstalled code remains -> blocked when installed catalog is provided.
    cfg = reduceBatchConfig(cfg, { type: 'setOcrLanguages', languages: ['jpn'] }, 4, settings);
    expect(validateBatchConfig(cfg, ['eng', 'rus', 'deu'])).toBe('batch.validation.noOcrLanguage');
    expect(validateBatchConfig(cfg, ['eng', 'rus', 'jpn'])).toBeNull();

    // Unchecking Use OCR allows starting even with 0 languages.
    cfg = reduceBatchConfig(cfg, { type: 'setPdfUseOcr', checked: false }, 4, settings);
    expect(validateBatchConfig(cfg, ['eng', 'rus', 'deu'])).toBeNull();

    // Re-checking Use OCR but unchecking PDF format also allows starting cleanly.
    cfg = reduceBatchConfig(cfg, { type: 'setPdfUseOcr', checked: true }, 4, settings);
    cfg = reduceBatchConfig(
      cfg,
      { type: 'setImportFormat', format: 'pdf', checked: false },
      4,
      settings,
    );
    expect(validateBatchConfig(cfg, ['eng', 'rus', 'deu'])).toBeNull();
  });
});

describe('batch scheduler OCR report aggregation & saved report formatting', () => {
  it('aggregates counts.ocr and itemised BatchOcrReportEntry records and formats the OCR section in en/ru/uk', async () => {
    const i18n = await initI18n({ instance: createInstance(), react: false, language: 'en' });
    const items: BatchDiscoveredItem[] = [
      {
        itemId: 'item-1',
        sourcePath: '/books/src/text.pdf',
        relativeDir: '',
        displayPath: 'text.pdf',
        format: 'pdf',
        archiveMultiBook: false,
        sizeBytes: 1024,
      },
      {
        itemId: 'item-2',
        sourcePath: '/books/src/scan.pdf',
        relativeDir: '',
        displayPath: 'scan.pdf',
        format: 'pdf',
        archiveMultiBook: false,
        sizeBytes: 2048,
      },
      {
        itemId: 'item-3',
        sourcePath: '/books/src/mixed.pdf',
        relativeDir: '',
        displayPath: 'mixed.pdf',
        format: 'pdf',
        archiveMultiBook: false,
        sizeBytes: 4096,
      },
    ];

    let claimSeq = 1;
    const rpc = {
      async call(method: string, params?: Record<string, unknown>): Promise<unknown> {
        switch (method) {
          case 'batch.scan':
            return { runId: 'run-ocr-1', sourceDir: '/books/src', items, scanErrors: [] };
          case 'batch.claimTarget':
            return {
              status: 'claimed',
              claimId: `claim-${claimSeq++}`,
              targetPath: String(params?.targetPath ?? ''),
            };
          case 'batch.releaseTarget':
          case 'batch.cleanupItem':
          case 'batch.endRun':
            return {};
          default:
            throw new Error(`Unexpected RPC: ${method}`);
        }
      },
      on() {
        return () => undefined;
      },
    };

    const ctx = {
      rpc,
      t: i18n.t.bind(i18n),
    } as unknown as CommandContext;

    const config: BatchJobConfig = {
      direction: 'importToFb2',
      exportFormat: 'epub',
      importAll: false,
      importFormats: { epub: false, mobi: false, pdf: true, txt: false, markdown: false },
      zipOutput: false,
      fixBroken: true,
      sourceDir: '/books/src',
      includeSubfolders: true,
      inPlace: false,
      destinationDir: '/books/out',
      keepTree: true,
      overwrite: false,
      parallel: false,
      workerCount: 1,
      pdfUseOcr: true,
      ocrAutoDetect: true,
      ocrLanguages: ['eng', 'rus'],
    };

    const mockAdapter: BatchAdapterFn = async ({ item }) => {
      if (item.displayPath === 'scan.pdf') {
        return {
          warnings: ['Low OCR confidence on 1 page'],
          ocr: {
            ocrPages: 10,
            ocrImageBlocks: 0,
            languages: ['en'],
            reason: '10 pages (English)',
          },
        };
      }
      if (item.displayPath === 'mixed.pdf') {
        return {
          warnings: [],
          ocr: {
            ocrPages: 2,
            ocrImageBlocks: 1,
            languages: ['ru', 'en'],
            reason: '2 pages, 1 images (Russian, English)',
          },
        };
      }
      return { warnings: [] };
    };

    const run = startBatchRun({
      ctx,
      config,
      settings: makeSettings(),
      cpuCores: 4,
      onProgress: () => undefined,
      adapterLoader: async () => mockAdapter,
    });

    const report: BatchReport | null = await run.promise;
    expect(report).not.toBeNull();
    expect(report!.counts.total).toBe(3);
    expect(report!.counts.converted).toBe(3);
    expect(report!.counts.ocr).toBe(2);
    expect(report!.ocr).toHaveLength(2);
    expect(report!.ocr?.[0]).toEqual({
      displayPath: 'scan.pdf',
      sourcePath: '/books/src/scan.pdf',
      targetPath: '/books/out/scan.fb2',
      ocrPages: 10,
      ocrImageBlocks: 0,
      languages: ['en'],
      reason: '10 pages (English)',
    });
    expect(report!.ocr?.[1]).toEqual({
      displayPath: 'mixed.pdf',
      sourcePath: '/books/src/mixed.pdf',
      targetPath: '/books/out/mixed.fb2',
      ocrPages: 2,
      ocrImageBlocks: 1,
      languages: ['ru', 'en'],
      reason: '2 pages, 1 images (Russian, English)',
    });

    for (const language of ['en', 'ru', 'uk'] as const) {
      const inst = await initI18n({ instance: createInstance(), react: false, language });
      const text = formatBatchReportText(report!, 1, inst.t.bind(inst));
      expect(text).toContain('OCR:');
      expect(text).toContain('OCR (2)');
      expect(text).toContain('scan.pdf -> /books/out/scan.fb2');
      expect(text).toContain('10 pages (English)');
      expect(text).toContain('mixed.pdf -> /books/out/mixed.fb2');
      expect(text).toContain('2 pages, 1 images (Russian, English)');
      expect(text).not.toContain('batch.reportFile.');
    }
  });
});
