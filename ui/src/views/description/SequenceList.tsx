/**
 * Sequences with nesting (T075): name + number per row, "Add", "Add nested" and "Remove", the
 * `seq` template of the original `fb2.xsl` (nested rows indented). Nested rows are saved as
 * nested `<sequence>` elements (spec US3 scenario 4).
 */

import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { tip } from '@/app/tooltips';
import {
  collectSubtreeRowPaths,
  deriveMaximaBindings,
  unbindRowIdentities,
} from '@/features/description/maximaIdentities';
import type { Sequence } from '@/model/document';

import { AddButton, EmptyHint, RemoveButton, SmallButton, SubSection, TextField } from './fields';
import { descriptionFieldTip } from './fieldTips';
import { useDescriptionForm } from './formContext';
import { MaximaLookupDropdown } from './MaximaLookupDropdown';
import { MaximaRowStatusBadge } from './maximaLookupStatus';
import { emptySequence, getAtPath, setAtPath, type FieldKey } from './model';
import { useMaximaSequenceLookup, type SequenceLookupMode } from './useMaximaSequenceLookup';

export interface SequenceListProps {
  /** Form path of the list, e.g. `titleInfo.sequences`. */
  fieldKey: FieldKey;
  /** Test id prefix, e.g. `description-sequence` -> `description-sequence-0-name`. */
  testPrefix: string;
  title: string;
  /** Maxima Library lookup mode; omit for `srcTitleInfo` so it stays offline-only. */
  lookupMode?: SequenceLookupMode;
}

export function SequenceList({ fieldKey, testPrefix, title, lookupMode }: SequenceListProps) {
  const { t } = useTranslation();
  const { controller, form } = useDescriptionForm();
  const sequences = (getAtPath(form, fieldKey) as Sequence[] | undefined) ?? [];
  const add = () =>
    controller.update((current) =>
      setAtPath(current, fieldKey, [
        ...((getAtPath(current, fieldKey) as Sequence[] | undefined) ?? []),
        emptySequence(),
      ]),
    );
  return (
    <SubSection
      id={`${testPrefix}-list`}
      title={title}
      actions={<AddButton testId={`${testPrefix}-add`} onClick={add} />}
    >
      {sequences.length === 0 ? (
        <EmptyHint>{t('descriptionForm.noSequences')}</EmptyHint>
      ) : (
        <SequenceRows
          fieldKey={fieldKey}
          testPrefix={testPrefix}
          sequences={sequences}
          depth={0}
          lookupMode={lookupMode}
        />
      )}
    </SubSection>
  );
}

function SequenceRows({
  fieldKey,
  testPrefix,
  sequences,
  depth,
  lookupMode,
  parentRowPath,
}: {
  fieldKey: FieldKey;
  testPrefix: string;
  sequences: Sequence[];
  depth: number;
  lookupMode?: SequenceLookupMode;
  parentRowPath?: string;
}) {
  const { controller, maximaLookup } = useDescriptionForm();
  const listOf = (current: unknown) =>
    (getAtPath(current, fieldKey) as Sequence[] | undefined) ?? [];
  const remove = (index: number) => {
    const rowPath = `${fieldKey}.${index}`;
    if (lookupMode === 'publisherSeries') {
      maximaLookup?.session.setPublisherSeriesState(rowPath, null);
    }
    controller.update((current) => {
      const prevBindings =
        lookupMode === 'authorSeries' && maximaLookup?.enabled
          ? deriveMaximaBindings(current)
          : null;
      const next = setAtPath(
        current,
        fieldKey,
        listOf(current).filter((_, i) => i !== index),
      );
      if (!prevBindings) return next;
      const paths = collectSubtreeRowPaths(rowPath, prevBindings);
      return unbindRowIdentities(next, paths, prevBindings);
    });
  };
  const addChild = (index: number) =>
    controller.update((current) => {
      const key = `${fieldKey}.${index}.children`;
      const children = (getAtPath(current, key) as Sequence[] | undefined) ?? [];
      return setAtPath(current, key, [...children, emptySequence()]);
    });

  return (
    <>
      {sequences.map((sequence, index) => (
        <SequenceRow
          key={index}
          sequence={sequence}
          index={index}
          fieldKey={fieldKey}
          testPrefix={testPrefix}
          depth={depth}
          lookupMode={lookupMode}
          parentRowPath={parentRowPath}
          onRemove={() => remove(index)}
          onAddChild={() => addChild(index)}
        />
      ))}
    </>
  );
}

function SequenceRow({
  sequence,
  index,
  fieldKey,
  testPrefix,
  depth,
  lookupMode,
  parentRowPath,
  onRemove,
  onAddChild,
}: {
  sequence: Sequence;
  index: number;
  fieldKey: FieldKey;
  testPrefix: string;
  depth: number;
  lookupMode?: SequenceLookupMode;
  parentRowPath?: string;
  onRemove: () => void;
  onAddChild: () => void;
}) {
  const { t } = useTranslation();
  const { issues, maximaLookup } = useDescriptionForm();
  const key = `${fieldKey}.${index}`;
  const unnamed = issues.unnamedSequences.has(key);
  const numberInputRef = useRef<HTMLInputElement | null>(null);

  const lookup = useMaximaSequenceLookup({
    rowPath: key,
    mode: lookupMode,
    seriesName: sequence.name ?? '',
    parentRowPath,
    onAfterPick: () => numberInputRef.current?.focus(),
  });

  const inputStatusClass =
    lookup.active && lookup.status === 'confirmed'
      ? 'mfbe-ml-input-confirmed'
      : lookup.active && lookup.status === 'unresolved'
        ? 'mfbe-ml-input-unresolved'
        : undefined;
  const lookupTestPrefix = `${testPrefix}-${index}-lookup`;

  return (
    <div
      className="mfbe-desc-sequence"
      style={{ marginLeft: `${depth * 1.5}em` }}
      data-testid={`${testPrefix}-${index}`}
      data-depth={depth}
    >
      <div className={lookup.active ? 'mfbe-ml-anchor' : undefined}>
        <div className="mfbe-desc-row">
          <RemoveButton testId={`${testPrefix}-${index}-remove`} onClick={onRemove} />
          <TextField
            fieldKey={`${key}.name`}
            testId={`${testPrefix}-${index}-name`}
            label={t('descriptionForm.sequence.name')}
            size="wide"
            invalid={unnamed ? t('descriptionForm.sequence.unnamed') : null}
            className={inputStatusClass}
            autoComplete={lookup.active ? 'off' : undefined}
            onValueChange={lookup.active ? lookup.handleNameChange : undefined}
            onFocus={lookup.active ? lookup.handleFocus : undefined}
            onClick={lookup.active ? lookup.handleClick : undefined}
            onBlur={lookup.active ? lookup.handleBlur : undefined}
            onKeyDown={lookup.active ? lookup.handleKeyDown : undefined}
          />
          <NumberField
            fieldKey={`${key}.number`}
            testId={`${testPrefix}-${index}-number`}
            inputRef={numberInputRef}
          />
          <SmallButton
            testId={`${testPrefix}-${index}-add-nested`}
            onClick={onAddChild}
            title={t('descriptionForm.sequence.addNested')}
          >
            {`+ ${t('descriptionForm.sequence.nested')}`}
          </SmallButton>
          {lookup.active ? (
            <MaximaRowStatusBadge
              status={lookup.status}
              libraryId={lookup.confirmedLibraryId}
              url={lookup.confirmedUrl}
              testIdPrefix={lookupTestPrefix}
              rpc={maximaLookup?.rpc ?? null}
            />
          ) : null}
        </div>
        {lookup.active ? (
          <MaximaLookupDropdown
            testIdPrefix={lookupTestPrefix}
            open={lookup.dropdownOpen}
            loading={lookup.loading}
            typeToSearchPrompt={lookup.typeToSearchPrompt}
            disambiguationPrompt={lookup.disambiguationPrompt}
            errorMessage={lookup.errorMessage}
            items={lookup.items}
            activeIndex={lookup.activeIndex}
            page={lookup.page}
            hasMore={lookup.hasMore}
            tabs={lookup.tabs}
            activeTabId={lookup.activeTabId}
            rpc={maximaLookup?.rpc ?? null}
            onSelectTab={lookup.handleSelectTab}
            onHighlightIndex={lookup.setActiveIndex}
            onPick={lookup.handlePick}
            onPrevPage={lookup.handlePrevPage}
            onNextPage={lookup.handleNextPage}
            onClose={lookup.closeDropdown}
          />
        ) : null}
      </div>
      {sequence.children.length > 0 ? (
        <SequenceRows
          fieldKey={`${key}.children`}
          testPrefix={`${testPrefix}-${index}`}
          sequences={sequence.children}
          depth={depth + 1}
          lookupMode={lookupMode}
          parentRowPath={key}
        />
      ) : null}
    </div>
  );
}

/** Sequence number: digits only; stored as a number (undefined when empty). */
function NumberField({
  fieldKey,
  testId,
  inputRef,
}: {
  fieldKey: FieldKey;
  testId: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const { t } = useTranslation();
  const { controller, form, readOnly } = useDescriptionForm();
  const value = getAtPath(form, fieldKey);
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
  return (
    <label className="mfbe-desc-field">
      <span className="mfbe-desc-label">{t('descriptionForm.sequence.number')}</span>
      <input
        ref={inputRef}
        {...tip(descriptionFieldTip(t, fieldKey))}
        type="text"
        inputMode="numeric"
        className="mfbe-desc-input mfbe-desc-input-short"
        value={text}
        data-testid={testId}
        readOnly={readOnly}
        onChange={(event) => {
          if (readOnly) return; // the quiet lock of a script run
          const digits = event.target.value.replace(/\D/g, '');
          controller.setValue(fieldKey, digits === '' ? undefined : Number(digits), {
            coalesce: true,
          });
        }}
        onBlur={() => controller.closeEntry()}
      />
    </label>
  );
}
