/**
 * Script host (T102): the run lifecycle on the editor side. One worker per run, created by the
 * injected factory and bound to the host through a private MessageChannel. A run works on a
 * working copy of the document (api-impl.ts) while the document is locked for the user - the
 * run session (runSession.ts) holds `store.runLock` of kind `script` with the script's name;
 * at the end the session replaces the document by the result, kept as one undo entry holding
 * the document before the run. Cancel terminates the worker, closes the script's open dialogs
 * and restores the document; a failure restores it too and is reported as
 * `Script error: <message> at line L, column C`, logged through `log.error`. A run whose
 * document is replaced (opened, reloaded or closed from outside) ends as cancelled and leaves
 * the new document alone. After 30 s without activity the run is marked silent (the run bar
 * says so). "Last script" memory: `scripts.lastRun`.
 *
 * Feature 003 (FR-010, FR-014): the run state carries the elapsed time (a tick every second,
 * shown by the run banner), whether the script waits in one of its own dialogs (`waiting`: the
 * busy cursor is shown only while it computes) and, at the end, the run's duration; a finished
 * run is announced as "finished in N s" - in the status bar and, for a run longer than 5 s, by
 * a transient notice in the work area.
 *
 * Feature 005 (FR-080, data-model §6.6, review C10): a run **nested** in an AI request
 * (`run(script, options, {nested: {workingCopy, session}})`) starts from the request's working
 * copy (released), takes no lock and shows no banner of its own (the request holds the lock),
 * records no undo entry and no `scripts.lastRun`, publishes nothing (its dialogs and selection
 * calls show no intermediate state), captions its dialogs "<script name> — run by the AI
 * assistant", restores the `modified` flag at its end and hands its result document back in
 * `RunResult.document`; a nested run cancelled from the banner cancels the whole request (the
 * outer session's `cancel()`), a failed one returns the error to the caller and leaves the
 * request running.
 */

import type { TFunction } from 'i18next';

import { showTransientNotice } from '@/app/transientNotices';
import type { Dialogs } from '@/dialogs/types';
import type { Document } from '@/model/document';
import { actions, type AppStore } from '@/model/store';
import type { UndoCoordinator } from '@/model/undo';
import type { RpcClient } from '@/rpc/client';
import type { JobProgress } from '@/rpc/types';
import type { BodyEditorController } from '@/views/body/bodyEditor';

import {
  createScriptApi,
  JsonText,
  SCRIPT_PROGRESS_JOB,
  ScriptApiError,
  type ScriptApi,
} from './api-impl';
import { DEFAULT_TICK_MS, startRunSession, type RunSession } from './runSession';
import type {
  HostMessage,
  InitMessage,
  NodeRef,
  RunEnd,
  ScriptErrorInfo,
  ScriptInfo,
  ScriptSourceResult,
  WorkerMessage,
} from './types';
import type { WorkingCopy } from './workingCopy';

export { DEFAULT_TICK_MS } from './runSession';

export type RunStatus = 'running' | 'done' | 'cancelled' | 'failed';

export interface RunState {
  scriptId: string;
  name: string;
  status: RunStatus;
  startedAt: number;
  /** Time since the start, refreshed once a second while the run is in progress. */
  elapsedMs: number;
  /** The script waits for the user in one of its own dialogs (message, prompt, form). */
  waiting: boolean;
  /** Length of the run; set when it ends. */
  durationMs?: number;
  error?: ScriptErrorInfo;
  /** The running script has shown no activity for the watchdog delay (30 s). */
  silent?: boolean;
  /** The run is nested in an AI request (no lock, banner or undo entry of its own). */
  nested?: boolean;
}

export interface RunResult {
  status: RunStatus | 'busy' | 'unavailable';
  error?: ScriptErrorInfo;
  /** The user-facing text of a failure (also shown in the error dialog of a user-started run). */
  message?: string;
  /**
   * Nested run, `done`: the document the script produced - the caller's working copy takes it
   * over (`reset`); null when the script changed nothing. Absent for user-started runs (the
   * session published the result) and for the other ends.
   */
  document?: Document | null;
}

/** A minimal worker surface so tests can inject a fake. */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onerror: ((event: ErrorEvent) => void) | null;
}

export interface ScriptHostDeps {
  store: AppStore;
  undo: UndoCoordinator;
  createWorker: () => WorkerLike;
  getController: () => BodyEditorController | null;
  /** Page origin used to absolutise `/scripts/...` URLs (default `window.location.origin`). */
  origin?: () => string;
  /** Inactivity after which a run counts as silent (default 30 s). */
  watchdogMs?: number;
  /** Interval of the elapsed-time ticks (default 1 s; tests shorten it). */
  tickMs?: number;
  /** Receives `console.*` output of scripts (development builds log it to the console). */
  onLog?: (level: string, args: unknown[]) => void;
}

export interface RunOptions {
  rpc: RpcClient | null;
  dialogs: Dialogs;
  t: TFunction;
  uiLanguage: string;
  treeNode?: NodeRef;
}

/**
 * A run inside an AI request (feature 005 FR-080): `workingCopy` is the request's copy the
 * script starts from (released by the host), `session` the request's run session, which a
 * cancelled nested run cancels.
 */
export interface NestedRun {
  workingCopy: WorkingCopy;
  session: RunSession;
}

export interface RunMode {
  nested?: NestedRun;
}

export const DEFAULT_WATCHDOG_MS = 30_000;

/** A finished run longer than this is also announced by a transient notice (FR-014). */
export const NOTICE_THRESHOLD_MS = 5_000;

/** Whole seconds of a run's duration for "finished in N s": rounded, at least 1. */
export function durationSeconds(durationMs: number): number {
  return Math.max(1, Math.round(durationMs / 1000));
}

/** `mm:ss` of an elapsed time for the run banner (the minutes may pass 59). */
export function formatElapsed(elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Banner text of a script's progress report (data-model §3): "phase — done/total (NN %)" with a
 * total, "phase — done" for a bare count, the phase alone when nothing was counted yet; null
 * for a progress that is not the running script's.
 */
export function formatRunProgress(t: TFunction, progress: JobProgress | null): string | null {
  if (!progress || progress.jobId !== SCRIPT_PROGRESS_JOB) return null;
  if (progress.total > 0) {
    return t('scripting.banner.progressPercent', {
      phase: progress.phase,
      done: progress.done,
      total: progress.total,
      percent: Math.min(100, Math.round((progress.done / progress.total) * 100)),
    }) as string;
  }
  if (progress.done > 0) {
    return t('scripting.banner.progressCount', {
      phase: progress.phase,
      done: progress.done,
    }) as string;
  }
  return progress.phase;
}

/** Localised display name of a script (falls back to English, then the id). */
export function scriptName(script: ScriptInfo, language: string): string {
  return script.name[language] ?? script.name.en ?? script.id;
}

/** "Script error: <message> at line L, column C" (FR-144). */
export function formatScriptError(t: TFunction, error: ScriptErrorInfo): string {
  if (error.line !== undefined && error.column !== undefined) {
    const text = t('scripting.error.atLine', {
      message: error.message,
      line: error.line,
      column: error.column,
    }) as string;
    return error.file ? `${text} (${error.file})` : text;
  }
  return t('scripting.error.noLocation', { message: error.message }) as string;
}

interface ActiveRun {
  state: RunState;
  script: ScriptInfo;
  options: RunOptions;
  worker: WorkerLike;
  port: MessagePort;
  api: ScriptApi;
  entryUrl: string;
  /**
   * The run's session - the lock, the banner, the ticker, the document-replaced watch, the
   * commit as one undo entry and the restore on Cancel or failure; null for a nested run,
   * whose request holds all of that.
   */
  session: RunSession | null;
  nested: NestedRun | null;
  /** The document the run started from (its `docId` tells a replaced document). */
  before: Document;
  /** A nested run restores the flag at its end: it never publishes anything itself. */
  modifiedBefore: boolean;
  watchdog: ReturnType<typeof setTimeout> | null;
  lastActivity: number;
  dialogDepth: number;
  cancelRequested: boolean;
  finished: boolean;
  end: RunEnd & { finish(): void };
  resolve: (result: RunResult) => void;
}

/** The end of a run, observed by its open dialogs. */
function createRunEnd(): RunEnd & { finish(): void } {
  const listeners = new Set<() => void>();
  let ended = false;
  return {
    get ended() {
      return ended;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    finish() {
      if (ended) return;
      ended = true;
      for (const listener of [...listeners]) listener();
    },
  };
}

export class ScriptHost {
  private readonly deps: ScriptHostDeps;
  private active: ActiveRun | null = null;
  private lastState: RunState | null = null;
  private lastRunIdValue: string | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(deps: ScriptHostDeps) {
    this.deps = deps;
  }

  /** State of the running or most recent run. */
  get current(): RunState | null {
    return this.active ? this.active.state : this.lastState;
  }

  get isRunning(): boolean {
    return this.active !== null;
  }

  /** Id of the script that ran last (also restored from the core at start-up). */
  get lastRunId(): string | null {
    return this.lastRunIdValue;
  }

  setLastRunId(id: string | null): void {
    if (this.lastRunIdValue === id) return;
    this.lastRunIdValue = id;
    this.emit();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  /**
   * Runs `script` to completion (resolves when the run is done, cancelled or failed). A
   * user-started run takes the run lock through its session; `mode.nested` runs the script
   * inside an AI request on the request's working copy instead (see the module comment).
   */
  async run(script: ScriptInfo, options: RunOptions, mode: RunMode = {}): Promise<RunResult> {
    const { t, dialogs, rpc } = options;
    const { store } = this.deps;
    const name = scriptName(script, options.uiLanguage);
    if (this.active) {
      await dialogs.showMessage({
        text: t('scripting.busy', { name: this.active.state.name }),
        caption: t('scripting.error.caption'),
        icon: 'warning',
        testId: 'dialog-script-busy',
      });
      return { status: 'busy' };
    }
    if (!rpc) return { status: 'unavailable', message: 'not connected' };

    let source: ScriptSourceResult;
    try {
      source = (await rpc.call('scripts.source', {
        scriptId: script.id,
      })) as unknown as ScriptSourceResult;
    } catch (error) {
      const message = t('scripting.error.loadFailed', {
        name,
        reason: error instanceof Error ? error.message : String(error),
      }) as string;
      await dialogs.showMessage({
        text: message,
        caption: t('scripting.error.caption'),
        icon: 'error',
        testId: 'dialog-script-error',
      });
      return { status: 'failed', message };
    }
    if (this.active) return { status: 'busy' };
    const nested = mode.nested ?? null;
    const label = script.undoLabel?.[options.uiLanguage] ?? script.undoLabel?.en ?? name;

    // The start document and the session: a user-started run works on the store's document
    // under the lock its session takes; a nested run on the request's working copy, with no
    // session of its own (the request's holds the lock).
    let run: ActiveRun | null = null;
    let session: RunSession | null = null;
    let before: Document;
    if (nested) {
      if (nested.session.ended) return { status: 'unavailable', message: 'the request has ended' };
      before = nested.workingCopy.release();
    } else {
      if (!store.getState().document) return { status: 'unavailable', message: 'no document' };
      session = startRunSession(
        {
          store,
          undo: this.deps.undo,
          getController: this.deps.getController,
          tickMs: this.deps.tickMs ?? DEFAULT_TICK_MS,
        },
        {
          kind: 'script',
          label: name,
          undoLabel: label,
          onCancel: () => this.cancel(),
          onDocumentReplaced: () => this.cancel(),
          onTick: (elapsedMs) => {
            if (run) this.tick(run, elapsedMs);
          },
        },
      );
      // Another run - an AI request - holds the lock.
      if (!session) return { status: 'busy' };
      before = session.before;
    }
    const origin = this.deps.origin?.() ?? window.location.origin;
    const entryUrl = new URL(source.entryUrl, origin).toString();

    let worker: WorkerLike;
    const channel = new MessageChannel();
    try {
      worker = this.deps.createWorker();
      const init: InitMessage = { type: 'init', port: channel.port2 };
      worker.postMessage(init, [channel.port2]);
    } catch (error) {
      // No worker, no run: the lock just taken is released again.
      session?.discard();
      throw error;
    }

    return new Promise<RunResult>((resolve) => {
      const end = createRunEnd();
      const startedAt = session?.startedAt ?? Date.now();
      const active: ActiveRun = {
        state: {
          scriptId: script.id,
          name,
          status: 'running',
          startedAt,
          elapsedMs: 0,
          waiting: false,
          ...(nested ? { nested: true } : {}),
        },
        script,
        options,
        worker,
        port: channel.port1,
        entryUrl,
        session,
        nested,
        before,
        modifiedBefore: store.getState().modified,
        watchdog: null,
        lastActivity: startedAt,
        dialogDepth: 0,
        cancelRequested: false,
        finished: false,
        end,
        resolve,
        api: createScriptApi({
          store,
          document: before,
          controller: this.deps.getController(),
          dialogs,
          rpc,
          t,
          scriptName: name,
          uiLanguage: options.uiLanguage,
          ...(nested
            ? {
                publish: false,
                dialogCaption: (caption: string) =>
                  t('ai.script.nestedCaption', { name: caption }) as string,
              }
            : {}),
          onUiActivity: (isActive) => this.onUiActivity(active, isActive),
          onProgress: () => this.onActivity(active),
          isCancelRequested: () => active.cancelRequested,
          runEnd: end,
        }),
      };
      run = active;
      this.active = active;
      if (!nested) {
        actions.setStatusMessage(store, t('scripting.status.running', { name }) as string);
      }
      this.emit();

      channel.port1.onmessage = (event: MessageEvent<WorkerMessage>) => {
        void this.onWorkerMessage(active, event.data);
      };
      worker.onerror = (event: ErrorEvent) => {
        event.preventDefault?.();
        const error: ScriptErrorInfo = { name: 'Error', message: event.message || 'unknown error' };
        if (typeof event.lineno === 'number' && event.lineno > 0) {
          error.line = event.lineno;
          error.column = event.colno ?? 0;
          const base = entryUrl.slice(0, entryUrl.lastIndexOf('/') + 1);
          if (event.filename && event.filename.startsWith(base)) {
            const file = decodeURIComponent(event.filename.slice(base.length));
            if (file !== source.entry) error.file = file;
          }
        }
        void this.finish(active, 'failed', error);
      };
      this.armWatchdog(active, this.watchdogMs);
    });
  }

  /**
   * Cancels the running script: terminates the worker, closes its open dialogs and restores
   * the document as it was before the run (a nested run: the request's session is cancelled
   * with it).
   */
  cancel(): void {
    const run = this.active;
    if (!run || run.finished) return;
    run.cancelRequested = true;
    try {
      const cancel: HostMessage = { type: 'cancel' };
      run.port.postMessage(cancel);
    } catch {
      // the port may already be closed
    }
    void this.finish(run, 'cancelled');
  }

  /* ------------------------------------------------------------ internals */

  private get watchdogMs(): number {
    return this.deps.watchdogMs ?? DEFAULT_WATCHDOG_MS;
  }

  private post(run: ActiveRun, message: HostMessage): void {
    if (run.finished) return;
    run.port.postMessage(message);
  }

  private async onWorkerMessage(run: ActiveRun, message: WorkerMessage): Promise<void> {
    if (run.finished || !message || typeof message !== 'object') return;
    switch (message.type) {
      case 'ready': {
        const { script, options } = run;
        this.post(run, {
          type: 'run',
          entryUrl: run.entryUrl,
          context: {
            script: {
              id: script.id,
              name: run.state.name,
              group: script.group,
              kind: script.kind,
            },
            uiLanguage: options.uiLanguage,
            treeNode: options.treeNode,
          },
        });
        return;
      }
      case 'call': {
        this.onActivity(run);
        try {
          const value = await run.api.call(message.method, message.args);
          if (value instanceof JsonText) {
            this.post(run, { type: 'result', id: message.id, value: value.text, json: true });
          } else {
            this.post(run, { type: 'result', id: message.id, value: value ?? null });
          }
        } catch (error) {
          this.post(run, {
            type: 'error',
            id: message.id,
            message: error instanceof Error ? error.message : String(error),
            ...(error instanceof ScriptApiError ? { name: error.name, code: error.code } : {}),
          });
        }
        return;
      }
      case 'done':
        await this.finish(run, 'done');
        return;
      case 'fail':
        await this.finish(run, 'failed', message.error);
        return;
      case 'log':
        this.deps.onLog?.(message.level, message.args);
        return;
      default:
        return;
    }
  }

  private onUiActivity(run: ActiveRun, active: boolean): void {
    run.dialogDepth += active ? 1 : -1;
    const waiting = run.dialogDepth > 0;
    if (!run.finished && run.state.waiting !== waiting) {
      run.state = { ...run.state, waiting };
      this.emit();
    }
    this.onActivity(run);
  }

  /** One elapsed-time tick of the session (the banner's clock). */
  private tick(run: ActiveRun, elapsedMs: number): void {
    if (run.finished) return;
    run.state = { ...run.state, elapsedMs };
    this.emit();
  }

  /** The script did something: it is not silent, the watchdog starts over. */
  private onActivity(run: ActiveRun): void {
    run.lastActivity = Date.now();
    if (run.state.silent) this.setSilent(run, false);
    if (!run.watchdog && !run.finished) this.armWatchdog(run, this.watchdogMs);
  }

  private setSilent(run: ActiveRun, silent: boolean): void {
    run.state = { ...run.state, silent };
    this.emit();
  }

  /** Marks the run silent once nothing happened for the watchdog delay (dialogs excepted). */
  private armWatchdog(run: ActiveRun, delay: number): void {
    run.watchdog = setTimeout(() => {
      run.watchdog = null;
      if (run.finished || run.state.silent) return;
      const quiet = Date.now() - run.lastActivity;
      if (run.dialogDepth > 0) this.armWatchdog(run, this.watchdogMs);
      else if (quiet < this.watchdogMs) this.armWatchdog(run, this.watchdogMs - quiet);
      else this.setSilent(run, true);
    }, delay);
  }

  private async finish(run: ActiveRun, status: RunStatus, error?: ScriptErrorInfo): Promise<void> {
    if (run.finished) return;
    run.finished = true;
    const durationMs = Date.now() - run.state.startedAt;
    if (run.watchdog) {
      clearTimeout(run.watchdog);
      run.watchdog = null;
    }
    try {
      run.port.close();
    } catch {
      // ignore
    }
    run.worker.terminate();
    run.end.finish();
    const { store } = this.deps;
    const { t, dialogs, rpc } = run.options;

    // The run's document may have been replaced meanwhile (opened, reloaded, closed): the run
    // then leaves it alone and a `done` counts as cancelled.
    let outcome = status;
    let document: Document | null | undefined;
    if (run.session) {
      if (status === 'done') {
        if (run.session.commit(run.api.result()) === 'lost') outcome = 'cancelled';
      } else {
        run.session.discard();
      }
    } else {
      const own = store.getState().docId === run.before.docId && store.getState().document !== null;
      if (status === 'done' && own) document = run.api.result();
      else if (status === 'done') outcome = 'cancelled';
      // Nothing of a nested run was published; the flag is restored all the same (data-model §6.6).
      actions.setModified(store, run.modifiedBefore);
    }
    run.api.finish();

    run.state = {
      ...run.state,
      status: outcome,
      error,
      silent: false,
      waiting: false,
      elapsedMs: durationMs,
      durationMs,
    };
    this.lastState = run.state;
    this.active = null;
    this.emit();

    let message: string | undefined;
    if (outcome === 'done') {
      if (!run.nested) {
        // "finished in N s" (FR-014): in the status bar - unless the script left a sticky status
        // of its own - and, for a run longer than 5 s, as a notice in the work area, which the
        // user sees whether or not the status bar is shown.
        const finished = t('scripting.status.finishedIn', {
          name: run.state.name,
          seconds: durationSeconds(durationMs),
        }) as string;
        if (!run.api.stickyStatus) actions.setStatusMessage(store, finished);
        if (durationMs > NOTICE_THRESHOLD_MS) showTransientNotice(store, { text: finished });
      }
    } else if (outcome === 'cancelled') {
      if (!run.nested) {
        actions.setStatusMessage(
          store,
          t('scripting.status.cancelled', { name: run.state.name }) as string,
        );
      }
    } else {
      const info: ScriptErrorInfo = error ?? { name: 'Error', message: 'unknown error' };
      message = formatScriptError(t, info);
      if (!run.nested) {
        actions.setStatusMessage(
          store,
          t('scripting.status.failed', { name: run.state.name }) as string,
        );
      }
      try {
        // A nested run's script may have been written by the model: its log line holds the
        // script id and the error's name only (feature 005 review D5), never the message.
        await rpc?.call('log.error', {
          source: 'script',
          code: 'script.error',
          message: run.nested ? `${run.script.id}: ${info.name}` : `${run.script.id}: ${message}`,
          stack: run.nested ? undefined : info.stack,
          context: {
            scriptId: run.script.id,
            line: info.line === undefined ? undefined : String(info.line),
            column: info.column === undefined ? undefined : String(info.column),
          },
        });
      } catch {
        // the log is best effort
      }
    }

    if (run.nested) {
      // The request owns the memory, the messages and the dialogs; its Cancel ended the nested
      // run - or the nested run's Cancel ends the request (FR-080).
      if (outcome === 'cancelled') run.nested.session.cancel();
      run.resolve({ status: outcome, error, message, document });
      return;
    }

    // Last script: every started run counts (also failed ones, as in the original editor).
    this.setLastRunId(run.script.id);
    try {
      await rpc?.call('scripts.lastRun', { scriptId: run.script.id });
    } catch {
      // the memory is a convenience
    }

    if (message) {
      await dialogs.showMessage({
        text: message,
        caption: t('scripting.error.caption'),
        icon: 'error',
        testId: 'dialog-script-error',
      });
    }
    run.resolve({ status: outcome, error, message });
  }
}
