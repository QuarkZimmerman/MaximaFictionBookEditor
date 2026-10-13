/**
 * Language picker (T075, FR-051): an ISO 639-1 list grouped as in the original `eng.xsl` /
 * `rus.xsl` combos (Main / Europe / Asia / America / Africa / Artificial / Other) with the
 * localised names and the code, plus a free-text code field for languages missing from the
 * list. A code that is not in the list is shown as its own first option (the original's
 * "-org-" entry) so the current value is never hidden.
 */

import { useTranslation } from 'react-i18next';

import { useDescriptionForm } from './formContext';
import { getAtPath, type FieldKey } from './model';
import { localName } from './resources';
import { RequiredMark, TextField } from './fields';

export interface LanguagePickerProps {
  /** Form path of the code, e.g. `titleInfo.lang`. */
  fieldKey: FieldKey;
  /** Test id of the select; the free-text code field is `<testId>-code`. */
  testId: string;
  label: string;
  required?: boolean;
}

export function LanguagePicker({ fieldKey, testId, label, required }: LanguagePickerProps) {
  const { t } = useTranslation();
  const { controller, form, languages, language, issues } = useDescriptionForm();
  const raw = getAtPath(form, fieldKey);
  const value = typeof raw === 'string' ? raw : '';
  const code = value.trim();
  const known = languages.groups.some((group) => group.languages.some((l) => l.code === code));
  const missing = required && issues.missing.has(fieldKey as never);

  return (
    <div className="mfbe-desc-field mfbe-desc-language" data-testid={`${testId}-row`}>
      <span className="mfbe-desc-label">
        {label}
        {required ? <RequiredMark missing={!!missing} /> : null}
      </span>
      <select
        className={`mfbe-desc-select${missing ? ' mfbe-desc-input-invalid' : ''}`}
        data-testid={testId}
        value={code}
        aria-invalid={missing ? true : undefined}
        onChange={(event) => controller.setValue(fieldKey, event.target.value)}
      >
        <option value="">{t('descriptionForm.language.none')}</option>
        {code && !known ? (
          <option value={code} data-testid={`${testId}-unknown`}>
            {code}
          </option>
        ) : null}
        {languages.groups.map((group) => (
          <optgroup key={group.key} label={localName(group.title, language, group.key)}>
            {group.languages.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {`${localName(entry.name, language, entry.code)} (${entry.code})`}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <TextField
        fieldKey={fieldKey}
        testId={`${testId}-code`}
        size="short"
        placeholder={t('descriptionForm.language.code')}
        title={t('descriptionForm.language.freeText')}
        maxLength={16}
      />
    </div>
  );
}
