/**
 * The conversation and the activity list of the assistant as the request loop writes them
 * (feature 005 T046; data-model §5.1, §5.2; ai-catalogue §6.16; FR-042, FR-045): the
 * `Message` list (`user`, `assistant` - with `interim`, `cutOff`, `appliedLine`, `undoLabel` -
 * and the editor's `notice` lines) and the `ActivityEntry` kinds with their payloads, appended
 * **live** to `store.ai.conversation` so the panel (US3) can show every operation as it
 * happens. In memory only: nothing here is serialised anywhere. A conversation belongs to one
 * document: `conversationFor` clears it when the `docId` differs (FR-045).
 *
 * Payloads never carry book text beyond what the user already sees (the instruction and the
 * assistant's answer are messages, not entries); model- and service-supplied texts travel as
 * plain strings the panel renders as text (review C16).
 */

import {
  actions,
  emptyConversation,
  type AppStore,
  type AssistantActivityEntry,
  type AssistantMessage,
} from '@/model/store';

/** The activity kinds of ai-catalogue §6.16 (data-model §5.2). */
export type ActivityKind =
  | 'request.start'
  | 'validate.baseline'
  | 'exchange.sent'
  | 'exchange.answered'
  | 'limit.wait'
  | 'history.trimmed'
  | 'split'
  | 'tool.call'
  | 'tool.result'
  | 'tool.error'
  | 'change.try'
  | 'validate'
  | 'change.accepted'
  | 'change.rejected'
  | 'script.dialog'
  | 'script.proposed'
  | 'request.done'
  | 'request.answered'
  | 'request.askedBack'
  | 'request.cancelled'
  | 'request.failed'
  | 'request.rejected';

let messageCounter = 0;
let requestCounter = 0;

/** The next request id of this page session (`r<N>`, data-model §4.1). */
export function nextRequestId(): string {
  requestCounter += 1;
  return `r${requestCounter}`;
}

/**
 * Makes sure the conversation belongs to `docId`: a conversation of another document is
 * dropped first (FR-045); an empty one adopts the id.
 */
export function conversationFor(store: AppStore, docId: string): void {
  const { conversation } = store.getState().ai;
  if (conversation.docId === docId) return;
  actions.updateAi(store, { conversation: { ...emptyConversation(), docId } });
}

/** Appends one message to the conversation and returns it. */
export function appendMessage(
  store: AppStore,
  message: Omit<AssistantMessage, 'id' | 'at'> & { at?: number },
): AssistantMessage {
  messageCounter += 1;
  const full: AssistantMessage = { id: `m${messageCounter}`, at: Date.now(), ...message };
  const { conversation } = store.getState().ai;
  actions.updateAi(store, {
    conversation: { ...conversation, messages: [...conversation.messages, full] },
  });
  return full;
}

/** Appends one activity entry (`at` = now) and returns it. */
export function appendActivity(
  store: AppStore,
  entry: {
    requestId: string;
    elapsedMs: number;
    kind: ActivityKind;
    payload?: Record<string, unknown>;
  },
): AssistantActivityEntry {
  const full: AssistantActivityEntry = {
    at: Date.now(),
    requestId: entry.requestId,
    elapsedMs: entry.elapsedMs,
    kind: entry.kind,
    payload: entry.payload ?? {},
  };
  const { conversation } = store.getState().ai;
  actions.updateAi(store, {
    conversation: { ...conversation, activity: [...conversation.activity, full] },
  });
  return full;
}

/** Empties the conversation (Clear, turn-off, a document change, exit - FR-045). */
export function clearConversation(store: AppStore): void {
  actions.updateAi(store, { conversation: emptyConversation() });
}
