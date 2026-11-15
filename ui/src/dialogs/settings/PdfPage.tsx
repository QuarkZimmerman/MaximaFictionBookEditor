/**
 * Settings > PDF export (feature 014, D25, DP-5, DP-7; tasks T051, T052): the default page size, the
 * text font, the text size and the margins. Beside each its default is shown, with a Reset that puts
 * that value back; Reset all puts the page back. The values are part of the settings draft (OK /
 * Apply); the fonts the user adds or removes are kept at once (pdf.fonts.*), as the word list of
 * Settings > Words is. A font collection asks which of its faces to add.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CommandContext } from '@/app/commands';
import { tip } from '@/app/tooltips';
import { pdfValues } from '@/features/pdf/printValues';
import { PDF_PAGE_SIZE_GROUPS } from '@/features/pdf/pageSizes';
import { pdfFontUploadUrl } from '@/model/binaryUrls';
import type { PdfAddedFont, PdfFontAnswer, PdfShippedFont, Settings } from '@/rpc/types';

import { FieldRow, GroupBox } from './controls';

type PdfSettings = NonNullable<Settings['pdf']>;

const isCancelled = (answer: PdfFontAnswer | { cancelled: true }): answer is { cancelled: true } =>
  'cancelled' in answer;

/** The Local Font Access API's font (DP-4), which the DOM types of TypeScript do not have yet. */
interface LocalFont {
  fullName: string;
  postscriptName: string;
  blob(): Promise<Blob>;
}
type QueryLocalFonts = () => Promise<LocalFont[]>;

/** The defaults of contracts/settings (core settings.cpp), shown beside each value. */
const PDF_DEFAULTS: PdfSettings = {
  defaultPageSize: 'a4',
  textFont: 'noto-serif',
  textSize: 'standard',
  margins: 'standard',
  customTextSize: 115,
  customMargin: 22,
};

export interface PdfPageProps {
  draft: Settings;
  onChange: (patch: Partial<PdfSettings>) => void;
  ctx: CommandContext;
}

export function PdfPage({ draft, onChange, ctx }: PdfPageProps) {
  const { t } = useTranslation();
  const rpc = ctx.rpc;
  const values: PdfSettings = { ...PDF_DEFAULTS, ...draft.pdf };
  const [shipped, setShipped] = useState<PdfShippedFont[]>([]);
  const [added, setAdded] = useState<PdfAddedFont[]>([]);
  const [faces, setFaces] = useState<{ path: string; names: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [installed, setInstalled] = useState<LocalFont[] | null>(null);

  const refresh = async () => {
    if (!rpc) return;
    const list = await rpc.call('pdf.fonts.list', {});
    setShipped(list.shipped.filter((family) => family.textFont));
    setAdded(list.added);
  };
  useEffect(() => {
    if (!rpc) return;
    let cancelled = false;
    rpc
      .call('pdf.fonts.list', {})
      .then((list) => {
        if (cancelled) return;
        setShipped(list.shipped.filter((family) => family.textFont));
        setAdded(list.added);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [rpc]);

  const refusal = async (reason: string) =>
    ctx.dialogs.showMessage({
      text: t(`pdf.settings.refused.${reason}`, {
        defaultValue: t('pdf.settings.refused.unreadable'),
      }),
      caption: t('exports.settings.formats.pdf'),
      icon: 'error',
      testId: 'dialog-pdf-font-refused',
    });

  // The answer of pdf.fonts.addFile / addData: the font (chosen as the text font), a refusal, or a
  // collection's faces to choose from.
  const took = async (answer: PdfFontAnswer) => {
    if (answer.faces && answer.faces.length > 1 && answer.path && !faces) {
      setFaces({ path: answer.path, names: answer.faces });
    }
    if (answer.font && (!answer.refused || answer.refused === 'duplicate')) {
      await refresh();
      onChange({ textFont: answer.font.id });
      return;
    }
    if (answer.refused) await refusal(answer.refused);
  };

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };

  const addFile = () =>
    run(async () => {
      if (!rpc) return;
      const answer = await rpc.call('pdf.fonts.addFile', {
        title: t('pdf.settings.addFileTitle'),
        filterName: t('pdf.settings.fontFiles'),
      });
      if (!isCancelled(answer)) await took(answer);
    });

  const addFace = (face: number) =>
    run(async () => {
      if (!rpc || !faces) return;
      const answer = await rpc.call('pdf.fonts.addFile', { path: faces.path, face });
      if (!isCancelled(answer)) await took(answer);
      setFaces(null);
    });

  // DP-4: the fonts installed on this computer, asked for on the user's click (the shell grants
  // the local-fonts permission to its own page only); the one chosen is uploaded and added.
  const listInstalled = () =>
    run(async () => {
      const query = (window as unknown as { queryLocalFonts?: QueryLocalFonts }).queryLocalFonts;
      const fonts = query ? await query.call(window).catch(() => null) : null;
      if (!fonts || fonts.length === 0) {
        await refusal('noInstalledFonts');
        return;
      }
      setInstalled([...fonts].sort((a, b) => a.fullName.localeCompare(b.fullName)));
    });

  const addInstalled = (font: LocalFont) =>
    run(async () => {
      if (!rpc) return;
      const uploadId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const response = await fetch(pdfFontUploadUrl(uploadId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: await font.blob(),
      });
      if (!response.ok) {
        await refusal(response.status === 413 ? 'tooLarge' : 'unreadable');
        return;
      }
      await took(await rpc.call('pdf.fonts.addData', { uploadId, name: font.fullName }));
      setInstalled(null);
    });

  const remove = () =>
    run(async () => {
      if (!rpc) return;
      const font = added.find((f) => f.id === values.textFont);
      if (!font) return;
      await rpc.call('pdf.fonts.remove', { id: font.id });
      await refresh();
      onChange({ textFont: PDF_DEFAULTS.textFont });
    });

  const reset = (key: keyof PdfSettings) => onChange({ [key]: PDF_DEFAULTS[key] });
  const fontName = (id: string): string => {
    const font = added.find((f) => f.id === id);
    if (font) return [font.family, font.style].filter(Boolean).join(' ');
    return t(`pdf.settings.fonts.${id}`, { defaultValue: id });
  };
  const resetButton = (key: keyof PdfSettings, shown: string) => (
    <button
      type="button"
      className="mfbe-button"
      data-testid={`settings-pdf-reset-${key}`}
      disabled={values[key] === PDF_DEFAULTS[key]}
      onClick={() => reset(key)}
      {...tip(t('tip.settings.pdf.reset', { value: shown }))}
    >
      {t('pdf.settings.reset')}
    </button>
  );
  const defaultNote = (shown: string) => (
    <span className="mfbe-settings-default">{t('pdf.settings.default', { value: shown })}</span>
  );

  const textFontKnown =
    shipped.some((f) => f.id === values.textFont) || added.some((f) => f.id === values.textFont);

  return (
    <div className="mfbe-settings-page" data-testid="settings-page-pdf">
      <GroupBox title={t('pdf.settings.group')}>
        <FieldRow
          label={t('pdf.settings.pageSize')}
          htmlFor="settings-pdf-page-size"
          tooltip={t('tip.settings.pdf.pageSize')}
        >
          <select
            id="settings-pdf-page-size"
            data-testid="settings-pdf-page-size"
            value={values.defaultPageSize}
            onChange={(event) =>
              onChange({ defaultPageSize: event.target.value as PdfSettings['defaultPageSize'] })
            }
            {...tip(t('tip.settings.pdf.pageSize'))}
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
          {defaultNote(t(`pdf.sizes.${PDF_DEFAULTS.defaultPageSize}`))}
          {resetButton('defaultPageSize', t(`pdf.sizes.${PDF_DEFAULTS.defaultPageSize}`))}
        </FieldRow>

        <FieldRow
          label={t('pdf.settings.textFont')}
          htmlFor="settings-pdf-text-font"
          tooltip={t('tip.settings.pdf.textFont')}
        >
          <select
            id="settings-pdf-text-font"
            data-testid="settings-pdf-text-font"
            value={textFontKnown ? values.textFont : PDF_DEFAULTS.textFont}
            onChange={(event) => onChange({ textFont: event.target.value })}
            {...tip(t('tip.settings.pdf.textFont'))}
          >
            {shipped.map((font) => (
              <option key={font.id} value={font.id}>
                {fontName(font.id)}
              </option>
            ))}
            {added.length > 0 && (
              <optgroup label={t('pdf.settings.addedFonts')}>
                {added.map((font) => (
                  <option key={font.id} value={font.id}>
                    {fontName(font.id)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {defaultNote(fontName(PDF_DEFAULTS.textFont))}
          {resetButton('textFont', fontName(PDF_DEFAULTS.textFont))}
        </FieldRow>
        <div className="mfbe-settings-row mfbe-settings-buttons">
          <button
            type="button"
            className="mfbe-button"
            data-testid="settings-pdf-add-file"
            disabled={busy || !rpc}
            onClick={() => void addFile()}
            {...tip(t('tip.settings.pdf.addFile'))}
          >
            {t('pdf.settings.addFile')}
          </button>
          <button
            type="button"
            className="mfbe-button"
            data-testid="settings-pdf-add-installed"
            disabled={busy || !rpc}
            onClick={() => void listInstalled()}
            {...tip(t('tip.settings.pdf.addInstalled'))}
          >
            {t('pdf.settings.addInstalled')}
          </button>
          <button
            type="button"
            className="mfbe-button"
            data-testid="settings-pdf-remove"
            disabled={busy || !added.some((f) => f.id === values.textFont)}
            onClick={() => void remove()}
            {...tip(t('tip.settings.pdf.remove'))}
          >
            {t('pdf.settings.remove')}
          </button>
        </div>
        {installed && (
          <FieldRow
            label={t('pdf.settings.installed')}
            htmlFor="settings-pdf-installed"
            tooltip={t('tip.settings.pdf.installed')}
          >
            <select
              id="settings-pdf-installed"
              data-testid="settings-pdf-installed"
              defaultValue=""
              onChange={(event) => {
                const font = installed.find((f) => f.postscriptName === event.target.value);
                if (font) void addInstalled(font);
              }}
              {...tip(t('tip.settings.pdf.installed'))}
            >
              <option value="" disabled>
                {t('pdf.settings.chooseInstalled')}
              </option>
              {installed.map((font) => (
                <option key={font.postscriptName} value={font.postscriptName}>
                  {font.fullName}
                </option>
              ))}
            </select>
          </FieldRow>
        )}
        {faces && (
          <FieldRow
            label={t('pdf.settings.face')}
            htmlFor="settings-pdf-face"
            tooltip={t('tip.settings.pdf.face')}
          >
            <select
              id="settings-pdf-face"
              data-testid="settings-pdf-face"
              defaultValue=""
              onChange={(event) => void addFace(Number(event.target.value))}
              {...tip(t('tip.settings.pdf.face'))}
            >
              <option value="" disabled>
                {t('pdf.settings.chooseFace')}
              </option>
              {faces.names.map((name, index) => (
                <option key={`${index}-${name}`} value={index}>
                  {name}
                </option>
              ))}
            </select>
          </FieldRow>
        )}

        <FieldRow
          label={t('pdf.settings.textSize')}
          htmlFor="settings-pdf-text-size"
          tooltip={t('tip.settings.pdf.textSize')}
        >
          <select
            id="settings-pdf-text-size"
            data-testid="settings-pdf-text-size"
            value={values.textSize}
            onChange={(event) =>
              onChange({ textSize: event.target.value as PdfSettings['textSize'] })
            }
            {...tip(t('tip.settings.pdf.textSize'))}
          >
            {(['smaller', 'standard', 'larger', 'custom'] as const).map((size) => (
              <option key={size} value={size}>
                {t(`pdf.settings.textSizes.${size}`)}
              </option>
            ))}
          </select>
          {/* The value behind the choice, for the default page size; editable with Custom. */}
          <input
            type="number"
            className="mfbe-settings-value"
            data-testid="settings-pdf-text-size-value"
            aria-label={t('pdf.settings.textSizeValue')}
            min={6}
            max={24}
            step={0.5}
            readOnly={values.textSize !== 'custom'}
            value={pdfValues(values.defaultPageSize, values).textPt}
            onChange={(event) => {
              const pt = Number(event.target.value);
              if (pt >= 6 && pt <= 24) onChange({ customTextSize: Math.round(pt * 10) });
            }}
            {...tip(t('tip.settings.pdf.textSizeValue'))}
          />
          <span className="mfbe-settings-unit">{t('pdf.settings.unitPt')}</span>
          {defaultNote(t(`pdf.settings.textSizes.${PDF_DEFAULTS.textSize}`))}
          {resetButton('textSize', t(`pdf.settings.textSizes.${PDF_DEFAULTS.textSize}`))}
        </FieldRow>

        <FieldRow
          label={t('pdf.settings.margins')}
          htmlFor="settings-pdf-margins"
          tooltip={t('tip.settings.pdf.margins')}
        >
          <select
            id="settings-pdf-margins"
            data-testid="settings-pdf-margins"
            value={values.margins}
            onChange={(event) =>
              onChange({ margins: event.target.value as PdfSettings['margins'] })
            }
            {...tip(t('tip.settings.pdf.margins'))}
          >
            {(['narrow', 'standard', 'wide', 'custom'] as const).map((margin) => (
              <option key={margin} value={margin}>
                {t(`pdf.settings.marginSizes.${margin}`)}
              </option>
            ))}
          </select>
          <input
            type="number"
            className="mfbe-settings-value"
            data-testid="settings-pdf-margins-value"
            aria-label={t('pdf.settings.marginValue')}
            min={5}
            max={50}
            step={1}
            readOnly={values.margins !== 'custom'}
            value={Math.round(pdfValues(values.defaultPageSize, values).marginMm * 10) / 10}
            onChange={(event) => {
              const mm = Math.round(Number(event.target.value));
              if (mm >= 5 && mm <= 50) onChange({ customMargin: mm });
            }}
            {...tip(t('tip.settings.pdf.marginValue'))}
          />
          <span className="mfbe-settings-unit">{t('pdf.settings.unitMm')}</span>
          {defaultNote(t(`pdf.settings.marginSizes.${PDF_DEFAULTS.margins}`))}
          {resetButton('margins', t(`pdf.settings.marginSizes.${PDF_DEFAULTS.margins}`))}
        </FieldRow>

        <div className="mfbe-settings-row mfbe-settings-buttons">
          <button
            type="button"
            className="mfbe-button"
            data-testid="settings-pdf-reset-all"
            disabled={(Object.keys(PDF_DEFAULTS) as (keyof PdfSettings)[]).every(
              (key) => values[key] === PDF_DEFAULTS[key],
            )}
            onClick={() => onChange({ ...PDF_DEFAULTS })}
            {...tip(t('tip.settings.pdf.resetAll'))}
          >
            {t('pdf.settings.resetAll')}
          </button>
        </div>
      </GroupBox>
    </div>
  );
}
