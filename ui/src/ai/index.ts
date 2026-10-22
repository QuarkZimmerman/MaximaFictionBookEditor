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
 * Nothing contacts a service, gathers context or takes the lock here (FR-020, FR-091):
 * `ai.toggle` on the first turn-on performs the one `import('./assistant')` of the
 * `ai-assistant` chunk (vite.config.ts) and flips `store.ai.on`; the panel, the catalogue
 * instance and the requests are the stories' (US2, US3).
 */

import i18next from 'i18next';

import {
  AI_TOGGLE_ICON,
  createAiStubCommands,
  type Command,
  type CommandContext,
  type CommandRegistry,
} from '@/app/commands';
import type { FeatureContext } from '@/app/services';
import { cmdKeys } from '@/features/editing/common';
import { getScriptsFeature } from '@/scripting/catalog';
import { testHooksRequested } from '@/scripting/testHooks';
import { actions, emptyConversation, isRunLocked, type AppStore } from '@/model/store';
import type { RpcClient } from '@/rpc/client';
import type { Settings } from '@/rpc/types';
import { registerContextMenuExtension } from '@/views/body/contextMenuExtensions';

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

export interface AiFeatureOptions {
  /**
   * The lazy import of the assistant module; `() => import('./assistant')` by default (tests
   * substitute a module and count the calls).
   */
  loadAssistant?: () => Promise<AssistantModule>;
  /** Install the test hooks whatever the page and the core say (tests). */
  testHooks?: boolean;
}

export class AiFeature {
  private statusValue: AiFeatureStatus = 'waiting';
  private coreTooOldValue = false;
  private versionCheck: Promise<'recent' | 'old' | 'unknown'> | null = null;
  private module: AssistantModule | null = null;
  private loading: Promise<AssistantModule> | null = null;
  private lastContext: CommandContext | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly loadAssistant: () => Promise<AssistantModule>;
  private readonly unsubscribe: () => void;
  private hooksInstalled = false;
  /** Removes the Body context menu's "Ask AI..." slot (registered while on, FR-030). */
  private removeMenuSlot: (() => void) | null = null;

  constructor(
    readonly store: AppStore,
    readonly commands: CommandRegistry,
    private readonly rpc: RpcClient | null,
    options: AiFeatureOptions = {},
  ) {
    this.loadAssistant = options.loadAssistant ?? (() => import('./assistant'));
    if (options.testHooks || testHooksRequested()) this.installHooks();
    this.unsubscribe = store.subscribe((state, previous) => {
      if (state.settings !== previous.settings) void this.onSettings(state.settings);
    });
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
   * Turns the assistant on (importing the chunk on the first time) or off. Off while a request
   * runs is US3's "Stop the request?" prompt (T053); the skeleton turns off at once.
   */
  async toggle(ctx: CommandContext): Promise<void> {
    this.lastContext = ctx;
    if (this.store.getState().ai.on) {
      this.turnOff();
      return;
    }
    const module = await this.load();
    // The mode may have become `disabled` while the chunk loaded (FR-097).
    if (this.statusValue !== 'registered') return;
    module.startAssistant(this.store);
    this.addMenuSlot(ctx);
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
  load(): Promise<AssistantModule> {
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

  /** Back to the inert stubs; the panel closes and the conversation is dropped (FR-096, FR-097). */
  private deregister(): void {
    if (this.statusValue === 'disabled') return;
    if (this.statusValue === 'registered') {
      this.turnOff();
      for (const stub of createAiStubCommands()) this.commands.replace(stub);
      this.commands.unregister('ai.cancel');
    }
    this.setStatus('disabled');
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
