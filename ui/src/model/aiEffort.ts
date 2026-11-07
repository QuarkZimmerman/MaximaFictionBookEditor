/**
 * Feature 010, US11 (spec D38-D41; resource-formats §1, §2): a model's thinking efforts and the
 * request member that carries the choice - from the service's own model list (*Fetch models*),
 * else the free entry's efforts, else the known models of the service list (`ai-services.json`,
 * the user's file first). Outside the assistant's lazy chunk: the settings page lists the same
 * choices the assistant sends.
 */

import type { AiEffort, AiKnownModel } from '@/rpc/types';

export interface ModelEfforts {
  efforts: string[];
  /** `reasoning_effort`, or a nested member such as `reasoning.effort`. */
  param: string;
}

const DEFAULT_PARAM = 'reasoning_effort';

function matches(pattern: string, model: string): boolean {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`, 'i').test(model);
}

export function effortsOf(
  model: string,
  sources: {
    fetched?: { efforts?: string[]; effortParam?: string } | null;
    entryEfforts?: readonly string[];
    known?: readonly AiKnownModel[];
  },
): ModelEfforts | null {
  const name = model.trim();
  if (!name) return null;
  if (sources.fetched?.efforts?.length) {
    return {
      efforts: sources.fetched.efforts,
      param: sources.fetched.effortParam ?? DEFAULT_PARAM,
    };
  }
  const known = sources.known?.find((entry) => matches(entry.match, name));
  if (sources.entryEfforts?.length) {
    return { efforts: [...sources.entryEfforts], param: known?.param ?? DEFAULT_PARAM };
  }
  return known ? { efforts: known.efforts, param: known.param } : null;
}

/** How `ai.effort.target` names a target: `free:<id>` or `custom`. */
export function effortTarget(target: { kind: 'free'; id: string } | { kind: 'custom' }): string {
  return target.kind === 'free' ? `free:${target.id}` : 'custom';
}

/**
 * What the model offers, or - without its list at hand (after a restart, before *Fetch models*) -
 * the choice stored for this very target and model, which was offered when it was made (D41).
 */
export function offeredOrStored(
  offered: ModelEfforts | null,
  setting: AiEffort | null | undefined,
  target: string,
  model: string,
): ModelEfforts | null {
  if (offered) return offered;
  if (!setting || setting.target !== target || setting.model !== model) return null;
  return { efforts: [setting.value], param: setting.param ?? DEFAULT_PARAM };
}

/** The effort chosen for this target and model, or null: Model's default (D40). */
export function chosenEffort(
  setting: AiEffort | null | undefined,
  target: string,
  model: string,
  offered: ModelEfforts | null,
): string | null {
  if (!setting || !offered || setting.target !== target || setting.model !== model) return null;
  return offered.efforts.includes(setting.value) ? setting.value : null;
}

/** The chat body's members for an effort: `{reasoning_effort: "high"}`, `{reasoning: {effort}}`. */
export function effortMembers(param: string, value: string): Record<string, unknown> {
  const parts = param.split('.').filter(Boolean);
  let member: unknown = value;
  for (let i = parts.length - 1; i > 0; i -= 1) member = { [parts[i]!]: member };
  return { [parts[0] ?? DEFAULT_PARAM]: member };
}
