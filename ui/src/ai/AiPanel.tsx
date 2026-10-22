/**
 * The AI assistant panel (feature 005 T052; research R8.1; FR-040 to FR-045, FR-093, FR-105;
 * quickstart §0.5, §3): the content of the right-hand pane App.tsx renders while the assistant
 * is on. From top to bottom: the header with the service and model in use (`ai-service` -
 * name · model, the fallback note when the saved free entry disappeared, "answers only" for a
 * model without tools) and the link to the settings page (`ai-settings-link`); the conversation
 * (`ai-message-<n>[data-role]` - the user's instructions, the assistant's final texts, the
 * editor's notices - as plain text with `white-space: pre-wrap`, never HTML or Markdown, no
 * links - review C16; interim words and a cut-off answer are marked); the activity list
 * (`ai-activity`, `ai-activity-<n>[data-kind]`) with one localised line per entry of
 * data-model §5.2, appended live; the status line (`ai-status`) with the phase and the elapsed
 * time while a request runs and the limit countdown (`ai-wait`); the instruction field
 * (`ai-input`: Enter sends, Shift+Enter inserts a newline), Send / Stop in the same place
 * (`ai-send` / `ai-stop`), Clear (`ai-clear`) and Undo (`ai-undo` - the request's undo step
 * while it is the latest entry of the undo coordinator, else disabled with the Edit > Undo
 * hint); the close button (`ai-panel-close`) last in the Tab order, as quickstart §3 lists it.
 *
 * The panel owns no request state of its own: the conversation and the live request are the
 * store's (`store.ai`), written by the request loop (assistant.ts, activity.ts); the popup and
 * the panel share the one request slot (Send becomes Stop while either runs). Closing goes
 * through the feature (`index.ts`), which asks first while a request runs (FR-093). Part of
 * the lazy chunk.
 */

import type { TFunction } from 'i18next';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { getAiFeature } from '@/ai';
import { useCommandContext } from '@/app/services';
import { getSettingsFeature } from '@/features/settings/apply';
import { openSettingsDialog } from '@/features/settings/index';
import {
  actions,
  emptyConversation,
  isRunLocked,
  useAppState,
  type AssistantActivityEntry,
  type AssistantMessage,
} from '@/model/store';
import type { UndoEntry } from '@/model/undo';
import type { RpcClient } from '@/rpc/client';
import { formatElapsed } from '@/scripting/host';

import { clearConversation } from './activity';
import { cancelRequest, startRequest, type AiRequestView } from './assistant';
import { failureText, type Failure } from './protocol';
import { resolveActiveTarget, type ActiveTarget } from './target';

import './ai.css';

/** The panel takes no props: everything comes from the services of the `AppProvider`. */
export type AiPanelProps = Record<string, never>;

/** The header's knowledge of the target: not asked yet, resolved, or nothing usable. */
type TargetState = { kind: 'resolving' } | { kind: 'ok'; target: ActiveTarget } | { kind: 'none' };

/* ------------------------------------------------------------------------ */
/* Activity entries                                                          */
/* ------------------------------------------------------------------------ */

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** `{nodeId?, path?, element?}` or a plain name → the shortest telling form. */
function targetText(target: unknown): string {
  if (typeof target === 'string') return target;
  if (target && typeof target === 'object') {
    const record = target as Record<string, unknown>;
    return asString(record.path) || asString(record.element) || asString(record.nodeId);
  }
  return '';
}

/** The `tool.error` / `change.rejected` strike as "strike k of 3", or an empty string. */
function strikeText(t: TFunction, strike: unknown): string {
  if (!strike || typeof strike !== 'object') return '';
  const record = strike as Record<string, unknown>;
  return t('ai.activity.strike', { count: asNumber(record.count), of: asNumber(record.of) });
}

/**
 * The localised line of one activity entry (data-model §5.2). Every model- or service-supplied
 * member (summaries, messages) is interpolated as data: i18next escapes nothing here because
 * the result is rendered as a text node, never as markup.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the formatter lives with the list it feeds, in the lazy chunk
export function activityText(t: TFunction, entry: AssistantActivityEntry): string {
  const p = entry.payload;
  switch (entry.kind) {
    case 'request.start':
      return t('ai.activity.requestStart', {
        service: asString(p.service),
        model: asString(p.model),
      });
    case 'validate.baseline':
      return t('ai.activity.validateBaseline', { count: asNumber(p.errors) });
    case 'exchange.sent':
      return t('ai.activity.exchangeSent', {
        n: asNumber(p.n),
        messages: asNumber(p.messages),
        tools: asNumber(p.tools),
      });
    case 'exchange.answered': {
      const text = t('ai.activity.exchangeAnswered', {
        n: asNumber(p.n),
        elapsed: formatElapsed(asNumber(p.elapsedMs)),
        count: asNumber(p.toolCalls),
      });
      const limit = p.rateLimit;
      if (limit && typeof limit === 'object') {
        const record = limit as Record<string, unknown>;
        if (record.remaining !== undefined || record.limit !== undefined) {
          return `${text}; ${t('ai.activity.rateLimit', {
            limit: asString(record.limit) || '—',
            remaining: asString(record.remaining) || '—',
            reset: asString(record.resetSeconds) || '—',
          })}`;
        }
      }
      return text;
    }
    case 'limit.wait': {
      const source = asString(p.source);
      const known = source === 'header' || source === 'body' || source === 'message';
      return t('ai.activity.limitWait', {
        seconds: asNumber(p.seconds),
        source: t(`ai.activity.limitSource.${known ? source : 'default'}`),
      });
    }
    case 'history.trimmed':
      return t('ai.activity.historyTrimmed', { count: asNumber(p.turns) });
    case 'split': {
      const what = asString(p.what);
      const whatText =
        what === 'toolResult'
          ? t('ai.activity.splitWhat.toolResult', { tool: asString(p.tool) })
          : what === 'outline'
            ? t('ai.activity.splitWhat.outline')
            : t('ai.activity.splitWhat.selection');
      const base = `${t('ai.activity.split', { part: asNumber(p.part), parts: asNumber(p.parts) })} — ${whatText}`;
      const message = asString(p.message);
      return message ? `${base}: ${message}` : base;
    }
    case 'tool.call':
      return t('ai.activity.toolCall', { summary: asString(p.summary) || asString(p.name) });
    case 'tool.result':
      return t('ai.activity.toolResult', {
        name: asString(p.name),
        summary: asString(p.summary) || asString(p.name),
      });
    case 'tool.error': {
      const text = t('ai.activity.toolError', {
        name: asString(p.name),
        code: asString(p.code),
        message: asString(p.message),
      });
      const strike = strikeText(t, p.strike);
      return strike ? `${text} (${strike})` : text;
    }
    case 'change.try':
      return t('ai.activity.changeTry', { tool: asString(p.tool), target: targetText(p.target) });
    case 'validate': {
      const count = asNumber(p.new);
      return count === 0 ? t('ai.activity.validateOk') : t('ai.activity.validateErrors', { count });
    }
    case 'change.accepted':
      return t('ai.activity.changeAccepted', {
        tool: asString(p.tool),
        target: targetText(p.target),
      });
    case 'change.rejected':
      return t('ai.activity.changeRejected', {
        count: Array.isArray(p.issues) ? p.issues.length : 0,
        strike: strikeText(t, p.strike),
      });
    case 'script.dialog':
      return t('ai.activity.scriptDialog', { name: asString(p.name) || asString(p.id) });
    case 'script.proposed':
      return t('ai.activity.scriptProposed', {
        id: asString(p.id),
        count: Array.isArray(p.files) ? p.files.length : 0,
        outcome: p.written ? t('ai.activity.written') : t('ai.activity.declined'),
      });
    case 'request.done': {
      const exchanges = asNumber(p.exchanges);
      return t('ai.activity.requestDone', {
        count: asNumber(p.changes),
        exchanges: t('ai.activity.exchanges', { count: exchanges }),
        elapsed: formatElapsed(asNumber(p.elapsedMs)),
      });
    }
    case 'request.answered':
      return t('ai.activity.requestAnswered');
    case 'request.askedBack':
      return t('ai.activity.requestAskedBack');
    case 'request.cancelled':
      return t('ai.activity.requestCancelled');
    case 'request.failed': {
      const failure: Failure = {
        kind: (asString(p.kind) || 'internal') as Failure['kind'],
        ...(typeof p.message === 'string' ? { message: p.message } : {}),
      };
      return t('ai.activity.requestFailed', { text: failureText(t, failure) });
    }
    case 'request.rejected':
      return t('ai.activity.requestRejected');
    default:
      return entry.kind;
  }
}

/* ------------------------------------------------------------------------ */
/* The panel                                                                 */
/* ------------------------------------------------------------------------ */

const NO_RPC: Pick<RpcClient, 'call'> = {
  call: () => Promise.reject(new Error('no core')),
} as Pick<RpcClient, 'call'>;

export function AiPanel() {
  const { t } = useTranslation();
  const ctx = useCommandContext();
  const { store, rpc } = ctx;
  const settings = useAppState((s) => s.settings, store);
  const conversation = useAppState((s) => s.ai.conversation, store);
  const live = useAppState((s) => s.ai.request as AiRequestView | null, store);
  const panelFocus = useAppState((s) => s.ai.panelFocus, store);
  const hasDocument = useAppState((s) => s.document !== null, store);
  const locked = useAppState((s) => isRunLocked(s), store);
  const lockKind = useAppState((s) => s.runLock?.kind ?? null, store);

  const [instruction, setInstruction] = useState('');
  const [target, setTarget] = useState<TargetState>({ kind: 'resolving' });
  const [undoEntry, setUndoEntry] = useState<UndoEntry | null>(null);
  /** A failure before the request got as far as the lock (nothing in the conversation says it). */
  const [sendFailure, setSendFailure] = useState<string | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const activityRef = useRef<HTMLOListElement>(null);
  const mountedRef = useRef(true);

  const subscribeUndo = useCallback(
    (listener: () => void) => ctx.undo.subscribe(listener),
    [ctx.undo],
  );
  const latestUndo = useSyncExternalStore(
    subscribeUndo,
    () => ctx.undo.peekUndo(),
    () => ctx.undo.peekUndo(),
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The header: the target of the latest settings snapshot (FR-041; "settings OK, target
  // changed" updates it - the previous one stays shown until the new one is known). The
  // service list is the core's; nothing reaches a service here.
  useEffect(() => {
    let cancelled = false;
    resolveActiveTarget(rpc ?? NO_RPC, settings)
      .then((resolved) => {
        if (cancelled) return;
        setTarget(resolved.ok ? { kind: 'ok', target: resolved.target } : { kind: 'none' });
      })
      .catch(() => {
        if (!cancelled) setTarget({ kind: 'none' });
      });
    return () => {
      cancelled = true;
    };
  }, [rpc, settings]);

  // The popup's "Continue in panel" and the turn-on ask for the focus (`panelFocus`).
  useEffect(() => {
    if (!panelFocus) return;
    inputRef.current?.focus();
    actions.updateAi(store, { panelFocus: false });
  }, [panelFocus, store]);

  // A request ended: when it committed (`request.done`), the latest undo entry is its step -
  // from the panel or the popup alike (US2 scenario 4's panel half).
  useEffect(() => {
    let previous = store.getState().ai.request;
    return store.subscribe((state) => {
      const current = state.ai.request;
      if (previous && !current) {
        const ended = previous;
        const committed = state.ai.conversation.activity.some(
          (entry) => entry.requestId === ended.id && entry.kind === 'request.done',
        );
        if (committed) setUndoEntry(ctx.undo.peekUndo() ?? null);
      }
      previous = current;
    });
  }, [store, ctx.undo]);

  // The newest message and the newest entry stay in view while the request runs.
  useEffect(() => {
    const list = messagesRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [conversation.messages.length]);
  useEffect(() => {
    const list = activityRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [conversation.activity.length]);

  const running = live !== null;
  const sendable = hasDocument && !locked && target.kind === 'ok';
  const trimmed = instruction.trim();
  const empty = conversation.messages.length === 0;
  // Clear, a document change and turn-off empty the conversation: its Undo button goes with it
  // (Edit > Undo still reaches the step).
  const conversationEmpty = empty && conversation.activity.length === 0;
  const requestUndo = conversationEmpty ? null : undoEntry;

  const send = useCallback(async () => {
    const text = instruction.trim();
    if (!text || running || !sendable) return;
    setInstruction('');
    setSendFailure(null);
    const before = store.getState().ai.conversation.messages.length;
    const outcome = await startRequest(ctx, {
      origin: 'panel',
      instruction: text,
      selection: null,
    });
    if (!mountedRef.current) return;
    const after = store.getState().ai.conversation.messages.length;
    if (after === before) {
      // The request never got as far as the lock (no service, a script holding the lock, the
      // notice answered No): the instruction comes back and the reason is shown here.
      setInstruction(text);
      if (outcome.kind === 'failed') setSendFailure(failureText(t, outcome.failure as Failure));
    }
    inputRef.current?.focus();
  }, [ctx, instruction, running, sendable, store, t]);

  const stop = useCallback(() => {
    cancelRequest(store);
  }, [store]);

  const clear = useCallback(() => {
    clearConversation(store);
    setSendFailure(null);
    setUndoEntry(null);
  }, [store]);

  const undoAvailable = requestUndo !== null && latestUndo === requestUndo;
  const undo = useCallback(() => {
    if (!requestUndo || ctx.undo.peekUndo() !== requestUndo) return;
    ctx.undo.undo();
    setUndoEntry(null);
  }, [ctx.undo, requestUndo]);

  const close = useCallback(() => {
    const feature = getAiFeature(store);
    if (feature) {
      void feature.close(ctx);
      return;
    }
    // Without the feature (a bare render): off at once, the conversation discarded (FR-045).
    actions.updateAi(store, {
      on: false,
      request: null,
      catalogue: null,
      conversation: emptyConversation(),
      panelFocus: false,
    });
  }, [ctx, store]);

  const openSettings = useCallback(() => {
    const feature = getSettingsFeature(store);
    if (feature) void openSettingsDialog(ctx, feature, { initialPage: 'ai' });
  }, [ctx, store]);

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    // Enter sends; while a request runs it does nothing (Stop is the one action then).
    event.preventDefault();
    event.stopPropagation();
    void send();
  };

  /* ------------------------------------------------------------ texts */

  let serviceText: string;
  let serviceNote: string | null = null;
  if (target.kind === 'ok') {
    serviceText = t('ai.banner.label', { service: target.target.name, model: target.target.model });
    if (target.target.fallback) serviceNote = t('ai.panel.fallbackNote');
    else if (!target.target.tools) serviceNote = t('dialog.settings.ai.toolsNote');
  } else if (target.kind === 'resolving') {
    serviceText = t('ai.panel.resolving');
  } else {
    serviceText = t('ai.panel.noService');
  }

  let statusText = '';
  let statusState: 'idle' | 'running' | 'failed' = 'idle';
  if (live) {
    statusState = 'running';
    const phase = live.phase || t('ai.phase.preparing');
    statusText = t('ai.panel.status', { phase, elapsed: formatElapsed(live.elapsedMs ?? 0) });
    if (live.part) {
      statusText += ` — ${t('ai.panel.part', { index: live.part.index, count: live.part.count })}`;
    }
  } else if (sendFailure) {
    statusState = 'failed';
    statusText = sendFailure;
  }

  let sendTitle: string | undefined;
  if (!hasDocument) sendTitle = t('ai.panel.noDocument');
  else if (locked && lockKind === 'script') sendTitle = t('ai.failure.busy');
  else if (target.kind === 'none') sendTitle = t('ai.failure.noService');

  const undoTitle = undoAvailable
    ? undefined
    : requestUndo
      ? t('ai.panel.undoHint')
      : t('ai.panel.undoNone');

  return (
    <div className="mfbe-ai" data-testid="ai-panel-content">
      <header className="mfbe-ai-header">
        <div className="mfbe-ai-title">{t('ai.panel.title')}</div>
        <div className="mfbe-ai-service-line">
          <span className="mfbe-ai-service" data-testid="ai-service" title={serviceText}>
            {serviceText}
          </span>
          <button
            type="button"
            className="mfbe-link-button mfbe-ai-settings-link"
            data-testid="ai-settings-link"
            onClick={openSettings}
          >
            {t('ai.panel.settingsLink')}
          </button>
        </div>
        {serviceNote ? (
          <div className="mfbe-ai-service-note" data-testid="ai-service-note">
            {serviceNote}
          </div>
        ) : null}
      </header>

      {/* The two scrollers stay out of the Tab sequence (Chromium makes scrollable boxes
          focusable), so that Tab goes from the settings link straight to the field. */}
      <div
        ref={messagesRef}
        className="mfbe-ai-messages"
        data-testid="ai-messages"
        role="log"
        aria-label={t('ai.panel.title')}
        tabIndex={-1}
      >
        {empty ? (
          <p className="mfbe-ai-empty" data-testid="ai-empty">
            {t('ai.panel.empty')}
          </p>
        ) : null}
        {conversation.messages.map((message, index) => (
          <MessageRow key={message.id} message={message} index={index} t={t} />
        ))}
      </div>

      <section className="mfbe-ai-activity-section" aria-label={t('ai.panel.activityTitle')}>
        <div className="mfbe-ai-activity-caption">
          <span>{t('ai.panel.activityTitle')}</span>
          <span className="mfbe-ai-activity-count">
            {t('ai.panel.activityCount', { count: conversation.activity.length })}
          </span>
        </div>
        <ol ref={activityRef} className="mfbe-ai-activity" data-testid="ai-activity" tabIndex={-1}>
          {conversation.activity.map((entry, index) => (
            <li
              key={`${entry.requestId}-${index}`}
              className="mfbe-ai-activity-entry"
              data-testid={`ai-activity-${index}`}
              data-kind={entry.kind}
              data-request={entry.requestId}
            >
              <span className="mfbe-ai-activity-time">{formatElapsed(entry.elapsedMs)}</span>
              <span className="mfbe-ai-activity-text">{activityText(t, entry)}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="mfbe-ai-composer">
        <div
          className="mfbe-ai-status"
          data-testid="ai-status"
          data-state={statusState}
          aria-live="polite"
        >
          {statusText}
          {live?.countdown !== undefined ? (
            <span className="mfbe-ai-wait" data-testid="ai-wait">
              {' '}
              {t('ai.panel.wait', { seconds: live.countdown })}
            </span>
          ) : null}
        </div>
        <textarea
          ref={inputRef}
          className="mfbe-ai-input"
          data-testid="ai-input"
          rows={3}
          value={instruction}
          placeholder={t('ai.panel.placeholder')}
          aria-label={t('ai.panel.inputLabel')}
          onChange={(event) => {
            setInstruction(event.target.value);
            if (sendFailure) setSendFailure(null);
          }}
          onKeyDown={onInputKeyDown}
        />
        <div className="mfbe-ai-buttons">
          {running ? (
            <button
              type="button"
              className="mfbe-button mfbe-button-default"
              data-testid="ai-stop"
              onClick={stop}
            >
              {t('ai.panel.stop')}
            </button>
          ) : (
            <button
              type="button"
              className="mfbe-button mfbe-button-default"
              data-testid="ai-send"
              disabled={!sendable || trimmed === ''}
              title={sendTitle}
              onClick={() => void send()}
            >
              {t('ai.panel.send')}
            </button>
          )}
          <button
            type="button"
            className="mfbe-button"
            data-testid="ai-clear"
            disabled={empty && conversation.activity.length === 0}
            onClick={clear}
          >
            {t('ai.panel.clear')}
          </button>
          <button
            type="button"
            className="mfbe-button"
            data-testid="ai-undo"
            disabled={!undoAvailable}
            title={undoTitle}
            onClick={undo}
          >
            {t('ai.panel.undo')}
          </button>
        </div>
        {requestUndo && !undoAvailable ? (
          <div className="mfbe-ai-undo-hint" data-testid="ai-undo-hint">
            {t('ai.panel.undoHint')}
          </div>
        ) : null}
      </div>

      {/* Last in the DOM - and in the Tab order of quickstart §3 - shown at the top right. */}
      <button
        type="button"
        className="mfbe-ai-close"
        data-testid="ai-panel-close"
        aria-label={t('ai.panel.close')}
        title={t('ai.panel.close')}
        onClick={close}
      >
        {'\u00D7'}
      </button>
    </div>
  );
}

function MessageRow({
  message,
  index,
  t,
}: {
  message: AssistantMessage;
  index: number;
  t: TFunction;
}) {
  const role =
    message.role === 'user'
      ? t('ai.panel.roleUser')
      : message.role === 'assistant'
        ? t('ai.panel.roleAssistant')
        : t('ai.panel.roleNotice');
  return (
    <div
      className={`mfbe-ai-message mfbe-ai-message-${message.role}`}
      data-testid={`ai-message-${index}`}
      data-role={message.role}
      data-request={message.requestId}
      data-interim={message.interim ? 'true' : undefined}
      data-cutoff={message.cutOff ? 'true' : undefined}
    >
      <div className="mfbe-ai-message-role">{role}</div>
      <div className="mfbe-ai-message-text">{message.text}</div>
      {message.interim ? <div className="mfbe-ai-message-mark">{t('ai.panel.interim')}</div> : null}
      {message.cutOff ? (
        <div className="mfbe-ai-message-mark mfbe-ai-message-cutoff">{t('ai.popup.cutOff')}</div>
      ) : null}
    </div>
  );
}
