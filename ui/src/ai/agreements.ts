/**
 * First-use agreements of the AI assistant (feature 005 FR-008, FR-021; data-model §2.3;
 * rpc-api §3.7 `ai.agreements`): pure helpers over the stored array `{service, host, at}` and
 * the one immediate write of it.
 *
 * The notice is due when the target is hosted (`isLocalAddress` false) and no agreement carries
 * both the target's key and the host the address now resolves to - so a user list entry that
 * redirects a bundled id to another server asks again (review B4); a local address never asks.
 * *Yes* appends an agreement or replaces the one with the same `service`; withdrawing removes
 * it. The UI rewrites the whole array from the latest settings snapshot and writes it at once
 * with `settings.set` (`saveAgreements` - the `recordCheck()` pattern of the version check, not
 * the debounced session save); the core's gate (1200 `noAgreement`) checks the same pair.
 *
 * Part of the main bundle (vite.config.ts): the settings page lists and withdraws agreements
 * while the assistant is off or disabled.
 */

import { actions, type AppStore } from '@/model/store';
import type { RpcClient } from '@/rpc/client';
import type { AiAgreement, Settings } from '@/rpc/types';

import { agreementKey, hostOf, isLocalAddress, type AgreementTarget } from './address';

export { agreementKey } from './address';

/**
 * What the notice and the agreement are about: a free entry by id or the custom target by its
 * address (the stored one, or the draft of a test or fetch) - the key of `agreementKey` plus
 * the address whose host the agreement is bound to.
 */
export type AgreementSubject = AgreementTarget & { address: string };

/** The stored agreements of a settings snapshot (`[]` without one or on an older core). */
export function agreementsOf(settings: Settings | null | undefined): AiAgreement[] {
  const agreements = settings?.ai?.agreements;
  return Array.isArray(agreements) ? agreements : [];
}

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

/** `isNoticeDue` against the agreements of a settings snapshot. */
export function agreementDue(
  subject: AgreementSubject,
  settings: Settings | null | undefined,
): boolean {
  return isNoticeDue(agreementsOf(settings), subject, subject.address);
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

/** The agreements of `settings` with `subject` agreed to at its current host (`withAgreement`). */
export function settingsWithAgreement(
  settings: Settings | null | undefined,
  subject: AgreementSubject,
  at?: string,
): AiAgreement[] {
  return withAgreement(agreementsOf(settings), agreementKey(subject), hostOf(subject.address), at);
}

/** The agreements of `settings` without the one stored under `key` (`withoutAgreement`). */
export function settingsWithoutAgreement(
  settings: Settings | null | undefined,
  key: string,
): AiAgreement[] {
  return withoutAgreement(agreementsOf(settings), key);
}

/**
 * Writes `agreements` as the whole `ai.agreements` array **now**: the store first (so the page
 * and the next due-check see it at once), then one `settings.set` - never the debounced session
 * save (data-model §2.3). Resolves false when the core refused or no client exists; the store
 * then goes back to what it was.
 */
export async function saveAgreements(
  store: AppStore,
  rpc: RpcClient | null,
  agreements: AiAgreement[],
): Promise<boolean> {
  const before = store.getState().settings;
  if (before) {
    store.setState({ settings: { ...before, ai: { ...before.ai, agreements } } });
  }
  if (!rpc) return false;
  try {
    const result = await rpc.call('settings.set', { patch: { ai: { agreements } } });
    actions.setSettings(store, result.settings);
    return true;
  } catch {
    if (before) store.setState({ settings: before });
    return false;
  }
}
