/**
 * Thin wrappers over the `words.*` methods (rpc-api.md §3.5) tolerant to the two answer
 * shapes in circulation: `words.analyze` answers `{words, entries, totalWords, durationMs}`
 * (or `{jobId}` for big books, resolved through `rpc.runJob`), `words.exclusions` answers
 * `{words: string[]}` (the typed contract says `string[]`).
 */

import type { RpcClient } from '@/rpc/client';
import type { Document } from '@/rpc/types';

export interface WordStat {
  word: string;
  count: number;
  excluded: boolean;
}

export interface WordsAnalysis {
  words: WordStat[];
  totalWords: number;
  durationMs: number;
}

export function analysisFrom(raw: unknown): WordsAnalysis {
  const record = (typeof raw === 'object' && raw !== null ? raw : {}) as {
    words?: unknown;
    entries?: unknown;
    totalWords?: unknown;
    durationMs?: unknown;
  };
  const list = Array.isArray(record.words)
    ? record.words
    : Array.isArray(record.entries)
      ? record.entries
      : [];
  const words: WordStat[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const w = item as { word?: unknown; count?: unknown; excluded?: unknown };
    if (typeof w.word !== 'string') continue;
    words.push({
      word: w.word,
      count: typeof w.count === 'number' ? w.count : 0,
      excluded: w.excluded === true,
    });
  }
  const totalWords =
    typeof record.totalWords === 'number'
      ? record.totalWords
      : words.reduce((sum, w) => sum + w.count, 0);
  return {
    words,
    totalWords,
    durationMs: typeof record.durationMs === 'number' ? record.durationMs : 0,
  };
}

export function exclusionsFrom(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' && raw !== null && Array.isArray((raw as { words?: unknown }).words)
      ? (raw as { words: unknown[] }).words
      : [];
  return list.filter((item): item is string => typeof item === 'string');
}

export async function analyzeWords(
  rpc: RpcClient,
  docId: string,
  document: Document,
  includeExclusions = true,
): Promise<WordsAnalysis> {
  const result = await rpc.runJob('words.analyze', { docId, document, includeExclusions });
  return analysisFrom(result);
}

export async function fetchExclusions(rpc: RpcClient): Promise<string[]> {
  return exclusionsFrom(await rpc.call('words.exclusions', {}));
}

export async function updateExclusions(
  rpc: RpcClient,
  change: { add?: string[]; remove?: string[] },
): Promise<string[]> {
  return exclusionsFrom(await rpc.call('words.exclusions', change));
}
