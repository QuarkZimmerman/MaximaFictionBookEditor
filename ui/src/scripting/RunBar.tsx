/**
 * Run bar (T058, FR-051): while the run lock is held (`store.runLock`) the status bar shows the
 * run - for a script its progress (`mfbe.ui.progress`, else its status text), for an AI
 * request (feature 005) the status text, else the request's current operation, else its label -
 * and a Cancel command that stays available throughout the run, above the script's own dialogs
 * too. After 30 s without activity a script run says so - information only, Cancel is the way
 * to stop the script. Rendered by the status bar (app/StatusBar.tsx), also when the status bar
 * is hidden. Since feature 003 the run banner above the document (ScriptRunBanner.tsx) is the
 * primary indicator; this line remains in addition (FR-010), its Cancel as
 * `script-run-bar-cancel` beside the banner's `script-run-cancel`.
 */

import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppServices } from '@/app/services';
import { useAppState } from '@/model/store';

import { SCRIPT_PROGRESS_JOB } from './api-impl';
import { getScriptsFeature } from './catalog';
import { cancelActiveRun } from './runSession';

import './scripting.css';

const NO_SUBSCRIPTION = () => () => {};

export function RunBar() {
  const { t } = useTranslation();
  const { store } = useAppServices();
  const feature = getScriptsFeature(store);
  const lock = useAppState((s) => s.runLock, store);
  const run = useSyncExternalStore(feature?.host.subscribe ?? NO_SUBSCRIPTION, () =>
    feature?.host.isRunning ? feature.host.current : null,
  );
  const progress = useAppState((s) => s.progress, store);
  const status = useAppState((s) => s.statusMessage, store);
  if (!lock) return null;

  const script = lock.kind === 'script';
  let text: string;
  if (script && run?.silent) {
    text = t('scripting.runBar.silent', { name: run.name });
  } else if (script && progress?.jobId === SCRIPT_PROGRESS_JOB) {
    text =
      progress.total > 0
        ? t('status.progressPercent', {
            phase: progress.phase,
            percent: Math.min(100, Math.round((progress.done / progress.total) * 100)),
          })
        : t('scripting.runBar.count', { phase: progress.phase, done: progress.done });
  } else if (script) {
    text = status ?? t('scripting.status.running', { name: lock.label });
  } else {
    text = status ?? lock.phase ?? lock.label;
  }

  return (
    <div
      className="mfbe-runbar"
      role="group"
      aria-label={script ? t('scripting.runBar.label') : lock.label}
      data-testid="script-run-bar"
      data-run-kind={lock.kind}
      data-silent={script && run?.silent ? 'true' : undefined}
    >
      <span className="mfbe-runbar-text" data-testid="script-run-text" title={text}>
        {text}
      </span>
      <button
        type="button"
        className="mfbe-button mfbe-runbar-cancel"
        data-testid="script-run-bar-cancel"
        // A click must not take the focus away from a dialog the script has open. Cancel
        // reaches whoever holds the lock: the script's session or the AI request's.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => cancelActiveRun(store)}
      >
        {t('scripting.runBar.cancel')}
      </button>
    </div>
  );
}
