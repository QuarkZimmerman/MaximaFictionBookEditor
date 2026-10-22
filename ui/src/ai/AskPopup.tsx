/**
 * The "Ask AI..." popup of the Body view (feature 005 T047; research R8.2; FR-030, FR-034,
 * FR-105; quickstart §0.5): a modeless `Dialog` anchored near the selection (ProseMirror
 * `coordsAtPos`, kept inside the viewport by the dialog frame), with the instruction field
 * focused - Enter sends, Shift+Enter inserts a newline -, the size of the selection as
 * selected (or "no selection - the paragraph at the caret"), the service and model, and the
 * request's progress and result: the phase with the elapsed time, a limit countdown or "part i
 * of n" while it runs; *Done* with *Undo* after a committed replacement; the answer text (plain
 * text, `pre-wrap`, marked when cut off) with *Continue in panel* after a message; the failure
 * text with a link to the settings page for a key or model problem. Escape closes an idle popup
 * and cancels a running request; an outside click closes an idle or finished popup; the popup
 * and the panel share the one request slot (Send becomes Stop). Part of the lazy chunk.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import type { CommandContext } from '@/app/commands';
import { Dialog, type DialogButton } from '@/dialogs/Dialog';
import type { ModelNodeJson } from '@/editor/fromModel';
import { getSettingsFeature } from '@/features/settings/apply';
import { openSettingsDialog } from '@/features/settings/index';
import { actions, useAppState } from '@/model/store';
import type { UndoEntry } from '@/model/undo';
import type { FragmentNode } from '@/rpc/types';
import { formatElapsed } from '@/scripting/host';
import { getBodyController, hasBodyController } from '@/views/body/bodyEditor';

import {
  activeRequest,
  cancelRequest,
  startRequest,
  type AiRequestView,
  type RequestOutcome,
} from './assistant';
import { selectionSnapshot, type SelectionSnapshot } from './context';
import { failureText, needsSettingsLink, type Failure } from './protocol';
import { resolveActiveTarget } from './target';

import './ai.css';

/** The popup's display state (`dialog-ai-ask-status[data-state]`, quickstart §0.5). */
export type PopupState = 'idle' | 'running' | 'done' | 'answered' | 'failed';

export interface AskPopupProps {
  ctx: CommandContext;
  /** The Body selection when the popup opened; null for a caret. */
  selection: SelectionSnapshot | null;
  /** The service and model that will answer (null while unresolved). */
  service: { name: string; model: string } | null;
  position: { left: number; top: number } | null;
  onClose: () => void;
  /** Lets the opener focus the input of an already open popup (`Mod+K` again). */
  registerFocus?: (focus: () => void) => void;
}

function popupStateOf(outcome: RequestOutcome | null, running: boolean): PopupState {
  if (running) return 'running';
  if (!outcome) return 'idle';
  switch (outcome.kind) {
    case 'committed':
      return 'done';
    case 'answered':
    case 'askedBack':
      return 'answered';
    default:
      return 'failed';
  }
}

export function AskPopup({
  ctx,
  selection,
  service,
  position,
  onClose,
  registerFocus,
}: AskPopupProps) {
  const { t } = useTranslation();
  const { store } = ctx;
  const [instruction, setInstruction] = useState('');
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<RequestOutcome | null>(null);
  const [undoEntry, setUndoEntry] = useState<UndoEntry | null>(null);
  const subscribeUndo = useCallback(
    (listener: () => void) => ctx.undo.subscribe(listener),
    [ctx.undo],
  );
  const latestUndo = useSyncExternalStore(
    subscribeUndo,
    () => ctx.undo.peekUndo(),
    () => ctx.undo.peekUndo(),
  );
  const live = useAppState((s) => s.ai.request as AiRequestView | null, store);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const closedRef = useRef(false);
  const runningRef = useRef(false);
  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  const state = popupStateOf(outcome, running);
  const mine = live && live.origin === 'popup' ? live : null;

  useEffect(() => {
    registerFocus?.(() => inputRef.current?.focus());
  }, [registerFocus]);

  // An outside click closes an idle or finished popup (FR-034), never a running one.
  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const root = rootRef.current?.closest('.mfbe-dialog');
      if (!root || root.contains(event.target as Node)) return;
      if (runningRef.current) return;
      onClose();
    };
    document.addEventListener('mousedown', onPointerDown, true);
    return () => document.removeEventListener('mousedown', onPointerDown, true);
  }, [onClose]);

  useLayoutEffect(
    () => () => {
      closedRef.current = true;
    },
    [],
  );

  const send = useCallback(async () => {
    const text = instruction.trim();
    if (!text || runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setOutcome(null);
    const result = await startRequest(ctx, { origin: 'popup', instruction: text, selection });
    runningRef.current = false;
    if (closedRef.current) return;
    setRunning(false);
    setOutcome(result);
    if (result.kind === 'committed') setUndoEntry(ctx.undo.peekUndo() ?? null);
    // The focus back in the popup, so that Escape and Tab keep working after the answer.
    inputRef.current?.focus();
  }, [ctx, instruction, selection]);

  const stop = useCallback(() => {
    cancelRequest(store);
  }, [store]);

  // Escape / Cancel: a running request is cancelled (FR-034) and the popup closes.
  const cancel = useCallback(() => {
    if (runningRef.current) cancelRequest(store);
    onClose();
  }, [onClose, store]);

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      void send();
    }
  };

  const undo = () => {
    if (!undoEntry || ctx.undo.peekUndo() !== undoEntry) return;
    ctx.undo.undo();
    setUndoEntry(null);
    onClose();
  };

  const continueInPanel = () => {
    actions.updateAi(store, { panelFocus: true });
    onClose();
  };

  const openSettings = () => {
    const feature = getSettingsFeature(store);
    onClose();
    if (feature) void openSettingsDialog(ctx, feature, { initialPage: 'ai' });
  };

  // Undo is the coordinator's while the request's step is the latest entry (Edge cases).
  const undoAvailable = undoEntry !== null && latestUndo === undoEntry;

  const buttons: DialogButton[] = [
    {
      id: 'send',
      label: running ? t('ai.popup.stop') : t('ai.popup.send'),
      onClick: () => (running ? stop() : void send()),
      disabled: !running && (instruction.trim() === '' || state === 'done'),
    },
    { id: 'cancel', label: t('dialog.buttons.cancel'), onClick: cancel },
  ];

  const selectionText = selection
    ? t('ai.popup.selectionSize', {
        count: selection.paragraphs,
        characters: selection.characters,
      })
    : t('ai.popup.noSelection');
  const serviceText = service
    ? t('ai.banner.label', { service: service.name, model: service.model })
    : t('ai.popup.noService');

  let statusText = '';
  if (state === 'running') {
    const phase = mine?.phase ?? t('ai.phase.preparing');
    const elapsed = formatElapsed(mine?.elapsedMs ?? 0);
    const part = mine?.part
      ? ` — ${t('ai.popup.part', { index: mine.part.index, count: mine.part.count })}`
      : '';
    statusText = `${phase} — ${elapsed}${part}`;
  } else if (outcome) {
    switch (outcome.kind) {
      case 'committed':
        statusText = t('ai.popup.done');
        break;
      case 'answered':
      case 'askedBack':
        statusText = t('ai.popup.answered');
        break;
      case 'cancelled':
        statusText = t('ai.end.cancelled');
        break;
      case 'failed':
        statusText = failureText(t, outcome.failure as Failure);
        break;
      default:
        statusText = t('ai.end.rejected');
        break;
    }
  }
  const answer =
    outcome &&
    (outcome.kind === 'answered' || outcome.kind === 'askedBack' || outcome.kind === 'committed')
      ? (outcome.text ?? '')
      : '';
  const cutOff = outcome !== null && 'cutOff' in outcome && outcome.cutOff === true;
  const settingsLink = outcome?.kind === 'failed' && needsSettingsLink(outcome.failure as Failure);

  return (
    <Dialog
      title={t('ai.popup.title')}
      buttons={buttons}
      defaultButtonId="send"
      cancelButtonId="cancel"
      initialFocus="textarea"
      testId="dialog-ai-ask"
      className="mfbe-ai-ask"
      closeLabel={t('dialog.buttons.close')}
      modeless
      {...(position ? { position } : {})}
    >
      <div ref={rootRef} className="mfbe-ai-ask-body">
        <textarea
          ref={inputRef}
          className="mfbe-ai-ask-input"
          data-testid="dialog-ai-ask-input"
          rows={3}
          value={instruction}
          placeholder={selection ? t('ai.popup.placeholderSelection') : t('ai.popup.placeholder')}
          readOnly={running || state === 'done'}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={onInputKeyDown}
          aria-label={t('ai.popup.title')}
        />
        <div className="mfbe-ai-ask-meta">
          <span data-testid="dialog-ai-ask-selection">{selectionText}</span>
          <span data-testid="dialog-ai-ask-service">{serviceText}</span>
        </div>
        <div
          className="mfbe-ai-ask-status"
          data-testid="dialog-ai-ask-status"
          data-state={state}
          aria-live="polite"
        >
          {statusText}
        </div>
        {answer !== '' ? (
          <div className="mfbe-ai-ask-answer" data-testid="dialog-ai-ask-answer">
            {answer}
            {cutOff ? <div className="mfbe-ai-ask-cutoff">{t('ai.popup.cutOff')}</div> : null}
          </div>
        ) : null}
        {state === 'done' || state === 'answered' ? (
          <div className="mfbe-ai-ask-actions">
            {state === 'done' ? (
              <button
                type="button"
                className="mfbe-button"
                data-testid="dialog-ai-ask-undo"
                disabled={!undoAvailable}
                title={undoAvailable ? undefined : t('ai.popup.undoHint')}
                onClick={undo}
              >
                {t('ai.popup.undo')}
              </button>
            ) : null}
            <button
              type="button"
              className="mfbe-button"
              data-testid="dialog-ai-ask-continue"
              onClick={continueInPanel}
            >
              {t('ai.popup.continue')}
            </button>
          </div>
        ) : null}
        {settingsLink ? (
          <div className="mfbe-ai-ask-actions">
            <button
              type="button"
              className="mfbe-link-button"
              data-testid="dialog-ai-ask-settings-link"
              onClick={openSettings}
            >
              {t('ai.popup.settingsLink')}
            </button>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------ */
/* Opening                                                                   */
/* ------------------------------------------------------------------------ */

let openFocus: (() => void) | null = null;

/**
 * Opens the popup for the Body view's current selection (`ai.ask`, the context menu, `Mod+K`):
 * the snapshot is taken now (the size shown is the size as selected - FR-030), the dialog is
 * anchored below the end of the selection. A popup already open takes the focus instead.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the opener lives with its dialog in the lazy chunk
export async function openAskPopup(ctx: CommandContext): Promise<void> {
  const { store } = ctx;
  if (openFocus) {
    openFocus();
    return;
  }
  const state = store.getState();
  if (!state.ai.on || !state.document || !state.docId || !ctx.rpc) return;
  if (state.activeView !== 'body' || !hasBodyController(store)) return;
  const controller = getBodyController(store);
  const editorState = controller.editorState;
  if (!editorState) return;
  const docId = state.docId;
  const rpc = ctx.rpc;
  const toXml = async (nodes: ModelNodeJson[]) => {
    const { xml } = await rpc.call('doc.fragmentToXml', {
      docId,
      nodes: nodes as unknown as FragmentNode[],
    });
    return xml;
  };
  let selection: SelectionSnapshot | null = null;
  try {
    selection = await selectionSnapshot(editorState, controller.currentWindow, toXml);
  } catch {
    selection = null;
  }
  let service: { name: string; model: string } | null = null;
  try {
    const resolved = await resolveActiveTarget(rpc, store.getState().settings);
    if (resolved.ok) service = { name: resolved.target.name, model: resolved.target.model };
  } catch {
    service = null;
  }
  // Anchored below the end of the selection (the caret), as the context menu is at the pointer.
  let position: { left: number; top: number } | null = null;
  const view = controller.editorView;
  if (view) {
    try {
      const coords = view.coordsAtPos(editorState.selection.to);
      position = { left: Math.max(0, coords.left), top: Math.max(0, coords.bottom + 6) };
    } catch {
      position = null;
    }
  }
  if (activeRequest()) return; // the one request slot is taken (the panel's request runs)
  let focus: (() => void) | null = null;
  openFocus = () => focus?.();
  try {
    await ctx.dialogs.openCustom<void>(
      (close) => (
        <AskPopup
          ctx={ctx}
          selection={selection}
          service={service}
          position={position}
          onClose={() => close()}
          registerFocus={(f) => {
            focus = f;
          }}
        />
      ),
      { modeless: true },
    );
  } finally {
    openFocus = null;
  }
}
