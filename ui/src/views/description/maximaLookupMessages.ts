/**
 * Localized error and banner text formatters for Maxima Library Lookup Service v2 in Description
 * view (feature 021).
 */

import type { TFunction } from 'i18next';

import type { LookupBannerState } from '@/features/lookup/descriptionLookupSession';

export function formatLookupErrorMessage(
  t: TFunction,
  code: string | undefined,
  retryAfterSeconds?: number,
  fallbackMessage?: string,
): string {
  switch (code) {
    case 'unauthorized':
    case 'invalid_token':
    case 'account_disabled':
    case 'https_required':
    case 'wrong_version':
    case 'method_not_allowed':
    case 'invalid_request':
    case 'server_error':
    case 'offline':
    case 'timeout':
    case 'tls':
    case 'http':
    case 'format':
    case 'cancelled':
      return t(`maximaLibrary.settings.errors.${code}`);
    case 'rate_limited':
      if (retryAfterSeconds && retryAfterSeconds > 0) {
        return t('maximaLibrary.settings.errors.rate_limited_retry', {
          seconds: Math.ceil(retryAfterSeconds),
        });
      }
      return t('maximaLibrary.settings.errors.rate_limited');
    default:
      return t('maximaLibrary.settings.errors.unknown', {
        message: fallbackMessage || code || 'error',
      });
  }
}

export function formatLookupBannerMessage(
  t: TFunction,
  banner: LookupBannerState,
  nowMs: number = Date.now(),
): string {
  switch (banner.code) {
    case 'unauthorized':
    case 'invalid_token':
      return t('maximaLibrary.lookup.banner.invalidToken');
    case 'account_disabled':
      return t('maximaLibrary.lookup.banner.accountDisabled');
    case 'rate_limited': {
      const remaining = banner.retryAfterUntilMs
        ? Math.max(1, Math.ceil((banner.retryAfterUntilMs - nowMs) / 1000))
        : 1;
      return t('maximaLibrary.lookup.banner.rateLimited', { seconds: remaining });
    }
    case 'wrong_version':
      return t('maximaLibrary.lookup.banner.wrongVersion');
    case 'server_error':
      return t('maximaLibrary.lookup.banner.serverError');
    case 'offline':
    case 'timeout':
    case 'tls':
    case 'http':
    case 'format':
    default:
      return t('maximaLibrary.lookup.banner.offline');
  }
}
