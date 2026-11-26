/**
 * Feature 021 (T019, US1): Settings -> Maxima Library integration page.
 *
 * Disabled by default; all controls besides the enable checkbox stay disabled while unchecked.
 * Tests draft `(domain, token)` directly via cancellable `maximaLookup.test` without saving first;
 * Apply and OK stay disabled in `SettingsDialog` until the test succeeds for the current values.
 */

import type { TFunction } from 'i18next';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CommandContext } from '@/app/commands';
import { tip } from '@/app/tooltips';
import { ExternalLink } from '@/dialogs/ExternalLink';
import { RpcError } from '@/rpc/client';
import { RpcErrorCode, type MaximaLookupTestParams } from '@/rpc/types';

import { CheckField, FieldRow, GroupBox } from './controls';
import {
  applyMaximaTestOutcome,
  buildMaximaTokenPageUrl,
  setMaximaDomain,
  setMaximaEnabled,
  setMaximaTokenInput,
  type MaximaLibraryDraftState,
  type MaximaLibrarySavedSnapshot,
} from './maximaLibraryModel';

export interface MaximaLibraryPageProps {
  draft: MaximaLibraryDraftState;
  saved: MaximaLibrarySavedSnapshot;
  onChange: (
    updater:
      MaximaLibraryDraftState | ((current: MaximaLibraryDraftState) => MaximaLibraryDraftState),
  ) => void;
  ctx: CommandContext;
  registerCancel?: (cancel: () => void) => () => void;
  onRegisterTabCancel?: (cancel: () => void) => () => void;
}

const KNOWN_ERROR_CODES = new Set([
  'invalidDomain',
  'httpsRequired',
  'emptyToken',
  'tokenUnreadable',
  'unauthorized',
  'invalid_token',
  'account_disabled',
  'https_required',
  'wrong_version',
  'rate_limited',
  'method_not_allowed',
  'invalid_request',
  'server_error',
  'offline',
  'timeout',
  'tls',
  'http',
  'format',
  'cancelled',
]);

function formatTestError(
  code: string,
  message: string,
  retryAfterSeconds: number | undefined,
  t: TFunction,
): string {
  if (code === 'rate_limited' && retryAfterSeconds && retryAfterSeconds > 0) {
    return t('maximaLibrary.settings.errors.rate_limited_retry', {
      seconds: retryAfterSeconds,
    });
  }
  if (KNOWN_ERROR_CODES.has(code)) {
    return t(`maximaLibrary.settings.errors.${code}`);
  }
  return t('maximaLibrary.settings.errors.unknown', { message: message || code });
}

export function MaximaLibraryPage({
  draft,
  saved,
  onChange,
  ctx,
  registerCancel,
  onRegisterTabCancel,
}: MaximaLibraryPageProps) {
  const { t } = useTranslation();
  const rpc = ctx.rpc;
  const domainId = useId();
  const tokenId = useId();

  const [revealed, setRevealed] = useState(false);
  const [revealedStoredToken, setRevealedStoredToken] = useState<string | null>(null);
  const jobRef = useRef<string | null>(null);
  const runSeqRef = useRef(0);

  // Reset reveal state whenever the draft reverts back to saved or integration is unchecked.
  useEffect(() => {
    if (!draft.enabled) {
      setRevealed(false);
      setRevealedStoredToken(null);
    }
  }, [draft.enabled]);

  useEffect(() => {
    if (!draft.tokenDirty) {
      setRevealedStoredToken(null);
      setRevealed(false);
    }
  }, [draft.tokenDirty, saved.domain, saved.enabled, saved.hasToken]);

  const cancelTest = useCallback(() => {
    runSeqRef.current += 1;
    const jobId = jobRef.current;
    jobRef.current = null;
    if (jobId && rpc) {
      rpc.call('job.cancel', { jobId }).catch(() => {
        // Job may already have completed.
      });
    }
    onChange((current) =>
      current.testing ? { ...current, testing: false, testStatus: 'idle' } : current,
    );
  }, [onChange, rpc]);

  useEffect(() => {
    if (!registerCancel) return;
    return registerCancel(cancelTest);
  }, [cancelTest, registerCancel]);

  useEffect(() => {
    if (!onRegisterTabCancel) return;
    return onRegisterTabCancel(cancelTest);
  }, [cancelTest, onRegisterTabCancel]);

  useEffect(() => cancelTest, [cancelTest]);

  const toggleReveal = async () => {
    if (revealed) {
      setRevealed(false);
      return;
    }
    if (!draft.tokenDirty && draft.hasStoredToken && draft.tokenReadable && rpc) {
      try {
        const res = await rpc.call('maximaLookup.revealToken', {});
        if (res.readable) {
          setRevealedStoredToken(res.token);
        }
      } catch {
        // Leave masked on RPC failure.
        return;
      }
    }
    setRevealed(true);
  };

  const runTest = async () => {
    if (!rpc) return;
    cancelTest();
    const seq = ++runSeqRef.current;
    onChange((current) => ({
      ...current,
      testing: true,
      testStatus: 'testing',
      testErrorCode: '',
      testErrorMessage: '',
      retryAfterSeconds: undefined,
    }));

    const params: MaximaLookupTestParams = draft.tokenDirty
      ? { domain: draft.domain, token: draft.tokenInput }
      : { domain: draft.domain, useStoredToken: true };

    try {
      const outcome = await rpc.runJob('maximaLookup.test', params, {
        onStart: (jobId) => {
          if (runSeqRef.current !== seq) {
            rpc.call('job.cancel', { jobId }).catch(() => {});
            return;
          }
          jobRef.current = jobId;
        },
      });
      if (runSeqRef.current !== seq) return;
      jobRef.current = null;
      onChange((current) => applyMaximaTestOutcome(current, outcome));
    } catch (error) {
      if (runSeqRef.current !== seq) return;
      jobRef.current = null;
      if (error instanceof RpcError && error.code === RpcErrorCode.cancelled) {
        onChange((current) => ({ ...current, testing: false, testStatus: 'idle' }));
        return;
      }
      onChange((current) => ({
        ...current,
        verified: false,
        testing: false,
        testStatus: 'failed',
        testErrorCode: 'unknown',
        testErrorMessage: error instanceof Error ? error.message : String(error),
      }));
    }
  };

  const controlsDisabled = !draft.enabled;
  const tokenPageUrl = buildMaximaTokenPageUrl(draft.domain);
  const displayedTokenValue = draft.tokenDirty
    ? draft.tokenInput
    : revealed && revealedStoredToken !== null
      ? revealedStoredToken
      : draft.hasStoredToken && draft.tokenReadable
        ? '••••••••••••••••'
        : '';

  const statusDataAttr =
    draft.testStatus === 'testing'
      ? 'testing'
      : draft.testStatus === 'verified'
        ? 'verified'
        : draft.testStatus === 'failed'
          ? 'failed'
          : 'untested';

  return (
    <div className="mfbe-settings-page" data-testid="settings-page-maximaLibrary">
      {!rpc && (
        <p className="mfbe-settings-note" data-testid="settings-maxima-unavailable">
          {t('maximaLibrary.settings.unavailable')}
        </p>
      )}

      <GroupBox title={t('maximaLibrary.settings.group')}>
        <CheckField
          label={t('maximaLibrary.settings.enable')}
          checked={draft.enabled}
          onChange={(checked) => {
            if (!checked) cancelTest();
            onChange((current) => setMaximaEnabled(current, saved, checked));
          }}
          testId="settings-maxima-enable"
          tooltip={t('tip.settings.maximaLibrary.enable')}
        />
        <p className="mfbe-settings-note">{t('maximaLibrary.settings.enableHint')}</p>

        {!draft.tokenReadable && !draft.tokenDirty && (
          <p className="mfbe-settings-note" role="alert" data-testid="settings-maxima-unreadable">
            {t('maximaLibrary.settings.statusUnreadable')}
          </p>
        )}

        <FieldRow
          label={t('maximaLibrary.settings.domainLabel')}
          htmlFor={domainId}
          tooltip={t('tip.settings.maximaLibrary.domain')}
        >
          <input
            id={domainId}
            {...tip(t('tip.settings.maximaLibrary.domain'))}
            type="text"
            className="mfbe-settings-input"
            value={draft.domain}
            disabled={controlsDisabled || draft.testing}
            onChange={(event) => {
              const value = event.target.value;
              onChange((current) => setMaximaDomain(current, value));
            }}
            data-testid="settings-maxima-domain"
          />
        </FieldRow>

        <FieldRow
          label={t('maximaLibrary.settings.tokenLabel')}
          htmlFor={tokenId}
          tooltip={t('tip.settings.maximaLibrary.token')}
        >
          <div className="mfbe-settings-inline">
            <input
              id={tokenId}
              {...tip(t('tip.settings.maximaLibrary.token'))}
              type={revealed ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              className="mfbe-settings-input"
              value={displayedTokenValue}
              placeholder={
                draft.hasStoredToken && draft.tokenReadable && !draft.tokenDirty
                  ? t('maximaLibrary.settings.tokenStoredPlaceholder')
                  : t('maximaLibrary.settings.tokenPlaceholder')
              }
              disabled={controlsDisabled || draft.testing}
              onChange={(event) => {
                const value = event.target.value;
                setRevealedStoredToken(null);
                onChange((current) => setMaximaTokenInput(current, value));
              }}
              data-testid="settings-maxima-token"
            />
            <button
              {...tip(t('tip.settings.maximaLibrary.revealToken'))}
              type="button"
              disabled={controlsDisabled || draft.testing}
              onClick={() => void toggleReveal()}
              data-testid="settings-maxima-reveal"
            >
              {revealed
                ? t('maximaLibrary.settings.hideToken')
                : t('maximaLibrary.settings.showToken')}
            </button>
          </div>
        </FieldRow>

        <p className="mfbe-settings-note">
          {t('maximaLibrary.settings.tokenHelp')}{' '}
          {controlsDisabled ? (
            <span
              className="mfbe-settings-disabled-link"
              aria-disabled="true"
              data-testid="settings-maxima-token-link"
            >
              {t('maximaLibrary.settings.openTokenPage')}
            </span>
          ) : (
            <ExternalLink url={tokenPageUrl} rpc={rpc} testId="settings-maxima-token-link">
              {t('maximaLibrary.settings.openTokenPage')}
            </ExternalLink>
          )}
        </p>

        <div className="mfbe-settings-row">
          <button
            {...tip(t('tip.settings.maximaLibrary.test'))}
            type="button"
            disabled={controlsDisabled || draft.testing || !rpc}
            onClick={() => void runTest()}
            data-testid="settings-maxima-test"
          >
            {t('maximaLibrary.settings.testButton')}
          </button>
          <span
            className="mfbe-settings-note"
            aria-live="polite"
            data-status={statusDataAttr}
            data-testid="settings-maxima-status"
          >
            {draft.testing
              ? t('maximaLibrary.settings.testing')
              : draft.testStatus === 'verified'
                ? draft.enabled
                  ? t('maximaLibrary.settings.statusVerified')
                  : t('maximaLibrary.settings.statusSavedVerified')
                : draft.testStatus === 'failed'
                  ? formatTestError(
                      draft.testErrorCode,
                      draft.testErrorMessage,
                      draft.retryAfterSeconds,
                      t,
                    )
                  : draft.enabled
                    ? t('maximaLibrary.settings.statusTestRequired')
                    : ''}
          </span>
        </div>
      </GroupBox>
    </div>
  );
}
