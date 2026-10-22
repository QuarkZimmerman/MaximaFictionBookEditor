/**
 * First-use agreements of the AI assistant (feature 005 FR-008, FR-021; data-model §2.3;
 * rpc-api §3.7 `ai.agreements`): pure helpers over the stored array `{service, host, at}`.
 *
 * The notice is due when the target is hosted (`isLocalAddress` false) and no agreement carries
 * both the target's key and the host the address now resolves to - so a user list entry that
 * redirects a bundled id to another server asks again (review B4); a local address never asks.
 * *Yes* appends an agreement or replaces the one with the same `service`; withdrawing removes
 * it. The UI rewrites the whole array from the latest settings snapshot and writes it at once
 * with `settings.set` (not through the debounced session save); the core's gate (1200
 * `noAgreement`) checks the same pair.
 *
 * Part of the main bundle (vite.config.ts): the settings page lists and withdraws agreements
 * while the assistant is off or disabled.
 */

import type { AiAgreement } from '@/rpc/types';

import { agreementKey, hostOf, isLocalAddress, type AgreementTarget } from './address';

export { agreementKey } from './address';

/** True when an agreement for `key` exists whose recorded host equals `host` exactly. */
export function hasAgreement(
  agreements: readonly AiAgreement[],
  key: string,
  host: string,
): boolean {
  return agreements.some((agreement) => agreement.service === key && agreement.host === host);
}

/** The agreement stored under `key`, whatever its host (the page lists it; a host change re-asks). */
export function findAgreement(
  agreements: readonly AiAgreement[],
  key: string,
): AiAgreement | undefined {
  return agreements.find((agreement) => agreement.service === key);
}

/**
 * Whether the first-use notice must be shown before contacting `target` at `address`: hosted
 * and without an agreement for its key and current host (data-model §2.3).
 */
export function isNoticeDue(
  agreements: readonly AiAgreement[],
  target: AgreementTarget,
  address: string,
): boolean {
  if (isLocalAddress(address)) return false;
  return !hasAgreement(agreements, agreementKey(target), hostOf(address));
}

/**
 * The array after *Yes*: the agreement `{service: key, host, at}` appended, or replacing the
 * existing one with the same `service` (its position kept).
 */
export function withAgreement(
  agreements: readonly AiAgreement[],
  key: string,
  host: string,
  at: string = new Date().toISOString(),
): AiAgreement[] {
  const next: AiAgreement = { service: key, host, at };
  const index = agreements.findIndex((agreement) => agreement.service === key);
  if (index < 0) return [...agreements, next];
  return agreements.map((agreement, position) => (position === index ? next : agreement));
}

/** The array after a withdrawal on the settings page: every agreement but `key`'s. */
export function withoutAgreement(agreements: readonly AiAgreement[], key: string): AiAgreement[] {
  return agreements.filter((agreement) => agreement.service !== key);
}
