/**
 * Run bar (T058, FR-051): while a script runs, the status bar shows its progress
 * (`mfbe.ui.progress`, else its status text) and a Cancel command that stays available
 * throughout the run, above the script's own dialogs too. After 30 s without activity it says
 * so - information only, Cancel is the way to stop the script. Rendered by the status bar
 * (app/StatusBar.tsx), also when the status bar is hidden. Since feature 003 the run banner
 * above the document (ScriptRunBanner.tsx) is the primary indicator; this line remains in
 * addition (FR-010), its Cancel as `script-run-bar-cancel` beside the banner's
 * `script-run-cancel`.
 */

import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppServices } from '@/app/services';
import { useAppState } from '@/model/store';

import { SCRIPT_PROGRESS_JOB } from './api-impl';
import { getScriptsFeature } from './catalog';

import './scripting.css';

const NO_SUBSCRIPTION = () => () => {};

export function RunBar() {
  const { t } = useTranslation();
  const { store } = useAppServices();
  const feature = getScriptsFeature(store);
  const run = useSyncExternalStore(feature?.host.subscribe ?? NO_SUBSCRIPTION, () =>
    feature?.host.isRunning ? feature.host.current : null,
  );
  const progress = useAppState((s) => s.progress, store);
  const status = useAppState((s) => s.statusMessage, store);
  if (!feature || !run) return null;

  let text: string;
  if (run.silent) {
    text = t('scripting.runBar.silent', { name: run.name });
  } else if (progress?.jobId === SCRIPT_PROGRESS_JOB) {
    text =
      progress.total > 0
        ? t('status.progressPercent', {
            phase: progress.phase,
            percent: Math.min(100, Math.round((progress.done / progress.total) * 100)),
          })
        : t('scripting.runBar.count', { phase: progress.phase, done: progress.done });
  } else {
    text = status ?? t('scripting.status.running', { name: run.name });
  }

  return (
    <div
      className="mfbe-runbar"
      role="group"
      aria-label={t('scripting.runBar.label')}
      data-testid="script-run-bar"
      data-silent={run.silent ? 'true' : undefined}
    >
      <span className="mfbe-runbar-text" data-testid="script-run-text" title={text}>
        {text}
      </span>
      <button
        type="button"
        className="mfbe-button mfbe-runbar-cancel"
        data-testid="script-run-bar-cancel"
        // A click must not take the focus away from a dialog the script has open.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => feature.host.cancel()}
      >
        {t('scripting.runBar.cancel')}
      </button>
    </div>
  );
}
