/**
 * Application shell: menu bar, toolbars, document tree, view area with the Description / Body /
 * Source switcher, the validation panel, status bar and the dialog layer. Wires the RPC client
 * lifecycle (status, settings, job progress notifications), the document notifications
 * (`doc.changedOnDisk`, `app.openPaths`), the Recent Files list, the `?new=1` / `?lang=` start-up
 * parameters and the global hotkey dispatcher.
 */

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { DialogHost, ValidationPanel, createIssueNavigator } from '@/dialogs';
import { changeLanguage, resolveUiLanguage } from '@/i18n';
import { actions, documentFileName, useAppState } from '@/model/store';
import { BodyView } from '@/views/body/BodyView';
import { DescriptionView } from '@/views/description/DescriptionView';
import { SourceView } from '@/views/source/SourceView';
import { DocumentTree } from '@/views/tree/DocumentTree';
import { getSettingsFeature } from '@/features/settings';
import { useScriptsMenu } from '@/scripting/ScriptsMenu';
import { ScriptsToolbar } from '@/scripting/ScriptsToolbar';

import { AppProvider } from './AppContext';
import { installGlobalErrorLogging } from './diagnostics';
import { createAppServices, useAppServices, useCommandContext, type AppServices } from './services';
import { MenuBar } from './MenuBar';
import type { DynamicMenuItems } from './menus';
import { forcedLanguage } from './startup';
import { StatusBar } from './StatusBar';
import { applyStoredTheme } from './theme';
import { Toolbars } from './Toolbars';
import { ViewSwitcher } from './ViewSwitcher';

import './layout.css';

/**
 * Commands a text field in a modeless dialog keeps for itself, as in the original (its main
 * window sent Undo, Redo, Cut, Copy and Paste to the focused control).
 */
const FIELD_EDIT_COMMANDS: ReadonlySet<string> = new Set([
  'edit.undo',
  'edit.redo',
  'edit.cut',
  'edit.copy',
  'edit.paste',
]);

/** Keys a modeless dialog handles before the application (Enter, Escape, Tab, Alt+letter). */
function isDialogKey(event: KeyboardEvent): boolean {
  return (
    event.key === 'Enter' ||
    event.key === 'Escape' ||
    event.key === 'Tab' ||
    (event.altKey && event.key.length === 1)
  );
}

// Theme before the first paint (as far as the CSP allows: no inline script): the mirrored
// setting of the previous session applies while this module loads, the settings runtime
// (`features/settings/apply.ts`) switches to `view.theme` once `settings.get` answered.
applyStoredTheme();

export interface AppProps {
  /** Pre-built services (tests, main.tsx). Created without an RPC client when omitted. */
  services?: AppServices;
  dynamicMenuItems?: DynamicMenuItems;
  /** Page query string (`?new=1&lang=ru`); defaults to `window.location.search`. */
  startupSearch?: string;
}

export function App({ services: providedServices, dynamicMenuItems, startupSearch }: AppProps) {
  const services = useMemo(() => providedServices ?? createAppServices(), [providedServices]);
  return (
    <AppProvider services={services}>
      <Shell dynamicMenuItems={dynamicMenuItems} startupSearch={startupSearch} />
    </AppProvider>
  );
}

function Shell({
  dynamicMenuItems,
  startupSearch,
}: {
  dynamicMenuItems?: DynamicMenuItems;
  startupSearch?: string;
}) {
  const { t, i18n } = useTranslation();
  const services = useAppServices();
  const ctx = useCommandContext();
  const { store, rpc, hotkeys, commands, dialogs, files } = services;
  const activeView = useAppState((s) => s.activeView, store);
  const treeVisible = useAppState((s) => s.treeVisible, store);
  const path = useAppState((s) => s.path, store);
  const modified = useAppState((s) => s.modified, store);
  const hasDocument = useAppState((s) => s.document !== null, store);
  const validation = useAppState((s) => s.validation, store);
  const search = startupSearch ?? (typeof window !== 'undefined' ? window.location.search : '');
  // Latest command context for notification handlers (updated after every render).
  const ctxRef = useRef(ctx);
  useEffect(() => {
    ctxRef.current = ctx;
  });

  // RPC lifecycle: connection status, settings, job progress.
  useEffect(() => {
    if (!rpc) return;
    const offStatus = rpc.onStatus((status) => actions.setConnection(store, status));
    const offSettings = rpc.on('settings.changed', ({ settings }) => {
      actions.setSettings(store, settings);
    });
    const offProgress = rpc.on('job.progress', (progress) => actions.setProgress(store, progress));
    const offDone = rpc.on('job.done', () => actions.setProgress(store, null));
    const offFailed = rpc.on('job.failed', () => actions.setProgress(store, null));
    const offFiles = files.subscribeNotifications(rpc, () => ctxRef.current);
    const offErrors = installGlobalErrorLogging(rpc, store); // FR-131: uncaught errors
    actions.setConnection(store, rpc.status);
    rpc.connect();
    return () => {
      offStatus();
      offSettings();
      offProgress();
      offDone();
      offFailed();
      offFiles();
      offErrors();
    };
  }, [rpc, store, files]);

  // Once connected: settings (toolbars, language, fonts), the Recent Files list, `?new=1`.
  const connection = useAppState((s) => s.connection, store);
  const startupHandled = useRef(false);
  useEffect(() => {
    if (!rpc || connection !== 'connected') return;
    let cancelled = false;
    const forced = forcedLanguage(search);
    rpc
      .call('settings.get')
      .then(async (settings) => {
        if (cancelled) return;
        actions.setSettings(store, settings);
        // The OS language comes from the core: inside CEF `navigator.languages` is en-US
        // on Windows/macOS unless the shell set a locale.
        const systemLanguage = await rpc
          .call('app.info')
          .then((info) => info.systemLanguage ?? null)
          .catch(() => null);
        if (cancelled) return;
        const language =
          forced ?? resolveUiLanguage(settings.view.uiLanguage, undefined, systemLanguage);
        actions.setUiLanguage(store, language);
        await changeLanguage(language, i18n);
      })
      .catch(() => {
        // The core is older/newer or settings are unavailable: keep the defaults.
      });
    void files.recent.refresh(rpc);
    void getSettingsFeature(store)?.attach(rpc);
    if (!startupHandled.current) {
      startupHandled.current = true;
      void files.handleStartup(ctxRef.current, search).catch(() => {
        // a failing doc.new at start-up leaves the editor empty; File > New reports errors
      });
    }
    return () => {
      cancelled = true;
    };
  }, [rpc, connection, store, i18n, files, search]);

  // `?lang=` applies even before the core answers (and without a core).
  useEffect(() => {
    const forced = forcedLanguage(search);
    if (forced) {
      actions.setUiLanguage(store, forced);
      void changeLanguage(forced, i18n);
    }
  }, [search, store, i18n]);

  // Global hotkeys. Capture phase: as in the original (TranslateAccelerator before the message
  // reaches the view), an enabled command's chord wins over menu mnemonics and editor keymaps.
  // Not while a modal dialog is open; in a modeless dialog its own keys and the editing
  // commands of its fields come first.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || dialogs.service.isModalOpen) return;
      const inModeless =
        event.target instanceof Element && event.target.closest('.mfbe-dialog-modeless') !== null;
      if (inModeless && isDialogKey(event)) return;
      hotkeys.handleKeyDown(event, (id) =>
        inModeless && FIELD_EDIT_COMMANDS.has(id) ? false : commands.dispatch(id, ctx),
      );
    };
    document.addEventListener('keydown', onKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [commands, ctx, dialogs.service, hotkeys]);

  // Window title: "<file>[*] - Maxima Fiction Book Editor".
  useEffect(() => {
    const name = hasDocument ? (documentFileName({ path }) ?? t('app.untitled')) : null;
    document.title = name
      ? t('app.windowTitle', {
          document: `${name}${modified ? t('app.modifiedMarker') : ''}`,
          app: t('app.name'),
        })
      : t('app.name');
  }, [hasDocument, path, modified, t]);

  // <html lang> follows the interface language.
  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  const recentFiles = useSyncExternalStore(
    files.recent.subscribe,
    () => files.recent.files,
    () => files.recent.files,
  );
  const scriptsMenu = useScriptsMenu();
  const menuItems = useMemo<DynamicMenuItems>(
    () => ({
      ...dynamicMenuItems,
      recent: recentFiles.length > 0 ? files.recent.menuItems() : [],
      scripts: scriptsMenu,
    }),
    [dynamicMenuItems, files, recentFiles, scriptsMenu],
  );

  const navigateToIssue = useMemo(() => createIssueNavigator(ctx), [ctx]);

  return (
    <div className="mfbe-app" data-testid="app-root" data-active-view={activeView}>
      <MenuBar dynamicItems={menuItems} />
      <Toolbars scripts={<ScriptsToolbar />} />
      <div className="mfbe-main">
        {treeVisible ? (
          <aside className="mfbe-tree-panel" data-testid="tree-panel">
            <DocumentTree />
          </aside>
        ) : null}
        <section className="mfbe-view-area" data-testid="view-area">
          <ViewSwitcher />
          <div className="mfbe-view-content">
            {activeView === 'description' ? <DescriptionView /> : null}
            {activeView === 'body' ? <BodyView /> : null}
            {activeView === 'source' ? <SourceView /> : null}
          </div>
          {validation ? (
            <ValidationPanel
              report={validation}
              onNavigate={(issue) => void navigateToIssue(issue)}
              onClose={() => actions.setValidation(store, null)}
            />
          ) : null}
        </section>
      </div>
      <StatusBar />
      <DialogHost service={dialogs.service} />
    </div>
  );
}
