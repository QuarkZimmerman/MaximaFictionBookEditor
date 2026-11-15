/**
 * Feature 014 (D2, D25, data-model KeptPageSize; tasks T047): the page size chosen for the open book.
 * The next export of the same book proposes it; another book in the window, or a new start of the
 * editor, proposes the default of Settings > PDF export again. It is kept from the moment an export
 * starts with it - a cancelled export keeps it too (analysis C7) - and is never stored anywhere.
 */
import type { PdfPageSizeId } from '@/rpc/types';

let kept: { docId: string; size: PdfPageSizeId } | null = null;

/** The size an export of `docId` started with. */
export function keepPageSize(docId: string, size: PdfPageSizeId): void {
  kept = { docId, size };
}

/** The size kept for `docId`, if it is still the window's book. */
export function keptPageSize(docId: string): PdfPageSizeId | undefined {
  return kept?.docId === docId ? kept.size : undefined;
}

/** For the tests: the editor as it starts. */
export function forgetKeptPageSize(): void {
  kept = null;
}
