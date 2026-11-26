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

import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { tip } from '@/app/tooltips';
import {
  deriveMaximaBindings,
  roleToMaximaPersonRole,
  unbindRowIdentities,
} from '@/features/description/maximaIdentities';
import { emptyRoleEntry, ROLES, type Role, type RoleEntry } from '@/features/description/roles';

import { AddButton, RemoveButton, Row, SubSection, TextField } from './fields';
import { readOnlySelectProps, useDescriptionForm } from './formContext';
import { MaximaLookupDropdown } from './MaximaLookupDropdown';
import { MaximaRowStatusBadge } from './maximaLookupStatus';
import { setAtPath } from './model';
import { useMaximaPersonLookup } from './useMaximaPersonLookup';

const TEST_PREFIX = 'description-role';

export function RoleList() {
  const { t } = useTranslation();
  const { controller, form, maximaLookup } = useDescriptionForm();
  const roles = form.roles;

  const add = () =>
    controller.update((current) => ({ ...current, roles: [...current.roles, emptyRoleEntry()] }));
  const remove = (index: number) =>
    controller.update((current) => {
      const rowPath = `roles.${index}`;
      const prevBindings = maximaLookup?.enabled ? deriveMaximaBindings(current) : null;
      const next = {
        ...current,
        roles: current.roles.filter((_, i) => i !== index),
      };
      return prevBindings ? unbindRowIdentities(next, [rowPath], prevBindings) : next;
    });

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
      {roles.map((entry, index) => (
        <RoleRow key={index} entry={entry} index={index} onRemove={() => remove(index)} />
      ))}
    </SubSection>
  );
}

function RoleRow({
  entry,
  index,
  onRemove,
}: {
  entry: RoleEntry;
  index: number;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const { controller, issues, readOnly, maximaLookup } = useDescriptionForm();
  const key = `roles.${index}`;
  const incomplete = issues.incompleteRoles.has(key);

  const rowNamesRef = useRef<HTMLDivElement | null>(null);
  const lookup = useMaximaPersonLookup({
    rowPath: key,
    role: roleToMaximaPersonRole(entry.role),
    names: {
      lastName: entry.lastName ?? '',
      firstName: entry.firstName ?? '',
      middleName: entry.middleName ?? '',
    },
  });
  const handleFieldBlur = (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && rowNamesRef.current?.contains(nextTarget)) return;
    lookup.handleRowBlur();
  };
  const confirmedClass =
    lookup.active && lookup.confirmedLibraryId ? 'mfbe-ml-input-confirmed' : undefined;
  const lookupTestPrefix = `${TEST_PREFIX}-${index}-lookup`;

  const handleRoleChange = (nextRole: Role) => {
    if (!lookup.active) {
      controller.setValue(`${key}.role`, nextRole);
      return;
    }
    lookup.closeDropdown();
    controller.update((current) => {
      const prevBindings = deriveMaximaBindings(current);
      const next = setAtPath(current, `${key}.role`, nextRole);
      return unbindRowIdentities(next, [key], prevBindings);
    });
  };

  return (
    <div
      className={`mfbe-desc-item${incomplete ? ' mfbe-desc-item-invalid' : ''}`}
      data-testid={`${TEST_PREFIX}-${index}`}
    >
      <div className="mfbe-desc-item-tools">
        <RemoveButton testId={`${TEST_PREFIX}-${index}-remove`} onClick={onRemove} />
      </div>
      <div className="mfbe-desc-item-body">
        <Row>
          <label className="mfbe-desc-field" data-testid={`${TEST_PREFIX}-${index}-role-row`}>
            <span className="mfbe-desc-label">{t('descriptionForm.roles.role')}</span>
            <select
              {...tip(t('tip.description.role'))}
              className="mfbe-desc-select mfbe-desc-role-select"
              data-testid={`${TEST_PREFIX}-${index}-role`}
              value={entry.role}
              {...readOnlySelectProps(readOnly, (event) =>
                handleRoleChange(event.target.value as Role),
              )}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(`descriptionForm.roles.names.${role}`)}
                </option>
              ))}
            </select>
          </label>
          {lookup.active ? (
            <MaximaRowStatusBadge
              status={lookup.confirmedLibraryId ? 'confirmed' : 'unconfirmed'}
              libraryId={lookup.confirmedLibraryId}
              url={lookup.confirmedUrl}
              testIdPrefix={lookupTestPrefix}
              rpc={maximaLookup?.rpc ?? null}
            />
          ) : null}
        </Row>
        <div className={lookup.active ? 'mfbe-ml-anchor' : undefined} ref={rowNamesRef}>
          <Row>
            <TextField
              fieldKey={`${key}.lastName`}
              testId={`${TEST_PREFIX}-${index}-last`}
              label={t('descriptionForm.person.last')}
              className={confirmedClass}
              autoComplete={lookup.active ? 'off' : undefined}
              onValueChange={
                lookup.active ? (val) => lookup.handleNameChange('lastName', val) : undefined
              }
              onFocus={lookup.active ? lookup.handleSearchFieldFocus : undefined}
              onClick={lookup.active ? lookup.handleSearchFieldClick : undefined}
              onBlur={lookup.active ? handleFieldBlur : undefined}
              onKeyDown={lookup.active ? lookup.handleKeyDown : undefined}
            />
            <TextField
              fieldKey={`${key}.firstName`}
              testId={`${TEST_PREFIX}-${index}-first`}
              label={t('descriptionForm.person.first')}
              className={confirmedClass}
              autoComplete={lookup.active ? 'off' : undefined}
              onValueChange={
                lookup.active ? (val) => lookup.handleNameChange('firstName', val) : undefined
              }
              onFocus={lookup.active ? lookup.handleSearchFieldFocus : undefined}
              onClick={lookup.active ? lookup.handleSearchFieldClick : undefined}
              onBlur={lookup.active ? handleFieldBlur : undefined}
              onKeyDown={lookup.active ? lookup.handleKeyDown : undefined}
            />
            <TextField
              fieldKey={`${key}.middleName`}
              testId={`${TEST_PREFIX}-${index}-middle`}
              label={t('descriptionForm.person.middle')}
              className={confirmedClass}
              autoComplete={lookup.active ? 'off' : undefined}
              onValueChange={
                lookup.active ? (val) => lookup.handleNameChange('middleName', val) : undefined
              }
              onBlur={lookup.active ? handleFieldBlur : undefined}
            />
          </Row>
          {lookup.active ? (
            <MaximaLookupDropdown
              testIdPrefix={lookupTestPrefix}
              open={lookup.dropdownOpen}
              loading={lookup.loading}
              errorMessage={lookup.errorMessage}
              items={lookup.items}
              activeIndex={lookup.activeIndex}
              page={lookup.page}
              hasMore={lookup.hasMore}
              rpc={maximaLookup?.rpc ?? null}
              onHighlightIndex={lookup.setActiveIndex}
              onPick={lookup.handlePick}
              onPrevPage={lookup.handlePrevPage}
              onNextPage={lookup.handleNextPage}
              onClose={lookup.closeDropdown}
            />
          ) : null}
        </div>
        {incomplete ? (
          <div className="mfbe-desc-warning" data-testid={`${TEST_PREFIX}-${index}-incomplete`}>
            {t('descriptionForm.roles.incomplete')}
          </div>
        ) : null}
      </div>
    </div>
  );
}
