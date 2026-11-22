/**
 * Feature 019 (T037; US2): Vitest unit tests for Import -> FB2 format checkbox synchronization,
 * zero-selected validation guard, and import output path rules (.fb2 vs .fb2.zip, multi-book ZIP).
 */
import { describe, expect, it } from 'vitest';

import {
  createInitialBatchConfig,
  reduceBatchConfig,
  selectedImportFormats,
  validateBatchConfig,
} from '@/features/batch/engine/configState';
import { resolveBatchTargetPath } from '@/features/batch/engine/paths';
import { BATCH_BOOK_FORMATS, type BatchDiscoveredItem } from '@/features/batch/engine/types';

describe('batch import format filters and output paths (US2)', () => {
  it('syncs All supported formats with individual format checkboxes and blocks 0 selected', () => {
    let cfg = createInitialBatchConfig(4, null);
    cfg = reduceBatchConfig(cfg, { type: 'setDirection', direction: 'importToFb2' }, 4, null);
    cfg = reduceBatchConfig(cfg, { type: 'setSourceDir', path: '/in' }, 4, null);
    cfg = reduceBatchConfig(cfg, { type: 'setDestinationDir', path: '/out' }, 4, null);

    expect(cfg.importAll).toBe(true);
    expect(selectedImportFormats(cfg)).toEqual([...BATCH_BOOK_FORMATS]);
    expect(validateBatchConfig(cfg)).toBeNull();

    // Unchecking one format clears All supported formats.
    cfg = reduceBatchConfig(
      cfg,
      { type: 'setImportFormat', format: 'epub', checked: false },
      4,
      null,
    );
    expect(cfg.importAll).toBe(false);
    expect(selectedImportFormats(cfg)).toEqual(['mobi', 'pdf', 'txt', 'markdown']);

    // Re-checking that format restores All supported formats.
    cfg = reduceBatchConfig(
      cfg,
      { type: 'setImportFormat', format: 'epub', checked: true },
      4,
      null,
    );
    expect(cfg.importAll).toBe(true);

    // Unchecking All unchecks every individual format and blocks start with validation error.
    cfg = reduceBatchConfig(cfg, { type: 'setImportAll', checked: false }, 4, null);
    expect(cfg.importAll).toBe(false);
    expect(selectedImportFormats(cfg)).toEqual([]);
    expect(validateBatchConfig(cfg)).toBe('batch.validation.noImportFormat');

    // Selecting MOBI + PDF subset makes config valid again.
    cfg = reduceBatchConfig(
      cfg,
      { type: 'setImportFormat', format: 'mobi', checked: true },
      4,
      null,
    );
    cfg = reduceBatchConfig(
      cfg,
      { type: 'setImportFormat', format: 'pdf', checked: true },
      4,
      null,
    );
    expect(cfg.importAll).toBe(false);
    expect(selectedImportFormats(cfg)).toEqual(['mobi', 'pdf']);
    expect(validateBatchConfig(cfg)).toBeNull();
  });

  it('resolves bare, single-book .zip/.md.zip, and multi-book .zip import outputs to .fb2 and .fb2.zip', () => {
    const base = reduceBatchConfig(
      {
        ...createInitialBatchConfig(4, null),
        sourceDir: '/in',
        destinationDir: '/out',
      },
      { type: 'setDirection', direction: 'importToFb2' },
      4,
      null,
    );
    expect(base.zipOutput).toBe(false);

    const bareMobi: BatchDiscoveredItem = {
      itemId: 'i1',
      sourcePath: '/in/sub/novel.azw3',
      relativeDir: 'sub',
      displayPath: 'sub/novel.azw3',
      format: 'mobi',
      archiveMultiBook: false,
      sizeBytes: 200,
    };
    expect(resolveBatchTargetPath(bareMobi, { ...base, zipOutput: false }, null).targetPath).toBe(
      '/out/sub/novel.fb2',
    );
    expect(resolveBatchTargetPath(bareMobi, { ...base, zipOutput: true }, null).targetPath).toBe(
      '/out/sub/novel.fb2.zip',
    );

    const mdZip: BatchDiscoveredItem = {
      itemId: 'i2',
      sourcePath: '/in/docs/article.md.zip',
      relativeDir: 'docs',
      displayPath: 'docs/article.md.zip',
      format: 'markdown',
      archiveEntry: 'inner.md',
      archiveMultiBook: false,
      archiveStem: 'article',
      sizeBytes: 120,
    };
    expect(resolveBatchTargetPath(mdZip, { ...base, zipOutput: false }, null).targetPath).toBe(
      '/out/docs/article.fb2',
    );
    expect(resolveBatchTargetPath(mdZip, { ...base, zipOutput: true }, null).targetPath).toBe(
      '/out/docs/article.fb2.zip',
    );

    const multiZip: BatchDiscoveredItem = {
      itemId: 'i3',
      sourcePath: '/in/shelf/bundle.zip',
      relativeDir: 'shelf',
      displayPath: 'shelf/bundle.zip :: part1/book.pdf',
      format: 'pdf',
      archiveEntry: 'part1/book.pdf',
      archiveMultiBook: true,
      archiveStem: 'bundle',
      sizeBytes: 500,
    };
    expect(resolveBatchTargetPath(multiZip, { ...base, keepTree: true, zipOutput: false }, null).targetPath).toBe(
      '/out/shelf/bundle/part1/book.fb2',
    );
    expect(resolveBatchTargetPath(multiZip, { ...base, keepTree: false, zipOutput: true }, null).targetPath).toBe(
      '/out/bundle/book.fb2.zip',
    );
  });
});
