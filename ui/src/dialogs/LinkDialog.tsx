/**
 * Link target prompt (T061) for Style > Link...: the original editor created the link and moved
 * the focus to the Links bar's Href field; here the target is asked in a small dialog (the
 * Links bar still edits it afterwards). Targets without `#` or a scheme get `http://`
 * prepended, as the original Href field did. Resolves with the href or null when cancelled.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { normalizeHref } from '@/features/linkTargets';

import { Dialog, type DialogButton } from './Dialog';

import './editing.css';

export interface LinkDialogProps {
  initialHref?: string;
  /** Ids available in the document (offered as suggestions). */
  targets?: readonly string[];
  onClose: (href: string | null) => void;
}

export function LinkDialog({ initialHref = '', targets = [], onClose }: LinkDialogProps) {
  const { t } = useTranslation();
  const [href, setHref] = useState(initialHref);
  const normalized = normalizeHref(href);
  const buttons: DialogButton[] = [
    {
      id: 'ok',
      label: t('dialog.buttons.ok'),
      disabled: normalized.length === 0,
      onClick: () => onClose(normalized),
    },
    { id: 'cancel', label: t('dialog.buttons.cancel'), onClick: () => onClose(null) },
  ];
  return (
    <Dialog
      title={t('editing.link.caption')}
      buttons={buttons}
      defaultButtonId="ok"
      cancelButtonId="cancel"
      initialFocus="#dialog-link-href"
      testId="dialog-link"
      className="mfbe-linkdialog"
      closeLabel={t('dialog.buttons.close')}
    >
      <label className="mfbe-inputdialog-prompt" htmlFor="dialog-link-href">
        {t('editing.link.prompt')}
      </label>
      <input
        id="dialog-link-href"
        className="mfbe-inputdialog-input"
        type="text"
        value={href}
        list="dialog-link-targets"
        onChange={(event) => setHref(event.target.value)}
        data-testid="dialog-link-href"
        spellCheck={false}
      />
      <datalist id="dialog-link-targets">
        {targets.map((id) => (
          <option key={id} value={`#${id}`} />
        ))}
      </datalist>
      {normalized && normalized !== href.trim() ? (
        <div className="mfbe-field-hint" data-testid="dialog-link-normalized">
          {normalized}
        </div>
      ) : null}
    </Dialog>
  );
}
