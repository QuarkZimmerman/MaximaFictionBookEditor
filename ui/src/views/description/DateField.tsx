/**
 * Date field (T075): the display text (`<date>` content) and the ISO `value` attribute, as the
 * "Date text:" / "Date value:" pair of the original form. The value field is flagged when it is
 * not `YYYY-MM-DD`; a "today" shortcut fills both. The whole date is omitted on save when both
 * parts are empty (title-info) or written empty when required (document-info).
 */

import { useTranslation } from 'react-i18next';

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

export function DateField({ fieldKey, testPrefix, required }: DateFieldProps) {
  const { t } = useTranslation();
  const { controller, issues } = useDescriptionForm();
  const invalid = issues.invalidDates.has(`${fieldKey}.value`);
  const missing = required && issues.missing.has(fieldKey as never);
  const today = () => {
    const value = isoDate(new Date());
    controller.update((current) => {
      const existing = (getAtPath(current, fieldKey) as { text?: string } | undefined) ?? {};
      const text = (existing.text ?? '').trim() ? existing.text : value;
      return setAtPath(current, fieldKey, { ...existing, text, value });
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
        testId={`${testPrefix}-today`}
        onClick={today}
        title={t('descriptionForm.date.today')}
      >
        {t('descriptionForm.date.today')}
      </SmallButton>
    </Row>
  );
}
