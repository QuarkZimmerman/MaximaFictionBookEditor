/**
 * Feature 017 (D18, D19, DP-7): Settings > Exports > TXT - the defaults of the TXT export's dialog: the
 * encoding (always UTF-8, or by the book's language with one encoding for English, Russian, Ukrainian and
 * other books, each from its language's list), the byte-order mark and the ZIP box. Each value shows its
 * out-of-the-box value with Reset; Reset all puts the page back. The choices made in the dialog stay with
 * the open book (keptExportOptions.ts); these are only the defaults of a book's first export.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CommandContext } from '@/app/commands';
import { tip } from '@/app/tooltips';
import { encodingLabelKey, loadTxtEncodings } from '@/features/txt/encodings';
import type { Settings, TxtEncodings } from '@/rpc/types';

import { FieldRow, GroupBox } from './controls';

type TxtSettings = NonNullable<Settings['txt']>;
type ListKey = keyof TxtSettings['encodings'];

/** The defaults of contracts/settings.md (core settings.cpp), shown beside each value. */
const TXT_DEFAULTS: TxtSettings = {
  encodingMode: 'utf-8',
  encodings: { en: 'windows-1252', ru: 'windows-1251', uk: 'windows-1251', other: 'utf-8' },
  bom: false,
  zip: false,
};

const LISTS: ListKey[] = ['en', 'ru', 'uk', 'other'];

export interface TxtPageProps {
  draft: Settings;
  onChange: (patch: Partial<TxtSettings>) => void;
  ctx: CommandContext;
}

export function TxtPage({ draft, onChange, ctx }: TxtPageProps) {
  const { t } = useTranslation();
  const values: TxtSettings = {
    ...TXT_DEFAULTS,
    ...draft.txt,
    encodings: { ...TXT_DEFAULTS.encodings, ...draft.txt?.encodings },
  };
  const [lists, setLists] = useState<TxtEncodings | null>(null);
  useEffect(() => {
    if (ctx.rpc) void loadTxtEncodings(ctx.rpc).then(setLists, () => setLists(null));
  }, [ctx.rpc]);
  const offered = (key: ListKey): string[] =>
    !lists ? [values.encodings[key]] : key === 'other' ? lists.all.map((e) => e.name) : lists[key];
  const label = (name: string): string => (lists ? t(encodingLabelKey(lists, name)) : name);
  const reset = (disabled: boolean, onClick: () => void, shown: string, id: string) => (
    <button
      type="button"
      className="mfbe-button"
      data-testid={`settings-txt-reset-${id}`}
      disabled={disabled}
      onClick={onClick}
      {...tip(t('tip.settings.pdf.reset', { value: shown }))}
    >
      {t('pdf.settings.reset')}
    </button>
  );
  const note = (shown: string) => (
    <span className="mfbe-settings-default">{t('pdf.settings.default', { value: shown })}</span>
  );
  const setList = (key: ListKey, name: string) =>
    onChange({ encodings: { ...values.encodings, [key]: name } });
  const same = JSON.stringify(values) === JSON.stringify(TXT_DEFAULTS);
  return (
    <div className="mfbe-settings-page" data-testid="settings-page-txt">
      <GroupBox title={t('txt.settings.group')}>
        <FieldRow label={t('txt.settings.encodingMode')} tooltip={t('tip.settings.txt.mode')}>
          <label>
            <input
              type="radio"
              name="settings-txt-mode"
              data-testid="settings-txt-mode-utf-8"
              checked={values.encodingMode === 'utf-8'}
              onChange={() => onChange({ encodingMode: 'utf-8' })}
            />
            {t('txt.settings.modeUtf8')}
          </label>
          <label>
            <input
              type="radio"
              name="settings-txt-mode"
              data-testid="settings-txt-mode-language"
              checked={values.encodingMode === 'language'}
              onChange={() => onChange({ encodingMode: 'language' })}
            />
            {t('txt.settings.modeLanguage')}
          </label>
          {note(t('txt.settings.modeUtf8'))}
          {reset(
            values.encodingMode === TXT_DEFAULTS.encodingMode,
            () => onChange({ encodingMode: TXT_DEFAULTS.encodingMode }),
            t('txt.settings.modeUtf8'),
            'mode',
          )}
        </FieldRow>
        {LISTS.map((key) => (
          <FieldRow
            key={key}
            label={t(`txt.settings.encodingFor.${key}`)}
            htmlFor={`settings-txt-encoding-${key}`}
            tooltip={t('tip.settings.txt.encoding')}
          >
            <select
              id={`settings-txt-encoding-${key}`}
              data-testid={`settings-txt-encoding-${key}`}
              value={values.encodings[key]}
              disabled={values.encodingMode !== 'language'}
              onChange={(event) => setList(key, event.target.value)}
            >
              {offered(key).map((name) => (
                <option key={name} value={name}>
                  {label(name)}
                </option>
              ))}
            </select>
            {note(label(TXT_DEFAULTS.encodings[key]))}
            {reset(
              values.encodings[key] === TXT_DEFAULTS.encodings[key],
              () => setList(key, TXT_DEFAULTS.encodings[key]),
              label(TXT_DEFAULTS.encodings[key]),
              `encoding-${key}`,
            )}
          </FieldRow>
        ))}
        {(['bom', 'zip'] as const).map((key) => (
          <FieldRow
            key={key}
            label={t(`txt.settings.${key}`)}
            tooltip={t(`tip.settings.txt.${key}`)}
          >
            <input
              type="checkbox"
              data-testid={`settings-txt-${key}`}
              checked={values[key]}
              onChange={(event) => onChange({ [key]: event.target.checked })}
            />
            {note(t(TXT_DEFAULTS[key] ? 'txt.settings.on' : 'txt.settings.off'))}
            {reset(
              values[key] === TXT_DEFAULTS[key],
              () => onChange({ [key]: TXT_DEFAULTS[key] }),
              t(TXT_DEFAULTS[key] ? 'txt.settings.on' : 'txt.settings.off'),
              key,
            )}
          </FieldRow>
        ))}
        <div className="mfbe-settings-row mfbe-settings-buttons">
          <button
            type="button"
            className="mfbe-button"
            data-testid="settings-txt-reset-all"
            disabled={same}
            onClick={() => onChange({ ...TXT_DEFAULTS, encodings: { ...TXT_DEFAULTS.encodings } })}
            {...tip(t('tip.settings.pdf.resetAll'))}
          >
            {t('pdf.settings.resetAll')}
          </button>
        </div>
      </GroupBox>
    </div>
  );
}
