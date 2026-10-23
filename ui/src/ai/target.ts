/**
 * The service a request goes to (feature 005 T046, T087; data-model §2.4 `ActiveTarget`):
 * derived from the latest settings snapshot on every use - never stored. `free`: the effective
 * list's entry with the chosen id, else the first entry with `fallback: true` (an empty list →
 * no target); `custom`: the stored triple as `{kind: 'custom'}` - the key never travels, the
 * core resolves the stored triple by itself -, named by its host, `tools` and `contextLength`
 * from the last *Fetch models* answer of the settings page (`store.ai.customModels`, kept in
 * memory with the address it was fetched from; review C13) when the chosen model was in it,
 * `tools` assumed true otherwise; its notice subject is `custom:<address>` with the host
 * (FR-021) - a local address never asks; `disabled`: no target.
 */

import type { CustomModelsMemory } from '@/model/store';
import type { RpcClient } from '@/rpc/client';
import type { AiServiceEntry, AiTarget, Settings } from '@/rpc/types';

import { hostOf, isHostedAddress, isPlainHttp, stripTrailingSlash } from './address';
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
 * What the last *Fetch models* answer says about `model` at `address`: its `tools` and
 * `contextLength` when the answer came from the same address (trailing slashes aside) and
 * listed the model; nothing otherwise (data-model §2.4).
 */
export function fetchedModelInfo(
  memory: CustomModelsMemory | null | undefined,
  address: string,
  model: string,
): { tools?: boolean; contextLength?: number } {
  if (!memory || stripTrailingSlash(memory.address.trim()) !== stripTrailingSlash(address)) {
    return {};
  }
  const known = memory.models.find((item) => item.id === model);
  if (!known) return {};
  return {
    ...(known.tools === undefined ? {} : { tools: known.tools }),
    ...(known.contextLength !== undefined && known.contextLength > 0
      ? { contextLength: known.contextLength }
      : {}),
  };
}

/**
 * Resolves the active target from `settings` and - for the free mode - the effective service
 * list (`ai.services()`, loaded by the core on the first call); `customModels` is the settings
 * page's last *Fetch models* answer (`store.ai.customModels`) for the custom mode's `tools`
 * and `contextLength`.
 */
export async function resolveActiveTarget(
  rpc: Pick<RpcClient, 'call'>,
  settings: Settings | null,
  customModels: CustomModelsMemory | null = null,
): Promise<ResolveTargetResult> {
  const ai = settings?.ai;
  if (!ai) return { ok: false, reason: 'noSettings' };
  if (ai.mode === 'disabled') return { ok: false, reason: 'disabled' };
  if (ai.mode === 'custom') {
    const address = ai.custom.address.trim();
    if (!address) return { ok: false, reason: 'emptyAddress' };
    const model = ai.custom.model.trim();
    if (!model) return { ok: false, reason: 'noModel' };
    const host = hostOf(address);
    const known = fetchedModelInfo(customModels, address, ai.custom.model);
    return {
      ok: true,
      target: {
        target: { kind: 'custom' },
        name: host || address,
        model: ai.custom.model,
        address,
        hosted: isHostedAddress(address),
        plain: isPlainHttp(address),
        tools: known.tools ?? true,
        ...(known.contextLength === undefined ? {} : { contextLength: known.contextLength }),
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
