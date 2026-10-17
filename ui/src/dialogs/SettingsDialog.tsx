/**
 * Settings dialog (US9, T129): the tabbed shell with the View / Other / Hotkeys / Words pages
 * and the OK / Cancel / Apply buttons of the original property sheet. The pages edit a draft
 * copy of the settings (and a scratch copy of the hotkey map); OK / Apply validate the draft,
 * send one `settings.set` patch with the changed leaves, copy the hotkey overrides into the
 * live map (`hotkeys.set`) and, when the core reports `restartRequired` (interface language),
 * show "In order to process changes the program must be restarted. Restart now?" - Yes runs
 * the usual save prompt (Cancel abandons the restart) and then `app.restart({reopen: path})`
 * (feature 003 US3, rpc-api.md §3.1): the shell starts the editor again with the same
 * options, window placement and document and quits. Without a shell (browser/dev mode, error
 * 1070) the page reloads itself with `?open=<path>`; when the shell could not start the new
 * instance (1071) the failure is shown and the editor stays open.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { confirmDiscardChanges, createCommandRegistry, type CommandContext } from '@/app/commands';
import { restartUrl } from '@/app/startup';
import {
  cloneSettings,
  isEmptyPatch,
  settingsPatch,
  type SettingsFeature,
} from '@/features/settings/apply';
import { actions } from '@/model/store';
import { RpcError } from '@/rpc/client';
import { RpcErrorCode, type Settings } from '@/rpc/types';

import { Dialog, type DialogButton } from './Dialog';
import { HotkeysPage } from './settings/HotkeysPage';
import { createScratchHotkeys, sameUserBindings } from './settings/hotkeysModel';
import { validateSettings, type SettingsValidationError } from './settings/model';
import { OtherPage } from './settings/OtherPage';
import { ViewPage } from './settings/ViewPage';
import { WordsPage } from './settings/WordsPage';

import './settings/settings.css';

export type SettingsPageId = 'view' | 'other' | 'hotkeys' | 'words';

const PAGES: readonly SettingsPageId[] = ['view', 'other', 'hotkeys', 'words'];

export interface SettingsDialogProps {
  ctx: CommandContext;
  feature: SettingsFeature;
  onClose: () => void;
  /** Page shown first (tests). */
  initialPage?: SettingsPageId;
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

  // The Hotkeys page edits a scratch copy of the live map.
  const registry = useMemo(() => feature.commands ?? createCommandRegistry(), [feature]);
  const scratch = useMemo(
    () => createScratchHotkeys(feature.hotkeys, registry),
    [feature.hotkeys, registry],
  );

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

  const update = <S extends 'view' | 'other' | 'words'>(
    section: S,
    patch: Partial<Settings[S]>,
  ) => {
    setDraft((current) =>
      current ? { ...current, [section]: { ...current[section], ...patch } } : current,
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
    // never-saved document is not carried over.
    const path = ctx.store.getState().path;
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
    const problems = validateSettings(draft, t);
    if (problems.length > 0) {
      setErrors(problems);
      return { ok: false, restartRequired: false };
    }
    let restartRequired = false;
    const patch = settingsPatch(original, draft);
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
      onClose();
      if (outcome.restartRequired) await promptRestart();
    });

  const onApply = () =>
    run(async () => {
      const outcome = await apply();
      if (outcome.ok && outcome.restartRequired) await promptRestart();
    });

  const editable = draft !== null && original !== null;
  const buttons: DialogButton[] = [
    {
      id: 'ok',
      label: t('dialog.buttons.ok'),
      disabled: !editable || busy,
      onClick: () => void onOk(),
    },
    { id: 'cancel', label: t('dialog.buttons.cancel'), onClick: onClose },
    {
      id: 'apply',
      label: t('dialog.settings.apply'),
      disabled: !editable || busy,
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
            key={id}
            type="button"
            role="tab"
            id={`settings-tab-${id}`}
            aria-selected={page === id}
            aria-controls={`settings-page-${id}`}
            tabIndex={page === id ? 0 : -1}
            className="mfbe-settings-tab"
            data-testid={`settings-tab-${id}`}
            onClick={() => setPage(id)}
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
              setPage(next);
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
        <>
          <div role="tabpanel" id="settings-page-view" hidden={page !== 'view'}>
            <ViewPage draft={draft} onChange={(patch) => update('view', patch)} ctx={ctx} />
          </div>
          <div role="tabpanel" id="settings-page-other" hidden={page !== 'other'}>
            <OtherPage draft={draft} onChange={(patch) => update('other', patch)} ctx={ctx} />
          </div>
          <div role="tabpanel" id="settings-page-hotkeys" hidden={page !== 'hotkeys'}>
            <HotkeysPage commands={registry} hotkeys={scratch} ctx={ctx} />
          </div>
          <div role="tabpanel" id="settings-page-words" hidden={page !== 'words'}>
            <WordsPage draft={draft} onChange={(patch) => update('words', patch)} ctx={ctx} />
          </div>
        </>
      ) : (
        <div className="mfbe-settings-note" data-testid="settings-loading">
          {loadFailed || !rpc ? t('dialog.settings.unavailable') : t('dialog.settings.loading')}
        </div>
      )}
    </Dialog>
  );
}
