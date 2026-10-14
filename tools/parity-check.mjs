#!/usr/bin/env node
/**
 * Parity matrix check (T157, SC-003, Constitution I).
 *
 * `docs/parity-matrix.md` maps every menu item, context-menu entry, toolbar button and dialog
 * control of the original editor (`FBE.rc`) to the implementing MFBE command id / component,
 * the `data-testid`s that exercise it and the Playwright journey that covers it. This tool
 * keeps the matrix honest:
 *
 *  1. every row has a status `implemented`, `implemented-differently` or `dropped`;
 *  2. a row that is implemented names command ids that exist in the UI command registry
 *     (`ui/src/**`) and are not stubs, lists at least one existing e2e spec, and at least one
 *     piece of evidence of the row (command id, menu/toolbar test id or any test id in the
 *     Evidence column) occurs in one of those specs;
 *  3. a dropped row carries a note with the reference that justifies the drop;
 *  4. when the original resources are available (`--rc <path to FBE.rc>`, default
 *     `../reference/fictionbookeditor/FBE/FBE.rc` relative to the repository), every menu item,
 *     toolbar button, dialog and dialog control of the RC file has a row, and no row names an
 *     id the RC does not have (rows for items that live outside FBE.rc are marked with `*`).
 *
 * Usage: node tools/parity-check.mjs [--rc FBE.rc | --no-rc] [--inventory] [--verbose]
 *   --inventory   print the RC inventory as JSON (used when writing the matrix)
 *   --no-rc       skip the RC completeness check even when the reference checkout exists
 * Exit code 1 when a check fails.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MATRIX = path.join(REPO, 'docs', 'parity-matrix.md');
const UI_SRC = path.join(REPO, 'ui', 'src');
const E2E_DIR = path.join(REPO, 'ui', 'tests', 'e2e');
const DEFAULT_RC = path.resolve(REPO, '..', 'reference', 'fictionbookeditor', 'FBE', 'FBE.rc');

const STATUSES = new Set(['implemented', 'implemented-differently', 'dropped']);
// Command ids of the registry (`<group>.<name>`); other dotted tokens in the MFBE column (RPC
// methods such as `doc.recent`, script API members) are references, not commands.
const COMMAND_GROUPS = ['file', 'edit', 'view', 'insert', 'style', 'tools', 'scripts', 'help', 'nav', 'tree', 'source', 'symbol', 'script', 'image'];
const COMMAND_ID = new RegExp(`^(?:${COMMAND_GROUPS.join('|')})\\.[A-Za-z0-9][A-Za-z0-9.]*$`);

/* -------------------------------------------------------------------------------------- */
/* Arguments                                                                              */
/* -------------------------------------------------------------------------------------- */

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const verbose = args.includes('--verbose');
const rcPath = args.includes('--no-rc')
  ? null
  : (option('--rc') ?? (existsSync(DEFAULT_RC) ? DEFAULT_RC : null));
if (rcPath && !existsSync(rcPath)) {
  console.error(`parity-check: ${rcPath} does not exist`);
  process.exit(2);
}

/* -------------------------------------------------------------------------------------- */
/* FBE.rc inventory                                                                       */
/* -------------------------------------------------------------------------------------- */

/** Decodes the windows-1251 resource script (labels are ASCII; only comments are Cyrillic). */
function readRc(file) {
  const bytes = readFileSync(file);
  return new TextDecoder('windows-1251').decode(bytes);
}

/**
 * Parses MENU, TOOLBAR and DIALOGEX statements. Returns
 *   { menus: {name: [{id, label, path}]}, toolbars: {name: [id]}, dialogs: {name: {caption, controls: [{id, kind, label}]}} }.
 */
export function parseRc(text) {
  const lines = text.split(/\r?\n/);
  const menus = {};
  const toolbars = {};
  const dialogs = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    let m;
    if ((m = /^(\w+)\s+MENU\b/.exec(line))) {
      const items = [];
      const stack = [];
      i += 1;
      for (; i < lines.length; i += 1) {
        const l = lines[i].trim();
        if (l === 'BEGIN') continue;
        if (l === 'END') {
          if (stack.length === 0) break;
          stack.pop();
          continue;
        }
        let p;
        if ((p = /^POPUP\s+"([^"]*)"/.exec(l))) {
          stack.push(p[1].replace(/&/g, ''));
        } else if ((p = /^MENUITEM\s+"([^"]*)",\s*(\w+)/.exec(l))) {
          items.push({ id: p[2], label: p[1].replace(/&/g, ''), path: stack.join(' > ') });
        }
      }
      menus[m[1]] = items;
    } else if ((m = /^(\w+)\s+TOOLBAR\b/.exec(line))) {
      const buttons = [];
      i += 1;
      for (; i < lines.length; i += 1) {
        const l = lines[i].trim();
        if (l === 'END') break;
        const b = /^BUTTON\s+(\w+)/.exec(l);
        if (b) buttons.push(b[1]);
      }
      toolbars[m[1]] = buttons;
    } else if ((m = /^(IDD_\w+)\s+DIALOGEX?\b/.exec(line))) {
      const dialog = { caption: '', controls: [] };
      i += 1;
      for (; i < lines.length; i += 1) {
        const l = lines[i].trim();
        if (l === 'END') break;
        let c;
        if ((c = /^CAPTION\s+"([^"]*)"/.exec(l))) {
          dialog.caption = c[1];
        } else if (
          (c = /^(DEFPUSHBUTTON|PUSHBUTTON|LTEXT|RTEXT|CTEXT|EDITTEXT|COMBOBOX|LISTBOX|GROUPBOX|CONTROL|ICON)\s+(.*)$/.exec(l))
        ) {
          const kind = c[1];
          let rest = c[2];
          // Continuation lines of CONTROL statements.
          while (rest.endsWith(',') && i + 1 < lines.length) {
            i += 1;
            rest += lines[i].trim();
          }
          let label = '';
          if (rest.startsWith('"')) {
            const end = rest.indexOf('",');
            label = rest.slice(1, end).replace(/&/g, '').replace(/""/g, '"');
            rest = rest.slice(end + 2);
          } else if (kind === 'CONTROL' || kind === 'ICON') {
            // `CONTROL IDB_X,IDC_Y,...` / `ICON IDR_X,IDC_Y,...`: resource first, then the id.
            label = rest.slice(0, rest.indexOf(','));
            rest = rest.slice(rest.indexOf(',') + 1);
          }
          const idMatch = /^\s*(\w+)/.exec(rest);
          if (!idMatch) continue;
          const id = idMatch[1];
          if (id === 'IDC_STATIC') continue; // decorative text / group frames without an id
          dialog.controls.push({ id, kind, label });
        }
      }
      dialogs[m[1]] = dialog;
    }
    i += 1;
  }
  return { menus, toolbars, dialogs };
}

/* -------------------------------------------------------------------------------------- */
/* UI command registry (static scan)                                                      */
/* -------------------------------------------------------------------------------------- */

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Command ids defined in the UI. `stubOnly` are ids registered only through `stub(...)` in
 * `commands.ts` (disabled placeholders): a matrix row marked implemented must not rely on them.
 */
export function scanCommands() {
  const defined = new Map(); // id -> Set(file:how)
  const stubs = new Set();
  const definitionRe =
    /(?:\b(id|commandId)\s*:\s*|\b(stub|imageCommand|navCommand|toggleToolbar|opCommand)\(\s*)['"]([a-z]+\.[A-Za-z0-9]+)['"]/g;
  for (const file of walk(UI_SRC)) {
    const rel = path.relative(UI_SRC, file).replace(/\\/g, '/');
    // Hotkey tables and menu models reference commands, they do not define them.
    if (/^app\/(defaultHotkeys|hotkeys|menus|toolbars)\.ts$/.test(rel)) continue;
    const text = readFileSync(file, 'utf8');
    let m;
    while ((m = definitionRe.exec(text))) {
      const id = m[3];
      if (m[2] === 'stub') {
        stubs.add(id);
        continue;
      }
      if (!defined.has(id)) defined.set(id, new Set());
      defined.get(id).add(`${rel}:${m[1] ?? m[2]}`);
    }
    // Template ids: `view.${view}` (description/body/source), `source.collapse${level}`,
    // `style.${name}` (inline marks) and the constants of the scripting catalogue.
    if (/`view\.\$\{view\}`/.test(text)) {
      for (const view of ['description', 'body', 'source']) {
        if (!defined.has(`view.${view}`)) defined.set(`view.${view}`, new Set());
        defined.get(`view.${view}`).add(`${rel}:template`);
      }
    }
    if (/`source\.collapse\$\{level\}`/.test(text) && !/stub\(`source\.collapse/.test(text)) {
      for (let level = 1; level <= 9; level += 1) {
        for (const kind of ['collapse', 'expand']) {
          const id = `source.${kind}${level}`;
          if (!defined.has(id)) defined.set(id, new Set());
          defined.get(id).add(`${rel}:template`);
        }
      }
    }
    if (/`style\.\$\{name\}`/.test(text) && /INLINE_MARKS/.test(text)) {
      for (const mark of ['strong', 'emphasis', 'strikethrough', 'sub', 'sup', 'code']) {
        const id = `style.${mark}`;
        if (!defined.has(id)) defined.set(id, new Set());
        defined.get(id).add(`${rel}:template`);
      }
    }
    for (const c of text.matchAll(/export const [A-Z_]+_COMMAND = '([a-z]+\.[A-Za-z0-9]+)'/g)) {
      if (!defined.has(c[1])) defined.set(c[1], new Set());
      defined.get(c[1]).add(`${rel}:constant`);
    }
  }
  const stubOnly = new Set([...stubs].filter((id) => !defined.has(id)));
  return { defined, stubOnly };
}

/** Test ids that appear literally (or as a template prefix) in the UI sources. */
function scanTestIds() {
  const literal = new Set();
  const prefixes = new Set();
  const re = /(?:data-testid|testId|idPrefix)\s*[=:]\s*\{?\s*(['"`])([^'"`]+)\1/g;
  for (const file of walk(UI_SRC)) {
    const text = readFileSync(file, 'utf8');
    let m;
    while ((m = re.exec(text))) {
      const value = m[2];
      const dollar = value.indexOf('${');
      if (dollar >= 0) prefixes.add(value.slice(0, dollar));
      else literal.add(value);
    }
    // Derived ids: `${testId}-button-${button.id}`, `${idPrefix}-query`, `${id}-input`...
    for (const d of text.matchAll(/`\$\{[a-zA-Z]+\}(-[a-z-]+)`/g)) prefixes.add(d[1]);
  }
  return { literal, prefixes };
}

function testIdExists(id, ids) {
  if (ids.literal.has(id)) return true;
  for (const prefix of ids.prefixes) {
    if (prefix.startsWith('-') ? id.includes(prefix) : id.startsWith(prefix)) return true;
  }
  // `menu-<menu>-<item>` and `toolbar-<command>` are produced by menus.ts / Toolbars.tsx.
  return /^(menu-[a-z]+(-[A-Za-z0-9.]+)?|toolbar-[a-z]+\.[A-Za-z0-9]+|scripts-toolbar-.+|tree-menu-.+|context-menu-.+|dialog-[a-z-]+(-button-[a-z]+)?)$/.test(id);
}

/* -------------------------------------------------------------------------------------- */
/* Matrix                                                                                 */
/* -------------------------------------------------------------------------------------- */

const backticked = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

export function parseMatrix(text) {
  const rows = [];
  let section = '';
  let headers = null;
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (line.startsWith('#')) {
      section = line.replace(/^#+\s*/, '');
      headers = null;
      continue;
    }
    if (!line.startsWith('|')) {
      headers = null;
      continue;
    }
    const cells = line.slice(1, line.endsWith('|') ? -1 : undefined).split('|').map((c) => c.trim());
    if (!headers) {
      headers = cells;
      continue;
    }
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    if (!headers.includes('Status') || !headers.includes('Original')) continue; // legend, summary
    const row = { line: index + 1, section };
    headers.forEach((h, k) => {
      row[h] = cells[k] ?? '';
    });
    rows.push(row);
  }
  return rows;
}

/** Menu id of a command in the main menu model (`menus.ts`), for `menu-<menu>-<item>` ids. */
function menuOfCommands() {
  const text = readFileSync(path.join(UI_SRC, 'app', 'menus.ts'), 'utf8');
  const map = new Map();
  let current = null;
  for (const line of text.split('\n')) {
    // Top-level menus are the objects of MAIN_MENU (Prettier indents their `id:` by 4 spaces);
    // submenus (`id: 'recent'`, 8 spaces) carry no commands of their own.
    const id = /^ {4}id:\s*'([a-z]+)',\s*$/.exec(line);
    if (id) current = id[1];
    for (const cmd of line.matchAll(/cmd\('([a-z]+\.[A-Za-z0-9]+)'\)/g)) {
      if (current) map.set(cmd[1], current);
    }
  }
  return map;
}

function evidenceTokens(commandIds, evidence, menus) {
  const tokens = new Set(evidence);
  // The journeys press `Mod` chords as `${MOD}+x` (Ctrl, Cmd on macOS: tests/e2e/fixtures/keys.ts).
  for (const item of evidence) {
    if (item.startsWith('Control+')) tokens.add(`\${MOD}+${item.slice('Control+'.length)}`);
  }
  for (const id of commandIds) {
    tokens.add(`'${id}'`);
    tokens.add(`"${id}"`);
    tokens.add(`toolbar-${id}`);
    tokens.add(`settings-hotkeys-command-${id}`);
    const menu = menus.get(id);
    const item = id.slice(id.indexOf('.') + 1);
    if (menu) {
      tokens.add(`menu-${menu}-${item}`);
      tokens.add(`menu(page, '${menu}', '${item}')`);
    }
  }
  return tokens;
}

/* -------------------------------------------------------------------------------------- */
/* Main                                                                                   */
/* -------------------------------------------------------------------------------------- */

function main() {
  const problems = [];
  const warn = (message) => problems.push(message);

  const rc = rcPath ? parseRc(readRc(rcPath)) : null;
  if (args.includes('--inventory')) {
    if (!rc) {
      console.error('parity-check: --inventory needs FBE.rc (--rc <path>)');
      return 2;
    }
    console.log(JSON.stringify(rc, null, 2));
    return 0;
  }

  if (!existsSync(MATRIX)) {
    console.error(`parity-check: ${path.relative(REPO, MATRIX)} is missing`);
    return 1;
  }
  const rows = parseMatrix(readFileSync(MATRIX, 'utf8'));
  if (rows.length === 0) warn('the matrix has no table rows');

  const { defined, stubOnly } = scanCommands();
  const testIds = scanTestIds();
  const menus = menuOfCommands();
  const specs = new Map(
    readdirSync(E2E_DIR)
      .filter((f) => f.endsWith('.spec.ts'))
      .map((f) => [f, readFileSync(path.join(E2E_DIR, f), 'utf8')]),
  );

  const counts = { implemented: 0, 'implemented-differently': 0, dropped: 0 };
  const originals = new Set();
  const nonRc = new Set();
  for (const row of rows) {
    const where = `${path.basename(MATRIX)}:${row.line} [${row.section}]`;
    const status = (row.Status ?? '').trim();
    if (!STATUSES.has(status)) {
      warn(`${where}: unknown status "${status}"`);
      continue;
    }
    counts[status] += 1;
    for (const id of backticked(row.Original ?? '')) {
      const clean = id.replace(/\*$/, '');
      originals.add(clean);
      if (id.endsWith('*') || /\*/.test(row.Original)) nonRc.add(clean);
    }
    const commandIds = backticked(row.MFBE ?? '').filter((t) => COMMAND_ID.test(t));
    const evidence = backticked(row.Evidence ?? '');
    const specNames = backticked(row['e2e spec'] ?? '');

    if (status === 'dropped') {
      if (!(row.Notes ?? '').trim()) warn(`${where}: dropped rows need a note with the reference`);
      if (!/spec\.md|out of scope|requester|FR-\d+|constitution|decision|plan\.md|research\.md/i.test(row.Notes ?? '')) {
        warn(`${where}: the note of a dropped row must reference the decision (spec.md "Out of scope", FR, requester decision)`);
      }
      continue;
    }

    for (const id of commandIds) {
      if (stubOnly.has(id)) warn(`${where}: command ${id} is still a stub (registered but not implemented)`);
      else if (!defined.has(id)) warn(`${where}: command ${id} does not exist in ui/src`);
    }
    for (const id of evidence) {
      if (!testIdExists(id, testIds) && !/^(Control|Alt|Shift|Mod|F\d)/.test(id)) {
        warn(`${where}: test id "${id}" is not produced by ui/src`);
      }
    }
    if (specNames.length === 0) {
      warn(`${where}: no e2e spec listed`);
      continue;
    }
    const texts = [];
    for (const name of specNames) {
      if (!specs.has(name)) warn(`${where}: e2e spec ${name} does not exist`);
      else texts.push(specs.get(name));
    }
    const tokens = evidenceTokens(commandIds, evidence, menus);
    const found = [...tokens].filter((t) => texts.some((text) => text.includes(t)));
    if (texts.length > 0 && found.length === 0) {
      warn(`${where}: none of ${[...tokens].map((t) => JSON.stringify(t)).join(', ')} occurs in ${specNames.join(', ')}`);
    } else if (verbose) {
      console.log(`${where}: ok (${found.join(', ')})`);
    }
  }

  if (rc) {
    const inventory = new Map(); // id -> description
    for (const [menu, items] of Object.entries(rc.menus)) {
      for (const item of items) inventory.set(item.id, `${menu} ${item.path} > ${item.label}`);
    }
    for (const [toolbar, buttons] of Object.entries(rc.toolbars)) {
      for (const id of buttons) if (!inventory.has(id)) inventory.set(id, `${toolbar} button`);
    }
    for (const [dialog, spec] of Object.entries(rc.dialogs)) {
      inventory.set(dialog, `dialog "${spec.caption}"`);
      for (const control of spec.controls) {
        if (!inventory.has(control.id)) inventory.set(control.id, `${dialog} ${control.kind} ${control.label}`.trim());
      }
    }
    const known = new Set([...inventory.keys(), ...Object.keys(rc.menus), ...Object.keys(rc.toolbars)]);
    for (const [id, description] of inventory) {
      if (!originals.has(id)) warn(`FBE.rc item ${id} (${description}) has no row in the matrix`);
    }
    for (const id of originals) {
      if (!known.has(id) && !nonRc.has(id)) {
        warn(`matrix row ${id} is not an FBE.rc item (mark it with * when it comes from the sources)`);
      }
    }
    console.log(`parity-check: FBE.rc inventory: ${inventory.size} items checked against the matrix`);
  } else {
    console.log('parity-check: FBE.rc not available - RC completeness not re-derived (matrix/UI/e2e consistency only)');
  }

  console.log(
    `parity-check: ${rows.length} rows - implemented ${counts.implemented}, implemented-differently ${counts['implemented-differently']}, dropped ${counts.dropped}`,
  );
  if (problems.length > 0) {
    for (const problem of problems) console.error(`parity-check: ERROR: ${problem}`);
    return 1;
  }
  console.log('parity-check: OK');
  return 0;
}

process.exit(main());
