/**
 * The interface's own texts for the journeys: the catalogues of `ui/src/i18n` merged as the
 * application merges them (`<lang>.json` plus every `<feature>.<lang>.json`), in the language
 * the page shows (`<html lang>`), so one journey asserts the same text in English and in Russian.
 * `{{name}}` placeholders are filled, `&` accelerator markers removed (`&&` is a literal `&`),
 * and a `count` picks the plural form as i18next does.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

export type UiLang = 'en' | 'ru';

type Catalogue = { [key: string]: string | Catalogue };

const I18N_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../src/i18n');
const SCRIPT_FIXTURES = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../../../tests/scripts/fixtures',
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
  const value = lookup(lang, key) ?? '';
  const match = /&([^&])/.exec(value.replace(/&&/g, ''));
  if (!match) throw new Error(`"${key}" has no accelerator in the ${lang} catalogue`);
  return match[1]!.toLowerCase();
}

/** The language the page's interface shows. */
export async function pageLang(page: Page): Promise<UiLang> {
  const lang = await page.evaluate<string>('document.documentElement.lang');
  return lang === 'ru' ? 'ru' : 'en';
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
