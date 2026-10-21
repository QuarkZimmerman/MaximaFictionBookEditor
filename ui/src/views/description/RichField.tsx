/**
 * Rich annotation / history field (T076, FR-053): a ProseMirror editor over the `annotation`
 * node (`richFieldState.ts`) with the Body view's content model, inline marks and key
 * behaviour, plus a small toolbar offering the six inline styles. The field has no history of
 * its own: every change goes to the Description controller (coalesced per burst) and
 * Edit > Undo / Redo replays it through the `description` view of the undo coordinator, which
 * rebuilds the editor from the restored model. While a script runs (form `readOnly`, feature
 * 003 FR-011) the editor is not editable - selecting and copying keep working, nothing is
 * greyed - and the style buttons are unavailable.
 */

import type { Command, EditorState, Plugin, Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppServices } from '@/app/services';
import { iconUrl } from '@/app/toolbarDefinitions';
import {
  INLINE_MARKS,
  markActive,
  toggleInlineMark,
  type InlineMarkName,
} from '@/editor/commands/marks';
import { M } from '@/editor/commands/util';
import { createImageNodeViews } from '@/editor/nodeviews/image';
import { createRawXmlNodeViews } from '@/editor/nodeviews/rawXml';
import { createTableNodeViews } from '@/editor/nodeviews/table';
import { DEFAULT_NBSP_DISPLAY_CHAR, nbspMarkerPlugin, nbspPluginKey } from '@/editor/plugins/nbsp';
import type { AnnotationNode } from '@/model/document';
import { useAppState } from '@/model/store';

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

  useEffect(() => {
    docIdRef.current = docId;
  }, [docId]);

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
    pluginsRef.current = [nbspMarkerPlugin(() => nbspCharRef.current)];
    const view = new EditorView(host, {
      state: createRichFieldState(initial, nextId, pluginsRef.current),
      editable: () => !readOnlyRef.current,
      nodeViews: {
        ...createImageNodeViews({
          getDocId: () => docIdRef.current,
          getMissingText: () => t('views.body.imageMissing'),
        }),
        ...createRawXmlNodeViews(() => t('editing.unknownElement')),
        ...createTableNodeViews(),
      },
      attributes: { class: 'fb-editor mfbe-desc-rich', 'data-testid': testId },
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
          controller.setValue(fieldKey, model, { coalesce: true });
        }
        setEditorState(next);
      },
    });
    viewRef.current = view;
    setEditorState(view.state);
    return () => {
      view.destroy();
      viewRef.current = null;
      setEditorState(null);
    };
    // `t` and `controller` are stable for the lifetime of the field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldKey, testId]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || lastEmitted.current === value) return;
    lastEmitted.current = value;
    const state = createRichFieldState(value, richFieldIdGenerator(fieldKey), pluginsRef.current);
    view.updateState(state);
    setEditorState(state);
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
