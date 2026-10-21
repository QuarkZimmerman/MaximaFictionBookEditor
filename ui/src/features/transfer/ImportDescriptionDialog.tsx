/**
 * The confirmation dialog of the description import (feature 004 US4; spec FR-034): the
 * entries the chosen file offers, each labelled "{{group}}: {{field}}" with the value about to
 * be imported as plain text and a checkbox that is unticked when the dialog opens; the cover
 * entry also shows a small picture of its image, served from the hidden import session's
 * `GET /binary/{importId}/{id}/preview` (requester decision of 2026-10-20), or no picture when
 * the file lacks the data. Import stays disabled while nothing is ticked; Cancel (Escape, the
 * close box) resolves null and changes nothing. Opened by `importDescription.ts` through
 * `dialogs.openCustom`; resolves with the keys of the ticked entries.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog, type DialogButton } from '@/dialogs/Dialog';
import { binaryPreviewUrl } from '@/editor/nodeviews/image';

import { entryLabel, entryValueText, type ImportableEntry } from './importEntries';

import './import.css';

/** The width of the cover picture requested from the core (shown at a small fixed height). */
const PICTURE_WIDTH = 160;

export interface ImportDescriptionDialogProps {
  /** The hidden session of `doc.readDescription`, which serves the cover pictures. */
  importId: string;
  entries: ImportableEntry[];
  onClose: (ticked: string[] | null) => void;
}

export function ImportDescriptionDialog({
  importId,
  entries,
  onClose,
}: ImportDescriptionDialogProps) {
  const { t } = useTranslation();
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = (key: string, on: boolean) => {
    setTicked((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const buttons: DialogButton[] = [
    {
      id: 'import',
      label: t('transfer.import.importButton'),
      onClick: () => onClose([...ticked]),
      disabled: ticked.size === 0,
    },
    { id: 'cancel', label: t('dialog.buttons.cancel'), onClick: () => onClose(null) },
  ];

  return (
    <Dialog
      title={t('transfer.import.title')}
      buttons={buttons}
      defaultButtonId="import"
      cancelButtonId="cancel"
      initialFocus={
        entries.length > 0 ? `[data-testid="import-entry-${entries[0]!.key}-check"]` : undefined
      }
      testId="dialog-import-description"
      className="mfbe-importdialog"
      closeLabel={t('dialog.buttons.close')}
    >
      <ul className="mfbe-import-entries" data-testid="import-entries">
        {entries.map((entry) => {
          const value = entryValueText(entry, t);
          const pictures = (entry.covers ?? []).filter((cover) => cover.binary !== null);
          return (
            <li
              key={entry.key}
              className="mfbe-import-entry"
              data-testid={`import-entry-${entry.key}`}
              data-ticked={ticked.has(entry.key) ? 'true' : 'false'}
            >
              <label className="mfbe-import-entry-row">
                <input
                  type="checkbox"
                  className="mfbe-import-entry-check"
                  checked={ticked.has(entry.key)}
                  onChange={(event) => toggle(entry.key, event.target.checked)}
                  data-testid={`import-entry-${entry.key}-check`}
                />
                <span className="mfbe-import-entry-text">
                  <span
                    className="mfbe-import-entry-label"
                    data-testid={`import-entry-${entry.key}-label`}
                  >
                    {entryLabel(entry, t)}
                  </span>
                  <span
                    className="mfbe-import-entry-value"
                    data-testid={`import-entry-${entry.key}-value`}
                    title={value}
                  >
                    {value}
                  </span>
                </span>
              </label>
              {pictures.length > 0 ? (
                <div className="mfbe-import-entry-pictures">
                  {pictures.map((cover, index) => {
                    const src = binaryPreviewUrl(importId, cover.href, PICTURE_WIDTH);
                    if (!src) return null;
                    return (
                      <img
                        key={cover.href}
                        className="mfbe-import-cover"
                        src={src}
                        alt={value}
                        data-testid={`import-entry-${entry.key}-picture${index > 0 ? `-${index + 1}` : ''}`}
                      />
                    );
                  })}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
