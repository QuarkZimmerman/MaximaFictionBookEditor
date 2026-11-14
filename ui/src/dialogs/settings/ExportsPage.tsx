/**
 * Settings > Exports (requester, rc.3): the settings of each export format, one format at a time,
 * chosen in the list at the top. For now only the PDF export has settings of its own.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { tip } from '@/app/tooltips';

import { PdfPage, type PdfPageProps } from './PdfPage';

const FORMATS = ['pdf', 'epub', 'markdown'] as const;
type ExportFormat = (typeof FORMATS)[number];

export function ExportsPage(props: PdfPageProps) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<ExportFormat>('pdf');
  return (
    <div className="mfbe-settings-page" data-testid="settings-page-exports">
      <div className="mfbe-settings-row">
        <label className="mfbe-settings-label" htmlFor="settings-exports-format">
          {t('exports.settings.format')}
        </label>
        <select
          id="settings-exports-format"
          data-testid="settings-exports-format"
          value={format}
          onChange={(event) => setFormat(event.target.value as ExportFormat)}
          {...tip(t('tip.settings.exports.format'))}
        >
          {FORMATS.map((id) => (
            <option key={id} value={id}>
              {t(`exports.settings.formats.${id}`)}
            </option>
          ))}
        </select>
      </div>
      {format === 'pdf' ? (
        <PdfPage {...props} />
      ) : (
        <p className="mfbe-settings-note" data-testid="settings-exports-none">
          {t('exports.settings.none')}
        </p>
      )}
    </div>
  );
}
