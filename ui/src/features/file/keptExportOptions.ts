/**
 * Feature 017 (D17, DP-6; replaces feature 014's keptPageSize.ts): the options chosen in an export's
 * dialog, kept for the book open in the window - by its document id - from the moment an export
 * starts (a cancelled export included; a cancelled Save dialog keeps nothing). Another book in the
 * window (open, import, New: a new document id) or a new start of the editor forgets them, and the
 * defaults of Settings > Exports serve again. Never stored anywhere.
 */

import type { MobiFormat } from '@/rpc/types';

export interface PdfKept {
  pageSize: string;
  zip: boolean;
}
export interface MarkdownKept {
  includePictures: boolean;
}
export interface TxtKept {
  encoding: string;
  bom: boolean;
  zip: boolean;
}
export interface MobiKept {
  format: MobiFormat;
  zip: boolean;
}
export interface DocxKept {
  pageSize: string;
  zip: boolean;
}
export interface KeptByFormat {
  pdf: PdfKept;
  markdown: MarkdownKept;
  txt: TxtKept;
  mobi: MobiKept;
  docx: DocxKept;
}
export type ExportFormat = keyof KeptByFormat;

let kept: { docId: string; options: Partial<KeptByFormat> } | null = null;

/** The options an export of `format` for `docId` started with. */
export function keepExportOptions<F extends ExportFormat>(
  docId: string,
  format: F,
  options: KeptByFormat[F],
): void {
  if (kept?.docId !== docId) kept = { docId, options: {} };
  kept.options[format] = { ...options };
}

/** The options kept for `docId` and `format`, if the book is still the window's. */
export function keptExportOptions<F extends ExportFormat>(
  docId: string,
  format: F,
): KeptByFormat[F] | undefined {
  if (kept?.docId !== docId) return undefined;
  const options = kept.options[format];
  return options ? ({ ...options } as KeptByFormat[F]) : undefined;
}

/**
 * The TXT encoding kept for `docId`, when the book's present list still offers it (D17: a kept
 * encoding the book's new language does not offer gives way to the default).
 */
export function keptTxtEncoding(docId: string, offered: readonly string[]): string | undefined {
  const encoding = keptExportOptions(docId, 'txt')?.encoding;
  return encoding !== undefined && offered.includes(encoding) ? encoding : undefined;
}

/** For the tests: the editor as it starts. */
export function forgetKeptExportOptions(): void {
  kept = null;
}
