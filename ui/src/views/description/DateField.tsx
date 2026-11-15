/**
 * Date field (T075): the display text (`<date>` content) and the ISO `value` attribute, as the
 * "Date text:" / "Date value:" pair of the original form. The value field is flagged when it is
 * not `YYYY-MM-DD`; the "Today" shortcut replaces both parts (feature 003 FR-050): the value
 * with today's `YYYY-MM-DD`, the text with today's date in the long date format of the
 * system's regional settings - asked of the core (`doc.formatDate`, the function that also
 * fills in a loaded document's date), so the text follows the regional settings and not the
 * interface language; only when that call itself fails (connection lost) the interface
 * language's long form from `Intl` stands in. The whole date is omitted on save when both parts
 * are empty (title-info) or written empty when required (document-info).
 */

import { useTranslation } from 'react-i18next';

import { useAppServices } from '@/app/services';
import { Dialog, type DialogButton } from '@/dialogs/Dialog';
import { recogniseDate } from '@/features/description/dateFix';
import type { RpcClient } from '@/rpc/client';

import { Row, SmallButton, TextField } from './fields';
import { useDescriptionForm } from './formContext';
import { getAtPath, isoDate, setAtPath, type FieldKey } from './model';

export interface DateFieldProps {
  /** Form path of the DateValue, e.g. `titleInfo.date`. */
  fieldKey: FieldKey;
  /** Test id prefix -> `<prefix>-text`, `<prefix>-value`, `<prefix>-today`. */
  testPrefix: string;
  required?: boolean;
}

/**
 * Today's date text: the core's regional long date, else (no core, or the call failed) the
 * interface language's long form.
 */
async function todayText(
  rpc: RpcClient | null,
  now: Date,
  value: string,
  language: string,
): Promise<string> {
  if (rpc) {
    try {
      return (await rpc.call('doc.formatDate', { value })).text;
    } catch {
      // Falls through to the interface language's form.
    }
  }
  return new Intl.DateTimeFormat(language, { dateStyle: 'long' }).format(now);
}

export function DateField({ fieldKey, testPrefix, required }: DateFieldProps) {
  const { t, i18n } = useTranslation();
  const { rpc, dialogs } = useAppServices();
  const { controller, issues, form, readOnly } = useDescriptionForm();
  // Feature 015 (FR-018..FR-022): Fix for a value in a wrong but meaningful format.
  const value = (getAtPath(form, `${fieldKey}.value`) as string | undefined) ?? '';
  const candidates = recogniseDate(value);
  const fix = async () => {
    if (readOnly) return;
    if (candidates.kind === 'one') {
      controller.setValue(`${fieldKey}.value`, candidates.day);
    } else if (candidates.kind === 'two') {
      const chosen = await dialogs.openCustom<string | null>((close) => (
        <DateChoiceDialog value={value} days={candidates.days} onClose={close} />
      ));
      if (chosen) controller.setValue(`${fieldKey}.value`, chosen);
    }
  };
  const invalid = issues.invalidDates.has(`${fieldKey}.value`);
  const missing = required && issues.missing.has(fieldKey as never);
  const today = () => {
    const now = new Date();
    const value = isoDate(now);
    void todayText(rpc, now, value, i18n.language).then((text) => {
      controller.update((current) => {
        const existing = (getAtPath(current, fieldKey) as object | undefined) ?? {};
        return setAtPath(current, fieldKey, { ...existing, text, value });
      });
    });
  };
  return (
    <Row className="mfbe-desc-date">
      <TextField
        fieldKey={`${fieldKey}.text`}
        testId={`${testPrefix}-text`}
        label={t('descriptionForm.date.text')}
        required={required}
        invalid={missing ? t('descriptionForm.required') : null}
      />
      <TextField
        fieldKey={`${fieldKey}.value`}
        testId={`${testPrefix}-value`}
        label={t('descriptionForm.date.value')}
        placeholder={t('descriptionForm.date.placeholder')}
        size="middle"
        invalid={invalid ? t('descriptionForm.date.invalid') : null}
      />
      <SmallButton
        testId={`${testPrefix}-fix`}
        onClick={() => void fix()}
        disabled={candidates.kind === 'none' || readOnly}
        title={
          candidates.kind === 'one'
            ? t('descriptionForm.date.fixTitle', { day: candidates.day })
            : candidates.kind === 'two'
              ? t('descriptionForm.date.fixChoose')
              : t('descriptionForm.date.fixNone')
        }
      >
        {t('descriptionForm.date.fix')}
      </SmallButton>
      <SmallButton
        testId={`${testPrefix}-today`}
        onClick={today}
        title={t('descriptionForm.date.today')}
      >
        {t('descriptionForm.date.today')}
      </SmallButton>
    </Row>
  );
}

/**
 * Feature 015 (FR-022, Q2 = D): a value whose day and month can be read both ways - both days,
 * written out in the interface's language, and the user chooses; Cancel leaves the value.
 */
function DateChoiceDialog({
  value,
  days,
  onClose,
}: {
  value: string;
  days: [string, string];
  onClose: (day: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const written = (day: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long', timeZone: 'UTC' }).format(
      new Date(`${day}T00:00:00Z`),
    );
  const buttons: DialogButton[] = [
    { id: 'a', label: written(days[0]), onClick: () => onClose(days[0]) },
    { id: 'b', label: written(days[1]), onClick: () => onClose(days[1]) },
    { id: 'cancel', label: t('dialog.buttons.cancel'), onClick: () => onClose(null) },
  ];
  return (
    <Dialog
      title={t('dateFix.choice.title')}
      buttons={buttons}
      defaultButtonId={null}
      cancelButtonId="cancel"
      testId="date-fix-choice"
      closeLabel={t('dialog.buttons.close')}
    >
      <p>{t('dateFix.choice.text', { value })}</p>
    </Dialog>
  );
}
