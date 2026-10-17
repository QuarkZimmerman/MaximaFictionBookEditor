/**
 * Genre and language catalogues of the Description forms (rpc-api.md §3.6):
 *
 *  - `resources.genres()` -> `{entries, categories, userFiles, effectiveSources, issues}`; the
 *    effective list is the standard FB2 list plus bundled / user extensions (FR-051), rebuilt by
 *    the core on every call so a new user file shows up without a restart;
 *  - `resources.languages()` -> `{groups: [{key, title, languages: [{code, name}]}], entries}`.
 *
 * Both are cached per RPC client and refreshed on the `resources.changed` notification. Names
 * are shown in the interface language (`en`, `ru`, `uk` - the core serves every one of them)
 * with an English fallback; codes unknown to the list are shown as-is (and preserved).
 */

import { useEffect, useState } from 'react';

import type { RpcClient } from '@/rpc/client';
import type { UiLanguage } from '@/rpc/types';

export interface GenreCatalogEntry {
  code: string;
  category: string;
  names: Record<string, string>;
  /** `standard`, `bundled-extension`, `user`... */
  source: string;
  file?: string;
  alsoIn?: { category: string; names: Record<string, string> }[];
}

export interface GenreCategory {
  key: string;
  titles: Record<string, string>;
}

export interface GenreCatalog {
  entries: GenreCatalogEntry[];
  categories: GenreCategory[];
  userFiles: string[];
  effectiveSources: { source: string; path?: string; layer?: string; entries: number }[];
  issues: { file: string; line?: number; reason: string; code?: string }[];
}

export interface LanguageGroup {
  key: string;
  title: Record<string, string>;
  languages: { code: string; name: Record<string, string> }[];
}

export interface LanguageCatalog {
  groups: LanguageGroup[];
}

export const EMPTY_GENRES: GenreCatalog = {
  entries: [],
  categories: [],
  userFiles: [],
  effectiveSources: [],
  issues: [],
};

export const EMPTY_LANGUAGES: LanguageCatalog = { groups: [] };

/**
 * The name in the interface language (`names.uk` under the Ukrainian interface, ...) with
 * English fallback (then the first available name, then the code).
 */
export function localName(
  names: Record<string, string> | undefined,
  language: UiLanguage,
  fallback: string,
): string {
  if (!names) return fallback;
  return names[language] || names.en || Object.values(names)[0] || fallback;
}

export function genreName(
  catalog: GenreCatalog,
  code: string,
  language: UiLanguage,
): string | undefined {
  const entry = catalog.entries.find((e) => e.code === code);
  return entry ? localName(entry.names, language, code) : undefined;
}

export function categoryTitle(catalog: GenreCatalog, key: string, language: UiLanguage): string {
  const category = catalog.categories.find((c) => c.key === key);
  return category ? localName(category.titles, language, key) : key;
}

export function languageName(
  catalog: LanguageCatalog,
  code: string,
  language: UiLanguage,
): string | undefined {
  for (const group of catalog.groups) {
    const entry = group.languages.find((l) => l.code === code);
    if (entry) return localName(entry.name, language, code);
  }
  return undefined;
}

/* ------------------------------------------------------------------------ */
/* Grouping (genre picker)                                                  */
/* ------------------------------------------------------------------------ */

export interface GenreGroup {
  key: string;
  title: string;
  entries: GenreCatalogEntry[];
}

function matchesFilter(entry: GenreCatalogEntry, filter: string): boolean {
  if (!filter) return true;
  const needle = filter.toLowerCase();
  if (entry.code.toLowerCase().includes(needle)) return true;
  return Object.values(entry.names).some((name) => name.toLowerCase().includes(needle));
}

/** Entries matching `filter` (code or any name), grouped by category in catalogue order. */
export function groupGenres(
  catalog: GenreCatalog,
  language: UiLanguage,
  filter: string,
): GenreGroup[] {
  const groups = new Map<string, GenreGroup>();
  const order = catalog.categories.map((c) => c.key);
  for (const entry of catalog.entries) {
    if (!matchesFilter(entry, filter)) continue;
    const key = entry.category || 'other';
    let group = groups.get(key);
    if (!group) {
      group = { key, title: categoryTitle(catalog, key, language), entries: [] };
      groups.set(key, group);
    }
    group.entries.push(entry);
  }
  return [...groups.values()].sort((a, b) => {
    const ia = order.indexOf(a.key);
    const ib = order.indexOf(b.key);
    return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib);
  });
}

/* ------------------------------------------------------------------------ */
/* Loader                                                                   */
/* ------------------------------------------------------------------------ */

type Listener = () => void;

/** Lazy, cached catalogues of one RPC client; `resources.changed` invalidates the genres. */
export class ResourceCatalogs {
  private genresValue: GenreCatalog | null = null;
  private languagesValue: LanguageCatalog | null = null;
  private genresPromise: Promise<GenreCatalog> | null = null;
  private languagesPromise: Promise<LanguageCatalog> | null = null;
  private readonly listeners = new Set<Listener>();
  private offChanged: (() => void) | null = null;

  constructor(private readonly rpc: RpcClient) {
    try {
      this.offChanged = rpc.on('resources.changed', ({ what }) => {
        if (what === 'genres') this.invalidateGenres();
      });
    } catch {
      this.offChanged = null;
    }
  }

  dispose(): void {
    this.offChanged?.();
    this.offChanged = null;
  }

  get genres(): GenreCatalog | null {
    return this.genresValue;
  }

  get languages(): LanguageCatalog | null {
    return this.languagesValue;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  /** A user genre file changed: refetch the effective list (listeners see the new one). */
  invalidateGenres(): void {
    this.genresPromise = null;
    if (this.genresValue) this.loadGenres(true).catch(() => undefined);
  }

  loadGenres(force = false): Promise<GenreCatalog> {
    if (force) this.genresPromise = null;
    if (!this.genresPromise) {
      this.genresPromise = this.rpc
        .request('resources.genres')
        .then((raw) => {
          const catalog = normaliseGenres(raw);
          this.genresValue = catalog;
          this.emit();
          return catalog;
        })
        .catch((error: unknown) => {
          this.genresPromise = null;
          throw error;
        });
    }
    return this.genresPromise;
  }

  loadLanguages(): Promise<LanguageCatalog> {
    if (!this.languagesPromise) {
      this.languagesPromise = this.rpc
        .request('resources.languages')
        .then((raw) => {
          const catalog = normaliseLanguages(raw);
          this.languagesValue = catalog;
          this.emit();
          return catalog;
        })
        .catch((error: unknown) => {
          this.languagesPromise = null;
          throw error;
        });
    }
    return this.languagesPromise;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asNames(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, name] of Object.entries(asRecord(value))) {
    if (typeof name === 'string') out[key] = name;
  }
  return out;
}

export function normaliseGenres(raw: unknown): GenreCatalog {
  const record = asRecord(raw);
  const entries: GenreCatalogEntry[] = [];
  for (const item of Array.isArray(record.entries) ? record.entries : []) {
    const e = asRecord(item);
    if (typeof e.code !== 'string') continue;
    const entry: GenreCatalogEntry = {
      code: e.code,
      category: typeof e.category === 'string' ? e.category : '',
      names: asNames(e.names),
      source: typeof e.source === 'string' ? e.source : 'standard',
    };
    if (typeof e.file === 'string') entry.file = e.file;
    if (Array.isArray(e.alsoIn)) {
      entry.alsoIn = e.alsoIn.map((also) => {
        const a = asRecord(also);
        return {
          category: typeof a.category === 'string' ? a.category : '',
          names: asNames(a.names),
        };
      });
    }
    entries.push(entry);
  }
  const categories: GenreCategory[] = [];
  for (const item of Array.isArray(record.categories) ? record.categories : []) {
    const c = asRecord(item);
    if (typeof c.key !== 'string') continue;
    categories.push({ key: c.key, titles: asNames(c.titles) });
  }
  // Categories introduced by user files only (no `categories` entry) still get a group.
  for (const entry of entries) {
    if (entry.category && !categories.some((c) => c.key === entry.category)) {
      categories.push({ key: entry.category, titles: {} });
    }
  }
  return {
    entries,
    categories,
    userFiles: Array.isArray(record.userFiles)
      ? record.userFiles.filter((f): f is string => typeof f === 'string')
      : [],
    effectiveSources: Array.isArray(record.effectiveSources)
      ? record.effectiveSources.map((s) => {
          const r = asRecord(s);
          return {
            source: typeof r.source === 'string' ? r.source : '',
            path: typeof r.path === 'string' ? r.path : undefined,
            layer: typeof r.layer === 'string' ? r.layer : undefined,
            entries: typeof r.entries === 'number' ? r.entries : 0,
          };
        })
      : [],
    issues: Array.isArray(record.issues)
      ? record.issues.map((i) => {
          const r = asRecord(i);
          return {
            file: typeof r.file === 'string' ? r.file : '',
            line: typeof r.line === 'number' ? r.line : undefined,
            reason: typeof r.reason === 'string' ? r.reason : '',
            code: typeof r.code === 'string' ? r.code : undefined,
          };
        })
      : [],
  };
}

export function normaliseLanguages(raw: unknown): LanguageCatalog {
  const record = asRecord(raw);
  const groups: LanguageGroup[] = [];
  for (const item of Array.isArray(record.groups) ? record.groups : []) {
    const g = asRecord(item);
    if (typeof g.key !== 'string') continue;
    groups.push({
      key: g.key,
      title: asNames(g.title),
      languages: (Array.isArray(g.languages) ? g.languages : [])
        .map((l) => {
          const r = asRecord(l);
          return { code: typeof r.code === 'string' ? r.code : '', name: asNames(r.name) };
        })
        .filter((l) => l.code),
    });
  }
  return { groups };
}

/* ------------------------------------------------------------------------ */
/* React hooks                                                              */
/* ------------------------------------------------------------------------ */

const catalogs = new WeakMap<RpcClient, ResourceCatalogs>();

export function resourceCatalogsFor(rpc: RpcClient): ResourceCatalogs {
  let instance = catalogs.get(rpc);
  if (!instance) {
    instance = new ResourceCatalogs(rpc);
    catalogs.set(rpc, instance);
  }
  return instance;
}

/** Genre and language catalogues, loaded once the core is connected (empty without a core). */
export function useResourceCatalogs(
  rpc: RpcClient | null,
  connected: boolean,
): { genres: GenreCatalog; languages: LanguageCatalog; reloadGenres: () => void } {
  const [, setTick] = useState(0);
  const instance = rpc ? resourceCatalogsFor(rpc) : null;
  useEffect(() => {
    if (!instance) return;
    const off = instance.subscribe(() => setTick((n) => n + 1));
    return off;
  }, [instance]);
  useEffect(() => {
    if (!instance || !connected) return;
    instance.loadGenres().catch(() => undefined);
    instance.loadLanguages().catch(() => undefined);
  }, [instance, connected]);
  return {
    genres: instance?.genres ?? EMPTY_GENRES,
    languages: instance?.languages ?? EMPTY_LANGUAGES,
    reloadGenres: () => {
      instance?.loadGenres(true).catch(() => undefined);
    },
  };
}
