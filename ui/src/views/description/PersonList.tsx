/**
 * Authors / translators / document authors / publishers (T075): one row per person with
 * first / middle / last name, nickname, home page(s) and e-mail(s) - the `author` template of
 * the original `fb2.xsl` - plus Add / Remove. A person that is neither empty nor complete
 * (first + last name or nickname, data-model.md §1.2) is flagged; completely empty rows are
 * dropped from the model by the binding.
 */

import { useTranslation } from 'react-i18next';

import type { Person } from '@/model/document';

import { AddButton, EmptyHint, RemoveButton, Row, SubSection, TextField } from './fields';
import { useDescriptionForm } from './formContext';
import { emptyPerson, getAtPath, setAtPath, type FieldKey } from './model';

export interface PersonListProps {
  /** Form path of the list, e.g. `titleInfo.authors`. */
  fieldKey: FieldKey;
  /** Test id prefix, e.g. `description-author` -> `description-author-0-first`. */
  testPrefix: string;
  title: string;
  required?: boolean;
}

export function PersonList({ fieldKey, testPrefix, title, required }: PersonListProps) {
  const { t } = useTranslation();
  const { controller, form, issues } = useDescriptionForm();
  const persons = (getAtPath(form, fieldKey) as Person[] | undefined) ?? [];
  const missing = required && issues.missing.has(fieldKey as never);

  const add = () =>
    controller.update((current) =>
      setAtPath(current, fieldKey, [
        ...((getAtPath(current, fieldKey) as Person[] | undefined) ?? []),
        emptyPerson(),
      ]),
    );
  const remove = (index: number) =>
    controller.update((current) =>
      setAtPath(
        current,
        fieldKey,
        ((getAtPath(current, fieldKey) as Person[] | undefined) ?? []).filter(
          (_, i) => i !== index,
        ),
      ),
    );
  const addTo = (index: number, list: 'homePages' | 'emails') =>
    controller.update((current) => {
      const key = `${fieldKey}.${index}.${list}`;
      const values = (getAtPath(current, key) as string[] | undefined) ?? [];
      return setAtPath(current, key, [...values, '']);
    });
  const removeFrom = (index: number, list: 'homePages' | 'emails', position: number) =>
    controller.update((current) => {
      const key = `${fieldKey}.${index}.${list}`;
      const values = (getAtPath(current, key) as string[] | undefined) ?? [];
      return setAtPath(
        current,
        key,
        values.filter((_, i) => i !== position),
      );
    });

  return (
    <SubSection
      id={`${testPrefix}-list`}
      title={title}
      required={required}
      missing={!!missing}
      actions={<AddButton testId={`${testPrefix}-add`} onClick={add} />}
    >
      {persons.length === 0 ? (
        <EmptyHint>{t('descriptionForm.noPersons')}</EmptyHint>
      ) : (
        persons.map((person, index) => {
          const key = `${fieldKey}.${index}`;
          const incomplete = issues.incompletePersons.has(key);
          return (
            <div
              className={`mfbe-desc-item${incomplete ? ' mfbe-desc-item-invalid' : ''}`}
              key={index}
              data-testid={`${testPrefix}-${index}`}
            >
              <div className="mfbe-desc-item-tools">
                <RemoveButton
                  testId={`${testPrefix}-${index}-remove`}
                  onClick={() => remove(index)}
                />
              </div>
              <div className="mfbe-desc-item-body">
                <Row>
                  <TextField
                    fieldKey={`${key}.firstName`}
                    testId={`${testPrefix}-${index}-first`}
                    label={t('descriptionForm.person.first')}
                  />
                  <TextField
                    fieldKey={`${key}.middleName`}
                    testId={`${testPrefix}-${index}-middle`}
                    label={t('descriptionForm.person.middle')}
                  />
                  <TextField
                    fieldKey={`${key}.lastName`}
                    testId={`${testPrefix}-${index}-last`}
                    label={t('descriptionForm.person.last')}
                  />
                </Row>
                <Row>
                  <TextField
                    fieldKey={`${key}.nickname`}
                    testId={`${testPrefix}-${index}-nickname`}
                    label={t('descriptionForm.person.nickname')}
                  />
                  <TextField
                    fieldKey={`${key}.id`}
                    testId={`${testPrefix}-${index}-id`}
                    label={t('descriptionForm.person.id')}
                    size="middle"
                  />
                </Row>
                <StringList
                  fieldKey={`${key}.homePages`}
                  values={person.homePages}
                  label={t('descriptionForm.person.homePage')}
                  testPrefix={`${testPrefix}-${index}-homepage`}
                  onAdd={() => addTo(index, 'homePages')}
                  onRemove={(position) => removeFrom(index, 'homePages', position)}
                />
                <StringList
                  fieldKey={`${key}.emails`}
                  values={person.emails}
                  label={t('descriptionForm.person.email')}
                  testPrefix={`${testPrefix}-${index}-email`}
                  onAdd={() => addTo(index, 'emails')}
                  onRemove={(position) => removeFrom(index, 'emails', position)}
                />
                {incomplete ? (
                  <div
                    className="mfbe-desc-warning"
                    data-testid={`${testPrefix}-${index}-incomplete`}
                  >
                    {t('descriptionForm.person.incomplete')}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })
      )}
    </SubSection>
  );
}

/** A repeatable string field (home pages, e-mails, source URLs). */
export function StringList({
  fieldKey,
  values,
  label,
  testPrefix,
  onAdd,
  onRemove,
  size,
}: {
  fieldKey: FieldKey;
  values: string[];
  label: string;
  testPrefix: string;
  onAdd: () => void;
  onRemove: (index: number) => void;
  size?: 'short' | 'middle' | 'wide';
}) {
  const { t } = useTranslation();
  return (
    <div className="mfbe-desc-stringlist" data-testid={`${testPrefix}-list`}>
      <span className="mfbe-desc-label">{label}</span>
      <div className="mfbe-desc-stringlist-items">
        {values.map((_, index) => (
          <div className="mfbe-desc-stringlist-item" key={index}>
            <TextField
              fieldKey={`${fieldKey}.${index}`}
              testId={`${testPrefix}-${index}`}
              size={size ?? 'wide'}
            />
            <RemoveButton
              testId={`${testPrefix}-${index}-remove`}
              onClick={() => onRemove(index)}
            />
          </div>
        ))}
        <AddButton testId={`${testPrefix}-add`} onClick={onAdd} label={t('descriptionForm.add')} />
      </div>
    </div>
  );
}
