/**
 * Feature 017 (D18, D21, DP-7): Settings > Exports > Markdown - the default of the one-file Markdown
 * export's *Include pictures*. The choice made in the export stays with the open book.
 */
import { useTranslation } from 'react-i18next';

import { tip } from '@/app/tooltips';
import type { Settings } from '@/rpc/types';

import { FieldRow, GroupBox } from './controls';

type MarkdownSettings = NonNullable<Settings['markdown']>;

const MARKDOWN_DEFAULTS: MarkdownSettings = { includePictures: true };

export interface MarkdownPageProps {
  draft: Settings;
  onChange: (patch: Partial<MarkdownSettings>) => void;
}

export function MarkdownPage({ draft, onChange }: MarkdownPageProps) {
  const { t } = useTranslation();
  const value = draft.markdown?.includePictures ?? MARKDOWN_DEFAULTS.includePictures;
  const shown = t(MARKDOWN_DEFAULTS.includePictures ? 'txt.settings.on' : 'txt.settings.off');
  return (
    <div className="mfbe-settings-page" data-testid="settings-page-markdown">
      <GroupBox title={t('txt.settings.markdownGroup')}>
        <FieldRow
          label={t('txt.settings.includePictures')}
          tooltip={t('tip.settings.txt.includePictures')}
        >
          <input
            type="checkbox"
            data-testid="settings-markdown-include-pictures"
            {...tip(t('tip.settings.txt.includePictures'))}
            checked={value}
            onChange={(event) => onChange({ includePictures: event.target.checked })}
          />
          <span className="mfbe-settings-default">
            {t('pdf.settings.default', { value: shown })}
          </span>
          <button
            type="button"
            className="mfbe-button"
            data-testid="settings-markdown-reset-include-pictures"
            disabled={value === MARKDOWN_DEFAULTS.includePictures}
            onClick={() => onChange({ ...MARKDOWN_DEFAULTS })}
            {...tip(t('tip.settings.pdf.reset', { value: shown }))}
          >
            {t('pdf.settings.reset')}
          </button>
        </FieldRow>
        <div className="mfbe-settings-row mfbe-settings-buttons">
          <button
            type="button"
            className="mfbe-button"
            data-testid="settings-markdown-reset-all"
            disabled={value === MARKDOWN_DEFAULTS.includePictures}
            onClick={() => onChange({ ...MARKDOWN_DEFAULTS })}
            {...tip(t('tip.settings.pdf.resetAll'))}
          >
            {t('pdf.settings.resetAll')}
          </button>
        </div>
      </GroupBox>
    </div>
  );
}
