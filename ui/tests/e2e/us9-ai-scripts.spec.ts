/**
 * Feature 007, User Story 9 - the AI assistant works with the scripts (T114; quickstart §7,
 * SC-009; FR-080 to FR-086; contracts/ai-catalogue.md, rpc-api.md §3.6 of the feature,
 * data-model §7.2, §9, §10). Needs the real core (`MFBE_CORE_BIN`); skipped otherwise. The AI
 * service is the loopback stand-in (`fixtures/ai-standin.mjs`).
 *
 *  1. In one conversation (SC-009), with a 2.7.9 script - *Привести заголовки глав к виду
 *     'Глава 1'*, found by its FictionBook Editor path, whatever its id:
 *     - finding: `list_scripts {query: 'глава'}` gives exactly the scripts the words match, in
 *       one page; a page of everything is 50 of the total;
 *     - explaining: `read_script` gives the descriptions in English and Russian, the legacy
 *       source and the files in full;
 *     - running: `run_script` changes the chapter titles as one undo step;
 *     - changing: `propose_script {mode: 'modify'}` shows the changed files against the files in
 *       effect (`ai-proposal-diff-<file>`); after Write the changed copy is in the assistant's
 *       folder, the original's files are untouched, the Scripts menu shows the copy in the
 *       original's place with its hotkey - which runs it - and its toolbar button with the
 *       original's icon, Last script follows, and `<data>/script-backups/<id>/<stamp>/backup.json`
 *       holds the bundled version;
 *     - restoring: `list_script_backups` names that backup; `restore_script_backup`, confirmed,
 *       brings the original back in its place and keeps the copy as a backup; declined, it
 *       changes nothing;
 *     - no request carries the clipboard's text.
 *  2. A script the assistant runs cannot read the clipboard: the run fails with
 *     `clipboard.readNotAllowed`, the book stays as it was and the clipboard's text never
 *     reaches the service.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import type { JsonValue } from './fixtures/ai-standin.mjs';
import {
  ensureAssistantOn,
  expect,
  test,
  waitForBook,
  type CoreHandle,
  type StandinHandle,
} from './fixtures/core';
import { pageText } from './fixtures/i18n';
import { MOD } from './fixtures/keys';

/* ------------------------------------------------------------------------ */
/* Helpers                                                                  */
/* ------------------------------------------------------------------------ */

/** The 2.7.9 path of the script the journey works with (`legacy.source`). */
const CHAPTERS_SOURCE =
  "13_Заголовки, подзаголовки, пустые строки/30_Привести заголовки глав к виду 'Глава 1'.js";

/** A hotkey the user gave the script, free in the default set (no Alt: the same on macOS). */
const HOTKEY = 'Ctrl+Shift+F9';
const HOTKEY_PRESS = 'Control+Shift+F9';

/** What the journey puts on the clipboard; no request may carry it. */
const CLIPBOARD_MARKER = 'US9-CLIPBOARD-NEVER-SENT';

interface ChatMessage {
  role: string;
  content: string;
  tool_call_id?: string;
}

interface Envelope {
  error: { code: string; message: string; hint?: string; [extra: string]: unknown };
}

interface CoreScript {
  id: string;
  name: Record<string, string>;
  description?: Record<string, string>;
  group: string;
  dir: string;
  folder: string;
  origin: string;
  iconUrl?: string;
  legacy?: { source: string; fbeVersion?: string; sourceVersion?: string };
  overrides?: { origin: string; dir: string };
}

interface CoreList {
  groups: { id: string; scripts: CoreScript[] }[];
}

interface Entry {
  id: string;
  group: string;
  name: Record<string, string>;
  description?: string;
  kind: string;
  runnable: boolean;
  origin: string;
  overrides?: true;
}

interface LastRequest {
  id: string;
  state: string;
  changes: number;
}

type Args = { [member: string]: JsonValue | undefined };
const toolCall = (id: string, name: string, args: Args) => ({
  toolCalls: [{ id, name, arguments: args }],
});

const parse = <T>(message: ChatMessage): T => JSON.parse(message.content) as T;

const input = (page: Page) => page.getByTestId('ai-input');
const banner = (page: Page) => page.getByTestId('script-run-banner');
const lastRequest = (page: Page) =>
  page.evaluate<LastRequest | null>('window.__mfbeTest.ai.lastRequest()');
const lastRequestId = async (page: Page) => (await lastRequest(page))?.id ?? null;
const documentXml = (page: Page) => page.evaluate<string>('window.__mfbeTest.scripts.toXml()');

async function send(page: Page, instruction: string): Promise<string | null> {
  const before = await lastRequestId(page);
  await input(page).fill(instruction);
  await input(page).press('Enter');
  return before;
}

async function waitForEnd(page: Page, before: string | null, timeout = 30_000) {
  await expect.poll(() => lastRequestId(page), { timeout }).not.toBe(before);
  await expect(page.getByTestId('ai-send')).toBeVisible({ timeout });
  await expect(banner(page)).toHaveCount(0, { timeout });
  return (await lastRequest(page))!;
}

async function sendAndWait(page: Page, instruction: string, timeout = 30_000) {
  return waitForEnd(page, await send(page, instruction), timeout);
}

/** The `tool` messages of the last recorded exchange. */
async function lastToolMessages(standin: StandinHandle): Promise<ChatMessage[]> {
  const requests = await standin.requests();
  const body = requests.at(-1)!.body as unknown as { messages: ChatMessage[] };
  return body.messages.filter((m) => m.role === 'tool');
}

/** Every script of the core's list, in menu order. */
async function coreScripts(core: CoreHandle): Promise<CoreScript[]> {
  const list = await core.rpc<CoreList>('scripts.list');
  return list.groups.flatMap((group) => group.scripts);
}

/** The letters the assistant's search counts as one (data-model §10): case, ё as е. */
const fold = (text: string) => text.toLowerCase().replace(/ё/g, 'е');

/** The ids `list_scripts {query}` must give: every word in the id, names, descriptions, path. */
function matching(scripts: CoreScript[], query: string): string[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return scripts
    .filter((script) => {
      const text = fold(
        [
          script.id,
          ...Object.values(script.name),
          ...Object.values(script.description ?? {}),
          script.legacy?.source ?? '',
        ].join('\n'),
      );
      return words.every((word) => text.includes(word));
    })
    .map((script) => script.id);
}

/** The ids of a group's sub-menu of the Scripts menu, in order (the menu is closed after). */
async function menuIds(page: Page, group: string): Promise<string[]> {
  await page.getByTestId('menu-scripts').click();
  await page.getByTestId(`menu-scripts-${group}`).hover();
  const popup = page.getByTestId(`menu-scripts-${group}-popup`);
  await expect(popup).toBeVisible();
  const ids = await popup
    .locator('[role="menuitem"]')
    .evaluateAll(
      (items, prefix) =>
        items.map((item) => (item.getAttribute('data-testid') ?? '').slice(prefix.length)),
      `menu-scripts-${group}-`,
    );
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  return ids;
}

/** The section titles of the first body, in order. */
function sectionTitles(page: Page): Promise<string[]> {
  return page.evaluate<string[]>(`(() => {
    const doc = window.__mfbeTest.scripts.document();
    const textOf = (n) => (n.type === 'text' ? n.text : (n.content ?? []).map(textOf).join(''));
    return doc.bodies[0].content
      .filter((n) => n.type === 'section')
      .map((s) => textOf((s.content ?? []).find((c) => c.type === 'title') ?? { type: 'x' }));
  })()`);
}

/** Every file below `folder`, relative with '/', with its text. */
function filesOf(folder: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`);
      else out[`${prefix}${entry.name}`] = readFileSync(full, 'latin1');
    }
  };
  if (existsSync(folder)) walk(folder, '');
  return out;
}

/** A chapter book: three sections whose titles 2.7.9's script rewrites. */
const CHAPTER_BOOK = `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info><genre>prose_classic</genre><author><first-name>Анна</first-name><last-name>Тестова</last-name></author><book-title>Главы</book-title><lang>ru</lang></title-info><document-info><author><nickname>us9</nickname></author><date>2026</date><id>us9-chapters</id><version>1.0</version></document-info></description>
<body>
<section><title><p>ГЛАВА ПЕРВАЯ</p></title><p>Первый абзац.</p></section>
<section><title><p>Глава 2.</p></title><p>Второй абзац.</p></section>
<section><title><p>глава III</p></title><p>Третий абзац.</p></section>
</body>
</FictionBook>
`;

/** The changed script the model proposes: chapter numbers in Roman numerals, self-contained. */
const ROMAN_ENTRY = `// Brings chapter titles to the form "Глава I": the number of "Глава 1" in Roman numerals.
const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];

function roman(number) {
  let out = '';
  let rest = number;
  for (const [value, letters] of ROMAN) {
    while (rest >= value) {
      out += letters;
      rest -= value;
    }
  }
  return out;
}

export default async function run() {
  let count = 0;
  for (const title of await mfbe.doc.getElementsByTagName('title')) {
    for (const child of await mfbe.doc.childrenOf(title)) {
      if (child.type !== 'p') continue;
      const match = /^Глава (\\d+)(.*)$/.exec(await mfbe.doc.textOf(child));
      if (!match) continue;
      await mfbe.doc.setText(child, \`Глава \${roman(Number(match[1]))}\${match[2]}\`);
      count += 1;
    }
  }
  await mfbe.ui.status(\`Глава I: \${count}\`);
}
`;

/** The clipboard-reading user script of test 2. */
const CLIPBOARD_PACKAGE = {
  'script.json': JSON.stringify(
    {
      manifestVersion: 1,
      id: 'us9.clipboard',
      name: { en: 'Clipboard into the first paragraph', ru: 'Буфер обмена в первый абзац' },
      kind: 'menu',
      needsSelection: false,
    },
    null,
    2,
  ),
  'index.js': `export default async function run() {
  const text = await mfbe.clipboard.readText();
  const [first] = await mfbe.doc.getElementsByTagName('p');
  if (first) await mfbe.doc.setText(first, text);
}
`,
};

const scriptsFolder = (core: CoreHandle) => path.join(core.dataDir!, 'scripts');
const assistantFolder = (core: CoreHandle) => path.join(scriptsFolder(core), '90_assistant');
const backupsFolder = (core: CoreHandle) => path.join(core.dataDir!, 'script-backups');

/* ------------------------------------------------------------------------ */
/* The journeys                                                             */
/* ------------------------------------------------------------------------ */

test.describe('US9 (007) - the assistant works with the scripts', () => {
  let bookDir = '';
  let hotkeysBefore: unknown[] = [];

  test.beforeEach(async ({ core, standin, context }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await standin.reset();
    await core.resetAiRequests();
    await core.setAiResolve([]);
    // No change of an earlier journey in this worker: no assistant's copies, no backups.
    rmSync(assistantFolder(core), { recursive: true, force: true });
    rmSync(backupsFolder(core), { recursive: true, force: true });
    await core.rpc('scripts.reload');
    hotkeysBefore = await core.rpc<unknown[]>('hotkeys.get');
    bookDir = mkdtempSync(path.join(tmpdir(), 'mfbe-us9-'));
  });

  test.afterEach(async ({ core }) => {
    if (!core.hasCore) return;
    rmSync(bookDir, { recursive: true, force: true });
    rmSync(assistantFolder(core), { recursive: true, force: true });
    rmSync(path.join(scriptsFolder(core), '50_us9'), { recursive: true, force: true });
    await core.rpc('scripts.reload').catch(() => {});
    await core.rpc('hotkeys.set', { bindings: hotkeysBefore }).catch(() => {});
    await core
      .rpc('settings.set', { patch: { ai: null, session: { toolbarLayouts: null } } })
      .catch(() => {});
  });

  /** The service, the book opened, the assistant on, with the clipboard's marker in place. */
  async function openChapters(core: CoreHandle, page: Page, standin: StandinHandle) {
    await core.rpc('settings.set', {
      patch: {
        ai: {
          mode: 'custom',
          custom: { address: `${standin.url}/v1`, key: '', model: 'standin-chat' },
        },
      },
    });
    const book = path.join(bookDir, 'us9-chapters.fb2');
    writeFileSync(book, CHAPTER_BOOK, 'utf8');
    await core.openApp(page);
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageText(page, 'status.ready'),
    );
    await core.enqueueDialog('dialog.openFile', { paths: [book] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').click();
    await waitForBook(page, book);
    await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
    await page.evaluate(`navigator.clipboard.writeText(${JSON.stringify(CLIPBOARD_MARKER)})`);
    await ensureAssistantOn(page);
  }

  test('1. in one conversation: find, explain, run, change and restore a 2.7.9 script (SC-009)', async ({
    core,
    page,
    standin,
  }) => {
    test.setTimeout(240_000);
    const all = await coreScripts(core);
    const chapters = all.find((script) => script.legacy?.source === CHAPTERS_SOURCE);
    expect(chapters, 'the bundled 2.7.9 script for chapter titles').toBeTruthy();
    const id = chapters!.id;
    const group = chapters!.group;
    // The user's hotkey for it and its button on the Scripts toolbar (it has an icon).
    expect(chapters!.iconUrl).toBeTruthy();
    await core.rpc('hotkeys.set', {
      bindings: [...(hotkeysBefore as object[]), { commandId: `script.${id}`, keys: HOTKEY }],
    });
    await core.rpc('settings.set', {
      patch: { session: { toolbarLayouts: { scripts: ['scripts.last', `script.${id}`] } } },
    });
    await openChapters(core, page, standin);
    const xmlBefore = await documentXml(page);
    const placeBefore = (await menuIds(page, group)).indexOf(id);
    expect(placeBefore).toBeGreaterThanOrEqual(0);

    // Finding (FR-080): the words "глава" pick the heading scripts among all, in one page; a
    // page of everything is 50 entries of the total.
    await standin.scenarios([
      toolCall('c-find', 'list_scripts', { query: 'глава' }),
      toolCall('c-group', 'list_scripts', { group }),
      toolCall('c-all', 'list_scripts', {}),
      toolCall('c-read', 'read_script', { id }),
      { text: 'Это скрипт для заголовков глав.' },
    ]);
    const found = await sendAndWait(page, 'Какие скрипты приводят заголовки глав к одному виду?');
    expect(found.state).toBe('answered');
    let tools = await lastToolMessages(standin);
    const expected = matching(all, 'глава');
    const byWords = parse<{ total: number; offset: number; entries: Entry[] }>(tools[0]!);
    expect(byWords.total).toBe(expected.length);
    expect(byWords.total).toBeLessThanOrEqual(50);
    expect(byWords.entries.map((entry) => entry.id)).toEqual(expected);
    const entry = byWords.entries.find((candidate) => candidate.id === id)!;
    expect(entry).toMatchObject({
      group,
      name: { ru: "Привести заголовки глав к виду 'Глава 1'" },
      kind: 'menu',
      runnable: true,
      origin: 'bundled',
    });
    expect(entry.name.en).toBeTruthy();
    expect(entry).not.toHaveProperty('overrides');
    const byGroup = parse<{ total: number; entries: Entry[] }>(tools[1]!);
    expect(byGroup.entries.every((candidate) => candidate.group === group)).toBe(true);
    expect(byGroup.entries.map((candidate) => candidate.id)).toContain(id);
    const everything = parse<{ total: number; entries: Entry[] }>(tools[2]!);
    expect(everything.total).toBe(all.length);
    expect(everything.entries).toHaveLength(Math.min(50, all.length));

    // Explaining (FR-081): the descriptions in English and Russian, the origin, the source.
    const read = parse<{
      origin: string;
      description: Record<string, string>;
      legacy: { source: string; fbeVersion: string };
      files: { path: string; content?: string; binary?: boolean }[];
    }>(tools[3]!);
    expect(read.origin).toBe('bundled');
    expect(read.description.en).toBe(chapters!.description!.en);
    expect(read.description.ru).toBe(chapters!.description!.ru);
    expect(read.legacy).toMatchObject({ source: CHAPTERS_SOURCE, fbeVersion: '2.7.9' });
    const entryFile = read.files.find((file) => file.path === 'index.js')!;
    expect(entryFile.content).toBe(readFileSync(path.join(chapters!.dir, 'index.js'), 'utf8'));
    expect(read.files.find((file) => file.path === 'icon.png')).toMatchObject({ binary: true });

    // Running (FR-082): as from the Scripts menu, its message captioned as run by the
    // assistant, the chapter titles changed as one undo step.
    await standin.scenarios([
      toolCall('c-run', 'run_script', { id }),
      { text: 'Заголовки глав приведены к виду «Глава 1».' },
    ]);
    const before = await send(page, 'Выполни его');
    const message = page.getByTestId('dialog-script-message');
    await expect(message).toBeVisible({ timeout: 20_000 });
    await expect(
      message.getByTestId('dialog-script-message-title').locator('.mfbe-dialog-title-text'),
    ).toHaveText(await pageText(page, 'ai.script.nestedCaption', { name: chapters!.name.en! }));
    await message.locator('[data-testid^="dialog-script-message-button-"]').first().click();
    const ran = await waitForEnd(page, before);
    expect(ran.state).toBe('committed');
    expect(ran.changes).toBe(1);
    tools = await lastToolMessages(standin);
    expect(parse<{ status: string; changed: boolean }>(tools[0]!)).toMatchObject({
      status: 'done',
      changed: true,
    });
    const titlesRun = await sectionTitles(page);
    expect(titlesRun[0]).toBe('Глава 1');
    expect(titlesRun.every((title) => /^Глава \d+/.test(title))).toBe(true);
    await page.getByTestId('body-editor').focus();
    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(() => documentXml(page)).toBe(xmlBefore);
    await page.keyboard.press(`${MOD}+y`);
    await expect.poll(() => sectionTitles(page)).toEqual(titlesRun);

    // Changing (FR-083 to FR-085): the proposal against the files in effect; nothing written
    // before Write.
    const manifest = JSON.parse(readFileSync(path.join(chapters!.dir, 'script.json'), 'utf8')) as {
      name: Record<string, string>;
    };
    manifest.name = {
      ...manifest.name,
      ru: "Привести заголовки глав к виду 'Глава I'",
      en: "Bring chapter titles to the form 'Глава I'",
    };
    const changedFiles = [
      { path: 'script.json', content: `${JSON.stringify(manifest, null, 2)}\n` },
      { path: 'index.js', content: ROMAN_ENTRY },
    ];
    await standin.scenarios([
      toolCall('c-modify', 'propose_script', {
        id,
        mode: 'modify',
        files: changedFiles,
        summary: 'Номера глав римскими цифрами: «Глава I» вместо «Глава 1».',
      }),
      { text: 'Скрипт изменён.' },
    ]);
    const proposing = await send(page, 'Измени его так, чтобы номера были римскими: «Глава I»');
    const dialog = page.getByTestId('dialog-ai-script-proposal');
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByTestId('dialog-ai-script-proposal-title')).toContainText(
      await pageText(page, 'ai.scripts.modifyTitle', { name: chapters!.name.en! }),
    );
    await expect(dialog.getByTestId('dialog-ai-script-proposal-overrides')).toBeVisible();
    await expect(page.getByTestId('ai-proposal-diff-index.js')).toHaveAttribute(
      'data-status',
      'changed',
    );
    await expect(page.getByTestId('ai-proposal-diff-script.json')).toHaveAttribute(
      'data-status',
      'changed',
    );
    await expect(page.getByTestId('ai-proposal-diff-icon.png')).toHaveAttribute(
      'data-status',
      'removedBinary',
    );
    const added = page.getByTestId('ai-proposal-diff-index.js').locator('[data-kind="added"]');
    await expect(added.filter({ hasText: 'function roman(number)' })).toHaveCount(1);
    const removed = page.getByTestId('ai-proposal-diff-index.js').locator('[data-kind="removed"]');
    expect(await removed.count()).toBeGreaterThan(0);
    expect(existsSync(assistantFolder(core))).toBe(false);
    const bundledBeforeWrite = filesOf(chapters!.dir);
    await dialog.getByTestId('dialog-ai-script-proposal-button-write').click();
    const changed = await waitForEnd(page, proposing);
    expect(changed.state).toBe('answered');
    tools = await lastToolMessages(standin);
    const written = parse<{ written: boolean; id: string; path: string; backupId: string }>(
      tools[0]!,
    );
    expect(written).toMatchObject({ written: true, id });
    expect(written.backupId).toMatch(/^\d{8}T\d{6}Z(-\d+)?$/);
    // On disk: the copy in the assistant's folder, the original untouched, the backup.
    const copyDir = path.resolve(written.path);
    expect(path.dirname(copyDir)).toBe(path.resolve(assistantFolder(core)));
    expect(readFileSync(path.join(copyDir, 'index.js'), 'utf8').endsWith(ROMAN_ENTRY)).toBe(true);
    expect(filesOf(chapters!.dir)).toEqual(bundledBeforeWrite);
    const backupDir = path.join(backupsFolder(core), encodeURIComponent(id), written.backupId);
    const backup = JSON.parse(readFileSync(path.join(backupDir, 'backup.json'), 'utf8')) as {
      id: string;
      origin: string;
      reason: string;
    };
    expect(backup).toMatchObject({ id, origin: 'bundled', reason: 'assistantChange' });
    expect(readFileSync(path.join(backupDir, 'index.js'), 'utf8')).toBe(
      readFileSync(path.join(chapters!.dir, 'index.js'), 'utf8'),
    );
    const rows = await page.evaluate<string[]>(`Array.from(
      document.querySelectorAll('[data-testid^="ai-activity-"][data-kind="script.proposed"]'),
      (li) => li.textContent)`);
    expect(rows.at(-1)).toContain(written.backupId);

    // The menu: the copy in the original's place, under its new name, with the hotkey; the
    // toolbar keeps its button with the original's icon.
    const list = await coreScripts(core);
    const copy = list.find((script) => script.id === id)!;
    expect(copy).toMatchObject({ origin: 'assistant', group, overrides: { origin: 'bundled' } });
    await expect.poll(async () => (await menuIds(page, group)).indexOf(id)).toBe(placeBefore);
    await page.getByTestId('menu-scripts').click();
    await page.getByTestId(`menu-scripts-${group}`).hover();
    const item = page.getByTestId(`menu-scripts-${group}-${id}`);
    await expect(item).toContainText("Bring chapter titles to the form 'Глава I'");
    await expect(item).toContainText('F9');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    const button = page.getByTestId(`scripts-toolbar-${id}`);
    await expect(button).toBeVisible();
    await expect
      .poll(() =>
        button
          .locator('img')
          .evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth),
      )
      .toBeGreaterThan(0);
    // The copy has no icon of its own: the core serves the original's under the copy's id.
    const iconSrc = (await button.locator('img').getAttribute('src'))!;
    const served = await page.evaluate(async (url) => {
      const response = await fetch(url, { cache: 'no-store' });
      return { status: response.status, type: response.headers.get('content-type') };
    }, iconSrc);
    expect(served).toEqual({ status: 200, type: 'image/png' });
    expect(filesOf(copyDir)).not.toHaveProperty('icon.png');
    // Its hotkey runs the changed script; Last script follows the id.
    await page.getByTestId('body-editor').focus();
    await page.keyboard.press(HOTKEY_PRESS);
    await expect
      .poll(() => sectionTitles(page), { timeout: 15_000 })
      .toEqual(
        titlesRun.map((title) =>
          title.replace(
            /^Глава (\d+)/,
            (_, n: string) => `Глава ${['I', 'II', 'III'][Number(n) - 1]}`,
          ),
        ),
      );
    expect((await sectionTitles(page))[0]).toBe('Глава I');
    expect(await page.evaluate<string | null>('window.__mfbeTest.scripts.lastRunId()')).toBe(id);

    // Restoring (FR-084): the backup listed, restored after the user's confirmation - the
    // original in its place again, the copy kept as a backup.
    await standin.scenarios([
      toolCall('c-backups', 'list_script_backups', { id }),
      toolCall('c-restore', 'restore_script_backup', { id, backupId: written.backupId }),
      { text: 'Вернул исходную версию.' },
    ]);
    const restoring = await send(page, 'Верни исходную версию скрипта');
    const confirm = page.getByTestId('dialog-ai-script-restore');
    await expect(confirm).toBeVisible({ timeout: 20_000 });
    await expect(confirm.getByTestId('dialog-ai-script-restore-text')).toContainText(
      "Bring chapter titles to the form 'Глава I'",
    );
    await confirm.getByTestId('dialog-ai-script-restore-button-restore').click();
    const restored = await waitForEnd(page, restoring);
    expect(restored.state).toBe('answered');
    tools = await lastToolMessages(standin);
    const backups = parse<{ backups: { backupId: string; origin: string; createdAt: string }[] }>(
      tools[0]!,
    );
    expect(backups.backups[0]).toMatchObject({ backupId: written.backupId, origin: 'bundled' });
    const restoreResult = parse<{ restored: boolean; backupId: string }>(tools[1]!);
    expect(restoreResult.restored).toBe(true);
    expect(existsSync(copyDir)).toBe(false);
    const kept = JSON.parse(
      readFileSync(
        path.join(
          backupsFolder(core),
          encodeURIComponent(id),
          restoreResult.backupId,
          'backup.json',
        ),
        'utf8',
      ),
    ) as { origin: string };
    expect(kept.origin).toBe('assistant');
    const back = (await coreScripts(core)).find((script) => script.id === id)!;
    expect(back.origin).toBe('bundled');
    expect(back).not.toHaveProperty('overrides');
    await expect.poll(async () => (await menuIds(page, group)).indexOf(id)).toBe(placeBefore);
    await page.getByTestId('menu-scripts').click();
    await page.getByTestId(`menu-scripts-${group}`).hover();
    await expect(page.getByTestId(`menu-scripts-${group}-${id}`)).toContainText(chapters!.name.en!);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // Declined: nothing changes.
    await standin.scenarios([
      toolCall('c-restore-2', 'restore_script_backup', { id, backupId: restoreResult.backupId }),
      { text: 'Хорошо, оставляю как есть.' },
    ]);
    const declining = await send(page, 'Верни изменённую версию');
    await expect(confirm).toBeVisible({ timeout: 20_000 });
    await confirm.getByTestId('dialog-ai-script-restore-button-dontRestore').click();
    await waitForEnd(page, declining);
    tools = await lastToolMessages(standin);
    expect(parse<unknown>(tools[0]!)).toEqual({ restored: false, declined: true });
    expect(existsSync(copyDir)).toBe(false);
    expect((await coreScripts(core)).find((script) => script.id === id)!.origin).toBe('bundled');

    // No request of the conversation carried the clipboard's text.
    expect(JSON.stringify(await standin.requests())).not.toContain(CLIPBOARD_MARKER);
  });

  test('2. a script the assistant runs cannot read the clipboard (FR-082)', async ({
    core,
    page,
    standin,
  }) => {
    const folder = path.join(scriptsFolder(core), '50_us9', '01_clipboard');
    mkdirSync(folder, { recursive: true });
    for (const [file, content] of Object.entries(CLIPBOARD_PACKAGE)) {
      writeFileSync(path.join(folder, file), content, 'utf8');
    }
    await core.rpc('scripts.reload');
    await openChapters(core, page, standin);
    const xmlBefore = await documentXml(page);
    await standin.scenarios([
      toolCall('c-clip', 'run_script', { id: 'us9.clipboard' }),
      { text: 'Скрипт не смог прочитать буфер обмена.' },
    ]);
    const request = await sendAndWait(page, 'Вставь буфер обмена в первый абзац скриптом');
    expect(request.state).toBe('answered');
    expect(request.changes).toBe(0);
    const tools = await lastToolMessages(standin);
    const refused = parse<Envelope>(tools[0]!);
    expect(refused.error.code).toBe('scriptFailed');
    expect(refused.error.scriptError).toBe('clipboard.readNotAllowed');
    expect(refused.error.hint).toContain('Scripts menu');
    expect(await documentXml(page)).toBe(xmlBefore);
    expect(JSON.stringify(await standin.requests())).not.toContain(CLIPBOARD_MARKER);
  });
});
