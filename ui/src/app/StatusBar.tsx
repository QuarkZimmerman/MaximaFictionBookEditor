/**
 * Status bar: message pane ("Ready" / "Not connected" / explicit message / job progress),
 * element path pane and the INS/OVR pane, as in the original frame window. While a script runs
 * the run bar (progress and Cancel) takes the message pane's place, shown even when the status
 * bar is hidden.
 */

import { useTranslation } from 'react-i18next';

import { useAppState } from '@/model/store';
import { RunBar } from '@/scripting/RunBar';

import { useAppServices } from './services';

export function StatusBar() {
  const { t } = useTranslation();
  const { store } = useAppServices();
  const visible = useAppState((s) => s.toolbars.status, store);
  const connection = useAppState((s) => s.connection, store);
  const message = useAppState((s) => s.statusMessage, store);
  const progress = useAppState((s) => s.progress, store);
  const selectionPath = useAppState((s) => s.selectionPath, store);
  const insertMode = useAppState((s) => s.insertMode, store);
  const scriptRunning = useAppState((s) => s.scriptRunning, store);

  if (!visible && !scriptRunning) return null;

  let text: string;
  if (progress) {
    text =
      progress.total > 0
        ? t('status.progressPercent', {
            phase: progress.phase,
            percent: Math.min(100, Math.round((progress.done / progress.total) * 100)),
          })
        : t('status.progress', {
            phase: progress.phase,
            done: progress.done,
            total: progress.total,
          });
  } else if (message) {
    text = message;
  } else if (connection === 'connected') {
    text = t('status.ready');
  } else if (connection === 'connecting') {
    text = t('status.connecting');
  } else {
    text = t('status.notConnected');
  }

  return (
    <div className="mfbe-statusbar" role="status" data-testid="statusbar">
      {scriptRunning ? (
        <RunBar />
      ) : (
        <span className="mfbe-status-pane mfbe-status-message" data-testid="status-message">
          {text}
        </span>
      )}
      {visible ? (
        <>
          <span
            className="mfbe-status-pane mfbe-status-path"
            data-testid="status-path"
            title={selectionPath}
          >
            {selectionPath}
          </span>
          <span
            className="mfbe-status-pane mfbe-status-insmode"
            data-testid="status-insmode"
            data-mode={insertMode}
          >
            {insertMode === 'insert' ? t('status.ins') : t('status.ovr')}
          </span>
        </>
      ) : null}
    </div>
  );
}
