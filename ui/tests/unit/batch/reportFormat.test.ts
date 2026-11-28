/**
 * Feature 019 (T046; US3): Unit tests for saved plain-text batch conversion report formatting
 * (contracts/batch-report.md): section order, empty-section `(0)` + None, Failed, Skipped,
 * Warnings on converted files, Cancelled status, default filename, and en/ru/uk localisation.
 */

import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';

import { defaultReportFilename, formatBatchReportText } from '@/features/batch/engine/reportFormat';
import type { BatchJobConfig, BatchReport } from '@/features/batch/engine/types';
import { initI18n } from '@/i18n';

function baseConfig(overrides: Partial<BatchJobConfig> = {}): BatchJobConfig {
  return {
    direction: 'fb2ToExport',
    exportFormat: 'epub',
    importAll: true,
    importFormats: { epub: true, mobi: true, pdf: true, txt: true, markdown: true, docx: true },
    sourceDir: '/books/src',
    destinationDir: '/books/out',
    includeSubfolders: true,
    keepTree: true,
    inPlace: false,
    zipOutput: false,
    fixBroken: true,
    overwrite: false,
    parallel: true,
    workerCount: 4,
    pdfUseOcr: true,
    ocrAutoDetect: true,
    ocrLanguages: ['eng', 'rus'],
    ...overrides,
  };
}

function sampleReport(overrides: Partial<BatchReport> = {}): BatchReport {
  return {
    startedAtIso: '2026-11-22T15:40:12.000Z',
    finishedAtIso: '2026-11-22T15:40:28.200Z',
    durationMs: 16200,
    cancelled: false,
    config: baseConfig(),
    exportDefaultsSummary: 'EPUB 3.3',
    counts: { total: 5, converted: 2, fixed: 1, skipped: 1, failed: 1, cancelled: 1 },
    fixed: [
      {
        displayPath: 'repaired/broken.fb2',
        sourcePath: '/books/src/repaired/broken.fb2',
        targetPath: '/books/out/repaired/broken.epub',
        reason: 'Broken XML repaired in memory (line 209, column 15): tag mismatch',
      },
    ],
    failed: [
      {
        displayPath: 'bad/corrupt.fb2',
        sourcePath: '/books/src/bad/corrupt.fb2',
        targetPath: '/books/out/bad/corrupt.epub',
        reason: 'Malformed XML at line 42',
      },
    ],
    skipped: [
      {
        displayPath: 'dup/existing.fb2',
        sourcePath: '/books/src/dup/existing.fb2',
        targetPath: '/books/out/dup/existing.epub',
        reason: 'Output file already exists.',
      },
    ],
    warnings: [
      {
        displayPath: 'warn/old.fb2',
        sourcePath: '/books/src/warn/old.fb2',
        targetPath: '/books/out/warn/old.epub',
        messages: ['Missing picture omitted: cover.jpg', 'Broken internal link (x2)'],
      },
    ],
    ...overrides,
  };
}

describe('defaultReportFilename', () => {
  it('formats batch-conversion-report-YYYYMMDD-HHMMSS.txt', () => {
    const dt = new Date(2026, 10, 22, 9, 5, 3);
    expect(defaultReportFilename(dt)).toBe('batch-conversion-report-20261122-090503.txt');
  });
});

describe('formatBatchReportText', () => {
  it('emits all contract sections in fixed order with Failed, Skipped, and Warnings on converted files', async () => {
    const inst = await initI18n({ instance: createInstance(), react: false, language: 'en' });
    const text = formatBatchReportText(sampleReport(), 4, inst.t.bind(inst));

    expect(text.endsWith('\n')).toBe(true);
    expect(text).not.toContain('\r');
    expect(text).toContain('Maxima Fiction Book Editor');
    expect(text).toContain('16.2 s');
    expect(text).toContain('EPUB 3.3');
    expect(text).toContain('Failed (1)');
    expect(text).toContain('1. bad/corrupt.fb2 -> /books/out/bad/corrupt.epub');
    expect(text).toContain('Malformed XML at line 42');
    expect(text).toContain('Skipped (1)');
    expect(text).toContain('1. dup/existing.fb2 -> /books/out/dup/existing.epub');
    expect(text).toContain('Output file already exists.');
    expect(text).toContain('Fixed (1)');
    expect(text).toContain('1. repaired/broken.fb2 -> /books/out/repaired/broken.epub');
    expect(text).toContain('Broken XML repaired in memory');
    expect(text).toContain('Warnings on converted files (1)');
    expect(text).toContain('1. warn/old.fb2 -> /books/out/warn/old.epub');
    expect(text).toContain('   - Missing picture omitted: cover.jpg');
    expect(text).toContain('   - Broken internal link (x2)');

    // Fixed section order: Summary -> Failed -> Skipped -> Fixed -> Warnings on converted files
    const idxSummary = text.indexOf('Summary');
    const idxFailed = text.indexOf('Failed (1)');
    const idxSkipped = text.indexOf('Skipped (1)');
    const idxFixed = text.indexOf('Fixed (1)');
    const idxWarnings = text.indexOf('Warnings on converted files (1)');
    expect(idxSummary).toBeGreaterThan(0);
    expect(idxFailed).toBeGreaterThan(idxSummary);
    expect(idxSkipped).toBeGreaterThan(idxFailed);
    expect(idxFixed).toBeGreaterThan(idxSkipped);
    expect(idxWarnings).toBeGreaterThan(idxFixed);
  });

  it('emits (0) and localised None. for empty Failed, Skipped, Fixed, and Warnings sections and handles Cancelled + in-place Import', async () => {
    const inst = await initI18n({ instance: createInstance(), react: false, language: 'en' });
    const report = sampleReport({
      cancelled: true,
      config: baseConfig({
        direction: 'importToFb2',
        inPlace: true,
        zipOutput: true,
        parallel: false,
        importFormats: {
          epub: false,
          mobi: true,
          pdf: true,
          txt: false,
          markdown: false,
          docx: false,
        },
      }),
      exportDefaultsSummary: undefined,
      counts: { total: 4, converted: 1, fixed: 0, skipped: 0, failed: 0, cancelled: 3 },
      fixed: [],
      failed: [],
      skipped: [],
      warnings: [],
    });

    const text = formatBatchReportText(report, 1, inst.t.bind(inst));
    expect(text).toContain('Cancelled');
    expect(text).toContain('Failed (0)');
    expect(text).toContain('Skipped (0)');
    expect(text).toContain('Fixed (0)');
    expect(text).toContain('Warnings on converted files (0)');
    expect(text.match(/None\./g)?.length).toBe(4);
    expect(text).not.toContain('Export opts');
  });

  it('localises headings and labels cleanly into en, ru, and uk with zero missing keys', async () => {
    for (const language of ['en', 'ru', 'uk'] as const) {
      const inst = await initI18n({ instance: createInstance(), react: false, language });
      const text = formatBatchReportText(sampleReport(), 3, inst.t.bind(inst));
      expect(text.length).toBeGreaterThan(200);
      expect(text).not.toContain('batch.reportFile.');
    }
  });
});
