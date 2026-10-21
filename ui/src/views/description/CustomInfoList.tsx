/**
 * Custom info rows (T075, FR-050): repeatable `info-type` + text pairs (the `custom-info`
 * template of the original `fb2.xsl`), Add / Remove. Rows with both fields empty are dropped on
 * save; a row with text but no type is flagged (the type is required by the schema).
 *
 * A row read into the "Other persons" list (a Maxima Library role entry, feature 004 US3,
 * FR-022) is not shown here - one datum is edited in one place - while it keeps its real index
 * in the form, so the field keys (`customInfo.<i>.text`) and test ids of the other rows are
 * those of the rows as read.
 */

import { useTranslation } from 'react-i18next';

import { AddButton, EmptyHint, RemoveButton, TextField } from './fields';
import { useDescriptionForm } from './formContext';
import { setAtPath } from './model';

export function CustomInfoList() {
  const { t } = useTranslation();
  const { controller, form, issues } = useDescriptionForm();
  const rows = form.customInfo;
  const shown = rows.map((row, index) => ({ row, index })).filter(({ row }) => !row.roleRow);
  const add = () =>
    controller.update((current) =>
      setAtPath(current, 'customInfo', [...current.customInfo, { infoType: '', text: '' }]),
    );
  const remove = (index: number) =>
    controller.update((current) =>
      setAtPath(
        current,
        'customInfo',
        current.customInfo.filter((_, i) => i !== index),
      ),
    );
  return (
    <div className="mfbe-desc-form" data-testid="description-custom-info-form">
      {shown.length === 0 ? <EmptyHint>{t('descriptionForm.custom.none')}</EmptyHint> : null}
      {shown.map(({ index }) => {
        const untyped = issues.untypedCustomInfo.has(`customInfo.${index}`);
        return (
          <div className="mfbe-desc-item" key={index} data-testid={`description-custom-${index}`}>
            <div className="mfbe-desc-item-tools">
              <RemoveButton
                testId={`description-custom-${index}-remove`}
                onClick={() => remove(index)}
              />
            </div>
            <div className="mfbe-desc-item-body">
              <TextField
                fieldKey={`customInfo.${index}.infoType`}
                testId={`description-custom-${index}-type`}
                label={t('descriptionForm.custom.type')}
                size="middle"
                invalid={untyped ? t('descriptionForm.custom.untyped') : null}
              />
              <TextField
                fieldKey={`customInfo.${index}.text`}
                testId={`description-custom-${index}-text`}
                label={t('descriptionForm.custom.value')}
                multiline
                rows={3}
                size="wide"
              />
            </div>
          </div>
        );
      })}
      <div className="mfbe-desc-sub-actions">
        <AddButton
          testId="description-custom-add"
          onClick={add}
          label={t('descriptionForm.custom.add')}
        />
      </div>
    </div>
  );
}
