/**
 * Feature 012 (US1; D12, FR-014): delegates to neutral `ebookShared/exportCss` shared with MOBI/KF8
 * (feature 018 T013).
 */
import type { Stylesheet } from '@/model/document';

import {
  BASE_CSS,
  publicationCss as sharedPublicationCss,
  translateCss as sharedTranslateCss,
  type CssSummaryItem,
} from '../../ebookShared/exportCss';

import type { SummaryItem } from './render';

export { BASE_CSS };

export function translateCss(css: string, summary: SummaryItem[]): string {
  const dropped: CssSummaryItem[] = [];
  const out = sharedTranslateCss(css, dropped);
  summary.push(...dropped);
  return out;
}

export function publicationCss(stylesheets: readonly Stylesheet[], summary: SummaryItem[]): string {
  const dropped: CssSummaryItem[] = [];
  const out = sharedPublicationCss(stylesheets, dropped, BASE_CSS);
  summary.push(...dropped);
  return out;
}
