/**
 * Authors / translators / document authors / publishers (T075): one row per person with
 * first / middle / last name, nickname, home page(s) and e-mail(s) - the `author` template of
 * the original `fb2.xsl` - plus Add / Remove. A person that is neither empty nor complete
 * (first + last name or nickname, data-model.md §1.2) is flagged; completely empty rows are
 * dropped from the model by the binding.
 */

import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { deriveMaximaBindings, unbindRowIdentities } from '@/features/description/maximaIdentities';
import type { Person } from '@/model/document';

import {
  AddButton,
  EmptyHint,
  RemoveButton,
  Row,
  SmallButton,
  SubSection,
  TextField,
} from './fields';
import { useDescriptionForm } from './formContext';
import { MaximaLookupDropdown } from './MaximaLookupDropdown';
import { MaximaRowStatusBadge } from './maximaLookupStatus';
import { emptyPerson, getAtPath, setAtPath, type FieldKey } from './model';
import { useMaximaPersonLookup } from './useMaximaPersonLookup';

export interface PersonListProps {
  /** Form path of the list, e.g. `titleInfo.authors`. */
  fieldKey: FieldKey;
  /** Test id prefix, e.g. `description-author` -> `description-author-0-first`. */
  testPrefix: string;
  title: string;
  required?: boolean;
  /** Maxima Library lookup role; provided ONLY for `titleInfo` Authors and Translators. */
  lookupRole?: 'author' | 'translator';
}

export function PersonList({ fieldKey, testPrefix, title, required, lookupRole }: PersonListProps) {
  const { t } = useTranslation();
  const { controller, form, issues, maximaLookup } = useDescriptionForm();
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
    controller.update((current) => {
      const rowPath = `${fieldKey}.${index}`;
      const prevBindings =
        lookupRole && maximaLookup?.enabled ? deriveMaximaBindings(current) : null;
      const next = setAtPath(
        current,
        fieldKey,
        ((getAtPath(current, fieldKey) as Person[] | undefined) ?? []).filter(
          (_, i) => i !== index,
        ),
      );
      return prevBindings ? unbindRowIdentities(next, [rowPath], prevBindings) : next;
    });
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
        persons.map((person, index) => (
          <PersonRow
            key={index}
            person={person}
            index={index}
            fieldKey={fieldKey}
            testPrefix={testPrefix}
            lookupRole={lookupRole}
            onRemove={() => remove(index)}
            onAddTo={(list) => addTo(index, list)}
            onRemoveFrom={(list, position) => removeFrom(index, list, position)}
          />
        ))
      )}
    </SubSection>
  );
}

function PersonRow({
  person,
  index,
  fieldKey,
  testPrefix,
  lookupRole,
  onRemove,
  onAddTo,
  onRemoveFrom,
}: {
  person: Person;
  index: number;
  fieldKey: FieldKey;
  testPrefix: string;
  lookupRole?: 'author' | 'translator';
  onRemove: () => void;
  onAddTo: (list: 'homePages' | 'emails') => void;
  onRemoveFrom: (list: 'homePages' | 'emails', position: number) => void;
}) {
  const { t } = useTranslation();
  const { controller, issues, readOnly, maximaLookup } = useDescriptionForm();
  const key = `${fieldKey}.${index}`;
  const incomplete = issues.incompletePersons.has(key);
  // A first name without a last-name element in the book is no valid FB2 (the requester, after his smoke
  // test of rc.1): Fix adds the empty last name the schema needs, as any edit of the form does.
  const noLastName = controller.lacksLastName(key);

  const rowNamesRef = useRef<HTMLDivElement | null>(null);
  const lookup = useMaximaPersonLookup({
    rowPath: key,
    role: lookupRole,
    names: {
      lastName: person.lastName ?? '',
      firstName: person.firstName ?? '',
      middleName: person.middleName ?? '',
    },
  });
  const handleFieldBlur = (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && rowNamesRef.current?.contains(nextTarget)) return;
    lookup.handleRowBlur();
  };
  const confirmedClass =
    lookup.active && lookup.confirmedLibraryId ? 'mfbe-ml-input-confirmed' : undefined;
  const lookupTestPrefix = `${testPrefix}-${index}-lookup`;

  return (
    <div
      className={`mfbe-desc-item${incomplete ? ' mfbe-desc-item-invalid' : ''}`}
      data-testid={`${testPrefix}-${index}`}
    >
      <div className="mfbe-desc-item-tools">
        <RemoveButton testId={`${testPrefix}-${index}-remove`} onClick={onRemove} />
      </div>
      <div className="mfbe-desc-item-body">
        <div className={lookup.active ? 'mfbe-ml-anchor' : undefined} ref={rowNamesRef}>
          <Row>
            <TextField
              fieldKey={`${key}.firstName`}
              testId={`${testPrefix}-${index}-first`}
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
              testId={`${testPrefix}-${index}-middle`}
              label={t('descriptionForm.person.middle')}
              className={confirmedClass}
              autoComplete={lookup.active ? 'off' : undefined}
              onValueChange={
                lookup.active ? (val) => lookup.handleNameChange('middleName', val) : undefined
              }
              onBlur={lookup.active ? handleFieldBlur : undefined}
            />
            <TextField
              fieldKey={`${key}.lastName`}
              testId={`${testPrefix}-${index}-last`}
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
          onAdd={() => onAddTo('homePages')}
          onRemove={(position) => onRemoveFrom('homePages', position)}
        />
        <StringList
          fieldKey={`${key}.emails`}
          values={person.emails}
          label={t('descriptionForm.person.email')}
          testPrefix={`${testPrefix}-${index}-email`}
          onAdd={() => onAddTo('emails')}
          onRemove={(position) => onRemoveFrom('emails', position)}
        />
        {noLastName ? (
          <div className="mfbe-desc-warning" data-testid={`${testPrefix}-${index}-nolast`}>
            {t('descriptionForm.person.noLastName')}{' '}
            <SmallButton
              testId={`${testPrefix}-${index}-fix`}
              onClick={() => controller.setValue(`${key}.lastName`, '')}
              disabled={readOnly}
              title={t('descriptionForm.person.fixTitle')}
            >
              {t('descriptionForm.person.fix')}
            </SmallButton>
          </div>
        ) : incomplete ? (
          <div className="mfbe-desc-warning" data-testid={`${testPrefix}-${index}-incomplete`}>
            {t('descriptionForm.person.incomplete')}
          </div>
        ) : null}
      </div>
    </div>
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
