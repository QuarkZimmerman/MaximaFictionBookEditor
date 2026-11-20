/**
 * Settings > Exports (requester, rc.3): the settings of each export format, one format at a time,
 * chosen in the list at the top - PDF, EPUB, Markdown, TXT (feature 017, D18). Every option an export's
 * dialog offers has its default here; the choices made in a dialog stay with the open book (D17).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { tip } from '@/app/tooltips';

import type { CommandContext } from '@/app/commands';
import type { Settings } from '@/rpc/types';

import { MarkdownPage } from './MarkdownPage';
import { PdfPage } from './PdfPage';
import { TxtPage } from './TxtPage';

const FORMATS = ['pdf', 'epub', 'markdown', 'txt'] as const;
type ExportFormat = (typeof FORMATS)[number];

export interface ExportsPageProps {
  draft: Settings;
  onChange: <S extends 'pdf' | 'markdown' | 'txt'>(
    section: S,
    patch: Partial<NonNullable<Settings[S]>>,
  ) => void;
  ctx: CommandContext;
}

export function ExportsPage({ draft, onChange, ctx }: ExportsPageProps) {
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
        <PdfPage draft={draft} onChange={(patch) => onChange('pdf', patch)} ctx={ctx} />
      ) : format === 'markdown' ? (
        <MarkdownPage draft={draft} onChange={(patch) => onChange('markdown', patch)} />
      ) : format === 'txt' ? (
        <TxtPage draft={draft} onChange={(patch) => onChange('txt', patch)} ctx={ctx} />
      ) : (
        <p className="mfbe-settings-note" data-testid="settings-exports-none">
          {t('exports.settings.none')}
        </p>
      )}
    </div>
  );
}
