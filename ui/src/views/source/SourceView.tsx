/**
 * Source view (T050/T079): React wrapper around the per-store `SourceEditorController`
 * (sourceEditor.ts), a CodeMirror 6 editor over the serialised document (`doc.toXml` with
 * binaries elided). The text is parsed back (`doc.fromXml`) when the user leaves the view, saves
 * or validates (`sync.ts`); a parse error keeps the user here and moves the cursor to the
 * reported line/column. Source-only mode (malformed file opened with `doc.openSource`) shows the
 * raw text until it parses.
 *
 * Settings > View > XML source editor (wrap, syntax highlighting, EOL and white-space marks, line
 * numbers, matched tags, font) are read from the store and applied live, and so is the interface
 * theme (`app/theme.ts`: the editor switches to its dark CodeMirror theme). A small strip above
 * the editor exposes the fold-level commands (`source.collapse<N>` / `source.expand<N>`), which
 * the original only offered as hotkeys.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useAppServices, useCommandContext, useCommandState, useRunCommand } from '@/app/services';
import { currentTheme, subscribeTheme } from '@/app/theme';
import { useAppState } from '@/model/store';

import { parseSourceFont } from './extensions';
import { SourceContextMenu } from './SourceContextMenu';
import { sourceEditorFor, sourceSettingsOf } from './sourceEditor';

import './source.css';

const FOLD_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export function SourceView() {
  const { t } = useTranslation();
  const services = useAppServices();
  const ctx = useCommandContext();
  const runCommand = useRunCommand();
  const { store, undo } = services;
  const document = useAppState((s) => s.document, store);
  const docId = useAppState((s) => s.docId, store);
  const sourceOnly = useAppState((s) => s.sourceOnly, store);
  const parseError = useAppState((s) => s.sourceParseError, store);
  // The quiet lock of a script run (feature 003 FR-011): the controller follows the flag
  // itself (read-only editor); the view only exposes it for styling hooks and tests.
  const scriptRunning = useAppState((s) => s.scriptRunning, store);
  const appSettings = useAppState((s) => s.settings, store);
  const settings = useMemo(() => sourceSettingsOf(appSettings), [appSettings]);
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, currentTheme);
  const [foldLevel, setFoldLevel] = useState(2);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);

  const controller = useMemo(() => sourceEditorFor(store, undo), [store, undo]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const hasDocument = document !== null;

  // The latest command context for the asynchronous loader (declared before the load effect).
  const ctxRef = useRef(ctx);
  useEffect(() => {
    ctxRef.current = ctx;
  });

  useEffect(() => {
    controller.setTranslate((key, params) => t(key, params ?? {}) as string);
  }, [controller, t]);

  useEffect(() => {
    controller.setSettings(settings);
  }, [controller, settings]);

  // Before paint: the editor must not show its light colours for a frame on a dark theme.
  useLayoutEffect(() => {
    controller.setDark(theme === 'dark');
  }, [controller, theme]);

  // Load the text whenever the view is shown for a document.
  useEffect(() => {
    if (!hasDocument) return;
    void controller.load(ctxRef.current);
  }, [controller, hasDocument, docId]);

  // A parse error reported while this view is active: move the cursor there.
  useEffect(() => {
    if (parseError && snapshot.status === 'ready') {
      controller.goTo(parseError.line, parseError.column, { highlight: true });
    }
  }, [controller, parseError, snapshot.status]);

  useEffect(() => () => controller.unmount(), [controller]);

  const mountEditor = useCallback(
    (element: HTMLDivElement | null) => {
      if (element) controller.mount(element);
      else controller.unmount();
    },
    [controller],
  );

  // Settings > View > "Editor font" as CSS variables consumed by source.css.
  const fontStyle = useMemo(() => {
    const font = parseSourceFont(settings.font);
    const style: Record<string, string> = {};
    if (font.family) style['--mfbe-source-font-family'] = font.family;
    if (font.size) style['--mfbe-source-font-size'] = `${font.size}px`;
    return style as CSSProperties;
  }, [settings.font]);

  const foldState = useCommandState(`source.collapse${foldLevel}`);
  const wrongTagState = useCommandState('edit.gotoWrongTag');
  const matchTagState = useCommandState('edit.gotoMatchTag');

  if (!document) {
    return (
      <div
        className="mfbe-view mfbe-view-source"
        id="panel-source"
        role="tabpanel"
        data-testid="panel-source"
      >
        <div className="mfbe-view-placeholder" data-testid="panel-source-empty">
          {t('views.source.empty')}
        </div>
      </div>
    );
  }

  return (
    <div
      className="mfbe-view mfbe-view-source"
      id="panel-source"
      role="tabpanel"
      data-testid="panel-source"
      style={fontStyle}
    >
      <div
        className="mfbe-source-view"
        data-testid="source-view"
        data-status={snapshot.status}
        data-wrap={settings.wrap ? 'true' : 'false'}
        data-line-numbers={settings.lineNumbers ? 'true' : 'false'}
        data-highlight={settings.highlight ? 'true' : 'false'}
        data-show-eol={settings.showEol ? 'true' : 'false'}
        data-show-whitespace={settings.showWhitespace ? 'true' : 'false'}
        data-match-tags={settings.matchTags ? 'true' : 'false'}
        data-theme={theme}
        data-locked={scriptRunning ? 'true' : 'false'}
      >
        <div className="mfbe-source-tools" data-testid="source-tools">
          <label className="mfbe-source-tools-label">
            {t('source.foldLevel')}
            <select
              className="mfbe-source-fold-level"
              data-testid="source-fold-level"
              value={foldLevel}
              onChange={(event) => setFoldLevel(Number(event.target.value))}
            >
              {FOLD_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="mfbe-source-tools-button"
            data-testid="source-fold-collapse"
            title={t('cmd.source.collapse.description', { count: foldLevel })}
            disabled={!foldState.enabled}
            onClick={() => void runCommand(`source.collapse${foldLevel}`)}
          >
            {t('source.collapse')}
          </button>
          <button
            type="button"
            className="mfbe-source-tools-button"
            data-testid="source-fold-expand"
            title={t('cmd.source.expand.description', { count: foldLevel })}
            disabled={!foldState.enabled}
            onClick={() => void runCommand(`source.expand${foldLevel}`)}
          >
            {t('source.expand')}
          </button>
          <span className="mfbe-source-tools-spacer" />
          <button
            type="button"
            className="mfbe-source-tools-button"
            data-testid="source-goto-wrong-tag"
            title={t('cmd.edit.gotoWrongTag.description')}
            disabled={!wrongTagState.enabled}
            onClick={() => void runCommand('edit.gotoWrongTag')}
          >
            {t('cmd.edit.gotoWrongTag.tooltip')}
          </button>
          <button
            type="button"
            className="mfbe-source-tools-button"
            data-testid="source-goto-match-tag"
            title={t('cmd.edit.gotoMatchTag.description')}
            disabled={!matchTagState.enabled}
            onClick={() => void runCommand('edit.gotoMatchTag')}
          >
            {t('cmd.edit.gotoMatchTag.tooltip')}
          </button>
        </div>
        {sourceOnly ? (
          <div className="mfbe-source-notice" data-testid="source-only-notice">
            {t('views.source.sourceOnly')}
          </div>
        ) : null}
        {parseError ? (
          <div
            className="mfbe-source-notice mfbe-source-notice-error"
            data-testid="source-parse-error"
          >
            {t('msg.xmlParseError', {
              where: t('views.source.title'),
              line: parseError.line,
              column: parseError.column,
              message: parseError.message,
            })}
          </div>
        ) : null}
        {snapshot.status === 'failed' ? (
          <div
            className="mfbe-source-notice mfbe-source-notice-error"
            data-testid="source-load-error"
          >
            {t('views.source.loadFailed', { reason: snapshot.loadError ?? '' })}
          </div>
        ) : null}
        <div
          ref={mountEditor}
          className="mfbe-source-editor"
          data-testid="panel-source-document"
          aria-busy={snapshot.status === 'loading'}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenuAt({ x: event.clientX, y: event.clientY });
          }}
        />
      </div>
      {menuAt ? (
        <SourceContextMenu
          controller={controller}
          position={menuAt}
          onClose={() => setMenuAt(null)}
        />
      ) : null}
    </div>
  );
}
