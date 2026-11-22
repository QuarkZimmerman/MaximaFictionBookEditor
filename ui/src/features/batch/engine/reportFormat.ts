/**
 * Feature 019 (T048; contracts/batch-report.md, data-model.md §6): formats a UTF-8 plain-text
 * batch conversion report containing configuration, summary, Failed, Skipped, and Warnings on
 * converted files in the active interface language.
 */

import type { TFunction } from 'i18next';

import { selectedImportFormats } from './configState';
import type { BatchReport } from './types';

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function defaultReportFilename(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `batch-conversion-report-${stamp}.txt`;
}

export function formatBatchReportText(
  report: BatchReport,
  effectiveWorkers: number,
  t: TFunction,
): string {
  const yesNo = (v: boolean) => t(v ? 'batch.reportFile.yes' : 'batch.reportFile.no');
  const title = t('batch.reportFile.title');
  const lines: string[] = [];

  lines.push(title);
  lines.push('='.repeat(title.length));

  const durationSec = (Math.max(0, report.durationMs) / 1000).toFixed(1);
  const padLabel = (label: string) => label.padEnd(14, ' ');

  lines.push(`${padLabel(t('batch.reportFile.started'))}${formatTimestamp(report.startedAtIso)}`);
  lines.push(
    `${padLabel(t('batch.reportFile.finished'))}${formatTimestamp(report.finishedAtIso)} (${durationSec} s)`,
  );
  lines.push(
    `${padLabel(t('batch.reportFile.status'))}${t(report.cancelled ? 'batch.reportFile.statusCancelled' : 'batch.reportFile.statusCompleted')}`,
  );

  const directionText =
    report.config.direction === 'fb2ToExport'
      ? t('batch.reportFile.directionExport', {
          format: t(`exports.settings.formats.${report.config.exportFormat}`),
        })
      : t('batch.reportFile.directionImport', {
          formats: selectedImportFormats(report.config)
            .map((fmt) => t(`exports.settings.formats.${fmt}`))
            .join(', '),
        });
  lines.push(`${padLabel(t('batch.reportFile.direction'))}${directionText}`);

  lines.push(
    `${padLabel(t('batch.reportFile.source'))}${report.config.sourceDir} (${t('batch.reportFile.includeSubfolders', { value: yesNo(report.config.includeSubfolders) })})`,
  );

  const outputText = report.config.inPlace
    ? t('batch.reportFile.outputInPlace', {
        zip: yesNo(report.config.zipOutput),
        overwrite: yesNo(report.config.overwrite),
      })
    : t('batch.reportFile.outputDest', {
        path: report.config.destinationDir,
        keepTree: yesNo(report.config.keepTree),
        zip: yesNo(report.config.zipOutput),
        overwrite: yesNo(report.config.overwrite),
      });
  lines.push(`${padLabel(t('batch.reportFile.output'))}${outputText}`);

  const parallelText =
    effectiveWorkers > 1
      ? t('batch.reportFile.parallelYes', { count: effectiveWorkers })
      : t('batch.reportFile.parallelNo');
  lines.push(`${padLabel(t('batch.reportFile.parallel'))}${parallelText}`);

  if (report.config.direction === 'fb2ToExport' && report.exportDefaultsSummary) {
    lines.push(`${padLabel(t('batch.reportFile.exportOpts'))}${report.exportDefaultsSummary}`);
  }

  // Summary section
  lines.push('');
  const summaryHeading = t('batch.reportFile.summaryHeading');
  lines.push(summaryHeading);
  lines.push('-'.repeat(summaryHeading.length));
  lines.push(`${padLabel(t('batch.reportFile.total'))}${report.counts.total}`);
  lines.push(`${padLabel(t('batch.reportFile.converted'))}${report.counts.converted}`);
  lines.push(`${padLabel(t('batch.reportFile.skipped'))}${report.counts.skipped}`);
  lines.push(`${padLabel(t('batch.reportFile.failed'))}${report.counts.failed}`);
  lines.push(`${padLabel(t('batch.reportFile.cancelled'))}${report.counts.cancelled}`);

  // Failed section
  lines.push('');
  const failedHeading = t('batch.reportFile.failedHeading', { count: report.failed.length });
  lines.push(failedHeading);
  lines.push('-'.repeat(failedHeading.length));
  if (report.failed.length === 0) {
    lines.push(t('batch.reportFile.none'));
  } else {
    report.failed.forEach((entry, idx) => {
      const targetSuffix = entry.targetPath ? ` -> ${entry.targetPath}` : '';
      lines.push(`${idx + 1}. ${entry.displayPath}${targetSuffix}`);
      lines.push(`   ${t('batch.reportFile.errorPrefix')} ${entry.reason}`);
    });
  }

  // Skipped section
  lines.push('');
  const skippedHeading = t('batch.reportFile.skippedHeading', { count: report.skipped.length });
  lines.push(skippedHeading);
  lines.push('-'.repeat(skippedHeading.length));
  if (report.skipped.length === 0) {
    lines.push(t('batch.reportFile.none'));
  } else {
    report.skipped.forEach((entry, idx) => {
      const targetSuffix = entry.targetPath ? ` -> ${entry.targetPath}` : '';
      lines.push(`${idx + 1}. ${entry.displayPath}${targetSuffix}`);
      lines.push(`   ${t('batch.reportFile.reasonPrefix')} ${entry.reason}`);
    });
  }

  // Warnings on converted files section (always present in saved file, never shown on screen)
  lines.push('');
  const warningsHeading = t('batch.reportFile.warningsHeading', {
    count: report.warnings.length,
  });
  lines.push(warningsHeading);
  lines.push('-'.repeat(warningsHeading.length));
  if (report.warnings.length === 0) {
    lines.push(t('batch.reportFile.none'));
  } else {
    report.warnings.forEach((entry, idx) => {
      lines.push(`${idx + 1}. ${entry.displayPath} -> ${entry.targetPath}`);
      for (const msg of entry.messages) {
        lines.push(`   - ${msg}`);
      }
    });
  }

  return `${lines.join('\n')}\n`;
}
