/**
 * Run session (feature 005 T026; research R4.2-R4.3; data-model §4.1, §6.4-§6.6): the part of
 * a run's lifecycle a script run (host.ts) and an AI assistant request (ai/assistant.ts) share.
 * A session remembers the document before the run and its `modified` flag, takes the run lock
 * (`store.runLock` with the holder's kind, label and current `phase` - the banner's text),
 * ticks the elapsed time, watches for the document being replaced from outside (opened,
 * reloaded, closed - the owner then cancels) and ends in one of two ways: `commit(after)`
 * shows the result and records it as **one** undo entry holding the document before and after
 * (nothing when the run changed nothing), `discard()` restores the document before the run and
 * its `modified` flag (Cancel, a failure, a rejected request). Either end releases the lock.
 *
 * One session at a time per application store: `startRunSession` refuses while another holds
 * the lock, so a script cannot start during an AI request and vice versa (FR-022). The banner's
 * and the run bar's Cancel reach the holder through `cancelActiveRun(store)` → `onCancel`.
 */

import type { Document } from '@/model/document';
import { actions, type AppStore, type RunKind, type RunLock } from '@/model/store';
import type { UndoCoordinator } from '@/model/undo';
import type { BodyEditorController } from '@/views/body/bodyEditor';

/** Undo view of a run's snapshot entry: undoing it shows the Body view. */
export const RUN_UNDO_VIEW = 'body';

/** The elapsed time is refreshed this often (FR-010: at least every second). */
export const DEFAULT_TICK_MS = 1_000;

export interface RunSessionDeps {
  store: AppStore;
  undo: UndoCoordinator;
  /** The Body controller showing the document (null without one: the store alone is updated). */
  getController: () => BodyEditorController | null;
  /** Interval of the elapsed-time ticks (default 1 s; tests shorten it). */
  tickMs?: number;
}

export interface RunSessionOptions {
  kind: RunKind;
  /** The lock's label, shown by the run banner: the script's name, or `<service name> · <model>`. */
  label: string;
  /** Label of the undo entry the commit records (default: `label`). */
  undoLabel?: string;
  /** The current operation at the start (the banner's `ai-banner-operation`); `setPhase` later. */
  phase?: string;
  /**
   * Cancel was asked - from the banner, the run bar or the exit flow: the owner stops its work
   * and ends the session with `discard()`.
   */
  onCancel?: () => void;
  /** The session's document was replaced from outside: the owner cancels (the run leaves the new document alone). */
  onDocumentReplaced?: () => void;
  /** One elapsed-time tick (the owner mirrors it into its own state). */
  onTick?: (elapsedMs: number) => void;
}

/** How a session ended. */
export type RunSessionOutcome =
  /** `commit(after)`: the result shown, one undo entry recorded. */
  | 'committed'
  /** `commit(null)`: the run changed nothing - nothing shown, no undo entry, `modified` untouched. */
  | 'unchanged'
  /** `discard()`: the document before the run restored (when it had been shown). */
  | 'discarded'
  /** The document was replaced meanwhile: the session left the new document alone. */
  | 'lost';

export class RunSession {
  readonly kind: RunKind;
  readonly label: string;
  readonly undoLabel: string;
  readonly startedAt: number;
  /** The document before the run - the undo entry's `undo` state, restored by `discard()`. */
  readonly before: Document;
  readonly modifiedBefore: boolean;
  private readonly deps: RunSessionDeps;
  private readonly options: RunSessionOptions;
  private phaseValue: string | undefined;
  private elapsed = 0;
  private outcomeValue: RunSessionOutcome | null = null;
  private cancelRequestedValue = false;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private unwatch: () => void = () => {};
  private readonly listeners = new Set<() => void>();

  /** Use `startRunSession`: a session exists only while it holds the lock. */
  private constructor(
    deps: RunSessionDeps,
    options: RunSessionOptions,
    before: Document,
    modifiedBefore: boolean,
  ) {
    this.deps = deps;
    this.options = options;
    this.kind = options.kind;
    this.label = options.label;
    this.undoLabel = options.undoLabel ?? options.label;
    this.phaseValue = options.phase;
    this.startedAt = Date.now();
    this.before = before;
    this.modifiedBefore = modifiedBefore;
  }

  /** @internal `startRunSession`: registered as the store's session before the lock is taken. */
  static begin(
    deps: RunSessionDeps,
    options: RunSessionOptions,
    before: Document,
    modifiedBefore: boolean,
  ): RunSession {
    const session = new RunSession(deps, options, before, modifiedBefore);
    sessions.set(deps.store, session);
    session.start();
    return session;
  }

  /** The current operation (the banner's text). */
  get phase(): string | undefined {
    return this.phaseValue;
  }

  /** Time since the start, refreshed on every tick; the duration once the session ended. */
  get elapsedMs(): number {
    return this.elapsed;
  }

  get ended(): boolean {
    return this.outcomeValue !== null;
  }

  /** How the session ended; null while it runs. */
  get outcome(): RunSessionOutcome | null {
    return this.outcomeValue;
  }

  /** `cancel()` was called (the owner is ending the session). */
  get cancelRequested(): boolean {
    return this.cancelRequestedValue;
  }

  /** True while the store still holds the document the session started on. */
  get own(): boolean {
    const state = this.deps.store.getState();
    return state.docId === this.before.docId && state.document !== null;
  }

  /** The lock as the session holds it (null once ended). */
  get lock(): RunLock | null {
    if (this.ended) return null;
    return {
      kind: this.kind,
      label: this.label,
      startedAt: this.startedAt,
      ...(this.phaseValue === undefined ? {} : { phase: this.phaseValue }),
    };
  }

  /** Changes the current operation; the lock in the store follows (a new object). */
  setPhase(phase: string | undefined): void {
    if (this.ended || this.phaseValue === phase) return;
    this.phaseValue = phase;
    actions.setRunLock(this.deps.store, this.lock);
    this.emit();
  }

  /**
   * Asks the owner to stop (the banner's Cancel): `onCancel` runs once; the owner ends the
   * session with `discard()` when its work has stopped.
   */
  cancel(): void {
    if (this.ended || this.cancelRequestedValue) return;
    this.cancelRequestedValue = true;
    this.emit();
    this.options.onCancel?.();
  }

  /**
   * Ends the session with the run's result: `after` is shown and recorded as one undo entry
   * (`undo` shows the document before the run, `redo` the result); null - the run changed
   * nothing - publishes nothing and records nothing. A document replaced meanwhile is left
   * alone (`lost`).
   */
  commit(after: Document | null): RunSessionOutcome {
    if (this.outcomeValue) return this.outcomeValue;
    if (!this.own) return this.end('lost');
    if (!after) return this.end('unchanged');
    this.show(after);
    const before = this.before;
    this.deps.undo.recordSnapshot(RUN_UNDO_VIEW, this.undoLabel, {
      undo: () => this.show(before),
      redo: () => this.show(after),
    });
    return this.end('committed');
  }

  /**
   * Ends the session without a result (Cancel, a failure): when the run had shown an
   * intermediate state, the document before the run is shown again and its `modified` flag
   * restored; nothing to undo. A document replaced meanwhile is left alone (`lost`).
   */
  discard(): RunSessionOutcome {
    if (this.outcomeValue) return this.outcomeValue;
    if (!this.own) return this.end('lost');
    const { store } = this.deps;
    if (store.getState().document !== this.before) {
      this.show(this.before);
      actions.setModified(store, this.modifiedBefore);
    }
    return this.end('discarded');
  }

  /** Notified on every tick, phase change, cancel request and at the end. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /* ------------------------------------------------------------ internals */

  private start(): void {
    const { store } = this.deps;
    actions.setRunLock(store, this.lock);
    let reported = false;
    this.unwatch = store.subscribe((state) => {
      // Reported once (a notification may nest another: the Body controller follows the new
      // document with store changes of its own), after the store's notifications have gone round.
      if (reported || state.docId === this.before.docId) return;
      reported = true;
      queueMicrotask(() => {
        if (!this.ended) this.options.onDocumentReplaced?.();
      });
    });
    this.ticker = setInterval(() => this.tick(), this.deps.tickMs ?? DEFAULT_TICK_MS);
  }

  private tick(): void {
    if (this.ended) return;
    this.elapsed = Date.now() - this.startedAt;
    this.options.onTick?.(this.elapsed);
    this.emit();
  }

  private end(outcome: RunSessionOutcome): RunSessionOutcome {
    this.outcomeValue = outcome;
    this.elapsed = Date.now() - this.startedAt;
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
    this.unwatch();
    this.unwatch = () => {};
    if (sessions.get(this.deps.store) === this) sessions.delete(this.deps.store);
    actions.setRunLock(this.deps.store, null);
    this.emit();
    return outcome;
  }

  /** Shows `document` in the editor (and the store). */
  private show(document: Document): void {
    const controller = this.deps.getController();
    if (controller) controller.showModel(document);
    else actions.updateDocument(this.deps.store, document);
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

const sessions = new WeakMap<AppStore, RunSession>();

/**
 * Starts a session on the store's document and takes the run lock. Null when there is no
 * document or another run - a script or an AI request - holds the lock (the caller reports
 * "busy").
 */
export function startRunSession(
  deps: RunSessionDeps,
  options: RunSessionOptions,
): RunSession | null {
  const state = deps.store.getState();
  if (!state.document || state.runLock || sessions.has(deps.store)) return null;
  return RunSession.begin(deps, options, state.document, state.modified);
}

/** The session holding the store's run lock, or null. */
export function activeRunSession(store: AppStore): RunSession | null {
  return sessions.get(store) ?? null;
}

/** Cancel from the banner, the run bar or the exit flow: reaches whoever holds the lock. */
export function cancelActiveRun(store: AppStore): void {
  activeRunSession(store)?.cancel();
}
