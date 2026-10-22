/**
 * Replace dialog (T066) after the original `IDD_REPLACE`: Find what / Replace with combos with
 * histories, the Find options, Find Next, Replace, Replace All and Cancel (which becomes
 * "Close" once a match was found, as in the original). Modeless like the Find dialog. Find
 * Next reports "Finished searching for '%s'." when nothing is found; Replace replaces the
 * current match and finds the next one; Replace All reports "%d replacement(s) done." and is a
 * single undo entry. Nothing is replaced while a script runs.
 */

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CommandContext } from '@/app/commands';
import type { FindOptions, SearchSession } from '@/features/search/search';
import { parseAccelerator } from '@/i18n';
import { isRunLocked, useAppState } from '@/model/store';

import { Dialog, type DialogButton } from './Dialog';
import { FindFields } from './FindDialog';
import { useSearchDialogFocus } from './useSearchDialogFocus';

import './editing.css';

export interface ReplaceDialogProps {
  session: SearchSession;
  ctx: CommandContext;
  onClose: () => void;
}

export function ReplaceDialog({ session, ctx, onClose }: ReplaceDialogProps) {
  const { t } = useTranslation();
  const [options, setOptions] = useState<FindOptions>({
    ...session.options,
    query: session.initialQuery(),
  });
  const [replacement, setReplacement] = useState(session.replacement);
  const [found, setFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const runLocked = useAppState(isRunLocked, ctx.store);
  const queryRef = useRef<HTMLInputElement>(null);
  useSearchDialogFocus(session, 'replace', queryRef);

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const findNext = () =>
    run(async () => {
      if (!options.query) return;
      if (session.find(options, 'next')) {
        setFound(true);
        void session.remember(ctx, 'find', options.query);
      } else {
        await session.reportNotFound(ctx, 'replace');
      }
    });

  const replace = () =>
    run(async () => {
      if (!options.query) return;
      const result = session.replace(options, replacement);
      if (result.replaced) {
        void session.remember(ctx, 'find', options.query);
        void session.remember(ctx, 'replace', replacement);
      }
      if (result.found) setFound(true);
      else await session.reportNotFound(ctx, 'replace');
    });

  const replaceAll = () =>
    run(async () => {
      if (!options.query) return;
      const count = session.replaceAll(options, replacement, t('dialog.replace.replaceAllCaption'));
      if (count > 0) {
        setFound(true);
        void session.remember(ctx, 'find', options.query);
        void session.remember(ctx, 'replace', replacement);
      }
      await session.reportReplaceAll(ctx, count);
    });

  const buttons: DialogButton[] = [
    {
      id: 'findNext',
      label: t('dialog.find.findNext'),
      disabled: !options.query,
      onClick: () => void findNext(),
    },
    {
      id: 'replace',
      label: t('dialog.replace.replace'),
      disabled: !options.query || runLocked,
      onClick: () => void replace(),
    },
    {
      id: 'replaceAll',
      label: t('dialog.replace.replaceAll'),
      disabled: !options.query || runLocked,
      onClick: () => void replaceAll(),
    },
    {
      id: 'cancel',
      label: found ? t('dialog.buttons.close') : t('dialog.buttons.cancel'),
      onClick: onClose,
    },
  ];

  return (
    <Dialog
      title={t('dialog.replace.caption')}
      buttons={buttons}
      defaultButtonId={found ? 'replace' : 'findNext'}
      cancelButtonId="cancel"
      initialFocus="#dialog-replace-query"
      testId="dialog-replace"
      className="mfbe-finddialog mfbe-replacedialog"
      closeLabel={t('dialog.buttons.close')}
      modeless
    >
      <FindFields
        idPrefix="dialog-replace"
        queryRef={queryRef}
        options={options}
        onChange={(next) => {
          setOptions(next);
          if (next.query !== options.query) setFound(false);
        }}
        history={session.findHistory}
        extraRow={
          <label className="mfbe-field-row" htmlFor="dialog-replace-with">
            <span className="mfbe-find-label">
              {parseAccelerator(t('dialog.replace.replaceWith')).text}
            </span>
            <input
              id="dialog-replace-with"
              className="mfbe-inputdialog-input"
              type="text"
              value={replacement}
              list="dialog-replace-with-history"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setReplacement(event.target.value)}
              data-testid="dialog-replace-with"
            />
            <datalist id="dialog-replace-with-history">
              {session.replaceHistory.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </label>
        }
      />
    </Dialog>
  );
}
