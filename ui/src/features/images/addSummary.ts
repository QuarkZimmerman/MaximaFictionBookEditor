/**
 * The outcome of Add > Binary Object with several files (feature 009, User Story 9; D29,
 * data-model §12): `{added, toConvert, failed}`. The summary shows when more than one file was
 * chosen and some failed or will be converted to JPEG or PNG on save; otherwise the status line
 * says how many were added, as before.
 */

import type { TFunction } from 'i18next';

import type { BinaryMeta } from '@/model/document';

import type { AddedFiles, FailedFile } from './binaries';

export interface AddSummary {
  added: BinaryMeta[];
  toConvert: BinaryMeta[];
  failed: FailedFile[];
}

export function summarize({ added, failed }: AddedFiles): AddSummary {
  return { added, toConvert: added.filter((meta) => meta.willConvert), failed };
}

/** The summary dialog shows (rather than the status line). */
export function showsSummary(summary: AddSummary): boolean {
  const chosen = summary.added.length + summary.failed.length;
  return chosen > 1 && (summary.failed.length > 0 || summary.toConvert.length > 0);
}

/** The summary's text: the added files, the ones to be converted, the failed ones and why. */
export function summaryText(t: TFunction, summary: AddSummary): string {
  const ids = (metas: BinaryMeta[]) => metas.map((meta) => meta.id).join(', ');
  const lines = [
    summary.added.length > 0
      ? t('images.summary.added', { count: summary.added.length, files: ids(summary.added) })
      : t('images.summary.none'),
  ];
  if (summary.toConvert.length > 0) {
    lines.push(t('images.summary.toConvert', { files: ids(summary.toConvert) }));
  }
  if (summary.failed.length > 0) {
    lines.push(t('images.summary.failed', { count: summary.failed.length }));
    for (const failed of summary.failed) lines.push(`${failed.file} \u2014 ${failed.reason}`);
  }
  return lines.join('\n');
}
