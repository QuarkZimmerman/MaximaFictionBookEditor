/**
 * Status bar: message pane ("Ready" / "Not connected" / explicit message / job progress),
 * element path pane and the INS/OVR pane, as in the original frame window. While a script runs
 * (or an AI request holds the run lock) the run bar (progress and Cancel) takes the message
 * pane's place, shown even when the status bar is hidden.
 *
 * Feature 009 (User Story 5, FR-050 to FR-057): the position, selection, character, encoding
 * and validity panes. The character pane shows the code (`U+00A0`, `&#160;`) with its name or
 * script, and a double-click copies the code; a click on the validity pane runs File >
 * Validate. A right-click on the bar ticks the panes shown (`view.statusBarPanes`); the message
 * pane always shows.
 */

import { useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { defaultSaveEncoding } from '@/features/file/fileCommands';
import { actions, isRunLocked, useAppState } from '@/model/store';
import { RunBar } from '@/scripting/RunBar';

import { characterKey, characterReference, codePointLabel } from './charNames';
import { PopupMenu, type PopupMenuItem } from './PopupMenu';
import { useAppServices, useCommandContext } from './services';
import {
  encodingText,
  STATUS_PANES,
  validityOf,
  visiblePanes,
  type StatusPane,
} from './statusInfo';

export function StatusBar() {
  const { t } = useTranslation();
  const services = useAppServices();
  const ctx = useCommandContext();
  const { store, rpc } = services;
  const visible = useAppState((s) => s.toolbars.status, store);
  const connection = useAppState((s) => s.connection, store);
  const message = useAppState((s) => s.statusMessage, store);
  const progress = useAppState((s) => s.progress, store);
  const selectionPath = useAppState((s) => s.selectionPath, store);
  const insertMode = useAppState((s) => s.insertMode, store);
  const runLocked = useAppState(isRunLocked, store);
  const panesSetting = useAppState((s) => s.settings?.view.statusBarPanes, store);
  const activeView = useAppState((s) => s.activeView, store);
  const caretInfo = useAppState((s) => s.caretInfo, store);
  const document = useAppState((s) => s.document, store);
  const lastCheck = useAppState((s) => s.lastCheck, store);
  const revision = useAppState((s) => s.contentRevision, store);
  useAppState((s) => s.settings?.other, store); // the next Save's encoding follows the settings
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  if (!visible && !runLocked) return null;

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

  const shown = new Set<StatusPane>(visiblePanes(panesSetting));
  const info = caretInfo && caretInfo.view === activeView ? caretInfo : null;
  const char = info?.char;
  const charKey = char === undefined ? null : characterKey(char);
  const selection = info?.selection;
  const validity = validityOf(lastCheck, revision);

  const copyCode = () => {
    if (char === undefined) return;
    const code = codePointLabel(char);
    void navigator.clipboard
      ?.writeText(code)
      .then(() => actions.setStatusMessage(store, t('status.characterCopied', { code })))
      .catch(() => undefined);
  };

  const togglePane = (pane: StatusPane) => {
    const next = shown.has(pane)
      ? STATUS_PANES.filter((p) => shown.has(p) && p !== pane)
      : STATUS_PANES.filter((p) => shown.has(p) || p === pane);
    void rpc
      ?.call('settings.set', { patch: { view: { statusBarPanes: next } } })
      .catch(() => undefined);
  };

  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY });
  };

  const menuItems: PopupMenuItem[] = STATUS_PANES.map((pane) => ({
    id: pane,
    label: t(`status.pane.${pane}`),
    checked: shown.has(pane),
    run: () => togglePane(pane),
  }));

  const selectionText = selection
    ? selection.words === null
      ? t('status.selection.counting', { chars: selection.chars })
      : t(info?.view === 'source' ? 'status.selection.source' : 'status.selection.body', {
          chars: selection.chars,
          words: selection.words,
          units: selection.units,
        })
    : '';

  return (
    <div
      className="mfbe-statusbar"
      role="status"
      data-testid="statusbar"
      onContextMenu={visible ? onContextMenu : undefined}
    >
      {runLocked ? (
        <RunBar />
      ) : (
        <span className="mfbe-status-pane mfbe-status-message" data-testid="status-message">
          {text}
        </span>
      )}
      {visible ? (
        <>
          {shown.has('path') ? (
            <span
              className="mfbe-status-pane mfbe-status-path"
              data-testid="status-path"
              title={selectionPath}
            >
              {selectionPath}
            </span>
          ) : null}
          {shown.has('position') && info?.line !== undefined ? (
            <span className="mfbe-status-pane mfbe-status-position" data-testid="status-position">
              {t('status.position', { line: info.line, column: info.column })}
            </span>
          ) : null}
          {shown.has('selection') && selection ? (
            <span className="mfbe-status-pane mfbe-status-selection" data-testid="status-selection">
              {selectionText}
            </span>
          ) : null}
          {shown.has('character') && char !== undefined ? (
            <span
              className="mfbe-status-pane mfbe-status-character"
              data-testid="status-character"
              title={t('status.character.tooltip')}
              onDoubleClick={copyCode}
            >
              {codePointLabel(char)} {characterReference(char)}
              {charKey ? ` ${t(charKey)}` : ''}
            </span>
          ) : null}
          {shown.has('encoding') && document ? (
            <span className="mfbe-status-pane mfbe-status-encoding" data-testid="status-encoding">
              {encodingText(document.sourceEncoding, defaultSaveEncoding(store))}
            </span>
          ) : null}
          {shown.has('validity') && document ? (
            <button
              type="button"
              className="mfbe-status-pane mfbe-status-validity"
              data-testid="status-validity"
              data-state={validity.state}
              title={t('status.validity.tooltip')}
              onClick={() => void services.commands.execute('file.validate', ctx)}
            >
              {validity.state === 'valid'
                ? t('status.validity.valid')
                : validity.state === 'problems'
                  ? t('status.validity.problems', { count: validity.count })
                  : t('status.validity.unchecked')}
            </button>
          ) : null}
          {shown.has('insmode') ? (
            <span
              className="mfbe-status-pane mfbe-status-insmode"
              data-testid="status-insmode"
              data-mode={insertMode}
            >
              {insertMode === 'insert' ? t('status.ins') : t('status.ovr')}
            </span>
          ) : null}
        </>
      ) : null}
      {menu ? (
        <PopupMenu
          items={menuItems}
          position={menu}
          onClose={() => setMenu(null)}
          testId="status-menu"
          ariaLabel={t('status.panesMenu')}
        />
      ) : null}
    </div>
  );
}
