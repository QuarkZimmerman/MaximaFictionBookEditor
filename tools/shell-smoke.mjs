#!/usr/bin/env node
// CDP smoke check of the running CEF shell (T035). Invoked by tools/shell-smoke.sh:
//
//   node tools/shell-smoke.mjs <cdp-port>
//
// Attaches Playwright (ui/node_modules) to the shell's remote-debugging port with
// chromium.connectOverCDP (PW_CHROMIUM_ATTACH_TO_OTHER=1 is required for non-Playwright
// browsers; CEF's Chrome bootstrap exposes the same CDP surface as Google Chrome, see
// research.md D2 / CEF issue #3684), waits for the first page, asserts its title and that a
// selector is visible, and saves a screenshot.
//
// Environment:
//   MFBE_SMOKE_EXPECT_TITLE     text document.title must contain   (default "mfbe-smoke")
//   MFBE_SMOKE_EXPECT_SELECTOR  selector that must be visible      (default "#menubar";
//                               the real UI uses '[data-testid="menu-file"]')
//   MFBE_SMOKE_SCREENSHOT       screenshot path                    (default build/shell-smoke.png)
//   MFBE_SMOKE_TIMEOUT_MS       per-step timeout                   (default 30000)
//   MFBE_SMOKE_OPEN_FILE        the document the shell was started with (T137): the title
//                               must start with its file name and the Body must show text
//   MFBE_SMOKE_EXPECT_TEXT      text the Body editor must contain  (with MFBE_SMOKE_OPEN_FILE)
//   MFBE_SMOKE_ABOUT            1 = open Help > About when the menu exists and check the
//                               dialog ([data-testid="dialog-about"]); a UI without the
//                               dialog is reported, not failed
//   MFBE_SMOKE_RESTART          normal | max: the editor's restart of itself (feature 003 US3,
//                               SC-005) - Settings > View > Language = Ukrainian (Russian when
//                               the interface is Ukrainian already), OK, Yes in the restart
//                               prompt; the old process (app.info.pid) must exit, a new one come
//                               up on the same CDP port within 15 s with the book open,
//                               <html lang> = the chosen language, the window at the old bounds
//                               (+-2 px) or maximised (max), started with --wait-for-exit
//                               <old pid> and --window-geometry and without --lang (the argv
//                               lists come from the shell's "shelltest: argv" log lines,
//                               MFBE_SMOKE_LOG)
//   MFBE_SMOKE_RESTART_FAIL     1 = with MFBE_SMOKE_RESTART: the shell cannot start the new
//                               instance (MFBE_RELAUNCH_PROGRAM points nowhere); the page must
//                               show the failure (dialog-restart-failed) and the old process
//                               must stay alive
//
// Fallback if a future CEF/Playwright pair regresses: puppeteer-core (`puppeteer.connect({
// browserURL })`) or raw CDP via chrome-remote-interface; both talk to the same endpoint.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function fail(message) {
  console.error(`SHELL SMOKE FAILED: ${message}`);
  process.exit(1);
}

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0) {
  fail('usage: node tools/shell-smoke.mjs <cdp-port>');
}

// Resolve playwright from the UI workspace (ui/node_modules), not from a global install.
const requireFromUi = createRequire(path.join(root, 'ui', 'package.json'));
let chromium;
try {
  ({ chromium } = requireFromUi('playwright'));
} catch {
  try {
    ({ chromium } = requireFromUi('@playwright/test'));
  } catch {
    fail('playwright is not installed in ui/node_modules (run `npm ci` in ui/)');
  }
}

process.env.PW_CHROMIUM_ATTACH_TO_OTHER = '1';

const expectTitle = process.env.MFBE_SMOKE_EXPECT_TITLE ?? 'mfbe-smoke';
const expectSelector = process.env.MFBE_SMOKE_EXPECT_SELECTOR ?? '#menubar';
const openFile = process.env.MFBE_SMOKE_OPEN_FILE ?? '';
const expectText = process.env.MFBE_SMOKE_EXPECT_TEXT ?? '';
const checkAbout = process.env.MFBE_SMOKE_ABOUT === '1';
const restartVariant = process.env.MFBE_SMOKE_RESTART ?? '';
const restartMustFail = process.env.MFBE_SMOKE_RESTART_FAIL === '1';
// SC-005: the restarted editor is back with the document within 15 s of the user's Yes.
const restartBudgetMs = 15_000;
const screenshotPath = path.resolve(
  root,
  process.env.MFBE_SMOKE_SCREENSHOT ?? path.join('build', 'shell-smoke.png'),
);
const timeoutMs = Number(process.env.MFBE_SMOKE_TIMEOUT_MS ?? 30_000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForPage(browser) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    // Prefer a real document over about:blank / DevTools targets.
    const page =
      pages.find((p) => /^https?:/.test(p.url())) ??
      pages.find((p) => !p.url().startsWith('devtools://')) ??
      pages[0];
    if (page) {
      return page;
    }
    await sleep(250);
  }
  throw new Error(`no page appeared within ${timeoutMs} ms`);
}

// The UI sets document.title to "<file>[*] - Maxima Fiction Book Editor"; the shell mirrors it
// into the window title (CefDisplayHandler::OnTitleChange), so the page title is what the
// window shows.
function titleMatches(title) {
  if (!title.includes(expectTitle)) {
    return false;
  }
  if (openFile) {
    return title.startsWith(`${path.basename(openFile)} - `);
  }
  return true;
}

async function waitForTitle(page) {
  const deadline = Date.now() + timeoutMs;
  let title = '';
  while (Date.now() < deadline) {
    title = await page.title();
    if (titleMatches(title)) {
      return title;
    }
    await sleep(250);
  }
  const wanted = openFile
    ? `"${path.basename(openFile)} - ${expectTitle}"`
    : `a title containing "${expectTitle}"`;
  throw new Error(`expected ${wanted} but got "${title}" (url ${page.url()})`);
}

// Help > About (T137): opened only when the real UI's Help menu exists; the dialog itself may
// be absent in an older bundle, which is reported rather than failed.
async function checkAboutDialog(page) {
  const helpMenu = page.locator('[data-testid="menu-help"]');
  if ((await helpMenu.count()) === 0) {
    console.log('about:         Help menu not present (stub page) - skipped');
    return;
  }
  await helpMenu.click();
  const aboutItem = page.locator('[data-testid="menu-help-about"]');
  try {
    await aboutItem.waitFor({ state: 'visible', timeout: 5_000 });
  } catch {
    console.log('about:         Help > About entry not found - skipped');
    await page.keyboard.press('Escape');
    return;
  }
  await aboutItem.click();
  const dialog = page.locator('[data-testid="dialog-about"]');
  try {
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    console.log('about:         [data-testid="dialog-about"] did not appear - skipped');
    await page.keyboard.press('Escape');
    return;
  }
  const text = (await dialog.innerText()).replace(/\s+/g, ' ').trim();
  if (!text.includes(expectTitle)) {
    throw new Error(`About dialog does not mention "${expectTitle}": ${text.slice(0, 200)}`);
  }
  const shotPath = screenshotPath.replace(/\.png$/, '-about.png');
  await page.screenshot({ path: shotPath });
  console.log(`about:         dialog shown (${text.slice(0, 80)}...) screenshot ${shotPath}`);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
}

/* ---------------------------------------------------------------------------------------- */
/* Restart of the editor by itself (feature 003 US3)                                        */
/* ---------------------------------------------------------------------------------------- */

// A JSON-RPC call to the in-process core over its WebSocket (the page URL carries the token):
// app.info tells the process id of the editor, which the shell and the core share.
async function coreRpc(pageUrl, method, params) {
  const url = new URL(pageUrl);
  const token = url.searchParams.get('token');
  if (!token) {
    throw new Error(`the page URL has no token: ${pageUrl}`);
  }
  const socket = new WebSocket(`ws://${url.host}/rpc?token=${encodeURIComponent(token)}`);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error(`cannot connect to the core at ${url.host}`)), {
      once: true,
    });
  });
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method}: no answer in ${timeoutMs} ms`)), timeoutMs);
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data));
        if (message.id !== 1) {
          return;
        }
        clearTimeout(timer);
        if (message.error) {
          reject(new Error(`${method}: ${message.error.message} (${message.error.code})`));
        } else {
          resolve(message.result);
        }
      });
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }));
    });
  } finally {
    socket.close();
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

// The argument lists (argv[1..]) of every editor started during this run, in start order, as
// the test-hook shell prints them to its log ("shelltest: argv [...]"; shell-smoke.sh passes
// the log's path in MFBE_SMOKE_LOG). Chromium rewrites /proc/<pid>/cmdline, so the process
// itself is the only faithful source.
function startedArgvs() {
  const log = process.env.MFBE_SMOKE_LOG;
  if (!log) {
    return [];
  }
  const lines = fs.readFileSync(log, 'utf8').split('\n');
  const argvs = [];
  for (const line of lines) {
    const match = /^shelltest: argv (\[.*\])$/.exec(line);
    if (match) {
      argvs.push(JSON.parse(match[1]));
    }
  }
  return argvs;
}

// Position and size of the window as the page sees them (the client area, below the window
// manager's title bar), plus whether it fills the work area: as wide as the area, starting at
// its left edge and reaching its bottom edge - a maximised window under a decorating window
// manager (openbox) keeps a title bar above the client area.
async function windowState(page) {
  return page.evaluate(() => {
    const left = window.screen.availLeft ?? 0;
    const top = window.screen.availTop ?? 0;
    return {
      x: window.screenX,
      y: window.screenY,
      width: window.outerWidth,
      height: window.outerHeight,
      maximized:
        window.screenX <= left + 2 &&
        window.outerWidth >= window.screen.availWidth - 2 &&
        window.screenY + window.outerHeight >= top + window.screen.availHeight - 2,
    };
  });
}

function formatState(state) {
  return `${state.x},${state.y},${state.width},${state.height}${state.maximized ? ',max' : ''}`;
}

async function waitUntil(what, condition, budgetMs) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await sleep(100);
  }
  throw new Error(`${what} did not happen within ${budgetMs} ms`);
}

// Switches the interface language in Settings - to Ukrainian, or to Russian when the interface
// is Ukrainian already (the runs of one smoke share their settings) - and answers Yes to
// "Restart now?". Returns the language chosen and the time of the Yes click.
async function askForRestart(page) {
  const current = await page.evaluate(() => document.documentElement.lang);
  const language = current === 'uk' ? 'ru' : 'uk';
  await page.locator('[data-testid="menu-tools"]').click();
  const item = page.locator('[data-testid="menu-tools-settings"]');
  await item.waitFor({ state: 'visible', timeout: timeoutMs });
  await item.click();
  const settings = page.locator('[data-testid="dialog-settings"]');
  await settings.waitFor({ state: 'visible', timeout: timeoutMs });
  console.log(`restart:       Settings open (interface "${current}", choosing "${language}")`);
  await settings.locator('[data-testid="settings-view-language"]').selectOption(language);
  await settings.locator('[data-testid="dialog-settings-button-ok"]').click();
  const prompt = page.locator('[data-testid="dialog-restart-prompt"]');
  await prompt.waitFor({ state: 'visible', timeout: timeoutMs });
  console.log('restart:       "Restart now?" shown');
  const yes = prompt.locator('[data-testid="dialog-restart-prompt-button-yes"]');
  await yes.waitFor({ state: 'visible', timeout: timeoutMs });
  const asked = Date.now();
  await yes.click();
  return { language, asked };
}

// Connects to the CDP port again once a new browser process answers there.
async function reconnect(deadline) {
  let lastError = 'no attempt';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        return await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: timeoutMs });
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error?.message ?? String(error);
    }
    await sleep(200);
  }
  throw new Error(`the restarted editor's CDP endpoint did not come back (${lastError})`);
}

async function checkRestart(page) {
  const oldPid = (await coreRpc(page.url(), 'app.info')).pid;
  if (!Number.isInteger(oldPid) || oldPid <= 0 || !processAlive(oldPid)) {
    throw new Error(`app.info.pid ${oldPid} is not a running process`);
  }
  const before = await windowState(page);
  const startedBefore = startedArgvs();
  const oldArgv = startedBefore.at(-1) ?? [];
  console.log(`restart:       editor pid ${oldPid}, window ${formatState(before)}`);
  console.log(`restart:       argv ${JSON.stringify(oldArgv)}`);
  if (restartVariant === 'max' && !before.maximized) {
    throw new Error(`the window should be maximised before the restart, got ${formatState(before)}`);
  }
  if (restartVariant === 'normal' && before.maximized) {
    throw new Error(`the window should not be maximised before the restart, got ${formatState(before)}`);
  }

  const { language, asked } = await askForRestart(page);

  if (restartMustFail) {
    // The shell could not start the new instance: the page says so and everything stays.
    const failed = page.locator('[data-testid="dialog-restart-failed"]');
    await failed.waitFor({ state: 'visible', timeout: timeoutMs });
    const text = (await failed.innerText()).replace(/\s+/g, ' ').trim();
    console.log(`restart:       failure reported: "${text.slice(0, 160)}"`);
    if (!/nonexistent|No such file|не вдалося|not be restarted/i.test(text)) {
      throw new Error(`the failure message does not name the reason: ${text}`);
    }
    await failed.locator('[data-testid="dialog-restart-failed-button-ok"]').click();
    await failed.waitFor({ state: 'hidden', timeout: timeoutMs });
    await sleep(1000);
    if (!processAlive(oldPid)) {
      throw new Error(`the editor (pid ${oldPid}) exited although the restart failed`);
    }
    const again = await coreRpc(page.url(), 'app.info');
    if (again.pid !== oldPid) {
      throw new Error(`a different editor answers after the failed restart: pid ${again.pid}`);
    }
    await page.screenshot({ path: screenshotPath });
    console.log(`restart:       the editor (pid ${oldPid}) is still running; screenshot ${screenshotPath}`);
    return;
  }

  // The old process exits, a new one comes up on the same CDP port with the book open.
  const deadline = asked + restartBudgetMs;
  await waitUntil(`the exit of pid ${oldPid}`, () => !processAlive(oldPid), restartBudgetMs);
  console.log(`restart:       pid ${oldPid} exited after ${Date.now() - asked} ms`);
  const restarted = await reconnect(deadline + timeoutMs);
  try {
    const newPage = await waitForPage(restarted);
    await newPage.waitForLoadState('domcontentloaded', { timeout: timeoutMs });
    await waitForTitle(newPage);
    const ready = Date.now() - asked;
    console.log(`restart:       the book is open again after ${ready} ms`);
    if (ready > restartBudgetMs) {
      throw new Error(`the restart took ${ready} ms, more than the ${restartBudgetMs} ms of SC-005`);
    }
    const info = await coreRpc(newPage.url(), 'app.info');
    const newPid = info.pid;
    if (newPid === oldPid || !processAlive(newPid)) {
      throw new Error(`the restarted editor has pid ${newPid} (old ${oldPid})`);
    }
    const startedAfter = startedArgvs();
    if (startedAfter.length !== startedBefore.length + 1) {
      throw new Error(
        `expected one more editor start in the log, found ${startedAfter.length - startedBefore.length}`,
      );
    }
    const argv = startedAfter.at(-1);
    console.log(`restart:       new pid ${newPid}, argv ${JSON.stringify(argv)}`);
    const waitIndex = argv.indexOf('--wait-for-exit');
    if (waitIndex < 0 || argv[waitIndex + 1] !== String(oldPid)) {
      throw new Error(`the new instance was not told to wait for pid ${oldPid}`);
    }
    const geometryIndex = argv.indexOf('--window-geometry');
    if (geometryIndex < 0 || !/^-?\d+,-?\d+,\d+,\d+(,max)?$/.test(argv[geometryIndex + 1] ?? '')) {
      throw new Error('the new instance got no --window-geometry');
    }
    const geometry = argv[geometryIndex + 1];
    if ((restartVariant === 'max') !== geometry.endsWith(',max')) {
      throw new Error(`--window-geometry ${geometry} does not match the ${restartVariant} window`);
    }
    if (argv.at(-1) !== openFile) {
      throw new Error(`the new instance was not given the book ${openFile} as FILE`);
    }
    if (argv.some((arg) => arg === '--lang' || arg.startsWith('--lang=') || arg === '--new')) {
      throw new Error('--lang / --new must not be carried over');
    }
    // The start-up options of the old instance (the debugging port, the sandbox choice) stay;
    // its own --window-geometry and FILE were replaced.
    for (const kept of oldArgv) {
      if (
        (kept.startsWith('--remote-debugging-port') ||
          kept === '--no-sandbox' ||
          kept.startsWith('--ozone-platform')) &&
        !argv.includes(kept)
      ) {
        throw new Error(`${kept} was not carried over`);
      }
    }
    const lang = await newPage.evaluate(() => document.documentElement.lang);
    if (lang !== language) {
      throw new Error(`the restarted interface is "${lang}", not the chosen "${language}"`);
    }
    console.log(`restart:       interface language "${lang}" as chosen`);
    const after = await windowState(newPage);
    console.log(`restart:       window ${formatState(after)} (was ${formatState(before)})`);
    if (restartVariant === 'max') {
      if (!after.maximized) {
        throw new Error(`the restarted window is not maximised: ${formatState(after)}`);
      }
    } else {
      for (const key of ['x', 'y', 'width', 'height']) {
        if (Math.abs(after[key] - before[key]) > 2) {
          throw new Error(`window ${key} moved from ${before[key]} to ${after[key]}`);
        }
      }
    }
    const bookShown = await newPage.locator('[data-testid="body-editor"]').innerText();
    if (bookShown.trim().length === 0) {
      throw new Error('the Body view is empty after the restart');
    }
    await newPage.screenshot({ path: screenshotPath });
    console.log(`restart:       OK (${restartVariant}); screenshot ${screenshotPath}`);
  } finally {
    await restarted.close().catch(() => {});
  }
}

let browser;
try {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: timeoutMs });
} catch (error) {
  fail(`connectOverCDP(127.0.0.1:${port}) failed: ${error?.message ?? error}`);
}

try {
  const page = await waitForPage(browser);
  await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs });
  const title = await waitForTitle(page);
  await page.locator(expectSelector).first().waitFor({ state: 'visible', timeout: timeoutMs });

  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath });

  const viewport = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  console.log(`page url:      ${page.url()}`);
  console.log(`page title:    ${title}`);
  console.log(`selector:      ${expectSelector} visible`);
  console.log(`viewport:      ${viewport.w}x${viewport.h}`);
  console.log(`screenshot:    ${screenshotPath}`);

  // File given on the command line (mfbe <file>): the Body view shows its text.
  if (openFile) {
    const body = page.locator('[data-testid="body-editor"]');
    await body.waitFor({ state: 'visible', timeout: timeoutMs });
    const deadline = Date.now() + timeoutMs;
    let bodyText = '';
    while (Date.now() < deadline) {
      bodyText = (await body.innerText()).trim();
      if (bodyText.length > 0 && (!expectText || bodyText.includes(expectText))) {
        break;
      }
      await sleep(250);
    }
    if (bodyText.length === 0) {
      throw new Error(`the Body view is empty after opening ${openFile}`);
    }
    if (expectText && !bodyText.includes(expectText)) {
      throw new Error(`the Body view does not contain "${expectText}" (got "${bodyText.slice(0, 120)}")`);
    }
    console.log(`open file:     ${path.basename(openFile)} shown in the Body view (${bodyText.length} chars)`);
  }

  if (checkAbout) {
    await checkAboutDialog(page);
  }

  // The editor restarts itself (feature 003 US3): the first connection ends with the old
  // process; checkRestart() connects to the new one on the same port.
  if (restartVariant) {
    if (restartVariant !== 'normal' && restartVariant !== 'max') {
      throw new Error(`MFBE_SMOKE_RESTART must be "normal" or "max", got "${restartVariant}"`);
    }
    if (!openFile) {
      throw new Error('MFBE_SMOKE_RESTART needs MFBE_SMOKE_OPEN_FILE (the book to reopen)');
    }
    await checkRestart(page);
  }

  // Optional: the shell was started with MFBE_SHELL_SELFTEST=messagebox (dev/test builds) and
  // shows a native message box ~2 s after start-up as a second CDP page (data: URL). Click OK
  // and let shell-smoke.sh verify the shell's "selftest: messagebox button=ok" line.
  if (process.env.MFBE_SMOKE_MESSAGEBOX === '1') {
    const deadline = Date.now() + timeoutMs;
    let dialogPage;
    while (Date.now() < deadline && !dialogPage) {
      dialogPage = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((p) => p.url().startsWith('data:text/html'));
      if (!dialogPage) {
        await sleep(250);
      }
    }
    if (!dialogPage) {
      throw new Error(`message box page did not appear within ${timeoutMs} ms`);
    }
    const okButton = dialogPage.locator('[data-testid="msgbox-ok"]');
    await okButton.waitFor({ state: 'visible', timeout: timeoutMs });
    const messageText = await dialogPage.locator('#message').innerText();
    const shotPath = screenshotPath.replace(/\.png$/, '-messagebox.png');
    await dialogPage.screenshot({ path: shotPath });
    console.log(`message box:   "${messageText.split('\n')[0]}" (screenshot ${shotPath})`);
    await okButton.click();
    console.log('message box:   OK clicked');
  }

  console.log('SHELL SMOKE OK');
  process.exitCode = 0;
} catch (error) {
  console.error(`SHELL SMOKE FAILED: ${error?.message ?? error}`);
  // What the page showed when the check failed (the first page, if it is still there).
  const failedShot = screenshotPath.replace(/\.png$/, '-failed.png');
  const pages = browser.contexts().flatMap((context) => context.pages());
  const shown = pages.find((p) => /^https?:/.test(p.url()));
  if (shown) {
    await shown
      .screenshot({ path: failedShot })
      .then(() => console.error(`SHELL SMOKE FAILED: screenshot ${failedShot}`))
      .catch(() => {});
  }
  process.exitCode = 1;
} finally {
  // For a connected (not launched) browser this only disconnects; the shell keeps running
  // until shell-smoke.sh terminates it.
  await browser.close().catch(() => {});
}
