/**
 * The report window of `mfbe.ui.report` (feature 007, contracts/script-api.md §4, data-model
 * §8): the display-only window of constitution principle V (c), where a converted script shows
 * what the original opened with `window.open("HTML/…")`. A modeless dialog with the report's
 * title and its pre-wrapped text, or its HTML in a frame that runs no script and loads nothing
 * (`sandbox` without `allow-scripts`, and a policy that admits inline styles and `data:`
 * pictures alone). Copy puts its plain text on the clipboard; Save as… writes it through the
 * editor's Save dialog (`files.saveText`, `.html` or `.txt`). It stays open after the run ends,
 * and several may be open at once (`script-report-<n>`).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog, type DialogButton } from '@/dialogs/Dialog';
import type { RpcClient } from '@/rpc/client';

import type { ReportSpec } from './api-impl';
import { reportDocument, reportFileName, reportPlainText } from './report';

import './scripting.css';

export interface ReportWindowProps {
  report: ReportSpec;
  /** The window's number in this session: `script-report-<n>`. */
  index: number;
  rpc: RpcClient | null;
  onClose: () => void;
}

export function ReportWindow({ report, index, rpc, onClose }: ReportWindowProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const testId = `script-report-${index}`;

  const copy = async () => {
    await navigator.clipboard?.writeText(reportPlainText(report));
    setCopied(true);
  };

  const saveAs = async () => {
    await rpc?.call('files.saveText', {
      suggestedName: reportFileName(report),
      text: report.html !== undefined ? reportDocument(report.html) : (report.text ?? ''),
      title: t('scripting.report.saveTitle'),
    });
  };

  const buttons: DialogButton[] = [
    { id: 'copy', label: t('scripting.report.copy'), onClick: () => void copy() },
    {
      id: 'saveAs',
      label: t('scripting.report.saveAs'),
      disabled: !rpc,
      onClick: () => void saveAs(),
    },
    { id: 'close', label: t('dialog.buttons.close'), onClick: onClose },
  ];

  return (
    <Dialog
      title={report.title}
      buttons={buttons}
      defaultButtonId="close"
      cancelButtonId="close"
      testId={testId}
      className="mfbe-report-window"
      closeLabel={t('dialog.buttons.close')}
      modeless
    >
      {report.html !== undefined ? (
        <iframe
          className="mfbe-report-frame"
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={reportDocument(report.html)}
          title={report.title}
          data-testid={`${testId}-frame`}
        />
      ) : (
        <pre className="mfbe-report-text" data-testid={`${testId}-text`}>
          {report.text}
        </pre>
      )}
      <div className="mfbe-report-status" role="status" data-testid={`${testId}-status`}>
        {copied ? t('scripting.report.copied') : ''}
      </div>
    </Dialog>
  );
}
