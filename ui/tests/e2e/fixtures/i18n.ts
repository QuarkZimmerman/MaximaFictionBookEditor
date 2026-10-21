/**
 * The interface's own texts for the journeys: the catalogues of `ui/src/i18n` merged as the
 * application merges them (`<lang>.json` plus every `<feature>.<lang>.json`), in the language
 * the page shows (`<html lang>`), so one journey asserts the same text in English, in Russian
 * and in Ukrainian (feature 003). `{{name}}` placeholders are filled, `&` accelerator markers
 * removed (`&&` is a literal `&`), and a `count` picks the plural form as i18next does.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

export type UiLang = 'en' | 'ru' | 'uk';

/** The interface languages, in the order of the Settings choice (after "System default"). */
export const UI_LANGS: readonly UiLang[] = ['en', 'ru', 'uk'];

export function isUiLang(value: string | null | undefined): value is UiLang {
  return value === 'en' || value === 'ru' || value === 'uk';
}

type Catalogue = { [key: string]: string | Catalogue };

// Resolved through fileURLToPath: a URL's pathname (`/D:/...`) is not a Windows path (the
// `@platform` journeys run there, feature 004).
const I18N_DIR = fileURLToPath(new URL('../../../src/i18n', import.meta.url));
const SCRIPT_FIXTURES = fileURLToPath(
  new URL('../../../../tests/scripts/fixtures', import.meta.url),
);

function merge(target: Catalogue, source: Catalogue): Catalogue {
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith('$')) continue;
    if (typeof value === 'object') {
      target[key] = merge({ ...((target[key] as Catalogue | undefined) ?? {}) }, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

const catalogues = new Map<UiLang, Catalogue>();

function catalogue(lang: UiLang): Catalogue {
  let loaded = catalogues.get(lang);
  if (!loaded) {
    const read = (file: string) =>
      JSON.parse(readFileSync(path.join(I18N_DIR, file), 'utf8')) as Catalogue;
    loaded = merge({}, read(`${lang}.json`));
    for (const file of readdirSync(I18N_DIR).sort()) {
      if (file.endsWith(`.${lang}.json`)) merge(loaded, read(file));
    }
    catalogues.set(lang, loaded);
  }
  return loaded;
}

function lookup(lang: UiLang, key: string): string | undefined {
  let node: string | Catalogue | undefined = catalogue(lang);
  for (const part of key.split('.')) {
    if (typeof node !== 'object') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

function flatten(node: Catalogue, prefix: string, out: Map<string, string>): void {
  for (const [key, value] of Object.entries(node)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(full, value);
    else flatten(value, full, out);
  }
}

const flatCatalogues = new Map<UiLang, ReadonlyMap<string, string>>();

/**
 * Every text of the `lang` catalogues (base plus features), flattened to `a.b.c` keys, as
 * written: `&` markers and `{{name}}` placeholders included (`$comment` entries skipped).
 */
export function catalogueEntries(lang: UiLang): ReadonlyMap<string, string> {
  let flat = flatCatalogues.get(lang);
  if (!flat) {
    const out = new Map<string, string>();
    flatten(catalogue(lang), '', out);
    flat = out;
    flatCatalogues.set(lang, flat);
  }
  return flat;
}

/** A catalogue value as the user sees it: `&x` -> `x`, `&&` -> `&`. */
export function plainText(value: string): string {
  return value.replace(/&(&?)/g, (_, literal: string) => literal);
}

/**
 * The `&` accelerator letter of a raw catalogue value (lower case), null when it has none;
 * mirrors `parseAccelerator()` of ui/src/i18n/index.ts (the first `&x` wins, `&&` is literal).
 */
export function acceleratorOf(value: string): string | null {
  const match = /&([^&])/.exec(value.replace(/&&/g, ''));
  return match ? match[1]!.toLowerCase() : null;
}

/** The interface text `key` in `lang`, as the user sees it. */
export function uiText(
  lang: UiLang,
  key: string,
  params: Record<string, string | number> = {},
): string {
  let value = lookup(lang, key);
  if (value === undefined && typeof params.count === 'number') {
    const form = new Intl.PluralRules(lang).select(params.count);
    value = lookup(lang, `${key}_${form}`) ?? lookup(lang, `${key}_other`);
  }
  if (value === undefined) throw new Error(`no "${key}" in the ${lang} catalogue`);
  const filled = value.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
  return filled.replace(/&(&?)/g, (_, literal: string) => literal);
}

/** The `&` accelerator letter of the label `key` in `lang` (lower case). */
export function uiAccelerator(lang: UiLang, key: string): string {
  const letter = acceleratorOf(lookup(lang, key) ?? '');
  if (letter === null) throw new Error(`"${key}" has no accelerator in the ${lang} catalogue`);
  return letter;
}

/** The language the page's interface shows (`<html lang>`; English for anything else). */
export async function pageLang(page: Page): Promise<UiLang> {
  // The page shows the browser's language until the core has answered app.info and the
  // start-up language is resolved (`data-lang-resolved` on <html>); read it only from then on.
  // A locator wait (a string expression would be refused by the page's CSP, no 'unsafe-eval').
  await page
    .locator('html[data-lang-resolved="1"]')
    .waitFor({ state: 'attached', timeout: 10_000 })
    .catch(() => undefined);
  const lang = (await page.locator('html').getAttribute('lang')) ?? '';
  return isUiLang(lang) ? lang : 'en';
}

/** `uiText` in the language the page shows. */
export async function pageText(
  page: Page,
  key: string,
  params?: Record<string, string | number>,
): Promise<string> {
  return uiText(await pageLang(page), key, params);
}

/** A pattern of a catalogue text: any value in its placeholders, any white space between words. */
function templatePattern(template: string): string {
  const literal = (part: string) =>
    part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return template
    .split(/\{\{\s*\w+\s*\}\}/)
    .map(literal)
    .join('[\\s\\S]*?');
}

/**
 * A pattern of the interface text `key` in the language the page shows, any value standing in
 * its placeholders (paths, numbers, messages) and any white space between its words.
 */
export async function pagePattern(page: Page, key: string): Promise<RegExp> {
  return new RegExp(templatePattern(uiText(await pageLang(page), key)));
}

const PLURAL_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];

/** A pattern matching any of `keys` (a plural family by its base key) in the page's language. */
export async function pageAnyPattern(page: Page, ...keys: string[]): Promise<RegExp> {
  const lang = await pageLang(page);
  const sources: string[] = [];
  for (const key of keys) {
    for (const candidate of [key, ...PLURAL_FORMS.map((form) => `${key}_${form}`)]) {
      if (lookup(lang, candidate) !== undefined) {
        sources.push(`(?:${templatePattern(uiText(lang, candidate))})`);
      }
    }
  }
  if (sources.length === 0) throw new Error(`none of ${keys.join(', ')} in the ${lang} catalogue`);
  return new RegExp(sources.join('|'));
}

/** The name of a fixture script (`tests/scripts/fixtures/<folder>`) in `lang`, from its manifest. */
export function scriptName(folder: string, lang: UiLang): string {
  const manifest = JSON.parse(
    readFileSync(path.join(SCRIPT_FIXTURES, folder, 'script.json'), 'utf8'),
  ) as { name: Record<string, string> };
  return manifest.name[lang] ?? manifest.name.en!;
}

/** The window title of an untitled document in the language the page shows. */
export async function untitledTitle(page: Page): Promise<string> {
  const lang = await pageLang(page);
  return uiText(lang, 'app.windowTitle', {
    document: uiText(lang, 'app.untitled'),
    app: uiText(lang, 'app.name'),
  });
}
