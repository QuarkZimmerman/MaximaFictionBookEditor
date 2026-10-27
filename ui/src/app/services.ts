/**
 * Application services (store, RPC client, command registry, hotkeys, undo coordinator,
 * dialogs), the React context that carries them and the hooks the shell components use.
 * `AppProvider` (AppContext.tsx) is the only component; everything else lives here so that
 * fast refresh keeps working for the component files.
 */

import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { DialogService, createDialogs, type Dialogs } from '@/dialogs';
import { FileFeature, registerFileCommands } from '@/features/file/fileCommands';
import i18next from '@/i18n';
import { CaretRegistry } from '@/model/caret';
import { appStore, type AppStore } from '@/model/store';
import { UndoCoordinator } from '@/model/undo';
import type { RpcClient } from '@/rpc/client';
import type { Platform, ViewId } from '@/rpc/types';
import { featureRegistrars } from '@/features/registry';
import { subscribeTableTargets } from '@/features/tables/target';
import { getBodyController, hasBodyController } from '@/views/body/bodyEditor';
import { getSourceEditor } from '@/views/source/sourceEditor';
import { registerViewCommands } from '@/views/source/sourceSession';

import { CommandRegistry, createCommandRegistry, type CommandContext } from './commands';
import { HotkeyMap, detectPlatform } from './hotkeys';

/** What a feature registrar receives; keep it minimal and stable. */
export interface FeatureContext {
  commands: CommandRegistry;
  /** RPC client when the app runs against a core (null in UI-only tests). */
  rpc?: RpcClient | null;
  undo: UndoCoordinator;
  carets: CaretRegistry;
  store: AppStore;
  hotkeys: HotkeyMap;
  /**
   * The command context of the services, for flows that start outside a command (feature 006
   * US8: the irregular-table mark's click opens its popover). Optional, so feature tests may
   * pass a context without it.
   */
  getCommandContext?(): CommandContext;
}

export interface AppServices {
  store: AppStore;
  rpc: RpcClient | null;
  commands: CommandRegistry;
  hotkeys: HotkeyMap;
  undo: UndoCoordinator;
  dialogs: Dialogs & { service: DialogService };
  /** Per-view caret providers (Restore position, Recent Files caret, go-to-issue). */
  carets: CaretRegistry;
  /** File menu flows, Recent Files list and document notifications (T052/T054). */
  files: FileFeature;
  platform: Platform;
  version: string;
  /** Subscribe to "anything that may change a command state" (store, undo, hotkeys, registry). */
  subscribeAll: (listener: () => void) => () => void;
  /** Monotonic counter bumped on every change; drives `useSyncExternalStore`. */
  getRevision: () => number;
}

export interface CreateAppServicesOptions {
  store?: AppStore;
  rpc?: RpcClient | null;
  commands?: CommandRegistry;
  hotkeys?: HotkeyMap;
  undo?: UndoCoordinator;
  dialogService?: DialogService;
  carets?: CaretRegistry;
  files?: FileFeature;
  platform?: Platform;
  version?: string;
}

export function createAppServices(options: CreateAppServicesOptions = {}): AppServices {
  const store = options.store ?? appStore;
  const platform = options.platform ?? detectPlatform();
  const commands = options.commands ?? createCommandRegistry();
  const hotkeys = options.hotkeys ?? new HotkeyMap(platform);
  const undo = options.undo ?? new UndoCoordinator();
  const dialogs = createDialogs(options.dialogService ?? new DialogService());
  const carets = options.carets ?? new CaretRegistry();
  // The File flows and the parse-before-leaving view commands take over the foundation stubs.
  const files = options.files ?? registerFileCommands(commands);
  registerViewCommands(commands);
  // Feature modules (editing, source tools, description, tree, spelling, images, words,
  // settings, scripts) register their commands/plugins through their own registrar file;
  // see src/features/registry.ts. Each registrar owns exactly one directory.
  const version =
    options.version ?? (typeof __MFBE_UI_VERSION__ === 'string' ? __MFBE_UI_VERSION__ : '');
  const featureContext: FeatureContext = {
    commands,
    rpc: options.rpc ?? null,
    undo,
    carets,
    store,
    hotkeys,
    getCommandContext: () => ({
      store,
      rpc: options.rpc ?? null,
      undo,
      dialogs,
      hotkeys,
      carets,
      t: i18next.t,
      version,
    }),
  };
  for (const register of featureRegistrars) register(featureContext);

  let revision = 0;
  const listeners = new Set<() => void>();
  const bump = () => {
    revision += 1;
    for (const listener of [...listeners]) listener();
  };
  let unsubscribeSources: (() => void)[] = [];

  const subscribeAll = (listener: () => void) => {
    if (listeners.size === 0) {
      // Lazily attach to the underlying sources while at least one React subscriber exists.
      unsubscribeSources = [
        store.subscribe(bump),
        undo.subscribe(bump),
        hotkeys.subscribe(bump),
        commands.subscribe(bump),
      ];
      // Body selection changes inside one block do not touch the store but do change command
      // states (styles, scripts needing a selection, Links/Table bars).
      if (hasBodyController(store)) {
        unsubscribeSources.push(getBodyController(store).subscribeContext(bump));
      }
      // The active table edit target and its selection (feature 006, data-model §6.1): the
      // table commands' states and reasons follow them.
      unsubscribeSources.push(subscribeTableTargets(store, bump));
      // The Source view's table verdict (feature 006, I23): `insert.table` follows the cursor
      // there, notified when the verdict changes (the Source feature made the controller).
      const source = getSourceEditor(store);
      if (source) unsubscribeSources.push(source.subscribeContext(bump));
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        for (const off of unsubscribeSources) off();
        unsubscribeSources = [];
      }
    };
  };

  // Undo/redo of an entry owned by another view activates that view.
  undo.setActivateView((view) => {
    if (view === 'body' || view === 'source' || view === 'description') {
      store.setState({ activeView: view as ViewId });
    }
  });

  return {
    store,
    rpc: options.rpc ?? null,
    commands,
    hotkeys,
    undo,
    dialogs,
    carets,
    files,
    platform,
    version,
    subscribeAll,
    getRevision: () => revision,
  };
}

export const AppServicesContext = createContext<AppServices | null>(null);

export function useAppServices(): AppServices {
  const services = useContext(AppServicesContext);
  if (!services) throw new Error('useAppServices must be used inside <AppProvider>');
  return services;
}

/** Re-renders the caller whenever any command-relevant state changed. Returns the revision. */
export function useAppRevision(): number {
  const services = useAppServices();
  return useSyncExternalStore(services.subscribeAll, services.getRevision, services.getRevision);
}

/** The `CommandContext` for running commands and evaluating their states from React. */
export function useCommandContext(): CommandContext {
  const services = useAppServices();
  const { t } = useTranslation();
  return useMemo<CommandContext>(
    () => ({
      store: services.store,
      rpc: services.rpc,
      undo: services.undo,
      dialogs: services.dialogs,
      hotkeys: services.hotkeys,
      carets: services.carets,
      t,
      version: services.version,
    }),
    [services, t],
  );
}

export interface CommandState {
  exists: boolean;
  enabled: boolean;
  checked: boolean;
  hotkey: string | undefined;
}

/** Enabled/checked/hotkey state of one command, kept fresh through `useAppRevision()`. */
export function useCommandState(id: string): CommandState {
  const services = useAppServices();
  const ctx = useCommandContext();
  useAppRevision();
  return {
    exists: services.commands.has(id),
    enabled: services.commands.isEnabled(id, ctx),
    checked: services.commands.isChecked(id, ctx),
    hotkey: services.hotkeys.display(id),
  };
}

/** Runs a command by id (no-op when disabled). */
export function useRunCommand(): (id: string) => Promise<boolean> {
  const services = useAppServices();
  const ctx = useCommandContext();
  return useMemo(() => (id: string) => services.commands.execute(id, ctx), [services, ctx]);
}
