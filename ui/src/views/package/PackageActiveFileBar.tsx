/**
 * Active-file header banner and empty-package placeholder shared by Description and read-only
 * Source views while in FBD ZIP Package mode (feature 022, T020, FR-012).
 */

import { useTranslation } from 'react-i18next';

import { useAppServices, useCommandContext } from '@/app/services';
import { tip } from '@/app/tooltips';
import { activePackageEntry } from '@/features/package';
import { isRunLocked, useAppState } from '@/model/store';

import './packageFiles.css';

export function PackageActiveFileBar({ view }: { view: 'description' | 'source' }) {
  const { t } = useTranslation();
  const { store } = useAppServices();
  const editorMode = useAppState((s) => s.editorMode, store);
  const pkg = useAppState((s) => s.packageState, store);

  if (editorMode !== 'package') return null;
  const active = activePackageEntry(pkg);
  if (!active) return null;

  return (
    <div className="mfbe-package-active-bar" data-testid="package-active-file-bar">
      <span className="mfbe-package-active-label">
        {view === 'source'
          ? t('package.activeFile.viewingSource')
          : t('package.activeFile.editing')}
      </span>
      <span className="mfbe-package-active-name" data-testid="package-active-file-name">
        {active.fileName}
      </span>
      <span className="mfbe-package-active-fbd">{`${active.stem}.fbd`}</span>
      {view === 'source' ? (
        <span className="mfbe-package-readonly-badge" data-testid="package-source-readonly-badge">
          {t('package.activeFile.readOnlyBadge')}
        </span>
      ) : null}
    </div>
  );
}

export function PackageEmptyWorkspace() {
  const { t } = useTranslation();
  const services = useAppServices();
  const ctx = useCommandContext();
  const runLocked = useAppState(isRunLocked, services.store);

  return (
    <div className="mfbe-package-empty-workspace" data-testid="package-empty-workspace">
      <div className="mfbe-package-empty-card">
        <h3 className="mfbe-package-empty-title">{t('package.activeFile.emptyTitle')}</h3>
        <p className="mfbe-package-empty-hint">{t('package.activeFile.emptyHint')}</p>
        <button
          type="button"
          className="mfbe-package-empty-add-btn"
          data-testid="package-empty-add"
          disabled={runLocked}
          {...tip(t('tip.package.addFile'))}
          onClick={() => void services.packages.addFilesWithDialog(ctx)}
        >
          {`+ ${t('package.sidebar.add')}`}
        </button>
      </div>
    </div>
  );
}
