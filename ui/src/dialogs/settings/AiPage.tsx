/**
 * Settings > AI assistant (feature 005 T037; FR-001 to FR-009, FR-013, FR-021, FR-105;
 * research R8.8; data-model §2): the radio group *Free service (no registration)* / *My own
 * service and key* / *Disabled*; under the free option the drop-down of the effective service
 * list (`ai.services()`, read when the page opens and again on `resources.changed
 * {what: 'aiServices'}`) as `<name> — <model>` in the list's order, with the selected entry's
 * limits note in the interface language, its terms or privacy link (an `<a href>` opened
 * through `app.openUrl`, never a navigation), the "answers only" note of a `tools: false`
 * entry, the replaced-by-your-list-file label and the fallback text when the saved id is gone;
 * *Test connection* as the `ai.test` job (phases shown, cancelled when the dialog closes) that
 * answers into the status element - `data-status` `untested` | `verified` | `failed`,
 * `aria-live="polite"`, "answered (<model>)" in green, the service's words in red - after the
 * first-use notice when the entry is hosted and no agreement exists (and again on a 1200
 * `noAgreement`); the list files with *Edit list* (`ai.createUserServices`, then the folder
 * through `app.openFolder` - 1050 tolerated headless) and *Reload list*; the list-file issues as
 * file + entry + reason; the agreements with *Withdraw* writing `ai.agreements` at once.
 *
 * The page edits the dialog's draft (`onChange`): nothing but an agreement and its withdrawal
 * is saved before OK. The custom option's fields exist here disabled under the other radios
 * and bound to the draft; their behaviour - masking and reveal, Fetch models, the plain-http
 * warning, the verification status - is User Story 8's. Static: part of the main bundle; the
 * notice module of the lazy chunk is imported only when a notice is due (SC-013).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getAiFeature } from '@/ai';
import type { NoticeTarget, RequireAgreementOptions } from '@/ai/notice';
import { agreementsOf, saveAgreements, settingsWithoutAgreement } from '@/ai/agreements';
import type { CommandContext } from '@/app/commands';
import { ExternalLink } from '@/dialogs/ExternalLink';
import { isOpenableUrl } from '@/dialogs/externalUrl';
import { useAppState } from '@/model/store';
import { RpcError } from '@/rpc/client';
import {
  RpcErrorCode,
  type AiAgreement,
  type AiNoServiceData,
  type AiServicesResult,
  type Settings,
} from '@/rpc/types';

import { FieldRow, GroupBox } from './controls';
import { aiServiceChoice, limitsNoteOf, listIssueReason, testFailureText } from './model';

export type RequireAgreementFn = (
  target: NoticeTarget,
  options?: RequireAgreementOptions,
) => Promise<boolean>;

export interface AiPageProps {
  draft: Settings;
  onChange: (patch: Partial<Settings['ai']>) => void;
  ctx: CommandContext;
  /** The dialog's cancel registry: the running test is cancelled when the dialog closes. */
  registerCancel?: (cancel: () => void) => () => void;
  /** The first-use notice gate; the lazy `ai/notice` module by default (tests inject one). */
  requireAgreement?: RequireAgreementFn;
}

/** The status element's states (quickstart §0.5). */
type TestStatus =
  | { kind: 'untested' }
  | { kind: 'running'; phase: string }
  | { kind: 'verified'; model: string }
  | { kind: 'failed'; text: string };

type ListState =
  | { kind: 'loading' }
  | { kind: 'ready'; result: AiServicesResult }
  | { kind: 'tooOld' }
  | { kind: 'failed' };

/** The lazy notice (the `ai-assistant` chunk), imported on the first due notice only. */
async function requireAgreementLazily(
  ctx: CommandContext,
  target: NoticeTarget,
  options?: RequireAgreementOptions,
): Promise<boolean> {
  const notice = await import('@/ai/notice');
  return notice.requireAgreement(ctx, target, options);
}

function isNoAgreement(error: unknown): boolean {
  return (
    error instanceof RpcError &&
    error.code === RpcErrorCode.aiNoService &&
    (error.data as AiNoServiceData | undefined)?.reason === 'noAgreement'
  );
}

/** A date of an agreement as the interface language writes it; the raw text when unreadable. */
function agreementDate(at: string, language: string): string {
  const time = Date.parse(at);
  if (Number.isNaN(time)) return at;
  try {
    return new Date(time).toLocaleString(language);
  } catch {
    return new Date(time).toLocaleString();
  }
}

export function AiPage({ draft, onChange, ctx, registerCancel, requireAgreement }: AiPageProps) {
  const { t, i18n } = useTranslation();
  const { rpc, store } = ctx;
  const ai = draft.ai;
  const [list, setList] = useState<ListState>(() => ({ kind: 'loading' }));
  const [status, setStatus] = useState<TestStatus>({ kind: 'untested' });
  const [listNote, setListNote] = useState<string | null>(null);
  const [featureTooOld, setFeatureTooOld] = useState(
    () => getAiFeature(store)?.coreTooOld ?? false,
  );
  const jobRef = useRef<string | null>(null);
  const closedRef = useRef(false);
  // The agreements as stored (written at once by the notice and by Withdraw); the draft's
  // copy follows every write so that OK rewrites the same array.
  const storedAgreements = useAppState((state) => state.settings?.ai?.agreements, store);
  const agreements: AiAgreement[] = storedAgreements ?? agreementsOf(draft);

  /* ----------------------------------------------------------- the list */

  const load = useCallback(
    (method: 'ai.services' | 'ai.reloadServices') => {
      if (!rpc) return Promise.resolve();
      return rpc
        .call(method)
        .then((result) => {
          if (!closedRef.current) setList({ kind: 'ready', result });
        })
        .catch((error: unknown) => {
          if (closedRef.current) return;
          const tooOld = error instanceof RpcError && error.code === RpcErrorCode.methodNotFound;
          setList({ kind: tooOld ? 'tooOld' : 'failed' });
        });
    },
    [rpc],
  );

  useEffect(() => {
    closedRef.current = false;
    void load('ai.services');
    const offChanged = rpc?.on('resources.changed', ({ what }) => {
      if (what === 'aiServices') void load('ai.services');
    });
    return () => {
      closedRef.current = true;
      offChanged?.();
    };
  }, [load, rpc]);

  // "Core too old" also when the registrar found out (its `app.info` check).
  useEffect(() => {
    const feature = getAiFeature(store);
    if (!feature) return;
    return feature.subscribe(() => setFeatureTooOld(feature.coreTooOld));
  }, [store]);

  /* ---------------------------------------------------------- the test */

  const cancelTest = useCallback(() => {
    const jobId = jobRef.current;
    jobRef.current = null;
    if (jobId && rpc) {
      rpc.call('job.cancel', { jobId }).catch(() => {
        // already finished
      });
    }
  }, [rpc]);

  useEffect(() => {
    if (!registerCancel) return;
    return registerCancel(cancelTest);
  }, [cancelTest, registerCancel]);

  useEffect(() => cancelTest, [cancelTest]); // the page unmounts: the job goes with it

  const syncAgreements = () => {
    onChange({ agreements: agreementsOf(store.getState().settings) });
  };

  const services = list.kind === 'ready' ? list.result : null;
  const choice = aiServiceChoice(services, ai?.freeServiceId ?? '');
  const entry = choice.entry;
  const coreTooOld = !ai || featureTooOld || list.kind === 'tooOld';

  const rpcFailureText = (error: unknown): string => {
    if (error instanceof RpcError && error.code === RpcErrorCode.aiNoService) {
      const data = error.data as AiNoServiceData | undefined;
      return t(`ai.noService.${data?.reason ?? 'unknownService'}`, { id: data?.id ?? '' });
    }
    // Never the message of an unexpected error: it could carry anything (research R8.13).
    return t('ai.failure.internal');
  };

  const runTest = async () => {
    if (!rpc || !ai || !entry || status.kind === 'running') return;
    const target: NoticeTarget = {
      kind: 'free',
      id: entry.id,
      address: entry.address,
      name: entry.name,
      termsUrl: entry.termsUrl,
    };
    const gate: RequireAgreementFn =
      requireAgreement ?? ((subject, options) => requireAgreementLazily(ctx, subject, options));
    const ask = async (force: boolean): Promise<boolean> => {
      const agreed = await gate(target, { force });
      if (agreed) syncAgreements();
      return agreed;
    };
    // The notice first for a hosted address (FR-005, FR-021); a local one never asks.
    if (!entry.local && !(await ask(false))) return;
    let askedAgain = false;
    for (;;) {
      setStatus({ kind: 'running', phase: 'connecting' });
      try {
        const result = await rpc.runJob(
          'ai.test',
          { target: { kind: 'free', id: entry.id } },
          {
            onStart: (jobId) => {
              jobRef.current = jobId;
            },
            onProgress: (progress) => {
              if (!closedRef.current) setStatus({ kind: 'running', phase: progress.phase });
            },
          },
        );
        jobRef.current = null;
        if (closedRef.current) return;
        setStatus(
          result.verified
            ? { kind: 'verified', model: result.model || entry.model }
            : { kind: 'failed', text: testFailureText(result, t) },
        );
        return;
      } catch (error) {
        jobRef.current = null;
        if (closedRef.current) return;
        if (isNoAgreement(error) && !askedAgain) {
          // The core's gate and the stored agreements disagree: the user decides again.
          askedAgain = true;
          setStatus({ kind: 'untested' });
          if (await ask(true)) continue;
          return;
        }
        if (error instanceof RpcError && error.code === RpcErrorCode.cancelled) {
          setStatus({ kind: 'untested' });
          return;
        }
        setStatus({ kind: 'failed', text: rpcFailureText(error) });
        return;
      }
    }
  };

  /* ---------------------------------------------------------- the files */

  const reloadList = () => {
    setListNote(null);
    void load('ai.reloadServices');
  };

  const editList = async () => {
    if (!rpc) return;
    setListNote(null);
    let created: { path: string; created: boolean };
    try {
      created = await rpc.call('ai.createUserServices');
    } catch (error) {
      if (closedRef.current) return;
      const data = error instanceof RpcError ? (error.data as { reason?: string }) : undefined;
      setListNote(
        t('dialog.settings.ai.files.createFailed', {
          reason: data?.reason ?? (error instanceof RpcError ? error.message : ''),
        }),
      );
      return;
    }
    if (closedRef.current) return;
    setListNote(
      t(created.created ? 'dialog.settings.ai.files.created' : 'dialog.settings.ai.files.exists'),
    );
    void load('ai.services');
    // The folder of the file: headless (no shell) the core answers 1050 `dialog.unavailable`,
    // which changes nothing for the user - the note above says where the file is.
    try {
      await rpc.call('app.openFolder', { path: created.path });
    } catch {
      // tolerated: no opener, no shell, or an older core
    }
  };

  const revoke = async (service: string) => {
    const remaining = settingsWithoutAgreement(store.getState().settings ?? draft, service);
    onChange({ agreements: remaining });
    await saveAgreements(store, rpc, remaining);
  };

  /* ------------------------------------------------------------- render */

  const mode = ai?.mode ?? 'free';
  const language = i18n.language;
  const entryName = (service: string) =>
    choice.options.find((option) => option.id === service)?.name ?? service;

  const statusText = (): string => {
    switch (status.kind) {
      case 'untested':
        return entry || list.kind !== 'ready'
          ? t('dialog.settings.ai.status.untested')
          : t('dialog.settings.ai.status.noTarget');
      case 'running':
        return t('dialog.settings.ai.testing', {
          phase: t(`dialog.settings.ai.phase.${status.phase}`, { defaultValue: status.phase }),
        });
      case 'verified':
        return t('dialog.settings.ai.status.verified', { model: status.model });
      case 'failed':
        return status.text;
    }
  };
  const statusAttribute = status.kind === 'running' ? 'untested' : status.kind;

  const files = services?.files;

  return (
    <div className="mfbe-settings-page mfbe-settings-ai" data-testid="settings-page-ai">
      {coreTooOld ? (
        <div
          className="mfbe-settings-note mfbe-settings-ai-warning"
          data-testid="settings-ai-core-too-old"
        >
          {t('dialog.settings.ai.coreTooOld')}
        </div>
      ) : null}
      <GroupBox title={t('dialog.settings.ai.modeGroup')} testId="settings-ai-mode">
        <div role="radiogroup" aria-label={t('dialog.settings.ai.modeGroup')}>
          <label className="mfbe-check-field mfbe-settings-radio" htmlFor="settings-ai-mode-free">
            <input
              id="settings-ai-mode-free"
              type="radio"
              name="settings-ai-mode"
              value="free"
              checked={mode === 'free'}
              disabled={!ai}
              onChange={() => onChange({ mode: 'free' })}
              data-testid="settings-ai-mode-free"
            />
            <span>{t('dialog.settings.ai.modeFree')}</span>
          </label>
          <div className="mfbe-settings-ai-block" hidden={mode !== 'free'}>
            <FieldRow label={t('dialog.settings.ai.service')} htmlFor="settings-ai-service">
              <select
                id="settings-ai-service"
                value={choice.shownId}
                disabled={!ai || choice.options.length === 0}
                onChange={(event) => onChange({ freeServiceId: event.target.value })}
                data-testid="settings-ai-service"
              >
                {choice.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {t('dialog.settings.ai.option', { name: option.name, model: option.model })}
                  </option>
                ))}
              </select>
            </FieldRow>
            {list.kind === 'loading' && rpc ? (
              <div className="mfbe-settings-note" data-testid="settings-ai-list-loading">
                {t('dialog.settings.ai.loading')}
              </div>
            ) : null}
            {!rpc ? (
              <div className="mfbe-settings-note" data-testid="settings-ai-list-unavailable">
                {t('dialog.settings.ai.listUnavailable')}
              </div>
            ) : null}
            {list.kind === 'ready' && choice.options.length === 0 ? (
              <div
                className="mfbe-settings-note mfbe-settings-ai-warning"
                data-testid="settings-ai-empty"
              >
                {t('dialog.settings.ai.emptyList')}
              </div>
            ) : null}
            {choice.fallback ? (
              <div
                className="mfbe-settings-note mfbe-settings-ai-warning"
                data-testid="settings-ai-fallback"
              >
                {t('dialog.settings.ai.fallback', { id: ai?.freeServiceId ?? '' })}
              </div>
            ) : null}
            {entry?.replaced ? (
              <div className="mfbe-settings-note" data-testid="settings-ai-replaced">
                {t('dialog.settings.ai.replaced')}
              </div>
            ) : null}
            {entry ? (
              <div
                className="mfbe-settings-note mfbe-settings-ai-limits"
                data-testid="settings-ai-limits"
              >
                {limitsNoteOf(entry, language)
                  ? t('dialog.settings.ai.limits', { text: limitsNoteOf(entry, language) })
                  : t('dialog.settings.ai.limitsUnknown')}
              </div>
            ) : null}
            {entry?.termsUrl ? (
              <div className="mfbe-settings-note">
                <ExternalLink url={entry.termsUrl} rpc={rpc} testId="settings-ai-terms">
                  {isOpenableUrl(entry.termsUrl)
                    ? t('dialog.settings.ai.termsLink')
                    : entry.termsUrl}
                </ExternalLink>
              </div>
            ) : null}
            {entry && !entry.tools ? (
              <div
                className="mfbe-settings-note mfbe-settings-ai-warning"
                data-testid="settings-ai-tools-note"
              >
                {t('dialog.settings.ai.toolsNote')}
              </div>
            ) : null}
          </div>
          <label className="mfbe-check-field mfbe-settings-radio" htmlFor="settings-ai-mode-custom">
            <input
              id="settings-ai-mode-custom"
              type="radio"
              name="settings-ai-mode"
              value="custom"
              checked={mode === 'custom'}
              disabled={!ai}
              onChange={() => onChange({ mode: 'custom' })}
              data-testid="settings-ai-mode-custom"
            />
            <span>{t('dialog.settings.ai.modeCustom')}</span>
          </label>
          <div className="mfbe-settings-ai-block">
            <FieldRow label={t('dialog.settings.ai.custom.address')} htmlFor="settings-ai-address">
              <input
                id="settings-ai-address"
                className="mfbe-inputdialog-input"
                type="text"
                value={ai?.custom.address ?? ''}
                disabled={mode !== 'custom'}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) =>
                  ai && onChange({ custom: { ...ai.custom, address: event.target.value } })
                }
                data-testid="settings-ai-address"
              />
            </FieldRow>
            <FieldRow label={t('dialog.settings.ai.custom.key')} htmlFor="settings-ai-key">
              <input
                id="settings-ai-key"
                className="mfbe-inputdialog-input"
                type="password"
                value={ai?.custom.key ?? ''}
                disabled={mode !== 'custom'}
                autoComplete="off"
                onChange={(event) =>
                  ai && onChange({ custom: { ...ai.custom, key: event.target.value } })
                }
                data-testid="settings-ai-key"
              />
            </FieldRow>
            <FieldRow label={t('dialog.settings.ai.custom.model')} htmlFor="settings-ai-model">
              <input
                id="settings-ai-model"
                className="mfbe-inputdialog-input"
                type="text"
                value={ai?.custom.model ?? ''}
                disabled={mode !== 'custom'}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) =>
                  ai && onChange({ custom: { ...ai.custom, model: event.target.value } })
                }
                data-testid="settings-ai-model"
              />
            </FieldRow>
          </div>
          <label
            className="mfbe-check-field mfbe-settings-radio"
            htmlFor="settings-ai-mode-disabled"
          >
            <input
              id="settings-ai-mode-disabled"
              type="radio"
              name="settings-ai-mode"
              value="disabled"
              checked={mode === 'disabled'}
              disabled={!ai}
              onChange={() => onChange({ mode: 'disabled' })}
              data-testid="settings-ai-mode-disabled"
            />
            <span>{t('dialog.settings.ai.modeDisabled')}</span>
          </label>
          {mode === 'disabled' ? (
            <div
              className="mfbe-settings-note mfbe-settings-ai-block"
              data-testid="settings-ai-disabled-note"
            >
              {t('dialog.settings.ai.disabledNote')}
            </div>
          ) : null}
        </div>
        {mode !== 'disabled' && rpc && !coreTooOld ? (
          <div className="mfbe-settings-row mfbe-settings-ai-test-row">
            <button
              type="button"
              className="mfbe-button"
              disabled={mode !== 'free' || !entry || status.kind === 'running'}
              onClick={() => void runTest()}
              data-testid="settings-ai-test"
            >
              {t('dialog.settings.ai.test')}
            </button>
            {status.kind === 'running' ? (
              <span
                className="mfbe-settings-ai-spinner"
                aria-hidden="true"
                data-testid="settings-ai-test-spinner"
              />
            ) : null}
            <span
              className="mfbe-settings-ai-status"
              data-status={statusAttribute}
              aria-live="polite"
              data-testid="settings-ai-status"
            >
              {statusText()}
            </span>
          </div>
        ) : null}
      </GroupBox>

      <GroupBox title={t('dialog.settings.ai.files.title')} testId="settings-ai-files">
        {files ? (
          <div
            className="mfbe-settings-note mfbe-settings-ai-paths"
            data-testid="settings-ai-list-path"
          >
            <div>{t('dialog.settings.ai.files.bundled', { path: files.bundled })}</div>
            <div>
              {files.userExists
                ? t('dialog.settings.ai.files.user', { path: files.user })
                : t('dialog.settings.ai.files.userMissing', { path: files.user })}
            </div>
            {files.portable ? (
              <div>{t('dialog.settings.ai.files.portable', { path: files.portable })}</div>
            ) : null}
          </div>
        ) : null}
        <div className="mfbe-settings-row">
          <button
            type="button"
            className="mfbe-button"
            disabled={!rpc || coreTooOld}
            onClick={() => void editList()}
            data-testid="settings-ai-edit-list"
          >
            {t('dialog.settings.ai.editList')}
          </button>
          <button
            type="button"
            className="mfbe-button"
            disabled={!rpc || coreTooOld}
            onClick={reloadList}
            data-testid="settings-ai-reload-list"
          >
            {t('dialog.settings.ai.reloadList')}
          </button>
        </div>
        {listNote ? (
          <div className="mfbe-settings-note" data-testid="settings-ai-list-note">
            {listNote}
          </div>
        ) : null}
        {services && services.issues.length > 0 ? (
          <div
            className="mfbe-settings-note mfbe-settings-ai-warning"
            data-testid="settings-ai-list-issues"
          >
            <div>{t('dialog.settings.ai.issues.title')}</div>
            <ul className="mfbe-settings-list mfbe-settings-ai-issues">
              {services.issues.map((issue, index) => (
                <li key={`${issue.file}:${issue.index ?? ''}:${issue.reason}:${index}`}>
                  {issue.index === undefined
                    ? t('dialog.settings.ai.issues.file', {
                        file: issue.file,
                        reason: listIssueReason(issue, t),
                      })
                    : t('dialog.settings.ai.issues.entry', {
                        file: issue.file,
                        index: issue.index,
                        reason: listIssueReason(issue, t),
                      })}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </GroupBox>

      <GroupBox title={t('dialog.settings.ai.agreements.title')} testId="settings-ai-agreements">
        {agreements.length === 0 ? (
          <div className="mfbe-settings-note" data-testid="settings-ai-agreements-none">
            {t('dialog.settings.ai.agreements.none')}
          </div>
        ) : (
          <ul className="mfbe-settings-list mfbe-settings-ai-agreements">
            {agreements.map((agreement) => (
              <li key={agreement.service} className="mfbe-settings-ai-agreement">
                <span>
                  {t('dialog.settings.ai.agreements.row', {
                    service: entryName(agreement.service),
                    host: agreement.host,
                    date: agreementDate(agreement.at, language),
                  })}
                </span>
                <button
                  type="button"
                  className="mfbe-button"
                  disabled={!rpc}
                  onClick={() => void revoke(agreement.service)}
                  data-testid={`settings-ai-agreement-${agreement.service}-revoke`}
                >
                  {t('dialog.settings.ai.agreements.revoke')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </GroupBox>
    </div>
  );
}
