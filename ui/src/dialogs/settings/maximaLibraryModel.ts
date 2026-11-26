/**
 * Pure draft state, Apply/OK test-verification gate, and tab-leave revert helpers for
 * Settings -> Maxima Library integration (feature 021, FR-001..FR-009, data-model.md §1).
 */

import type {
  MaximaLibrarySettings,
  MaximaLookupSaveConfigParams,
  MaximaLookupStatusResult,
  MaximaLookupTestOutcome,
} from '@/rpc/types';

export const DEFAULT_MAXIMA_LIBRARY_DOMAIN = 'https://maxima-library.com';

export interface MaximaLibrarySavedSnapshot {
  enabled: boolean;
  domain: string;
  hasToken: boolean;
  tokenReadable: boolean;
  verified: boolean;
}

export interface MaximaLibraryDraftState {
  enabled: boolean;
  domain: string;
  /** User-entered plaintext token when `tokenDirty` is true; empty while referencing stored token. */
  tokenInput: string;
  /** True once the user modifies the token field; false while keeping the core's stored token. */
  tokenDirty: boolean;
  hasStoredToken: boolean;
  tokenReadable: boolean;
  /** True iff the current `(domain, effectiveToken)` has passed Test integration (or matches saved verified state). */
  verified: boolean;
  testing: boolean;
  testStatus: 'idle' | 'testing' | 'verified' | 'failed';
  testErrorCode: string;
  testErrorMessage: string;
  retryAfterSeconds?: number;
}

export function normalizeDomainDraft(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

export function buildMaximaTokenPageUrl(rawDomain: string): string {
  const trimmed = normalizeDomainDraft(rawDomain);
  const base = /^https?:\/\/[^/\s]+/i.test(trimmed) ? trimmed : DEFAULT_MAXIMA_LIBRARY_DOMAIN;
  return `${base}/index.php?option=com_maxlib&view=maxlibuserconfig&tab=token`;
}

export function snapshotFromStatus(status: MaximaLookupStatusResult): MaximaLibrarySavedSnapshot {
  return {
    enabled: status.enabled,
    domain: status.domain || DEFAULT_MAXIMA_LIBRARY_DOMAIN,
    hasToken: status.hasToken,
    tokenReadable: status.tokenReadable,
    verified: status.verified,
  };
}

export function snapshotFromSettings(
  settingsSection?: MaximaLibrarySettings,
): MaximaLibrarySavedSnapshot {
  const enabled = settingsSection?.enabled ?? false;
  return {
    enabled,
    domain: settingsSection?.domain || DEFAULT_MAXIMA_LIBRARY_DOMAIN,
    hasToken: Boolean(settingsSection?.verifiedFingerprint),
    tokenReadable: true,
    verified: enabled && Boolean(settingsSection?.verifiedFingerprint),
  };
}

export function createMaximaLibraryDraft(
  saved: MaximaLibrarySavedSnapshot,
): MaximaLibraryDraftState {
  return {
    enabled: saved.enabled,
    domain: saved.domain || DEFAULT_MAXIMA_LIBRARY_DOMAIN,
    tokenInput: '',
    tokenDirty: false,
    hasStoredToken: saved.hasToken,
    tokenReadable: saved.tokenReadable,
    verified: saved.verified && saved.tokenReadable,
    testing: false,
    testStatus: saved.verified && saved.tokenReadable ? 'verified' : 'idle',
    testErrorCode: '',
    testErrorMessage: '',
  };
}

/**
 * Apply and OK stay disabled whenever Enable is checked without a passing test for the current
 * `(domain, token)` draft, or while a test is still in flight (`FR-004`, `FR-006`).
 */
export function canSaveMaximaLibraryDraft(draft: MaximaLibraryDraftState): boolean {
  if (!draft.enabled) return true;
  return draft.verified && !draft.testing;
}

/**
 * Navigating away from the Maxima Library tab while Enable is checked with an unverified or
 * in-flight draft discards the untested edits and reverts to the last saved state (`FR-008`).
 */
export function shouldRevertMaximaLibraryOnTabLeave(draft: MaximaLibraryDraftState): boolean {
  return draft.enabled && (!draft.verified || draft.testing);
}

export function revertMaximaLibraryDraft(
  saved: MaximaLibrarySavedSnapshot,
): MaximaLibraryDraftState {
  return createMaximaLibraryDraft(saved);
}

export function isMaximaLibraryDraftDirty(
  saved: MaximaLibrarySavedSnapshot,
  draft: MaximaLibraryDraftState,
): boolean {
  if (draft.enabled !== saved.enabled) return true;
  if (normalizeDomainDraft(draft.domain) !== normalizeDomainDraft(saved.domain)) return true;
  if (draft.tokenDirty) return true;
  return false;
}

export function setMaximaEnabled(
  draft: MaximaLibraryDraftState,
  saved: MaximaLibrarySavedSnapshot,
  enabled: boolean,
): MaximaLibraryDraftState {
  if (!enabled) {
    return {
      ...draft,
      enabled: false,
      testing: false,
    };
  }
  const unchangedVerified =
    saved.verified &&
    saved.tokenReadable &&
    !draft.tokenDirty &&
    normalizeDomainDraft(draft.domain) === normalizeDomainDraft(saved.domain);
  const verified = draft.verified || unchangedVerified;
  return {
    ...draft,
    enabled: true,
    verified,
    testStatus: verified ? 'verified' : draft.testStatus === 'failed' ? 'failed' : 'idle',
  };
}

export function setMaximaDomain(
  draft: MaximaLibraryDraftState,
  domain: string,
  saved?: MaximaLibrarySavedSnapshot,
): MaximaLibraryDraftState {
  const changed = normalizeDomainDraft(domain) !== normalizeDomainDraft(draft.domain);
  if (!changed) {
    return { ...draft, domain };
  }
  const matchesSavedVerified =
    Boolean(saved) &&
    saved!.verified &&
    saved!.tokenReadable &&
    !draft.tokenDirty &&
    normalizeDomainDraft(domain) === normalizeDomainDraft(saved!.domain);
  return {
    ...draft,
    domain,
    verified: matchesSavedVerified,
    testStatus: matchesSavedVerified ? 'verified' : 'idle',
    testErrorCode: '',
    testErrorMessage: '',
    retryAfterSeconds: undefined,
  };
}

export function setMaximaTokenInput(
  draft: MaximaLibraryDraftState,
  tokenInput: string,
  saved?: MaximaLibrarySavedSnapshot,
): MaximaLibraryDraftState {
  const clearedAbsentToken = Boolean(saved) && !saved!.hasToken && tokenInput === '';
  return {
    ...draft,
    tokenInput,
    tokenDirty: !clearedAbsentToken,
    verified: false,
    testStatus: 'idle',
    testErrorCode: '',
    testErrorMessage: '',
    retryAfterSeconds: undefined,
  };
}

export function applyMaximaTestOutcome(
  draft: MaximaLibraryDraftState,
  outcome: MaximaLookupTestOutcome,
): MaximaLibraryDraftState {
  if (outcome.ok) {
    return {
      ...draft,
      domain: outcome.normalizedDomain || draft.domain,
      verified: true,
      testing: false,
      testStatus: 'verified',
      testErrorCode: '',
      testErrorMessage: '',
      retryAfterSeconds: undefined,
    };
  }
  return {
    ...draft,
    verified: false,
    testing: false,
    testStatus: 'failed',
    testErrorCode: outcome.code || 'unknown',
    testErrorMessage: outcome.message || '',
    retryAfterSeconds: outcome.retryAfterSeconds,
  };
}

export function buildSaveConfigParams(
  draft: MaximaLibraryDraftState,
): MaximaLookupSaveConfigParams {
  if (draft.tokenDirty) {
    return {
      enabled: draft.enabled,
      domain: draft.domain,
      token: draft.tokenInput,
    };
  }
  return {
    enabled: draft.enabled,
    domain: draft.domain,
    useStoredToken: true,
  };
}
