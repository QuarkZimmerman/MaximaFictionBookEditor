/**
 * Settings dialog (US9, T129): the tabbed shell with the View / Other / Hotkeys / Words pages
 * - and, since feature 005, the AI assistant page - and the OK / Cancel / Apply buttons of the
 * original property sheet. The pages edit a draft copy of the settings (and a scratch copy of
 * the hotkey map); OK / Apply validate the draft, run the optional pre-apply hook
 * (`beforeApply`: feature 005 US9 asks before Disabled takes effect while a request runs), send
 * one `settings.set` patch with the changed leaves, copy the hotkey overrides into the live map
 * (`hotkeys.set`) and, when the core reports `restartRequired` (interface language), show "In
 * order to process changes the program must be restarted. Restart now?" - Yes runs the usual
 * save prompt (Cancel abandons the restart) and then `app.restart({reopen: path})` (feature 003
 * US3, rpc-api.md §3.1): the shell starts the editor again with the same options, window
 * placement and document and quits. Without a shell (browser/dev mode, error 1070) the page
 * reloads itself with `?open=<path>`; when the shell could not start the new instance (1071)
 * the failure is shown and the editor stays open. A page that started a job (the AI page's
 * Test connection) registers a canceller; closing the dialog runs every registered one
 * (feature 005 review A4).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useTranslation } from 'react-i18next';

import { confirmDiscardChanges, createCommandRegistry, type CommandContext } from '@/app/commands';
import { restartUrl } from '@/app/startup';
import { leaveDocument } from '@/features/file/fileCommands';
import {
  cloneSettings,
  isEmptyPatch,
  settingsPatch,
  type SettingsFeature,
} from '@/features/settings/apply';
import { getSpellFeature } from '@/features/spell';
import { actions } from '@/model/store';
import { RpcError } from '@/rpc/client';
import { RpcErrorCode, type OcrCatalogReport, type Settings } from '@/rpc/types';

import { AiPage } from './settings/AiPage';
import { Dialog, type DialogButton } from './Dialog';
import { HotkeysPage } from './settings/HotkeysPage';
import { createScratchHotkeys, sameUserBindings } from './settings/hotkeysModel';
import { ImportsPage } from './settings/ImportsPage';
import { MaximaLibraryPage } from './settings/MaximaLibraryPage';
import {
  buildSaveConfigParams,
  canSaveMaximaLibraryDraft,
  createMaximaLibraryDraft,
  isMaximaLibraryDraftDirty,
  revertMaximaLibraryDraft,
  shouldRevertMaximaLibraryOnTabLeave,
  snapshotFromSettings,
  snapshotFromStatus,
  type MaximaLibraryDraftState,
  type MaximaLibrarySavedSnapshot,
} from './settings/maximaLibraryModel';
import { validateSettings, type SettingsValidationError } from './settings/model';
import { OcrPage } from './settings/OcrPage';
import { OtherPage } from './settings/OtherPage';
import { ViewPage } from './settings/ViewPage';
import { ExportsPage, type ExportFormat } from './settings/ExportsPage';
import { WordsPage } from './settings/WordsPage';

import './settings/settings.css';
import { tip } from '@/app/tooltips';

export type SettingsPageId =
  'view' | 'other' | 'hotkeys' | 'words' | 'imports' | 'ocr' | 'exports' | 'ai' | 'maximaLibrary';

const PAGES: readonly SettingsPageId[] = [
  'view',
  'other',
  'hotkeys',
  'words',
  'imports',
  'ocr',
  'exports',
  'ai',
  'maximaLibrary',
];

/**
 * A page not shown keeps its room, invisible - not focusable, not read out - so that every page stands in the one
 * grid cell of `.mfbe-settings-pages` and the dialog keeps the size of the tallest, and its place, whichever tab is
 * shown (the requester after his smoke test of 0.0.12-rc.4: the dialog jumped from tab to tab).
 */
function shownIf(shown: boolean): CSSProperties | undefined {
  return shown ? undefined : { visibility: 'hidden' };
}

/** The sections of the draft the pages edit (`session` is never part of the dialog). */
type DraftSection =
  'view' | 'other' | 'words' | 'imports' | 'ocr' | 'pdf' | 'ai' | 'markdown' | 'txt' | 'mobi';

/**
 * The pre-apply hook (feature 005 R8.8): asked with the validated draft before anything is
 * written; `keepOpen` leaves the dialog as it is (the user declined a consequence of the
 * change, such as stopping a running AI request when choosing Disabled - US9).
 */
export type BeforeApplyHook = (
  draft: Settings,
  original: Settings,
) => Promise<'apply' | 'keepOpen'>;

export interface SettingsDialogProps {
  ctx: CommandContext;
  feature: SettingsFeature;
  onClose: () => void;
  /** Page shown first (tests, the AI panel's and the failure messages' link to the AI page). */
  initialPage?: SettingsPageId;
  /** Feature 019: format pre-selected on the Exports tab (opened from Batch Converter). */
  initialExportFormat?: ExportFormat;
  /** Asked before OK / Apply write anything; absent: apply. */
  beforeApply?: BeforeApplyHook;
  /**
   * Reloads the page for the browser-mode restart (`app.restart` unavailable, 1070); defaults
   * to `window.location.replace`. Tests inject a recorder.
   */
  reloadPage?: (url: string) => void;
}

/** The browser-mode restart: the page loads itself again, `?open=<path>` added. */
function reloadWithDocument(openPath: string | null, reload?: (url: string) => void): void {
  if (typeof window === 'undefined') return;
  const url = restartUrl(window.location.href, openPath);
  if (reload) reload(url);
  else window.location.replace(url);
}

interface ApplyOutcome {
  ok: boolean;
  restartRequired: boolean;
}

export function SettingsDialog({
  ctx,
  feature,
  onClose,
  initialPage = 'view',
  initialExportFormat,
  beforeApply,
  reloadPage,
}: SettingsDialogProps) {
  const { t, i18n } = useTranslation();
  const { rpc, store } = ctx;
  const [page, setPage] = useState<SettingsPageId>(initialPage);
  const [original, setOriginal] = useState<Settings | null>(() => store.getState().settings);
  const [draft, setDraft] = useState<Settings | null>(() => {
    const current = store.getState().settings;
    return current ? cloneSettings(current) : null;
  });
  const [loadFailed, setLoadFailed] = useState(false);
  const [errors, setErrors] = useState<SettingsValidationError[]>([]);
  const [busy, setBusy] = useState(false);
  const [ocrReport, setOcrReport] = useState<OcrCatalogReport | null>(null);
  const [ocrReportKnown, setOcrReportKnown] = useState(!rpc);
  const [mlSaved, setMlSaved] = useState<MaximaLibrarySavedSnapshot>(() =>
    snapshotFromSettings(store.getState().settings?.maximaLibrary),
  );
  const [mlDraft, setMlDraft] = useState<MaximaLibraryDraftState>(() =>
    createMaximaLibraryDraft(snapshotFromSettings(store.getState().settings?.maximaLibrary)),
  );
  const mlDirtyRef = useRef(false);
  const mlTabCancelRef = useRef<(() => void) | null>(null);

  const registerMlTabCancel = useCallback((cancel: () => void): (() => void) => {
    mlTabCancelRef.current = cancel;
    return () => {
      if (mlTabCancelRef.current === cancel) mlTabCancelRef.current = null;
    };
  }, []);

  const updateMlDraft = useCallback(
    (
      updater:
        MaximaLibraryDraftState | ((current: MaximaLibraryDraftState) => MaximaLibraryDraftState),
    ) => {
      mlDirtyRef.current = true;
      setMlDraft(updater);
      setErrors([]);
    },
    [],
  );

  useEffect(() => {
    if (!rpc) return;
    let cancelled = false;
    rpc
      .call('maximaLookup.status', {})
      .then((status) => {
        if (cancelled) return;
        const snap = snapshotFromStatus(status);
        setMlSaved(snap);
        if (!mlDirtyRef.current) {
          setMlDraft(createMaximaLibraryDraft(snap));
        }
      })
      .catch(() => {
        // Older core or disconnected: keep settings snapshot.
      });
    return () => {
      cancelled = true;
    };
  }, [rpc]);

  const selectPage = useCallback(
    (next: SettingsPageId) => {
      if (page === 'maximaLibrary' && next !== 'maximaLibrary') {
        if (shouldRevertMaximaLibraryOnTabLeave(mlDraft)) {
          mlTabCancelRef.current?.();
          setMlDraft(revertMaximaLibraryDraft(mlSaved));
          mlDirtyRef.current = false;
        }
      }
      setPage(next);
    },
    [mlDraft, mlSaved, page],
  );

  const refreshOcrReport = useCallback(async () => {
    if (!rpc) {
      setOcrReportKnown(true);
      return;
    }
    try {
      const report = await rpc.call('ocr.report');
      setOcrReport(report);
    } catch {
      // Older core or disconnected: keep previous report state and mark known.
    } finally {
      setOcrReportKnown(true);
    }
  }, [rpc]);

  useEffect(() => {
    if (!rpc) return;
    let cancelled = false;
    rpc
      .call('ocr.report')
      .then((report) => {
        if (!cancelled) setOcrReport(report);
      })
      .catch(() => {
        // Older core or disconnected: keep previous report state.
      })
      .finally(() => {
        if (!cancelled) setOcrReportKnown(true);
      });
    return () => {
      cancelled = true;
    };
  }, [rpc]);

  // The Hotkeys page edits a scratch copy of the live map.
  const registry = useMemo(() => feature.commands ?? createCommandRegistry(), [feature]);
  const scratch = useMemo(
    () => createScratchHotkeys(feature.hotkeys, registry),
    [feature.hotkeys, registry],
  );
  const [, bumpHotkeys] = useReducer((n: number) => n + 1, 0);
  useEffect(() => scratch.subscribe(bumpHotkeys), [scratch]);
  useEffect(() => feature.hotkeys.subscribe(bumpHotkeys), [feature.hotkeys]);

  // AI first-use agreements are persisted immediately by AiPage rather than deferred to Apply/OK;
  // align original.ai.agreements so accepting or withdrawing one does not enable Apply.
  useEffect(
    () =>
      store.subscribe((state, previous) => {
        const nextAgreements = state.settings?.ai?.agreements;
        if (!nextAgreements || nextAgreements === previous.settings?.ai?.agreements) return;
        setOriginal((current) =>
          current?.ai ? { ...current, ai: { ...current.ai, agreements: nextAgreements } } : current,
        );
      }),
    [store],
  );

  // The cancel registry (feature 005 review A4): a page that started a job hands in a
  // canceller; closing the dialog - OK, Cancel, Escape, the close box - runs the ones still
  // registered, so no test or fetch outlives the dialog.
  const cancellers = useRef(new Set<() => void>());
  const registerCancel = useCallback((cancel: () => void): (() => void) => {
    cancellers.current.add(cancel);
    return () => {
      cancellers.current.delete(cancel);
    };
  }, []);
  const runCancellers = () => {
    for (const cancel of [...cancellers.current]) cancel();
    cancellers.current.clear();
  };
  useEffect(() => runCancellers, []); // unmounted another way: the jobs go with it
  const close = () => {
    runCancellers();
    onClose();
  };

  // Settings from the core when the store does not have them yet.
  useEffect(() => {
    if (draft || !rpc) return;
    let cancelled = false;
    rpc
      .call('settings.get')
      .then((settings) => {
        if (cancelled) return;
        actions.setSettings(store, settings);
        setOriginal(settings);
        setDraft(cloneSettings(settings));
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [draft, rpc, store]);

  const update = <S extends DraftSection>(section: S, patch: Partial<NonNullable<Settings[S]>>) => {
    setDraft((current) =>
      current ? { ...current, [section]: { ...(current[section] ?? {}), ...patch } } : current,
    );
    setErrors([]);
  };

  const promptRestart = async () => {
    // Read the strings through the i18n instance: the interface language may have just been
    // switched live, and the render-bound `t` still belongs to the previous language.
    const answer = await ctx.dialogs.showMessage({
      text: i18n.t('msg.needRestart'),
      caption: i18n.t('app.name'),
      buttons: 'yesNo',
      icon: 'question',
      testId: 'dialog-restart-prompt',
    });
    if (answer !== 'yes' || !ctx.rpc) return;
    // The usual save prompt first; Cancel abandons the restart (spec FR-020).
    if (!(await confirmDiscardChanges(ctx))) return;
    // The document to reopen: the file as it is on disk now (Save As may have renamed it); a
    // never-saved document is not carried over. Its Body position is remembered first, as on
    // every other leaving route (feature 004 FR-100) - for the shell's restart and for the
    // browser-mode reload alike.
    const path = ctx.store.getState().path;
    await leaveDocument(ctx);
    try {
      await ctx.rpc.call('app.restart', path ? { reopen: path } : {});
    } catch (error) {
      if (error instanceof RpcError && error.code === RpcErrorCode.restartUnavailable) {
        // No shell (browser/dev mode): the page is the editor, so it restarts itself.
        reloadWithDocument(path, reloadPage);
        return;
      }
      const data =
        error instanceof RpcError ? (error.data as { reason?: string } | undefined) : undefined;
      await ctx.dialogs.showMessage({
        text: i18n.t('msg.restartFailed', {
          reason: data?.reason ?? (error instanceof Error ? error.message : String(error)),
        }),
        caption: i18n.t('dialog.error.caption'),
        icon: 'error',
        testId: 'dialog-restart-failed',
      });
    }
  };

  const apply = async (): Promise<ApplyOutcome> => {
    if (!draft || !original) return { ok: false, restartRequired: false };
    if (!canSaveMaximaLibraryDraft(mlDraft)) {
      return { ok: false, restartRequired: false };
    }
    const problems = validateSettings(draft, t, ocrReport);
    if (problems.length > 0) {
      setErrors(problems);
      return { ok: false, restartRequired: false };
    }
    // The pre-apply hook: nothing is written while it keeps the dialog open.
    if (beforeApply && (await beforeApply(draft, original)) === 'keepOpen') {
      return { ok: false, restartRequired: false };
    }
    let restartRequired = false;
    let effectiveOriginal = original;
    let effectiveDraft = draft;

    if (isMaximaLibraryDraftDirty(mlSaved, mlDraft)) {
      if (!rpc) {
        await ctx.dialogs.showMessage({
          text: t('dialog.settings.unavailable'),
          caption: t('dialog.error.caption'),
          icon: 'error',
          testId: 'dialog-settings-unavailable',
        });
        return { ok: false, restartRequired: false };
      }
      try {
        const mlResult = await rpc.call('maximaLookup.saveConfig', buildSaveConfigParams(mlDraft));
        actions.setSettings(store, mlResult.settings);
        const snap = snapshotFromStatus(mlResult.status);
        setMlSaved(snap);
        setMlDraft(createMaximaLibraryDraft(snap));
        mlDirtyRef.current = false;
        effectiveOriginal = mlResult.settings;
        effectiveDraft = { ...draft, maximaLibrary: mlResult.settings.maximaLibrary };
        setOriginal(effectiveOriginal);
        setDraft(effectiveDraft);
      } catch (error) {
        if (error instanceof RpcError && error.code === RpcErrorCode.settingsInvalid) {
          const data = error.data as { field?: string } | undefined;
          await ctx.dialogs.showMessage({
            text: t('dialog.settings.invalidField', {
              field: data?.field ?? 'maximaLibrary',
              reason: error.message,
            }),
            caption: t('dialog.error.caption'),
            icon: 'error',
            testId: 'dialog-settings-invalid',
          });
          return { ok: false, restartRequired: false };
        }
        await ctx.dialogs.showMessage({
          text: t('msg.settingsSaveFailed', {
            reason: error instanceof Error ? error.message : String(error),
          }),
          caption: t('dialog.error.caption'),
          icon: 'error',
          testId: 'dialog-settings-failed',
        });
        return { ok: false, restartRequired: false };
      }
    }

    const patch = settingsPatch(effectiveOriginal, effectiveDraft);
    if (!isEmptyPatch(patch)) {
      if (!rpc) {
        await ctx.dialogs.showMessage({
          text: t('dialog.settings.unavailable'),
          caption: t('dialog.error.caption'),
          icon: 'error',
          testId: 'dialog-settings-unavailable',
        });
        return { ok: false, restartRequired: false };
      }
      try {
        const result = await rpc.call('settings.set', { patch });
        actions.setSettings(store, result.settings);
        setOriginal(result.settings);
        setDraft(cloneSettings(result.settings));
        restartRequired = result.restartRequired;
      } catch (error) {
        if (error instanceof RpcError && error.code === RpcErrorCode.settingsInvalid) {
          const data = error.data as { field?: string } | undefined;
          await ctx.dialogs.showMessage({
            text: t('dialog.settings.invalidField', {
              field: data?.field ?? '?',
              reason: error.message,
            }),
            caption: t('dialog.error.caption'),
            icon: 'error',
            testId: 'dialog-settings-invalid',
          });
          return { ok: false, restartRequired: false };
        }
        await ctx.dialogs.showMessage({
          text: t('msg.settingsSaveFailed', {
            reason: error instanceof Error ? error.message : String(error),
          }),
          caption: t('dialog.error.caption'),
          icon: 'error',
          testId: 'dialog-settings-failed',
        });
        return { ok: false, restartRequired: false };
      }
    }
    if (!sameUserBindings(scratch, feature.hotkeys)) {
      feature.hotkeys.setUserBindings(scratch.userBindings());
      const persisted = await feature.persistHotkeys();
      actions.setStatusMessage(
        store,
        persisted ? t('msg.hotkeysApplied') : t('dialog.settings.hotkeys.notPersisted'),
      );
    }
    if (rpc) {
      if (patch.other?.dictionariesFolder !== undefined) {
        void getSpellFeature(store).refreshDictionaries(rpc);
      }
      if (patch.ocr?.folder !== undefined) {
        await refreshOcrReport();
      }
    }
    return { ok: true, restartRequired };
  };

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const onOk = () =>
    run(async () => {
      const outcome = await apply();
      if (!outcome.ok) return;
      close();
      if (outcome.restartRequired) await promptRestart();
    });

  const onApply = () =>
    run(async () => {
      const outcome = await apply();
      if (outcome.ok && outcome.restartRequired) await promptRestart();
    });

  const editable = draft !== null && original !== null;
  const maximaBlocksSave = !canSaveMaximaLibraryDraft(mlDraft);
  const hasChanges =
    editable &&
    (!isEmptyPatch(settingsPatch(original, draft)) ||
      !sameUserBindings(scratch, feature.hotkeys) ||
      isMaximaLibraryDraftDirty(mlSaved, mlDraft));
  const buttons: DialogButton[] = [
    {
      id: 'ok',
      label: t('dialog.buttons.ok'),
      disabled: !editable || busy || maximaBlocksSave,
      onClick: () => void onOk(),
    },
    { id: 'cancel', label: t('dialog.buttons.cancel'), onClick: close },
    {
      id: 'apply',
      label: t('dialog.settings.apply'),
      disabled: !editable || busy || maximaBlocksSave || !hasChanges,
      onClick: () => void onApply(),
    },
  ];

  return (
    <Dialog
      title={t('dialog.settings.caption')}
      buttons={buttons}
      defaultButtonId="ok"
      cancelButtonId="cancel"
      initialFocus={`[data-testid="settings-tab-${initialPage}"]`}
      testId="dialog-settings"
      className="mfbe-settingsdialog"
      closeLabel={t('dialog.buttons.close')}
    >
      <div className="mfbe-settings-tabs" role="tablist" aria-label={t('dialog.settings.caption')}>
        {PAGES.map((id) => (
          <button
            {...tip(t(`tip.settings.tabs.${id}`))}
            key={id}
            type="button"
            role="tab"
            id={`settings-tab-${id}`}
            aria-selected={page === id}
            aria-controls={id === 'exports' ? 'settings-page-exports-panel' : `settings-page-${id}`}
            tabIndex={page === id ? 0 : -1}
            className="mfbe-settings-tab"
            data-testid={`settings-tab-${id}`}
            onClick={() => selectPage(id)}
            onKeyDown={(event) => {
              // Roving tabindex (T153): the arrow keys select the neighbouring page and move
              // the focus onto its tab, so Tab continues from the selected page.
              const index = PAGES.indexOf(page);
              let next: (typeof PAGES)[number] | null = null;
              if (event.key === 'ArrowRight') next = PAGES[(index + 1) % PAGES.length]!;
              else if (event.key === 'ArrowLeft') {
                next = PAGES[(index + PAGES.length - 1) % PAGES.length]!;
              } else if (event.key === 'Home') next = PAGES[0]!;
              else if (event.key === 'End') next = PAGES[PAGES.length - 1]!;
              if (!next) return;
              event.preventDefault();
              selectPage(next);
              event.currentTarget.parentElement
                ?.querySelector<HTMLButtonElement>(`#settings-tab-${next}`)
                ?.focus();
            }}
          >
            {t(`dialog.settings.pages.${id}`)}
          </button>
        ))}
      </div>
      {errors.length > 0 ? (
        <ul className="mfbe-settings-errors" data-testid="settings-errors">
          {errors.map((error) => (
            <li key={error.field} data-field={error.field}>
              {error.message}
            </li>
          ))}
        </ul>
      ) : null}
      {draft ? (
        <div className="mfbe-settings-pages">
          <div role="tabpanel" id="settings-page-view" style={shownIf(page === 'view')}>
            <ViewPage
              draft={draft}
              onChange={(patch) => update('view', patch)}
              onChangeOther={(patch) => update('other', patch)}
              ctx={ctx}
            />
          </div>
          <div role="tabpanel" id="settings-page-other" style={shownIf(page === 'other')}>
            <OtherPage draft={draft} onChange={(patch) => update('other', patch)} ctx={ctx} />
          </div>
          <div role="tabpanel" id="settings-page-hotkeys" style={shownIf(page === 'hotkeys')}>
            <HotkeysPage commands={registry} hotkeys={scratch} ctx={ctx} />
          </div>
          <div role="tabpanel" id="settings-page-words" style={shownIf(page === 'words')}>
            <WordsPage draft={draft} onChange={(patch) => update('words', patch)} ctx={ctx} />
          </div>
          <div role="tabpanel" id="settings-page-imports" style={shownIf(page === 'imports')}>
            <ImportsPage draft={draft} onChange={(patch) => update('imports', patch)} />
          </div>
          <div role="tabpanel" id="settings-page-ocr" style={shownIf(page === 'ocr')}>
            <OcrPage
              draft={draft}
              onChange={(patch) => update('ocr', patch)}
              ctx={ctx}
              report={ocrReport}
              reportKnown={ocrReportKnown}
            />
          </div>
          <div role="tabpanel" id="settings-page-exports-panel" style={shownIf(page === 'exports')}>
            <ExportsPage
              draft={draft}
              onChange={(section, patch) => update(section, patch)}
              ctx={ctx}
              initialFormat={initialExportFormat}
            />
          </div>
          <div role="tabpanel" id="settings-page-ai" style={shownIf(page === 'ai')}>
            <AiPage
              draft={draft}
              onChange={(patch) => update('ai', patch)}
              ctx={ctx}
              registerCancel={registerCancel}
            />
          </div>
          <div
            role="tabpanel"
            id="settings-page-maximaLibrary"
            style={shownIf(page === 'maximaLibrary')}
          >
            <MaximaLibraryPage
              draft={mlDraft}
              saved={mlSaved}
              onChange={updateMlDraft}
              ctx={ctx}
              registerCancel={registerCancel}
              onRegisterTabCancel={registerMlTabCancel}
            />
          </div>
        </div>
      ) : (
        <div className="mfbe-settings-note" data-testid="settings-loading">
          {loadFailed || !rpc ? t('dialog.settings.unavailable') : t('dialog.settings.loading')}
        </div>
      )}
    </Dialog>
  );
}
