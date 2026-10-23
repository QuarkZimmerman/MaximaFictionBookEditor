/**
 * AI assistant feature registrar (feature 005; research R8.3-R8.4; data-model §3.1, §3.3
 * "start-up"). Static - part of the main bundle - and deliberately small: it decides whether
 * the assistant exists in this session and loads everything else lazily.
 *
 * The Disabled rule (FR-096, FR-098): features register before the first settings snapshot, so
 * this one registers **nothing** until the snapshot arrives - the inert, invisible stubs of
 * `createBuiltinCommands()` (`ai.toggle`, `ai.ask`) stand in for the hotkey tables, the View
 * menu and the toolbar meanwhile. Then, iff `settings.ai.mode !== 'disabled'` **and** the core's
 * `app.info().apiMinor` is at least 4 (one call by this module - the RPC client makes no minor
 * check), the stubs are taken over by the live commands `ai.toggle` (View → AI Assistant,
 * `checked` = `store.ai.on`), `ai.ask` (visible and enabled only while on) and `ai.cancel`.
 * An older core: nothing is registered and `coreTooOld` tells the settings page (rpc-api §6).
 * When the mode becomes `disabled` later the live commands go, the stubs come back (the View
 * entry hidden by `visible`, the toolbar button gone, the hotkeys inert), the panel closes and
 * the conversation is dropped; when it changes back the commands return - without a restart
 * (FR-097).
 *
 * The Disabled transitions (US9 T065; data-model §3.3 rows "settings OK, mode → disabled" and
 * "disabled → free | custom", §3.4 invariants): `deregister()` turns off if on (a request still
 * running - a snapshot that did not come through the dialog's question - is cancelled and
 * waited for first), which clears the conversation, closes the popup and the panel (App.tsx
 * renders them while `on`), removes the context-menu slot and drops the catalogue instance;
 * `ai.toggle` and `ai.ask` are replaced by the inert, invisible stubs and `ai.cancel` is
 * removed outright (no stub exists for it); `register()` brings the live commands back with
 * the assistant off. Where the two commands are listed by name, invisibility is honoured
 * everywhere else as decided here (FR-096 - nothing of the assistant in the editor but the
 * settings page): the Customize Toolbar dialog **hides** a stored layout's `ai.toggle`
 * rather than greying it out and keeps it stored (`toolbarLayouts.ts` `withHiddenItems`),
 * and the Hotkeys page never names an invisible command in "Assigned to ..." - its chord is
 * free and a default it holds is taken back silently (`hotkeysModel.ts`). Nothing of the
 * feature runs a timer or a listener while off (§3.4).
 *
 * Nothing contacts a service, gathers context or takes the lock here (FR-020, FR-091):
 * `ai.toggle` on the first turn-on performs the one `import('./chunk')` of the `ai-assistant`
 * chunk (vite.config.ts; `chunk.ts` re-exports `assistant.ts` and the panel component) and
 * flips `store.ai.on`.
 *
 * The transitions of data-model §3.3 (US3 T053; FR-090 to FR-095):
 *  - on: the chunk imported once, the state flipped, the panel opened at `width` with the
 *    focus in its field, the Body context menu's "Ask AI..." slot added - no request, no
 *    context gathering, no outline, no lock;
 *  - off (the close button, the View entry, the hotkey, the toolbar button alike): the
 *    conversation cleared (FR-045), the slot removed, the panel unmounted, the request and
 *    catalogue references dropped; the document and `modified` untouched, no undo step;
 *  - off while a request runs: the question `dialog-ai-stop-confirm` first (FR-093) - Yes
 *    cancels the request, waits for its end and turns off, No changes nothing;
 *  - the document replaced (`docId` changes: open, new, close): a running request is cancelled
 *    (its session's watch does it; made sure here) and the conversation cleared; the panel
 *    stays open and empty;
 *  - Disabled chosen in Settings while a request runs: the same question before OK applies
 *    (`registerBeforeApply`, FR-097) - No keeps the dialog open; the de-registration then
 *    turns the assistant off as before;
 *  - exit / window close: the file feature's quit flow cancels the run holding the lock
 *    (`fileCommands.ts`, the AI wording of the prompt) before the save-changes prompt.
 * The catalogue instance per turn-on (data-model §8.5) is built by `assistant.ts`'s
 * `startAssistant` (kept in `store.ai.catalogue`, re-bound to every request's working copy,
 * closed by `stopAssistant` - T055).
 */

import i18next from 'i18next';
import type { ComponentType } from 'react';

import {
  AI_TOGGLE_ICON,
  createAiStubCommands,
  type Command,
  type CommandContext,
  type CommandRegistry,
} from '@/app/commands';
import type { FeatureContext } from '@/app/services';
import { cmdKeys } from '@/features/editing/common';
import { registerBeforeApply } from '@/features/settings/index';
import { getScriptsFeature } from '@/scripting/catalog';
import { testHooksRequested } from '@/scripting/testHooks';
import { actions, emptyConversation, isRunLocked, type AppStore } from '@/model/store';
import type { RpcClient } from '@/rpc/client';
import type { Settings } from '@/rpc/types';
import { registerContextMenuExtension } from '@/views/body/contextMenuExtensions';

import type { AiPanelProps } from './AiPanel';
import type { AssistantModule } from './assistant';
import { installAiTestHooks } from './testHooks';

/** The contract revision the assistant needs (rpc-api §6; `RPC_API_MINOR`). */
export const AI_REQUIRED_API_MINOR = 4;

/** The ids of the feature's commands; `ai.cancel` exists only while the feature is registered. */
export const AI_COMMAND_IDS = ['ai.toggle', 'ai.ask', 'ai.cancel'] as const;

/**
 * Where the feature stands: `waiting` (no settings snapshot yet - nothing registered),
 * `registered` (the live commands), `disabled` (the inert stubs; `ai.mode === 'disabled'`),
 * `coreTooOld` (nothing registered; the settings page says so).
 */
export type AiFeatureStatus = 'waiting' | 'registered' | 'disabled' | 'coreTooOld';

/**
 * What the lazy chunk exports as `index.ts` imports it (`chunk.ts`): the assistant's surface
 * and the panel component App.tsx renders inside the right pane while on.
 */
export interface AiChunkModule extends AssistantModule {
  AiPanel?: ComponentType<AiPanelProps>;
}

/** Longest wait for a cancelled request to end before a turn-off or a de-registration goes on. */
export const CANCEL_REQUEST_WAIT_MS = 5000;

export interface AiFeatureOptions {
  /**
   * The lazy import of the chunk; `() => import('./chunk')` by default (tests substitute a
   * module and count the calls).
   */
  loadAssistant?: () => Promise<AiChunkModule>;
  /** Install the test hooks whatever the page and the core say (tests). */
  testHooks?: boolean;
  /** How long a cancelled request may take to end (default `CANCEL_REQUEST_WAIT_MS`). */
  cancelWaitMs?: number;
}

export class AiFeature {
  private statusValue: AiFeatureStatus = 'waiting';
  private coreTooOldValue = false;
  private versionCheck: Promise<'recent' | 'old' | 'unknown'> | null = null;
  private module: AiChunkModule | null = null;
  private loading: Promise<AiChunkModule> | null = null;
  private lastContext: CommandContext | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly loadAssistant: () => Promise<AiChunkModule>;
  private readonly unsubscribe: () => void;
  private readonly removeBeforeApply: () => void;
  private readonly cancelWaitMs: number;
  private hooksInstalled = false;
  /** Removes the Body context menu's "Ask AI..." slot (registered while on, FR-030). */
  private removeMenuSlot: (() => void) | null = null;
  /** The turn-off under way (its question open, its request ending): one at a time. */
  private closing: Promise<boolean> | null = null;

  constructor(
    readonly store: AppStore,
    readonly commands: CommandRegistry,
    private readonly rpc: RpcClient | null,
    options: AiFeatureOptions = {},
  ) {
    this.loadAssistant = options.loadAssistant ?? (() => import('./chunk'));
    this.cancelWaitMs = options.cancelWaitMs ?? CANCEL_REQUEST_WAIT_MS;
    if (options.testHooks || testHooksRequested()) this.installHooks();
    this.unsubscribe = store.subscribe((state, previous) => {
      if (state.settings !== previous.settings) void this.onSettings(state.settings);
      if (state.docId !== previous.docId && state.ai.on) {
        // After the notification round: the clearing is a store update of its own.
        void Promise.resolve().then(() => this.onDocumentReplaced());
      }
    });
    this.removeBeforeApply = registerBeforeApply((draft, original) =>
      this.beforeApply(draft, original),
    );
    // A snapshot that arrived before the registrar ran (tests) counts as the first one.
    const initial = store.getState().settings;
    if (initial) void this.onSettings(initial);
  }

  /** Where the feature stands (see `AiFeatureStatus`). */
  get status(): AiFeatureStatus {
    return this.statusValue;
  }

  /** True when the core answered an `apiMinor` below 4: nothing registered, the page says so. */
  get coreTooOld(): boolean {
    return this.coreTooOldValue;
  }

  /** The assistant module once the chunk was imported (the first turn-on); null before. */
  get assistant(): AssistantModule | null {
    return this.module;
  }

  /** The panel component of the imported chunk (App.tsx renders it in the right pane while on). */
  get panel(): ComponentType<AiPanelProps> | null {
    return this.module?.AiPanel ?? null;
  }

  /** True while a request of the assistant runs (the popup's or the panel's - one slot). */
  requestRunning(): boolean {
    return (
      (this.module?.activeRequest?.() ?? null) !== null || this.store.getState().ai.request !== null
    );
  }

  /** `settings.ai.mode !== 'disabled'` by the latest snapshot (data-model §3.1 `enabled`). */
  enabled(): boolean {
    return (
      modeOf(this.store.getState().settings) !== 'disabled' && this.statusValue === 'registered'
    );
  }

  /**
   * The popup's predicate (data-model §3.1 `canAsk`): enabled, on, a document open, the Body or
   * Source view active and no run holding the lock.
   */
  canAsk(ctx: Pick<CommandContext, 'store'>): boolean {
    const state = ctx.store.getState();
    return (
      this.enabled() &&
      state.ai.on &&
      state.document !== null &&
      (state.activeView === 'body' || state.activeView === 'source') &&
      !isRunLocked(state)
    );
  }

  /** The panel's Send predicate without the target part (data-model §3.1 `canSend`; the target is US1/US3's). */
  canSend(ctx: Pick<CommandContext, 'store'>): boolean {
    const state = ctx.store.getState();
    return this.enabled() && state.ai.on && state.document !== null && !isRunLocked(state);
  }

  /** Notifies on every status change (the settings page re-renders its "core too old" line). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** A command context for programmatic use (test hooks): the last one seen, else the scripts feature's. */
  commandContext(): CommandContext | null {
    return this.lastContext ?? getScriptsFeature(this.store)?.commandContext() ?? null;
  }

  /**
   * View → AI Assistant, `Mod+Shift+A`, the toolbar button: turns the assistant on (importing
   * the chunk on the first time) or off - off goes through `close()` and its question while a
   * request runs (FR-093).
   */
  async toggle(ctx: CommandContext): Promise<void> {
    this.lastContext = ctx;
    if (this.store.getState().ai.on) {
      await this.close(ctx);
      return;
    }
    const module = await this.load();
    // The mode may have become `disabled` while the chunk loaded (FR-097); a second toggle
    // may have turned the assistant on meanwhile.
    if (this.statusValue !== 'registered' || this.store.getState().ai.on) return;
    module.startAssistant(this.store);
    this.addMenuSlot(ctx);
    // The panel opens (App.tsx renders it while on) with the focus in its field; nothing is
    // sent, gathered or locked (FR-091).
    actions.updateAi(this.store, { panelFocus: true });
  }

  /**
   * Turns the assistant off - the panel's close button, the View entry, the hotkey and the
   * toolbar button alike (FR-092). While a request runs the user is asked first
   * (`dialog-ai-stop-confirm`, FR-093): Yes cancels the request, waits for its end (the working
   * copy discarded, the lock released) and turns off; No changes nothing. Resolves true when
   * the assistant is off afterwards. A second call while the question is open joins it.
   */
  close(ctx: CommandContext): Promise<boolean> {
    this.lastContext = ctx;
    if (!this.store.getState().ai.on) return Promise.resolve(true);
    if (this.closing) return this.closing;
    this.closing = this.closeNow(ctx).finally(() => {
      this.closing = null;
    });
    return this.closing;
  }

  private async closeNow(ctx: CommandContext): Promise<boolean> {
    if (this.requestRunning()) {
      const answer = await ctx.dialogs.showMessage({
        text: ctx.t('ai.stopConfirm.closeText'),
        caption: ctx.t('ai.stopConfirm.title'),
        buttons: 'yesNo',
        icon: 'question',
        defaultButton: 'no',
        testId: 'dialog-ai-stop-confirm',
      });
      if (answer !== 'yes') return false;
      await this.cancelAndWait();
    }
    if (!this.store.getState().ai.on) return true; // turned off meanwhile (Disabled applied)
    this.turnOff();
    return true;
  }

  /**
   * Off: the conversation cleared (FR-045), the catalogue instance and a request reference
   * dropped, the context-menu entry removed, the document untouched (FR-095) - through the
   * module when it was loaded, else directly (the state may have been flipped without it).
   */
  private turnOff(): void {
    this.removeMenuSlot?.();
    this.removeMenuSlot = null;
    if (this.module) {
      this.module.stopAssistant(this.store);
      return;
    }
    actions.updateAi(this.store, {
      on: false,
      request: null,
      catalogue: null,
      conversation: emptyConversation(),
      panelFocus: false,
    });
  }

  /**
   * Cancels the running request and waits - `cancelWaitMs` at most - until it has ended: the
   * loop writes its end entry, discards the working copy and releases the lock first, so that
   * nothing of it lands in the state after the turn-off.
   */
  private async cancelAndWait(): Promise<void> {
    this.module?.cancelRequest(this.store);
    const ended = () => !this.requestRunning() && this.store.getState().runLock?.kind !== 'ai';
    if (ended()) return;
    await new Promise<void>((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (ended() || Date.now() - started >= this.cancelWaitMs) {
          clearInterval(timer);
          resolve();
        }
      }, 20);
    });
  }

  /**
   * The document was replaced (open, new, close) while on: a running request is cancelled
   * (the session's `docId` watch has asked already; made sure and waited for here) and the
   * conversation is cleared (FR-045) - the panel stays open and empty.
   */
  private async onDocumentReplaced(): Promise<void> {
    if (this.requestRunning()) await this.cancelAndWait();
    const state = this.store.getState();
    if (!state.ai.on) return;
    const { conversation } = state.ai;
    const empty =
      conversation.docId === null &&
      conversation.messages.length === 0 &&
      conversation.activity.length === 0 &&
      conversation.droppedTurns === 0;
    if (!empty) actions.updateAi(this.store, { conversation: emptyConversation() });
  }

  /**
   * The Settings dialog's pre-apply hook (registered with `registerBeforeApply`; FR-097,
   * FR-093): Disabled chosen while a request runs asks the same question - Yes cancels the
   * request and lets the dialog apply (the snapshot then de-registers and turns off), No keeps
   * the dialog open with nothing applied. Any other change, or an idle assistant, applies at
   * once.
   */
  async beforeApply(draft: Settings, original: Settings): Promise<'apply' | 'keepOpen'> {
    if (modeOf(draft) !== 'disabled' || modeOf(original) === 'disabled') return 'apply';
    if (!this.store.getState().ai.on || !this.requestRunning()) return 'apply';
    const ctx = this.commandContext();
    if (ctx) {
      const answer = await ctx.dialogs.showMessage({
        text: ctx.t('ai.stopConfirm.disableText'),
        caption: ctx.t('ai.stopConfirm.title'),
        buttons: 'yesNo',
        icon: 'question',
        defaultButton: 'no',
        testId: 'dialog-ai-stop-confirm',
      });
      if (answer !== 'yes') return 'keepOpen';
    }
    await this.cancelAndWait();
    return 'apply';
  }

  /** The Body context menu's "Ask AI..." entry, present only while on (FR-030; T047). */
  private addMenuSlot(ctx: CommandContext): void {
    if (this.removeMenuSlot) return;
    this.removeMenuSlot = registerContextMenuExtension('ai', () => {
      const context = this.lastContext ?? ctx;
      if (!context.store.getState().ai.on) return [];
      return [
        {
          id: 'ai.ask',
          label: i18next.t('ai.ask.label'),
          enabled: this.canAsk(context),
          run: () => void this.commands.execute('ai.ask', context),
        },
      ];
    });
  }

  /** Opens the "Ask AI..." popup for the current selection (`ai.ask`; US2 T047). */
  async ask(ctx: CommandContext): Promise<void> {
    this.lastContext = ctx;
    if (!this.canAsk(ctx)) return;
    const module = await this.load();
    if (!this.canAsk(ctx)) return;
    await module.openAskPopup?.(ctx);
  }

  /** Cancels the running request (the banner's Cancel, `ai.cancel`). */
  cancel(): void {
    this.module?.cancelRequest(this.store);
  }

  /** The last request's summary (`__mfbeTest.ai.lastRequest()`), null before the first. */
  lastRequest(): unknown {
    return this.module?.lastRequestInfo?.() ?? null;
  }

  /** The one `import()` of the chunk; later calls return the same module (data-model §3.1 `loaded`). */
  load(): Promise<AiChunkModule> {
    if (this.module) return Promise.resolve(this.module);
    if (!this.loading) {
      this.loading = this.loadAssistant().then((module) => {
        this.module = module;
        actions.updateAi(this.store, { loaded: true });
        return module;
      });
      this.loading.catch(() => {
        this.loading = null; // a failed import may be retried by the next turn-on
      });
    }
    return this.loading;
  }

  /** Stops listening; the commands stay as they are (the registry outlives the test). */
  dispose(): void {
    this.unsubscribe();
    this.removeBeforeApply();
  }

  /* --------------------------------------------------------------- state */

  private async onSettings(settings: Settings | null): Promise<void> {
    if (!settings) return;
    const mode = modeOf(settings);
    // A snapshot without the `ai` group comes from a core before API minor 4.
    const core = mode === null ? 'old' : await this.coreVersion();
    if (core === 'unknown') return; // the call failed: the next snapshot asks again
    if (core === 'old') {
      this.coreTooOldValue = true;
      this.setStatus('coreTooOld');
      return;
    }
    if (mode === 'disabled') this.deregister();
    else this.register();
  }

  /**
   * Whether `app.info().apiMinor` is at least 4, asked once (a failed call is asked again with
   * the next snapshot). Without an RPC client (UI-only runs) there is no core to be too old.
   */
  private coreVersion(): Promise<'recent' | 'old' | 'unknown'> {
    if (!this.rpc) return Promise.resolve('recent');
    if (!this.versionCheck) {
      this.versionCheck = this.rpc
        .call('app.info')
        .then((info) => {
          const minor = typeof info.apiMinor === 'number' ? info.apiMinor : 0;
          if ((info as { testHooks?: boolean }).testHooks) this.installHooks();
          return minor >= AI_REQUIRED_API_MINOR ? ('recent' as const) : ('old' as const);
        })
        .catch(() => {
          this.versionCheck = null;
          return 'unknown' as const;
        });
    }
    return this.versionCheck;
  }

  private register(): void {
    if (this.statusValue === 'registered') return;
    for (const command of this.liveCommands()) this.commands.replace(command);
    this.setStatus('registered');
  }

  /**
   * Back to the inert stubs; the panel closes and the conversation is dropped (FR-096, FR-097).
   * A request still running (a snapshot that did not come through the dialog's question) is
   * cancelled and waited for before the turn-off, so that its end entry lands nowhere.
   */
  private deregister(): void {
    if (this.statusValue === 'disabled') return;
    if (this.statusValue === 'registered') {
      void this.turnOffAfterRequest();
      for (const stub of createAiStubCommands()) this.commands.replace(stub);
      this.commands.unregister('ai.cancel');
    }
    this.setStatus('disabled');
  }

  private async turnOffAfterRequest(): Promise<void> {
    if (this.requestRunning()) await this.cancelAndWait();
    if (this.store.getState().ai.on || this.removeMenuSlot) this.turnOff();
  }

  private setStatus(status: AiFeatureStatus): void {
    if (status === this.statusValue) return;
    this.statusValue = status;
    for (const listener of [...this.listeners]) listener();
  }

  private installHooks(): void {
    if (this.hooksInstalled) return;
    this.hooksInstalled = true;
    installAiTestHooks(this);
  }

  /* ------------------------------------------------------------ commands */

  private liveCommands(): Command[] {
    const remember = (ctx: CommandContext) => {
      this.lastContext = ctx;
    };
    const toggle: Command = {
      id: 'ai.toggle',
      group: 'view',
      ...cmdKeys('ai.toggle', 'menu.view.aiAssistant'),
      icon: AI_TOGGLE_ICON,
      checked: (ctx) => ctx.store.getState().ai.on,
      // Turning on needs a document; turning off is always possible - also while a request
      // holds the lock (US3: the "Stop the request?" prompt).
      enabled: (ctx) => {
        remember(ctx);
        const state = ctx.store.getState();
        return state.ai.on || state.document !== null;
      },
      duringScriptRun: 'allowed',
      run: (ctx) => this.toggle(ctx),
    };
    const ask: Command = {
      id: 'ai.ask',
      group: 'tools',
      ...cmdKeys('ai.ask'),
      visible: (ctx) => ctx.store.getState().ai.on,
      enabled: (ctx) => {
        remember(ctx);
        return this.canAsk(ctx);
      },
      run: (ctx) => this.ask(ctx),
    };
    const cancel: Command = {
      id: 'ai.cancel',
      group: 'tools',
      ...cmdKeys('ai.cancel'),
      enabled: (ctx) => ctx.store.getState().ai.request !== null,
      duringScriptRun: 'allowed',
      run: () => this.cancel(),
    };
    return [toggle, ask, cancel];
  }
}

function modeOf(settings: Settings | null): 'free' | 'custom' | 'disabled' | null {
  const mode = settings?.ai?.mode;
  return mode === 'free' || mode === 'custom' || mode === 'disabled' ? mode : null;
}

const features = new WeakMap<AppStore, AiFeature>();

/** Registers the feature for a store once; a second call returns the existing instance. */
export function registerAiFeature(ctx: FeatureContext, options?: AiFeatureOptions): AiFeature {
  let feature = features.get(ctx.store);
  if (!feature) {
    feature = new AiFeature(ctx.store, ctx.commands, ctx.rpc ?? null, options);
    features.set(ctx.store, feature);
  }
  return feature;
}

/** The feature of a store (undefined before `registerAiFeature`). */
export function getAiFeature(store: AppStore): AiFeature | undefined {
  return features.get(store);
}

/** Forgets the feature of a store (tests that register twice against one store). */
export function unregisterAiFeature(store: AppStore): void {
  features.get(store)?.dispose();
  features.delete(store);
}
