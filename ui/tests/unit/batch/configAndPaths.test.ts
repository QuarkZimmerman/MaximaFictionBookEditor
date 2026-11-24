/**
 * Feature 019 (T026; data-model.md §2–§4): unit tests for Batch Converter configuration reducer,
 * session-only memory (always resetting `overwrite`), output path resolution, and active export
 * defaults summary formatting.
 */
import { createInstance } from 'i18next';
import { beforeEach, describe, expect, it } from 'vitest';

import { initI18n } from '@/i18n';
import type { Settings } from '@/rpc/types';

import {
  canRunParallel,
  computeMaxWorkers,
  createInitialBatchConfig,
  defaultZipOutput,
  effectiveWorkerCount,
  isZipOutputSupported,
  mergeBatchExportSettings,
  reduceBatchConfig,
  validateBatchConfig,
} from '@/features/batch/engine/configState';
import { formatActiveExportSummary } from '@/features/batch/engine/exportSummary';
import { resolveBatchTargetPath, stripBookStem } from '@/features/batch/engine/paths';
import type { BatchDiscoveredItem } from '@/features/batch/engine/types';
import {
  clearBatchSessionMemory,
  getBatchSessionMemory,
  saveBatchSessionMemory,
} from '@/features/batch/sessionState';

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    schemaVersion: 1,
    pdf: {
      defaultPageSize: 'a5',
      textFont: 'noto-serif',
      textSize: 'standard',
      margins: 'standard',
      customTextSize: 115,
      customMargin: 22,
      zip: true,
    },
    txt: {
      encodingMode: 'utf-8',
      encodings: { ru: 'windows-1251', uk: 'windows-1251', en: 'windows-1252', other: 'utf-8' },
      bom: true,
      zip: true,
    },
    mobi: {
      format: 'kf8',
      tocPlacement: 'afterTitle',
      seriesInTitle: 'seriesAndNumber',
      openAt: 'titlePage',
      kf8PopupFootnotes: true,
      zip: false,
    },
    markdown: {
      includePictures: true,
    },
    ...overrides,
  } as Settings;
}

describe('batch configState & sessionState', () => {
  beforeEach(() => {
    clearBatchSessionMemory();
  });

  it('enforces CPU-core-derived parallel limits across 1, 2, 4, and 8 cores', () => {
    expect(computeMaxWorkers(1)).toBe(1);
    expect(canRunParallel(1)).toBe(false);
    expect(computeMaxWorkers(2)).toBe(1);
    expect(canRunParallel(2)).toBe(false);
    expect(computeMaxWorkers(4)).toBe(3);
    expect(canRunParallel(4)).toBe(true);
    expect(computeMaxWorkers(8)).toBe(7);

    const cfg1 = createInitialBatchConfig(1, makeSettings());
    expect(cfg1.parallel).toBe(false);
    expect(cfg1.workerCount).toBe(1);
    expect(effectiveWorkerCount(cfg1, 1)).toBe(1);

    const cfg2 = createInitialBatchConfig(2, makeSettings());
    expect(cfg2.parallel).toBe(false);
    expect(cfg2.workerCount).toBe(1);
    expect(effectiveWorkerCount(cfg2, 2)).toBe(1);

    const cfg8 = createInitialBatchConfig(8, makeSettings());
    expect(cfg8.parallel).toBe(true);
    expect(cfg8.workerCount).toBe(7);
    expect(effectiveWorkerCount(cfg8, 8)).toBe(7);

    const clamped = reduceBatchConfig(cfg8, { type: 'setWorkerCount', count: 99 }, 8, null);
    expect(clamped.workerCount).toBe(7);
    const lowered = reduceBatchConfig(clamped, { type: 'setWorkerCount', count: 1 }, 8, null);
    expect(lowered.workerCount).toBe(2);
    const seq = reduceBatchConfig(lowered, { type: 'setParallel', checked: false }, 8, null);
    expect(effectiveWorkerCount(seq, 8)).toBe(1);
  });

  it('enforces Include subfolders / Keep tree / In-place coupling invariants with In-place default on', () => {
    const settings = makeSettings();
    let cfg = createInitialBatchConfig(4, settings);
    expect(cfg.includeSubfolders).toBe(true);
    expect(cfg.inPlace).toBe(true);
    expect(cfg.keepTree).toBe(false);

    // Unchecking In-place while Include subfolders is on defaults Keep tree to true.
    cfg = reduceBatchConfig(cfg, { type: 'setInPlace', checked: false }, 4, settings);
    expect(cfg.inPlace).toBe(false);
    expect(cfg.includeSubfolders).toBe(true);
    expect(cfg.keepTree).toBe(true);

    // Unchecking Include subfolders forces Keep tree off.
    cfg = reduceBatchConfig(cfg, { type: 'setIncludeSubfolders', checked: false }, 4, settings);
    expect(cfg.includeSubfolders).toBe(false);
    expect(cfg.keepTree).toBe(false);

    // Re-checking Include subfolders allows re-enabling Keep tree.
    cfg = reduceBatchConfig(cfg, { type: 'setIncludeSubfolders', checked: true }, 4, settings);
    cfg = reduceBatchConfig(cfg, { type: 'setKeepTree', checked: true }, 4, settings);
    expect(cfg.keepTree).toBe(true);

    // Re-enabling In-place forces Keep tree off while preserving Include subfolders.
    cfg = reduceBatchConfig(cfg, { type: 'setInPlace', checked: true }, 4, settings);
    expect(cfg.inPlace).toBe(true);
    expect(cfg.includeSubfolders).toBe(true);
    expect(cfg.keepTree).toBe(false);
  });

  it('initializes zipOutput from Settings -> Exports for PDF/TXT/MOBI and blocks ZIP for EPUB', () => {
    const settings = makeSettings();
    expect(isZipOutputSupported('fb2ToExport', 'epub')).toBe(false);
    expect(isZipOutputSupported('fb2ToExport', 'pdf')).toBe(true);
    expect(isZipOutputSupported('fb2ToExport', 'markdown')).toBe(true);
    expect(isZipOutputSupported('importToFb2', 'epub')).toBe(true);

    expect(defaultZipOutput('fb2ToExport', 'epub', settings)).toBe(false);
    expect(defaultZipOutput('fb2ToExport', 'pdf', settings)).toBe(true);
    expect(defaultZipOutput('fb2ToExport', 'txt', settings)).toBe(true);
    expect(defaultZipOutput('fb2ToExport', 'mobi', settings)).toBe(false);
    expect(defaultZipOutput('fb2ToExport', 'markdown', settings)).toBe(false);
    expect(defaultZipOutput('importToFb2', 'epub', settings)).toBe(false);

    let cfg = createInitialBatchConfig(4, settings);
    cfg = reduceBatchConfig(cfg, { type: 'setExportFormat', format: 'pdf' }, 4, settings);
    expect(cfg.zipOutput).toBe(true);
    cfg = reduceBatchConfig(cfg, { type: 'setExportFormat', format: 'epub' }, 4, settings);
    expect(cfg.zipOutput).toBe(false);
  });

  it('persists all choices (including fixBroken, overwrite, and batch-only export settings with unknown future keys) without mutating global settings', () => {
    const settings = makeSettings();
    let cfg = createInitialBatchConfig(8, settings);
    expect(cfg.fixBroken).toBe(true);
    expect(cfg.overwrite).toBe(false);

    cfg = reduceBatchConfig(cfg, { type: 'setExportFormat', format: 'txt' }, 8, settings);
    cfg = reduceBatchConfig(cfg, { type: 'setInPlace', checked: false }, 8, settings);
    cfg = reduceBatchConfig(cfg, { type: 'setSourceDir', path: '/books/in' }, 8, settings);
    cfg = reduceBatchConfig(cfg, { type: 'setDestinationDir', path: '/books/out' }, 8, settings);
    cfg = reduceBatchConfig(cfg, { type: 'setWorkerCount', count: 3 }, 8, settings);
    cfg = reduceBatchConfig(cfg, { type: 'setFixBroken', checked: false }, 8, settings);
    cfg = reduceBatchConfig(cfg, { type: 'setOverwrite', checked: true }, 8, settings);
    expect(cfg.overwrite).toBe(true);
    expect(cfg.fixBroken).toBe(false);

    saveBatchSessionMemory(
      cfg,
      { 'fb2ToExport:txt': false },
      {
        mobi: { format: 'mobi7' },
        markdown: { includePictures: false },
        pdf: { defaultPageSize: 'a5', futureOpt: 'keep' } as unknown as NonNullable<
          Settings['pdf']
        >,
      },
    );
    const memory = getBatchSessionMemory();
    const restored = createInitialBatchConfig(8, settings, memory);
    expect(restored.exportFormat).toBe('txt');
    expect(restored.inPlace).toBe(false);
    expect(restored.sourceDir).toBe('/books/in');
    expect(restored.destinationDir).toBe('/books/out');
    expect(restored.workerCount).toBe(3);
    expect(restored.zipOutput).toBe(false);
    expect(restored.fixBroken).toBe(false);
    expect(restored.overwrite).toBe(true);

    // Merging batch-only overrides produces effective settings (and keeps future keys) without
    // mutating global settings.
    const merged = mergeBatchExportSettings(settings, memory?.exportSettingsOverrides);
    expect(merged?.mobi?.format).toBe('mobi7');
    expect(merged?.markdown?.includePictures).toBe(false);
    expect((merged?.pdf as unknown as Record<string, unknown>)?.futureOpt).toBe('keep');
    expect(settings.mobi?.format).toBe('kf8');
    expect(settings.markdown?.includePictures).toBe(true);
  });

  it('validates required paths and non-empty import format selection', () => {
    const settings = makeSettings();
    let cfg = createInitialBatchConfig(4, settings);
    expect(validateBatchConfig(cfg)).toBe('batch.validation.missingSource');
    cfg = reduceBatchConfig(cfg, { type: 'setSourceDir', path: '/src' }, 4, settings);
    // In-place defaults to true, so Source alone is valid immediately.
    expect(validateBatchConfig(cfg)).toBeNull();
    cfg = reduceBatchConfig(cfg, { type: 'setInPlace', checked: false }, 4, settings);
    expect(validateBatchConfig(cfg)).toBe('batch.validation.missingDestination');
    cfg = reduceBatchConfig(cfg, { type: 'setDestinationDir', path: '/dst' }, 4, settings);
    expect(validateBatchConfig(cfg)).toBeNull();
  });
});

describe('batch output path resolution (data-model.md §4)', () => {
  const settings = makeSettings();

  it('strips compound archive extensions cleanly', () => {
    expect(stripBookStem('novel.fb2.zip')).toBe('novel');
    expect(stripBookStem('story.MD.ZIP')).toBe('story');
    expect(stripBookStem('book.markdown.zip')).toBe('book');
    expect(stripBookStem('plain.fb2')).toBe('plain');
  });

  it('resolves mirrored, flat, and in-place bare files across all 5 export formats + ZIP', () => {
    const item: BatchDiscoveredItem = {
      itemId: 'i1',
      sourcePath: '/src/a/b/novel.fb2',
      relativeDir: 'a/b',
      displayPath: 'a/b/novel.fb2',
      format: 'fb2',
      archiveMultiBook: false,
      sizeBytes: 100,
    };

    const base = {
      ...createInitialBatchConfig(4, settings),
      sourceDir: '/src',
      destinationDir: '/dst',
      inPlace: false,
      keepTree: true,
    };

    // Mirrored EPUB
    expect(
      resolveBatchTargetPath(item, { ...base, exportFormat: 'epub', keepTree: true }, settings)
        .targetPath,
    ).toBe('/dst/a/b/novel.epub');
    // Flat EPUB
    expect(
      resolveBatchTargetPath(item, { ...base, exportFormat: 'epub', keepTree: false }, settings)
        .targetPath,
    ).toBe('/dst/novel.epub');
    // In-place MOBI (kf8 -> .azw3; mobi7/joint -> .mobi; zip -> .zip)
    expect(
      resolveBatchTargetPath(
        item,
        { ...base, exportFormat: 'mobi', inPlace: true, zipOutput: false },
        settings,
      ).targetPath,
    ).toBe('/src/a/b/novel.azw3');
    expect(
      resolveBatchTargetPath(
        item,
        { ...base, exportFormat: 'mobi', inPlace: true, zipOutput: false },
        makeSettings({ mobi: { ...settings.mobi!, format: 'joint' } }),
      ).targetPath,
    ).toBe('/src/a/b/novel.mobi');
    expect(
      resolveBatchTargetPath(
        item,
        { ...base, exportFormat: 'mobi', inPlace: true, zipOutput: true },
        settings,
      ).targetPath,
    ).toBe('/src/a/b/novel.zip');
    // PDF & TXT bare vs ZIP
    expect(
      resolveBatchTargetPath(item, { ...base, exportFormat: 'pdf', zipOutput: false }, settings)
        .targetPath,
    ).toBe('/dst/a/b/novel.pdf');
    expect(
      resolveBatchTargetPath(item, { ...base, exportFormat: 'pdf', zipOutput: true }, settings)
        .targetPath,
    ).toBe('/dst/a/b/novel.zip');
    expect(
      resolveBatchTargetPath(item, { ...base, exportFormat: 'txt', zipOutput: false }, settings)
        .targetPath,
    ).toBe('/dst/a/b/novel.txt');
    expect(
      resolveBatchTargetPath(item, { ...base, exportFormat: 'txt', zipOutput: true }, settings)
        .targetPath,
    ).toBe('/dst/a/b/novel.zip');
    // Markdown bare vs .md.zip
    expect(
      resolveBatchTargetPath(
        item,
        { ...base, exportFormat: 'markdown', zipOutput: false },
        settings,
      ).targetPath,
    ).toBe('/dst/a/b/novel.md');
    expect(
      resolveBatchTargetPath(item, { ...base, exportFormat: 'markdown', zipOutput: true }, settings)
        .targetPath,
    ).toBe('/dst/a/b/novel.md.zip');
  });

  it('resolves single-book and multi-book ZIP archives according to archiveStem & keepTree rules', () => {
    const base = {
      ...createInitialBatchConfig(4, settings),
      sourceDir: '/src',
      destinationDir: '/dst',
      inPlace: false,
      keepTree: true,
      exportFormat: 'epub' as const,
      zipOutput: false,
    };

    // Single-book .fb2.zip uses archive's own base name regardless of internal entry name.
    const singleZip: BatchDiscoveredItem = {
      itemId: 'i1',
      sourcePath: '/src/sub/my-book.fb2.zip',
      relativeDir: 'sub',
      displayPath: 'sub/my-book.fb2.zip',
      format: 'fb2',
      archiveEntry: 'inner/random-name.fb2',
      archiveMultiBook: false,
      archiveStem: 'my-book',
      sizeBytes: 50,
    };
    expect(
      resolveBatchTargetPath(singleZip, { ...base, keepTree: true }, settings).targetPath,
    ).toBe('/dst/sub/my-book.epub');

    // Multi-book .zip writes into <archiveStem>/ (mirroring internal subfolders when keepTree && !inPlace).
    const multiZip: BatchDiscoveredItem = {
      itemId: 'i2',
      sourcePath: '/src/sub/pack.zip',
      relativeDir: 'sub',
      displayPath: 'sub/pack.zip :: vol1/ch1.fb2',
      format: 'fb2',
      archiveEntry: 'vol1/ch1.fb2',
      archiveMultiBook: true,
      archiveStem: 'pack',
      sizeBytes: 50,
    };
    expect(resolveBatchTargetPath(multiZip, { ...base, keepTree: true }, settings).targetPath).toBe(
      '/dst/sub/pack/vol1/ch1.epub',
    );
    expect(
      resolveBatchTargetPath(multiZip, { ...base, keepTree: false }, settings).targetPath,
    ).toBe('/dst/pack/ch1.epub');
    expect(
      resolveBatchTargetPath(multiZip, { ...base, inPlace: true, keepTree: false }, settings)
        .targetPath,
    ).toBe('/src/sub/pack/ch1.epub');
  });
});

describe('formatActiveExportSummary', () => {
  it('formats concise active Settings -> Exports summaries for all 5 export formats', async () => {
    const inst = await initI18n({ instance: createInstance(), react: false, language: 'en' });
    const t = inst.t.bind(inst);
    const settings = makeSettings();
    expect(formatActiveExportSummary('epub', settings, false, t)).toContain('EPUB');
    expect(formatActiveExportSummary('pdf', settings, false, t)).toContain('A5');
    expect(formatActiveExportSummary('txt', settings, false, t)).toContain('UTF-8');
    expect(formatActiveExportSummary('txt', settings, false, t)).toContain('BOM');
    expect(formatActiveExportSummary('mobi', settings, false, t)).toContain('KF8');
    expect(formatActiveExportSummary('markdown', settings, false, t)).toContain('Yes');
    expect(formatActiveExportSummary('markdown', settings, true, t)).toContain('ZIP');
  });
});
