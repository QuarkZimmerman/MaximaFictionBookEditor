/**
 * Feature 011 (rc.2 review): the Styles view's *Add style* dialog. Two choices, one below the other:
 * a style of an FB2 element, picked from a list that typing narrows (a selector such as
 * `epigraph p` may be typed whole), or a named style, typed by its name alone - the class's dot is
 * added. Every control explains itself in its tooltip.
 */
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { tip } from '@/app/tooltips';
import { Dialog, type DialogButton } from '@/dialogs/Dialog';

import { CLASS_NAME, ELEMENT_CHOICES, filterChoices } from './addStyleChoices';

export interface AddStyleDialogProps {
  /** Why a selector cannot be added (the Styles view's check), or null. */
  reasonOf: (selector: string) => string | null;
  onClose: (selector: string | null) => void;
}

export function AddStyleDialog({ reasonOf, onClose }: AddStyleDialogProps) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<'element' | 'named'>('element');
  const [element, setElement] = useState('');
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  const listId = useId();
  const choices = useMemo(
    () =>
      ELEMENT_CHOICES.map((choice) => {
        const label = t(`styles.element.${choice.key}`);
        return {
          ...choice,
          label,
          text: t('styles.addStyle.option', { label, selector: choice.selector }),
        };
      }),
    [t],
  );
  const shown = filterChoices(choices, element);
  // The selector the element field stands for: a choice picked from the list, else what was typed.
  const picked = choices.find((choice) => choice.text === element)?.selector ?? element.trim();
  const named = name.trim().replace(/^\./, '');
  const selector = kind === 'element' ? picked : named ? `.${named}` : '';
  const reason = !selector
    ? null
    : kind === 'named' && !CLASS_NAME.test(named)
      ? t('styles.addStyle.badName')
      : reasonOf(selector);
  const pick = (text: string) => {
    setElement(text);
    setOpen(false);
  };
  const buttons: DialogButton[] = [
    {
      id: 'ok',
      label: t('dialog.buttons.ok'),
      disabled: !selector || reason !== null,
      title: t('styles.addStyle.okTip'),
      onClick: () => onClose(selector),
    },
    { id: 'cancel', label: t('dialog.buttons.cancel'), onClick: () => onClose(null) },
  ];
  return (
    <Dialog
      title={t('styles.addStyle.caption')}
      buttons={buttons}
      defaultButtonId="ok"
      cancelButtonId="cancel"
      initialFocus="#dialog-styles-add-element"
      testId="dialog-styles-add"
      className="mfbe-addstyle"
      closeLabel={t('dialog.buttons.close')}
    >
      <div className="mfbe-addstyle-grid">
        <label className="mfbe-addstyle-choice" {...tip(t('styles.addStyle.elementTip'))}>
          <input
            type="radio"
            name="mfbe-addstyle-kind"
            checked={kind === 'element'}
            onChange={() => setKind('element')}
            data-testid="dialog-styles-add-kind-element"
            {...tip(t('styles.addStyle.elementTip'))}
          />
          {t('styles.addStyle.element')}
        </label>
        <div className="mfbe-addstyle-combo">
          <input
            id="dialog-styles-add-element"
            data-testid="dialog-styles-add-element"
            role="combobox"
            aria-expanded={open && kind === 'element' && shown.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            value={element}
            disabled={kind !== 'element'}
            placeholder={t('styles.addStyle.elementPlaceholder')}
            onChange={(event) => {
              setElement(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={(event) => {
              // Enter takes the first entry left in the list when nothing is picked yet.
              if (
                event.key === 'Enter' &&
                open &&
                shown.length > 0 &&
                !choices.some((c) => c.text === element)
              ) {
                event.preventDefault();
                event.stopPropagation();
                pick(shown[0]!.text);
              }
              if (event.key === 'Escape' && open) {
                event.stopPropagation();
                setOpen(false);
              }
            }}
            {...tip(t('styles.addStyle.elementListTip'))}
          />
          {open && kind === 'element' && shown.length > 0 ? (
            <ul
              id={listId}
              role="listbox"
              className="mfbe-addstyle-list"
              data-testid="dialog-styles-add-list"
            >
              {shown.map((choice) => (
                <li
                  key={choice.selector}
                  role="option"
                  aria-selected={picked === choice.selector}
                  data-testid={`dialog-styles-add-option-${choice.key}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pick(choice.text);
                  }}
                  {...tip(
                    t('styles.addStyle.optionTip', {
                      label: choice.label,
                      selector: choice.selector,
                    }),
                  )}
                >
                  {choice.text}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <label className="mfbe-addstyle-choice" {...tip(t('styles.addStyle.namedTip'))}>
          <input
            type="radio"
            name="mfbe-addstyle-kind"
            checked={kind === 'named'}
            onChange={() => setKind('named')}
            data-testid="dialog-styles-add-kind-named"
            {...tip(t('styles.addStyle.namedTip'))}
          />
          {t('styles.addStyle.named')}
        </label>
        <input
          data-testid="dialog-styles-add-name"
          value={name}
          disabled={kind !== 'named'}
          placeholder={t('styles.addStyle.namePlaceholder')}
          onChange={(event) => setName(event.target.value)}
          {...tip(t('styles.addStyle.nameTip'))}
        />
      </div>
      <p className="mfbe-addstyle-result" data-testid="dialog-styles-add-result">
        {selector ? t('styles.addStyle.result', { selector }) : t('styles.addStyle.resultNone')}
      </p>
      {reason ? (
        <p className="mfbe-inputdialog-error" data-testid="dialog-styles-add-error">
          {reason}
        </p>
      ) : null}
    </Dialog>
  );
}
