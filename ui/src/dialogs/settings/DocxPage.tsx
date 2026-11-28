/**
 * Feature 023 (T035; contracts/settings.md §2): Settings > Exports > DOCX — defaults for DOCX
 * export (9 portrait page sizes, margins + custom mm, curated/custom font family, text size,
 * TOC placement, footnotes/endnotes, and ZIP archive packaging). Supports `hideZip` so Batch
 * Converter reuses this component verbatim. Static: never imports `docx/export/`, `docx/import/`,
 * or `docx/shared/`.
 */
import { useTranslation } from 'react-i18next';

import { tip } from '@/app/tooltips';
import {
  DOCX_DEFAULTS,
  DOCX_FONT_FAMILIES,
  DOCX_TEXT_SIZES_PT,
  resolveDocxSettings,
  type DocxSettings,
} from '@/features/docx/docxSettingsSchema';
import { PDF_PAGE_SIZE_GROUPS } from '@/features/pdf/pageSizes';
import type {
  DocxFontFamilyPreset,
  DocxNotesPlacement,
  DocxTocPlacement,
  PdfPageSizeId,
  Settings,
} from '@/rpc/types';

import { FieldRow, GroupBox } from './controls';

type DocxMarginPreset = DocxSettings['margins'];
const MARGIN_PRESETS: readonly DocxMarginPreset[] = ['narrow', 'standard', 'wide', 'custom'];
const TOC_OPTIONS: readonly DocxTocPlacement[] = ['afterTitle', 'end', 'none'];
const NOTES_OPTIONS: readonly DocxNotesPlacement[] = ['footnotes', 'endnotes'];

export interface DocxPageProps {
  draft: Settings;
  onChange: (patch: Partial<DocxSettings>) => void;
  hideZip?: boolean;
}

export function DocxPage({ draft, onChange, hideZip = false }: DocxPageProps) {
  const { t } = useTranslation();
  const values = resolveDocxSettings(draft.docx);

  const defaultNote = (shown: string) => (
    <span className="mfbe-settings-default">
      {t('docx.settings.defaultHint', { value: shown })}
    </span>
  );

  const resetButton = (disabled: boolean, onClick: () => void, id: string) => (
    <button
      type="button"
      className="mfbe-button"
      data-testid={`settings-docx-reset-${id}`}
      disabled={disabled}
      onClick={onClick}
      {...tip(t('tip.settings.docx.reset'))}
    >
      {t('docx.settings.reset')}
    </button>
  );

  const boolLabel = (v: boolean) => t(v ? 'mobi.settings.on' : 'mobi.settings.off');

  const sameAsDefaults =
    values.defaultPageSize === DOCX_DEFAULTS.defaultPageSize &&
    values.margins === DOCX_DEFAULTS.margins &&
    values.customMargin === DOCX_DEFAULTS.customMargin &&
    values.fontFamily === DOCX_DEFAULTS.fontFamily &&
    values.customFontFamily === DOCX_DEFAULTS.customFontFamily &&
    values.textSizePt === DOCX_DEFAULTS.textSizePt &&
    values.tocPlacement === DOCX_DEFAULTS.tocPlacement &&
    values.notesPlacement === DOCX_DEFAULTS.notesPlacement &&
    (hideZip || values.zip === DOCX_DEFAULTS.zip);

  return (
    <div className="mfbe-settings-page" data-testid="settings-page-docx">
      <GroupBox title={t('exports.settings.formats.docx')}>
        <FieldRow
          label={t('docx.settings.pageSize')}
          htmlFor="settings-docx-page-size"
          tooltip={t('tip.settings.docx.pageSize')}
        >
          <select
            id="settings-docx-page-size"
            data-testid="settings-docx-page-size"
            value={values.defaultPageSize}
            onChange={(event) => onChange({ defaultPageSize: event.target.value as PdfPageSizeId })}
            {...tip(t('tip.settings.docx.pageSize'))}
          >
            {PDF_PAGE_SIZE_GROUPS.map((group) => (
              <optgroup key={group.key} label={t(`pdf.sizeGroups.${group.key}`)}>
                {group.ids.map((id) => (
                  <option key={id} value={id}>
                    {t(`pdf.sizes.${id}`)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {defaultNote(t(`pdf.sizes.${DOCX_DEFAULTS.defaultPageSize}`))}
          {resetButton(
            values.defaultPageSize === DOCX_DEFAULTS.defaultPageSize,
            () => onChange({ defaultPageSize: DOCX_DEFAULTS.defaultPageSize }),
            'page-size',
          )}
        </FieldRow>

        <FieldRow
          label={t('docx.settings.margins')}
          htmlFor="settings-docx-margins"
          tooltip={t('tip.settings.docx.margins')}
        >
          <select
            id="settings-docx-margins"
            data-testid="settings-docx-margins"
            value={values.margins}
            onChange={(event) => onChange({ margins: event.target.value as DocxMarginPreset })}
            {...tip(t('tip.settings.docx.margins'))}
          >
            {MARGIN_PRESETS.map((preset) => (
              <option key={preset} value={preset}>
                {t(`docx.settings.marginPresets.${preset}`)}
              </option>
            ))}
          </select>
          {defaultNote(t(`docx.settings.marginPresets.${DOCX_DEFAULTS.margins}`))}
          {resetButton(
            values.margins === DOCX_DEFAULTS.margins,
            () => onChange({ margins: DOCX_DEFAULTS.margins }),
            'margins',
          )}
        </FieldRow>

        {values.margins === 'custom' ? (
          <FieldRow
            label={t('docx.settings.customMargin')}
            htmlFor="settings-docx-custom-margin"
            tooltip={t('tip.settings.docx.customMargin')}
          >
            <input
              id="settings-docx-custom-margin"
              data-testid="settings-docx-custom-margin"
              type="number"
              min={5}
              max={50}
              step={1}
              value={Number.isFinite(values.customMargin) ? values.customMargin : ''}
              onChange={(event) => {
                const n = Number.parseInt(event.target.value, 10);
                onChange({ customMargin: Number.isNaN(n) ? Number.NaN : n });
              }}
              {...tip(t('tip.settings.docx.customMargin'))}
            />
            {defaultNote(`${DOCX_DEFAULTS.customMargin} mm`)}
            {resetButton(
              values.customMargin === DOCX_DEFAULTS.customMargin,
              () => onChange({ customMargin: DOCX_DEFAULTS.customMargin }),
              'custom-margin',
            )}
          </FieldRow>
        ) : null}

        <FieldRow
          label={t('docx.settings.fontFamily')}
          htmlFor="settings-docx-font-family"
          tooltip={t('tip.settings.docx.fontFamily')}
        >
          <select
            id="settings-docx-font-family"
            data-testid="settings-docx-font-family"
            value={values.fontFamily}
            onChange={(event) =>
              onChange({ fontFamily: event.target.value as DocxFontFamilyPreset })
            }
            {...tip(t('tip.settings.docx.fontFamily'))}
          >
            {DOCX_FONT_FAMILIES.map((fam) => (
              <option key={fam} value={fam}>
                {fam}
              </option>
            ))}
            <option value="custom">{t('docx.settings.fontCustomOption')}</option>
          </select>
          {defaultNote(DOCX_DEFAULTS.fontFamily)}
          {resetButton(
            values.fontFamily === DOCX_DEFAULTS.fontFamily,
            () => onChange({ fontFamily: DOCX_DEFAULTS.fontFamily }),
            'font-family',
          )}
        </FieldRow>

        {values.fontFamily === 'custom' ? (
          <FieldRow
            label={t('docx.settings.customFontFamily')}
            htmlFor="settings-docx-custom-font-family"
            tooltip={t('tip.settings.docx.customFontFamily')}
          >
            <input
              id="settings-docx-custom-font-family"
              data-testid="settings-docx-custom-font-family"
              type="text"
              maxLength={80}
              placeholder={t('docx.settings.customFontPlaceholder')}
              value={values.customFontFamily}
              onChange={(event) => onChange({ customFontFamily: event.target.value })}
              {...tip(t('tip.settings.docx.customFontFamily'))}
            />
            {defaultNote(DOCX_DEFAULTS.fontFamily)}
            {resetButton(
              values.customFontFamily === DOCX_DEFAULTS.customFontFamily,
              () => onChange({ customFontFamily: DOCX_DEFAULTS.customFontFamily }),
              'custom-font-family',
            )}
          </FieldRow>
        ) : null}

        <FieldRow
          label={t('docx.settings.textSizePt')}
          htmlFor="settings-docx-text-size"
          tooltip={t('tip.settings.docx.textSizePt')}
        >
          <select
            id="settings-docx-text-size"
            data-testid="settings-docx-text-size"
            value={values.textSizePt}
            onChange={(event) => onChange({ textSizePt: Number.parseInt(event.target.value, 10) })}
            {...tip(t('tip.settings.docx.textSizePt'))}
          >
            {DOCX_TEXT_SIZES_PT.map((pt) => (
              <option key={pt} value={pt}>
                {t('docx.settings.textSizeValue', { pt })}
              </option>
            ))}
          </select>
          {defaultNote(t('docx.settings.textSizeValue', { pt: DOCX_DEFAULTS.textSizePt }))}
          {resetButton(
            values.textSizePt === DOCX_DEFAULTS.textSizePt,
            () => onChange({ textSizePt: DOCX_DEFAULTS.textSizePt }),
            'text-size',
          )}
        </FieldRow>

        <FieldRow
          label={t('docx.settings.tocPlacement')}
          htmlFor="settings-docx-toc"
          tooltip={t('tip.settings.docx.tocPlacement')}
        >
          <select
            id="settings-docx-toc"
            data-testid="settings-docx-toc"
            value={values.tocPlacement}
            onChange={(event) => onChange({ tocPlacement: event.target.value as DocxTocPlacement })}
            {...tip(t('tip.settings.docx.tocPlacement'))}
          >
            {TOC_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {t(`docx.settings.tocPlacements.${opt}`)}
              </option>
            ))}
          </select>
          {defaultNote(t(`docx.settings.tocPlacements.${DOCX_DEFAULTS.tocPlacement}`))}
          {resetButton(
            values.tocPlacement === DOCX_DEFAULTS.tocPlacement,
            () => onChange({ tocPlacement: DOCX_DEFAULTS.tocPlacement }),
            'toc',
          )}
        </FieldRow>

        <FieldRow
          label={t('docx.settings.notesPlacement')}
          htmlFor="settings-docx-notes"
          tooltip={t('tip.settings.docx.notesPlacement')}
        >
          <select
            id="settings-docx-notes"
            data-testid="settings-docx-notes"
            value={values.notesPlacement}
            onChange={(event) =>
              onChange({ notesPlacement: event.target.value as DocxNotesPlacement })
            }
            {...tip(t('tip.settings.docx.notesPlacement'))}
          >
            {NOTES_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {t(`docx.settings.notesPlacements.${opt}`)}
              </option>
            ))}
          </select>
          {defaultNote(t(`docx.settings.notesPlacements.${DOCX_DEFAULTS.notesPlacement}`))}
          {resetButton(
            values.notesPlacement === DOCX_DEFAULTS.notesPlacement,
            () => onChange({ notesPlacement: DOCX_DEFAULTS.notesPlacement }),
            'notes',
          )}
        </FieldRow>

        {!hideZip ? (
          <FieldRow label={t('docx.settings.zip')} tooltip={t('tip.settings.docx.zip')}>
            <input
              type="checkbox"
              data-testid="settings-docx-zip"
              checked={values.zip}
              onChange={(event) => onChange({ zip: event.target.checked })}
              {...tip(t('tip.settings.docx.zip'))}
            />
            {defaultNote(boolLabel(DOCX_DEFAULTS.zip))}
            {resetButton(
              values.zip === DOCX_DEFAULTS.zip,
              () => onChange({ zip: DOCX_DEFAULTS.zip }),
              'zip',
            )}
          </FieldRow>
        ) : null}

        <div className="mfbe-settings-row mfbe-settings-buttons">
          <button
            type="button"
            className="mfbe-button"
            data-testid="settings-docx-reset-all"
            disabled={sameAsDefaults}
            onClick={() =>
              onChange(
                hideZip
                  ? {
                      defaultPageSize: DOCX_DEFAULTS.defaultPageSize,
                      margins: DOCX_DEFAULTS.margins,
                      customMargin: DOCX_DEFAULTS.customMargin,
                      fontFamily: DOCX_DEFAULTS.fontFamily,
                      customFontFamily: DOCX_DEFAULTS.customFontFamily,
                      textSizePt: DOCX_DEFAULTS.textSizePt,
                      tocPlacement: DOCX_DEFAULTS.tocPlacement,
                      notesPlacement: DOCX_DEFAULTS.notesPlacement,
                    }
                  : { ...DOCX_DEFAULTS },
              )
            }
            {...tip(t('tip.settings.docx.resetAll'))}
          >
            {t('docx.settings.resetAll')}
          </button>
        </div>
      </GroupBox>
    </div>
  );
}
