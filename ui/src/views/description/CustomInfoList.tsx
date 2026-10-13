/**
 * Custom info rows (T075, FR-050): repeatable `info-type` + text pairs (the `custom-info`
 * template of the original `fb2.xsl`), Add / Remove. Rows with both fields empty are dropped on
 * save; a row with text but no type is flagged (the type is required by the schema).
 */

import { useTranslation } from 'react-i18next';

import { AddButton, EmptyHint, RemoveButton, TextField } from './fields';
import { useDescriptionForm } from './formContext';
import { setAtPath } from './model';

export function CustomInfoList() {
  const { t } = useTranslation();
  const { controller, form, issues } = useDescriptionForm();
  const rows = form.customInfo;
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
      {rows.length === 0 ? <EmptyHint>{t('descriptionForm.custom.none')}</EmptyHint> : null}
      {rows.map((_, index) => {
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
