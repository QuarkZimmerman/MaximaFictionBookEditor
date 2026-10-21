/**
 * The "Other persons" list of the Title info group (feature 004, US3; FR-020 to FR-023): one
 * row per person with a role - one of the six the Maxima Library knows (illustrator, editor,
 * compiler, designer, commentator, about the author) - and the last, first and middle name,
 * with Add and Remove only (no reordering - requester, 2026-10-20). A list of its own after
 * Translators, empty for a new document; the Authors and Translators lists (`PersonList`) are
 * untouched by it. The entries are a projection of the `custom-info` rows in the library's
 * format (`features/description/roles.ts`); an entry without a last name while another name is
 * given is flagged, because it would reload with that name in the last-name field.
 */

import { useTranslation } from 'react-i18next';

import { emptyRoleEntry, ROLES, type Role } from '@/features/description/roles';

import { AddButton, RemoveButton, Row, SubSection, TextField } from './fields';
import { readOnlySelectProps, useDescriptionForm } from './formContext';

const TEST_PREFIX = 'description-role';

export function RoleList() {
  const { t } = useTranslation();
  const { controller, form, issues, readOnly } = useDescriptionForm();
  const roles = form.roles;

  const add = () =>
    controller.update((current) => ({ ...current, roles: [...current.roles, emptyRoleEntry()] }));
  const remove = (index: number) =>
    controller.update((current) => ({
      ...current,
      roles: current.roles.filter((_, i) => i !== index),
    }));

  return (
    <SubSection
      id={`${TEST_PREFIX}-list`}
      title={t('descriptionForm.roles.title')}
      actions={
        <AddButton
          testId={`${TEST_PREFIX}-add`}
          onClick={add}
          label={t('descriptionForm.roles.add')}
        />
      }
    >
      {/* Empty by default: the caption and the Add control alone (US3 scenario 10). */}
      {roles.map((entry, index) => {
        const key = `roles.${index}`;
        const incomplete = issues.incompleteRoles.has(key);
        return (
          <div
            className={`mfbe-desc-item${incomplete ? ' mfbe-desc-item-invalid' : ''}`}
            key={index}
            data-testid={`${TEST_PREFIX}-${index}`}
          >
            <div className="mfbe-desc-item-tools">
              <RemoveButton
                testId={`${TEST_PREFIX}-${index}-remove`}
                onClick={() => remove(index)}
              />
            </div>
            <div className="mfbe-desc-item-body">
              <Row>
                <label className="mfbe-desc-field" data-testid={`${TEST_PREFIX}-${index}-role-row`}>
                  <span className="mfbe-desc-label">{t('descriptionForm.roles.role')}</span>
                  <select
                    className="mfbe-desc-select mfbe-desc-role-select"
                    data-testid={`${TEST_PREFIX}-${index}-role`}
                    value={entry.role}
                    {...readOnlySelectProps(readOnly, (event) =>
                      controller.setValue(`${key}.role`, event.target.value as Role),
                    )}
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {t(`descriptionForm.roles.names.${role}`)}
                      </option>
                    ))}
                  </select>
                </label>
              </Row>
              <Row>
                <TextField
                  fieldKey={`${key}.lastName`}
                  testId={`${TEST_PREFIX}-${index}-last`}
                  label={t('descriptionForm.person.last')}
                />
                <TextField
                  fieldKey={`${key}.firstName`}
                  testId={`${TEST_PREFIX}-${index}-first`}
                  label={t('descriptionForm.person.first')}
                />
                <TextField
                  fieldKey={`${key}.middleName`}
                  testId={`${TEST_PREFIX}-${index}-middle`}
                  label={t('descriptionForm.person.middle')}
                />
              </Row>
              {incomplete ? (
                <div
                  className="mfbe-desc-warning"
                  data-testid={`${TEST_PREFIX}-${index}-incomplete`}
                >
                  {t('descriptionForm.roles.incomplete')}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </SubSection>
  );
}
