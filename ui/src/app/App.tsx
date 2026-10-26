/**
 * Application shell: menu bar, toolbars, document tree with the divider that resizes it
 * (feature 004 US1), view area with the Description / Body / Source switcher, the script run
 * banner and the transient notice (feature 003), the validation panel, status bar and the
 * dialog layer. Wires the RPC client lifecycle (status, settings, job progress notifications),
 * the document notifications (`doc.changedOnDisk`, `app.openPaths`), the Recent Files list, the
 * `?new=1` / `?lang=` start-up parameters, the scheduled check for a new version once the window
 * is usable (feature 003 US5) and the global hotkey dispatcher.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';

import { getAiFeature, type AiFeatureStatus } from '@/ai';
import { DisabledPanel } from '@/ai/DisabledPanel';
import { DialogHost, ValidationPanel, createIssueNavigator } from '@/dialogs';
import { changeLanguage, resolveUiLanguage } from '@/i18n';
import { actions, documentFileName, useAppState } from '@/model/store';
import { BodyView } from '@/views/body/BodyView';
import { DescriptionView } from '@/views/description/DescriptionView';
import { SourceView } from '@/views/source/SourceView';
import { DocumentTree } from '@/views/tree/DocumentTree';
import { runScheduledCheck } from '@/features/help';
import { getSettingsFeature } from '@/features/settings';
import { getScriptsFeature } from '@/scripting/catalog';
import { ScriptRunBanner } from '@/scripting/ScriptRunBanner';
import { useScriptsMenu } from '@/scripting/ScriptsMenu';
import { useScriptToolbarButtons } from '@/scripting/useScriptToolbarButtons';

import { AppProvider } from './AppContext';
import { installGlobalErrorLogging } from './diagnostics';
import { createAppServices, useAppServices, useCommandContext, type AppServices } from './services';
import { MenuBar } from './MenuBar';
import type { DynamicMenuItems } from './menus';
import {
  AI_PANEL_WIDTH_VARIABLE,
  TREE_WIDTH_VARIABLE,
  attachSplitterDrag,
  clampPanelWidth,
  clampTreeWidth,
} from './splitter';
import { forcedLanguage, openPathAtStartup } from './startup';
import { StatusBar } from './StatusBar';
import { followTextFieldFocus, textFieldOf } from './textFields';
import { applyStoredTheme } from './theme';
import { Toolbars } from './Toolbars';
import { TransientNotice } from './TransientNotice';
import { ViewSwitcher } from './ViewSwitcher';

import './layout.css';

const NO_SUBSCRIPTION = () => () => {};

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

/**
 * Keys a text field of the AI assistant panel keeps for itself (feature 005 FR-105): Enter
 * sends and Shift+Enter breaks the line there (`edit.split` is bound to Shift+Enter in the
 * Body view), Escape changes nothing, Tab moves on. Alt+letter still opens the menus.
 */
function isPanelFieldKey(event: KeyboardEvent): boolean {
  return event.key === 'Enter' || event.key === 'Escape' || event.key === 'Tab';
}

/** True when the key went to a text field of the AI assistant panel. */
function inAiPanelField(event: KeyboardEvent): boolean {
  const field = textFieldOf(event.target);
  return field !== null && field.closest('.mfbe-ai-panel') !== null;
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
  const treeWidth = useAppState((s) => s.treeWidth, store);
  const aiVisible = useAppState((s) => s.ai.visible, store);
  const aiOn = useAppState((s) => s.ai.on, store);
  const aiWidth = useAppState((s) => s.ai.width, store);
  // The feature's status (feature 005 FR-096 as amended): a visible panel is the live one while
  // the assistant is on and the inert, static one while the mode is Disabled; before the first
  // settings snapshot (`waiting`), with an older core or while the chunk still loads, no pane.
  const aiFeature = getAiFeature(store);
  const subscribeAiStatus = useCallback(
    (listener: () => void) => aiFeature?.subscribe(listener) ?? NO_SUBSCRIPTION(),
    [aiFeature],
  );
  const aiStatus = useSyncExternalStore<AiFeatureStatus>(
    subscribeAiStatus,
    () => aiFeature?.status ?? 'waiting',
    () => 'waiting',
  );
  const aiInert = aiVisible && aiStatus === 'disabled';
  const aiPane = aiVisible && (aiOn || aiInert);
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
  const languageResolved = useRef<string | null>(null);
  const [languageResolvedTick, setLanguageResolvedTick] = useState(0);
  useEffect(() => {
    if (!rpc || connection !== 'connected') return;
    let cancelled = false;
    const forced = forcedLanguage(search);
    const settingsLoaded = rpc
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
        languageResolved.current = language;
        await changeLanguage(language, i18n);
      })
      .catch(() => {
        // The core is older/newer or settings are unavailable: keep the defaults.
      })
      .finally(() => {
        // The start-up language is settled; the <html lang> effect below publishes it.
        setLanguageResolvedTick((tick) => tick + 1);
      });
    void files.recent.refresh(rpc);
    void getSettingsFeature(store)?.attach(rpc);
    if (!startupHandled.current) {
      startupHandled.current = true;
      // `?open=<path>` (feature 003 US3): the browser-mode restart reopens its document first.
      const openPath = openPathAtStartup(search);
      const startup = files.handleStartup(ctxRef.current, openPath).catch(() => {
        // a failing doc.new at start-up leaves the editor empty; File > New reports errors
      });
      // The scheduled check for a new version (feature 003 US5, FR-042): once the window is
      // usable - the settings read, the first document shown - and never on the restart path,
      // whose start the user has just been through.
      if (!openPath) {
        void Promise.all([settingsLoaded, startup]).then(() =>
          runScheduledCheck(ctxRef.current, { dialogs: dialogs.service, rpc, store }).catch(() => {
            // the check is a courtesy: whatever went wrong, the next start tries again
          }),
        );
      }
    }
    return () => {
      cancelled = true;
    };
  }, [rpc, connection, store, i18n, files, search, dialogs.service]);

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
  // commands of its fields come first, and so do the AI panel's instruction field's keys
  // (Enter sends, Shift+Enter breaks the line) and its editing commands (feature 005 FR-105).
  // A command with a hotkey scope (the table commands, feature 006 C6) takes its chord only
  // while the key is aimed inside the scope's element; elsewhere the key goes on unconsumed.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || dialogs.service.isModalOpen) return;
      const inModeless =
        event.target instanceof Element && event.target.closest('.mfbe-dialog-modeless') !== null;
      if (inModeless && isDialogKey(event)) return;
      const inPanelField = !inModeless && inAiPanelField(event);
      if (inPanelField && isPanelFieldKey(event)) return;
      hotkeys.handleKeyDown(event, (id) => {
        if ((inModeless || inPanelField) && FIELD_EDIT_COMMANDS.has(id)) return false;
        if (!commands.allowsHotkey(id, event.target)) return false;
        return commands.dispatch(id, ctx);
      });
    };
    document.addEventListener('keydown', onKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [commands, ctx, dialogs.service, hotkeys]);

  // No browser menu anywhere (FR-064): the places with a menu of their own show it, text
  // fields keep the shell's edit menu, everything else shows nothing.
  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (!textFieldOf(event.target)) event.preventDefault();
    };
    document.addEventListener('contextmenu', onContextMenu);
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, []);

  // The Edit menu and the toolbar act on the text field the focus left for them.
  useEffect(() => followTextFieldFocus(), []);

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

  // <html lang> follows the interface language; once the start-up language is settled the
  // page says so (`data-lang-resolved`): the journeys read texts in the page's language only
  // from then on, as the page shows the browser's language until the core has answered.
  useEffect(() => {
    document.documentElement.lang = i18n.language;
    if (languageResolved.current === i18n.language) {
      document.documentElement.dataset.langResolved = '1';
    }
  }, [i18n.language, languageResolvedTick]);

  // Document Tree pane width (feature 004 US1, FR-002): the stored width is applied to the
  // layout variable clamped to the main area - the pane never under its minimum, the view never
  // under its own, the AI panel (feature 005) keeping its applied width while it is shown - and
  // re-applied when the window changes size, so a width from a larger screen comes back when
  // the window grows; the stored value itself is never rewritten. The drag
  // (`attachSplitterDrag`) writes the same variable per frame with the same clamp and commits
  // once to the store when the button is released. The panel's clamp comes first: the tree
  // pane's reserves the width the panel takes (see `app/splitter.ts` for the order).
  const mainRef = useRef<HTMLDivElement>(null);
  const splitterRef = useRef<HTMLDivElement>(null);
  const aiSplitterRef = useRef<HTMLDivElement>(null);
  const panelClamp = useCallback(
    (width: number, mainWidth: number) =>
      clampPanelWidth(
        width,
        mainWidth,
        treeVisible ? clampTreeWidth(treeWidth, mainWidth, 0, false) : 0,
        treeVisible,
      ),
    [treeWidth, treeVisible],
  );
  const treeClamp = useCallback(
    (width: number, mainWidth: number) =>
      clampTreeWidth(width, mainWidth, aiPane ? panelClamp(aiWidth, mainWidth) : 0, aiPane),
    [aiPane, aiWidth, panelClamp],
  );
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const apply = () => {
      main.style.setProperty(TREE_WIDTH_VARIABLE, `${treeClamp(treeWidth, main.clientWidth)}px`);
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(apply);
    observer.observe(main);
    return () => observer.disconnect();
  }, [treeWidth, treeClamp]);
  useEffect(() => {
    const divider = splitterRef.current;
    const main = mainRef.current;
    if (!divider || !main) return;
    return attachSplitterDrag(divider, main, (width) => actions.setTreeWidth(store, width), {
      clamp: treeClamp,
    });
  }, [store, treeVisible, treeClamp]);

  // The AI assistant panel on the right (feature 005 US3, FR-040; data-model §3.2): the same
  // scheme mirrored - the stored `ai.width` applied clamped to 280-800 px and to what the main
  // area leaves beside the tree pane and the view's minimum, re-applied on resize, never
  // rewritten; its divider drags the pane after it and commits once to the store. The pane is
  // the live panel's and the inert one's alike.
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main || !aiPane) return;
    const apply = () => {
      main.style.setProperty(AI_PANEL_WIDTH_VARIABLE, `${panelClamp(aiWidth, main.clientWidth)}px`);
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(apply);
    observer.observe(main);
    return () => observer.disconnect();
  }, [aiPane, aiWidth, panelClamp]);
  useEffect(() => {
    const divider = aiSplitterRef.current;
    const main = mainRef.current;
    if (!divider || !main || !aiPane) return;
    return attachSplitterDrag(divider, main, (width) => actions.setAiPanelWidth(store, width), {
      side: 'right',
      variable: AI_PANEL_WIDTH_VARIABLE,
      clamp: panelClamp,
    });
  }, [store, aiPane, panelClamp]);

  const recentFiles = useSyncExternalStore(
    files.recent.subscribe,
    () => files.recent.files,
    () => files.recent.files,
  );
  const scriptsMenu = useScriptsMenu();
  const scriptToolbarButtons = useScriptToolbarButtons();
  const menuItems = useMemo<DynamicMenuItems>(
    () => ({
      ...dynamicMenuItems,
      recent: recentFiles.length > 0 ? files.recent.menuItems() : [],
      scripts: scriptsMenu,
    }),
    [dynamicMenuItems, files, recentFiles, scriptsMenu],
  );

  const navigateToIssue = useMemo(() => createIssueNavigator(ctx), [ctx]);

  // The live panel's content comes with the lazy chunk the feature imports before it turns the
  // assistant on (feature 005 US3, T052); without the feature (bare renders) the pane is empty.
  // While Disabled the pane holds the static inert panel instead (FR-096; no chunk).
  const AiPanel = aiOn ? (aiFeature?.panel ?? null) : null;

  // Busy pointer over the document pane while a script computes - not while it waits for the
  // user in one of its own dialogs (feature 003, FR-011).
  const scriptsFeature = getScriptsFeature(store);
  const scriptBusy = useSyncExternalStore(
    scriptsFeature?.host.subscribe ?? NO_SUBSCRIPTION,
    () => !!scriptsFeature?.host.isRunning && !scriptsFeature.host.current?.waiting,
    () => false,
  );

  // `spellCheck={false}` on the root (feature 004 US9, FR-081): the HTML `spellcheck` state is
  // inherited by every descendant without an attribute of its own, so the browser engine's own
  // checker never marks a Description field, a dialog input or a bar - whatever dictionaries the
  // system has; the editor's own checker (the Body view's plugin) is the only source of marks.
  // The shell switches the engine's checker off as a whole as well (browser.enable_spellchecking).
  return (
    <div
      className="mfbe-app"
      data-testid="app-root"
      data-active-view={activeView}
      spellCheck={false}
    >
      <MenuBar dynamicItems={menuItems} />
      <Toolbars scripts={scriptToolbarButtons} />
      <div className="mfbe-main" ref={mainRef}>
        {treeVisible ? (
          <>
            <aside className="mfbe-tree-panel" data-testid="tree-panel" data-tree-width={treeWidth}>
              <DocumentTree />
            </aside>
            <div
              ref={splitterRef}
              className="mfbe-splitter"
              role="separator"
              aria-orientation="vertical"
              aria-label={t('tree.splitter')}
              data-testid="tree-splitter"
            />
          </>
        ) : null}
        <section className="mfbe-view-area" data-testid="view-area">
          <ViewSwitcher />
          <ScriptRunBanner />
          <div className={`mfbe-view-content${scriptBusy ? ' mfbe-busy' : ''}`}>
            {activeView === 'description' ? <DescriptionView /> : null}
            {activeView === 'body' ? <BodyView /> : null}
            {activeView === 'source' ? <SourceView /> : null}
          </div>
          <TransientNotice />
          {validation ? (
            <ValidationPanel
              report={validation}
              onNavigate={(issue) => void navigateToIssue(issue)}
              onClose={() => actions.setValidation(store, null)}
            />
          ) : null}
        </section>
        {aiPane ? (
          <>
            <div
              ref={aiSplitterRef}
              className="mfbe-splitter"
              role="separator"
              aria-orientation="vertical"
              aria-label={t('ai.panel.splitter')}
              data-testid="ai-splitter"
            />
            <aside
              className="mfbe-ai-panel"
              data-testid="ai-panel"
              data-ai-width={aiWidth}
              data-ai-inert={aiInert ? 'true' : undefined}
            >
              {aiInert ? <DisabledPanel /> : AiPanel ? <AiPanel /> : null}
            </aside>
          </>
        ) : null}
      </div>
      <StatusBar />
      <DialogHost service={dialogs.service} />
    </div>
  );
}
