/**
 * Feature 008, User Story 3 (T036, T037): the 0.0.5 sequences of footnote and comment
 * insertions between existing ones, replayed in one session (spec Behavioural reference 3,
 * SC-003, SC-004). After every run: the run is done, the footnotes are numbered 1..N in text
 * order, every element name is unique, and the page answers at once. A script that loops keeps
 * the page answering, and Cancel ends it with the book unchanged (FR-023).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';

interface ModelNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: ModelNode[];
}

interface Model {
  bodies: ModelNode[];
}

// The page's test hooks (ui/src/scripting/testHooks.ts), as the journey sees them.
declare const window: {
  __mfbeTest?: {
    runScript(id: string): Promise<{ status: string; message?: string }>;
    scripts?: {
      document(): unknown;
      select(nodeId: string, from?: number, to?: number): boolean;
      refresh(): Promise<void>;
      toXml(): Promise<string>;
      state(): unknown;
      cancel(): void;
    };
  };
};

async function openBook(core: CoreHandle, page: Page, name: string): Promise<void> {
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText('Ready');
  await core.enqueueDialog('dialog.openFile', { paths: [fixtureBook(name)] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, name);
}

function model(page: Page): Promise<Model> {
  return page.evaluate(() => window.__mfbeTest!.scripts!.document() as Model);
}

function walk(node: ModelNode, visit: (node: ModelNode) => void): void {
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
}

/** Every element name of the bodies, in document order. */
function nodeIds(doc: Model): string[] {
  const ids: string[] = [];
  for (const body of doc.bodies) {
    walk(body, (n) => {
      if (typeof n.attrs?.nodeId === 'string') ids.push(n.attrs.nodeId);
    });
  }
  return ids;
}

/** The text of the note links of the main body (`type` note or comment), in text order. */
function noteLinks(doc: Model, kind: 'note' | 'comment'): string[] {
  const texts: string[] = [];
  const main = doc.bodies.find((b) => !b.attrs?.name) ?? doc.bodies[0];
  if (!main) return texts;
  walk(main, (n) => {
    const link = n.marks?.find((m) => m.type === 'link' && m.attrs?.type === kind);
    if (link && n.text) texts.push(n.text);
  });
  return texts;
}

/**
 * Text paragraphs of the main body (titles left out) from the first to the last that holds a
 * note link: an insertion at the start of one lands between existing notes (the reporter's case).
 */
function paragraphsBetweenNotes(doc: Model, kind: 'note' | 'comment'): string[] {
  const main = doc.bodies.find((b) => !b.attrs?.name) ?? doc.bodies[0];
  const paragraphs: { id: string; hasNote: boolean }[] = [];
  const visit = (n: ModelNode, inTitle: boolean) => {
    if (n.type === 'p' && !inTitle && typeof n.attrs?.nodeId === 'string') {
      let hasNote = false;
      walk(n, (c) => {
        if (c.marks?.some((m) => m.type === 'link' && m.attrs?.type === kind)) hasNote = true;
      });
      paragraphs.push({ id: n.attrs.nodeId, hasNote });
      return;
    }
    for (const child of n.content ?? []) visit(child, inTitle || n.type === 'title');
  };
  if (main) visit(main, false);
  const first = paragraphs.findIndex((p) => p.hasNote);
  const last = paragraphs.map((p) => p.hasNote).lastIndexOf(true);
  const between = first >= 0 ? paragraphs.slice(first + 1, last + 1) : [];
  return (between.length > 0 ? between : paragraphs).map((p) => p.id);
}

/** Milliseconds until the page's main thread runs a task (FR-024: "answers within 100 ms"). */
function answerTime(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const started = performance.now();
        setTimeout(() => resolve(performance.now() - started), 0);
      }),
  );
}

async function insertAt(page: Page, nodeId: string, script: string): Promise<string> {
  const selected = await page.evaluate(
    (id) => window.__mfbeTest!.scripts!.select(id, 1, 1),
    nodeId,
  );
  expect(selected, `the paragraph ${nodeId} is shown`).toBe(true);
  const result = await page.evaluate((id) => window.__mfbeTest!.runScript(id), script);
  expect(result.status, result.message ?? '').toBe('done');
  return result.status;
}

async function checkAfterRun(page: Page, kind: 'note' | 'comment'): Promise<void> {
  const doc = await model(page);
  const ids = nodeIds(doc);
  expect(new Set(ids).size, 'every element name is unique').toBe(ids.length);
  const numbers = noteLinks(doc, kind).map((t) => Number(/\d+/.exec(t)?.[0] ?? NaN));
  expect(numbers, 'numbered 1..N in text order').toEqual(numbers.map((_, i) => i + 1));
  expect(await answerTime(page)).toBeLessThan(100);
}

async function sequence(
  page: Page,
  scripts: string[],
  kind: 'note' | 'comment',
  runs: number,
): Promise<void> {
  for (let i = 0; i < runs; i += 1) {
    const candidates = paragraphsBetweenNotes(await model(page), kind);
    const target = candidates[(i * 7) % candidates.length]!;
    await insertAt(page, target, scripts[i % scripts.length]!);
    await checkAfterRun(page, kind);
  }
}

test.describe('US3: footnotes and comments between existing ones, any number of times', () => {
  test.setTimeout(240_000);

  test('twenty footnotes between six existing ones, both footnote scripts', async ({
    core,
    page,
  }) => {
    await openBook(core, page, 'notes-6.fb2');
    await sequence(page, ['02/add-footnote', '02/add-footnote-go-to-note'], 'note', 20);
    expect(noteLinks(await model(page), 'note')).toHaveLength(26);
  });

  test('go to its section, again and again, in a book without notes (the 0.0.5 freeze)', async ({
    core,
    page,
  }) => {
    await openBook(core, page, 'notes-none.fb2');
    await sequence(page, ['02/add-footnote-go-to-note'], 'note', 10);
  });

  test('twenty comments in a book without comments', async ({ core, page }) => {
    await openBook(core, page, 'notes-none.fb2');
    await sequence(page, ['03/add-comment', '03/add-comment-go-to-comment'], 'comment', 20);
  });

  test('five footnotes between existing ones of a book with 400', async ({ core, page }) => {
    await openBook(core, page, 'notes-400.fb2');
    await sequence(page, ['02/add-footnote', '02/add-footnote-go-to-note'], 'note', 5);
    expect(noteLinks(await model(page), 'note')).toHaveLength(405);
  });

  test('a script that loops keeps the page answering; Cancel leaves the book unchanged', async ({
    core,
    testCore,
    page,
  }) => {
    const dataDir = testCore.dataDir;
    test.skip(!dataDir, 'needs the test core');
    const dir = path.join(dataDir!, 'scripts', '99_smoke', '01_loop');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'script.json'),
      JSON.stringify({
        manifestVersion: 1,
        id: '99/loop',
        name: { en: 'Loop', ru: 'Цикл', uk: 'Цикл' },
        kind: 'menu',
        entry: 'index.js',
      }),
    );
    writeFileSync(path.join(dir, 'index.js'), 'while (true) {}\n');
    await openBook(core, page, 'notes-6.fb2');
    await page.evaluate(() => window.__mfbeTest!.scripts!.refresh());
    const before = await page.evaluate(() => window.__mfbeTest!.scripts!.toXml());
    await page.evaluate(() => {
      void window.__mfbeTest!.runScript('99/loop');
    });
    await expect
      .poll(() => page.evaluate(() => window.__mfbeTest!.scripts!.state()))
      .not.toBeNull();
    expect(await answerTime(page)).toBeLessThan(100);
    await expect(page.getByTestId('script-run-banner')).toBeVisible();
    await page.evaluate(() => window.__mfbeTest!.scripts!.cancel());
    await expect
      .poll(() =>
        page.evaluate(
          () => (window.__mfbeTest!.scripts!.state() as { status?: string } | null)?.status,
        ),
      )
      .toBe('cancelled');
    expect(await page.evaluate(() => window.__mfbeTest!.scripts!.toXml())).toBe(before);
  });
});
