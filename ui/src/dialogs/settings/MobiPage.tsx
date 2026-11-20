/**
 * Feature 018 (T038, contracts/settings.md): Settings > Exports > MOBI — the defaults of the
 * MOBI export: format, inline table of contents placement, series prefix in the reader shelf
 * title, open-at position, KF8 pop-up footnotes, and ZIP archive packaging. Each value shows its
 * out-of-the-box value with individual Reset; Reset all puts the page back. Static: never imports
 * `features/mobi/export/`, `features/mobi/import/`, `features/mobi/shared/`, or `ebookShared/`.
 */
import { useTranslation } from 'react-i18next';

import { tip } from '@/app/tooltips';
import type {
  MobiFormat,
  MobiOpenAt,
  MobiSeriesInTitle,
  MobiTocPlacement,
  Settings,
} from '@/rpc/types';

import { FieldRow, GroupBox } from './controls';

type MobiSettings = NonNullable<Settings['mobi']>;

/** Out-of-the-box defaults of contracts/settings.md (core/src/settings/settings.cpp). */
const MOBI_DEFAULTS: MobiSettings = {
  format: 'mobi7',
  tocPlacement: 'afterTitle',
  seriesInTitle: 'off',
  openAt: 'titlePage',
  kf8PopupFootnotes: true,
  zip: false,
};

const FORMAT_OPTIONS: readonly MobiFormat[] = ['mobi7', 'joint', 'kf8'];
const TOC_OPTIONS: readonly MobiTocPlacement[] = ['afterTitle', 'end', 'none'];
const SERIES_OPTIONS: readonly MobiSeriesInTitle[] = ['off', 'numberBefore', 'seriesAndNumber'];
const OPEN_AT_OPTIONS: readonly MobiOpenAt[] = ['titlePage', 'mainText'];

export interface MobiPageProps {
  draft: Settings;
  onChange: (patch: Partial<MobiSettings>) => void;
}

export function MobiPage({ draft, onChange }: MobiPageProps) {
  const { t } = useTranslation();
  const values: MobiSettings = {
    ...MOBI_DEFAULTS,
    ...draft.mobi,
  };

  const resetButton = (disabled: boolean, onClick: () => void, shown: string, id: string) => (
    <button
      type="button"
      className="mfbe-button"
      data-testid={`settings-mobi-reset-${id}`}
      disabled={disabled}
      onClick={onClick}
      {...tip(t('tip.settings.pdf.reset', { value: shown }))}
    >
      {t('pdf.settings.reset')}
    </button>
  );

  const defaultNote = (shown: string) => (
    <span className="mfbe-settings-default">{t('pdf.settings.default', { value: shown })}</span>
  );

  const boolLabel = (v: boolean) => t(v ? 'mobi.settings.on' : 'mobi.settings.off');
  const same =
    values.format === MOBI_DEFAULTS.format &&
    values.tocPlacement === MOBI_DEFAULTS.tocPlacement &&
    values.seriesInTitle === MOBI_DEFAULTS.seriesInTitle &&
    values.openAt === MOBI_DEFAULTS.openAt &&
    values.kf8PopupFootnotes === MOBI_DEFAULTS.kf8PopupFootnotes &&
    values.zip === MOBI_DEFAULTS.zip;

  return (
    <div className="mfbe-settings-page" data-testid="settings-page-mobi">
      <GroupBox title={t('mobi.settings.group')}>
        <FieldRow
          label={t('mobi.settings.format')}
          htmlFor="settings-mobi-format"
          tooltip={t('tip.settings.mobi.format')}
        >
          <select
            id="settings-mobi-format"
            data-testid="settings-mobi-format"
            value={values.format}
            onChange={(event) => onChange({ format: event.target.value as MobiFormat })}
            {...tip(t('tip.settings.mobi.format'))}
          >
            {FORMAT_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {t(`mobi.formats.${opt}`)}
              </option>
            ))}
          </select>
          {defaultNote(t(`mobi.formats.${MOBI_DEFAULTS.format}`))}
          {resetButton(
            values.format === MOBI_DEFAULTS.format,
            () => onChange({ format: MOBI_DEFAULTS.format }),
            t(`mobi.formats.${MOBI_DEFAULTS.format}`),
            'format',
          )}
        </FieldRow>

        <FieldRow
          label={t('mobi.settings.tocPlacement')}
          htmlFor="settings-mobi-tocPlacement"
          tooltip={t('tip.settings.mobi.tocPlacement')}
        >
          <select
            id="settings-mobi-tocPlacement"
            data-testid="settings-mobi-tocPlacement"
            value={values.tocPlacement}
            onChange={(event) => onChange({ tocPlacement: event.target.value as MobiTocPlacement })}
            {...tip(t('tip.settings.mobi.tocPlacement'))}
          >
            {TOC_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {t(`mobi.tocPlacements.${opt}`)}
              </option>
            ))}
          </select>
          {defaultNote(t(`mobi.tocPlacements.${MOBI_DEFAULTS.tocPlacement}`))}
          {resetButton(
            values.tocPlacement === MOBI_DEFAULTS.tocPlacement,
            () => onChange({ tocPlacement: MOBI_DEFAULTS.tocPlacement }),
            t(`mobi.tocPlacements.${MOBI_DEFAULTS.tocPlacement}`),
            'tocPlacement',
          )}
        </FieldRow>

        <FieldRow
          label={t('mobi.settings.seriesInTitle')}
          htmlFor="settings-mobi-seriesInTitle"
          tooltip={t('tip.settings.mobi.seriesInTitle')}
        >
          <select
            id="settings-mobi-seriesInTitle"
            data-testid="settings-mobi-seriesInTitle"
            value={values.seriesInTitle}
            onChange={(event) =>
              onChange({ seriesInTitle: event.target.value as MobiSeriesInTitle })
            }
            {...tip(t('tip.settings.mobi.seriesInTitle'))}
          >
            {SERIES_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {t(`mobi.seriesModes.${opt}`)}
              </option>
            ))}
          </select>
          {defaultNote(t(`mobi.seriesModes.${MOBI_DEFAULTS.seriesInTitle}`))}
          {resetButton(
            values.seriesInTitle === MOBI_DEFAULTS.seriesInTitle,
            () => onChange({ seriesInTitle: MOBI_DEFAULTS.seriesInTitle }),
            t(`mobi.seriesModes.${MOBI_DEFAULTS.seriesInTitle}`),
            'seriesInTitle',
          )}
        </FieldRow>

        <FieldRow
          label={t('mobi.settings.openAt')}
          htmlFor="settings-mobi-openAt"
          tooltip={t('tip.settings.mobi.openAt')}
        >
          <select
            id="settings-mobi-openAt"
            data-testid="settings-mobi-openAt"
            value={values.openAt}
            onChange={(event) => onChange({ openAt: event.target.value as MobiOpenAt })}
            {...tip(t('tip.settings.mobi.openAt'))}
          >
            {OPEN_AT_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {t(`mobi.openAtModes.${opt}`)}
              </option>
            ))}
          </select>
          {defaultNote(t(`mobi.openAtModes.${MOBI_DEFAULTS.openAt}`))}
          {resetButton(
            values.openAt === MOBI_DEFAULTS.openAt,
            () => onChange({ openAt: MOBI_DEFAULTS.openAt }),
            t(`mobi.openAtModes.${MOBI_DEFAULTS.openAt}`),
            'openAt',
          )}
        </FieldRow>

        <FieldRow
          label={t('mobi.settings.kf8PopupFootnotes')}
          tooltip={t('tip.settings.mobi.kf8PopupFootnotes')}
        >
          <input
            type="checkbox"
            data-testid="settings-mobi-kf8PopupFootnotes"
            {...tip(t('tip.settings.mobi.kf8PopupFootnotes'))}
            checked={values.kf8PopupFootnotes}
            onChange={(event) => onChange({ kf8PopupFootnotes: event.target.checked })}
          />
          {defaultNote(boolLabel(MOBI_DEFAULTS.kf8PopupFootnotes))}
          {resetButton(
            values.kf8PopupFootnotes === MOBI_DEFAULTS.kf8PopupFootnotes,
            () => onChange({ kf8PopupFootnotes: MOBI_DEFAULTS.kf8PopupFootnotes }),
            boolLabel(MOBI_DEFAULTS.kf8PopupFootnotes),
            'kf8PopupFootnotes',
          )}
        </FieldRow>
        <p className="mfbe-settings-note" data-testid="settings-mobi-kf8PopupFootnotes-hint">
          {t('mobi.settings.kf8PopupFootnotesHint')}
        </p>

        <FieldRow label={t('mobi.settings.zip')} tooltip={t('tip.settings.mobi.zip')}>
          <input
            type="checkbox"
            data-testid="settings-mobi-zip"
            {...tip(t('tip.settings.mobi.zip'))}
            checked={values.zip}
            onChange={(event) => onChange({ zip: event.target.checked })}
          />
          {defaultNote(boolLabel(MOBI_DEFAULTS.zip))}
          {resetButton(
            values.zip === MOBI_DEFAULTS.zip,
            () => onChange({ zip: MOBI_DEFAULTS.zip }),
            boolLabel(MOBI_DEFAULTS.zip),
            'zip',
          )}
        </FieldRow>

        <div className="mfbe-settings-row mfbe-settings-buttons">
          <button
            type="button"
            className="mfbe-button"
            data-testid="settings-mobi-reset-all"
            disabled={same}
            onClick={() => onChange({ ...MOBI_DEFAULTS })}
            {...tip(t('tip.settings.pdf.resetAll'))}
          >
            {t('pdf.settings.resetAll')}
          </button>
        </div>
      </GroupBox>
    </div>
  );
}
