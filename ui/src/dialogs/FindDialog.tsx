/**
 * Find dialog (T066) after the original `IDD_FIND`: "Find what:" combo with the history of
 * the last 20 searches, "Match whole words", "Match case", "Regular expression", Direction
 * Up / Down, Find Next (default) and Cancel. Searches run through the `SearchSession`; a
 * failed search shows "Cannot find the string '%s'." (`FindDialogBody` is shared with the
 * Replace dialog).
 */

import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { CommandContext } from '@/app/commands';
import type { FindOptions, SearchSession } from '@/features/search/search';
import { parseAccelerator } from '@/i18n';

import { Dialog, type DialogButton } from './Dialog';

import './editing.css';

export interface FindDialogProps {
  session: SearchSession;
  ctx: CommandContext;
  onClose: () => void;
}

export interface FindFieldsProps {
  idPrefix: string;
  options: FindOptions;
  onChange: (options: FindOptions) => void;
  history: readonly string[];
  /** Rendered between the "Find what" row and the check boxes (the Replace row). */
  extraRow?: ReactNode;
}

/** The shared fields of the Find and Replace dialogs. */
export function FindFields({ idPrefix, options, onChange, history, extraRow }: FindFieldsProps) {
  const { t } = useTranslation();
  const update = (patch: Partial<FindOptions>) => onChange({ ...options, ...patch });
  const listId = `${idPrefix}-history`;
  return (
    <div className="mfbe-find-fields">
      <label className="mfbe-field-row" htmlFor={`${idPrefix}-query`}>
        <span className="mfbe-find-label">{parseAccelerator(t('dialog.find.findWhat')).text}</span>
        <input
          id={`${idPrefix}-query`}
          className="mfbe-inputdialog-input"
          type="text"
          value={options.query}
          list={listId}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => update({ query: event.target.value })}
          data-testid={`${idPrefix}-query`}
        />
        <datalist id={listId}>
          {history.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      </label>
      {extraRow}
      <div className="mfbe-find-options">
        <div className="mfbe-find-checks">
          <label className="mfbe-check-field" htmlFor={`${idPrefix}-whole`}>
            <input
              id={`${idPrefix}-whole`}
              type="checkbox"
              checked={options.wholeWord}
              onChange={(event) => update({ wholeWord: event.target.checked })}
              data-testid={`${idPrefix}-whole-words`}
            />
            <span>{parseAccelerator(t('dialog.find.wholeWords')).text}</span>
          </label>
          <label className="mfbe-check-field" htmlFor={`${idPrefix}-case`}>
            <input
              id={`${idPrefix}-case`}
              type="checkbox"
              checked={options.matchCase}
              onChange={(event) => update({ matchCase: event.target.checked })}
              data-testid={`${idPrefix}-match-case`}
            />
            <span>{parseAccelerator(t('dialog.find.matchCase')).text}</span>
          </label>
          <label className="mfbe-check-field" htmlFor={`${idPrefix}-regex`}>
            <input
              id={`${idPrefix}-regex`}
              type="checkbox"
              checked={options.regex}
              onChange={(event) => update({ regex: event.target.checked })}
              data-testid={`${idPrefix}-regex`}
            />
            <span>{parseAccelerator(t('dialog.find.regex')).text}</span>
          </label>
        </div>
        <fieldset className="mfbe-find-direction" data-testid={`${idPrefix}-direction`}>
          <legend>{t('dialog.find.direction')}</legend>
          <label className="mfbe-check-field" htmlFor={`${idPrefix}-up`}>
            <input
              id={`${idPrefix}-up`}
              type="radio"
              name={`${idPrefix}-direction`}
              checked={options.direction === 'up'}
              onChange={() => update({ direction: 'up' })}
              data-testid={`${idPrefix}-up`}
            />
            <span>{parseAccelerator(t('dialog.find.up')).text}</span>
          </label>
          <label className="mfbe-check-field" htmlFor={`${idPrefix}-down`}>
            <input
              id={`${idPrefix}-down`}
              type="radio"
              name={`${idPrefix}-direction`}
              checked={options.direction === 'down'}
              onChange={() => update({ direction: 'down' })}
              data-testid={`${idPrefix}-down`}
            />
            <span>{parseAccelerator(t('dialog.find.down')).text}</span>
          </label>
        </fieldset>
      </div>
    </div>
  );
}

export function FindDialog({ session, ctx, onClose }: FindDialogProps) {
  const { t } = useTranslation();
  const [options, setOptions] = useState<FindOptions>({
    ...session.options,
    query: session.initialQuery(),
  });
  const [busy, setBusy] = useState(false);

  // The search itself is synchronous; `busy` only guards the modal "not found" message.
  // History persistence is fire-and-forget so rapid Find Next presses are never dropped.
  const findNext = async () => {
    if (!options.query || busy) return;
    setBusy(true);
    try {
      if (session.find(options, 'next')) {
        void session.remember(ctx, 'find', options.query);
      } else {
        await session.reportNotFound(ctx, 'find');
      }
    } finally {
      setBusy(false);
    }
  };

  const buttons: DialogButton[] = [
    {
      id: 'findNext',
      label: t('dialog.find.findNext'),
      disabled: !options.query,
      onClick: () => void findNext(),
    },
    { id: 'cancel', label: t('dialog.buttons.cancel'), onClick: onClose },
  ];

  return (
    <Dialog
      title={t('dialog.find.caption')}
      buttons={buttons}
      defaultButtonId="findNext"
      cancelButtonId="cancel"
      initialFocus="#dialog-find-query"
      testId="dialog-find"
      className="mfbe-finddialog"
      closeLabel={t('dialog.buttons.close')}
    >
      <FindFields
        idPrefix="dialog-find"
        options={options}
        onChange={setOptions}
        history={session.findHistory}
      />
    </Dialog>
  );
}
