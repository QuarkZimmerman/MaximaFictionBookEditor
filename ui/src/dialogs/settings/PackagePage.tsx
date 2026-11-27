/**
 * Feature 022: Settings -> Package page.
 *
 * Configures automatic cover image extraction/generation when book files (PDF, EPUB, MOBI/AZW3)
 * are attached to an FBD ZIP package.
 */
import { useTranslation } from 'react-i18next';

import type { Settings } from '@/rpc/types';

import { CheckField, GroupBox } from './controls';

export interface PackagePageProps {
  draft: Settings;
  onChange: (patch: Partial<NonNullable<Settings['package']>>) => void;
}

export function PackagePage({ draft, onChange }: PackagePageProps) {
  const { t } = useTranslation();
  const autoCoverPdf = draft.package?.autoCoverPdf ?? true;
  const autoCoverEpub = draft.package?.autoCoverEpub ?? true;
  const autoCoverMobi = draft.package?.autoCoverMobi ?? true;

  return (
    <div className="mfbe-settings-page" data-testid="settings-page-package">
      <GroupBox title={t('package.settings.autoCoverGroup')}>
        <p className="mfbe-settings-note">{t('package.settings.autoCoverHint')}</p>
        <CheckField
          label={t('package.settings.autoCoverPdf')}
          tooltip={t('tip.settings.package.autoCoverPdf')}
          checked={autoCoverPdf}
          onChange={(checked) => onChange({ autoCoverPdf: checked })}
          testId="settings-package-auto-cover-pdf"
        />
        <CheckField
          label={t('package.settings.autoCoverEpub')}
          tooltip={t('tip.settings.package.autoCoverEpub')}
          checked={autoCoverEpub}
          onChange={(checked) => onChange({ autoCoverEpub: checked })}
          testId="settings-package-auto-cover-epub"
        />
        <CheckField
          label={t('package.settings.autoCoverMobi')}
          tooltip={t('tip.settings.package.autoCoverMobi')}
          checked={autoCoverMobi}
          onChange={(checked) => onChange({ autoCoverMobi: checked })}
          testId="settings-package-auto-cover-mobi"
        />
      </GroupBox>
    </div>
  );
}
