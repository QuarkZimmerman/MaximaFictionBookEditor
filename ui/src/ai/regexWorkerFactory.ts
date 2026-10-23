/**
 * Creates the regex worker of the catalogue as an inline blob (feature 005 T044; the pattern
 * of `scripting/workerFactory.ts`): kept in its own module so that the catalogue and its tests
 * can be given a test double instead (`createRegexRunner(createWorker)`).
 */

import RegexWorker from './regex.worker?worker&inline';
import type { RegexWorkerLike } from './regexRunner';

export function createRegexWorker(): RegexWorkerLike {
  return new RegexWorker({ name: 'mfbe-ai-regex' }) as unknown as RegexWorkerLike;
}
