/**
 * The assistant proper (feature 005): the module behind the lazy `ai-assistant` chunk, imported
 * once by `ui/src/ai/index.ts` on the first turn-on (research R8.4, review B2; SC-013: nothing
 * of it is requested while the assistant is off or disabled). Everything under `src/ai/` but
 * the static set `index.ts`, `address.ts`, `agreements.ts` and `testHooks.ts` lands in this
 * chunk (vite.config.ts), the MCP SDK and zod included.
 *
 * Skeleton of T031: the exported surface with its types. `startAssistant` / `stopAssistant`
 * flip the on/off state and clear the conversation (data-model §3.3) - the panel, the catalogue
 * instance and the context-menu entry are US3's (T053); `startRequest` answers `failed
 * (internal)` until the request loop exists (US2 T046, US3 T053); `cancelRequest` has nothing
 * to cancel yet. Nothing here contacts a service, gathers context or takes the lock (FR-020,
 * FR-091).
 */

import type { CommandContext } from '@/app/commands';
import { actions, emptyConversation, type AppStore } from '@/model/store';

/** The end of a request as the panel and the popup see it (data-model §4.1 `outcome`, §4.5). */
export type RequestFailureKind =
  | 'offline'
  | 'timeout'
  | 'tls'
  | 'auth'
  | 'model'
  | 'limit'
  | 'oversize'
  | 'paragraphTooLarge'
  | 'service'
  | 'format'
  | 'truncated'
  | 'contentFilter'
  | 'invalidAtEnd'
  | 'validationUnavailable'
  | 'busy'
  | 'noService'
  | 'internal';

export interface RequestFailure {
  kind: RequestFailureKind;
  status?: number;
  serviceCode?: string | number;
  /** The service's own words; shown, never logged by the UI. */
  message?: string;
  /** `limit`: the wait that was not waited for. */
  waitSeconds?: number;
}

export type RequestOutcome =
  | { kind: 'committed'; text?: string; undo?: { label: string } }
  | { kind: 'answered'; text: string }
  | { kind: 'askedBack'; text: string }
  | { kind: 'failed'; failure: RequestFailure }
  | { kind: 'cancelled' }
  | { kind: 'rejected'; text?: string };

/** What starts a request (data-model §4.1): where from, what the user typed. */
export interface StartRequestOptions {
  origin: 'popup' | 'panel';
  instruction: string;
}

/** Turns the assistant on: the state flips, the conversation starts empty; no request, no lock. */
export function startAssistant(store: AppStore): void {
  const state = store.getState();
  if (state.ai.on) return;
  actions.updateAi(store, {
    on: true,
    loaded: true,
    request: null,
    conversation: emptyConversation(),
    panelFocus: false,
  });
}

/**
 * Turns the assistant off: the conversation is cleared (FR-045), the catalogue instance and a
 * request reference dropped; the document and `modified` are untouched (FR-095). The imported
 * chunk stays idle.
 */
export function stopAssistant(store: AppStore): void {
  actions.updateAi(store, {
    on: false,
    request: null,
    catalogue: null,
    conversation: emptyConversation(),
    panelFocus: false,
  });
}

/**
 * Starts a request. Skeleton: no request loop exists yet, so the answer is a `failed`
 * outcome of kind `internal` and nothing is sent, locked or changed - whatever the context
 * and the instruction.
 */
export function startRequest(
  ctx: CommandContext,
  options: StartRequestOptions,
): Promise<RequestOutcome> {
  void ctx;
  void options;
  return Promise.resolve({ kind: 'failed', failure: { kind: 'internal' } });
}

/** Cancels the running request; nothing runs in the skeleton (T046 / T053). */
export function cancelRequest(store: AppStore): void {
  void store;
}

/** The module's surface as `ui/src/ai/index.ts` imports it (`import('./assistant')`). */
export interface AssistantModule {
  startAssistant: typeof startAssistant;
  stopAssistant: typeof stopAssistant;
  startRequest: typeof startRequest;
  cancelRequest: typeof cancelRequest;
}
