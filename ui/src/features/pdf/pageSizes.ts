/**
 * Feature 014 (D3, data-model PageSize): the PDF export's nine page sizes, portrait, in D3's order.
 * The core holds the same table for its own checks (core/src/server/handlers/pdf_handlers.cpp).
 * Static: the command's Save dialog and the settings page read it, so it stays in the main bundle.
 */
import type { PdfPageSizeId } from '@/rpc/types';

export interface PdfPageSize {
  id: PdfPageSizeId;
  widthIn: number;
  heightIn: number;
}

const mm = (value: number): number => value / 25.4;

export const PDF_PAGE_SIZES: readonly PdfPageSize[] = [
  { id: 'a4', widthIn: mm(210), heightIn: mm(297) },
  { id: 'b5', widthIn: mm(176), heightIn: mm(250) },
  { id: 'a5', widthIn: mm(148), heightIn: mm(210) },
  { id: 'b6', widthIn: mm(125), heightIn: mm(176) },
  { id: 'a6', widthIn: mm(105), heightIn: mm(148) },
  { id: 'legal', widthIn: 8.5, heightIn: 14 },
  { id: 'letter', widthIn: 8.5, heightIn: 11 },
  { id: 'executive', widthIn: 7.25, heightIn: 10.5 },
  { id: 'statement', widthIn: 5.5, heightIn: 8.5 },
];

export const DEFAULT_PDF_PAGE_SIZE: PdfPageSizeId = 'a4';

export function pdfPageSize(id: string | undefined): PdfPageSize {
  return PDF_PAGE_SIZES.find((size) => size.id === id) ?? PDF_PAGE_SIZES[0];
}
