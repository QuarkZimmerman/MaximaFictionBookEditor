/**
 * User Story 1 (feature 004) - the Document Tree pane can be made narrower or wider (FR-001 to
 * FR-004, SC-001; research R1.1): a divider between the pane and the view area, dragged with
 * the mouse, lays both sides out again live; the pane stops at 160 px, the view at 320 px; a
 * stored width the window cannot show is clamped, never lost; View > Document Tree removes the
 * divider; the divider works while a script runs; the width is written with the session
 * settings - before a quit right after the drag - and is back at the next start. The `@perf`
 * part times every layout step of a synthetic drag on the generated 10 MB book.
 *
 * Every test runs a core of its own on its own data folder (the width is a stored session
 * setting that must not reach the other journeys of the worker). Runs in the English, Russian
 * and Ukrainian projects: the Ukrainian view switcher is the widest, so the 320 px minimum is
 * proved where it matters. Needs the real core and `python3`; skipped otherwise.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import {
  expect,
  NodeRpcClient,
  startCoreWith,
  test,
  waitForBook,
  waitForStartupDocument,
  withUiLang,
} from './fixtures/core';
import { pageText, type UiLang } from './fixtures/i18n';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const GENERATOR = path.join(REPO_ROOT, 'tests', 'fixtures', 'gen-large-book.py');
const SCRIPT_FIXTURES = path.join(REPO_ROOT, 'tests', 'scripts', 'fixtures');

/** The minimums of `ui/src/app/splitter.ts` (data-model §1) and the divider's own width. */
const PANE_MIN = 160;
const VIEW_MIN = 320;
const DIVIDER_W = 6;
/** The width of release 0.0.3, the default of `session.treeWidth`. */
const DEFAULT_WIDTH = 260;
/** FR-001: a layout step of the drag on the 10 MB book, on a 2020-era laptop. */
const LAYOUT_STEP_BUDGET_MS = 100;
/** Allowance for the hosted CI runners (docs/performance.md). */
const PERF_FACTOR = Number(process.env.MFBE_PERF_FACTOR ?? 2) || 2;

interface ScriptHooks {
  list(): { id: string }[];
  run(id: string): Promise<unknown>;
}

declare const window: { __mfbeTest?: { scripts?: ScriptHooks } };

/* ------------------------------------------------------------------------ */
/* A core of the test's own                                                 */
/* ------------------------------------------------------------------------ */

interface OwnCore {
  url: string;
  dataDir: string;
  rpc: NodeRpcClient;
  /** Stops the core (or lets a quit one go) and starts it again on the same data folder. */
  restart(): Promise<void>;
  stop(): Promise<void>;
}

async function ownCore(scriptGroups: readonly string[] = []): Promise<OwnCore> {
  const binary = process.env.MFBE_CORE_BIN!;
  const dataDir = mkdtempSync(path.join(tmpdir(), 'mfbe-us1-divider-'));
  for (const group of scriptGroups) {
    cpSync(path.join(SCRIPT_FIXTURES, group), path.join(dataDir, 'scripts', group), {
      recursive: true,
    });
  }
  const connect = async () => {
    const started = await startCoreWith(binary, dataDir, []);
    const url = new URL(started.url);
    const rpc = new NodeRpcClient(
      `ws://127.0.0.1:${url.port}/rpc?token=${url.searchParams.get('token') ?? ''}`,
    );
    return { ...started, rpc };
  };
  let current = await connect();
  const own: OwnCore = {
    url: current.url,
    dataDir,
    rpc: current.rpc,
    async restart() {
      current.rpc.close();
      await current.stop();
      current = await connect();
      own.url = current.url;
      own.rpc = current.rpc;
    },
    async stop() {
      current.rpc.close();
      await current.stop();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
  return own;
}

async function openOwn(page: Page, core: OwnCore, lang: UiLang | undefined): Promise<void> {
  await page.goto(withUiLang(core.url, lang));
  await waitForStartupDocument(page);
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
  await expect(page.getByTestId('tree-panel')).toHaveAttribute('data-tree-width', /^\d+$/);
}

async function openBook(page: Page, core: OwnCore, file: string, timeout = 30_000): Promise<void> {
  await core.rpc.call('test.enqueueDialog', {
    method: 'dialog.openFile',
    result: { paths: [file] },
  });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file, timeout);
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true', {
    timeout,
  });
  await expect(page.getByTestId('body-editor').locator('.fb-section p.fb-p').first()).toBeVisible({
    timeout,
  });
}

/** `session.treeWidth` as written to the core's settings.json (null before the first write). */
function storedTreeWidth(core: OwnCore): number | null {
  const file = path.join(core.dataDir, 'settings.json');
  if (!existsSync(file)) return null;
  const settings = JSON.parse(readFileSync(file, 'utf8')) as {
    session?: { treeWidth?: number };
  };
  return settings.session?.treeWidth ?? null;
}

/* ------------------------------------------------------------------------ */
/* Measuring                                                                */
/* ------------------------------------------------------------------------ */

interface Box {
  left: number;
  right: number;
  width: number;
  top: number;
  bottom: number;
}

interface Layout {
  pane: Box | null;
  /** The committed width (`data-tree-width` of the pane), null without the pane. */
  treeWidth: string | null;
  divider: Box | null;
  view: Box;
  main: Box;
  /** The document root carries `mfbe-resizing` (a drag goes on). */
  resizing: boolean;
  rootCursor: string;
}

// In-page snippets touching the DOM are string expressions: the e2e tsconfig has no DOM lib.
const LAYOUT = `(() => {
  const box = (element) => {
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width, top: r.top, bottom: r.bottom };
  };
  const byId = (id) => document.querySelector('[data-testid="' + id + '"]');
  const pane = byId('tree-panel');
  return {
    pane: box(pane),
    treeWidth: pane ? pane.getAttribute('data-tree-width') : null,
    divider: box(byId('tree-splitter')),
    view: box(byId('view-area')),
    main: box(document.querySelector('.mfbe-main')),
    resizing: document.documentElement.classList.contains('mfbe-resizing'),
    rootCursor: getComputedStyle(document.documentElement).cursor,
  };
})()`;

const layout = (page: Page) => page.evaluate<Layout>(LAYOUT);

/**
 * Test ids of the controls of the pane (caption, toolbar and its buttons, the scrolling list)
 * and of the view switcher's tabs that stick out of their container (SC-001: none may).
 */
const OUTSIDE = `(() => {
  const byId = (id) => document.querySelector('[data-testid="' + id + '"]');
  const within = (inner, outer) =>
    inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5;
  const out = [];
  const pane = byId('tree-panel');
  if (pane) {
    const paneBox = pane.getBoundingClientRect();
    const selector = '[data-testid="panel-tree-caption"], [data-testid="tree-toolbar"], ' +
      '[data-testid^="tree-toolbar-"], [data-testid="tree-content"]';
    for (const element of pane.querySelectorAll(selector)) {
      if (!within(element.getBoundingClientRect(), paneBox)) out.push(element.getAttribute('data-testid'));
    }
  }
  const view = byId('view-area').getBoundingClientRect();
  for (const tab of document.querySelectorAll('[data-testid="view-switcher"] [role="tab"]')) {
    if (!within(tab.getBoundingClientRect(), view)) out.push(tab.getAttribute('data-testid'));
  }
  return out;
})()`;

const outside = (page: Page) => page.evaluate<string[]>(OUTSIDE);

/** Heights of the view switcher's tabs: a tab whose text wrapped onto two lines grows. */
const TAB_HEIGHTS = `Array.from(
  document.querySelectorAll('[data-testid="view-switcher"] [role="tab"]'),
  (tab) => Math.round(tab.getBoundingClientRect().height),
)`;

const tabHeights = (page: Page) => page.evaluate<number[]>(TAB_HEIGHTS);

/** Height of the element `testId` (its content, not its scrolling box). */
const heightOf = (page: Page, testId: string) =>
  page.evaluate<number>(
    `document.querySelector('[data-testid="${testId}"]').getBoundingClientRect().height`,
  );

const widthOf = (page: Page, selector: string) =>
  page.evaluate<number>(
    `document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().width`,
  );

/** SC-001: within 1 px. */
function expectNear(actual: number, expected: number, what: string): void {
  expect(Math.abs(actual - expected), `${what}: ${actual} vs ${expected}`).toBeLessThanOrEqual(1);
}

/**
 * Drags the divider by `dx` px with the mouse: pressed at its middle, moved in steps, released.
 * `during` runs half-way with the button still down.
 */
async function dragDivider(page: Page, dx: number, during?: () => Promise<void>): Promise<void> {
  const box = await page.getByTestId('tree-splitter').boundingBox();
  if (!box) throw new Error('the divider is not shown');
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(box.height / 2, 200);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 5 });
  if (during) await during();
  await page.mouse.move(x + dx, y, { steps: 5 });
  await page.mouse.up();
}

/** Drags the divider to the page x `target` (the clamp decides where it stops). */
async function dragDividerTo(page: Page, target: number): Promise<void> {
  const box = await page.getByTestId('tree-splitter').boundingBox();
  if (!box) throw new Error('the divider is not shown');
  await dragDivider(page, target - (box.x + box.width / 2));
}

/**
 * Checks a drag of `dx` px in the shown view: the pane `dx` wider, the view `dx` narrower
 * (within 1 px), the committed width on the pane, no control outside its side; then the drag
 * back restores both widths.
 */
async function checkDragInView(page: Page, dx: number, viewContent: string): Promise<void> {
  const before = await layout(page);
  const contentBefore = await widthOf(page, viewContent);
  await dragDivider(page, dx);
  const after = await layout(page);
  expectNear(after.pane!.width, before.pane!.width + dx, 'pane width after the drag');
  expectNear(after.view.width, before.view.width - dx, 'view width after the drag');
  expectNear(await widthOf(page, viewContent), contentBefore - dx, `${viewContent} width`);
  await expect(page.getByTestId('tree-panel')).toHaveAttribute(
    'data-tree-width',
    String(Math.round(before.pane!.width + dx)),
  );
  expect(await outside(page)).toEqual([]);
  await dragDivider(page, -dx);
  const back = await layout(page);
  expectNear(back.pane!.width, before.pane!.width, 'pane width after the drag back');
  expectNear(back.view.width, before.view.width, 'view width after the drag back');
}

/* ------------------------------------------------------------------------ */
/* Journeys                                                                 */
/* ------------------------------------------------------------------------ */

let dir = '';
let book = '';

test.beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us1-books-'));
  book = path.join(dir, 'prose-1mb.fb2');
  const result = spawnSync('python3', [GENERATOR, '--out', book, '--size-mb', '1'], {
    encoding: 'utf8',
  });
  if (result.status !== 0 || !existsSync(book)) book = '';
});

test.afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

test.describe('US1 - the Document Tree pane has a divider', () => {
  let core: OwnCore | null = null;

  test.beforeEach(({ core: shared }) => {
    test.skip(!shared.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!book, 'python3 / the book generator are not available');
  });

  test.afterEach(async () => {
    await core?.stop();
    core = null;
  });

  test('1. a drag moves the pane and the view by N px in the Body, Description and Source views', async ({
    page,
    uiLang,
  }) => {
    core = await ownCore();
    await openOwn(page, core, uiLang);
    await openBook(page, core, book);
    const divider = page.getByTestId('tree-splitter');
    await expect(divider).toHaveCSS('cursor', 'col-resize');
    await expect(divider).toHaveAttribute('role', 'separator');
    await expect(divider).toHaveAttribute('aria-label', await pageText(page, 'tree.splitter'));
    const start = await layout(page);
    expectNear(start.pane!.width, DEFAULT_WIDTH, 'the default pane width');
    expectNear(start.divider!.width, DIVIDER_W, 'the divider width');
    expect(start.treeWidth).toBe(String(DEFAULT_WIDTH));
    expect(start.resizing).toBe(false);
    expect(await outside(page)).toEqual([]);

    // Body view: +100 px with the resize cursor on the root while the button is down; the
    // text of the narrower view is re-wrapped (its paragraphs take more height).
    const heightBefore = await heightOf(page, 'body-editor');
    await dragDivider(page, 100, async () => {
      const mid = await layout(page);
      expect(mid.resizing).toBe(true);
      expect(mid.rootCursor).toBe('col-resize');
      expect(mid.pane!.width).toBeGreaterThan(start.pane!.width + 30);
    });
    const after = await layout(page);
    expectNear(after.pane!.width, start.pane!.width + 100, 'pane width (Body view, +100)');
    expectNear(after.view.width, start.view.width - 100, 'view width (Body view, +100)');
    expectNear(after.divider!.left, after.pane!.right, 'the divider follows the pane');
    expect(after.resizing).toBe(false);
    expect(after.rootCursor).not.toBe('col-resize');
    await expect(page.getByTestId('tree-panel')).toHaveAttribute(
      'data-tree-width',
      String(DEFAULT_WIDTH + 100),
    );
    expect(await heightOf(page, 'body-editor')).toBeGreaterThan(heightBefore);
    expect(await outside(page)).toEqual([]);
    // ... and -100 px back.
    await dragDivider(page, -100);
    const back = await layout(page);
    expectNear(back.pane!.width, start.pane!.width, 'pane width (Body view, back)');
    expectNear(back.view.width, start.view.width, 'view width (Body view, back)');
    await expect(page.getByTestId('tree-panel')).toHaveAttribute(
      'data-tree-width',
      String(DEFAULT_WIDTH),
    );
    expectNear(await heightOf(page, 'body-editor'), heightBefore, 'editor height restored');

    // Description view: the form reflows with the view.
    await page.getByTestId('view-description').click();
    await expect(page.getByTestId('description-view')).toBeVisible();
    await checkDragInView(page, 100, '[data-testid="description-view"]');

    // Source view: the editor (wrapping on by default) follows the view.
    await page.getByTestId('view-source').click();
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready', {
      timeout: 60_000,
    });
    await checkDragInView(page, 100, '.mfbe-source-editor .cm-content');
  });

  test('2. the pane stops at its minimum, the view at its own; every control stays inside', async ({
    page,
    uiLang,
  }) => {
    core = await ownCore();
    await openOwn(page, core, uiLang);
    await openBook(page, core, book);
    const start = await layout(page);
    const tabsAtDefault = await tabHeights(page);
    expect(tabsAtDefault.length).toBe(3);

    // Far to the left: the pane keeps 160 px with its caption, toolbar and scrolling list
    // inside; the rows are reachable (the list's scrollbar is within the pane).
    await dragDividerTo(page, 2);
    const narrowPane = await layout(page);
    expectNear(narrowPane.pane!.width, PANE_MIN, 'pane at its minimum');
    expectNear(narrowPane.view.width, start.main.width - PANE_MIN - DIVIDER_W, 'view beside it');
    await expect(page.getByTestId('tree-panel')).toHaveAttribute('data-tree-width', `${PANE_MIN}`);
    expect(await outside(page)).toEqual([]);
    const list = await page.getByTestId('tree-content').boundingBox();
    expect(list!.x + list!.width).toBeLessThanOrEqual(narrowPane.pane!.right + 0.5);
    await expect(page.getByTestId('tree-toolbar-delete')).toBeVisible();
    await expect(page.locator('[data-testid^="tree-row-"]').first()).toBeVisible();

    // Far to the right: the view keeps 320 px; in every interface language the three tabs of
    // the view switcher stay inside it on one line, the pane takes the rest.
    await dragDividerTo(page, start.main.right - 2);
    const narrowView = await layout(page);
    expectNear(narrowView.view.width, VIEW_MIN, 'view at its minimum');
    expectNear(narrowView.pane!.width, start.main.width - VIEW_MIN - DIVIDER_W, 'pane beside it');
    await expect(page.getByTestId('tree-panel')).toHaveAttribute(
      'data-tree-width',
      String(Math.round(start.main.width - VIEW_MIN - DIVIDER_W)),
    );
    expect(await outside(page)).toEqual([]);
    expect(await tabHeights(page)).toEqual(tabsAtDefault);
    for (const view of ['description', 'body', 'source']) {
      await expect(page.getByTestId(`view-${view}`)).toBeVisible();
    }
  });

  test('3. a stored width the window cannot show is clamped, not lost; the pane shrinks, the view keeps its minimum', async ({
    page,
    uiLang,
  }) => {
    core = await ownCore();
    // The width of a larger screen, stored before this start.
    await core.rpc.call('settings.set', { patch: { session: { treeWidth: 500 } } });
    await page.setViewportSize({ width: 700, height: 600 });
    await openOwn(page, core, uiLang);
    const narrow = await layout(page);
    expectNear(narrow.view.width, VIEW_MIN, 'the view keeps its minimum');
    expectNear(narrow.pane!.width, narrow.main.width - VIEW_MIN - DIVIDER_W, 'the pane shrinks');
    expect(narrow.pane!.width).toBeLessThan(500);
    expect(narrow.treeWidth).toBe('500'); // the stored value is not rewritten by the clamp
    expect(await outside(page)).toEqual([]);

    // The window grows: the stored width is back, and the setting never changed.
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect
      .poll(async () => Math.abs((await layout(page)).pane!.width - 500) <= 1, {
        message: 'the pane gets its 500 px back',
      })
      .toBe(true);
    const wide = await layout(page);
    expectNear(wide.view.width, wide.main.width - 500 - DIVIDER_W, 'view beside the 500 px pane');
    expect(wide.treeWidth).toBe('500');
    const settings = await core.rpc.call<{ session: { treeWidth: number } }>('settings.get');
    expect(settings.session.treeWidth).toBe(500);

    // Narrower than both minimums together: the view still keeps its 320 px, the pane goes
    // under its own, and nothing is written.
    await page.setViewportSize({ width: 400, height: 600 });
    await expect
      .poll(async () => Math.abs((await layout(page)).view.width - VIEW_MIN) <= 1)
      .toBe(true);
    const tiny = await layout(page);
    expect(tiny.pane!.width).toBeLessThan(PANE_MIN);
    expect(tiny.treeWidth).toBe('500');
    expect(
      (await core.rpc.call<{ session: { treeWidth: number } }>('settings.get')).session.treeWidth,
    ).toBe(500);
  });

  test('4. View > Document Tree removes the divider and gives the view the whole width; shown again at the same width', async ({
    page,
    uiLang,
  }) => {
    core = await ownCore();
    await openOwn(page, core, uiLang);
    await dragDivider(page, 60);
    await expect(page.getByTestId('tree-panel')).toHaveAttribute(
      'data-tree-width',
      String(DEFAULT_WIDTH + 60),
    );

    await page.getByTestId('menu-view').click();
    await page.getByTestId('menu-view-tree').click();
    await expect(page.getByTestId('tree-panel')).toHaveCount(0);
    await expect(page.getByTestId('tree-splitter')).toHaveCount(0);
    const hidden = await layout(page);
    expectNear(hidden.view.width, hidden.main.width, 'the view takes the whole width');
    expectNear(hidden.view.left, hidden.main.left, 'the view starts at the left edge');

    await page.getByTestId('menu-view').click();
    await page.getByTestId('menu-view-tree').click();
    await expect(page.getByTestId('tree-panel')).toHaveAttribute(
      'data-tree-width',
      String(DEFAULT_WIDTH + 60),
    );
    const shown = await layout(page);
    expectNear(shown.pane!.width, DEFAULT_WIDTH + 60, 'the pane has the width it had');
    expectNear(shown.divider!.width, DIVIDER_W, 'the divider is back');
    expectNear(shown.view.width, shown.main.width - (DEFAULT_WIDTH + 60) - DIVIDER_W, 'the view');
    await expect(page.getByTestId('tree-splitter')).toHaveCSS('cursor', 'col-resize');
  });

  test('5. the divider works while a script runs (resizing is not a document change)', async ({
    page,
    uiLang,
  }) => {
    core = await ownCore(['06_Runs']);
    await openOwn(page, core, uiLang);
    await openBook(page, core, book);
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            (window.__mfbeTest?.scripts?.list() ?? []).some((s) => s.id === 'runs.longSilent'),
          ),
        { timeout: 15_000 },
      )
      .toBe(true);
    await page.evaluate(() => {
      void window.__mfbeTest!.scripts!.run('runs.longSilent');
    });
    const banner = page.getByTestId('script-run-banner');
    await expect(banner).toBeVisible();
    await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'false');

    const before = await layout(page);
    await dragDivider(page, 100);
    const after = await layout(page);
    expectNear(after.pane!.width, before.pane!.width + 100, 'pane width during the run');
    expectNear(after.view.width, before.view.width - 100, 'view width during the run');
    await expect(page.getByTestId('tree-panel')).toHaveAttribute(
      'data-tree-width',
      String(Math.round(before.pane!.width + 100)),
    );
    await expect(banner).toBeVisible(); // the run goes on

    await banner.getByTestId('script-run-cancel').click();
    await expect(banner).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
  });

  test('6. the width is stored before a quit right after the drag and is back at the next start', async ({
    page,
    uiLang,
  }) => {
    core = await ownCore();
    await openOwn(page, core, uiLang);
    expect(storedTreeWidth(core)).toBeNull();
    await dragDivider(page, 90);
    await expect(page.getByTestId('tree-panel')).toHaveAttribute(
      'data-tree-width',
      String(DEFAULT_WIDTH + 90),
    );

    // File > Exit at once: the pending session save goes out before app.quit (FR-003).
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-exit').click();
    await expect.poll(() => storedTreeWidth(core!), { timeout: 15_000 }).toBe(DEFAULT_WIDTH + 90);

    // A second core on the same data folder: the width is reported and rendered.
    await core.restart();
    const settings = await core.rpc.call<{ session: { treeWidth: number } }>('settings.get');
    expect(settings.session.treeWidth).toBe(DEFAULT_WIDTH + 90);
    await openOwn(page, core, uiLang);
    await expect(page.getByTestId('tree-panel')).toHaveAttribute(
      'data-tree-width',
      String(DEFAULT_WIDTH + 90),
    );
    const restarted = await layout(page);
    expectNear(restarted.pane!.width, DEFAULT_WIDTH + 90, 'pane width after the restart');
    expectNear(
      restarted.view.width,
      restarted.main.width - (DEFAULT_WIDTH + 90) - DIVIDER_W,
      'view width after the restart',
    );
  });
});

/* ------------------------------------------------------------------------ */
/* Timing (SC-001, FR-001)                                                  */
/* ------------------------------------------------------------------------ */

/**
 * A synthetic drag in the page: `pointerdown` on the divider, then `steps` `pointermove`s of
 * `dx` px, each timed from its dispatch through the animation frame that lays the panes out to
 * a forced layout read; `pointerup` at the end. Playwright's mouse would add its own round
 * trips to every step, so the timing loop runs inside the page (research R1.1 §6).
 */
const dragTimed = (steps: number, dx: number) => `(async (steps, dx) => {
  const byId = (id) => document.querySelector('[data-testid="' + id + '"]');
  const divider = byId('tree-splitter');
  const pane = byId('tree-panel');
  const view = byId('view-area');
  const box = divider.getBoundingClientRect();
  const clientY = box.top + 100;
  let clientX = box.left + box.width / 2;
  const event = (type) =>
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: type === 'pointermove' ? -1 : 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX,
      clientY,
    });
  const widths = () => ({
    pane: pane.getBoundingClientRect().width,
    view: view.getBoundingClientRect().width,
  });
  const before = widths();
  divider.dispatchEvent(event('pointerdown'));
  const times = [];
  for (let i = 0; i < steps; i += 1) {
    clientX += dx;
    const t0 = performance.now();
    divider.dispatchEvent(event('pointermove'));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    void document.body.offsetWidth;
    times.push(performance.now() - t0);
  }
  const during = widths();
  divider.dispatchEvent(event('pointerup'));
  return { times, before, during, after: widths() };
})(${steps}, ${dx})`;

interface DragTiming {
  times: number[];
  before: { pane: number; view: number };
  during: { pane: number; view: number };
  after: { pane: number; view: number };
}

/**
 * Resolves once the Body view's background work after the open has landed: the spelling
 * highlighter decorates the mounted text a moment after the book became editable, and that
 * one transaction (thousands of marks in one frame) would be charged to whichever layout step
 * it falls into. Settled = the editor's inline elements unchanged for half a second (10 s at
 * most). Returns the number of marks.
 */
const SETTLED = `(async () => {
  const editor = document.querySelector('[data-testid="body-editor"]');
  const count = () => editor.querySelectorAll('span').length;
  let last = count();
  let stable = 0;
  for (let i = 0; i < 40 && stable < 2; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const now = count();
    stable = now === last ? stable + 1 : 0;
    last = now;
  }
  return editor.querySelectorAll('.mfbe-misspelled').length;
})()`;

test.describe('US1 - divider layout step on the 10 MB book', { tag: '@perf' }, () => {
  let perfDir = '';
  let largeBook = '';
  let core: OwnCore | null = null;

  test.beforeAll(() => {
    perfDir = mkdtempSync(path.join(tmpdir(), 'mfbe-us1-perf-'));
    largeBook = path.join(perfDir, 'large.fb2');
    const result = spawnSync('python3', [GENERATOR, '--out', largeBook, '--size-mb', '10'], {
      encoding: 'utf8',
    });
    if (result.status !== 0 || !existsSync(largeBook)) largeBook = '';
  });

  test.afterAll(() => {
    rmSync(perfDir, { recursive: true, force: true });
  });

  test.afterEach(async () => {
    await core?.stop();
    core = null;
  });

  test('every layout step of a drag stays under 100 ms', async ({ page, core: shared, uiLang }) => {
    test.skip(!shared.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!largeBook, 'python3 / the book generator are not available');
    test.skip(uiLang !== undefined, 'the timing does not depend on the interface language');
    expect(statSync(largeBook).size).toBeGreaterThan(9 * 1024 * 1024);
    core = await ownCore();
    await openOwn(page, core, uiLang);
    await openBook(page, core, largeBook, 60_000);
    const marks = await page.evaluate<number>(SETTLED);

    const steps = 20;
    const dx = 10;
    const timing = await page.evaluate<DragTiming>(dragTimed(steps, dx));
    const worst = Math.max(...timing.times);
    const typical = [...timing.times].sort((a, b) => a - b)[Math.floor(steps / 2)]!;
    test.info().annotations.push({
      type: 'perf',
      description:
        `divider layout step median ${typical.toFixed(1)} ms, worst ${worst.toFixed(1)} ms ` +
        `with ${marks} spelling marks in the mounted text ` +
        `(steps ${timing.times.map((t) => t.toFixed(0)).join(', ')} ms)`,
    });
    expect(
      worst,
      `layout steps ${timing.times.map((t) => t.toFixed(0)).join(', ')} ms`,
    ).toBeLessThan(LAYOUT_STEP_BUDGET_MS * PERF_FACTOR);
    // Both widths moved by the drag's N px (within 1 px), live and once committed.
    expectNear(timing.during.pane, timing.before.pane + steps * dx, 'pane width during the drag');
    expectNear(timing.during.view, timing.before.view - steps * dx, 'view width during the drag');
    expectNear(timing.after.pane, timing.before.pane + steps * dx, 'pane width committed');
    expectNear(timing.after.view, timing.before.view - steps * dx, 'view width committed');
    await expect(page.getByTestId('tree-panel')).toHaveAttribute(
      'data-tree-width',
      String(Math.round(timing.before.pane + steps * dx)),
    );
  });
});
