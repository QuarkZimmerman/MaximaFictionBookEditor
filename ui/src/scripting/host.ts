/**
 * Script host (T102): the run lifecycle on the editor side. One worker per run, created by the
 * injected factory and bound to the host through a private MessageChannel; one undo group per
 * run (`UndoCoordinator.beginGroup`/`endGroup`, rolled back with `rollbackGroup()` when the
 * user cancels and the worker is terminated); a watchdog that shows "script is still running -
 * wait / cancel" after 30 s without activity; errors reported as `Script error: <message> at
 * line L, column C`, logged through `log.error`; the "Last script" memory (`scripts.lastRun`).
 */

import type { TFunction } from 'i18next';

import type { Dialogs } from '@/dialogs/types';
import { actions, type AppStore } from '@/model/store';
import type { UndoCoordinator } from '@/model/undo';
import type { RpcClient } from '@/rpc/client';
import type { BodyEditorController } from '@/views/body/bodyEditor';

import { createScriptApi, JsonText, ScriptApiError, type ScriptApi } from './api-impl';
import { showRunningPrompt } from './dialogs';
import type {
  HostMessage,
  InitMessage,
  NodeRef,
  ScriptErrorInfo,
  ScriptInfo,
  ScriptSourceResult,
  WorkerMessage,
} from './types';

export type RunStatus = 'running' | 'done' | 'cancelled' | 'failed';

export interface RunState {
  scriptId: string;
  name: string;
  status: RunStatus;
  startedAt: number;
  error?: ScriptErrorInfo;
}

export interface RunResult {
  status: RunStatus | 'busy' | 'unavailable';
  error?: ScriptErrorInfo;
  /** The user-facing text of a failure (also shown in the error dialog). */
  message?: string;
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
  /** Inactivity threshold of the "still running" prompt (default 30 s). */
  watchdogMs?: number;
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

export const DEFAULT_WATCHDOG_MS = 30_000;

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
  watchdog: ReturnType<typeof setTimeout> | null;
  dialogDepth: number;
  promptOpen: boolean;
  cancelRequested: boolean;
  finished: boolean;
  resolve: (result: RunResult) => void;
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

  /** Runs `script` to completion (resolves when the run is done, cancelled or failed). */
  async run(script: ScriptInfo, options: RunOptions): Promise<RunResult> {
    const { t, dialogs, rpc } = options;
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
    const origin = this.deps.origin?.() ?? window.location.origin;
    const entryUrl = new URL(source.entryUrl, origin).toString();

    const label = script.undoLabel?.[options.uiLanguage] ?? script.undoLabel?.en ?? name;
    const worker = this.deps.createWorker();
    const channel = new MessageChannel();
    const init: InitMessage = { type: 'init', port: channel.port2 };
    worker.postMessage(init, [channel.port2]);

    return new Promise<RunResult>((resolve) => {
      const run: ActiveRun = {
        state: { scriptId: script.id, name, status: 'running', startedAt: Date.now() },
        script,
        options,
        worker,
        port: channel.port1,
        entryUrl,
        watchdog: null,
        dialogDepth: 0,
        promptOpen: false,
        cancelRequested: false,
        finished: false,
        resolve,
        api: createScriptApi({
          store: this.deps.store,
          controller: this.deps.getController(),
          dialogs,
          rpc,
          t,
          scriptName: name,
          uiLanguage: options.uiLanguage,
          onUiActivity: (active) => this.onUiActivity(run, active),
          onProgress: () => this.armWatchdog(run),
          isCancelRequested: () => run.cancelRequested,
        }),
      };
      this.active = run;
      this.deps.undo.beginGroup(label);
      actions.setStatusMessage(this.deps.store, t('scripting.status.running', { name }) as string);
      this.emit();

      channel.port1.onmessage = (event: MessageEvent<WorkerMessage>) => {
        void this.onWorkerMessage(run, event.data);
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
        void this.finish(run, 'failed', error);
      };
      this.armWatchdog(run);
    });
  }

  /** Cancels the running script: terminates the worker and rolls the undo group back. */
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
        this.armWatchdog(run);
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
        this.armWatchdog(run);
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
    if (run.dialogDepth > 0) this.clearWatchdog(run);
    else this.armWatchdog(run);
  }

  private clearWatchdog(run: ActiveRun): void {
    if (run.watchdog) {
      clearTimeout(run.watchdog);
      run.watchdog = null;
    }
  }

  private armWatchdog(run: ActiveRun): void {
    this.clearWatchdog(run);
    if (run.finished || run.dialogDepth > 0 || run.promptOpen) return;
    const delay = this.deps.watchdogMs ?? DEFAULT_WATCHDOG_MS;
    run.watchdog = setTimeout(() => {
      run.watchdog = null;
      void this.promptStillRunning(run);
    }, delay);
  }

  private async promptStillRunning(run: ActiveRun): Promise<void> {
    if (run.finished || run.promptOpen || run.dialogDepth > 0) return;
    run.promptOpen = true;
    const answer = await showRunningPrompt(run.options.dialogs, {
      scriptName: run.state.name,
      subscribe: this.subscribe,
      isRunning: () => this.active === run && !run.finished,
    });
    run.promptOpen = false;
    if (run.finished) return;
    if (answer === 'cancel') this.cancel();
    else this.armWatchdog(run);
  }

  private async finish(run: ActiveRun, status: RunStatus, error?: ScriptErrorInfo): Promise<void> {
    if (run.finished) return;
    run.finished = true;
    this.clearWatchdog(run);
    try {
      run.port.close();
    } catch {
      // ignore
    }
    run.worker.terminate();
    const { undo, store } = this.deps;
    const { t, dialogs, rpc } = run.options;
    if (status === 'cancelled') undo.rollbackGroup();
    else undo.endGroup();
    run.api.finish();

    run.state = { ...run.state, status, error };
    this.lastState = run.state;
    this.active = null;
    this.emit();

    let message: string | undefined;
    if (status === 'done') {
      if (!run.api.stickyStatus) {
        actions.setStatusMessage(
          store,
          t('scripting.status.finished', { name: run.state.name }) as string,
        );
      }
    } else if (status === 'cancelled') {
      actions.setStatusMessage(
        store,
        t('scripting.status.cancelled', { name: run.state.name }) as string,
      );
    } else {
      const info: ScriptErrorInfo = error ?? { name: 'Error', message: 'unknown error' };
      message = formatScriptError(t, info);
      actions.setStatusMessage(
        store,
        t('scripting.status.failed', { name: run.state.name }) as string,
      );
      try {
        await rpc?.call('log.error', {
          source: 'script',
          code: 'script.error',
          message: `${run.script.id}: ${message}`,
          stack: info.stack,
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
    run.resolve({ status, error, message });
  }
}
