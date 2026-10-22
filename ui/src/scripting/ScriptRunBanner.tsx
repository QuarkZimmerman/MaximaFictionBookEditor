/**
 * Run banner (feature 003, FR-010; feature 005, FR-022): while the run lock is held
 * (`store.runLock` - a script run or an AI assistant request), a strip above the document
 * pane - in every view, with or without the status bar - shows who holds it, the elapsed time
 * (`mm:ss`, refreshed every second), the current operation and Cancel. Per kind: a script run
 * shows the script's name and the progress the script reports (`mfbe.ui.progress`: phase and
 * percentage or count); an AI request shows `<service name> · <model>` and its current state
 * (`phase`: "waiting for the answer", "running replace_node"... - `ai-banner-operation`). The
 * banner covers and greys nothing of the document; its Cancel button alone stays above the
 * script's own modal dialogs, so Cancel is available while the script asks something (FR-015)
 * and a tall dialog reaching into the strip is still operable (scripting.css). Rendered by
 * App.tsx in the view area; the status-bar run line (RunBar.tsx) remains in addition.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppServices } from '@/app/services';
import { useAppState } from '@/model/store';

import { getScriptsFeature } from './catalog';
import { formatElapsed, formatRunProgress } from './host';
import { cancelActiveRun } from './runSession';

import './scripting.css';

const NO_SUBSCRIPTION = () => () => {};

/** The elapsed time shown by the banner is refreshed this often (FR-010: at least every second). */
const ELAPSED_TICK_MS = 1_000;

/**
 * `Date.now() - startedAt`, refreshed once a second while `startedAt` is set; 0 without. A run
 * shows `00:00` the moment its lock appears (the clock is read on the ticks, never during a
 * render) and counts from the first tick on.
 */
function useElapsedSince(startedAt: number | null): number {
  const [clock, setClock] = useState({ startedAt, now: startedAt ?? 0 });
  if (clock.startedAt !== startedAt) {
    // Another run (or none): state adjusted during the render, the way React resets state that
    // depends on a changed input.
    setClock({ startedAt, now: startedAt ?? 0 });
  }
  useEffect(() => {
    if (startedAt === null) return undefined;
    const timer = setInterval(() => setClock({ startedAt, now: Date.now() }), ELAPSED_TICK_MS);
    return () => clearInterval(timer);
  }, [startedAt]);
  return startedAt === null ? 0 : Math.max(0, clock.now - startedAt);
}

export function ScriptRunBanner() {
  const { t } = useTranslation();
  const { store } = useAppServices();
  const feature = getScriptsFeature(store);
  const lock = useAppState((s) => s.runLock, store);
  const run = useSyncExternalStore(feature?.host.subscribe ?? NO_SUBSCRIPTION, () =>
    feature?.host.isRunning ? feature.host.current : null,
  );
  const progress = useAppState((s) => s.progress, store);
  const elapsedMs = useElapsedSince(lock?.startedAt ?? null);
  if (!lock) return null;

  const script = lock.kind === 'script';
  const progressText = script ? formatRunProgress(t, progress) : null;
  return (
    <div
      className="mfbe-script-banner"
      role="group"
      aria-label={script ? t('scripting.banner.label') : lock.label}
      data-testid="script-run-banner"
      data-run-kind={lock.kind}
      data-script-id={script ? run?.scriptId : undefined}
      data-waiting={run?.waiting ? 'true' : undefined}
    >
      <span className="mfbe-script-banner-busy" aria-hidden="true" />
      <span className="mfbe-script-banner-text">
        <span className="mfbe-script-banner-name" data-testid="script-run-name" title={lock.label}>
          {script ? t('scripting.banner.running', { name: lock.label }) : lock.label}
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
        {lock.phase ? (
          <span
            className="mfbe-script-banner-progress"
            data-testid="ai-banner-operation"
            title={lock.phase}
          >
            {lock.phase}
          </span>
        ) : null}
      </span>
      <span
        className="mfbe-script-banner-elapsed"
        data-testid="script-run-elapsed"
        title={t('scripting.banner.elapsed')}
      >
        {formatElapsed(elapsedMs)}
      </span>
      <button
        type="button"
        className="mfbe-button mfbe-script-banner-cancel"
        data-testid="script-run-cancel"
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
