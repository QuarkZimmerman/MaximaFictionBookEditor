#!/usr/bin/env node
/**
 * Performance budgets (T150, SC-002, constitution IV "performance budgets are release gates").
 *
 * Standalone Node + Playwright runner (no test framework): starts `mfbe-core serve --test-hooks`
 * serving the built UI, drives the real application in headless Chromium and measures
 *
 *   10 MB text book    File > Open -> Body view editable            budget  3 000 ms
 *                      keystroke latency, median / p95 of N strokes   budget    100 ms (median)
 *                      tree click -> Body window + caret moved        budget    100 ms (median)
 *                      File > Save (modified document)                recorded
 *   150 MB image book  File > Open -> Body view editable            budget 15 000 ms
 *                      mounted previews loaded                        recorded
 *                      peak RSS of the core (VmHWM)                   budget  1.5 GB
 *                      File > Save                                    recorded
 *   core only          `mfbe-core roundtrip --json` of both books (open/write/total, peak RSS)
 *
 * Prints a table, writes `tests/bench/results/bench-<timestamp>.json` with `--json`, exits 1
 * when a budget is exceeded. Books are generated on demand by tests/fixtures/gen-large-book.py
 * into the work directory (never committed).
 *
 * Usage: node tests/bench/bench.mjs [--core PATH] [--ui-dist DIR] [--work-dir DIR]
 *          [--skip-150] [--keystrokes N] [--json] [--headed]
 * Env:   MFBE_CORE_BIN, MFBE_UI_DIST, MFBE_BENCH_WORKDIR (same as the options).
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const UI_DIR = path.join(REPO, 'ui');
const GENERATOR = path.join(REPO, 'tests', 'fixtures', 'gen-large-book.py');

const BUDGETS = {
  open10Ms: 3000,
  keystrokeMedianMs: 100,
  treeNavMedianMs: 100,
  open150Ms: 15_000,
  peakRss150Bytes: 1.5 * 1024 * 1024 * 1024,
};

/* ------------------------------------------------------------------------------------------ */
/* Options                                                                                    */
/* ------------------------------------------------------------------------------------------ */

function parseArgs(argv) {
  const options = {
    core: process.env.MFBE_CORE_BIN ?? '',
    uiDist: process.env.MFBE_UI_DIST ?? path.join(UI_DIR, 'dist'),
    workDir: process.env.MFBE_BENCH_WORKDIR ?? path.join(REPO, 'build', 'bench'),
    skip150: false,
    keystrokes: 50,
    json: false,
    headed: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i] ?? '';
    if (arg === '--core') options.core = next();
    else if (arg === '--ui-dist') options.uiDist = next();
    else if (arg === '--work-dir') options.workDir = next();
    else if (arg === '--skip-150') options.skip150 = true;
    else if (arg === '--keystrokes') options.keystrokes = Number(next());
    else if (arg === '--json') options.json = true;
    else if (arg === '--headed') options.headed = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    } else throw new Error(`unknown option ${arg}`);
  }
  if (!options.core) {
    for (const candidate of [
      path.join(REPO, 'build', 'linux-core-release', 'bin', 'mfbe-core'),
      path.join(REPO, 'build', 'linux-core-debug', 'bin', 'mfbe-core'),
    ]) {
      if (existsSync(candidate)) {
        options.core = candidate;
        break;
      }
    }
  }
  if (!options.core || !existsSync(options.core)) {
    throw new Error('mfbe-core not found: pass --core or set MFBE_CORE_BIN');
  }
  if (!existsSync(path.join(options.uiDist, 'index.html'))) {
    throw new Error(`UI bundle not found at ${options.uiDist} (run "npm run build" in ui/)`);
  }
  return options;
}

/* ------------------------------------------------------------------------------------------ */
/* Fixtures                                                                                   */
/* ------------------------------------------------------------------------------------------ */

function ensureBook(workDir, name, args) {
  const file = path.join(workDir, name);
  if (existsSync(file) && statSync(file).size > 0) return file;
  const result = spawnSync('python3', [GENERATOR, '--out', file, ...args], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`cannot generate ${name}: ${result.stderr || result.stdout}`);
  }
  process.stderr.write(`generated ${result.stdout.trim()}\n`);
  return file;
}

/* ------------------------------------------------------------------------------------------ */
/* Core process + JSON-RPC                                                                    */
/* ------------------------------------------------------------------------------------------ */

class RpcClient {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
  }

  async connect() {
    if (this.socket) return;
    const socket = new WebSocket(this.url);
    this.socket = socket;
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error(`cannot connect ${this.url}`)), {
        once: true,
      });
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (typeof message.method === 'string' && message.id === undefined) {
        for (const listener of this.listeners) listener(message.method, message.params);
        return;
      }
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) {
        entry.reject(new Error(`${entry.method}: ${message.error.message} (${message.error.code})`));
      } else entry.resolve(message.result);
    });
  }

  async call(method, params, timeoutMs = 120_000) {
    await this.connect();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: no response within ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  /** Calls `method`; a `{jobId}` answer is resolved through job.done / job.failed. */
  async runJob(method, params, timeoutMs = 300_000) {
    const first = await this.call(method, params, timeoutMs);
    if (!first || typeof first.jobId !== 'string') return first;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`${method}: job ${first.jobId} did not finish within ${timeoutMs} ms`));
      }, timeoutMs);
      const off = () => this.listeners.delete(listener);
      const listener = (name, payload) => {
        if (payload?.jobId !== first.jobId) return;
        if (name === 'job.done') {
          clearTimeout(timer);
          off();
          resolve(payload.result);
        } else if (name === 'job.failed') {
          clearTimeout(timer);
          off();
          reject(new Error(`${method}: ${payload.error?.message ?? 'job failed'}`));
        }
      };
      this.listeners.add(listener);
    });
  }

  close() {
    this.socket?.close();
    this.socket = null;
  }
}

async function startCore(options) {
  const dataDir = path.join(options.workDir, 'data');
  const tmpDir = path.join(options.workDir, 'tmp');
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });
  const child = spawn(
    options.core,
    ['serve', '--test-hooks', '--data-dir', dataDir, '--ui', options.uiDist],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      // Binary spill files and the log go to the work directory (a tmpfs /tmp would count
      // against RAM and may be full on shared hosts).
      env: { ...process.env, MFBE_E2E: '1', TMPDIR: tmpDir, TMP: tmpDir, TEMP: tmpDir },
    },
  );
  const stderr = [];
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  const ready = await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(
      () => reject(new Error(`core not ready within 30 s\n${stderr.join('')}`)),
      30_000,
    );
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      for (const line of buffer.split('\n')) {
        if (!line.trim().startsWith('{')) continue;
        try {
          const value = JSON.parse(line);
          if (typeof value.port === 'number') {
            clearTimeout(timer);
            resolve(value);
          }
        } catch {
          // not the ready line
        }
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`core exited early (${code})\n${stderr.join('')}`));
    });
  });
  return {
    child,
    pid: ready.pid || child.pid,
    baseURL: `http://127.0.0.1:${ready.port}/?token=${encodeURIComponent(ready.token)}`,
    rpc: new RpcClient(`ws://127.0.0.1:${ready.port}/rpc?token=${ready.token}`),
    dataDir,
    async stop() {
      this.rpc.close();
      if (child.exitCode === null) {
        const exited = new Promise((resolve) => child.once('exit', resolve));
        child.kill('SIGTERM');
        await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
        if (child.exitCode === null) child.kill('SIGKILL');
      }
    },
  };
}

/** Peak resident set size of a process (Linux VmHWM; null elsewhere). */
function peakRssBytes(pid) {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    const match = /VmHWM:\s+(\d+)\s+kB/.exec(status);
    return match ? Number(match[1]) * 1024 : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* In-page probes                                                                             */
/* ------------------------------------------------------------------------------------------ */

/** Current document id of the Body view (null without a document). */
const CURRENT_DOC_ID = `(() => {
  const view = document.querySelector('[data-testid="body-view"]');
  return view ? view.getAttribute('data-doc-id') : null;
})()`;

/**
 * Resolves with the page time at which the Body view of a *new* document (docId different
 * from `previousDocId`) became editable with its first paragraph painted; -1 on timeout.
 */
const WAIT_EDITABLE = `(async (timeout, previousDocId) => {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const view = document.querySelector('[data-testid="body-view"]');
    const editor = document.querySelector('[data-testid="body-editor"]');
    if (view && editor && view.getAttribute('data-doc-id') !== previousDocId &&
        editor.getAttribute('contenteditable') === 'true') {
      const p = editor.querySelector('.fb-section p.fb-p, .fb-section .fb-image');
      if (p && p.getClientRects().length > 0) return performance.now();
    }
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }
  return -1;
})`;

/** Resolves when every mounted preview image has loaded (or errored); returns page time. */
const WAIT_IMAGES = `(async (timeout) => {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const images = [...document.querySelectorAll('.fb-editor .fb-image img')];
    if (images.length > 0 && images.every((img) => img.complete)) {
      return { at: performance.now(), count: images.length,
               loaded: images.filter((img) => img.naturalWidth > 0).length };
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return { at: -1, count: 0, loaded: 0 };
})`;

/** Inserts one character and waits for the editor to settle (same probe as the e2e spec). */
const TYPE_AND_MEASURE = `(async () => {
  const start = performance.now();
  document.execCommand('insertText', false, 'x');
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  return performance.now() - start;
})()`;

/**
 * Scrolls the virtual tree to `fraction` of its rows, clicks the first visible section row and
 * waits until the Body window moved there and the selection landed in it.
 */
const TREE_NAVIGATE = `(async (fraction) => {
  const tree = document.querySelector('[data-testid="tree-content"]');
  const rows = document.querySelector('[data-testid="tree-rows"]');
  const doc = document.querySelector('[data-testid="panel-body-document"]');
  if (!tree || !rows || !doc) return { ms: -1, error: 'tree or body not mounted' };
  const total = Number(tree.getAttribute('data-row-count')) || 1;
  const rowHeight = rows.offsetHeight / total;
  tree.scrollTop = Math.floor(total * fraction) * rowHeight;
  let row = null;
  for (let attempt = 0; attempt < 100 && !row; attempt += 1) {
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const top = tree.getBoundingClientRect().top;
    row = [...tree.querySelectorAll('[data-testid^="tree-row-"][data-kind="section"]')]
      .find((r) => r.getBoundingClientRect().top >= top && r.dataset.selected !== 'true');
  }
  if (!row) return { ms: -1, error: 'no section row visible' };
  const id = row.getAttribute('data-testid').slice('tree-row-'.length);
  const pathPane = document.querySelector('[data-testid="status-path"]');
  const beforeStart = doc.getAttribute('data-section-start');
  const beforePath = pathPane ? pathPane.textContent : '';
  const start = performance.now();
  row.click();
  // Done when the tree shows the row selected and the status bar shows the new caret path
  // (the editor selection now sits in that section; the window was re-centred when needed).
  while (performance.now() - start < 10000) {
    const selected = tree.getAttribute('data-selected-id') === id;
    const pathChanged = pathPane && pathPane.textContent !== beforePath &&
      /section\\[/.test(pathPane.textContent);
    if (selected && pathChanged) {
      const moved = doc.getAttribute('data-section-start') !== beforeStart;
      return { ms: performance.now() - start, id, moved };
    }
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }
  return { ms: -1, error: 'timeout', id, selected: tree.getAttribute('data-selected-id'),
           start: doc.getAttribute('data-section-start'), beforeStart,
           path: pathPane && pathPane.textContent, beforePath };
})`;

/* ------------------------------------------------------------------------------------------ */
/* UI journeys                                                                                */
/* ------------------------------------------------------------------------------------------ */

function median(values) {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function percentile(values, p) {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function clickMenu(page, menuId, itemId) {
  await page.getByTestId(`menu-${menuId}`).click();
  await page.getByTestId(`menu-${menuId}-${itemId}`).waitFor();
  await page.getByTestId(`menu-${menuId}-${itemId}`).click();
}

/** File > Open of `book`; returns the time until the Body view is editable (ms). */
async function openBook(page, core, book, budgetMs) {
  await core.rpc.call('test.enqueueDialog', { method: 'dialog.openFile', result: { paths: [book] } });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').waitFor();
  const previousDocId = await page.evaluate(CURRENT_DOC_ID);
  const t0 = await page.evaluate(() => performance.now());
  await page.getByTestId('menu-file-open').click();
  const readyAt = await page.evaluate(
    `${WAIT_EDITABLE}(${budgetMs * 6}, ${JSON.stringify(previousDocId)})`,
  );
  if (readyAt < 0) throw new Error(`Body view not editable within ${budgetMs * 6} ms`);
  return { ms: readyAt - t0, readyAt };
}

/** File > Save of the current (modified) document; returns the time until the title is clean. */
async function saveBook(page) {
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-save').waitFor();
  const started = Date.now();
  await page.getByTestId('menu-file-save').click();
  await page.waitForFunction(() => !/\*\s+-\s/.test(document.title), null, {
    polling: 'raf',
    timeout: 300_000,
  });
  return Date.now() - started;
}

async function runUiBench(options, books, results) {
  // Playwright is a devDependency of ui/; resolve it from there (CJS entry, hence `default`).
  const require = createRequire(path.join(UI_DIR, 'package.json'));
  const playwright = await import(pathToFileURL(require.resolve('@playwright/test')).href);
  const chromium = playwright.chromium ?? playwright.default.chromium;
  const core = await startCore(options);
  const browser = await chromium.launch({ headless: !options.headed });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.setDefaultTimeout(120_000);
    await page.goto(core.baseURL);
    await page.getByTestId('app-root').waitFor();
    await page.getByTestId('status-message').filter({ hasText: 'Ready' }).waitFor();

    const sample = async (label) => {
      const metrics = await core.rpc.call('test.metrics');
      const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
      results.memory.push({
        label,
        coreRssBytes: metrics.memoryBytes,
        corePeakRssBytes: peakRssBytes(core.pid),
        rendererJsHeapBytes: heap,
      });
    };
    await sample('idle');

    /* ---- 10 MB text book ---------------------------------------------------------------- */
    const text = results.text;
    text.openEditableMs = (await openBook(page, core, books.text, BUDGETS.open10Ms)).ms;
    await sample('10mb opened');

    const editor = page.getByTestId('body-editor');
    const paragraph = editor.locator('.fb-section p.fb-p').nth(3);
    await paragraph.click({ position: { x: 8, y: 8 } });
    await page.getByTestId('status-path').filter({ hasText: '/p[' }).waitFor();
    await page.evaluate(TYPE_AND_MEASURE); // warm-up stroke
    const strokes = [];
    for (let i = 0; i < options.keystrokes; i += 1) strokes.push(await page.evaluate(TYPE_AND_MEASURE));
    text.keystrokes = {
      count: strokes.length,
      medianMs: median(strokes),
      p95Ms: percentile(strokes, 95),
      maxMs: Math.max(...strokes),
    };

    const navs = [];
    const fractions = [0.8, 0.2, 0.6, 0.35, 0.95, 0.1, 0.7];
    for (const fraction of fractions) {
      const nav = await page.evaluate(`${TREE_NAVIGATE}(${fraction})`);
      if (nav.ms < 0) throw new Error(`tree navigation failed: ${JSON.stringify(nav)}`);
      navs.push(nav.ms);
      text.treeNavigationMoves = (text.treeNavigationMoves ?? 0) + (nav.moved ? 1 : 0);
    }
    text.treeNavigation = {
      count: navs.length,
      medianMs: median(navs),
      p95Ms: percentile(navs, 95),
      maxMs: Math.max(...navs),
    };
    text.saveMs = await saveBook(page);
    await sample('10mb saved');

    /* ---- 150 MB image book -------------------------------------------------------------- */
    if (books.images) {
      const images = results.images;
      const opened = await openBook(page, core, books.images, BUDGETS.open150Ms);
      images.openEditableMs = opened.ms;
      const previews = await page.evaluate(`${WAIT_IMAGES}(120000)`);
      images.previews = {
        mounted: previews.count,
        loaded: previews.loaded,
        // Additional time after "editable" until every mounted preview arrived from the core.
        extraMs: previews.at < 0 ? null : Math.max(0, previews.at - opened.readyAt),
      };
      await sample('150mb opened');
      // A single keystroke makes the document modified so File > Save writes it.
      const firstParagraph = editor.locator('.fb-section p.fb-p').first();
      await firstParagraph.click({ position: { x: 8, y: 8 } });
      await page.evaluate(TYPE_AND_MEASURE);
      images.saveMs = await saveBook(page);
      await sample('150mb saved');
      images.peakRssBytes = peakRssBytes(core.pid);
    }
    await context.close();
  } finally {
    await browser.close();
    await core.stop();
    results.errorLogBytes = (() => {
      try {
        return statSync(path.join(core.dataDir, 'logs', 'mfbe-errors.log')).size;
      } catch {
        return 0;
      }
    })();
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Core-only micro benchmark                                                                  */
/* ------------------------------------------------------------------------------------------ */

function runRoundtrip(options, book, label) {
  const out = path.join(options.workDir, `rt-${label}`);
  rmSync(out, { recursive: true, force: true });
  const result = spawnSync(options.core, ['roundtrip', book, '--out', out, '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, TMPDIR: path.join(options.workDir, 'tmp') },
  });
  rmSync(out, { recursive: true, force: true });
  if (result.status !== 0 && !result.stdout.trim()) {
    throw new Error(`roundtrip ${label} failed: ${result.stderr}`);
  }
  const report = JSON.parse(result.stdout.trim().split('\n').pop());
  return {
    openMs: report.timingsMs?.open ?? null,
    writeMs: report.timingsMs?.write ?? null,
    totalMs: report.timingsMs?.total ?? null,
    peakRssBytes: report.peakRssBytes ?? null,
    identical: report.identical,
    valid: report.valid,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Report                                                                                     */
/* ------------------------------------------------------------------------------------------ */

const mb = (bytes) => (bytes == null ? 'n/a' : `${(bytes / 1024 / 1024).toFixed(0)} MB`);
const ms = (value) => (value == null || Number.isNaN(value) ? 'n/a' : `${Math.round(value)} ms`);

function buildRows(results) {
  const rows = [];
  const push = (metric, value, budget, formatted, budgetText) => {
    const ok = budget == null || value == null || value <= budget;
    rows.push({ metric, value: formatted, budget: budgetText ?? '-', ok });
  };
  const t = results.text;
  push('10 MB text: open -> editable', t.openEditableMs, BUDGETS.open10Ms, ms(t.openEditableMs), ms(BUDGETS.open10Ms));
  push(
    `10 MB text: keystroke median (${t.keystrokes?.count ?? 0})`,
    t.keystrokes?.medianMs,
    BUDGETS.keystrokeMedianMs,
    ms(t.keystrokes?.medianMs),
    ms(BUDGETS.keystrokeMedianMs),
  );
  push('10 MB text: keystroke p95', t.keystrokes?.p95Ms, null, ms(t.keystrokes?.p95Ms));
  push(
    `10 MB text: tree click -> caret median (${t.treeNavigation?.count ?? 0})`,
    t.treeNavigation?.medianMs,
    BUDGETS.treeNavMedianMs,
    ms(t.treeNavigation?.medianMs),
    ms(BUDGETS.treeNavMedianMs),
  );
  push('10 MB text: tree click -> caret max', t.treeNavigation?.maxMs, null, ms(t.treeNavigation?.maxMs));
  push('10 MB text: File > Save', t.saveMs, null, ms(t.saveMs));
  push('10 MB text: core roundtrip open / write', null, null, `${ms(results.core.text?.openMs)} / ${ms(results.core.text?.writeMs)}`);
  const i = results.images;
  if (i.openEditableMs != null) {
    push('150 MB images: open -> editable', i.openEditableMs, BUDGETS.open150Ms, ms(i.openEditableMs), ms(BUDGETS.open150Ms));
    push(
      `150 MB images: previews loaded (${i.previews?.loaded ?? 0}/${i.previews?.mounted ?? 0})`,
      null,
      null,
      i.previews?.extraMs == null ? 'n/a' : `+${ms(i.previews.extraMs)}`,
    );
    push('150 MB images: peak core RSS', i.peakRssBytes, BUDGETS.peakRss150Bytes, mb(i.peakRssBytes), mb(BUDGETS.peakRss150Bytes));
    push('150 MB images: File > Save', i.saveMs, null, ms(i.saveMs));
    push('150 MB images: core roundtrip open / write', null, null, `${ms(results.core.images?.openMs)} / ${ms(results.core.images?.writeMs)}`);
    push('150 MB images: core roundtrip peak RSS', results.core.images?.peakRssBytes, BUDGETS.peakRss150Bytes, mb(results.core.images?.peakRssBytes), mb(BUDGETS.peakRss150Bytes));
  }
  return rows;
}

function printTable(rows) {
  const width = Math.max(...rows.map((r) => r.metric.length));
  console.log(`${'metric'.padEnd(width)}  ${'value'.padStart(16)}  ${'budget'.padStart(10)}  status`);
  console.log(`${'-'.repeat(width)}  ${'-'.repeat(16)}  ${'-'.repeat(10)}  ------`);
  for (const row of rows) {
    console.log(
      `${row.metric.padEnd(width)}  ${row.value.padStart(16)}  ${row.budget.padStart(10)}  ${row.ok ? 'ok' : 'OVER BUDGET'}`,
    );
  }
}

/* ------------------------------------------------------------------------------------------ */

async function main() {
  const options = parseArgs(process.argv.slice(2));
  mkdirSync(options.workDir, { recursive: true });
  mkdirSync(path.join(options.workDir, 'tmp'), { recursive: true });
  const books = {
    text: ensureBook(options.workDir, 'large-10mb.fb2', ['--size-mb', '10']),
    images: options.skip150
      ? null
      : ensureBook(options.workDir, 'images-150mb.fb2', ['--size-mb', '150', '--images', '300']),
  };
  const results = {
    startedAt: new Date().toISOString(),
    host: { platform: process.platform, arch: process.arch, node: process.version },
    core: {},
    books: {
      text: { path: books.text, bytes: statSync(books.text).size },
      images: books.images ? { path: books.images, bytes: statSync(books.images).size } : null,
    },
    text: {},
    images: {},
    memory: [],
    budgets: BUDGETS,
  };
  const version = spawnSync(options.core, ['--version'], { encoding: 'utf8' }).stdout.trim();
  results.coreVersion = version;

  process.stderr.write(`core: ${options.core} (${version})\n`);
  process.stderr.write('core-only roundtrip...\n');
  results.core.text = runRoundtrip(options, books.text, 'text');
  if (books.images) results.core.images = runRoundtrip(options, books.images, 'images');

  process.stderr.write('UI journeys...\n');
  await runUiBench(options, books, results);

  const rows = buildRows(results);
  printTable(rows);
  const failed = rows.filter((row) => !row.ok);
  results.failed = failed.map((row) => row.metric);

  if (options.json) {
    const dir = path.join(HERE, 'results');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `bench-${results.startedAt.replace(/[:.]/g, '-')}.json`);
    writeFileSync(file, JSON.stringify(results, null, 2));
    console.log(`\nresults written to ${path.relative(REPO, file)}`);
  }
  if (failed.length > 0) {
    console.error(`\n${failed.length} budget(s) exceeded: ${failed.map((r) => r.metric).join('; ')}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(2);
});
