/**
 * Sequences with nesting (T075): name + number per row, "Add", "Add nested" and "Remove", the
 * `seq` template of the original `fb2.xsl` (nested rows indented). Nested rows are saved as
 * nested `<sequence>` elements (spec US3 scenario 4).
 */

import { useTranslation } from 'react-i18next';

import type { Sequence } from '@/model/document';

import { AddButton, EmptyHint, RemoveButton, SmallButton, SubSection, TextField } from './fields';
import { useDescriptionForm } from './formContext';
import { emptySequence, getAtPath, setAtPath, type FieldKey } from './model';

export interface SequenceListProps {
  /** Form path of the list, e.g. `titleInfo.sequences`. */
  fieldKey: FieldKey;
  /** Test id prefix, e.g. `description-sequence` -> `description-sequence-0-name`. */
  testPrefix: string;
  title: string;
}

export function SequenceList({ fieldKey, testPrefix, title }: SequenceListProps) {
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
        <SequenceRows fieldKey={fieldKey} testPrefix={testPrefix} sequences={sequences} depth={0} />
      )}
    </SubSection>
  );
}

function SequenceRows({
  fieldKey,
  testPrefix,
  sequences,
  depth,
}: {
  fieldKey: FieldKey;
  testPrefix: string;
  sequences: Sequence[];
  depth: number;
}) {
  const { t } = useTranslation();
  const { controller, issues } = useDescriptionForm();
  const listOf = (current: unknown) =>
    (getAtPath(current, fieldKey) as Sequence[] | undefined) ?? [];
  const remove = (index: number) =>
    controller.update((current) =>
      setAtPath(
        current,
        fieldKey,
        listOf(current).filter((_, i) => i !== index),
      ),
    );
  const addChild = (index: number) =>
    controller.update((current) => {
      const key = `${fieldKey}.${index}.children`;
      const children = (getAtPath(current, key) as Sequence[] | undefined) ?? [];
      return setAtPath(current, key, [...children, emptySequence()]);
    });

  return (
    <>
      {sequences.map((sequence, index) => {
        const key = `${fieldKey}.${index}`;
        const unnamed = issues.unnamedSequences.has(key);
        return (
          <div
            className="mfbe-desc-sequence"
            key={index}
            style={{ marginLeft: `${depth * 1.5}em` }}
            data-testid={`${testPrefix}-${index}`}
            data-depth={depth}
          >
            <div className="mfbe-desc-row">
              <RemoveButton
                testId={`${testPrefix}-${index}-remove`}
                onClick={() => remove(index)}
              />
              <TextField
                fieldKey={`${key}.name`}
                testId={`${testPrefix}-${index}-name`}
                label={t('descriptionForm.sequence.name')}
                size="wide"
                invalid={unnamed ? t('descriptionForm.sequence.unnamed') : null}
              />
              <NumberField fieldKey={`${key}.number`} testId={`${testPrefix}-${index}-number`} />
              <SmallButton
                testId={`${testPrefix}-${index}-add-nested`}
                onClick={() => addChild(index)}
                title={t('descriptionForm.sequence.addNested')}
              >
                {`+ ${t('descriptionForm.sequence.nested')}`}
              </SmallButton>
            </div>
            {sequence.children.length > 0 ? (
              <SequenceRows
                fieldKey={`${key}.children`}
                testPrefix={`${testPrefix}-${index}`}
                sequences={sequence.children}
                depth={depth + 1}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

/** Sequence number: digits only; stored as a number (undefined when empty). */
function NumberField({ fieldKey, testId }: { fieldKey: FieldKey; testId: string }) {
  const { t } = useTranslation();
  const { controller, form } = useDescriptionForm();
  const value = getAtPath(form, fieldKey);
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
  return (
    <label className="mfbe-desc-field">
      <span className="mfbe-desc-label">{t('descriptionForm.sequence.number')}</span>
      <input
        type="text"
        inputMode="numeric"
        className="mfbe-desc-input mfbe-desc-input-short"
        value={text}
        data-testid={testId}
        onChange={(event) => {
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
