/**
 * Script run banner (feature 003, FR-010): while a script runs, a strip above the document
 * pane - in every view, with or without the status bar - shows the script's name, the elapsed
 * time (`mm:ss`, refreshed every second by the host), the progress the script reports
 * (`mfbe.ui.progress`: phase and percentage or count), a moving busy sign and Cancel. The
 * banner covers and greys nothing of the document; it stays above the script's own modal
 * dialogs so Cancel is available while the script asks something (FR-015). Rendered by App.tsx
 * in the view area; the status-bar run line (RunBar.tsx) remains in addition.
 */

import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppServices } from '@/app/services';
import { useAppState } from '@/model/store';

import { getScriptsFeature } from './catalog';
import { formatElapsed, formatRunProgress } from './host';

import './scripting.css';

const NO_SUBSCRIPTION = () => () => {};

export function ScriptRunBanner() {
  const { t } = useTranslation();
  const { store } = useAppServices();
  const feature = getScriptsFeature(store);
  const run = useSyncExternalStore(feature?.host.subscribe ?? NO_SUBSCRIPTION, () =>
    feature?.host.isRunning ? feature.host.current : null,
  );
  const progress = useAppState((s) => s.progress, store);
  if (!feature || !run) return null;

  const progressText = formatRunProgress(t, progress);
  return (
    <div
      className="mfbe-script-banner"
      role="group"
      aria-label={t('scripting.banner.label')}
      data-testid="script-run-banner"
      data-script-id={run.scriptId}
      data-waiting={run.waiting ? 'true' : undefined}
    >
      <span className="mfbe-script-banner-busy" aria-hidden="true" />
      <span className="mfbe-script-banner-text">
        <span className="mfbe-script-banner-name" data-testid="script-run-name" title={run.name}>
          {t('scripting.banner.running', { name: run.name })}
        </span>
        {progressText ? (
          <span
            className="mfbe-script-banner-progress"
            data-testid="script-run-progress"
            title={progressText}
          >
            {progressText}
          </span>
        ) : null}
      </span>
      <span
        className="mfbe-script-banner-elapsed"
        data-testid="script-run-elapsed"
        title={t('scripting.banner.elapsed')}
      >
        {formatElapsed(run.elapsedMs)}
      </span>
      <button
        type="button"
        className="mfbe-button mfbe-script-banner-cancel"
        data-testid="script-run-cancel"
        // A click must not take the focus away from a dialog the script has open.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => feature.host.cancel()}
      >
        {t('scripting.runBar.cancel')}
      </button>
    </div>
  );
}
