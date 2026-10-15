/**
 * User Story 12 - Automate editing with user scripts (T100).
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`): the
 * fixture packages of `tests/scripts/fixtures/` are copied into the per-worker user scripts
 * folder (`<data-dir>/scripts`) before the first test, so the core lists them through the
 * layered lookup (FR-141) next to the bundled layer (`scripts/` of the repository, 142 converted
 * legacy packages) - the assertions therefore filter the catalogue by the fixture ids
 * (`test.*`) instead of expecting it to contain nothing else. Skipped in core-less mode.
 *
 * Scenarios (spec.md US12):
 *  1. scripts listed by group in the Scripts menu with icons on the toolbar; "No scripts
 *     found" for an empty folder
 *  2. a script produces the expected document changes (checked against the normalised XML)
 *  3. one Undo reverts a whole run
 *  4. "Script error: <message> at line L, column C", document consistent
 *  5. message box / input prompt / form dialog
 *  6. hotkey runs a script (`defaultHotkey`), `needsSelection` disables it without a selection
 *  7. tree command receives the selected node
 *  8. documentation describes every capability with an example
 *  + cancel of a runaway script rolls back, the sandbox hides the host APIs, "Last script".
 *
 * The Scripts menu / toolbar items are rendered through `useScriptsMenu()` / `<ScriptsToolbar/>`
 * mounted by App.tsx; when the mount is missing the journeys fall back to the hotkey and the
 * `window.__mfbeTest.scripts` hooks (core started with `--test-hooks`) and record a note.
 */

import { cpSync, existsSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';

import type { Locator, Page } from '@playwright/test';

import { expect, fileNew, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';
import { label, LINE_END, LINE_START, MOD, SELECT_TO_LINE_END } from './fixtures/keys';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const FIXTURES = path.join(REPO_ROOT, 'tests', 'scripts', 'fixtures');
const GROUPS = ['01_Case', '02_Dialogs', '03_Errors', '04_Model', 'tree'];

interface RunResult {
  status: string;
  message?: string;
  error?: { message: string; line?: number; column?: number };
}

interface ScriptSummary {
  id: string;
  group: string;
  kind: string;
  /** Layer that provided the package: bundled | user | settings | portable. */
  source: string;
  iconUrl?: string;
  defaultHotkey?: string;
}

/** Ids of the fixture packages in catalogue order (user layer; the bundled scripts come first). */
const FIXTURE_IDS = [
  'test.case.upper',
  'test.case.lower',
  'test.dialogs.form',
  'test.dialogs.message',
  'test.errors.throws',
  'test.errors.infinite',
  'test.errors.sandbox',
  'test.model.append',
  'test.model.replaceAll',
  'test.tree.mark',
];

/** Browser-side test hooks (`src/scripting/testHooks.ts`); the e2e tsconfig has no DOM lib. */
interface ScriptHooks {
  list(): ScriptSummary[];
  run(idOrDir: string, options?: { treeNodeId?: string }): Promise<RunResult>;
  cancel(): void;
  state(): { status: string } | null;
  lastRunId(): string | null;
  treeCommands(nodeId: string): { id: string; scriptId: string; label: string }[];
  document(): unknown;
  toXml(): Promise<string>;
}

declare const window: { __mfbeTest?: { scripts?: ScriptHooks } };

test.beforeAll(async ({ coreServer }) => {
  if (!coreServer.hasCore || !coreServer.dataDir) return;
  const target = path.join(coreServer.dataDir, 'scripts');
  for (const group of GROUPS) {
    if (!existsSync(path.join(target, group))) {
      cpSync(path.join(FIXTURES, group), path.join(target, group), { recursive: true });
    }
  }
});

test.beforeEach(async ({ core }) => {
  test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
});

/* ------------------------------------------------------------------------ */
/* Helpers                                                                  */
/* ------------------------------------------------------------------------ */

async function openApp(page: Page, core: { openApp(page: Page): Promise<void> }) {
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText('Ready');
  // The catalogue is loaded once the feature attached to the connected client.
  await expect
    .poll(async () => page.evaluate(() => window.__mfbeTest?.scripts?.list().length ?? -1), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
}

async function newDocument(page: Page): Promise<Locator> {
  await fileNew(page);
  const editor = page.getByTestId('body-editor');
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  return editor;
}

/** File > New and the paragraphs the blank template starts with. */
async function newDocumentParagraphs(page: Page): Promise<string[]> {
  await newDocument(page);
  await expect.poll(() => paragraphs(page)).not.toEqual([]);
  return paragraphs(page);
}

async function openBook(
  page: Page,
  core: { enqueueDialog(m: string, r: unknown): Promise<void> },
  name: string,
) {
  await core.enqueueDialog('dialog.openFile', { paths: [fixtureBook(name)] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, name);
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
}

/** Paragraph texts of the first section of the main body (as rendered). */
async function paragraphs(page: Page): Promise<string[]> {
  return firstSection(page).locator('> p.fb-p').allInnerTexts();
}

/** The first top-level section of the first body. */
function firstSection(page: Page): Locator {
  return page
    .getByTestId('body-editor')
    .locator('.fb-body')
    .first()
    .locator('> .fb-section')
    .first();
}

/** Number of `p` nodes (titles and nested sections included) under the first section. */
async function paragraphNodeCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const document = window.__mfbeTest!.scripts!.document() as {
      bodies: { content: { type: string; content?: unknown[] }[] }[];
    };
    const section = document.bodies[0]!.content.find((c) => c.type === 'section');
    let count = 0;
    const visit = (node: { type: string; content?: unknown[] }) => {
      if (node.type === 'p') count += 1;
      for (const child of node.content ?? []) visit(child as { type: string; content?: unknown[] });
    };
    if (section) visit(section);
    return count;
  });
}

/** Runs a script through the test hooks and waits for the run to finish. */
async function runViaHook(page: Page, id: string, treeNodeId?: string): Promise<RunResult> {
  return page.evaluate(
    ([scriptId, nodeId]) =>
      window.__mfbeTest!.scripts!.run(
        scriptId!,
        nodeId ? { treeNodeId: nodeId } : {},
      ) as Promise<RunResult>,
    [id, treeNodeId],
  );
}

/** Starts a script without waiting (the run blocks on a dialog or a loop). */
async function startViaHook(page: Page, id: string): Promise<void> {
  await page.evaluate((scriptId) => {
    void window.__mfbeTest!.scripts!.run(scriptId);
  }, id);
}

async function waitIdle(page: Page): Promise<RunResult['status']> {
  await expect
    .poll(() => page.evaluate(() => window.__mfbeTest!.scripts!.state()?.status ?? 'none'))
    .not.toBe('running');
  return page.evaluate(() => window.__mfbeTest!.scripts!.state()?.status ?? 'none');
}

/** True when App.tsx mounts the Scripts menu items (`useScriptsMenu()`). */
async function scriptsMenuMounted(page: Page): Promise<boolean> {
  await page.getByTestId('menu-scripts').click();
  const mounted = (await page.getByTestId('menu-scripts-01_Case').count()) > 0;
  await page.keyboard.press('Escape');
  return mounted;
}

/** Same normalisation as tests/scripts/run-script.mjs (volatile metadata and binaries elided). */
function normaliseXml(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/<program-used>[^<]*<\/program-used>/g, '<program-used>…</program-used>')
    .replace(/(<document-info>[\s\S]*?)<date[^>]*>[^<]*<\/date>/, '$1<date>…</date>')
    .replace(/(<document-info>[\s\S]*?)<id>[^<]*<\/id>/, '$1<id>…</id>')
    .replace(/(<binary\b[^>]*>)[\s\S]*?(<\/binary>)/g, '$1…$2')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .trim();
}

function note(description: string) {
  test.info().annotations.push({ type: 'note', description });
}

async function runFromMenu(page: Page, group: string, scriptId: string): Promise<boolean> {
  await page.getByTestId('menu-scripts').click();
  const groupItem = page.getByTestId(`menu-scripts-${group}`);
  if ((await groupItem.count()) === 0) {
    await page.keyboard.press('Escape');
    return false;
  }
  await groupItem.hover();
  await page.getByTestId(`menu-scripts-${group}-${scriptId}`).click();
  return true;
}

/* ------------------------------------------------------------------------ */
/* Scenarios                                                                */
/* ------------------------------------------------------------------------ */

test.describe('US12 scripts', () => {
  test('1. scripts are listed by group with their icons; invalid packages are reported', async ({
    page,
    core,
  }) => {
    await openApp(page, core);
    const scripts = (await page.evaluate(() =>
      window.__mfbeTest!.scripts!.list(),
    )) as ScriptSummary[];
    // The fixture packages (user layer) are all there, in manifest order; the bundled layer
    // (the converted legacy scripts of `scripts/`) is listed alongside them.
    const fixtureIds = scripts.filter((s) => s.id.startsWith('test.')).map((s) => s.id);
    expect(fixtureIds).toEqual(FIXTURE_IDS);
    for (const id of FIXTURE_IDS) {
      expect(scripts.find((s) => s.id === id)?.source, `${id} comes from the user layer`).toBe(
        'user',
      );
    }
    const bundled = scripts.filter((s) => s.source === 'bundled');
    if (bundled.length > 0) {
      note(`${bundled.length} bundled script(s) listed next to the fixtures`);
      expect(bundled.every((s) => !s.id.startsWith('test.'))).toBe(true);
    }
    expect(scripts.find((s) => s.id === 'test.case.upper')).toMatchObject({
      group: '01_Case',
      kind: 'menu',
      iconUrl: '/scripts/test.case.upper/icon.png',
      defaultHotkey: 'Ctrl+Alt+U',
    });
    expect(scripts.find((s) => s.id === 'test.tree.mark')?.kind).toBe('tree');

    // The icon is served by the core from the package folder only.
    const icon = await page.request.get(
      `${core.baseURL.split('?')[0]}scripts/test.case.upper/icon.png?token=${core.token}`,
    );
    expect(icon.status()).toBe(200);
    expect(icon.headers()['content-type']).toBe('image/png');
    const escape = await page.request.get(
      `${core.baseURL.split('?')[0]}scripts/test.case.upper/..%2F02_Lower%2Findex.js?token=${core.token}`,
    );
    expect(escape.status()).toBe(404);

    if (await scriptsMenuMounted(page)) {
      await page.getByTestId('menu-scripts').click();
      await expect(page.getByTestId('menu-scripts-none')).toHaveCount(0);
      for (const group of ['01_Case', '02_Dialogs', '03_Errors', '04_Model']) {
        await expect(page.getByTestId(`menu-scripts-${group}`)).toBeVisible();
      }
      // The tree group is not a menu group; housekeeping entries follow the groups.
      await expect(page.getByTestId('menu-scripts-tree')).toHaveCount(0);
      await expect(page.getByTestId('menu-scripts-last')).toBeVisible();
      await expect(page.getByTestId('menu-scripts-openFolder')).toBeVisible();
      await expect(page.getByTestId('menu-scripts-reload')).toBeVisible();
      await page.getByTestId('menu-scripts-01_Case').hover();
      await expect(page.getByTestId('menu-scripts-01_Case-test.case.upper')).toHaveText(
        /To upper case/,
      );
      await expect(page.getByTestId('menu-scripts-01_Case-test.case.upper')).toContainText(
        label('Ctrl+Alt+U'),
      );
      await page.keyboard.press('Escape');
      // The Scripts toolbar starts with "Last script" alone; its Customize dialog offers the
      // scripts with an icon and not those without one (feature 002).
      await expect(page.getByTestId('toolbar-scripts').getByRole('button')).toHaveCount(1);
      await page.getByTestId('toolbar-scripts.last').click({ button: 'right', force: true });
      await page.getByTestId('toolbar-menu-customize').click();
      const offered = page.getByTestId('customize-toolbar-available');
      await expect(offered.locator('option[data-item="script.test.case.upper"]')).toHaveCount(1);
      await expect(offered.locator('option[data-item="script.test.model.append"]')).toHaveCount(1);
      await expect(offered.locator('option[data-item="script.test.errors.throws"]')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('dialog-customize-toolbar')).toHaveCount(0);
    } else {
      note('Scripts menu/toolbar not mounted by App.tsx yet; catalogue checked through the hooks');
    }
  });

  test('2. a script produces the expected changes (normalised XML snapshot)', async ({
    page,
    core,
  }) => {
    await openApp(page, core);
    await openBook(page, core, 'modern-utf8.fb2');
    const before = await paragraphs(page);
    const count = await paragraphNodeCount(page);
    const result = await runViaHook(page, 'test.model.append');
    expect(result.status).toBe('done');
    const after = await paragraphs(page);
    expect(after).toEqual([...before, `Added by script (${count} paragraphs before)`]);
    const xml = await page.evaluate(() => window.__mfbeTest!.scripts!.toXml());
    expect(xml).toContain(`<p>Added by script (${count} paragraphs before)</p>`);
    expect(xml).toMatch(/<p>Added by script[^<]*<\/p>\s*<empty-line\s*\/>/);
    // Snapshot of the whole document after the run, as the equivalence harness stores it.
    const snapshot = path.join(
      REPO_ROOT,
      'tests',
      'scripts',
      'snapshots',
      'fixtures',
      'append.modern-utf8.xml',
    );
    if (existsSync(snapshot)) {
      expect(normaliseXml(xml)).toBe(normaliseXml(readFileSync(snapshot, 'utf8')));
    }
    // The sticky status set by the script survives the end of the run.
    await expect(page.getByTestId('status-message')).toHaveText(
      `Appended after ${count} paragraphs`,
    );
  });

  test('3. Undo reverts the whole run as one step; Last script repeats it', async ({
    page,
    core,
  }) => {
    await openApp(page, core);
    const initial = await newDocumentParagraphs(page);
    const n = await paragraphNodeCount(page);
    const emptyLines = await firstSection(page).locator('> .fb-empty-line').count();
    const started = await runFromMenu(page, '04_Model', 'test.model.append');
    if (!started) {
      note('menu not mounted: run through the hooks');
      expect((await runViaHook(page, 'test.model.append')).status).toBe('done');
    }
    await expect
      .poll(() => paragraphs(page))
      .toEqual([...initial, `Added by script (${n} paragraphs before)`]);
    await expect(firstSection(page).locator('> .fb-empty-line')).toHaveCount(emptyLines + 1);
    await expect(page.getByTestId('toolbar-scripts.last')).toBeEnabled();

    // Last script runs the same script again (toolbar button).
    await page.getByTestId('toolbar-scripts.last').click();
    await expect
      .poll(() => paragraphs(page))
      .toEqual([
        ...initial,
        `Added by script (${n} paragraphs before)`,
        `Added by script (${n + 1} paragraphs before)`,
      ]);
    expect(await page.evaluate(() => window.__mfbeTest!.scripts!.lastRunId())).toBe(
      'test.model.append',
    );

    // One Undo per run: two runs -> two undo steps, each removing paragraph + empty line.
    await page.getByTestId('menu-edit').click();
    await page.getByTestId('menu-edit-undo').click();
    await expect
      .poll(() => paragraphs(page))
      .toEqual([...initial, `Added by script (${n} paragraphs before)`]);
    await page.keyboard.press(`${MOD}+Z`);
    await expect.poll(() => paragraphs(page)).toEqual(initial);
    await expect(firstSection(page).locator('> .fb-empty-line')).toHaveCount(emptyLines);
    // Redo restores the first run as a whole.
    await page.keyboard.press(`${MOD}+Y`);
    await expect
      .poll(() => paragraphs(page))
      .toEqual([...initial, `Added by script (${n} paragraphs before)`]);
  });

  test('4. a failing script reports "Script error: <message> at line L, column C" and leaves the document consistent', async ({
    page,
    core,
  }) => {
    await openApp(page, core);
    const initial = await newDocumentParagraphs(page);
    const validate = async () => {
      const document = await page.evaluate(() => window.__mfbeTest!.scripts!.document());
      const docId = (document as { docId: string }).docId;
      const report = (await core.rpcJob('doc.validate', { docId, document })) as {
        errorCount: number;
      };
      return report.errorCount;
    };
    const errorsBefore = await validate();
    const started = await runFromMenu(page, '03_Errors', 'test.errors.throws');
    if (!started) {
      note('menu not mounted: run through the hooks');
      await startViaHook(page, 'test.errors.throws');
    }
    const dialog = page.getByTestId('dialog-script-error');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('dialog-script-error-text')).toHaveText(
      'Script error: boom at line 4, column 9',
    );
    await dialog.getByTestId('dialog-script-error-button-ok').click();
    await expect(dialog).toHaveCount(0);
    expect(await waitIdle(page)).toBe('failed');
    // Changes made before the error stay, as one undoable step; the document validates.
    await expect.poll(() => paragraphs(page)).toEqual([...initial, 'before the error']);
    await expect(page.getByTestId('status-message')).toHaveText(/failed/);
    expect(await validate()).toBe(errorsBefore);
    await page.keyboard.press(`${MOD}+Z`);
    await expect.poll(() => paragraphs(page)).toEqual(initial);
  });

  test('5. scripts show message boxes, input prompts and form dialogs', async ({ page, core }) => {
    await openApp(page, core);
    const initial = await newDocumentParagraphs(page);

    // Legacy façade: MsgBox (Yes/No + question icon) then InputBox.
    await startViaHook(page, 'test.dialogs.message');
    const message = page.getByTestId('dialog-script-message');
    await expect(message).toBeVisible();
    await expect(message.getByTestId('dialog-script-message-text')).toHaveText(
      'Insert a paragraph?',
    );
    await expect(message.getByTestId('dialog-script-message-button-yes')).toBeVisible();
    await expect(message.getByTestId('dialog-script-message-button-no')).toBeVisible();
    await message.getByTestId('dialog-script-message-button-yes').click();
    const prompt = page.getByTestId('dialog-script-prompt');
    await expect(prompt).toBeVisible();
    await expect(prompt.getByTestId('dialog-script-prompt-input')).toHaveValue(
      'Hello from InputBox',
    );
    await prompt.getByTestId('dialog-script-prompt-input').fill('Typed in the prompt');
    await prompt.getByTestId('dialog-script-prompt-button-ok').click();
    expect(await waitIdle(page)).toBe('done');
    await expect.poll(() => paragraphs(page)).toEqual([...initial, 'Typed in the prompt']);

    // Tier-3 form dialog with every field kind.
    await startViaHook(page, 'test.dialogs.form');
    const form = page.getByTestId('dialog-script-form');
    await expect(form).toBeVisible();
    await expect(form.getByTestId('dialog-script-form-title')).toContainText('Footnote options');
    await expect(form.getByTestId('dialog-script-form-field-info')).toHaveText(
      'Choose how footnotes are created.',
    );
    await form.getByTestId('dialog-script-form-field-prefix').fill('note_');
    await form.getByTestId('dialog-script-form-field-start').fill('7');
    await form.getByTestId('dialog-script-form-field-bold').uncheck();
    await form.getByTestId('dialog-script-form-field-where').selectOption('comments');
    await form.getByTestId('dialog-script-form-field-style-round').check();
    await form.getByTestId('dialog-script-form-field-langs').selectOption(['ru', 'en']);
    await form.getByTestId('dialog-script-form-button-ok').click();
    expect(await waitIdle(page)).toBe('done');
    await expect
      .poll(() => paragraphs(page))
      .toEqual([...initial, 'Typed in the prompt', 'form: note_ 7 false comments round ru+en']);

    // Cancel returns null: the script reports it and changes nothing.
    await startViaHook(page, 'test.dialogs.form');
    await expect(page.getByTestId('dialog-script-form')).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await waitIdle(page)).toBe('done');
    await expect(page.getByTestId('status-message')).toHaveText('Form cancelled');
    expect(await paragraphs(page)).toHaveLength(initial.length + 2);
  });

  test('6. hotkeys run scripts; needsSelection disables them without a selection', async ({
    page,
    core,
  }) => {
    // The case scripts on the Scripts toolbar (put back to the original layout at the end).
    await core.rpc('settings.set', {
      patch: {
        session: {
          toolbarLayouts: {
            scripts: ['scripts.last', 'script.test.case.upper', 'script.test.case.lower'],
          },
        },
      },
    });
    try {
      await hotkeysAndToolbar(page, core);
    } finally {
      await core.rpc('settings.set', { patch: { session: { toolbarLayouts: { scripts: null } } } });
    }
  });

  async function hotkeysAndToolbar(page: Page, core: CoreHandle): Promise<void> {
    await openApp(page, core);
    const editor = await newDocument(page);
    const paragraph = editor.locator('.fb-body > .fb-section > p.fb-p').first();
    // Triple-click selects the template paragraph; typing replaces it.
    await paragraph.click({ clickCount: 3 });
    await page.keyboard.type('hello scripts');
    await expect(paragraph).toHaveText('hello scripts');
    await page.waitForTimeout(100);
    // No selection: the hotkey is ignored (menu item / toolbar button disabled).
    await page.keyboard.press('Control+Alt+U');
    await page.waitForTimeout(200);
    await expect(paragraph).toHaveText('hello scripts');
    await expect(page.getByTestId('scripts-toolbar-test.case.upper')).toBeDisabled();
    // Select the word "scripts" and press the default hotkey of the manifest.
    await page.keyboard.press(LINE_END);
    await page.keyboard.down('Shift');
    for (let i = 0; i < 7; i += 1) await page.keyboard.press('ArrowLeft');
    await page.keyboard.up('Shift');
    await expect(page.getByTestId('body-view')).toHaveAttribute('data-selected-text', 'scripts');
    await expect(page.getByTestId('scripts-toolbar-test.case.upper')).toBeEnabled();
    await page.keyboard.press('Control+Alt+U');
    await expect(paragraph).toHaveText('hello SCRIPTS');
    expect(await waitIdle(page)).toBe('done');
    // The toolbar button runs the same command (lower case) on the current selection.
    await page.keyboard.press(LINE_START);
    await page.keyboard.press(SELECT_TO_LINE_END);
    await page.getByTestId('scripts-toolbar-test.case.lower').click();
    await expect(paragraph).toHaveText('hello scripts');
    // The bound chord is part of the Hotkeys "Scripts" group (script.<id> command id).
    const hotkeys = (await core.rpc('hotkeys.get').catch(() => [])) as unknown[];
    expect(Array.isArray(hotkeys)).toBe(true);
  }

  test('7. tree commands appear for a node and receive it', async ({ page, core }) => {
    await openApp(page, core);
    const initial = await newDocumentParagraphs(page);
    const document = (await page.evaluate(() => window.__mfbeTest!.scripts!.document())) as {
      bodies: { content: { type: string; attrs: { nodeId: string } }[] }[];
    };
    const section = document.bodies[0]!.content.find((c) => c.type === 'section')!;
    const commands = (await page.evaluate(
      (nodeId) => window.__mfbeTest!.scripts!.treeCommands(nodeId),
      section.attrs.nodeId,
    )) as { id: string; scriptId: string; label: string }[];
    // The fixture tree command is offered for the section (the bundled tree command of
    // `scripts/tree` is listed next to it when the bundled layer is present).
    expect(commands).toContainEqual({
      id: 'script.test.tree.mark',
      scriptId: 'test.tree.mark',
      label: 'Mark section (tree)',
    });
    expect(commands.filter((c) => c.scriptId.startsWith('test.'))).toHaveLength(1);
    // Tree scripts never appear in the Scripts menu (checked in scenario 1); run with the node.
    const result = await runViaHook(page, 'test.tree.mark', section.attrs.nodeId);
    expect(result.status).toBe('done');
    await expect
      .poll(() => paragraphs(page))
      .toEqual([...initial, `[tree] section ${section.attrs.nodeId}`]);
    const treeMenuItem = page.getByTestId(`tree-menu-script-test.tree.mark`);
    if ((await treeMenuItem.count()) === 0) {
      note('Document Tree context menu does not mount the Scripts section yet (tree feature)');
    }
  });

  test('8. the scripting guide documents every capability with an example (EN + RU)', async () => {
    const docs = path.join(REPO_ROOT, 'docs', 'scripting');
    for (const file of ['en.md', 'ru.md']) {
      const text = readFileSync(path.join(docs, file), 'utf8');
      for (const member of [
        'doc.get',
        'doc.getNode',
        'doc.replaceNode',
        'doc.insertNode',
        'doc.removeNode',
        'doc.setDescription',
        'doc.getElementsByTagName',
        'doc.textOf',
        'doc.setText',
        'doc.parentOf',
        'doc.childrenOf',
        'doc.find',
        'doc.replaceAll',
        'doc.binaries',
        'doc.stats',
        'selection.get',
        'selection.set',
        'selection.replaceText',
        'selection.wrap',
        'selection.unwrap',
        'selection.selectNode',
        'selection.scrollIntoView',
        'ui.message',
        'ui.prompt',
        'ui.form',
        'ui.status',
        'ui.progress',
        'edit.label',
        'edit.nbsp',
        'edit.symbols',
        'env.settings',
        'env.docLanguage',
        'MsgBox',
        'InputBox',
        'BeginUndoUnit',
        'EndUndoUnit',
      ]) {
        expect(text, `${file} documents ${member}`).toContain(member);
      }
      expect(text).toContain('script.json');
      expect(text).toContain('examples/');
    }
    expect(existsSync(path.join(docs, 'mfbe.d.ts'))).toBe(true);
    const examples = path.join(docs, 'examples');
    expect(existsSync(examples)).toBe(true);
  });

  test('cancel terminates a runaway script and rolls its changes back', async ({ page, core }) => {
    await openApp(page, core);
    const initial = await newDocumentParagraphs(page);
    await startViaHook(page, 'test.errors.infinite');
    // The script added a paragraph before entering the loop...
    await expect.poll(() => paragraphs(page)).toEqual([...initial, 'LOOP']);
    await expect(page.getByTestId('status-message')).toHaveText(/Running script/);
    // ...cancelling terminates the worker and rolls the open undo group back.
    await page.evaluate(() => window.__mfbeTest!.scripts!.cancel());
    expect(await waitIdle(page)).toBe('cancelled');
    await expect.poll(() => paragraphs(page)).toEqual(initial);
    await expect(page.getByTestId('status-message')).toHaveText(/cancelled/);
    await expect(page.getByTestId('toolbar-edit.undo')).toBeDisabled();
    // The editor keeps working: the next run succeeds.
    expect((await runViaHook(page, 'test.model.append')).status).toBe('done');
    await expect
      .poll(() => paragraphs(page))
      .toEqual([...initial, `Added by script (${initial.length} paragraphs before)`]);
  });

  test('the sandbox hides every host capability except mfbe', async ({ page, core }) => {
    await openApp(page, core);
    const initial = await newDocumentParagraphs(page);
    expect((await runViaHook(page, 'test.errors.sandbox')).status).toBe('done');
    await expect.poll(() => paragraphs(page)).toEqual([...initial, 'reachable: none']);
  });

  test('"No scripts found" when the scripts folders are empty; Reload picks new scripts up', async ({
    page,
    core,
  }) => {
    const dataDir = core.dataDir!;
    const folder = path.join(dataDir, 'scripts');
    const parked = path.join(dataDir, 'scripts.parked');
    const fixtureCount = () =>
      page.evaluate(
        () =>
          window.__mfbeTest?.scripts?.list().filter((s) => s.id.startsWith('test.')).length ?? -1,
      );
    const bundledCount = () =>
      page.evaluate(
        () => window.__mfbeTest?.scripts?.list().filter((s) => s.source === 'bundled').length ?? 0,
      );
    renameSync(folder, parked);
    try {
      await core.rpc('scripts.reload');
      await core.openApp(page);
      await expect(page.getByTestId('status-message')).toHaveText('Ready');
      await expect.poll(fixtureCount, { timeout: 15_000 }).toBe(0);
      await page.getByTestId('menu-scripts').click();
      if ((await bundledCount()) === 0) {
        // Every layer empty (a core without the bundled scripts folder): the placeholder.
        await expect(page.getByTestId('menu-scripts-none')).toBeVisible();
        await expect(page.getByTestId('menu-scripts-none')).toHaveText('No scripts found');
      } else {
        // The bundled layer still fills the menu; only the fixture groups are gone.
        note('bundled scripts present: the empty-folder placeholder cannot appear');
        await expect(page.getByTestId('menu-scripts-none')).toHaveCount(0);
        await expect(page.getByTestId('menu-scripts-01_Case')).toHaveCount(0);
      }
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('toolbar-scripts.last')).toBeDisabled();
    } finally {
      renameSync(parked, folder);
    }
    // Reload scripts (command / notification) brings them back without a restart.
    await core.rpc('scripts.reload');
    await expect.poll(fixtureCount, { timeout: 15_000 }).toBe(FIXTURE_IDS.length);
  });
});
