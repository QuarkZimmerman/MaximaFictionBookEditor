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
 * Feature 007 (User Story 9, T119): a `modify` proposal - a changed version of a script in
 * effect - has its own title and a note on what the change does (the copy takes the original's
 * place, the original stays, a backup is kept), and shows every file as its diff against the
 * file in effect (`ai-proposal-diff-<file>`: every line, the removed ones marked `-`, the added
 * ones `+`), the files left out at the end. The restore confirmation of
 * `restore_script_backup` (`dialog-ai-script-restore`) lives here too.
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

import type { RestoreRequest } from './catalogue';
import { fileChanges, withAuthorLine, type FileChange, type ScriptProposal } from './proposal';

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

  const modifies = proposal.mode === 'modify' ? proposal.modifies : undefined;
  const changes = useMemo(
    () => (modifies ? fileChanges(shown, modifies.files) : []),
    [modifies, shown],
  );

  return (
    <Dialog
      title={
        modifies
          ? t('ai.scripts.modifyTitle', { name: modifies.name })
          : t('ai.proposal.title', { name: proposal.name })
      }
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
      {modifies ? (
        <p className="mfbe-ai-proposal-replaces" data-testid={`${testId}-overrides`}>
          {t('ai.scripts.overridesNote', {
            name: modifies.name,
            origin: t(`ai.scripts.origin.${modifies.origin}`),
          })}
        </p>
      ) : proposal.existing ? (
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
        {modifies
          ? changes.map((change) => <FileDiff key={change.path} change={change} />)
          : shown.map((file, index) => (
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

/** The mark of a diff line: `+` added, `-` removed, a space for a line that stays. */
const DIFF_MARK = { same: ' ', added: '+', removed: '-' } as const;

/**
 * One file of a modify proposal against the file in effect (feature 007): its path, what the
 * proposal does with it and every line, the removed and added ones marked - or, for a binary
 * file in effect (an icon), that it is not part of the change.
 */
function FileDiff({ change }: { change: FileChange }) {
  const { t } = useTranslation();
  return (
    <section
      className="mfbe-ai-proposal-file"
      data-testid={`ai-proposal-diff-${change.path}`}
      data-path={change.path}
      data-status={change.status}
    >
      <h3 className="mfbe-ai-proposal-file-path">
        {change.path}{' '}
        <span className="mfbe-ai-diff-status">
          {t(`ai.scripts.diff.${change.status === 'removedBinary' ? 'binary' : change.status}`)}
        </span>
      </h3>
      {change.status === 'removedBinary' ? null : (
        <pre className="mfbe-ai-proposal-file-content" tabIndex={0}>
          {change.lines.map((line, index) => (
            <span
              // The lines of one file never move: the index is their identity.
              key={index}
              className={`mfbe-ai-diff-line mfbe-ai-diff-${line.kind}`}
              data-kind={line.kind}
            >
              {`${DIFF_MARK[line.kind]} ${line.text}\n`}
            </span>
          ))}
        </pre>
      )}
    </section>
  );
}

/** When a backup was kept, in the interface language and the local time. */
function backupTime(createdAt: string, language: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt;
  try {
    return date.toLocaleString(language);
  } catch {
    return date.toLocaleString();
  }
}

export const RESTORE_DIALOG_TEST_ID = 'dialog-ai-script-restore';

/**
 * The restore confirmation of `restore_script_backup` (feature 007, FR-084): the script, when
 * the backup was kept and where that version came from; *Restore* or *Don't restore* (also
 * Escape, the close box and the banner's Cancel).
 */
export function RestoreConfirmDialog({
  request,
  run,
  onClose,
}: {
  request: RestoreRequest;
  /** The request's run session: its Cancel declines the restore. */
  run: RunSession | null;
  onClose: (restore: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const testId = RESTORE_DIALOG_TEST_ID;
  useEffect(() => {
    if (!run) return undefined;
    const check = () => {
      if (run.cancelRequested || run.ended) onClose(false);
    };
    check();
    return run.subscribe(check);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);
  const buttons: DialogButton[] = [
    { id: 'restore', label: t('ai.scripts.restore'), onClick: () => onClose(true) },
    { id: 'dontRestore', label: t('ai.scripts.dontRestore'), onClick: () => onClose(false) },
  ];
  return (
    <Dialog
      title={t('ai.scripts.restoreTitle', { name: request.script.name })}
      buttons={buttons}
      defaultButtonId="restore"
      cancelButtonId="dontRestore"
      testId={testId}
      className="mfbe-ai-restore"
      closeLabel={t('dialog.buttons.close')}
    >
      <p className="mfbe-ai-plain" data-testid={`${testId}-text`}>
        {t('ai.scripts.restoreConfirm', {
          name: request.script.name,
          date: backupTime(request.backup.createdAt, i18n.language),
          origin: t(`ai.scripts.origin.${request.backup.origin}`),
        })}
      </p>
    </Dialog>
  );
}

/** Asks the user to confirm a restore; true for *Restore*. Nothing is restored here. */
// eslint-disable-next-line react-refresh/only-export-components -- the flow lives with its dialog in the lazy chunk
export function showRestoreConfirm(
  ctx: CommandContext,
  request: RestoreRequest,
  options: { run: RunSession | null },
): Promise<boolean> {
  return ctx.dialogs.openCustom<boolean>((close) => (
    <RestoreConfirmDialog request={request} run={options.run} onClose={close} />
  ));
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
