/**
 * The regex worker of the assistant's catalogue (feature 005 T044; review C15): runs one
 * model-supplied search per message off the main thread so that a catastrophic pattern can be
 * stopped by terminating the worker after the 2-second budget. Created as an inline blob like
 * the script sandbox worker (`scripting/workerFactory.ts`): same origin, the page's CSP
 * (`worker-src 'self' blob:`) applies. The search is `runRegexSearch` of `regexRunner.ts`.
 */

import { runRegexSearch, type RegexSearchRequest } from './regexRunner';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RegexSearchRequest>) => void) | null;
  postMessage(message: unknown): void;
};

scope.onmessage = (event: MessageEvent<RegexSearchRequest>) => {
  scope.postMessage(runRegexSearch(event.data));
};
