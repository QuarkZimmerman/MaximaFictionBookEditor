/**
 * Feature 020 (T042, US3): Settings -> Imports page, mirroring ExportsPage.tsx with a top-level
 * format selector (PDF, EPUB, Markdown, TXT, MOBI), PDF Use OCR default (`Settings.imports.pdf.useOcr`),
 * and a clear informational note for formats without import settings yet.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Settings } from '@/rpc/types';

import { CheckField, GroupBox } from './controls';

const IMPORT_FORMATS = ['pdf', 'epub', 'markdown', 'txt', 'mobi'] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

export interface ImportsPageProps {
  draft: Settings;
  onChange: (patch: Partial<NonNullable<Settings['imports']>>) => void;
  initialFormat?: ImportFormat;
}

export function ImportsPage({ draft, onChange, initialFormat = 'pdf' }: ImportsPageProps) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<ImportFormat>(initialFormat);
  const useOcr = draft.imports?.pdf?.useOcr ?? true;

  return (
    <div className="mfbe-settings-page" data-testid="settings-page-imports">
      <div className="mfbe-settings-row">
        <label className="mfbe-settings-label" htmlFor="settings-imports-format">
          {t('imports.settings.format')}
        </label>
        <select
          id="settings-imports-format"
          data-testid="settings-imports-format"
          value={format}
          onChange={(event) => setFormat(event.target.value as ImportFormat)}
        >
          {IMPORT_FORMATS.map((id) => (
            <option key={id} value={id}>
              {t(`exports.settings.formats.${id}`)}
            </option>
          ))}
        </select>
      </div>
      {format === 'pdf' ? (
        <GroupBox title={t('exports.settings.formats.pdf')}>
          <CheckField
            label={t('imports.settings.pdf.useOcr')}
            tooltip={t('imports.settings.pdf.useOcrHint')}
            checked={useOcr}
            onChange={(checked) => onChange({ pdf: { useOcr: checked } })}
            testId="settings-imports-pdf-use-ocr"
          />
          <p className="mfbe-settings-note">{t('imports.settings.pdf.useOcrHint')}</p>
        </GroupBox>
      ) : (
        <p className="mfbe-settings-note" data-testid="settings-imports-none">
          {t('imports.settings.noSettings')}
        </p>
      )}
    </div>
  );
}
