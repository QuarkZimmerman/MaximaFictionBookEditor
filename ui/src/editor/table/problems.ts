/**
 * The phrases a table's problems are told in (feature 006, I3; data-model §3.2): built from the
 * table's summary alone, so the warning mark's tooltip (FR-057), the tree mark (FR-058), File →
 * Validate (FR-062) and the popover read the same words. The keys come from
 * `ui/src/i18n/tables.{en,ru,uk}.json`; the assistant writes the same English text without the
 * catalogues (`englishTableProblems`, US11), and the shared vectors' `text.en` pins both.
 */

import type { TFunction } from 'i18next';

import type { TableSummary } from './grid';

/**
 * The problem parts, in this order: the short rows - `tables.problem.shortRow` for one ("row 2
 * covers 0 of 1 column": plural by `columns` in every language), `tables.problem.shortRows`
 * for two or more (plural by count) -, then the overlapping spans and the spans past the last
 * row, each when there is one or more. A regular table has none.
 */
export function tableProblemParts(summary: TableSummary, t: TFunction): string[] {
  const parts: string[] = [];
  const columns = summary.columns;
  if (summary.shortRows === 1) {
    parts.push(
      t('tables.problem.shortRow', {
        row: summary.row,
        covered: summary.covered,
        columns,
        count: columns,
      }),
    );
  } else if (summary.shortRows >= 2) {
    parts.push(t('tables.problem.shortRows', { count: summary.shortRows, columns }));
  }
  if (summary.overlaps >= 1) parts.push(t('tables.problem.overlaps', { count: summary.overlaps }));
  if (summary.pastEnd >= 1) parts.push(t('tables.problem.pastEnd', { count: summary.pastEnd }));
  return parts;
}

/** The parts joined with `tables.problem.separator` ("; "); empty for a regular table. */
export function tableProblemsText(summary: TableSummary, t: TFunction): string {
  return tableProblemParts(summary, t).join(t('tables.problem.separator'));
}
