/**
 * Feature 006, User Story 3 - Pictures in table cells: the layout journey, the automated layout
 * check of SC-006 (T079; research R9 §7.2 to §7.5 as corrected by vR9 and decisions 17 to 19,
 * R9.5 "Layout journey", R9.6; quickstart §3 "Automated: the layout journey", "The gates",
 * "Report-only metrics", "Screenshots are evidence, never the gate", "Where it runs";
 * data-model §9.8, §16.4; spec FR-027, FR-028, FR-031; US3 sc.5, sc.6, sc.9; US10 sc.3's
 * display; the edge cases "a cell that holds only a picture", "images in header cells" and
 * "Fast Mode"; C55, C56, C57, U21, U38).
 *
 * Runs against the real core; skipped in core-less mode. `tables-images.fb2` (T016) follows
 * every table with its control, the same table without its pictures, and the gates of
 * `fixtures/tableLayout.ts` compare each table with its control, so they hold whatever fonts a
 * system has: the whole file also runs on macOS in the Docs build replay, and test 7
 * (`@platform`) on the Windows and macOS legs of CI. Only the sc.9 premise test depends on the
 * Linux fonts, and says so. Scroll bars are shown, as in the shell (hidden ones widen the text
 * area by 15 px and move rows by up to 105 px; with them Chromium lays the book out as the
 * shell's CEF does on Linux, research R9 §2).
 *
 * Each test sets the panes before the page loads - "first start" (the settings defaults: the
 * Document Tree 260 px, the AI panel 360 px and shown, inert while the assistant is disabled) or
 * "AI panel hidden" - opens the book through File → Open and walks its environments live: the
 * window width (1600, 1280, 1024, 800 and 640 px, the shell's minimum), the Body font, Fast Mode
 * and the theme. After each change it waits for the computed font, the Fast Mode class,
 * `html[data-theme]` and the settled pictures, measures every table and its control and expects
 * no finding; findings and the report-only metrics are attached as JSON, and a failing
 * environment attaches screenshots of up to three failing tables with their controls. With
 * `MFBE_E2E_TABLE_SHOTS=1` test 7 attaches four contact sheets - evidence, never compared.
 *
 * Tests 1-7 and 9 run in the `chromium` project only; test 8 (the placeholders' text) runs in
 * English, Russian and Ukrainian (`ui/playwright.config.ts`).
 */

import { readFileSync } from 'node:fs';

import type { Browser, Page, TestInfo } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';
import { pageLang, uiText } from './fixtures/i18n';
import {
  checkLayout,
  checkLoadDrift,
  describeFailures,
  fillsArea,
  floorOf,
  MEASURE_TABLES,
  PICTURES_SETTLED,
  type Expected,
  type Finding,
  type ReportMetrics,
  type TableMeasurement,
} from './fixtures/tableLayout';

const BOOK = fixtureBook('tables-images.fb2');
const EXPECTED = JSON.parse(
  readFileSync(fixtureBook('tables-images.expected.json'), 'utf8'),
) as Expected;

const BODY = '[data-testid="body-editor"]';
const ANNOTATION_FIELD = '[data-testid="description-annotation"]';

/** Every curated and vR9 table (c21 and d01 in the Body view's annotation block). */
const CURATED = Object.keys(EXPECTED.tables);
/** The SC-006 family: each picture in tables of 1 to 10 columns. */
const SC006 = Object.keys(EXPECTED.sc006);
/** The tables of the book's annotation, for the Description field. */
const ANNOTATION = CURATED.filter((id) => EXPECTED.tables[id]!.placement === 'annotation');
/** The placeholder tables of test 8. */
const PLACEHOLDERS = ['c05', 'c17', 'c18', 'c23'];

const WIDTHS = [1600, 1280, 1024, 800, 640] as const;
const FONTS = [6, 14, 24] as const;

type Panes = 'first start' | 'AI panel hidden';
type Theme = 'light' | 'dark';

interface Env {
  width: number;
  font: number;
  fast: boolean;
  theme?: Theme;
}

interface EnvResult {
  env: string;
  failures: Finding[];
  metrics: ReportMetrics;
}

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

/* ------------------------------------------------------------------------ */
/* Panes, the book and the environments                                     */
/* ------------------------------------------------------------------------ */

/** The panes of a layout, set before the page loads (`core/src/settings/settings.cpp:558-565`). */
function sessionOf(panes: Panes): Record<string, unknown> {
  return {
    toolbars: null,
    treeVisible: true,
    treeWidth: 260,
    aiPanelWidth: 360,
    aiPanelVisible: panes === 'first start',
  };
}

async function openBook(core: CoreHandle, page: Page, panes: Panes): Promise<void> {
  await core.rpc('settings.set', { patch: { session: sessionOf(panes) } });
  await core.openApp(page);
  await core.enqueueDialog('dialog.openFile', { paths: [BOOK] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, BOOK);
  await expect(page.getByTestId('body-view')).toBeVisible();
}

function label(panes: Panes, env: Env): string {
  return `${panes}, ${env.width} px, Body font ${env.font}, Fast Mode ${env.fast ? 'on' : 'off'}${env.theme ? `, ${env.theme}` : ''}`;
}

/** Applies an environment and waits until the page shows it with its pictures settled. */
async function applyEnv(core: CoreHandle, page: Page, env: Env, scope: string): Promise<void> {
  await page.setViewportSize({ width: env.width, height: 800 });
  await core.rpc('settings.set', {
    patch: { view: { bodyFontSize: env.font, fastMode: env.fast, theme: env.theme ?? 'light' } },
  });
  await expect
    .poll(() =>
      page.evaluate(
        `(() => { const el = document.querySelector(${JSON.stringify(scope)}); return el ? getComputedStyle(el).fontSize : null; })()`,
      ),
    )
    .toBe(`${env.font}px`);
  if (scope === BODY) {
    const view = page.getByTestId('body-view');
    if (env.fast) await expect(view).toHaveClass(/mfbe-body-view--fast/);
    else await expect(view).not.toHaveClass(/mfbe-body-view--fast/);
  }
  await expect(page.locator('html')).toHaveAttribute('data-theme', env.theme ?? 'light');
  await page.evaluate(`(${PICTURES_SETTLED})(${JSON.stringify({ scope })})`);
}

async function measure(
  page: Page,
  scope: string,
  ids: readonly string[],
  words: boolean,
): Promise<TableMeasurement> {
  return page.evaluate<TableMeasurement>(
    `(${MEASURE_TABLES})(${JSON.stringify({ scope, ids, words })})`,
  );
}

/** Measures and checks one environment; a failing one attaches up to three table shots. */
async function checkEnv(
  page: Page,
  testInfo: TestInfo,
  results: EnvResult[],
  where: string,
  scope: string,
  ids: readonly string[],
  words: boolean,
): Promise<TableMeasurement> {
  const measurement = await measure(page, scope, ids, words);
  const { failures, metrics } = checkLayout(measurement, EXPECTED, ids, { words });
  results.push({ env: where, failures, metrics });
  if (failures.length) {
    const failing = [...new Set(failures.map((f) => f.table.replace(/-ctl$/, '')))].slice(0, 3);
    for (const id of failing) {
      for (const which of [id, `${id}-ctl`]) {
        const shot = await page
          .locator(`${scope} table.fb-table[data-id="${which}"]`)
          .screenshot({ timeout: 5_000 })
          .catch(() => null);
        if (shot) {
          await testInfo.attach(`${where} - ${which}.png`, {
            body: shot,
            contentType: 'image/png',
          });
        }
      }
    }
  }
  return measurement;
}

/** Attaches the results and expects no finding in any environment. */
async function report(testInfo: TestInfo, results: EnvResult[]): Promise<void> {
  await testInfo.attach('layout-findings.json', {
    body: JSON.stringify(results, null, 1),
    contentType: 'application/json',
  });
  const failing = results.filter((result) => result.failures.length);
  const message = failing
    .slice(0, 3)
    .map((result) => describeFailures(result.env, result.failures))
    .join('\n');
  expect(
    failing.map((result) => `${result.env}: ${result.failures.length}`),
    `${failing.length} of ${results.length} environments with findings\n${message}`,
  ).toEqual([]);
}

/** Every width × font × Fast Mode combination of tests 1 to 4. */
function matrix(fonts: readonly number[] = FONTS): Env[] {
  const out: Env[] = [];
  for (const width of WIDTHS) {
    for (const font of fonts) for (const fast of [false, true]) out.push({ width, font, fast });
  }
  return out;
}

async function restore(core: CoreHandle): Promise<void> {
  await core.rpc('settings.set', {
    patch: {
      session: {
        toolbars: null,
        treeVisible: null,
        treeWidth: null,
        aiPanelWidth: null,
        aiPanelVisible: null,
      },
      view: { bodyFontSize: null, fastMode: null, theme: null },
    },
  });
}

function chromiumOnly(testInfo: TestInfo): void {
  test.skip(
    testInfo.project.name !== 'chromium',
    'the layout runs once, in the chromium project; test 8 runs in every language',
  );
}

/* ------------------------------------------------------------------------ */
/* Screenshots decoded in the page (no PNG library)                         */
/* ------------------------------------------------------------------------ */

/**
 * Pixel checks of test 6's dark theme. `alpha`: of the light screenshot's pixels within 10 per
 * channel of the light cell colour, the share that shows the dark cell colour (within 10) in the
 * dark screenshot. `outline`: of a placeholder's 1 px edge ring, the share of pixels within 2 px
 * of its edge that differ from the background by more than 32 in some channel.
 */
const PIXELS = `async (args) => {
  const decode = async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
  };
  const near = (data, i, colour, within) =>
    Math.abs(data[i] - colour[0]) <= within &&
    Math.abs(data[i + 1] - colour[1]) <= within &&
    Math.abs(data[i + 2] - colour[2]) <= within;
  if (args.kind === 'alpha') {
    const light = await decode(args.light);
    const dark = await decode(args.dark);
    let ground = 0;
    let shown = 0;
    const n = Math.min(light.data.length, dark.data.length);
    for (let i = 0; i < n; i += 4) {
      if (!near(light.data, i, args.lightColour, 10)) continue;
      ground += 1;
      if (near(dark.data, i, args.darkColour, 10)) shown += 1;
    }
    return { ground, shown };
  }
  const image = await decode(args.shot);
  const w = image.width;
  const h = image.height;
  let differing = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (x >= 2 && x < w - 2 && y >= 2 && y < h - 2) continue;
      const i = (y * w + x) * 4;
      if (!near(image.data, i, args.background, 32)) differing += 1;
    }
  }
  return { ring: Math.max(1, 2 * (w + h) - 4), differing };
}`;

/** `rgb(r, g, b)` of an element's effective background (the first opaque one up the tree). */
const BACKGROUND_OF = `(selector) => {
  let el = document.querySelector(selector);
  while (el) {
    const colour = getComputedStyle(el).backgroundColor;
    const m = /rgba?\\((\\d+), (\\d+), (\\d+)(?:, ([\\d.]+))?\\)/.exec(colour);
    if (m && (m[4] === undefined || Number(m[4]) > 0.5)) return [Number(m[1]), Number(m[2]), Number(m[3])];
    el = el.parentElement;
  }
  return [255, 255, 255];
}`;

/**
 * Marks every shown placeholder of the tables at least 4 px wide and high with
 * `data-mfbe-ph="<n>"`; returns their count.
 */
const MARK_PLACEHOLDERS = `(args) => {
  let n = 0;
  for (const id of args.ids) {
    const table = document.querySelector(args.scope + ' table.fb-table[data-id="' + id + '"]');
    if (!table) continue;
    for (const ph of Array.from(table.querySelectorAll('.fb-image-placeholder'))) {
      if (getComputedStyle(ph).display === 'none' || !ph.getClientRects().length) continue;
      // A placeholder squeezed below 4 px has no frame to see (cutPlaceholders reports it).
      const box = ph.getBoundingClientRect();
      if (box.width < 4 || box.height < 4) continue;
      ph.setAttribute('data-mfbe-ph', String(n));
      n += 1;
    }
  }
  return n;
}`;

const TRANSPARENT = [
  { table: 'c06', row: 0, col: 0 },
  { table: 'c12', row: 0, col: 1 },
  { table: 'c22', row: 0, col: 1 },
];

function cellSelector(scope: string, id: string, row: number, col: number): string {
  return `${scope} table.fb-table[data-id="${id}"] > tbody > tr:nth-child(${row + 1}) > :nth-child(${col + 1})`;
}

/** The light-theme shots of the transparent pictures, with their cell colours. */
async function transparentShots(page: Page): Promise<{ shot: string; colour: number[] }[]> {
  const out: { shot: string; colour: number[] }[] = [];
  for (const { table, row, col } of TRANSPARENT) {
    const cell = cellSelector(BODY, table, row, col);
    const img = page.locator(`${cell} .fb-inline-image img`);
    out.push({
      shot: (await img.screenshot()).toString('base64'),
      colour: await page.evaluate<number[]>(`(${BACKGROUND_OF})(${JSON.stringify(cell)})`),
    });
  }
  return out;
}

/** Test 6's dark-theme pixel checks: the cell colour through transparent pictures, the frames. */
async function darkPixelChecks(
  page: Page,
  light: { shot: string; colour: number[] }[] | null,
): Promise<string[]> {
  const problems: string[] = [];
  if (light) {
    for (const [index, { table, row, col }] of TRANSPARENT.entries()) {
      const cell = cellSelector(BODY, table, row, col);
      const dark = (await page.locator(`${cell} .fb-inline-image img`).screenshot()).toString(
        'base64',
      );
      const darkColour = await page.evaluate<number[]>(
        `(${BACKGROUND_OF})(${JSON.stringify(cell)})`,
      );
      const result = await page.evaluate<{ ground: number; shown: number }>(
        `(${PIXELS})(${JSON.stringify({ kind: 'alpha', light: light[index]!.shot, dark, lightColour: light[index]!.colour, darkColour })})`,
      );
      if (result.ground === 0 || result.shown < 0.9 * result.ground) {
        problems.push(
          `${table}: ${result.shown} of ${result.ground} transparent pixels show the dark cell colour ${darkColour.join(',')}`,
        );
      }
    }
  }
  const count = await page.evaluate<number>(
    `(${MARK_PLACEHOLDERS})(${JSON.stringify({ scope: BODY, ids: CURATED })})`,
  );
  for (let n = 0; n < count; n += 1) {
    const selector = `${BODY} [data-mfbe-ph="${n}"]`;
    const shot = await page
      .locator(selector)
      .screenshot({ timeout: 10_000 })
      .then((png) => png.toString('base64'))
      .catch(() => null);
    if (!shot) {
      problems.push(`placeholder ${n}: no screenshot`);
      continue;
    }
    const background = await page.evaluate<number[]>(
      `(${BACKGROUND_OF})(${JSON.stringify(selector)})`,
    );
    const result = await page.evaluate<{ ring: number; differing: number }>(
      `(${PIXELS})(${JSON.stringify({ kind: 'outline', shot, background })})`,
    );
    if (result.differing < result.ring / 3) {
      problems.push(`placeholder ${n}: ${result.differing} of ${result.ring} frame pixels visible`);
    }
  }
  await page.evaluate(
    `document.querySelectorAll('[data-mfbe-ph]').forEach((el) => el.removeAttribute('data-mfbe-ph'))`,
  );
  return problems;
}

/** A contact sheet: every curated table beside its control, composed in a page and shot whole. */
async function contactSheet(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const rows: string[] = [];
  for (const id of CURATED) {
    const shots: string[] = [];
    for (const which of [id, `${id}-ctl`]) {
      const shot = await page.locator(`${BODY} table.fb-table[data-id="${which}"]`).screenshot();
      shots.push(`<img src="data:image/png;base64,${shot.toString('base64')}">`);
    }
    rows.push(`<div class="row"><b>${id}</b>${shots.join('')}</div>`);
  }
  const sheet = await page.context().newPage();
  await sheet.setContent(
    `<!doctype html><html><head><style>body{margin:8px;font:12px sans-serif;background:#888}` +
      `.row{display:flex;gap:12px;align-items:flex-start;margin:0 0 10px}b{width:40px}</style>` +
      `</head><body>${rows.join('')}</body></html>`,
  );
  const png = await sheet.screenshot({ fullPage: true });
  await sheet.close();
  await testInfo.attach(`contact-sheet-${name}.png`, { body: png, contentType: 'image/png' });
}

/* ------------------------------------------------------------------------ */
/* The tests                                                                */
/* ------------------------------------------------------------------------ */

test.describe('US3 - the layout of pictures in table cells (SC-006)', () => {
  test.beforeEach(({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });

  test.afterEach(async ({ core }) => {
    if (core.hasCore) await restore(core);
  });

  for (const [number, panes, tables] of [
    [1, 'first start', 'curated'],
    [2, 'first start', 'SC-006'],
    [3, 'AI panel hidden', 'curated'],
    [4, 'AI panel hidden', 'SC-006'],
  ] as const) {
    test(`${number}. ${panes}, the ${tables} tables: 5 widths × Body fonts 6, 14 and 24 × Fast Mode off and on`, async ({
      core,
      page,
    }, testInfo) => {
      chromiumOnly(testInfo);
      test.setTimeout(240_000);
      const ids = tables === 'curated' ? CURATED : SC006;
      const words = tables === 'curated';
      await openBook(core, page, panes);
      const results: EnvResult[] = [];
      for (const env of matrix()) {
        await applyEnv(core, page, env, BODY);
        await checkEnv(page, testInfo, results, label(panes, env), BODY, ids, words);
      }
      await report(testInfo, results);
    });
  }

  test('sc.9: v01, v05 and v20 fill the 640 px text area by their text alone at Body font 14; their pictures keep the floor', async ({
    core,
    page,
  }, testInfo) => {
    chromiumOnly(testInfo);
    test.skip(
      process.platform !== 'linux',
      'premise: with the Linux fonts the text of v01, v05 and v20 alone fills the 640 px text area at Body font 14',
    );
    await openBook(core, page, 'first start');
    const env: Env = { width: 640, font: 14, fast: false };
    await applyEnv(core, page, env, BODY);
    const ids = ['v01', 'v05', 'v20'];
    const results: EnvResult[] = [];
    const measurement = await checkEnv(
      page,
      testInfo,
      results,
      label('first start', env),
      BODY,
      ids,
      true,
    );
    for (const id of ids) {
      const { t, c } = measurement.tables[id]!;
      expect(fillsArea(c!), `${id}'s control fills its text area`).toBe(true);
      for (const picture of t!.pictures) {
        const [nw, nh] = EXPECTED.pictures[picture.href.slice(1)]!.natural;
        const floor = floorOf(nw, nh, picture.em, measurement.env.LH);
        // Every cell is at least 3em wide (issue #7), so a picture squeezed by its table's text
        // keeps the cell's minimum width when that is more than its floor (never more than its
        // natural width).
        const expected = Math.max(floor, Math.min(nw, 3 * picture.em));
        expect(picture.shown, `${id} ${picture.href} shown`).toBe(true);
        expect(
          Math.abs(picture.w - expected),
          `${id} ${picture.href} at ${expected} (floor ${floor}, 3em ${3 * picture.em})`,
        ).toBeLessThanOrEqual(1);
      }
    }
    await report(testInfo, results);
  });

  test('5. the Description view: the book annotation field with c21 and d01, both layouts × 5 widths × Body fonts 6, 14 and 24', async ({
    core,
    page,
  }, testInfo) => {
    chromiumOnly(testInfo);
    test.setTimeout(240_000);
    const results: EnvResult[] = [];
    for (const panes of ['first start', 'AI panel hidden'] as const) {
      await openBook(core, page, panes);
      await page.getByTestId('view-description').click();
      await expect(page.locator(ANNOTATION_FIELD)).toBeVisible();
      for (const width of WIDTHS) {
        for (const font of FONTS) {
          const env: Env = { width, font, fast: false };
          await applyEnv(core, page, env, ANNOTATION_FIELD);
          await checkEnv(
            page,
            testInfo,
            results,
            `Description, ${label(panes, env)}`,
            ANNOTATION_FIELD,
            ANNOTATION,
            true,
          );
        }
      }
    }
    await report(testInfo, results);
  });

  test('6. spot checks: Body font 96, the dark theme, device scale 2 and Body fonts 30, 34, 55 and 83', async ({
    core,
    page,
    browser,
  }, testInfo) => {
    chromiumOnly(testInfo);
    test.setTimeout(300_000);
    const results: EnvResult[] = [];
    const pixelProblems: string[] = [];

    // Body font 96: sc.9's second case, c22's gallery whose floors do not fit side by side.
    for (const [panes, width] of [
      ['first start', 640],
      ['AI panel hidden', 1600],
    ] as const) {
      await openBook(core, page, panes);
      for (const fast of [false, true]) {
        const env: Env = { width, font: 96, fast };
        await applyEnv(core, page, env, BODY);
        await checkEnv(page, testInfo, results, label(panes, env), BODY, CURATED, true);
      }
    }

    // The dark theme, with the in-run pixel checks.
    await openBook(core, page, 'first start');
    for (const width of [1280, 640]) {
      for (const fast of [false, true]) {
        let light: { shot: string; colour: number[] }[] | null = null;
        if (!fast) {
          await applyEnv(core, page, { width, font: 14, fast, theme: 'light' }, BODY);
          light = await transparentShots(page);
        }
        const env: Env = { width, font: 14, fast, theme: 'dark' };
        await applyEnv(core, page, env, BODY);
        await checkEnv(page, testInfo, results, label('first start', env), BODY, CURATED, true);
        for (const problem of await darkPixelChecks(page, light)) {
          pixelProblems.push(`${label('first start', env)}: ${problem}`);
        }
      }
    }

    // Device scale 2, in a context of its own.
    const scaled = await scaledPage(browser);
    try {
      await openBook(core, scaled, 'first start');
      for (const width of [1280, 640]) {
        for (const fast of [false, true]) {
          const env: Env = { width, font: 14, fast };
          await applyEnv(core, scaled, env, BODY);
          const measurement = await checkEnv(
            scaled,
            testInfo,
            results,
            `scale 2, ${label('first start', env)}`,
            BODY,
            CURATED,
            true,
          );
          expect(measurement.env.devicePixelRatio).toBe(2);
        }
      }
    } finally {
      await scaled.context().close();
    }

    // Body fonts 30, 34, 55 and 83 (vR9 N2, against which PO's slack was set).
    await openBook(core, page, 'first start');
    for (const width of [640, 1280]) {
      for (const font of [30, 34, 55, 83]) {
        for (const fast of [false, true]) {
          const env: Env = { width, font, fast };
          await applyEnv(core, page, env, BODY);
          await checkEnv(page, testInfo, results, label('first start', env), BODY, CURATED, true);
        }
      }
    }
    expect(results).toHaveLength(28);
    expect(pixelProblems, pixelProblems.join('\n')).toEqual([]);
    await report(testInfo, results);
  });

  test('7. @platform the seven deciding environments and the Description field', async ({
    core,
    page,
  }, testInfo) => {
    chromiumOnly(testInfo);
    test.setTimeout(240_000);
    const results: EnvResult[] = [];
    const shots = process.env.MFBE_E2E_TABLE_SHOTS === '1';
    const deciding: [Panes, Env[]][] = [
      [
        'AI panel hidden',
        [
          { width: 1600, font: 24, fast: false },
          { width: 1600, font: 6, fast: false },
        ],
      ],
      [
        'first start',
        [
          { width: 800, font: 24, fast: true },
          { width: 640, font: 96, fast: false },
          { width: 800, font: 6, fast: true },
          { width: 640, font: 96, fast: true },
          { width: 1280, font: 14, fast: false },
        ],
      ],
    ];
    for (const [panes, envs] of deciding) {
      await openBook(core, page, panes);
      for (const env of envs) {
        await applyEnv(core, page, env, BODY);
        await checkEnv(
          page,
          testInfo,
          results,
          `curated, ${label(panes, env)}`,
          BODY,
          CURATED,
          true,
        );
        await checkEnv(page, testInfo, results, `SC-006, ${label(panes, env)}`, BODY, SC006, false);
      }
      if (shots && panes === 'first start') {
        await applyEnv(core, page, { width: 1280, font: 14, fast: false }, BODY);
        await contactSheet(page, testInfo, '1280-light');
        await applyEnv(core, page, { width: 640, font: 14, fast: false }, BODY);
        await contactSheet(page, testInfo, '640-light');
        await applyEnv(core, page, { width: 640, font: 14, fast: true }, BODY);
        await contactSheet(page, testInfo, '640-fast-mode');
      }
      if (shots && panes === 'AI panel hidden') {
        await applyEnv(core, page, { width: 800, font: 14, fast: false, theme: 'dark' }, BODY);
        await contactSheet(page, testInfo, '800-dark');
      }
    }
    // The Description field at 1280 px, Body font 14.
    await page.getByTestId('view-description').click();
    await expect(page.locator(ANNOTATION_FIELD)).toBeVisible();
    const env: Env = { width: 1280, font: 14, fast: false };
    await applyEnv(core, page, env, ANNOTATION_FIELD);
    await checkEnv(
      page,
      testInfo,
      results,
      `Description, ${label('first start', env)}`,
      ANNOTATION_FIELD,
      ANNOTATION,
      true,
    );
    expect(results).toHaveLength(15);
    await report(testInfo, results);
  });

  test('8. the placeholders in the interface language: c05, c17, c18 and c23', async ({
    core,
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await openBook(core, page, 'first start');
    const missing = uiText(await pageLang(page), 'views.body.imageMissing');
    const results: EnvResult[] = [];
    const wrongText: string[] = [];
    for (const env of [
      { width: 640, font: 14, fast: false },
      { width: 640, font: 14, fast: true },
      { width: 1024, font: 6, fast: true },
      { width: 800, font: 24, fast: true },
    ] satisfies Env[]) {
      await applyEnv(core, page, env, BODY);
      const measurement = await checkEnv(
        page,
        testInfo,
        results,
        label('first start', env),
        BODY,
        PLACEHOLDERS,
        true,
      );
      let shown = 0;
      for (const id of PLACEHOLDERS) shown += measurement.tables[id]!.t!.placeholders.length;
      expect(shown, `placeholders shown at ${label('first start', env)}`).toBeGreaterThan(0);
      const texts = await page.evaluate<string[]>(
        `Array.from(document.querySelectorAll(${JSON.stringify(PLACEHOLDERS.map((id) => `${BODY} table.fb-table[data-id="${id}"] .fb-image-placeholder`).join(', '))}))` +
          `.filter((ph) => getComputedStyle(ph).display !== 'none').map((ph) => ph.textContent)`,
      );
      for (const text of texts)
        if (!text.startsWith(missing)) wrongText.push(`${label('first start', env)}: "${text}"`);
    }
    expect(wrongText, `every placeholder starts with "${missing}"`).toEqual([]);
    await report(testInfo, results);
  });

  test('9. previews held until the book has opened, then released: the tables keep their height', async ({
    core,
    page,
  }, testInfo) => {
    chromiumOnly(testInfo);
    test.setTimeout(180_000);
    const findings: Finding[] = [];
    await core.rpc('settings.set', { patch: { session: sessionOf('first start') } });
    for (const env of [
      { width: 1280, font: 14, fast: false },
      { width: 640, font: 24, fast: false },
    ] satisfies Env[]) {
      await page.setViewportSize({ width: env.width, height: 800 });
      await core.rpc('settings.set', {
        patch: { view: { bodyFontSize: env.font, fastMode: false } },
      });
      // Every preview request waits until released.
      const held: { continue(): Promise<void> }[] = [];
      let holding = true;
      await page.route('**/binary/**/preview*', async (route) => {
        if (holding) held.push(route);
        else await route.continue();
      });
      // A fresh page and a new session of the book: new preview addresses, none cached.
      await core.openApp(page);
      await core.enqueueDialog('dialog.openFile', { paths: [BOOK] });
      await page.getByTestId('menu-file').click();
      await page.getByTestId('menu-file-open').click();
      await waitForBook(page, BOOK);
      const last = `${BODY} table.fb-table[data-id="${SC006[SC006.length - 1]}-ctl"]`;
      await expect(page.locator(last)).toBeAttached();
      await expect
        .poll(() =>
          page.evaluate(
            `getComputedStyle(document.querySelector(${JSON.stringify(BODY)})).fontSize`,
          ),
        )
        .toBe(`${env.font}px`);
      await expect.poll(() => held.length).toBeGreaterThan(0);
      await page.evaluate(
        '(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))()',
      );
      const ids = [...CURATED, ...SC006];
      const before = await measure(page, BODY, ids, false);
      holding = false;
      for (const route of held.splice(0)) await route.continue();
      await page.evaluate(`(${PICTURES_SETTLED})(${JSON.stringify({ scope: BODY })})`);
      const after = await measure(page, BODY, ids, false);
      const drift = checkLoadDrift(before, after, EXPECTED);
      await testInfo.attach(`load-drift-${env.width}.json`, {
        body: JSON.stringify(drift, null, 1),
        contentType: 'application/json',
      });
      findings.push(...drift);
      await page.unroute('**/binary/**/preview*');
    }
    expect(findings, describeFailures('held previews', findings)).toEqual([]);
  });
});

/** A page of a second browser context at device scale 2 (test 6). */
async function scaledPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    locale: 'en-US',
  });
  return context.newPage();
}
