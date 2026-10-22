/**
 * The service a request goes to (feature 005 T046; data-model §2.4 `ActiveTarget`): derived
 * from the latest settings snapshot on every use - never stored. `free`: the effective list's
 * entry with the chosen id, else the first entry with `fallback: true` (an empty list → no
 * target); `custom`: the stored triple (`tools` assumed true - the Fetch models answer of US8
 * refines it in memory); `disabled`: no target. The key never reaches this module: the core
 * resolves the stored target by itself (`{kind: 'custom'}` names the stored triple).
 */

import type { RpcClient } from '@/rpc/client';
import type { AiServiceEntry, AiTarget, Settings } from '@/rpc/types';

import { hostOf, isHostedAddress, isPlainHttp } from './address';
import type { NoticeTarget } from './notice';

export interface ActiveTarget {
  target: AiTarget;
  /** The display name: the entry's `name`, or the host for the custom target. */
  name: string;
  model: string;
  address: string;
  hosted: boolean;
  plain: boolean;
  tools: boolean;
  contextLength?: number;
  termsUrl?: string;
  /** The saved free id was not in the effective list: the first entry stands in. */
  fallback: boolean;
  /** The agreement subject of the first-use notice (FR-021). */
  notice: NoticeTarget;
}

export type ResolveTargetResult =
  | { ok: true; target: ActiveTarget }
  | { ok: false; reason: 'disabled' | 'noSettings' | 'emptyList' | 'emptyAddress' | 'noModel' };

function fromEntry(entry: AiServiceEntry, fallback: boolean): ActiveTarget {
  const notice: NoticeTarget = {
    kind: 'free',
    id: entry.id,
    address: entry.address,
    name: entry.name,
    ...(entry.termsUrl === undefined ? {} : { termsUrl: entry.termsUrl }),
  };
  return {
    target: { kind: 'free', id: entry.id },
    name: entry.name,
    model: entry.model,
    address: entry.address,
    hosted: !entry.local,
    plain: entry.plainHttp,
    tools: entry.tools,
    ...(entry.contextLength === undefined ? {} : { contextLength: entry.contextLength }),
    ...(entry.termsUrl === undefined ? {} : { termsUrl: entry.termsUrl }),
    fallback,
    notice,
  };
}

/**
 * Resolves the active target from `settings` and - for the free mode - the effective service
 * list (`ai.services()`, loaded by the core on the first call).
 */
export async function resolveActiveTarget(
  rpc: Pick<RpcClient, 'call'>,
  settings: Settings | null,
): Promise<ResolveTargetResult> {
  const ai = settings?.ai;
  if (!ai) return { ok: false, reason: 'noSettings' };
  if (ai.mode === 'disabled') return { ok: false, reason: 'disabled' };
  if (ai.mode === 'custom') {
    const address = ai.custom.address.trim();
    if (!address) return { ok: false, reason: 'emptyAddress' };
    if (!ai.custom.model.trim()) return { ok: false, reason: 'noModel' };
    const host = hostOf(address);
    return {
      ok: true,
      target: {
        target: { kind: 'custom' },
        name: host || address,
        model: ai.custom.model,
        address,
        hosted: isHostedAddress(address),
        plain: isPlainHttp(address),
        tools: true,
        fallback: false,
        notice: { kind: 'custom', address, name: host || address },
      },
    };
  }
  const list = await rpc.call('ai.services');
  const chosen = list.services.find((entry) => entry.id === ai.freeServiceId);
  if (chosen) return { ok: true, target: fromEntry(chosen, false) };
  const first = list.services[0];
  if (!first) return { ok: false, reason: 'emptyList' };
  return { ok: true, target: fromEntry(first, true) };
}
