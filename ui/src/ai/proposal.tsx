/**
 * The script proposal dialog (feature 005 T077; ai-catalogue §7.3, data-model §10.2; FR-082,
 * FR-084, FR-105): `dialog-ai-script-proposal`, modal over the locked document, shows what the
 * model proposes - the script's name and its `summary`, the target folder in full and whether
 * an existing user script is replaced, the editable author line, **every file** with its path
 * and full content in a monospace, scrollable, read-only view (the entry module with the author
 * line already in place), the warnings of the forbidden-API scan under a red heading - and
 * offers *Write*, *Write and run* and *Don't write* (review C9). *Write* is the default button
 * only when there is no warning; Escape and the close box are *Don't write*; the banner's
 * Cancel (the request's run session) declines it.
 *
 * Rendering audit (review C16, for this surface): every model-supplied text - the summary, the
 * file contents, the author line, the warnings' lines - is rendered as a React text node inside
 * an element with `white-space: pre-wrap` (monospace for the files): no HTML, no Markdown, no
 * automatic links. Part of the lazy `ai-assistant` chunk.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CommandContext } from '@/app/commands';
import { Dialog, type DialogButton } from '@/dialogs/Dialog';
import type { RunSession } from '@/scripting/runSession';

import { withAuthorLine, type ScriptProposal } from './proposal';

import './ai.css';

/** What the user chose (data-model §10.1 `decision`). */
export type ProposalDecisionKind = 'write' | 'writeAndRun' | 'decline';

export interface ProposalDialogResult {
  decision: ProposalDecisionKind;
  /** The author line as the user left it (empty: none inserted). */
  authorLine: string;
}

export const PROPOSAL_DIALOG_TEST_ID = 'dialog-ai-script-proposal';

export function ScriptProposalDialog({
  proposal,
  defaultAuthorLine,
  run,
  onClose,
}: {
  proposal: ScriptProposal;
  defaultAuthorLine: string;
  /** The request's run session: its Cancel declines the proposal. */
  run: RunSession | null;
  onClose: (result: ProposalDialogResult) => void;
}) {
  const { t } = useTranslation();
  const [authorLine, setAuthorLine] = useState(defaultAuthorLine);
  const hasWarnings = proposal.warnings.length > 0;
  const testId = PROPOSAL_DIALOG_TEST_ID;

  // The banner's Cancel (or the request ending otherwise) closes the dialog as Don't write.
  useEffect(() => {
    if (!run) return undefined;
    const check = () => {
      if (run.cancelRequested || run.ended) onClose({ decision: 'decline', authorLine });
    };
    check();
    return run.subscribe(check);
    // The author line of the moment is not what the decline is about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  const shown = useMemo(
    () =>
      proposal.files.map((file) => ({
        path: file.path,
        content:
          file.path === proposal.manifest.entry
            ? withAuthorLine(file.content, authorLine)
            : file.content,
      })),
    [proposal, authorLine],
  );

  const buttons: DialogButton[] = [
    {
      id: 'write',
      label: t('ai.proposal.write'),
      onClick: () => onClose({ decision: 'write', authorLine }),
    },
    {
      id: 'writeAndRun',
      label: t('ai.proposal.writeAndRun'),
      onClick: () => onClose({ decision: 'writeAndRun', authorLine }),
    },
    {
      id: 'dontWrite',
      label: t('ai.proposal.dontWrite'),
      onClick: () => onClose({ decision: 'decline', authorLine }),
    },
  ];

  return (
    <Dialog
      title={t('ai.proposal.title', { name: proposal.name })}
      buttons={buttons}
      defaultButtonId={hasWarnings ? null : 'write'}
      cancelButtonId="dontWrite"
      testId={testId}
      className="mfbe-ai-proposal"
      closeLabel={t('dialog.buttons.close')}
    >
      <p className="mfbe-ai-plain" data-testid={`${testId}-summary`}>
        {proposal.summary}
      </p>
      <p className="mfbe-ai-proposal-folder">
        {t('ai.proposal.folder')}{' '}
        <code className="mfbe-ai-proposal-path" data-testid={`${testId}-folder`}>
          {proposal.target}
        </code>
      </p>
      {proposal.existing ? (
        <p className="mfbe-ai-proposal-replaces" data-testid={`${testId}-replaces`}>
          {t('ai.proposal.replaces', { id: proposal.scriptId })}
        </p>
      ) : null}
      <label className="mfbe-ai-proposal-author">
        <span>{t('ai.proposal.author')}</span>
        <input
          type="text"
          value={authorLine}
          onChange={(event) => setAuthorLine(event.target.value)}
          data-testid={`${testId}-author`}
          aria-label={t('ai.proposal.author')}
        />
      </label>
      <p className="mfbe-ai-proposal-files-title">
        {t('ai.proposal.files', { count: proposal.files.length })}
      </p>
      <div className="mfbe-ai-proposal-files">
        {shown.map((file, index) => (
          <section
            key={file.path}
            className="mfbe-ai-proposal-file"
            data-testid={`${testId}-file-${index}`}
            data-path={file.path}
          >
            <h3 className="mfbe-ai-proposal-file-path">{file.path}</h3>
            <pre className="mfbe-ai-proposal-file-content" tabIndex={0}>
              {file.content}
            </pre>
          </section>
        ))}
      </div>
      {hasWarnings ? (
        <div className="mfbe-ai-proposal-warnings" data-testid={`${testId}-warnings`}>
          <h3 className="mfbe-ai-proposal-warnings-title">{t('ai.proposal.warningsTitle')}</h3>
          <p>{t('ai.proposal.warningsNote')}</p>
          <ul>
            {proposal.warnings.map((warning, index) => (
              <li
                key={`${warning.path}:${warning.line}:${warning.name}`}
                className="mfbe-ai-plain"
                data-testid={`${testId}-warning-${index}`}
              >
                {t('ai.proposal.warning', {
                  path: warning.path,
                  line: warning.line,
                  name: warning.name,
                  text: warning.text,
                })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Dialog>
  );
}

/**
 * Shows the proposal and resolves with the user's decision and the author line as left;
 * nothing is written here (the caller does `scripts.write` after *Write* / *Write and run*).
 */
// eslint-disable-next-line react-refresh/only-export-components -- the flow lives with its dialog in the lazy chunk
export function showProposal(
  ctx: CommandContext,
  proposal: ScriptProposal,
  options: { defaultAuthorLine: string; run: RunSession | null },
): Promise<ProposalDialogResult> {
  return ctx.dialogs.openCustom<ProposalDialogResult>((close) => (
    <ScriptProposalDialog
      proposal={proposal}
      defaultAuthorLine={options.defaultAuthorLine}
      run={options.run}
      onClose={close}
    />
  ));
}
