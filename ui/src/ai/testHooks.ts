/**
 * Test hooks of the AI assistant (feature 005; research R8.4, quickstart §10), installed on
 * `window.__mfbeTest.ai` beside the scripting hooks (`scripting/testHooks.ts`) ONLY when the
 * page was opened with `?test=1` or the core reports `testHooks: true` in `app.info`. Never
 * active in a normal session.
 *
 *   __mfbeTest.ai.on             -> store.ai.on
 *   __mfbeTest.ai.status()       -> 'waiting' | 'registered' | 'disabled' | 'coreTooOld'
 *   __mfbeTest.ai.commands()     -> the registry's `ai.*` entries as {id, visible, enabled, stub}
 *                                   (US9's journey: the two inert stubs while disabled, the
 *                                   three live commands while off)
 *   __mfbeTest.ai.state()        -> store.ai without the catalogue instance
 *   __mfbeTest.ai.lastRequest()  -> the last request's outcome (filled by US3; null before)
 */

import type { CommandContext } from '@/app/commands';
import type { AssistantState } from '@/model/store';

import type { AiFeature, AiFeatureStatus } from './index';

export interface AiCommandSnapshot {
  id: string;
  visible: boolean;
  enabled: boolean;
  stub: boolean;
}

export interface AiTestHooks {
  readonly on: boolean;
  status(): AiFeatureStatus;
  commands(): AiCommandSnapshot[];
  state(): Omit<AssistantState, 'catalogue'> & { catalogue: boolean };
  lastRequest(): unknown;
}

/**
 * A command context for evaluating predicates when no React render has supplied one yet: the
 * feature's commands read `ctx.store` only, the stubs read nothing.
 */
function contextOf(feature: AiFeature): CommandContext {
  return (
    feature.commandContext() ??
    ({ store: feature.store, rpc: null, hotkeys: undefined } as unknown as CommandContext)
  );
}

export function installAiTestHooks(feature: AiFeature): void {
  if (typeof window === 'undefined') return;
  const hooks: AiTestHooks = {
    get on() {
      return feature.store.getState().ai.on;
    },
    status: () => feature.status,
    commands() {
      const ctx = contextOf(feature);
      return feature.commands
        .all()
        .filter((command) => command.id.startsWith('ai.'))
        .map((command) => ({
          id: command.id,
          visible: feature.commands.isVisible(command.id, ctx),
          enabled: feature.commands.isEnabled(command.id, ctx),
          stub: command.stub === true,
        }));
    },
    state() {
      const { catalogue, ...rest } = feature.store.getState().ai;
      return { ...rest, catalogue: catalogue !== null };
    },
    lastRequest: () => null,
  };
  // `window.__mfbeTest` is declared by scripting/testHooks.ts (an open record): the hooks of
  // every feature share the one object.
  const existing = window.__mfbeTest ?? {};
  window.__mfbeTest = Object.assign(existing, { ai: hooks });
}

/** The installed hooks (tests), or undefined. */
export function aiTestHooks(): AiTestHooks | undefined {
  return typeof window === 'undefined'
    ? undefined
    : (window.__mfbeTest?.ai as AiTestHooks | undefined);
}
