/**
 * Rich annotation / history field (T076, FR-053): a ProseMirror editor over the `annotation`
 * node (`richFieldState.ts`) with the Body view's content model, inline marks and key
 * behaviour, plus a small toolbar offering the six inline styles. The field has no history of
 * its own: every change goes to the Description controller (coalesced per burst) and
 * Edit > Undo / Redo replays it through the `description` view of the undo coordinator, which
 * rebuilds the editor from the restored model. While a script runs (form `readOnly`, feature
 * 003 FR-011) the editor is not editable - selecting and copying keep working, nothing is
 * greyed - and the style buttons are unavailable.
 *
 * Feature 006, US10 (FR-044, FR-045, FR-048, FR-057, FR-059; decision 6; C2, C48; I8, I10, I14,
 * I15; data-model §6.1, §6.3, §8.1, §9.8): the field is a table host.
 *  - **The target**: its adapter (`createFieldTarget`) is registered on mount and removed on
 *    unmount; every applied transaction notifies it, so the menus, the toolbar buttons and the
 *    Table bar follow the field's selection while the focus rule keeps it active.
 *  - **`DISCRETE_STEP`**: a change marked so - a table command run through the adapter, a table
 *    paste, the Tab row, type-over, a cut of a block - is recorded without `coalesce`: one
 *    Description undo entry that also closes the typing burst around it; every other change is
 *    coalesced as typing.
 *  - **The clipboard**: the clipboard plugin with the field's options (the book's ids, the
 *    field's node ids, the status bar), ahead of the non-breaking-space marker as in the Body
 *    view, so every paste takes the Body view's router - a pasted paragraph no longer brings
 *    its language, id or style - and a copied block or table leaves as the Body view's does.
 *  - **The node views**: a picture's box is reserved from the binary list until its preview
 *    loads, and an irregular table carries the warning mark, its texts in the interface
 *    language and its popover's *Repair table* run through the field's adapter.
 * The read-only lock keeps refusing every change, so the commands, the router and the mark's
 * button change nothing under the run lock.
 */

import type { Command, EditorState, Plugin, Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppServices, useCommandContext } from '@/app/services';
import { iconUrl } from '@/app/toolbarDefinitions';
import {
  INLINE_MARKS,
  markActive,
  toggleInlineMark,
  type InlineMarkName,
} from '@/editor/commands/marks';
import { DISCRETE_STEP, M } from '@/editor/commands/util';
import { binaryLookup, createImageNodeViews } from '@/editor/nodeviews/image';
import { createRawXmlNodeViews } from '@/editor/nodeviews/rawXml';
import { createTableNodeViews } from '@/editor/nodeviews/table';
import { clipboardPlugin, type ClipboardOptions } from '@/editor/plugins/clipboard';
import { DEFAULT_NBSP_DISPLAY_CHAR, nbspMarkerPlugin, nbspPluginKey } from '@/editor/plugins/nbsp';
import { describeTableMark } from '@/features/tables/marks';
import { openTableMarkPopover } from '@/features/tables/MarkPopover';
import { createFieldTarget, registerFieldTarget, type FieldTarget } from '@/features/tables/target';
import i18next from '@/i18n';
import type { AnnotationNode } from '@/model/document';
import { collectBookIds } from '@/model/ids';
import { actions, useAppState } from '@/model/store';

import { RequiredMark } from './fields';
import { useDescriptionForm } from './formContext';
import { getAtPath, type FieldKey } from './model';
import { createRichFieldState, richFieldIdGenerator, richFieldModel } from './richFieldState';

const MARK_ICONS: Record<InlineMarkName, string> = {
  strong: 'id_edit_bold',
  emphasis: 'id_edit_italic',
  strikethrough: 'id_edit_strik',
  sub: 'id_edit_sub',
  sup: 'id_edit_sup',
  code: 'id_edit_code',
};

export interface RichFieldProps {
  /** Form path of the AnnotationNode, e.g. `titleInfo.annotation`. */
  fieldKey: FieldKey;
  testId: string;
  label: string;
  required?: boolean;
}

export function RichField({ fieldKey, testId, label, required }: RichFieldProps) {
  const { t } = useTranslation();
  const { controller, form, docId, readOnly } = useDescriptionForm();
  const value = getAtPath(form, fieldKey) as AnnotationNode | undefined;
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lastEmitted = useRef<AnnotationNode | undefined | null>(null);
  const docIdRef = useRef(docId);
  // The editor asks `editable()` on every update; the ref carries the current lock.
  const readOnlyRef = useRef(readOnly);
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  // Annotation and history show the non-breaking-space marker like the Body text (feature 002
  // FR-042).
  const { store } = useAppServices();
  const nbspChar = useAppState(
    (s) => s.settings?.other.nbspDisplayChar ?? DEFAULT_NBSP_DISPLAY_CHAR,
    store,
  );
  const nbspCharRef = useRef(nbspChar);
  // Created with the editor (refs are read only outside render).
  const pluginsRef = useRef<Plugin[]>([]);
  // The field's table edit target (US10), registered while the editor exists.
  const targetRef = useRef<FieldTarget | null>(null);
  // The command context the mark's popover opens with (the services and the current `t`).
  const commandCtx = useCommandContext();
  const commandCtxRef = useRef(commandCtx);

  useEffect(() => {
    docIdRef.current = docId;
  }, [docId]);

  useEffect(() => {
    commandCtxRef.current = commandCtx;
  }, [commandCtx]);

  useEffect(() => {
    nbspCharRef.current = nbspChar;
    const view = viewRef.current;
    if (view) view.dispatch(view.state.tr.setMeta(nbspPluginKey, 'refresh'));
  }, [nbspChar]);

  useEffect(() => {
    readOnlyRef.current = readOnly;
    // Re-evaluates `editable()` (the view re-reads its props on setProps).
    viewRef.current?.setProps({ editable: () => !readOnlyRef.current });
  }, [readOnly]);

  // Mount once; the editor state is rebuilt from the model only when the model changed
  // outside this field (undo / redo / document replaced, or the value the controller adopted
  // from the Body view's annotation / history block - feature 004, FR-011; the effect below).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const nextId = richFieldIdGenerator(fieldKey);
    const initial = getAtPath(controller.currentForm, fieldKey) as AnnotationNode | undefined;
    lastEmitted.current = initial;
    // Every paste of the field through the Body view's router (decision 6; I14).
    const fieldClipboardOptions: ClipboardOptions = {
      bookIds: () => {
        const document = store.getState().document;
        return document ? collectBookIds(document) : new Set<string>();
      },
      nextNodeId: nextId,
      message: (key) => actions.setStatusMessage(store, t(key)),
    };
    pluginsRef.current = [
      clipboardPlugin(fieldClipboardOptions),
      nbspMarkerPlugin(() => nbspCharRef.current),
    ];
    const view = new EditorView(host, {
      state: createRichFieldState(initial, nextId, pluginsRef.current),
      editable: () => !readOnlyRef.current,
      nodeViews: {
        ...createImageNodeViews({
          getDocId: () => docIdRef.current,
          getMissingText: () => t('views.body.imageMissing'),
          // A picture's box is reserved until its preview loads, as in the Body view (R9.2).
          getBinary: binaryLookup(() => store.getState().document?.binaries),
        }),
        ...createRawXmlNodeViews(() => t('editing.unknownElement')),
        // The irregular-table mark (FR-057; data-model §3.3, §3.5): its texts follow the
        // interface language, its popover repairs through the field's target.
        ...createTableNodeViews({
          describe: (summary) => describeTableMark(summary, i18next.t),
          onLanguageChange: (listener) => {
            i18next.on('languageChanged', listener);
            return () => i18next.off('languageChanged', listener);
          },
          onMarkActivate: (info) => {
            const target = targetRef.current;
            if (target) void openTableMarkPopover(commandCtxRef.current, target, info);
          },
        }),
      },
      // No spell plugin here and `spellcheck="false"` for the engine's own checker: the
      // Description view is never checked (feature 004 US9, FR-080 / FR-081) - the annotation
      // and history are checked in the Body view's blocks, the source title info's annotation,
      // edited here only, never.
      attributes: {
        class: 'fb-editor mfbe-desc-rich',
        'data-testid': testId,
        spellcheck: 'false',
      },
      handleDOMEvents: {
        blur: () => {
          controller.closeEntry();
          return false;
        },
      },
      dispatchTransaction: (tr: Transaction) => {
        const current = viewRef.current;
        if (!current) return;
        // The quiet lock refuses every change (selection changes still apply).
        if (tr.docChanged && readOnlyRef.current) return;
        const next = current.state.apply(tr);
        current.updateState(next);
        if (tr.docChanged) {
          const model = richFieldModel(next);
          lastEmitted.current = model;
          // A discrete step (a table command, a table paste, the Tab row; I8, C2) is an undo
          // entry of its own that ends the typing burst; everything else coalesces as typing.
          if (tr.getMeta(DISCRETE_STEP) === true) controller.setValue(fieldKey, model);
          else controller.setValue(fieldKey, model, { coalesce: true });
        }
        setEditorState(next);
        targetRef.current?.notify();
      },
    });
    viewRef.current = view;
    const target = createFieldTarget({
      key: fieldKey,
      view: () => viewRef.current,
      editable: () => !readOnlyRef.current,
      nextNodeId: nextId,
    });
    targetRef.current = target;
    const unregister = registerFieldTarget(target);
    setEditorState(view.state);
    return () => {
      unregister();
      targetRef.current = null;
      view.destroy();
      viewRef.current = null;
      setEditorState(null);
    };
    // `t`, `store` and `controller` are stable for the lifetime of the field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldKey, testId]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || lastEmitted.current === value) return;
    lastEmitted.current = value;
    const state = createRichFieldState(value, richFieldIdGenerator(fieldKey), pluginsRef.current);
    view.updateState(state);
    setEditorState(state);
    targetRef.current?.notify();
  }, [value, fieldKey]);

  const run = useCallback((command: Command) => {
    const view = viewRef.current;
    if (!view) return;
    command(view.state, view.dispatch, view);
    view.focus();
  }, []);

  return (
    <div className="mfbe-desc-richfield" data-testid={`${testId}-field`}>
      <div className="mfbe-desc-rich-head">
        <span className="mfbe-desc-label">
          {label}
          {required ? <RequiredMark /> : null}
        </span>
        <div className="mfbe-desc-rich-toolbar" role="toolbar" aria-label={label}>
          {INLINE_MARKS.map((name) => {
            const active = !!editorState && markActive(editorState, M[name]!);
            return (
              <button
                type="button"
                key={name}
                className={`mfbe-toolbar-button${active ? ' mfbe-toolbar-button-pressed' : ''}`}
                data-testid={`${testId}-mark-${name}`}
                aria-pressed={active}
                title={t(`cmd.style.${name}.tooltip`)}
                disabled={readOnly}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => run(toggleInlineMark(name))}
              >
                <img
                  src={iconUrl(MARK_ICONS[name], 24)}
                  alt=""
                  width={16}
                  height={16}
                  draggable={false}
                />
              </button>
            );
          })}
        </div>
      </div>
      <div ref={hostRef} className="mfbe-desc-rich-host" />
    </div>
  );
}
