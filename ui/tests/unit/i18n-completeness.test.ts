/**
 * Catalogue completeness (US8, T096 / SC-004; feature 003 T010): every supported interface
 * language (`SUPPORTED_LANGUAGES` of ui/src/i18n/switch.ts) has the same logical keys as the
 * English base catalogue, every issue / error / reason code the core can send has a message in
 * every language, no translation contains English-only strings (except the allow-list of brand
 * names and codes) and the `&` accelerators are unique per menu and per dialog in every language.
 *
 * The languages are not hard-coded: adding one to `SUPPORTED_LANGUAGES` (with its entry in
 * `resources`) puts it under every check below. Each pairwise check compares the base language
 * with one other language; the other languages are not compared with each other.
 *
 * `tools/i18n-check.mjs` performs the same parity checks from the command line (CI step
 * "i18n parity"); this test keeps them in `npm test`.
 */

import identicalAllowlist from '@/i18n/identical-allowlist.json';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, parseAccelerator, resources } from '@/i18n';

type Flat = Map<string, string>;

const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];

function flatten(value: unknown, prefix: string, out: Flat): Flat {
  if (value === null || typeof value !== 'object') throw new Error(`${prefix}: not an object`);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key.startsWith('$')) continue;
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') out.set(full, child);
    else flatten(child, full, out);
  }
  return out;
}

/** `msg.items_one` -> `msg.items`; other keys unchanged. */
function logicalKey(key: string): string {
  const underscore = key.lastIndexOf('_');
  if (underscore > 0 && PLURAL_SUFFIXES.includes(key.slice(underscore + 1))) {
    return key.slice(0, underscore);
  }
  return key;
}

/** The languages compared with the base language (`ru` today, `uk` once it is supported). */
const OTHER_LANGUAGES: readonly string[] = SUPPORTED_LANGUAGES.filter(
  (language) => language !== DEFAULT_LANGUAGE,
);

const catalogues = new Map<string, Flat>();

/**
 * The merged catalogue of a language, flattened. `resources` is typed for the languages it
 * holds, so a language listed in `SUPPORTED_LANGUAGES` before its catalogue is registered in
 * ui/src/i18n/index.ts fails here with a clear message rather than with a type error.
 */
function catalogue(language: string): Flat {
  let flat = catalogues.get(language);
  if (!flat) {
    const entry = (resources as Record<string, { translation: unknown } | undefined>)[language];
    if (!entry) throw new Error(`ui/src/i18n/index.ts: resources has no "${language}" catalogue`);
    flat = flatten(entry.translation, '', new Map());
    catalogues.set(language, flat);
  }
  return flat;
}

const en = catalogue(DEFAULT_LANGUAGE);
const allowlist = new Set<string>(identicalAllowlist.keys);

/** Validation issue codes of the core (core/src/xml/validator.cpp, fb2_reader.cpp). */
const VALIDATION_CODES = [
  'xml.notWellFormed',
  'xml.namespaceMissing',
  'schema.invalid',
  'schema.unavailable',
  'genre.unknown',
  'link.dangling',
  'image.missingBinary',
  'image.emptyHref',
  'image.externalHref',
  'binary.unreferenced',
  'binary.notImage',
  'binary.willConvert',
  'binary.invalidBase64',
  'binary.duplicateId',
  'binary.missingId',
  'binary.placeholderMissing',
  'encoding.mismatch',
  'description.emptyRequired',
];

/** Mirrors `CODE_KEY_ALIASES` of ui/src/dialogs/validation.ts. */
const CODE_KEY_ALIASES: Record<string, string> = {
  'schema.invalid': 'validation.schemaInvalid',
  'schema.unavailable': 'validation.schemaUnavailable',
};

/** Stable error names of core/include/mfbe/rpc.hpp (`error_name`) plus the client's own. */
const RPC_ERROR_NAMES = [
  'parseError',
  'invalidRequest',
  'methodNotFound',
  'invalidParams',
  'internalError',
  'doc.notFound',
  'doc.parseError',
  'doc.ioError',
  'doc.sourceMalformed',
  'binary.notFound',
  'spell.dictionaryUnavailable',
  'script.notFound',
  'script.invalidManifest',
  'settings.invalid',
  'dialog.unavailable',
  'cancelled',
  'client.timeout',
  'client.disconnected',
  'client.invalidResponse',
];

/** `scripts.list().issues[].reason` (core/src/resources/scripts.cpp). */
const SCRIPT_ISSUE_REASONS = [
  'invalidJson',
  'invalidManifest',
  'entryMissing',
  'iconMissing',
  'duplicateId',
  'invalidGroupJson',
  'missingManifest',
];

/** `resources.genres().issues[].reason` (core/include/mfbe/genres.hpp). */
const GENRE_ISSUE_REASONS = ['unreadable', 'invalidCode', 'missingName', 'duplicate'];

const LETTER = /\p{L}/u;

/**
 * Letters of the script a language is written in (`Intl.Locale("uk").maximize().script` is
 * "Cyrl"): a translated string must contain at least one of them. Null for Latin-script
 * languages - there a leftover English string cannot be told apart by its letters - and for
 * scripts not in the table; those languages only get the "identical to English" check.
 */
function scriptLetters(language: string): RegExp | null {
  const script = new Intl.Locale(language).maximize().script;
  return script === 'Cyrl' ? /\p{Script=Cyrillic}/u : null;
}

function withoutPlaceholders(text: string): string {
  return text.replace(/\{\{[^}]*\}\}/g, '');
}

/** `uk` -> `dialog.settings.view.languageUk` (ui/src/dialogs/settings/model.ts). */
function settingsLanguageKey(language: string): string {
  return `dialog.settings.view.language${language.charAt(0).toUpperCase()}${language.slice(1)}`;
}

describe('i18n catalogue completeness', () => {
  it('has a catalogue for every supported language', () => {
    expect(SUPPORTED_LANGUAGES).toContain(DEFAULT_LANGUAGE);
    expect(OTHER_LANGUAGES.length).toBeGreaterThan(0);
    for (const language of SUPPORTED_LANGUAGES) {
      expect(catalogue(language).size, language).toBeGreaterThan(800);
    }
  });

  for (const language of OTHER_LANGUAGES) {
    it(`has the same logical keys in ${DEFAULT_LANGUAGE} and ${language}`, () => {
      const enKeys = new Set([...en.keys()].map(logicalKey));
      const otherKeys = new Set([...catalogue(language).keys()].map(logicalKey));
      expect([...enKeys].filter((key) => !otherKeys.has(key))).toEqual([]);
      expect([...otherKeys].filter((key) => !enKeys.has(key))).toEqual([]);
    });

    it(`keeps the same {{placeholders}} in ${DEFAULT_LANGUAGE} and ${language}`, () => {
      const placeholders = (text: string) =>
        [...text.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((match) => match[1]).sort();
      const byLogical = (flat: Flat) => {
        const map = new Map<string, Set<string>>();
        for (const [key, text] of flat) {
          const base = logicalKey(key);
          if (!map.has(base)) map.set(base, new Set());
          for (const name of placeholders(text)) map.get(base)!.add(name);
        }
        return map;
      };
      const enPlaceholders = byLogical(en);
      const otherPlaceholders = byLogical(catalogue(language));
      const differences: string[] = [];
      for (const [key, names] of enPlaceholders) {
        const other = otherPlaceholders.get(key);
        if (!other) continue;
        if ([...names].sort().join(',') !== [...other].sort().join(',')) differences.push(key);
      }
      expect(differences).toEqual([]);
    });

    it(`has no English-only strings in the ${language} catalogue except the allow-list`, () => {
      const letters = scriptLetters(language);
      const untranslated: string[] = [];
      for (const [key, text] of catalogue(language)) {
        const visible = withoutPlaceholders(text);
        if (!LETTER.test(visible)) continue; // punctuation, symbols, placeholders only
        if (allowlist.has(key) || allowlist.has(logicalKey(key))) continue;
        if (letters && !letters.test(visible)) {
          untranslated.push(`${key} = ${JSON.stringify(text)}`);
        } else if (en.get(key) === text) {
          untranslated.push(`${key} identical to ${DEFAULT_LANGUAGE}`);
        }
      }
      expect(untranslated).toEqual([]);
    });
  }

  for (const language of SUPPORTED_LANGUAGES) {
    it(`has every plural form required by Intl.PluralRules("${language}")`, () => {
      const required = new Intl.PluralRules(language).resolvedOptions().pluralCategories;
      const families = new Map<string, Set<string>>();
      for (const key of catalogue(language).keys()) {
        const base = logicalKey(key);
        if (base === key) continue;
        if (!families.has(base)) families.set(base, new Set());
        families.get(base)!.add(key.slice(base.length + 1));
      }
      expect(families.size).toBeGreaterThan(0);
      const missing: string[] = [];
      for (const [base, forms] of families) {
        for (const category of required) {
          if (!forms.has(category)) missing.push(`${language}: ${base}_${category}`);
        }
      }
      expect(missing).toEqual([]);
    });

    it(`translates every core validation issue code in ${language}`, () => {
      const flat = catalogue(language);
      for (const code of VALIDATION_CODES) {
        const key = CODE_KEY_ALIASES[code] ?? `validation.${code}`;
        expect(flat.has(key), `${key} (${language})`).toBe(true);
      }
    });

    it(`translates every RPC error, script issue and genre issue code in ${language}`, () => {
      const flat = catalogue(language);
      const keys = [
        ...RPC_ERROR_NAMES.map((name) => `error.${name}`),
        ...SCRIPT_ISSUE_REASONS.map((reason) => `scripting.issue.${reason}`),
        ...GENRE_ISSUE_REASONS.map((reason) => `genres.issue.${reason}`),
      ];
      for (const key of keys) {
        expect(flat.has(key), `${key} (${language})`).toBe(true);
      }
    });

    it(`uses unique & accelerators within each menu and dialog in ${language}`, () => {
      const flat = catalogue(language);
      const groupOf = (key: string): string | null => {
        const menu = /^menu\.([^.]+)\.(.+)$/.exec(key);
        if (menu) return menu[2] === 'caption' ? 'menubar' : `menu.${menu[1]}`;
        if (key.startsWith('scripting.menu.')) return 'menu.scripts';
        if (key.startsWith('tree.menu.')) return 'tree.menu';
        const dialog = /^dialog\.([^.]+)\./.exec(key);
        if (dialog && dialog[1] !== 'buttons') return `dialog.${dialog[1]}`;
        return null;
      };
      const groups = new Map<string, Map<string, string[]>>();
      const add = (group: string, key: string) => {
        const text = flat.get(key);
        if (text === undefined) return;
        const letter = parseAccelerator(text).key;
        if (letter === null) return;
        if (!groups.has(group)) groups.set(group, new Map());
        const letters = groups.get(group)!;
        if (!letters.has(letter)) letters.set(letter, []);
        if (!letters.get(letter)!.includes(key)) letters.get(letter)!.push(key);
      };
      for (const key of flat.keys()) {
        const group = groupOf(key);
        if (group) add(group, key);
      }
      // The Replace dialog embeds the Find fields; every dialog has OK / Cancel / Close.
      for (const key of flat.keys()) {
        if (key.startsWith('dialog.find.')) add('dialog.replace', key);
      }
      for (const group of [...groups.keys()].filter((name) => name.startsWith('dialog.'))) {
        for (const button of ['ok', 'cancel', 'close']) add(group, `dialog.buttons.${button}`);
      }
      add('msg.scriptStillRunning', 'msg.scriptWait');
      add('msg.scriptStillRunning', 'msg.scriptCancel');
      const conflicts: string[] = [];
      for (const [group, letters] of groups) {
        for (const [letter, keys] of letters) {
          if (keys.length > 1)
            conflicts.push(`${language} ${group} "${letter}": ${keys.join(', ')}`);
        }
      }
      expect(conflicts).toEqual([]);
    });

    it(`names every interface language and the settings language choices in ${language}`, () => {
      const flat = catalogue(language);
      const keys = ['lang.system', 'dialog.settings.view.languageSystem', 'msg.needRestart'];
      for (const named of SUPPORTED_LANGUAGES) {
        keys.push(`lang.${named}`, settingsLanguageKey(named));
      }
      for (const key of keys) {
        expect(flat.has(key), `${key} (${language})`).toBe(true);
      }
    });
  }

  it('does not keep stale entries in the identical-value allow-list', () => {
    const stale = [...allowlist].filter((key) => !en.has(key) && !en.has(`${key}_one`));
    expect(stale).toEqual([]);
  });

  it('names the languages in Russian in the Russian catalogue', () => {
    const ru = catalogue('ru');
    expect(ru.get('lang.ru')).toBe('Русский');
    expect(ru.get('lang.en')).toBe('Английский');
    expect(ru.get('msg.needRestart')).toMatch(/перезагруз/i);
  });
});
