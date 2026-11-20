// Feature 017 (T015; D17, DP-6): options kept per format for the window's book.
import { afterEach, describe, expect, it } from 'vitest';

import {
  forgetKeptExportOptions,
  keepExportOptions,
  keptExportOptions,
  keptTxtEncoding,
} from '@/features/file/keptExportOptions';

afterEach(() => forgetKeptExportOptions());

describe('keptExportOptions', () => {
  it('keeps each format for the same document and forgets them for another', () => {
    keepExportOptions('doc-1', 'pdf', { pageSize: 'a5', zip: true });
    keepExportOptions('doc-1', 'txt', { encoding: 'koi8-r', bom: false, zip: false });
    expect(keptExportOptions('doc-1', 'pdf')).toEqual({ pageSize: 'a5', zip: true });
    expect(keptExportOptions('doc-1', 'txt')?.encoding).toBe('koi8-r');
    expect(keptExportOptions('doc-1', 'markdown')).toBeUndefined();
    expect(keptExportOptions('doc-2', 'pdf')).toBeUndefined();
    keepExportOptions('doc-2', 'markdown', { includePictures: false });
    expect(keptExportOptions('doc-1', 'pdf')).toBeUndefined();
    expect(keptExportOptions('doc-2', 'markdown')).toEqual({ includePictures: false });
  });

  it('drops a kept encoding the book no longer offers', () => {
    keepExportOptions('doc-1', 'txt', { encoding: 'koi8-r', bom: false, zip: false });
    expect(keptTxtEncoding('doc-1', ['utf-8', 'windows-1251', 'koi8-r'])).toBe('koi8-r');
    expect(keptTxtEncoding('doc-1', ['utf-8', 'windows-1252'])).toBeUndefined();
  });

  it('is empty when the editor starts', () => {
    expect(keptExportOptions('doc-1', 'pdf')).toBeUndefined();
  });
});
