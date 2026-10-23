/**
 * Scripts feature state (T105): the catalogue loaded from `scripts.list`, the dynamic
 * commands `script.<id>` (menu/toolbar/hotkey targets, `needsSelection` enable state), the
 * `scripts.last` command, the Hotkeys group "Scripts" defaults (`defaultHotkey`), the
 * `scripts.openFolder` / `scripts.reload` commands and the run entry points used by the
 * menu, the toolbar, the Document Tree context menu and the test hooks.
 *
 * The registrar (`features/scripts/index.ts`) creates one `ScriptsFeature` per store before the
 * RPC client exists; `attach(rpc)` (called by the menu hook or by the first command context
 * seen) loads the list and keeps it fresh (`resources.changed`, `settings.changed` with a new
 * scripts folder).
 */

import i18next from 'i18next';

import {
  scriptCommandId,
  switchView,
  type Command,
  type CommandContext,
  type CommandRegistry,
} from '@/app/commands';
import type { HotkeyMap } from '@/app/hotkeys';
import type { MenuItemSpec } from '@/app/menus';
import { actions, type AppStore } from '@/model/store';
import type { UndoCoordinator } from '@/model/undo';
import type { RpcClient } from '@/rpc/client';
import { getBodyController, hasBodyController } from '@/views/body/bodyEditor';

import { ScriptHost, scriptName, type RunResult } from './host';
import type { NodeRef, ScriptGroup, ScriptInfo, ScriptsListResult } from './types';
import { createSandboxWorker } from './workerFactory';

export const LAST_SCRIPT_COMMAND = 'scripts.last';
export const OPEN_FOLDER_COMMAND = 'scripts.openFolder';
export const RELOAD_COMMAND = 'scripts.reload';

/** i18n key under which a dynamic (manifest-supplied) label is registered at run time. */
export function dynamicLabelKey(kind: 'group' | 'script', id: string): string {
  return `scripting.dynamic.${kind}.${id.replace(/[.:]/g, '_')}`;
}

export interface ScriptsFeatureOptions {
  store: AppStore;
  commands: CommandRegistry;
  hotkeys: HotkeyMap;
  undo: UndoCoordinator;
  /** Worker factory (tests inject a fake); defaults to the inline sandbox worker. */
  createWorker?: () => Worker;
  /** Inactivity after which a run counts as silent (tests; default 30 s). */
  watchdogMs?: number;
}

export class ScriptsFeature {
  readonly store: AppStore;
  readonly commands: CommandRegistry;
  readonly hotkeys: HotkeyMap;
  readonly host: ScriptHost;
  private rpc: RpcClient | null = null;
  private groupsValue: ScriptGroup[] = [];
  private issuesValue: ScriptsListResult['issues'] = [];
  private foldersValue: ScriptsListResult['folders'] = {};
  private loadedValue = false;
  private registered = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private detach: (() => void)[] = [];
  private refreshing: Promise<void> | null = null;
  private contextProvider: (() => CommandContext) | null = null;
  private lastContext: CommandContext | null = null;
  private testHooksInstalled = false;
  /** Installs the test hooks once the core confirms they are enabled (set by the registrar). */
  onTestHooks: ((feature: ScriptsFeature) => void) | null = null;

  constructor(options: ScriptsFeatureOptions) {
    this.store = options.store;
    this.commands = options.commands;
    this.hotkeys = options.hotkeys;
    this.host = new ScriptHost({
      store: options.store,
      undo: options.undo,
      createWorker: options.createWorker ?? createSandboxWorker,
      watchdogMs: options.watchdogMs,
      getController: () =>
        hasBodyController(options.store) ? getBodyController(options.store) : null,
      onLog: (level, args) => {
        if (import.meta.env.DEV) console.log(`[script:${level}]`, ...args);
      },
    });
    // The host keeps `store.runLock` current itself (set before it notifies); when a run
    // starts or ends the registry re-evaluates the per-command `duringScriptRun` policies.
    let running = this.host.isRunning;
    this.host.subscribe(() => {
      if (this.host.isRunning !== running) {
        running = this.host.isRunning;
        this.commands.refresh();
      }
      this.emit();
    });
    this.registerStaticCommands();
  }

  /* --------------------------------------------------------------- state */

  get groups(): ScriptGroup[] {
    return this.groupsValue;
  }

  get issues(): ScriptsListResult['issues'] {
    return this.issuesValue;
  }

  get folders(): ScriptsListResult['folders'] {
    return this.foldersValue;
  }

  /** True once `scripts.list` answered at least once. */
  get loaded(): boolean {
    return this.loadedValue;
  }

  get isAttached(): boolean {
    return this.rpc !== null;
  }

  /** Every script (menu and tree kinds) in menu order. */
  all(): ScriptInfo[] {
    return this.groupsValue.flatMap((group) => group.scripts);
  }

  find(id: string): ScriptInfo | undefined {
    return this.all().find((script) => script.id === id);
  }

  /** Scripts with an icon, for the Scripts toolbar (menu kind only, menu order). */
  toolbarScripts(): ScriptInfo[] {
    return this.all().filter((script) => script.kind === 'menu' && !!script.iconUrl);
  }

  /** Scripts offered in the Document Tree context menu. */
  treeScripts(): ScriptInfo[] {
    return this.all().filter((script) => script.kind === 'tree');
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

  /* ---------------------------------------------------------- attaching */

  /** Binds the feature to the RPC client: loads the list and follows change notifications. */
  attach(rpc: RpcClient): void {
    if (this.rpc === rpc) return;
    for (const off of this.detach) off();
    this.detach = [];
    this.rpc = rpc;
    this.detach.push(
      rpc.on('resources.changed', ({ what }) => {
        if (what === 'scripts') void this.refresh();
      }),
    );
    let lastFolder: string | undefined;
    this.detach.push(
      rpc.on('settings.changed', ({ settings }) => {
        const folder = settings.other.scriptsFolder;
        if (lastFolder !== undefined && folder !== lastFolder) void this.refresh();
        lastFolder = folder;
      }),
    );
    const onConnected = () => {
      void this.refresh();
      this.maybeInstallTestHooks(rpc);
    };
    this.detach.push(
      rpc.onStatus((status) => {
        if (status === 'connected') onConnected();
      }),
    );
    if (rpc.status === 'connected') onConnected();
  }

  /** Reloads the catalogue from the core (idempotent while a load is in flight). */
  refresh(): Promise<void> {
    const rpc = this.rpc;
    if (!rpc) return Promise.resolve();
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const result = (await rpc.request('scripts.list')) as ScriptsListResult;
        this.applyList(result);
        try {
          const last = (await rpc.request('scripts.lastRun')) as { scriptId?: string };
          this.host.setLastRunId(last?.scriptId && this.find(last.scriptId) ? last.scriptId : null);
        } catch {
          // older core without the method: no memory
        }
      } catch {
        // not connected / older core: keep the previous list
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  /** Installs a catalogue (also used by tests without a core). */
  applyList(result: ScriptsListResult): void {
    this.groupsValue = Array.isArray(result?.groups) ? result.groups : [];
    this.issuesValue = Array.isArray(result?.issues) ? result.issues : [];
    this.foldersValue = result?.folders ?? {};
    this.loadedValue = true;
    this.registerDynamicLabels();
    this.registerScriptCommands();
    this.emit();
  }

  /* ----------------------------------------------------------- commands */

  private registerStaticCommands(): void {
    this.commands.replace({
      id: LAST_SCRIPT_COMMAND,
      group: 'scripts',
      labelKey: 'menu.scripts.last',
      tooltipKey: 'cmd.scripts.last.tooltip',
      descriptionKey: 'cmd.scripts.last.description',
      icon: 'id_last_script',
      enabled: (ctx) => {
        this.ensureAttached(ctx);
        if ('dialogs' in ctx && 't' in ctx) this.rememberContext(ctx);
        const last = this.host.lastRunId;
        if (!last) return false;
        const script = this.find(last);
        return !!script && this.canRun(script, ctx);
      },
      run: async (ctx) => {
        const last = this.host.lastRunId;
        const script = last ? this.find(last) : undefined;
        if (script) await this.runScript(script, ctx);
      },
    });
    this.commands.replace({
      id: OPEN_FOLDER_COMMAND,
      group: 'scripts',
      labelKey: 'scripting.menu.openFolder',
      tooltipKey: 'scripting.cmd.openFolder.tooltip',
      descriptionKey: 'scripting.cmd.openFolder.description',
      enabled: (ctx) => ctx.rpc !== null && ctx.store.getState().connection === 'connected',
      run: async (ctx) => {
        await ctx.rpc!.request('resources.openScriptsFolder');
      },
    });
    this.commands.replace({
      id: RELOAD_COMMAND,
      group: 'scripts',
      labelKey: 'scripting.menu.reload',
      tooltipKey: 'scripting.cmd.reload.tooltip',
      descriptionKey: 'scripting.cmd.reload.description',
      enabled: (ctx) => ctx.rpc !== null && ctx.store.getState().connection === 'connected',
      run: async (ctx) => {
        this.ensureAttached(ctx);
        await ctx.rpc!.request('scripts.reload');
        await this.refresh();
        actions.setStatusMessage(
          ctx.store,
          ctx.t('scripting.status.reloaded', { count: this.all().length }) as string,
        );
      },
    });
  }

  /** Attaches lazily from any command context (the menu hook normally does it first). */
  ensureAttached(ctx: Pick<CommandContext, 'rpc'>): void {
    if (ctx.rpc && !this.rpc) this.attach(ctx.rpc);
  }

  /** The React side registers how to obtain a fresh command context (test hooks, tree). */
  setContextProvider(provider: (() => CommandContext) | null): void {
    this.contextProvider = provider;
  }

  /** Remembers the last full command context seen (fallback for the provider). */
  rememberContext(ctx: CommandContext): void {
    this.lastContext = ctx;
  }

  /** A command context for programmatic runs (tree menu, test hooks); null before mount. */
  commandContext(): CommandContext | null {
    return this.contextProvider ? this.contextProvider() : this.lastContext;
  }

  private maybeInstallTestHooks(rpc: RpcClient): void {
    if (this.testHooksInstalled || !this.onTestHooks) return;
    void rpc
      .call('app.info')
      .then((info) => {
        if ((info as { testHooks?: boolean }).testHooks && !this.testHooksInstalled) {
          this.testHooksInstalled = true;
          this.onTestHooks?.(this);
        }
      })
      .catch(() => {
        // no core: no hooks
      });
  }

  private registerDynamicLabels(): void {
    // A group names itself per language in group.json; a language it does not name shows the
    // English name (the scripts' own texts follow the script, not the interface - FR-002).
    const en: Record<string, string> = {};
    const ru: Record<string, string> = {};
    const uk: Record<string, string> = {};
    for (const group of this.groupsValue) {
      const key = dynamicLabelKey('group', group.id || 'root');
      en[key] = group.names.en ?? group.id;
      ru[key] = group.names.ru ?? group.names.en ?? group.id;
      uk[key] = group.names.uk ?? group.names.en ?? group.id;
    }
    const add = (lang: string, entries: Record<string, string>) => {
      const nested: Record<string, unknown> = {};
      for (const [flat, value] of Object.entries(entries)) {
        const parts = flat.split('.');
        let cursor = nested;
        for (const part of parts.slice(0, -1)) {
          cursor = (cursor[part] as Record<string, unknown>) ??= {};
        }
        cursor[parts[parts.length - 1]!] = value;
      }
      i18next.addResourceBundle(lang, 'translation', nested, true, true);
    };
    if (typeof i18next.addResourceBundle === 'function' && i18next.isInitialized) {
      add('en', en);
      add('ru', ru);
      add('uk', uk);
    }
  }

  private registerScriptCommands(): void {
    const current = new Set<string>();
    for (const script of this.all()) {
      const id = scriptCommandId(script.id);
      current.add(id);
      this.commands.replace(this.scriptCommand(script));
    }
    for (const id of this.registered) {
      if (!current.has(id)) this.commands.unregister(id);
    }
    this.registered = current;
    this.hotkeys.addDefaults(
      this.all()
        .filter((script) => !!script.defaultHotkey)
        .map((script) => ({ commandId: scriptCommandId(script.id), keys: script.defaultHotkey! })),
    );
  }

  private scriptCommand(script: ScriptInfo): Command {
    const language = () => this.store.getState().uiLanguage;
    return {
      id: scriptCommandId(script.id),
      group: 'scripts',
      get label() {
        return scriptName(script, language());
      },
      get tooltip() {
        return scriptName(script, language());
      },
      get description() {
        const lang = language();
        return script.description?.[lang] ?? script.description?.en ?? scriptName(script, lang);
      },
      enabled: (ctx) => this.canRun(script, ctx),
      run: async (ctx) => {
        const treeNode = script.kind === 'tree' ? this.treeNodeFromSelection(ctx) : undefined;
        await this.runScript(script, ctx, treeNode ? { treeNode } : {});
      },
    };
  }

  /** Enable state: connected, a document, not Source-only, no run in progress, selection rule. */
  canRun(script: ScriptInfo, ctx: Pick<CommandContext, 'store' | 'rpc'>): boolean {
    const state = ctx.store.getState();
    if (!ctx.rpc || state.connection !== 'connected' || !state.document || state.sourceOnly) {
      return false;
    }
    if (this.host.isRunning) return false;
    if (script.needsSelection) {
      const controller = hasBodyController(ctx.store) ? getBodyController(ctx.store) : null;
      if (!controller) return false;
      return !controller.getContext().empty;
    }
    return true;
  }

  private treeNodeFromSelection(ctx: Pick<CommandContext, 'store'>): NodeRef | undefined {
    const nodeId = ctx.store.getState().selectionNodeId;
    if (!nodeId) return undefined;
    const document = ctx.store.getState().document;
    if (!document) return undefined;
    const type = findType(document.bodies as unknown as JsonNode[], nodeId);
    return type ? { nodeId, type } : undefined;
  }

  /**
   * Runs a script from a command context: switches to the Body view first (through the
   * `view.body` command so a dirty Source text is parsed), then hands over to the host.
   */
  async runScript(
    script: ScriptInfo,
    ctx: CommandContext,
    options: { treeNode?: NodeRef } = {},
  ): Promise<RunResult> {
    this.ensureAttached(ctx);
    const state = ctx.store.getState();
    if (!state.document) {
      await ctx.dialogs.showMessage({
        text: ctx.t('scripting.noDocument'),
        caption: ctx.t('scripting.error.caption'),
        icon: 'warning',
        testId: 'dialog-script-error',
      });
      return { status: 'unavailable', message: 'no document' };
    }
    if (state.activeView !== 'body') {
      if (this.commands.has('view.body')) await this.commands.execute('view.body', ctx);
      else switchView(ctx, 'body');
      if (ctx.store.getState().activeView !== 'body') {
        return { status: 'unavailable', message: 'the Body view is not available' };
      }
    }
    return this.host.run(script, {
      rpc: ctx.rpc,
      dialogs: ctx.dialogs,
      t: ctx.t,
      uiLanguage: ctx.store.getState().uiLanguage,
      treeNode: options.treeNode,
    });
  }

  /* --------------------------------------------------------------- menus */

  /** Items of the Scripts menu: group sub-menus in `NN` order, then the housekeeping entries. */
  menuItems(): MenuItemSpec[] {
    const items: MenuItemSpec[] = [];
    const visible = this.groupsValue.filter((group) =>
      group.scripts.some((script) => script.kind === 'menu'),
    );
    for (const group of visible) {
      const scripts = group.scripts
        .filter((script) => script.kind === 'menu')
        .map<MenuItemSpec>((script) => ({
          kind: 'command',
          commandId: scriptCommandId(script.id),
        }));
      if (group.id === '') {
        items.push(...scripts);
      } else {
        items.push({
          kind: 'submenu',
          id: group.id,
          labelKey: dynamicLabelKey('group', group.id),
          items: scripts,
        });
      }
    }
    if (items.length === 0) {
      items.push({ kind: 'placeholder', id: 'none', labelKey: 'menu.scripts.none' });
    }
    items.push({ kind: 'separator' });
    items.push({ kind: 'command', commandId: LAST_SCRIPT_COMMAND });
    items.push({ kind: 'separator' });
    items.push({ kind: 'command', commandId: OPEN_FOLDER_COMMAND });
    items.push({ kind: 'command', commandId: RELOAD_COMMAND });
    return items;
  }
}

interface JsonNode {
  type: string;
  attrs?: { nodeId?: unknown };
  content?: JsonNode[];
}

function findType(nodes: JsonNode[], nodeId: string): string | null {
  for (const node of nodes) {
    if (node.attrs?.nodeId === nodeId) return node.type;
    if (node.content) {
      const found = findType(node.content, nodeId);
      if (found) return found;
    }
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/* Registry                                                                 */
/* ------------------------------------------------------------------------ */

const features = new WeakMap<AppStore, ScriptsFeature>();

export function installScriptsFeature(options: ScriptsFeatureOptions): ScriptsFeature {
  let feature = features.get(options.store);
  if (!feature) {
    feature = new ScriptsFeature(options);
    features.set(options.store, feature);
  }
  return feature;
}

export function getScriptsFeature(store: AppStore): ScriptsFeature | undefined {
  return features.get(store);
}
