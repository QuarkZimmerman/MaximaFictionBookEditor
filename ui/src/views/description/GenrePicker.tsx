/**
 * Genres (T075, FR-051): the genre rows of a title-info block (code with its localised name,
 * optional match percentage, Remove) and the picker dialog listing the effective genre list
 * grouped by category - the standard FB2 list plus bundled / user extensions, each extension
 * marked with its source - with a filter box. Codes unknown to the list (older files) are shown
 * as they are and preserved. The picker refreshes the list on every opening so a genre file
 * dropped into the user folder shows up immediately (the core rebuilds the list per call).
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppServices } from '@/app/services';
import { Dialog, type DialogButton } from '@/dialogs/Dialog';
import type { GenreRef } from '@/model/document';
import type { UiLanguage } from '@/rpc/types';

import { AddButton, EmptyHint, RemoveButton, SmallButton, SubSection } from './fields';
import { useDescriptionForm } from './formContext';
import { cleanMatch, getAtPath, setAtPath, type FieldKey } from './model';
import {
  genreName,
  groupGenres,
  localName,
  resourceCatalogsFor,
  type GenreCatalog,
  type ResourceCatalogs,
} from './resources';

/* ------------------------------------------------------------------------ */
/* Rows                                                                     */
/* ------------------------------------------------------------------------ */

export interface GenreListProps {
  /** Form path of the list, e.g. `titleInfo.genres`. */
  fieldKey: FieldKey;
  /** Test id prefix, e.g. `description-genre` -> `description-genre-0-match`. */
  testPrefix: string;
  /** Test id of the whole block (`description-genres`). */
  testId: string;
  required?: boolean;
}

export function GenreList({ fieldKey, testPrefix, testId, required }: GenreListProps) {
  const { t } = useTranslation();
  const { dialogs, rpc } = useAppServices();
  const { controller, form, genres, language, issues, readOnly } = useDescriptionForm();
  const list = (getAtPath(form, fieldKey) as GenreRef[] | undefined) ?? [];
  const missing = required && issues.missing.has(fieldKey as never);
  const catalogs = rpc ? resourceCatalogsFor(rpc) : null;

  const pick = async (initial?: string): Promise<string | null> => {
    return dialogs.openCustom<string | null>((close) => (
      <GenrePickerDialog
        catalogs={catalogs}
        fallback={genres}
        language={language}
        initial={initial}
        onClose={close}
      />
    ));
  };
  const add = async () => {
    const code = await pick();
    if (!code) return;
    controller.update((current) =>
      setAtPath(current, fieldKey, [
        ...((getAtPath(current, fieldKey) as GenreRef[] | undefined) ?? []),
        { code },
      ]),
    );
  };
  const change = async (index: number) => {
    const code = await pick(list[index]?.code);
    if (!code) return;
    controller.update((current) => {
      const genre = (getAtPath(current, `${fieldKey}.${index}`) as GenreRef | undefined) ?? {
        code,
      };
      return setAtPath(current, `${fieldKey}.${index}`, { ...genre, code });
    });
  };
  const remove = (index: number) =>
    controller.update((current) =>
      setAtPath(
        current,
        fieldKey,
        ((getAtPath(current, fieldKey) as GenreRef[] | undefined) ?? []).filter(
          (_, i) => i !== index,
        ),
      ),
    );

  return (
    <SubSection
      id={testId}
      title={t('descriptionForm.genres.title')}
      required={required}
      missing={!!missing}
      actions={
        <AddButton
          testId={`${testPrefix}-add`}
          onClick={() => void add()}
          label={t('descriptionForm.genres.add')}
        />
      }
    >
      {list.length === 0 ? (
        <EmptyHint>{t('descriptionForm.genres.none')}</EmptyHint>
      ) : (
        list.map((genre, index) => {
          const name = genreName(genres, genre.code, language);
          return (
            <div
              className="mfbe-desc-row mfbe-desc-genre"
              key={index}
              data-testid={`${testPrefix}-${index}`}
            >
              <RemoveButton
                testId={`${testPrefix}-${index}-remove`}
                onClick={() => remove(index)}
              />
              <span className="mfbe-desc-label">{t('descriptionForm.genres.genre')}</span>
              <button
                type="button"
                className={`mfbe-desc-genre-code${name ? '' : ' mfbe-desc-genre-unknown'}`}
                data-testid={`${testPrefix}-${index}-code`}
                title={name ? genre.code : t('descriptionForm.genres.unknown')}
                aria-disabled={readOnly || undefined}
                onClick={() => {
                  if (!readOnly) void change(index); // the quiet lock: the code stays readable
                }}
              >
                <code>{genre.code}</code>
                {name ? <span className="mfbe-desc-genre-name"> {name}</span> : null}
                {!name && genres.entries.length > 0 ? (
                  <span className="mfbe-desc-genre-name mfbe-desc-muted">
                    {' '}
                    {t('descriptionForm.genres.unknown')}
                  </span>
                ) : null}
              </button>
              <SmallButton
                testId={`${testPrefix}-${index}-choose`}
                onClick={() => void change(index)}
                title={t('descriptionForm.genres.choose')}
              >
                {'\u2026'}
              </SmallButton>
              <label className="mfbe-desc-field">
                <span className="mfbe-desc-label">{t('descriptionForm.genres.match')}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  className="mfbe-desc-input mfbe-desc-input-short"
                  data-testid={`${testPrefix}-${index}-match`}
                  value={genre.match === undefined ? '' : String(genre.match)}
                  placeholder="100"
                  readOnly={readOnly}
                  onChange={(event) => {
                    if (readOnly) return;
                    const digits = event.target.value.replace(/\D/g, '').slice(0, 3);
                    controller.setValue(
                      `${fieldKey}.${index}.match`,
                      digits === '' ? undefined : Number(digits),
                      { coalesce: true },
                    );
                  }}
                  onBlur={() => {
                    // Normalise on leaving the field: 100 (the default) and garbage are omitted.
                    if (!readOnly) {
                      controller.setValue(`${fieldKey}.${index}.match`, cleanMatch(genre.match));
                    }
                    controller.closeEntry();
                  }}
                />
              </label>
            </div>
          );
        })
      )}
    </SubSection>
  );
}

/* ------------------------------------------------------------------------ */
/* Picker dialog                                                            */
/* ------------------------------------------------------------------------ */

export interface GenrePickerDialogProps {
  /** Live catalogues (refreshed on opening); null without a core. */
  catalogs: ResourceCatalogs | null;
  /** Catalogue to show until the live one arrives. */
  fallback: GenreCatalog;
  language: UiLanguage;
  initial?: string;
  onClose: (code: string | null) => void;
}

export function GenrePickerDialog({
  catalogs,
  fallback,
  language,
  initial,
  onClose,
}: GenrePickerDialogProps) {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<GenreCatalog>(catalogs?.genres ?? fallback);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string>(initial ?? '');

  useEffect(() => {
    if (!catalogs) return;
    const off = catalogs.subscribe(() => {
      if (catalogs.genres) setCatalog(catalogs.genres);
    });
    catalogs.loadGenres(true).then(setCatalog, () => undefined);
    return off;
  }, [catalogs]);

  const groups = useMemo(
    () => groupGenres(catalog, language, filter.trim()),
    [catalog, language, filter],
  );
  const valid = selected !== '' && catalog.entries.some((e) => e.code === selected);
  const extensions = catalog.effectiveSources.filter((s) => s.source !== 'standard');

  const buttons: DialogButton[] = [
    {
      id: 'ok',
      label: t('dialog.buttons.ok'),
      disabled: !valid,
      onClick: () => onClose(selected),
    },
    { id: 'cancel', label: t('dialog.buttons.cancel'), onClick: () => onClose(null) },
  ];

  return (
    <Dialog
      title={t('descriptionForm.genres.pickerCaption')}
      buttons={buttons}
      defaultButtonId="ok"
      cancelButtonId="cancel"
      initialFocus="#genre-picker-filter"
      testId="genre-picker"
      className="mfbe-genrepicker"
      closeLabel={t('dialog.buttons.close')}
    >
      <label className="mfbe-field-row" htmlFor="genre-picker-filter">
        <span>{t('descriptionForm.genres.filter')}</span>
        <input
          id="genre-picker-filter"
          className="mfbe-inputdialog-input"
          type="text"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          data-testid="genre-picker-filter"
        />
      </label>
      <select
        className="mfbe-genrepicker-list"
        size={14}
        value={selected}
        data-testid="genre-picker-list"
        onChange={(event) => setSelected(event.target.value)}
        onDoubleClick={() => {
          if (valid) onClose(selected);
        }}
      >
        {groups.map((group) => (
          <optgroup
            key={group.key}
            label={group.title}
            data-testid={`genre-picker-group-${group.key}`}
          >
            {group.entries.map((entry) => (
              <option
                key={entry.code}
                value={entry.code}
                data-testid={`genre-picker-option-${entry.code}`}
                data-source={entry.source}
              >
                {`${localName(entry.names, language, entry.code)} (${entry.code})${
                  entry.source === 'standard' ? '' : ` [${sourceLabel(entry.source, t)}]`
                }`}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <div className="mfbe-genrepicker-footer" data-testid="genre-picker-summary">
        {t('descriptionForm.genres.summary', {
          count: catalog.entries.length,
          extensions: extensions.length,
        })}
        {catalog.issues.length > 0 ? (
          <span className="mfbe-desc-warning" data-testid="genre-picker-issues">
            {' '}
            {t('descriptionForm.genres.fileIssues', { count: catalog.issues.length })}
          </span>
        ) : null}
      </div>
    </Dialog>
  );
}

function sourceLabel(source: string, t: (key: string) => string): string {
  if (source.startsWith('user')) return t('descriptionForm.genres.sourceUser');
  if (source.startsWith('bundled')) return t('descriptionForm.genres.sourceBundled');
  return source;
}
