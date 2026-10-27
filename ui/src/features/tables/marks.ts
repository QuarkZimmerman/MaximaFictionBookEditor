/**
 * The texts of an irregular table's warning mark (feature 006, US8; FR-057, FR-058, FR-062; C61;
 * I3; data-model §3.2): built from the table's summary alone, so the Body mark, the tree mark,
 * the popover and File → Validate read the same words.
 */

import type { TFunction } from 'i18next';

import type { TableSummary } from '@/editor/table/grid';
import { tableProblemParts } from '@/editor/table/problems';
import i18next from '@/i18n';

/** The mark's accessible name, its tooltip and the problem parts (the popover's list). */
export interface TableMarkDescription {
  name: string;
  tooltip: string;
  parts: string[];
}

/** The language `t` translates into: its fixed language, else the interface's. */
function languageOf(t: TFunction): string | undefined {
  const fixed = (t as unknown as { lng?: unknown }).lng;
  if (typeof fixed === 'string' && fixed !== '') return fixed;
  return i18next.resolvedLanguage ?? i18next.language;
}

/**
 * The mark's texts (data-model §3.2; C61): `name` is `validation.table.irregular` with the
 * problems joined by `tables.problem.separator`, or `validation.table.irregularNamed` for a table
 * with an id - the variant File → Validate shows -; `tooltip` is the problems with their first
 * letter upper-cased in the interface language (the name for a named table), `. ` and
 * `tables.mark.repairHint` - US8 sc.9's "Row 2 covers 2 of 3 columns; 1 overlapping span. Repair
 * table makes the table regular."; `parts` the problems one by one.
 */
export function describeTableMark(summary: TableSummary, t: TFunction): TableMarkDescription {
  const parts = tableProblemParts(summary, t);
  const problems = parts.join(t('tables.problem.separator'));
  const name = summary.id
    ? t('validation.table.irregularNamed', { id: summary.id, problems })
    : t('validation.table.irregular', { problems });
  let head = name;
  if (!summary.id) {
    const language = languageOf(t);
    let first: string;
    try {
      first = problems.charAt(0).toLocaleUpperCase(language);
    } catch {
      first = problems.charAt(0).toUpperCase();
    }
    head = first + problems.slice(1);
  }
  return { name, tooltip: `${head}. ${t('tables.mark.repairHint')}`, parts };
}
