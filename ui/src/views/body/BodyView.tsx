/**
 * Body view (T049/T057): React wrapper around the persistent `BodyEditorController`
 * (bodyEditor.ts) - an editable ProseMirror editor over a window of top-level sections of the
 * active body. Renders the "... N more sections" placeholders, the body selector of large
 * multi-body books, the Source-only notice, the conversion report and the context menu
 * (ContextMenu.tsx). The controller itself is created by the editing feature and survives view
 * switches; this component only mounts/unmounts its DOM.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppServices } from '@/app/services';
import { fastModeClassName } from '@/editor/fastMode';
import { DEFAULT_NBSP_DISPLAY_CHAR } from '@/editor/plugins/nbsp';
import { getSymbolsFeature } from '@/features/editing';
import { useAppState } from '@/model/store';

import { getBodyController } from './bodyEditor';
import { ContextMenu } from './ContextMenu';
import {
  contextMenuClick,
  contextMenuExtensions,
  type ContextMenuClick,
} from './contextMenuExtensions';

import '@/editor/styles.css';

export interface BodyViewProps {
  /** Read-only mode (the view is editable by default since US2). */
  editable?: boolean;
}

export function BodyView({ editable = true }: BodyViewProps) {
  const { t } = useTranslation();
  const { store, undo, rpc } = useAppServices();
  const model = useAppState((s) => s.document, store);
  const docId = useAppState((s) => s.docId, store);
  const sourceOnly = useAppState((s) => s.sourceOnly, store);
  const fastMode = useAppState((s) => s.fastMode, store);
  const connection = useAppState((s) => s.connection, store);
  const nbspChar = useAppState(
    (s) => s.settings?.other.nbspDisplayChar ?? DEFAULT_NBSP_DISPLAY_CHAR,
    store,
  );

  const [controller] = useState(() => getBodyController(store, undo, { editable }));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const selection = useSyncExternalStore(controller.subscribeContext, controller.getContext);
  const [menu, setMenu] = useState<ContextMenuClick | null>(null);

  useEffect(() => {
    controller.setNbspChar(nbspChar);
  }, [controller, nbspChar]);

  useEffect(() => {
    controller.setTranslate((key) => t(key));
  }, [controller, t]);

  useEffect(() => {
    controller.setEditable(editable && !sourceOnly);
  }, [controller, editable, sourceOnly]);

  // The feature keeps the controller in sync with the store; this covers tests that render
  // the view with a model already present before the subscription ran.
  useEffect(() => {
    controller.setModel(model, docId);
  }, [controller, model, docId]);

  // Symbols (`resources.symbols`) once the core is connected.
  useEffect(() => {
    if (!rpc || connection !== 'connected') return;
    void getSymbolsFeature(store)?.load(rpc);
  }, [rpc, connection, store]);

  const mountEditor = useCallback(
    (element: HTMLDivElement | null) => {
      if (element) controller.mount(element);
      else controller.unmount();
    },
    [controller],
  );

  const closeMenu = useCallback(() => setMenu(null), []);

  if (!model || !snapshot.hasDocument) {
    return (
      <div
        className="mfbe-view mfbe-view-body"
        id="panel-body"
        role="tabpanel"
        data-testid="panel-body"
      >
        <div className="mfbe-view-placeholder" data-testid="panel-body-empty">
          {t('views.body.empty')}
        </div>
      </div>
    );
  }

  const showSelector = !snapshot.wholeBook && snapshot.bodyCount > 1;

  return (
    <div
      className="mfbe-view mfbe-view-body"
      id="panel-body"
      role="tabpanel"
      data-testid="panel-body"
    >
      <div
        className={`mfbe-body-view${fastModeClassName(fastMode)}`}
        data-testid="body-view"
        data-fast-mode={fastMode ? 'true' : undefined}
        data-whole-book={snapshot.wholeBook ? 'true' : 'false'}
        data-body-index={snapshot.bodyIndex}
        data-doc-id={docId ?? undefined}
        data-selected-text={selection.selectedText}
        onContextMenu={(event) => {
          if (!controller.isEditable) return;
          event.preventDefault();
          // The right-click rule of the tables feature first (C28), then the menu at the click.
          const click = contextMenuClick(controller, event.clientX, event.clientY);
          const before = controller.editorState?.selection;
          contextMenuExtensions.prepare?.(controller, click);
          if (controller.editorState?.selection === before) {
            setMenu(click);
            return;
          }
          // The rule moved the caret (a cell of another table, say), and the panes that follow
          // the caret scroll to it - the document tree to its row. The menu closes on any
          // scroll (U13), and the browser delivers a scroll's event in the next frame: the menu
          // opens the frame after, once those scrolls are delivered.
          requestAnimationFrame(() => requestAnimationFrame(() => setMenu(click)));
        }}
      >
        {sourceOnly ? (
          <div className="mfbe-body-notice" data-testid="body-source-only">
            {t('views.body.sourceOnly')}
          </div>
        ) : null}
        {showSelector ? (
          <div className="mfbe-body-selector" role="tablist" data-testid="body-selector">
            {snapshot.bodyNames.map((name, index) => (
              <button
                key={index}
                type="button"
                role="tab"
                aria-selected={index === snapshot.bodyIndex}
                className={`mfbe-body-tab${index === snapshot.bodyIndex ? ' mfbe-body-tab-active' : ''}`}
                data-testid={`body-tab-${index}`}
                onClick={() => controller.selectBody(index)}
              >
                {name || t('views.body.bodyNumber', { number: index + 1 })}
              </button>
            ))}
          </div>
        ) : null}
        {snapshot.before > 0 ? (
          <button
            type="button"
            className="mfbe-body-more"
            data-testid="body-window-before"
            onClick={() => controller.extend('before')}
          >
            {t('views.body.moreSections', { count: snapshot.before })}
          </button>
        ) : null}
        <div
          ref={mountEditor}
          className="mfbe-body-editor"
          data-testid="panel-body-document"
          data-section-start={snapshot.start}
          data-section-count={snapshot.count}
          data-section-total={snapshot.totalSections}
        />
        {snapshot.after > 0 ? (
          <button
            type="button"
            className="mfbe-body-more"
            data-testid="body-window-after"
            onClick={() => controller.extend('after')}
          >
            {t('views.body.moreSections', { count: snapshot.after })}
          </button>
        ) : null}
        {snapshot.problems.length > 0 ? (
          <div
            className="mfbe-body-notice mfbe-body-notice-warning"
            data-testid="body-conversion-report"
            title={snapshot.problems.join('\n')}
          >
            {t('views.body.conversionProblems', { count: snapshot.problems.length })}
          </div>
        ) : null}
      </div>
      {menu ? <ContextMenu controller={controller} click={menu} onClose={closeMenu} /> : null}
    </div>
  );
}
