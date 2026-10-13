/**
 * Catalogue completeness (US8, T096 / SC-004): the merged English and Russian catalogues have
 * the same keys, every issue / error / reason code the core can send has a message in both
 * languages, Russian contains no English-only strings (except the allow-list of brand names and
 * codes) and the `&` accelerators are unique per menu and per dialog.
 *
 * `tools/i18n-check.mjs` performs the same parity checks from the command line (CI step
 * "i18n parity"); this test keeps them in `npm test`.
 */

import identicalAllowlist from '@/i18n/identical-allowlist.json';
import { parseAccelerator, resources } from '@/i18n';

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

const en = flatten(resources.en.translation, '', new Map());
const ru = flatten(resources.ru.translation, '', new Map());
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

const CYRILLIC = /[\u0400-\u04FF]/;
const LETTER = /\p{L}/u;

function withoutPlaceholders(text: string): string {
  return text.replace(/\{\{[^}]*\}\}/g, '');
}

describe('i18n catalogue completeness', () => {
  it('has the same logical keys in English and Russian', () => {
    const enKeys = new Set([...en.keys()].map(logicalKey));
    const ruKeys = new Set([...ru.keys()].map(logicalKey));
    expect([...enKeys].filter((key) => !ruKeys.has(key))).toEqual([]);
    expect([...ruKeys].filter((key) => !enKeys.has(key))).toEqual([]);
    expect(enKeys.size).toBeGreaterThan(800);
  });

  it('has every plural form required by Intl.PluralRules in each language', () => {
    for (const [language, flat] of [
      ['en', en],
      ['ru', ru],
    ] as const) {
      const required = new Intl.PluralRules(language).resolvedOptions().pluralCategories;
      const families = new Map<string, Set<string>>();
      for (const key of flat.keys()) {
        const base = logicalKey(key);
        if (base === key) continue;
        if (!families.has(base)) families.set(base, new Set());
        families.get(base)!.add(key.slice(base.length + 1));
      }
      const missing: string[] = [];
      for (const [base, forms] of families) {
        for (const category of required) {
          if (!forms.has(category)) missing.push(`${language}: ${base}_${category}`);
        }
      }
      expect(missing).toEqual([]);
    }
  });

  it('keeps the same {{placeholders}} in both languages', () => {
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
    const ruPlaceholders = byLogical(ru);
    const differences: string[] = [];
    for (const [key, names] of enPlaceholders) {
      const other = ruPlaceholders.get(key);
      if (!other) continue;
      if ([...names].sort().join(',') !== [...other].sort().join(',')) differences.push(key);
    }
    expect(differences).toEqual([]);
  });

  it('translates every core validation issue code in both languages', () => {
    for (const code of VALIDATION_CODES) {
      const key = CODE_KEY_ALIASES[code] ?? `validation.${code}`;
      expect(en.has(key), `${key} (en)`).toBe(true);
      expect(ru.has(key), `${key} (ru)`).toBe(true);
    }
  });

  it('translates every RPC error, script issue and genre issue code in both languages', () => {
    const keys = [
      ...RPC_ERROR_NAMES.map((name) => `error.${name}`),
      ...SCRIPT_ISSUE_REASONS.map((reason) => `scripting.issue.${reason}`),
      ...GENRE_ISSUE_REASONS.map((reason) => `genres.issue.${reason}`),
    ];
    for (const key of keys) {
      expect(en.has(key), `${key} (en)`).toBe(true);
      expect(ru.has(key), `${key} (ru)`).toBe(true);
    }
  });

  it('has no English-only strings in the Russian catalogue except the allow-list', () => {
    const untranslated: string[] = [];
    for (const [key, text] of ru) {
      const visible = withoutPlaceholders(text);
      if (!LETTER.test(visible)) continue; // punctuation, symbols, placeholders only
      if (allowlist.has(key) || allowlist.has(logicalKey(key))) continue;
      if (!CYRILLIC.test(visible)) untranslated.push(`${key} = ${JSON.stringify(text)}`);
      else if (en.get(key) === text) untranslated.push(`${key} identical to en`);
    }
    expect(untranslated).toEqual([]);
  });

  it('does not keep stale entries in the identical-value allow-list', () => {
    const stale = [...allowlist].filter((key) => !en.has(key) && !en.has(`${key}_one`));
    expect(stale).toEqual([]);
  });

  it('uses unique & accelerators within each menu and dialog in both languages', () => {
    const groupOf = (key: string): string | null => {
      const menu = /^menu\.([^.]+)\.(.+)$/.exec(key);
      if (menu) return menu[2] === 'caption' ? 'menubar' : `menu.${menu[1]}`;
      if (key.startsWith('scripting.menu.')) return 'menu.scripts';
      if (key.startsWith('tree.menu.')) return 'tree.menu';
      const dialog = /^dialog\.([^.]+)\./.exec(key);
      if (dialog && dialog[1] !== 'buttons') return `dialog.${dialog[1]}`;
      return null;
    };
    const conflicts: string[] = [];
    for (const [language, flat] of [
      ['en', en],
      ['ru', ru],
    ] as const) {
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
      add('scripting.running', 'scripting.running.wait');
      add('scripting.running', 'scripting.running.cancel');
      add('msg.scriptStillRunning', 'msg.scriptWait');
      add('msg.scriptStillRunning', 'msg.scriptCancel');
      for (const [group, letters] of groups) {
        for (const [letter, keys] of letters) {
          if (keys.length > 1)
            conflicts.push(`${language} ${group} "${letter}": ${keys.join(', ')}`);
        }
      }
    }
    expect(conflicts).toEqual([]);
  });

  it('localises the language names and the settings language choices', () => {
    for (const key of [
      'lang.en',
      'lang.ru',
      'lang.system',
      'dialog.settings.view.languageSystem',
      'dialog.settings.view.languageEn',
      'dialog.settings.view.languageRu',
      'msg.needRestart',
    ]) {
      expect(en.has(key), key).toBe(true);
      expect(ru.has(key), key).toBe(true);
    }
    expect(ru.get('lang.ru')).toBe('Русский');
    expect(ru.get('lang.en')).toBe('Английский');
    expect(ru.get('msg.needRestart')).toMatch(/перезагруз/i);
  });
});
