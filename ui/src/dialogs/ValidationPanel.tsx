/**
 * Validation result panel (T053/T080): a non-modal panel docked under the view area that lists
 * the issues of a `ValidationReport` (severity, line, column, message) with "No errors found."
 * as the empty state. Double-click / Enter on an issue navigates to it: Source line/column
 * (cursor placed, line highlighted), or the Body node when the issue carries a `nodeId` and the
 * Body view is shown (`createIssueNavigator`). Messages come from the issue `code` + `params`
 * through the `validation.<code>` i18n keys, falling back to the raw message the core attached
 * (`params.message` / `params.detail`) or the code itself. Rows expose `data-line`,
 * `data-column` and `data-node-id` for tests.
 *
 * The message helpers, the save-anyway prompt (FR-011) and the default navigator live in
 * `validation.ts`.
 */

import { useCallback, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { ValidationIssue, ValidationReport } from '@/model/document';

import { issueMessage } from './validation';

import './validation.css';

export interface ValidationPanelProps {
  report: ValidationReport;
  /** Optional heading (defaults to "Validation"). */
  title?: string;
  onNavigate?: (issue: ValidationIssue) => void;
  onClose: () => void;
}

export function ValidationPanel({ report, title, onNavigate, onClose }: ValidationPanelProps) {
  const { t, i18n } = useTranslation();
  const [selection, setSelection] = useState<{ report: ValidationReport; index: number }>({
    report,
    index: 0,
  });
  // A new report starts at the first issue (derived state, no effect needed).
  const selected = selection.report === report ? selection.index : 0;
  const setSelected = (update: number | ((index: number) => number)) =>
    setSelection((current) => {
      const base = current.report === report ? current.index : 0;
      return { report, index: typeof update === 'function' ? update(base) : update };
    });
  const listRef = useRef<HTMLTableSectionElement>(null);
  const issues = report.issues;

  const navigate = useCallback(
    (index: number) => {
      const issue = issues[index];
      if (issue && onNavigate) onNavigate(issue);
    },
    [issues, onNavigate],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (issues.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected((i) => Math.min(issues.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected((i) => Math.max(0, i - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      navigate(selected);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  const summary =
    report.errorCount === 0 && report.warningCount === 0
      ? t('status.noErrors')
      : t('dialog.validation.summary', {
          errors: t('msg.errorsFound', { count: report.errorCount }),
          warnings: t('dialog.validation.warningsFound', { count: report.warningCount }),
        });

  return (
    <section
      className="mfbe-validation"
      role="region"
      aria-label={title ?? t('dialog.validation.caption')}
      data-testid="validation-panel"
    >
      <header className="mfbe-validation-header">
        <span className="mfbe-validation-title" data-testid="validation-title">
          {title ?? t('dialog.validation.caption')}
        </span>
        <span className="mfbe-validation-summary" data-testid="validation-summary">
          {summary}
        </span>
        <button
          type="button"
          className="mfbe-validation-close"
          aria-label={t('dialog.buttons.close')}
          data-testid="validation-close"
          onClick={onClose}
        >
          <span aria-hidden="true">{'\u00D7'}</span>
        </button>
      </header>
      {issues.length === 0 ? (
        <div className="mfbe-validation-empty" data-testid="validation-empty">
          {t('status.noErrors')}
        </div>
      ) : (
        <div className="mfbe-validation-scroll">
          <table className="mfbe-validation-table">
            <thead>
              <tr>
                <th scope="col">{t('dialog.validation.severity')}</th>
                <th scope="col">{t('dialog.validation.line')}</th>
                <th scope="col">{t('dialog.validation.column')}</th>
                <th scope="col">{t('dialog.validation.message')}</th>
              </tr>
            </thead>
            <tbody ref={listRef} onKeyDown={onKeyDown}>
              {issues.map((issue, index) => (
                <tr
                  key={`${issue.code}-${issue.line ?? ''}-${issue.column ?? ''}-${index}`}
                  tabIndex={0}
                  aria-selected={index === selected}
                  className={`mfbe-validation-row mfbe-validation-${issue.severity}${
                    index === selected ? ' mfbe-validation-row-selected' : ''
                  }`}
                  data-testid={`validation-issue-${index}`}
                  data-severity={issue.severity}
                  data-code={issue.code}
                  data-line={issue.line ?? ''}
                  data-column={issue.column ?? ''}
                  data-node-id={issue.nodeId ?? ''}
                  onClick={() => setSelected(index)}
                  onDoubleClick={() => navigate(index)}
                  onFocus={() => setSelected(index)}
                >
                  <td className="mfbe-validation-severity">
                    <span
                      className={`mfbe-validation-icon mfbe-validation-icon-${issue.severity}`}
                      aria-hidden="true"
                    >
                      {issue.severity === 'error' ? '\u00D7' : '!'}
                    </span>
                    {issue.severity === 'error'
                      ? t('dialog.validation.error')
                      : t('dialog.validation.warning')}
                  </td>
                  <td className="mfbe-validation-line">{issue.line ?? ''}</td>
                  <td className="mfbe-validation-column">{issue.column ?? ''}</td>
                  <td className="mfbe-validation-message" title={issue.path ?? ''}>
                    {issueMessage(issue, t, i18n)}
                    {issue.path ? (
                      <span className="mfbe-validation-path"> {issue.path}</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
