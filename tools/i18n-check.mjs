#!/usr/bin/env node
/**
 * i18n parity checker (developer tooling, never shipped).
 *
 * Compares the key sets of the UI catalogues `ui/src/i18n/en.json` and `ui/src/i18n/ru.json`
 * (and, when present, `resources/messages/{en,ru}.json`):
 *   - keys missing from one language or extra in the other          -> error, exit 1
 *   - `{{placeholder}}` sets that differ between languages           -> error, exit 1
 *   - plural families (`key_one`, `key_few`, ...) lacking a category   -> error, exit 1
 *     required by `Intl.PluralRules` for that language
 *   - values identical in both languages                              -> warning, unless the
 *     key is listed in `ui/src/i18n/identical-allowlist.json` (brand names, "OK", codes) or
 *     the value is made of placeholders and punctuation only;
 *     `--strict-identical` turns these warnings into errors
 *   - `--accelerators`: a `&` accelerator letter used twice within one menu (the menu bar,
 *     every `menu.<name>.*` group, the Scripts menu including `scripting.menu.*`, the tree
 *     context menu `tree.menu.*`), within one dialog (`dialog.<name>.*` plus the shared
 *     OK/Cancel/Close buttons; the Replace dialog also embeds the Find fields) or within one
 *     message-box button set                                           -> error, exit 1
 *
 * Usage: node tools/i18n-check.mjs [--strict-identical] [--accelerators] [--quiet]
 *                                  [--catalogues <dir>]...
 * No dependencies beyond Node.js >= 20.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANGUAGES = ['en', 'ru'];
const BASE_LANGUAGE = 'en';
const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];

function parseArgs(argv) {
  const options = { strictIdentical: false, accelerators: false, quiet: false, catalogueDirs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--strict-identical') options.strictIdentical = true;
    else if (arg === '--accelerators') options.accelerators = true;
    else if (arg === '--quiet') options.quiet = true;
    else if (arg === '--catalogues') {
      const dir = argv[i + 1];
      if (!dir) throw new Error('--catalogues requires a directory');
      options.catalogueDirs.push(path.resolve(dir));
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node tools/i18n-check.mjs [--strict-identical] [--accelerators] [--quiet] ' +
          '[--catalogues <dir>]...',
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.catalogueDirs.length === 0) {
    options.catalogueDirs.push(path.join(ROOT, 'ui', 'src', 'i18n'));
    const coreMessages = path.join(ROOT, 'resources', 'messages');
    if (existsSync(path.join(coreMessages, `${BASE_LANGUAGE}.json`))) {
      options.catalogueDirs.push(coreMessages);
    }
  }
  return options;
}

/** Flattens nested objects into `a.b.c` keys; arrays are not allowed in catalogues. */
function flatten(value, prefix, out, file) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${file}: "${prefix}" must be an object or string, got ${typeof value}`);
  }
  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith('$')) continue; // "$comment" style metadata
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') out.set(full, child);
    else flatten(child, full, out, file);
  }
  return out;
}

function loadCatalogue(file) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  return flatten(json, '', new Map(), file);
}

/**
 * Loads `<lang>.json` plus every feature catalogue `<feature>.<lang>.json` in the directory
 * (mirrors the deep merge in ui/src/i18n/index.ts). Duplicate keys across files are errors.
 */
function loadLanguage(dir, language, report) {
  const merged = new Map();
  const owners = new Map();
  const files = [path.join(dir, `${language}.json`)];
  for (const name of readdirSync(dir).sort()) {
    if (name.endsWith(`.${language}.json`) && name !== `${language}.json`) files.push(path.join(dir, name));
  }
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const [key, text] of loadCatalogue(file)) {
      if (merged.has(key)) {
        report.errors.push(
          `${path.relative(ROOT, file)}: key "${key}" already defined in ${path.relative(ROOT, owners.get(key))}`,
        );
        continue;
      }
      merged.set(key, text);
      owners.set(key, file);
    }
  }
  return merged;
}

function loadAllowlist(dir) {
  const file = path.join(dir, 'identical-allowlist.json');
  if (!existsSync(file)) return new Set();
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const keys = Array.isArray(json) ? json : json.keys;
  if (!Array.isArray(keys)) throw new Error(`${file}: expected an array or {"keys": [...]}`);
  return new Set(keys);
}

/** Splits `msg.items_one` into { base: 'msg.items', category: 'one' } or { base, category: null }. */
function splitPlural(key) {
  const underscore = key.lastIndexOf('_');
  if (underscore > 0) {
    const suffix = key.slice(underscore + 1);
    if (PLURAL_SUFFIXES.includes(suffix)) return { base: key.slice(0, underscore), category: suffix };
  }
  return { base: key, category: null };
}

function placeholders(text) {
  const found = new Set();
  for (const match of text.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) found.add(match[1]);
  return found;
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

function pluralCategories(language) {
  return new Set(new Intl.PluralRules(language).resolvedOptions().pluralCategories);
}

/* ------------------------------------------------------------------------ */
/* Accelerators                                                             */
/* ------------------------------------------------------------------------ */

/** Mirrors `parseAccelerator()` of ui/src/i18n/index.ts: first `&x` wins, `&&` is a literal. */
function acceleratorOf(label) {
  for (let i = 0; i < label.length; i += 1) {
    if (label[i] !== '&') continue;
    const next = label[i + 1];
    if (next === '&') {
      i += 1;
      continue;
    }
    if (next !== undefined && next !== ' ') return next.toLowerCase();
  }
  return null;
}

/** Message-box button sets of ui/src/dialogs/buttonSets.ts (`dialog.buttons.*`). */
const MESSAGE_BOX_SETS = {
  ok: ['ok'],
  okCancel: ['ok', 'cancel'],
  yesNo: ['yes', 'no'],
  yesNoCancel: ['yes', 'no', 'cancel'],
  abortRetryIgnore: ['abort', 'retry', 'ignore'],
  close: ['close'],
};

/** Dialog buttons shared by every `Dialog` (OK / Cancel / Close). */
const SHARED_DIALOG_BUTTONS = ['ok', 'cancel', 'close'];

/**
 * Groups of labels whose accelerators must not collide. Menus and dialogs are discovered from
 * the key names; the compositions that the UI builds at run time (Scripts menu, Replace dialog
 * embedding the Find fields, message-box button sets, custom prompts) are listed explicitly.
 */
function acceleratorGroups(flat) {
  const groups = new Map();
  const add = (group, key) => {
    if (!flat.has(key)) return;
    if (!groups.has(group)) groups.set(group, new Set());
    groups.get(group).add(key);
  };
  for (const key of flat.keys()) {
    const menu = /^menu\.([^.]+)\.(.+)$/.exec(key);
    if (menu) {
      add(menu[2] === 'caption' ? 'menubar' : `menu.${menu[1]}`, key);
      continue;
    }
    if (key.startsWith('scripting.menu.')) {
      add('menu.scripts', key);
      continue;
    }
    if (key.startsWith('tree.menu.')) {
      add('tree.menu', key);
      continue;
    }
    const dialog = /^dialog\.([^.]+)\./.exec(key);
    if (dialog && dialog[1] !== 'buttons') add(`dialog.${dialog[1]}`, key);
  }
  for (const group of [...groups.keys()]) {
    if (!group.startsWith('dialog.')) continue;
    for (const button of SHARED_DIALOG_BUTTONS) add(group, `dialog.buttons.${button}`);
  }
  for (const key of groups.get('dialog.find') ?? []) add('dialog.replace', key);
  for (const [set, buttons] of Object.entries(MESSAGE_BOX_SETS)) {
    for (const button of buttons) add(`messageBox.${set}`, `dialog.buttons.${button}`);
  }
  add('msg.scriptStillRunning', 'msg.scriptWait');
  add('msg.scriptStillRunning', 'msg.scriptCancel');
  return groups;
}

/** Returns `{group, letter, keys: [{key, text}]}` for every accelerator used twice in a group. */
function findAcceleratorConflicts(flat) {
  const conflicts = [];
  for (const [group, keys] of acceleratorGroups(flat)) {
    const byLetter = new Map();
    for (const key of keys) {
      const text = flat.get(key);
      const letter = acceleratorOf(text);
      if (letter === null) continue;
      if (!byLetter.has(letter)) byLetter.set(letter, []);
      byLetter.get(letter).push({ key, text });
    }
    for (const [letter, users] of byLetter) {
      if (users.length > 1) conflicts.push({ group, letter, keys: users });
    }
  }
  return conflicts;
}

function checkAccelerators(catalogues, label, report) {
  for (const [language, flat] of catalogues) {
    for (const { group, letter, keys } of findAcceleratorConflicts(flat)) {
      const list = keys.map(({ key, text }) => `"${key}" ("${text}")`).join(', ');
      report.errors.push(
        `${label}: ${language}: accelerator "${letter}" is used more than once in ${group}: ${list}`,
      );
    }
  }
}

function checkDirectory(dir, options, report) {
  const catalogues = new Map();
  for (const language of LANGUAGES) {
    const file = path.join(dir, `${language}.json`);
    if (!existsSync(file)) {
      report.errors.push(`${path.relative(ROOT, dir)}: missing catalogue ${language}.json`);
      return;
    }
    catalogues.set(language, loadLanguage(dir, language, report));
  }
  const allowlist = loadAllowlist(dir);
  const label = path.relative(ROOT, dir) || '.';

  // Logical keys: plural families collapse to their base key.
  const logical = new Map(); // language -> Map<base, Map<category|'', text>>
  for (const [language, flat] of catalogues) {
    const map = new Map();
    for (const [key, text] of flat) {
      const { base, category } = splitPlural(key);
      if (!map.has(base)) map.set(base, new Map());
      map.get(base).set(category ?? '', text);
    }
    logical.set(language, map);
  }

  const base = logical.get(BASE_LANGUAGE);
  for (const language of LANGUAGES) {
    if (language === BASE_LANGUAGE) continue;
    const other = logical.get(language);
    for (const key of base.keys()) {
      if (!other.has(key)) report.errors.push(`${label}: "${key}" exists in en but not in ${language}`);
    }
    for (const key of other.keys()) {
      if (!base.has(key)) report.errors.push(`${label}: "${key}" exists in ${language} but not in en`);
    }
  }

  // Plural completeness per language, placeholder parity, identical values.
  for (const [language, map] of logical) {
    const required = pluralCategories(language);
    for (const [key, forms] of map) {
      const isPlural = [...forms.keys()].some((category) => category !== '');
      if (!isPlural) continue;
      for (const category of required) {
        if (!forms.has(category)) {
          report.errors.push(`${label}: plural "${key}" lacks the "_${category}" form in ${language}`);
        }
      }
      for (const category of forms.keys()) {
        if (category !== '' && !required.has(category)) {
          report.warnings.push(
            `${label}: plural "${key}_${category}" is never used by Intl.PluralRules("${language}")`,
          );
        }
      }
    }
  }

  for (const [key, baseForms] of base) {
    for (const language of LANGUAGES) {
      if (language === BASE_LANGUAGE) continue;
      const otherForms = logical.get(language).get(key);
      if (!otherForms) continue;
      const basePlaceholders = new Set();
      const otherPlaceholders = new Set();
      for (const text of baseForms.values()) for (const p of placeholders(text)) basePlaceholders.add(p);
      for (const text of otherForms.values()) for (const p of placeholders(text)) otherPlaceholders.add(p);
      if (!sameSet(basePlaceholders, otherPlaceholders)) {
        report.errors.push(
          `${label}: "${key}" placeholders differ: en {${[...basePlaceholders].join(', ')}} vs ` +
            `${language} {${[...otherPlaceholders].join(', ')}}`,
        );
      }
      for (const [category, text] of baseForms) {
        const otherText = otherForms.get(category);
        if (otherText === undefined || otherText !== text) continue;
        if (/^\W*$/.test(text.replace(/\{\{[^}]*\}\}/g, ''))) continue; // placeholders / punctuation only
        const fullKey = category ? `${key}_${category}` : key;
        if (allowlist.has(fullKey) || allowlist.has(key)) continue;
        const message = `${label}: "${fullKey}" is identical in en and ${language}: "${text}"`;
        if (options.strictIdentical) report.errors.push(message);
        else report.warnings.push(message);
      }
    }
  }

  for (const key of allowlist) {
    if (!base.has(splitPlural(key).base)) {
      report.warnings.push(`${label}: allow-list entry "${key}" does not exist in en.json`);
    }
  }

  if (options.accelerators) checkAccelerators(catalogues, label, report);

  report.summary.push(
    `${label}: ${LANGUAGES.map((l) => `${l}=${catalogues.get(l).size} strings`).join(', ')}, ` +
      `${base.size} logical keys`,
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = { errors: [], warnings: [], summary: [] };
  for (const dir of options.catalogueDirs) checkDirectory(dir, options, report);

  if (!options.quiet) {
    for (const line of report.summary) console.log(line);
    for (const warning of report.warnings) console.warn(`warning: ${warning}`);
  }
  for (const error of report.errors) console.error(`error: ${error}`);
  if (report.errors.length > 0) {
    console.error(`i18n-check: ${report.errors.length} error(s), ${report.warnings.length} warning(s)`);
    process.exit(1);
  }
  if (!options.quiet) {
    console.log(`i18n-check: OK (${report.warnings.length} warning(s))`);
  }
}

main();
