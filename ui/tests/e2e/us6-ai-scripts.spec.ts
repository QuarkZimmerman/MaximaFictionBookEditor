/**
 * User Story 6 (feature 005) - scripts through the assistant (T073; ai-catalogue §3.1, §3.4,
 * §4, §7, §9.1 rows `list_scripts` … `reload_scripts`; data-model §6.6, §10; quickstart §6;
 * FR-080 to FR-084, SC-003, SC-011). Needs the real core (`MFBE_CORE_BIN`); skipped otherwise.
 * The custom target is the loopback stand-in (`fixtures/ai-standin.mjs`). The fixture scripts of
 * `tests/scripts/fixtures/02_Dialogs`, `03_Errors` and `05_Runs` are copied into
 * `core.dataDir/scripts/` (as `diagnostics.spec.ts` does); the proposals come from
 * `tests/e2e/fixtures/ai-proposals/` (T006).
 *
 *  1. `list_scripts` → every effective script with id, name, description, kind,
 *     needsSelection and availability; `read_script` → the files with content, the icon as a
 *     binary; `read_resource` → the three references (sizes, first lines, the example whole
 *     with its notice header).
 *  2. `run_script` nested in a request: with a selection the spaces go, together with a
 *     `set_text` of the same request one Mod+z restores both (SC-003), no `scripts.lastRun`;
 *     without a selection `selectionRequired` shown in the activity (FR-054); the form dialog
 *     captioned as run by the assistant and filled; a throwing script → `scriptFailed`, the
 *     request going on; Cancel on the banner during the script's prompt → script and request
 *     cancelled together, the XML unchanged.
 *  3. The proposal: every file in full, the folder, the author line (edited, found on disk);
 *     Don't write → nothing on disk (SC-011); Write → in the menu and runnable; the FR-084
 *     gate (same request refused, a later instruction allowed, Write and run at once); the
 *     warnings of `nbsp-with-fetch` (Write not the default) and the fence at run time; the
 *     refusals before any dialog (bundled id, `../x.js`, existing id, overwrite replacing the
 *     whole folder, broken manifest); `reload_scripts`.
 */

import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import type { JsonValue } from './fixtures/ai-standin.mjs';
import {
  ensureAssistantOn,
  expect,
  fixtureBook,
  recordOutside,
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

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SCRIPT_FIXTURES = path.join(REPO_ROOT, 'tests', 'scripts', 'fixtures');
const PROPOSALS = fileURLToPath(new URL('./fixtures/ai-proposals/', import.meta.url));
const BOOK = fixtureBook('ai-selection.fb2');

interface LastRequest {
  id: string;
  state: string;
  exchanges: number;
  changes: number;
}

interface ChatMessage {
  role: string;
  content: string;
  tool_call_id?: string;
}

interface ChatBody {
  messages: ChatMessage[];
}

interface ActivityRow {
  kind: string;
  request: string;
  text: string;
}

interface Envelope {
  error: { code: string; message: string; hint?: string; [extra: string]: unknown };
}

interface ScriptListing {
  scripts: {
    id: string;
    name: string;
    description?: string;
    kind: string;
    needsSelection: boolean;
    group: string;
    source: string;
    available: boolean;
    reason?: string;
  }[];
  issues: string[];
}

interface ModelPoint {
  nodeId: string;
  offset: number;
}

interface Para {
  id: string;
  text: string;
}

interface SessionSettings {
  session: { lastScript?: string };
}

const documentXml = (page: Page) => page.evaluate<string>('window.__mfbeTest.scripts.toXml()');
const lastRequest = (page: Page) =>
  page.evaluate<LastRequest | null>('window.__mfbeTest.ai.lastRequest()');
const lastRequestId = async (page: Page) => (await lastRequest(page))?.id ?? null;
const isModified = (page: Page) =>
  page.title().then((title) => title.startsWith('*') || /\* - /.test(title));
const scriptIds = (page: Page) =>
  page.evaluate<string[]>('window.__mfbeTest.scripts.list().map((s) => s.id)');
const scriptGroup = (page: Page, id: string) =>
  page.evaluate<string | null>(
    `(window.__mfbeTest.scripts.list().find((s) => s.id === ${JSON.stringify(id)}) || {}).group ?? null`,
  );

const input = (page: Page) => page.getByTestId('ai-input');
const banner = (page: Page) => page.getByTestId('script-run-banner');

const allActivityRows = (page: Page) =>
  page.evaluate<ActivityRow[]>(`Array.from(
    document.querySelectorAll('[data-testid^="ai-activity-"]'),
    (li) => ({
      kind: li.getAttribute('data-kind'),
      request: li.getAttribute('data-request'),
      text: li.querySelector('.mfbe-ai-activity-text').textContent,
    }),
  )`);

/** The activity rows of the latest request alone, in order. */
async function activityRows(page: Page): Promise<ActivityRow[]> {
  const rows = await allActivityRows(page);
  const last = rows.at(-1)?.request;
  return rows.filter((row) => row.request === last);
}

/** The `p` children of section `index` of the first body: id and plain text. */
function paragraphsOf(page: Page, index: number): Promise<Para[]> {
  return page.evaluate<Para[]>(
    `((index) => {
      const doc = window.__mfbeTest.scripts.document();
      const sections = doc.bodies[0].content.filter((n) => n.type === 'section');
      const textOf = (n) => (n.type === 'text' ? n.text : (n.content ?? []).map(textOf).join(''));
      return sections[index].content
        .filter((n) => n.type === 'p')
        .map((p) => ({ id: p.attrs.nodeId, text: textOf(p) }));
    })(${index})`,
  );
}

async function selectRange(page: Page, anchor: ModelPoint, head: ModelPoint): Promise<void> {
  const placed = await page.evaluate<boolean>(
    `window.__mfbeTest.scripts.selectRange(${JSON.stringify(anchor)}, ${JSON.stringify(head)})`,
  );
  expect(placed).toBe(true);
}

/** Selects the whole first paragraph of section 1 (two emphasised words, a footnote link). */
async function selectFirstParagraph(page: Page): Promise<Para> {
  const [p1] = await paragraphsOf(page, 0);
  await selectRange(
    page,
    { nodeId: p1!.id, offset: 0 },
    { nodeId: p1!.id, offset: p1!.text.length },
  );
  return p1!;
}

/** A caret at the start of the first paragraph: no selection. */
async function collapseSelection(page: Page): Promise<void> {
  const [p1] = await paragraphsOf(page, 0);
  await selectRange(page, { nodeId: p1!.id, offset: 0 }, { nodeId: p1!.id, offset: 0 });
}

async function openBook(core: CoreHandle, page: Page, standin: StandinHandle): Promise<void> {
  await core.rpc('settings.set', {
    patch: {
      ai: {
        mode: 'custom',
        custom: { address: `${standin.url}/v1`, key: '', model: 'standin-chat' },
      },
    },
  });
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText(await pageText(page, 'status.ready'));
  // The fixture packages are listed (the catalogue follows the copied folders).
  await expect
    .poll(async () => {
      const ids = new Set(await scriptIds(page));
      return (
        ids.has('test.dialogs.form') && ids.has('runs.prompt') && ids.has('test.errors.throws')
      );
    })
    .toBe(true);
  await core.enqueueDialog('dialog.openFile', { paths: [BOOK] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, BOOK);
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
}

/**
 * The assistant on: the panel is restored as the session left it (FR-040 as amended, T100) -
 * live already at start, or shown through View → AI Assistant when hidden.
 */
async function turnOn(page: Page): Promise<void> {
  await ensureAssistantOn(page);
}

/** Sends from the panel without waiting for the end (a dialog or a cancel follows). */
async function send(page: Page, instruction: string): Promise<string | null> {
  const before = await lastRequestId(page);
  await input(page).fill(instruction);
  await input(page).press('Enter');
  return before;
}

/** Waits until the request that followed `before` has ended. */
async function waitForEnd(page: Page, before: string | null, timeout = 30_000) {
  await expect.poll(() => lastRequestId(page), { timeout }).not.toBe(before);
  await expect(page.getByTestId('ai-send')).toBeVisible({ timeout });
  await expect(banner(page)).toHaveCount(0, { timeout });
  return (await lastRequest(page))!;
}

async function sendAndWait(page: Page, instruction: string, timeout = 30_000) {
  const before = await send(page, instruction);
  return waitForEnd(page, before, timeout);
}

/** The `tool` messages of the last recorded exchange, parsed. */
async function lastToolMessages(standin: StandinHandle): Promise<ChatMessage[]> {
  const requests = await standin.requests();
  const body = requests.at(-1)!.body as unknown as ChatBody;
  return body.messages.filter((m) => m.role === 'tool');
}

const parse = <T>(message: ChatMessage): T => JSON.parse(message.content) as T;

type Args = { [member: string]: JsonValue | undefined };
const toolCall = (id: string, name: string, args: Args) => ({
  toolCalls: [{ id, name, arguments: args }],
});

/** A proposal fixture's files as the model sends them. */
function proposalFiles(name: string): { path: string; content: string }[] {
  const folder = path.join(PROPOSALS, name);
  return readdirSync(folder)
    .sort()
    .map((file) => ({ path: file, content: readFileSync(path.join(folder, file), 'utf8') }));
}

/** The recursive listing of a folder with sizes (SC-011's comparison), sorted. */
function listing(folder: string): string[] {
  if (!existsSync(folder)) return [];
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = path.join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full, `${prefix}${entry}/`);
      else out.push(`${prefix}${entry} ${stat.size}`);
    }
  };
  walk(folder, '');
  return out;
}

const scriptsFolder = (core: CoreHandle) => path.join(core.dataDir!, 'scripts');
const assistantFolder = (core: CoreHandle) => path.join(scriptsFolder(core), '90_assistant');

/** No package of the assistant's group from an earlier test (the tests run in any order). */
async function clearAssistantFolder(core: CoreHandle): Promise<void> {
  rmSync(assistantFolder(core), { recursive: true, force: true });
  await core.rpc('scripts.reload');
}

const proposalDialog = (page: Page) => page.getByTestId('dialog-ai-script-proposal');

const NBSP = '\u00A0';
const SUMMARY = 'Inserts a non-breaking space after one-letter prepositions in the selection';

/* ------------------------------------------------------------------------ */
/* The journeys                                                             */
/* ------------------------------------------------------------------------ */

test.beforeAll(async ({ coreServer }) => {
  if (!coreServer.hasCore || !coreServer.dataDir) return;
  for (const group of ['02_Dialogs', '03_Errors', '05_Runs']) {
    const target = path.join(coreServer.dataDir, 'scripts', group);
    if (!existsSync(target)) cpSync(path.join(SCRIPT_FIXTURES, group), target, { recursive: true });
  }
});

test.describe('US6 (005) - scripts through the assistant', () => {
  let outside: string[] = [];

  test.beforeEach(async ({ core, standin, context }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    outside = await recordOutside(context);
    await standin.reset();
    await core.resetAiRequests();
    await core.setAiResolve([]);
    await core.rpc('settings.set', { patch: { ai: null } });
  });

  test.afterEach(async ({ core }) => {
    if (!core.hasCore) return;
    expect(outside).toEqual([]);
    await core.rpc('settings.set', { patch: { ai: null } }).catch(() => {});
  });

  test('1. list_scripts, read_script and read_resource: the effective scripts with their availability, a package with its files, the three references', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin);
    await turnOn(page);
    await collapseSelection(page);
    await standin.scenarios([
      toolCall('c-list', 'list_scripts', {}),
      toolCall('c-read', 'read_script', { id: 'test.dialogs.form' }),
      toolCall('c-api', 'read_resource', { uri: 'mfbe://script-api.d.ts' }),
      toolCall('c-manifest', 'read_resource', { uri: 'mfbe://script-manifest.md' }),
      toolCall('c-example', 'read_resource', { uri: 'mfbe://example-script' }),
      toolCall('c-unknown', 'read_script', { id: 'no.such.script' }),
      { text: 'Here is what I found.' },
    ]);
    const request = await sendAndWait(page, 'Which scripts are there?');
    expect(request.state).toBe('answered');
    expect(request.changes).toBe(0);
    const tools = await lastToolMessages(standin);
    expect(tools.map((m) => m.tool_call_id)).toEqual([
      'c-list',
      'c-read',
      'c-api',
      'c-manifest',
      'c-example',
      'c-unknown',
    ]);

    // Scenario 1: every effective script with id, name, description, kind, needsSelection and
    // whether it may run now (no selection: the selection scripts say needsSelection).
    const list = parse<ScriptListing>(tools[0]!);
    const byId = new Map(list.scripts.map((s) => [s.id, s]));
    expect(byId.get('18/remove-spaces')).toMatchObject({
      name: 'Remove spaces',
      description: expect.stringContaining('spaces'),
      kind: 'menu',
      needsSelection: true,
      source: 'bundled',
      available: false,
      reason: 'needsSelection',
    });
    expect(byId.get('test.dialogs.form')).toMatchObject({
      name: 'Form dialog',
      kind: 'menu',
      needsSelection: false,
      group: '02_Dialogs',
      source: 'user',
      available: true,
    });
    expect(byId.get('runs.prompt')).toMatchObject({
      name: 'Ask in the middle of a run',
      kind: 'menu',
      needsSelection: false,
      source: 'user',
      available: true,
    });
    expect(byId.get('test.errors.throws')).toMatchObject({ available: true });
    for (const script of list.scripts) {
      expect(typeof script.id).toBe('string');
      expect(typeof script.name).toBe('string');
      expect(['menu', 'tree']).toContain(script.kind);
      expect(typeof script.needsSelection).toBe('boolean');
      expect(typeof script.available).toBe('boolean');
    }
    expect(
      list.scripts.filter((s) => s.kind === 'tree').every((s) => s.reason === 'treeOnly'),
    ).toBe(true);
    expect(Array.isArray(list.issues)).toBe(true);

    // read_script: the manifest and the entry in full, the icon as a binary with its size.
    const read = parse<{
      id: string;
      folder: string;
      source: string;
      files: { path: string; content?: string; binary?: boolean; bytes?: number }[];
    }>(tools[1]!);
    expect(read.id).toBe('test.dialogs.form');
    expect(read.source).toBe('user');
    expect(path.resolve(read.folder)).toBe(
      path.resolve(path.join(scriptsFolder(core), '02_Dialogs', '01_Form')),
    );
    const fixture = path.join(SCRIPT_FIXTURES, '02_Dialogs', '01_Form');
    const byPath = new Map(read.files.map((f) => [f.path, f]));
    expect([...byPath.keys()].sort()).toEqual(['icon.png', 'index.js', 'script.json']);
    expect(byPath.get('script.json')!.content).toBe(
      readFileSync(path.join(fixture, 'script.json'), 'utf8'),
    );
    expect(byPath.get('index.js')!.content).toBe(
      readFileSync(path.join(fixture, 'index.js'), 'utf8'),
    );
    expect(byPath.get('icon.png')).toEqual({
      path: 'icon.png',
      binary: true,
      bytes: statSync(path.join(fixture, 'icon.png')).size,
    });

    // read_resource: the three references - sizes and first lines; the example whole.
    const api = parse<{ uri: string; mimeType: string; text: string }>(tools[2]!);
    const apiFile = readFileSync(path.join(REPO_ROOT, 'docs', 'scripting', 'mfbe.d.ts'), 'utf8');
    expect(api.mimeType).toBe('text/typescript');
    expect(api.text).toBe(apiFile);
    expect(api.text.length).toBe(apiFile.length);
    expect(api.text.split('\n')[0]).toBe(apiFile.split('\n')[0]);
    expect(api.text).toContain('declare namespace mfbe');
    const manifest = parse<{ mimeType: string; text: string }>(tools[3]!);
    expect(manifest.mimeType).toBe('text/markdown');
    expect(manifest.text.split('\n')[0]).toBe('## 1. Where scripts live');
    expect(manifest.text).toContain('## 2. The manifest (`script.json`)');
    expect(manifest.text).toContain('## 3. A script');
    expect(manifest.text).not.toContain('## 4.');
    expect(manifest.text.length).toBeGreaterThan(3_000);
    expect(manifest.text.length).toBeLessThan(10_000);
    const example = parse<{ mimeType: string; text: string }>(tools[4]!);
    expect(example.mimeType).toBe('application/json');
    const pkg = JSON.parse(example.text) as {
      id: string;
      files: { path: string; content: string }[];
    };
    expect(pkg.id).toBe('18/empty-line-before-poem-or-cite');
    expect(pkg.files.map((f) => f.path)).toEqual(['script.json', 'index.js']);
    const exampleFolder = path.join(
      REPO_ROOT,
      'scripts',
      '18_editing',
      '04_empty-line-before-poem-or-cite',
    );
    expect(pkg.files[0]!.content).toBe(
      readFileSync(path.join(exampleFolder, 'script.json'), 'utf8'),
    );
    expect(pkg.files[1]!.content).toBe(readFileSync(path.join(exampleFolder, 'index.js'), 'utf8'));
    expect(pkg.files[1]!.content.split('\n')[0]).toContain('Converted from');
    expect(pkg.files[1]!.content).toContain('Notice of the original script');
    expect(example.text.length).toBeGreaterThan(2_000);
    // An unknown id: invalidArguments with the id list as the hint.
    const unknown = parse<Envelope>(tools[5]!);
    expect(unknown.error.code).toBe('invalidArguments');
    expect(unknown.error.hint).toContain('test.dialogs.form');

    // The activity names the script id and the URI, never a file's content.
    const rows = await activityRows(page);
    const calls = rows.filter((r) => r.kind === 'tool.call').map((r) => r.text);
    expect(calls[1]).toContain('test.dialogs.form');
    expect(calls[2]).toContain('mfbe://script-api.d.ts');
    expect(rows.map((r) => r.text).join('\n')).not.toContain('mfbe.ui.form(');
  });

  test('2. run_script nested: the spaces gone with one undo step for script and set_text, no last-script memory; selectionRequired without a selection; the captioned form dialog; a throwing script; Cancel during the prompt', async ({
    core,
    page,
    standin,
  }) => {
    await openBook(core, page, standin);
    const xmlBefore = await documentXml(page);
    await turnOn(page);
    const lastScriptBefore = (await core.rpc<SessionSettings>('settings.get')).session.lastScript;
    const p1 = await selectFirstParagraph(page);
    expect(p1.text).toContain(' ');
    const [, , p3] = await paragraphsOf(page, 1);

    // (a) The selection script nested, then a set_text of the same request: one undo step.
    await standin.scenarios([
      toolCall('c-run', 'run_script', { id: '18/remove-spaces' }),
      toolCall('c-text', 'set_text', { node: p3!.id, text: 'Текст заменён помощником.' }),
      { text: 'Пробелы удалены, абзац заменён.' },
    ]);
    const request = await sendAndWait(page, 'Remove the spaces in the selection');
    expect(request.state).toBe('committed');
    expect(request.changes).toBe(2);
    let tools = await lastToolMessages(standin);
    expect(parse<{ status: string; changed: boolean }>(tools[0]!)).toMatchObject({
      status: 'done',
      changed: true,
    });
    const [p1After] = await paragraphsOf(page, 0);
    expect(p1After!.id).toBe(p1.id);
    expect(p1After!.text).toBe(p1.text.replace(/[ \u00A0]/g, ''));
    const xmlAfter = await documentXml(page);
    expect(xmlAfter).toContain('Текст заменён помощником.');
    // The formatting survived (the emphasis and the footnote link of the paragraph).
    expect(xmlAfter).toMatch(/<emphasis>далекозаполночь<\/emphasis>/);
    expect(xmlAfter).toContain('<a l:href="#n1" type="note">[1]</a>');
    expect(await isModified(page)).toBe(true);
    // The activity: one change.try / change.accepted for the run, no own banner entry.
    let rows = await activityRows(page);
    expect(rows.filter((r) => r.kind === 'change.try')).toHaveLength(2);
    expect(rows.filter((r) => r.kind === 'change.accepted')).toHaveLength(2);
    expect(rows.find((r) => r.kind === 'change.try')!.text).toContain('run_script');
    expect(rows.find((r) => r.kind === 'tool.call')!.text).toContain('18/remove-spaces');
    // No "last script" memory for the nested run; the Scripts menu's Last script stays as it was.
    expect((await core.rpc<SessionSettings>('settings.get')).session.lastScript).toBe(
      lastScriptBefore,
    );
    expect(await page.evaluate<string | null>('window.__mfbeTest.scripts.lastRunId()')).toBe(
      lastScriptBefore ?? null,
    );
    // One Mod+z restores both changes (SC-003).
    await page.getByTestId('body-editor').focus();
    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(() => documentXml(page)).toBe(xmlBefore);

    // (b) Without a selection: selectionRequired, shown in the activity (FR-054), one strike.
    await collapseSelection(page);
    await standin.scenarios([
      toolCall('c-run-none', 'run_script', { id: '18/remove-spaces' }),
      { text: 'Nothing is selected.' },
    ]);
    const none = await sendAndWait(page, 'Remove the spaces');
    expect(none.state).toBe('answered');
    tools = await lastToolMessages(standin);
    const refused = parse<Envelope>(tools[0]!);
    expect(refused.error.code).toBe('selectionRequired');
    expect(refused.error.hint).toContain('set_selection');
    expect(refused.error.strike).toEqual({ count: 1, of: 3 });
    rows = await activityRows(page);
    expect(rows.some((r) => r.kind === 'tool.error' && r.text.includes('selectionRequired'))).toBe(
      true,
    );
    expect(await documentXml(page)).toBe(xmlBefore);

    // (c) The form dialog captioned as run by the assistant, filled and confirmed.
    await standin.scenarios([
      toolCall('c-form', 'run_script', { id: 'test.dialogs.form' }),
      { text: 'The form was filled.' },
    ]);
    let before = await send(page, 'Run the form script');
    const form = page.getByTestId('dialog-script-form');
    await expect(form).toBeVisible({ timeout: 15_000 });
    await expect(
      form.getByTestId('dialog-script-form-title').locator('.mfbe-dialog-title-text'),
    ).toHaveText(await pageText(page, 'ai.script.nestedCaption', { name: 'Footnote options' }));
    // One banner - the request's, of kind ai - while the script waits in its dialog.
    await expect(banner(page)).toHaveCount(1);
    await expect(banner(page)).toHaveAttribute('data-run-kind', 'ai');
    expect(await documentXml(page)).toBe(xmlBefore);
    await form.getByTestId('dialog-script-form-field-prefix').fill('ai_');
    await form.getByTestId('dialog-script-form-button-ok').click();
    const formed = await waitForEnd(page, before);
    expect(formed.state).toBe('committed');
    expect(formed.changes).toBe(1);
    expect(await documentXml(page)).toContain('form: ai_ 1 true notes square ru');
    rows = await activityRows(page);
    const dialogRows = rows.filter((r) => r.kind === 'script.dialog');
    expect(dialogRows).toHaveLength(1);
    expect(dialogRows[0]!.text).toContain('Form dialog');
    await page.getByTestId('body-editor').focus();
    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(() => documentXml(page)).toBe(xmlBefore);

    // (d) A throwing script: its checkpoint rolled back, the request continues with scriptFailed.
    await standin.scenarios([
      toolCall('c-throws', 'run_script', { id: 'test.errors.throws' }),
      { text: 'The script failed; nothing was changed.' },
    ]);
    const thrown = await sendAndWait(page, 'Run the throwing script');
    expect(thrown.state).toBe('answered');
    expect(thrown.changes).toBe(0);
    tools = await lastToolMessages(standin);
    const failed = parse<Envelope>(tools[0]!);
    expect(failed.error.code).toBe('scriptFailed');
    expect(failed.error.message).toContain('boom');
    expect(failed.error.strike).toBeUndefined();
    expect(await documentXml(page)).toBe(xmlBefore);
    expect(await documentXml(page)).not.toContain('before the error');

    // (e) Cancel on the banner during the script's prompt: script and request cancelled
    // together, the XML unchanged.
    await standin.scenarios([
      toolCall('c-prompt', 'run_script', { id: 'runs.prompt' }),
      { text: 'never reached' },
    ]);
    const modifiedBeforeCancel = await isModified(page);
    before = await send(page, 'Run the prompting script');
    const message = page.getByTestId('dialog-script-message');
    await expect(message).toBeVisible({ timeout: 15_000 });
    await expect(
      message.getByTestId('dialog-script-message-title').locator('.mfbe-dialog-title-text'),
    ).toHaveText(
      await pageText(page, 'ai.script.nestedCaption', { name: 'Ask in the middle of a run' }),
    );
    // Nothing of the run is visible in the editor before the commit (review C10).
    expect(await documentXml(page)).toBe(xmlBefore);
    await banner(page).getByTestId('script-run-cancel').click();
    await expect(message).toHaveCount(0);
    const cancelled = await waitForEnd(page, before);
    expect(cancelled.state).toBe('cancelled');
    expect(await documentXml(page)).toBe(xmlBefore);
    // `modified` as before the request (review C10: restored on every end but commit).
    expect(await isModified(page)).toBe(modifiedBeforeCancel);
    expect(await page.evaluate<string>('window.__mfbeTest.scripts.state().status')).toBe(
      'cancelled',
    );
    expect((await core.rpc<SessionSettings>('settings.get')).session.lastScript).toBe(
      lastScriptBefore,
    );
  });

  test("3. the proposal: every file in full, the folder and the author line; Don't write leaves the folder as it was (SC-011); Write puts it in the menu, the FR-084 gate holds until a later instruction, then it runs; run from the menu", async ({
    core,
    page,
    standin,
  }) => {
    await clearAssistantFolder(core);
    await openBook(core, page, standin);
    const xmlBefore = await documentXml(page);
    await turnOn(page);
    await selectFirstParagraph(page);
    const files = proposalFiles('nbsp-prepositions');
    const target = `${path.join(assistantFolder(core), 'nbsp-prepositions')}/`;

    // Scenario 3: the proposal shown, Don't write.
    const folderBefore = listing(scriptsFolder(core));
    await standin.scenarios([
      toolCall('c-propose', 'propose_script', {
        id: 'assistant/nbsp-prepositions',
        files,
        summary: SUMMARY,
      }),
      { text: 'Understood, nothing was written.' },
    ]);
    let before = await send(
      page,
      'Make me a script that puts a non-breaking space after one-letter prepositions',
    );
    const dialog = proposalDialog(page);
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByTestId('dialog-ai-script-proposal-title')).toContainText(
      'Non-breaking space after prepositions',
    );
    await expect(dialog.getByTestId('dialog-ai-script-proposal-summary')).toHaveText(SUMMARY);
    await expect(dialog.getByTestId('dialog-ai-script-proposal-folder')).toHaveText(target);
    await expect(dialog.getByTestId('dialog-ai-script-proposal-replaces')).toHaveCount(0);
    const author = dialog.getByTestId('dialog-ai-script-proposal-author');
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    await expect(author).toHaveValue(await pageText(page, 'ai.proposal.authorDefault', { date }));
    // Every file with its full content (the entry with the author line on top).
    const fileBlocks = dialog.locator('[data-testid^="dialog-ai-script-proposal-file-"]');
    await expect(fileBlocks).toHaveCount(files.length);
    for (const [index, file] of files.entries()) {
      const block = dialog.getByTestId(`dialog-ai-script-proposal-file-${index}`);
      await expect(block).toHaveAttribute('data-path', file.path);
      const shown = (await block.locator('pre').textContent()) ?? '';
      if (file.path === 'index.js') {
        expect(shown.endsWith(file.content)).toBe(true);
        expect(shown.split('\n')[0]).toContain('// Written with the AI assistant');
      } else {
        expect(shown).toBe(file.content);
      }
    }
    await expect(dialog.getByTestId('dialog-ai-script-proposal-warning-0')).toHaveCount(0);
    // The three buttons; Write is the default.
    for (const id of ['write', 'writeAndRun', 'dontWrite']) {
      await expect(dialog.getByTestId(`dialog-ai-script-proposal-button-${id}`)).toBeVisible();
    }
    await expect(dialog.getByTestId('dialog-ai-script-proposal-button-write')).toHaveClass(
      /mfbe-button-default/,
    );
    await dialog.getByTestId('dialog-ai-script-proposal-button-dontWrite').click();
    const declined = await waitForEnd(page, before);
    expect(declined.state).toBe('answered');
    let tools = await lastToolMessages(standin);
    expect(parse<unknown>(tools[0]!)).toEqual({ written: false, declined: true });
    expect(listing(scriptsFolder(core))).toEqual(folderBefore);
    expect(existsSync(assistantFolder(core))).toBe(false);
    let rows = await activityRows(page);
    expect(rows.find((r) => r.kind === 'script.proposed')!.text).toContain(
      await pageText(page, 'ai.activity.declined'),
    );
    expect(await documentXml(page)).toBe(xmlBefore);

    // Scenario 4 (a): Write, with the author line edited; the model's run_script in the same
    // request → runNotConfirmed, nothing run.
    await standin.scenarios([
      toolCall('c-propose-2', 'propose_script', {
        id: 'assistant/nbsp-prepositions',
        files,
        summary: SUMMARY,
      }),
      toolCall('c-run-same', 'run_script', { id: 'assistant/nbsp-prepositions' }),
      { text: 'The script is written; tell me when to run it.' },
    ]);
    before = await send(page, 'Make me that script');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    const edited = `${await author.inputValue()} (Quark Zimmerman)`;
    await author.fill(edited);
    await dialog.getByTestId('dialog-ai-script-proposal-button-write').click();
    const written = await waitForEnd(page, before);
    expect(written.state).toBe('answered');
    expect(written.changes).toBe(0);
    tools = await lastToolMessages(standin);
    const writeResult = parse<{
      written: boolean;
      id: string;
      path: string;
      runRequested: boolean;
    }>(tools[0]!);
    expect(writeResult).toMatchObject({
      written: true,
      id: 'assistant/nbsp-prepositions',
      runRequested: false,
    });
    expect(path.resolve(writeResult.path)).toBe(path.resolve(target));
    const gated = parse<Envelope>(tools[1]!);
    expect(gated.error.code).toBe('runNotConfirmed');
    expect(gated.error.hint).toContain('ask the user');
    expect(await documentXml(page)).toBe(xmlBefore);
    // On disk: the package as proposed, the edited author line the first comment line.
    const onDisk = readFileSync(path.join(target, 'index.js'), 'utf8');
    expect(onDisk.split('\n')[0]).toBe(`// ${edited}`);
    expect(onDisk.endsWith(files.find((f) => f.path === 'index.js')!.content)).toBe(true);
    expect(readFileSync(path.join(target, 'script.json'), 'utf8')).toBe(
      files.find((f) => f.path === 'script.json')!.content,
    );
    rows = await activityRows(page);
    expect(rows.find((r) => r.kind === 'script.proposed')!.text).toContain(
      await pageText(page, 'ai.activity.written'),
    );
    // scripts.list and the Scripts menu show it at once (SC-011).
    await expect.poll(() => scriptIds(page)).toContain('assistant/nbsp-prepositions');
    const group = (await scriptGroup(page, 'assistant/nbsp-prepositions'))!;
    expect(group).toBeTruthy();
    await page.getByTestId('menu-scripts').click();
    await page.getByTestId(`menu-scripts-${group}`).hover();
    await expect(
      page.getByTestId(`menu-scripts-${group}-assistant/nbsp-prepositions`),
    ).toContainText('Non-breaking space after prepositions');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // (a) continued: the user's next instruction asks for the run → allowed, the NBSP inserted.
    await selectFirstParagraph(page);
    await standin.scenarios([
      toolCall('c-run-later', 'run_script', { id: 'assistant/nbsp-prepositions' }),
      { text: 'Done.' },
    ]);
    const ran = await sendAndWait(page, 'Run it');
    expect(ran.state).toBe('committed');
    expect(ran.changes).toBe(1);
    tools = await lastToolMessages(standin);
    expect(parse<{ status: string }>(tools[0]!).status).toBe('done');
    const [p1Nbsp] = await paragraphsOf(page, 0);
    expect(p1Nbsp!.text).toContain(`и${NBSP}на`);
    expect(await documentXml(page)).toContain(`и${NBSP}на`);
    await page.getByTestId('body-editor').focus();
    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(() => documentXml(page)).toBe(xmlBefore);

    // (c) Run from the menu on a selection, as any user script: its own run, one undo step.
    await selectFirstParagraph(page);
    await page.getByTestId('menu-scripts').click();
    await page.getByTestId(`menu-scripts-${group}`).hover();
    await page.getByTestId(`menu-scripts-${group}-assistant/nbsp-prepositions`).click();
    await expect.poll(() => documentXml(page), { timeout: 15_000 }).toContain(`и${NBSP}на`);
    await expect(banner(page)).toHaveCount(0);
    expect(await page.evaluate<string>('window.__mfbeTest.scripts.state().status')).toBe('done');
    expect(await page.evaluate<string | null>('window.__mfbeTest.scripts.lastRunId()')).toBe(
      'assistant/nbsp-prepositions',
    );
    await page.getByTestId('body-editor').focus();
    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(() => documentXml(page)).toBe(xmlBefore);
  });

  test('4. Write and run runs at once; the warnings of nbsp-with-fetch (Write not the default) and the fence at run time; the refusals before any dialog; overwrite replaces the whole folder; reload_scripts', async ({
    core,
    page,
    standin,
  }) => {
    await clearAssistantFolder(core);
    await openBook(core, page, standin);
    const xmlBefore = await documentXml(page);
    await turnOn(page);
    await selectFirstParagraph(page);
    const fetchFiles = proposalFiles('nbsp-with-fetch');
    const fetchTarget = path.join(assistantFolder(core), 'nbsp-with-fetch');

    // (b) The proposal with fetch( and require('fs'): the warnings with file and line, Write not
    // the default; Write and run → runRequested: true and the run at once, stopped by the fence.
    await standin.scenarios([
      toolCall('c-propose-fetch', 'propose_script', {
        id: 'assistant/nbsp-with-fetch',
        files: fetchFiles,
        summary:
          'Inserts a non-breaking space after one-letter prepositions, with an extra word list',
      }),
      toolCall('c-run-fetch', 'run_script', { id: 'assistant/nbsp-with-fetch' }),
      { text: 'The script ran.' },
    ]);
    let before = await send(page, 'Make me the script with the extra word list and run it');
    const dialog = proposalDialog(page);
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    const indexJs = fetchFiles.find((f) => f.path === 'index.js')!.content.split('\n');
    // The code lines (the header comment names both calls too - a comment is not scanned).
    const fetchLine =
      indexJs.findIndex((line) => line.includes('const response = await fetch(')) + 1;
    const requireLine = indexJs.findIndex((line) => line.includes("const fs = require('fs')")) + 1;
    expect(fetchLine).toBeGreaterThan(0);
    expect(requireLine).toBeGreaterThan(fetchLine);
    await expect(dialog.getByTestId('dialog-ai-script-proposal-warnings')).toContainText(
      await pageText(page, 'ai.proposal.warningsTitle'),
    );
    await expect(dialog.getByTestId('dialog-ai-script-proposal-warning-0')).toHaveText(
      await pageText(page, 'ai.proposal.warning', {
        path: 'index.js',
        line: fetchLine,
        name: 'fetch',
        text: indexJs[fetchLine - 1]!.trim(),
      }),
    );
    await expect(dialog.getByTestId('dialog-ai-script-proposal-warning-1')).toContainText(
      `index.js, line ${requireLine}: require`,
    );
    await expect(dialog.getByTestId('dialog-ai-script-proposal-warning-2')).toHaveCount(0);
    for (const id of ['write', 'writeAndRun', 'dontWrite']) {
      await expect(dialog.getByTestId(`dialog-ai-script-proposal-button-${id}`)).not.toHaveClass(
        /mfbe-button-default/,
      );
    }
    await dialog.getByTestId('dialog-ai-script-proposal-button-writeAndRun').click();
    const fetched = await waitForEnd(page, before);
    expect(fetched.state).toBe('answered');
    expect(fetched.changes).toBe(0);
    let tools = await lastToolMessages(standin);
    expect(parse<{ written: boolean; runRequested: boolean }>(tools[0]!)).toMatchObject({
      written: true,
      runRequested: true,
    });
    // Written as proposed (the author line on top), the run allowed at once - and stopped by
    // the fence: fetch does not exist inside the sandbox.
    expect(existsSync(path.join(fetchTarget, 'index.js'))).toBe(true);
    expect(readFileSync(path.join(fetchTarget, 'index.js'), 'utf8')).toContain('await fetch(');
    const fenced = parse<Envelope>(tools[1]!);
    expect(fenced.error.code).toBe('scriptFailed');
    expect(fenced.error.message).toMatch(/fetch/);
    expect(await documentXml(page)).toBe(xmlBefore);

    // The refusals before any dialog: a bundled id, a path leaving the package, the same id
    // without overwrite, a broken manifest.
    const nbspFiles = proposalFiles('nbsp-prepositions');
    const bundledFiles = nbspFiles.map((f) =>
      f.path === 'script.json'
        ? {
            ...f,
            content: f.content.replace('"assistant/nbsp-prepositions"', '"18/remove-spaces"'),
          }
        : f,
    );
    const brokenFiles = proposalFiles('broken-manifest');
    await standin.scenarios([
      toolCall('c-bundled', 'propose_script', {
        id: '18/remove-spaces',
        files: bundledFiles,
        summary: SUMMARY,
      }),
      toolCall('c-escape', 'propose_script', {
        id: 'assistant/nbsp-prepositions',
        files: [...nbspFiles, { path: '../x.js', content: 'export {};' }],
        summary: SUMMARY,
      }),
      toolCall('c-exists', 'propose_script', {
        id: 'assistant/nbsp-with-fetch',
        files: fetchFiles,
        summary: SUMMARY,
      }),
      toolCall('c-broken', 'propose_script', {
        id: 'assistant/broken-manifest',
        files: brokenFiles,
        summary: 'A proposal whose manifest lacks name.en',
      }),
      { text: 'Every proposal was refused.' },
    ]);
    const refusedCount = (await standin.requests()).length;
    const refused = await sendAndWait(page, 'Try the refused proposals');
    expect(refused.state).toBe('answered');
    expect(await page.getByTestId('dialog-ai-script-proposal').count()).toBe(0);
    tools = await lastToolMessages(standin);
    expect(parse<Envelope>(tools[0]!).error.code).toBe('scriptIdBundled');
    expect(parse<Envelope>(tools[0]!).error.hint).toContain('new id');
    const escape = parse<Envelope>(tools[1]!);
    expect(escape.error.code).toBe('invalidArguments');
    expect(escape.error.message).toContain('../x.js');
    expect(parse<Envelope>(tools[2]!).error.code).toBe('scriptExists');
    const broken = parse<Envelope>(tools[3]!);
    expect(broken.error.code).toBe('invalidArguments');
    expect(broken.error.message).toContain('name.en');
    expect(existsSync(path.join(assistantFolder(core), 'broken-manifest'))).toBe(false);
    expect(existsSync(path.join(assistantFolder(core), 'nbsp-prepositions'))).toBe(false);
    expect((await standin.requests()).length).toBeGreaterThan(refusedCount);
    const rows = await activityRows(page);
    expect(rows.filter((r) => r.kind === 'tool.error')).toHaveLength(4);
    expect(rows.filter((r) => r.kind === 'script.proposed')).toHaveLength(0);

    // Overwrite: the whole old folder is replaced - a file of the old package absent from the
    // new set is gone.
    const lib = { path: 'extra-words.txt', content: 'в к с\n' };
    await standin.scenarios([
      toolCall('c-overwrite', 'propose_script', {
        id: 'assistant/nbsp-with-fetch',
        files: [
          ...nbspFiles.map((f) =>
            f.path === 'script.json'
              ? {
                  ...f,
                  content: f.content.replace(
                    '"assistant/nbsp-prepositions"',
                    '"assistant/nbsp-with-fetch"',
                  ),
                }
              : f,
          ),
          lib,
        ],
        overwrite: true,
        summary: 'Replaces the script by the version without the network',
      }),
      { text: 'Replaced.' },
    ]);
    before = await send(page, 'Replace the fetch version by the clean one');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByTestId('dialog-ai-script-proposal-replaces')).toBeVisible();
    await expect(dialog.getByTestId('dialog-ai-script-proposal-warning-0')).toHaveCount(0);
    await dialog.getByTestId('dialog-ai-script-proposal-button-write').click();
    const replaced = await waitForEnd(page, before);
    expect(replaced.state).toBe('answered');
    expect(readdirSync(fetchTarget).sort()).toEqual(['extra-words.txt', 'index.js', 'script.json']);
    expect(readFileSync(path.join(fetchTarget, 'index.js'), 'utf8')).not.toContain('fetch(');
    // The second overwrite without the extra file: it is gone.
    await standin.scenarios([
      toolCall('c-overwrite-2', 'propose_script', {
        id: 'assistant/nbsp-with-fetch',
        files: nbspFiles.map((f) =>
          f.path === 'script.json'
            ? {
                ...f,
                content: f.content.replace(
                  '"assistant/nbsp-prepositions"',
                  '"assistant/nbsp-with-fetch"',
                ),
              }
            : f,
        ),
        overwrite: true,
        summary: 'Removes the word list',
      }),
      { text: 'Replaced again.' },
    ]);
    before = await send(page, 'Drop the word list');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByTestId('dialog-ai-script-proposal-button-write').click();
    await waitForEnd(page, before);
    expect(readdirSync(fetchTarget).sort()).toEqual(['index.js', 'script.json']);

    // reload_scripts: a package copied into <Data>/scripts during the request appears.
    const copied = path.join(scriptsFolder(core), '04_Model');
    rmSync(copied, { recursive: true, force: true });
    await core.rpc('scripts.reload');
    await expect.poll(() => scriptIds(page)).not.toContain('test.model.append');
    await standin.scenarios([
      toolCall('c-list-before', 'list_scripts', {}),
      { ...toolCall('c-reload', 'reload_scripts', {}), delayMs: 1500 },
      { text: 'Re-read.' },
    ]);
    const requestsBefore = (await standin.requests()).length;
    before = await send(page, 'Re-read the scripts');
    await expect
      .poll(async () => (await standin.requests()).length)
      .toBeGreaterThan(requestsBefore);
    cpSync(path.join(SCRIPT_FIXTURES, '04_Model'), copied, { recursive: true });
    const reloaded = await waitForEnd(page, before);
    expect(reloaded.state).toBe('answered');
    tools = await lastToolMessages(standin);
    const listBefore = parse<ScriptListing>(tools[0]!);
    expect(listBefore.scripts.map((s) => s.id)).not.toContain('test.model.append');
    const reload = parse<{ count: number; issues: string[] }>(tools[1]!);
    expect(reload.count).toBeGreaterThan(listBefore.scripts.length);
    expect(Array.isArray(reload.issues)).toBe(true);
    await expect.poll(() => scriptIds(page)).toContain('test.model.append');
    expect(await documentXml(page)).toBe(xmlBefore);
  });
});
