/**
 * RPC-backed word checker shared by the live highlighter and the Spelling dialog (T088/T089,
 * rpc-api.md §3.4): batched `spell.check` (at most `BATCH_SIZE` words per call), a per-word
 * result cache keyed by the active dictionaries, `spell.suggest` with a small cache, the custom
 * dictionary operations (`spell.addWord` / `spell.removeWord`) and the dictionary list.
 *
 * Active languages: the session override when the user picked dictionaries, otherwise the
 * document language (`title-info/lang`); tags are resolved against `spell.dictionaries()`
 * (`ru` -> `ru_RU`) when the list is known, the core resolves them too. Error 1020
 * (`spell.dictionaryUnavailable`) marks the language combination unavailable - reported once
 * through `onUnavailable` - and every word counts as correct until the languages change.
 */

import type { AppStore } from '@/model/store';
import { RpcError, type RpcClient } from '@/rpc/client';
import { RpcErrorCode, type RpcParams } from '@/rpc/types';

import type { SpellSession } from './session';

export const BATCH_SIZE = 500;

/** `results`: new verdicts are cached; `invalidate`: every verdict must be re-evaluated. */
export type SpellCheckerEvent = 'results' | 'invalidate';
const SUGGESTION_CACHE_LIMIT = 200;

/** `spell.dictionaries()` entry (the contract's full shape; `rpc/types.ts` declares a subset). */
export interface SpellDictionaryInfo {
  tag: string;
  lang: string;
  name: string;
  path?: string;
  dicPath?: string;
  readmePath?: string;
  source: string;
}

export interface SpellCheckerOptions {
  store: AppStore;
  session: SpellSession;
  getRpc: () => RpcClient | null;
  /** Called once per unavailable language combination. */
  onUnavailable?: (lang: string) => void;
}

/** Normalises a language tag for matching (`ru-RU` -> `ru_ru`). */
export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/-/g, '_');
}

/** `ru` -> `ru_RU` through the dictionary list (exact tag first, then prefix); null when none. */
export function resolveDictionaryTag(
  lang: string,
  dictionaries: readonly SpellDictionaryInfo[],
): string | null {
  const wanted = normalizeTag(lang);
  if (!wanted) return null;
  const exact = dictionaries.find((d) => normalizeTag(d.tag) === wanted);
  if (exact) return exact.tag;
  const base = wanted.split('_')[0]!;
  const prefix = dictionaries.find(
    (d) => normalizeTag(d.tag) === base || normalizeTag(d.tag).startsWith(`${base}_`),
  );
  return prefix ? prefix.tag : null;
}

export class SpellChecker {
  private readonly store: AppStore;
  readonly session: SpellSession;
  private readonly getRpc: () => RpcClient | null;
  private readonly onUnavailable: (lang: string) => void;
  /** `${langsKey}\u0000${word}` -> misspelled? */
  private readonly cache = new Map<string, boolean>();
  private readonly suggestions = new Map<string, string[]>();
  private readonly unavailable = new Set<string>();
  private readonly listeners = new Set<(event: SpellCheckerEvent) => void>();
  private dictionariesValue: SpellDictionaryInfo[] | null = null;
  private dictionariesPromise: Promise<SpellDictionaryInfo[]> | null = null;
  private inflight = new Map<string, Promise<void>>();

  constructor(options: SpellCheckerOptions) {
    this.store = options.store;
    this.session = options.session;
    this.getRpc = options.getRpc;
    this.onUnavailable = options.onUnavailable ?? (() => {});
    this.session.subscribe(() => this.emit('invalidate'));
  }

  /** Fires when results arrived (`results`) or languages / dictionaries changed (`invalidate`). */
  subscribe(listener: (event: SpellCheckerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: SpellCheckerEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  get available(): boolean {
    return this.getRpc() !== null && this.store.getState().connection === 'connected';
  }

  /* ------------------------------------------------------------ languages */

  /** The document's `lang` (title-info), or '' without a document. */
  documentLanguage(): string {
    return this.store.getState().document?.description.titleInfo.lang ?? '';
  }

  /** Active dictionary tags / languages for `spell.check` (never empty when a document exists). */
  activeLangs(): string[] {
    const override = this.session.languageOverride;
    const langs =
      override && override.length > 0
        ? [...override]
        : [this.documentLanguage()].filter((lang) => lang.length > 0);
    if (langs.length === 0) return [];
    const dictionaries = this.dictionariesValue;
    if (!dictionaries) return langs;
    const resolved = langs.map((lang) => resolveDictionaryTag(lang, dictionaries) ?? lang);
    return [...new Set(resolved)];
  }

  langsKey(): string {
    return this.activeLangs().join(',');
  }

  /** True when no dictionary serves the active languages (error 1020 seen, or no language). */
  isUnavailable(): boolean {
    const key = this.langsKey();
    return !key || this.unavailable.has(key);
  }

  get dictionaries(): readonly SpellDictionaryInfo[] | null {
    return this.dictionariesValue;
  }

  /** Loads `spell.dictionaries()` once (refresh with `force`). */
  async loadDictionaries(force = false): Promise<SpellDictionaryInfo[]> {
    if (this.dictionariesValue && !force) return this.dictionariesValue;
    if (this.dictionariesPromise && !force) return this.dictionariesPromise;
    const rpc = this.getRpc();
    if (!rpc) return [];
    this.dictionariesPromise = rpc
      .call('spell.dictionaries')
      .then((list) => {
        this.dictionariesValue = list as unknown as SpellDictionaryInfo[];
        this.emit('invalidate');
        return this.dictionariesValue;
      })
      .catch(() => [] as SpellDictionaryInfo[])
      .finally(() => {
        this.dictionariesPromise = null;
      });
    return this.dictionariesPromise;
  }

  /* ----------------------------------------------------------------- cache */

  private key(word: string, langsKey = this.langsKey()): string {
    return `${langsKey}\u0000${word}`;
  }

  /**
   * Synchronous verdict for a normalised word: true = misspelled, false = correct (or ignored,
   * or no dictionary), undefined = not checked yet.
   */
  lookup(check: string): boolean | undefined {
    if (this.session.isIgnored(check)) return false;
    const langsKey = this.langsKey();
    if (!langsKey || this.unavailable.has(langsKey)) return false;
    return this.cache.get(this.key(check, langsKey));
  }

  /** Words of `checks` that still need a `spell.check` round trip. */
  unknown(checks: Iterable<string>): string[] {
    const out = new Set<string>();
    for (const check of checks) if (this.lookup(check) === undefined) out.add(check);
    return [...out];
  }

  /**
   * Checks the given normalised words (unique, batched); resolves with the misspelled ones.
   * Rejects only on transport errors; an unavailable dictionary resolves with an empty set.
   */
  async check(checks: Iterable<string>): Promise<Set<string>> {
    const langs = this.activeLangs();
    const langsKey = langs.join(',');
    const misspelled = new Set<string>();
    if (!langsKey || this.unavailable.has(langsKey)) return misspelled;
    const unique = [...new Set(checks)];
    const pending: string[] = [];
    for (const word of unique) {
      if (this.session.isIgnored(word)) continue;
      const cached = this.cache.get(this.key(word, langsKey));
      if (cached === true) misspelled.add(word);
      else if (cached === undefined) pending.push(word);
    }
    const rpc = this.getRpc();
    if (pending.length === 0 || !rpc) return misspelled;
    for (let start = 0; start < pending.length; start += BATCH_SIZE) {
      const batch = pending.slice(start, start + BATCH_SIZE);
      const batchKey = `${langsKey}|${batch.join('\u0001')}`;
      let promise = this.inflight.get(batchKey);
      if (!promise) {
        promise = this.checkBatch(rpc, batch, langs, langsKey).finally(() => {
          this.inflight.delete(batchKey);
        });
        this.inflight.set(batchKey, promise);
      }
      await promise;
      for (const word of batch) if (this.cache.get(this.key(word, langsKey))) misspelled.add(word);
    }
    this.emit('results');
    return misspelled;
  }

  private async checkBatch(
    rpc: RpcClient,
    batch: string[],
    langs: string[],
    langsKey: string,
  ): Promise<void> {
    try {
      const result = (await rpc.call('spell.check', { words: batch, langs })) as {
        misspelled: string[];
      };
      const bad = new Set(result.misspelled);
      for (const word of batch) this.cache.set(this.key(word, langsKey), bad.has(word));
    } catch (error) {
      if (error instanceof RpcError && error.code === RpcErrorCode.spellDictionaryUnavailable) {
        this.unavailable.add(langsKey);
        const data = (error.data ?? {}) as { lang?: string };
        this.onUnavailable(data.lang ?? langs.join(', '));
        this.emit('invalidate');
        return;
      }
      throw error;
    }
  }

  /** Suggestions for a misspelled word (cached per word and languages). */
  async suggest(check: string, max = 10): Promise<string[]> {
    const langs = this.activeLangs();
    const key = this.key(check);
    const cached = this.suggestions.get(key);
    if (cached) return cached;
    const rpc = this.getRpc();
    if (!rpc || langs.length === 0) return [];
    try {
      const params = { word: check, langs, max } as RpcParams<'spell.suggest'>;
      const { suggestions } = await rpc.call('spell.suggest', params);
      if (this.suggestions.size >= SUGGESTION_CACHE_LIMIT) {
        const oldest = this.suggestions.keys().next().value;
        if (oldest !== undefined) this.suggestions.delete(oldest);
      }
      this.suggestions.set(key, suggestions);
      return suggestions;
    } catch {
      return [];
    }
  }

  /** Cached suggestions, if already fetched. */
  cachedSuggestions(check: string): string[] | undefined {
    return this.suggestions.get(this.key(check));
  }

  /* ----------------------------------------------------- custom dictionary */

  /** Adds a word to the persistent custom dictionary; it is accepted immediately everywhere. */
  async addWord(word: string): Promise<boolean> {
    const rpc = this.getRpc();
    if (!rpc) return false;
    await rpc.call('spell.addWord', { word });
    this.markCorrect(word);
    return true;
  }

  async removeWord(word: string): Promise<boolean> {
    const rpc = this.getRpc();
    if (!rpc) return false;
    await rpc.call('spell.removeWord', { word });
    this.forget(word);
    return true;
  }

  /** Marks `word` correct for every language combination (after Add). */
  markCorrect(word: string): void {
    for (const key of [...this.cache.keys()]) {
      if (key.endsWith(`\u0000${word}`)) this.cache.set(key, false);
    }
    this.cache.set(this.key(word), false);
    this.emit('invalidate');
  }

  /** Drops the cached verdicts of `word` (re-checked on the next pass). */
  forget(word: string): void {
    for (const key of [...this.cache.keys()]) {
      if (key.endsWith(`\u0000${word}`)) this.cache.delete(key);
    }
    for (const key of [...this.suggestions.keys()]) {
      if (key.endsWith(`\u0000${word}`)) this.suggestions.delete(key);
    }
    this.emit('invalidate');
  }

  /** Forgets every verdict (dictionaries changed on disk, custom dictionary path changed). */
  invalidate(): void {
    this.cache.clear();
    this.suggestions.clear();
    this.unavailable.clear();
    this.emit('invalidate');
  }
}
