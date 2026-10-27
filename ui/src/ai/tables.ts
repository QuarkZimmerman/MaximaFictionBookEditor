/**
 * The assistant's irregular-table helpers (feature 006, US11; FR-053, FR-062; C9, C65, C66; I3,
 * I20, I21; contracts/ai-catalogue.md §3.9 "The problem text" and "The irregular-table warning",
 * Δ§3.1, Δ§6.10; data-model §3.2, §15.3; research R7.6). Part of the lazy `ai-assistant` chunk;
 * it imports only main-bundle types and `./tools/model`.
 *
 * - `englishTableProblems` tells a table's problems in English from its summary alone - the
 *   words of `tableProblemsText` with the English catalogue (the vectors' `text.en` pins both),
 *   written as literals: the model-facing texts are never localised (feature 005).
 * - `irregularEntries` reads the `table.irregular` warnings of a validation report (rpc-api
 *   §3.2: `nodeId`, `path` and `line` set, `column` too in the text form); `madeIrregular` keeps
 *   the entries a change made irregular - by node id in the document form, by path and params in
 *   the text form, which may over-report an edited table but never misses one (C66).
 * - `tableWarningOf` / `withTableWarning` build the `tableWarning` of an accepted change result,
 *   `irregularTablesOf` the `validate` tool's `irregularTables`: the working copy's `NodeInfo` in
 *   the document form, `{path, type}` with `line` in the text form (the text has no node ids).
 */

import type { TableSummary } from '@/editor/table/grid';
import type { ValidationIssue, ValidationReport } from '@/model/document';

import { nodeInfo, resolveReference, type DocIndex, type NodeInfo } from './tools/model';

/** How a report names its tables: node ids (the model) or paths and lines (a text). */
export type ReportForm = 'document' | 'text';

/** One `table.irregular` warning of a report: its table and the table's summary. */
export interface IrregularEntry {
  /** The table's node id (a scratch id in the text form). */
  nodeId?: string;
  /** The table's structural path. */
  path: string;
  /** The line of `<table` in the XML the report was made from. */
  line?: number;
  params: TableSummary;
}

/** An irregular table as `tableWarning.tables` and `validate.irregularTables` list it. */
export interface IrregularTableInfo {
  table: NodeInfo | { path: string; type: 'table' };
  line?: number;
  problems: string;
}

export interface TableWarning {
  message: string;
  tables: IrregularTableInfo[];
}

/** The params the text form compares (C66): the path and these members. */
const COMPARED = ['rows', 'columns', 'shortRows', 'overlaps', 'pastEnd'] as const;

const ONE_TABLE_WARNING =
  'This change made 1 table irregular: valid FB2, but readers lay out irregular tables unpredictably. If that was not intended, make it regular with edit_table, op "repair".';

/**
 * A table's problems in English (data-model §3.2; ai-catalogue §3.9): the short rows - "row
 * {row} covers {covered} of {columns} column(s)" for one, "{n} rows cover fewer than {columns}
 * columns" for two or more -, then "1 overlapping span" / "{n} overlapping spans" and "1 span
 * reaches past the last row" / "{n} spans reach past the last row", joined with "; ". Empty for a
 * regular table.
 */
export function englishTableProblems(summary: TableSummary): string {
  const parts: string[] = [];
  const { columns } = summary;
  if (summary.shortRows === 1) {
    parts.push(
      `row ${summary.row} covers ${summary.covered} of ${columns} ${columns === 1 ? 'column' : 'columns'}`,
    );
  } else if (summary.shortRows >= 2) {
    parts.push(`${summary.shortRows} rows cover fewer than ${columns} columns`);
  }
  if (summary.overlaps >= 1) {
    parts.push(
      summary.overlaps === 1 ? '1 overlapping span' : `${summary.overlaps} overlapping spans`,
    );
  }
  if (summary.pastEnd >= 1) {
    parts.push(
      summary.pastEnd === 1
        ? '1 span reaches past the last row'
        : `${summary.pastEnd} spans reach past the last row`,
    );
  }
  return parts.join('; ');
}

/** The summary of a warning's params, its members typed (absent numbers count 0). */
function summaryOf(params: Record<string, unknown> | undefined): TableSummary {
  const value = params ?? {};
  const count = (member: unknown) =>
    typeof member === 'number' && Number.isFinite(member) ? member : 0;
  return {
    rows: count(value.rows),
    columns: count(value.columns),
    shortRows: count(value.shortRows),
    ...(typeof value.row === 'number' ? { row: value.row } : {}),
    ...(typeof value.covered === 'number' ? { covered: value.covered } : {}),
    overlaps: count(value.overlaps),
    pastEnd: count(value.pastEnd),
    ...(typeof value.id === 'string' && value.id !== '' ? { id: value.id } : {}),
  };
}

/** The `table.irregular` warnings of a report, in its order (document order). */
export function irregularEntries(issues: readonly ValidationIssue[]): IrregularEntry[] {
  return issues
    .filter((issue) => issue.code === 'table.irregular')
    .map((issue) => ({
      ...(typeof issue.nodeId === 'string' && issue.nodeId !== '' ? { nodeId: issue.nodeId } : {}),
      path: issue.path ?? '',
      ...(typeof issue.line === 'number' && issue.line > 0 ? { line: issue.line } : {}),
      params: summaryOf(issue.params as Record<string, unknown> | undefined),
    }));
}

/**
 * The entries of `current` that `previous` lacks (Δ§6.10): in the document form by node id - a
 * table written anew has a new id and counts as new -, in the text form by the path and the
 * params `rows`, `columns`, `shortRows`, `overlaps` and `pastEnd`, so a document-form baseline
 * matches a text-form report in Source text mode and a table whose path moved is reported.
 */
export function madeIrregular(
  previous: readonly IrregularEntry[],
  current: readonly IrregularEntry[],
  form: ReportForm,
): IrregularEntry[] {
  if (form === 'document') {
    const known = new Set(previous.map((entry) => entry.nodeId).filter(Boolean));
    return current.filter((entry) => !entry.nodeId || !known.has(entry.nodeId));
  }
  return current.filter(
    (entry) =>
      !previous.some(
        (old) =>
          old.path === entry.path &&
          COMPARED.every((member) => old.params[member] === entry.params[member]),
      ),
  );
}

/**
 * An entry as the model reads it: the working copy's `NodeInfo` of the table in the document
 * form (found by its node id, else by its path) without `line`; `{path, type}` with `line` in the
 * text form; `problems` in English.
 */
export function tableInfo(
  entry: IrregularEntry,
  index: DocIndex,
  form: ReportForm,
): IrregularTableInfo {
  const problems = englishTableProblems(entry.params);
  if (form === 'document') {
    const found =
      (entry.nodeId ? index.byId.get(entry.nodeId) : undefined) ??
      (entry.path ? resolveReference(index, entry.path) : null);
    return {
      table: found ? nodeInfo(found) : { path: entry.path, type: 'table' },
      problems,
    };
  }
  return {
    table: { path: entry.path, type: 'table' },
    ...(entry.line === undefined ? {} : { line: entry.line }),
    problems,
  };
}

/** The `tableWarning` of a change that made `entries` irregular; null for none (Δ§6.10). */
export function tableWarningOf(
  entries: readonly IrregularEntry[],
  index: DocIndex,
  form: ReportForm,
): TableWarning | null {
  if (entries.length === 0) return null;
  const message =
    entries.length === 1
      ? ONE_TABLE_WARNING
      : `This change made ${entries.length} tables irregular: valid FB2, but readers lay out irregular tables unpredictably. If that was not intended, make them regular with edit_table, op "repair".`;
  return { message, tables: entries.map((entry) => tableInfo(entry, index, form)) };
}

/** `result` with `tableWarning` when `entries` is not empty; `result` itself otherwise. */
export function withTableWarning<T extends object>(
  result: T,
  entries: readonly IrregularEntry[],
  index: DocIndex,
  form: ReportForm,
): T {
  const warning = tableWarningOf(entries, index, form);
  return warning ? { ...result, tableWarning: warning } : result;
}

/** The `validate` tool's `irregularTables`: one entry per `table.irregular` warning (Δ§3.1). */
export function irregularTablesOf(
  report: Pick<ValidationReport, 'issues'>,
  form: ReportForm,
  index: DocIndex,
): IrregularTableInfo[] {
  return irregularEntries(report.issues).map((entry) => tableInfo(entry, index, form));
}
