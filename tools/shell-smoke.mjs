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
//   MFBE_SMOKE_SETTINGS_FILE    the settings.json of this run (real UI): View > Status Bar
//                               hides the status bar and the file records it
//                               (session.toolbars.status = false) within 10 s, although the
//                               core reports the settings right after the click (a settings.set
//                               of another key, as the start-up version check's record); then
//                               the status bar is shown again and recorded so
//   MFBE_SMOKE_RESTART          normal | max: the editor's restart of itself (feature 003 US3,
//                               SC-005) - Settings > View > Language = Ukrainian (Russian when
//                               the interface is Ukrainian already), OK, Yes in the restart
//                               prompt; the old process (app.info.pid) must exit, a new one come
//                               up on the same CDP port within 15 s with the book open,
//                               <html lang> = the chosen language, the window at the old bounds
//                               (+-2 px) or maximised (max), started with --wait-for-exit
//                               <old pid> and --window-geometry and without --lang (the argv
//                               lists come from the shell's "shelltest: argv" log lines,
//                               MFBE_SMOKE_LOG); the Body caret, put into a known paragraph
//                               before the restart, is back there in the new instance
//                               (feature 004 US8 - the restart remembers the position)
//   MFBE_SMOKE_RESTART_FAIL     1 = with MFBE_SMOKE_RESTART: the shell cannot start the new
//                               instance (MFBE_RELAUNCH_PROGRAM points nowhere); the page must
//                               show the failure (dialog-restart-failed) and the old process
//                               must stay alive
//   MFBE_SMOKE_CLOSE            1 = the window's close button (feature 003 FR-017): the Body is
//                               edited, then the window manager on the shell's display
//                               (MFBE_SMOKE_DISPLAY_FILE: DISPLAY and XAUTHORITY lines, written
//                               by shell-smoke.sh's launcher; openbox) is asked to close the
//                               window with xdotool's Alt+F4 - WM_DELETE_WINDOW, what the
//                               title-bar X sends. "Save changes?" must appear within 2 s and
//                               the editor (app.info.pid) stay; Cancel keeps it open and the
//                               document modified; a second request asks again at once; No
//                               ends the process within 10 s - and positions.json beside the
//                               settings file (MFBE_SMOKE_SETTINGS_FILE) then holds the Body
//                               caret put into a known paragraph before the close (feature
//                               004 US8: the window's close request remembers the position)
//   MFBE_SMOKE_SAVE_AS          1 = the native GTK Save dialog (feature 004 US6, FR-050 /
//                               FR-051): File > New, the author "Толстой Лев Николаевич" and
//                               the title "Война и мир" typed into the Description view, File >
//                               Save As; the GTK dialog (found on the shell's display by its
//                               title, the interface's "Save As" text) must open in the folder
//                               the settings remember (MFBE_SMOKE_SAVE_AS_FOLDER, seeded by
//                               shell-smoke.sh) proposing "Толстой Лев - Война и мир.fb2":
//                               Return through xdotool accepts it and the file must exist under
//                               exactly that name, the window title start with it; a second
//                               Save As with Ctrl+A, "Новая книга.fb2" typed through xdotool
//                               (Cyrillic keysyms under Xvfb) and Return must write that file
//
// Fallback if a future CEF/Playwright pair regresses: puppeteer-core (`puppeteer.connect({
// browserURL })`) or raw CDP via chrome-remote-interface; both talk to the same endpoint.

import { execFileSync } from 'node:child_process';
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
const settingsFile = process.env.MFBE_SMOKE_SETTINGS_FILE ?? '';
// The hidden status bar is in the settings file within this time (the UI saves the toolbar
// flags with a short delay; the Windows journey allows 30 s).
const settingsBudgetMs = 10_000;
const restartVariant = process.env.MFBE_SMOKE_RESTART ?? '';
const restartMustFail = process.env.MFBE_SMOKE_RESTART_FAIL === '1';
// SC-005: the restarted editor is back with the document within 15 s of the user's Yes.
const restartBudgetMs = 15_000;
const checkClose = process.env.MFBE_SMOKE_CLOSE === '1';
const checkSaveAs = process.env.MFBE_SMOKE_SAVE_AS === '1';
const saveAsFolder = process.env.MFBE_SMOKE_SAVE_AS_FOLDER ?? '';
const displayFile = process.env.MFBE_SMOKE_DISPLAY_FILE ?? '';
// FR-017: the close request asks like Exit does - the prompt is there as fast as Exit's.
const closePromptBudgetMs = 2_000;
// After No the editor saves its settings and placement and ends.
const closeExitBudgetMs = 10_000;
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
/* The remembered position (feature 004 US8)                                                 */
/* ---------------------------------------------------------------------------------------- */

// The offset the caret is moved to inside the chosen paragraph (its first characters).
const caretOffset = 4;

// Puts the Body caret into the second paragraph of the first section, `caretOffset` characters
// in (Home, then ArrowRight x4 - the keys the user would press), and returns the structural
// path the status bar shows for it, e.g. "body[1]/section[1]/p[2]".
async function placeCaret(page) {
  const paragraph = page
    .locator('[data-testid="body-editor"] .fb-body > .fb-section > p.fb-p')
    .nth(1);
  await paragraph.waitFor({ state: 'visible', timeout: timeoutMs });
  await paragraph.click({ position: { x: 8, y: 8 } });
  await page.keyboard.press('Home');
  for (let i = 0; i < caretOffset; i += 1) {
    await page.keyboard.press('ArrowRight');
  }
  const statusPath = page.locator('[data-testid="status-path"]');
  await waitUntil(
    'a paragraph path in the status bar',
    async () => /^body\[\d+\](\/[a-z-]+\[\d+\])*\/p\[\d+\]$/.test((await statusPath.innerText()).trim()),
    timeoutMs,
  );
  const shown = (await statusPath.innerText()).trim();
  const offset = await domCaretOffset(page);
  if (offset !== caretOffset) {
    throw new Error(`the caret is at offset ${offset} of ${shown}, expected ${caretOffset}`);
  }
  console.log(`position:      caret placed at ${shown}:${offset}`);
  return shown;
}

// The DOM selection's offset inside its text node (the model offset of a plain paragraph).
function domCaretOffset(page) {
  return page.evaluate(() => {
    const selection = document.getSelection();
    return selection && selection.rangeCount > 0 ? selection.getRangeAt(0).startOffset : -1;
  });
}

// The remembered position of `file` in positions.json beside the settings file, or null.
function storedPosition(file) {
  if (!settingsFile) {
    throw new Error('the positions record needs MFBE_SMOKE_SETTINGS_FILE (set by shell-smoke.sh)');
  }
  const positionsFile = path.join(path.dirname(settingsFile), 'positions.json');
  if (!fs.existsSync(positionsFile)) {
    return null;
  }
  const parsed = JSON.parse(fs.readFileSync(positionsFile, 'utf8'));
  const item = (parsed.items ?? []).find((entry) => entry.path === file);
  return item ? item.position : null;
}

// Asserts that the Body caret of `page` is at `expected` ({path, offset}) and that its paragraph
// is inside the window (the status bar path, the DOM selection, the bounding box).
async function expectCaretRestored(page, expected, what) {
  const statusPath = page.locator('[data-testid="status-path"]');
  await waitUntil(
    `the status bar path ${expected.path} ${what}`,
    async () => (await statusPath.innerText()).trim() === expected.path,
    timeoutMs,
  );
  await waitUntil(
    `the caret offset ${expected.offset} ${what}`,
    async () => (await domCaretOffset(page)) === expected.offset,
    timeoutMs,
  );
  const visible = await page.evaluate(() => {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    let node = selection.getRangeAt(0).startContainer;
    const element = node.nodeType === 1 ? node : node.parentElement;
    const rect = element.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight;
  });
  if (!visible) {
    throw new Error(`the restored caret's paragraph is not inside the window ${what}`);
  }
  console.log(`position:      caret restored at ${expected.path}:${expected.offset} ${what}`);
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

  // The Body caret in a known paragraph: the restart must remember it (feature 004 US8).
  const caretPath = await placeCaret(page);

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
    // The argument list of the new instance: written to the log by a test-hook shell only
    // (MFBE_SHELL_TEST_HOOKS; the release shell of the CI app job prints none - its restart
    // is then judged by what the new instance shows: the book, the language, the window, the
    // caret).
    const startedAfter = startedArgvs();
    if (startedBefore.length === 0) {
      console.log(`restart:       new pid ${newPid} (no "shelltest: argv" lines: a shell without test hooks, argv not checked)`);
    } else {
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
    // The position remembered before the restart was recorded and is back in the new instance.
    const remembered = storedPosition(openFile);
    if (!remembered || remembered.path !== caretPath || remembered.offset !== caretOffset) {
      throw new Error(
        `positions.json does not hold ${caretPath}:${caretOffset} for the book (got ${JSON.stringify(remembered)})`,
      );
    }
    await expectCaretRestored(newPage, { path: caretPath, offset: caretOffset }, 'after the restart');
    await newPage.screenshot({ path: screenshotPath });
    console.log(`restart:       OK (${restartVariant}); screenshot ${screenshotPath}`);
  } finally {
    await restarted.close().catch(() => {});
  }
}

/* ---------------------------------------------------------------------------------------- */
/* The window's close button runs the Exit flow (feature 003 FR-017)                         */
/* ---------------------------------------------------------------------------------------- */

// The X display the shell runs on, as shell-smoke.sh's launcher recorded it.
function shellDisplayEnv() {
  if (!displayFile) {
    throw new Error('MFBE_SMOKE_CLOSE needs MFBE_SMOKE_DISPLAY_FILE (set by shell-smoke.sh)');
  }
  const env = { ...process.env };
  for (const line of fs.readFileSync(displayFile, 'utf8').split('\n')) {
    const match = /^(DISPLAY|XAUTHORITY)=(.*)$/.exec(line);
    if (match && match[2]) {
      env[match[1]] = match[2];
    }
  }
  if (!env.DISPLAY) {
    throw new Error(`${displayFile} names no DISPLAY`);
  }
  return env;
}

// Asks the window manager to close the editor's window, as the title-bar button does: the
// window is activated and Alt+F4 pressed (openbox's default binding sends WM_DELETE_WINDOW).
function requestWindowClose(env) {
  const xdotool = (...args) =>
    execFileSync('xdotool', args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const ids = xdotool('search', '--onlyvisible', '--name', expectTitle).split(/\s+/).filter(Boolean);
  if (ids.length === 0) {
    throw new Error(`no visible window titled "${expectTitle}" on ${env.DISPLAY}`);
  }
  xdotool('windowactivate', '--sync', ids[0]);
  xdotool('key', '--clearmodifiers', 'alt+F4');
  return ids[0];
}

async function checkWindowClose(page) {
  const env = shellDisplayEnv();
  const pid = (await coreRpc(page.url(), 'app.info')).pid;
  if (!Number.isInteger(pid) || pid <= 0 || !processAlive(pid)) {
    throw new Error(`app.info.pid ${pid} is not a running process`);
  }
  const prompt = page.locator('[data-testid="dialog-save-changes"]');

  // Modify the document: the title carries the marker.
  await page.locator('[data-testid="body-editor"] p').first().click();
  await page.keyboard.type('Changed before closing ');
  await waitUntil('the modified marker in the title', async () => (await page.title()).includes('*'), timeoutMs);
  console.log(`close:         document modified ("${await page.title()}"), editor pid ${pid}`);

  // The close button with a modified document: the save prompt, the window stays.
  const first = Date.now();
  const windowId = requestWindowClose(env);
  await prompt.waitFor({ state: 'visible', timeout: closePromptBudgetMs });
  console.log(`close:         window ${windowId} asked to close: "Save changes?" after ${Date.now() - first} ms`);
  if (!processAlive(pid)) {
    throw new Error('the editor exited although the save prompt was up');
  }

  // Cancel: the editor stays open, the document stays modified.
  await prompt.locator('[data-testid="dialog-save-changes-button-cancel"]').click();
  await prompt.waitFor({ state: 'hidden', timeout: timeoutMs });
  await sleep(1000);
  if (!processAlive(pid)) {
    throw new Error('the editor exited although Cancel was chosen');
  }
  if (!(await page.title()).includes('*')) {
    throw new Error('the document lost its modified marker after Cancel');
  }
  console.log('close:         Cancel keeps the editor open and the document modified');

  // The Body caret in a known paragraph: the close request must remember it (feature 004 US8).
  const caretPath = await placeCaret(page);
  if (storedPosition(openFile) !== null) {
    throw new Error('positions.json already holds a position for the book before the close');
  }

  // The close button again, right after Cancel: asked again (no dead time), No closes.
  const second = Date.now();
  requestWindowClose(env);
  await prompt.waitFor({ state: 'visible', timeout: closePromptBudgetMs });
  console.log(`close:         asked again after ${Date.now() - second} ms`);
  await prompt.locator('[data-testid="dialog-save-changes-button-no"]').click();
  await waitUntil(`the exit of pid ${pid}`, () => !processAlive(pid), closeExitBudgetMs);
  console.log(`close:         No: the editor (pid ${pid}) exited after ${Date.now() - second} ms`);

  // positions.json beside the settings file records the caret of the document that was left.
  const remembered = storedPosition(openFile);
  if (!remembered || remembered.path !== caretPath || remembered.offset !== caretOffset) {
    throw new Error(
      `positions.json does not hold ${caretPath}:${caretOffset} for the book (got ${JSON.stringify(remembered)})`,
    );
  }
  console.log(`close:         positions.json remembers ${caretPath}:${caretOffset} for the book`);
}

/* ---------------------------------------------------------------------------------------- */
/* The native GTK Save dialog with the proposed and a typed Cyrillic name (feature 004 US6)  */
/* ---------------------------------------------------------------------------------------- */

const SAVE_AS_AUTHOR = { last: 'Толстой', first: 'Лев', middle: 'Николаевич' };
const SAVE_AS_TITLE = 'Война и мир';
const SAVE_AS_PROPOSED = 'Толстой Лев - Война и мир.fb2';
const SAVE_AS_TYPED = 'Новая книга.fb2';

// The interface text `key` (a.b.c) of the base catalogue of `lang`, without `&` markers: the
// title of the Save As dialog is the interface's own text (cmd.file.saveAs.tooltip).
function catalogueText(lang, key) {
  const file = path.join(root, 'ui', 'src', 'i18n', `${lang}.json`);
  let node = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const part of key.split('.')) {
    node = node?.[part];
  }
  if (typeof node !== 'string') {
    throw new Error(`no "${key}" in ${file}`);
  }
  return node.replace(/&(&?)/g, (_, literal) => literal);
}

function xdotool(env, ...args) {
  return execFileSync('xdotool', args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// The visible window titled exactly `title` on the shell's display, within the step timeout.
async function waitForWindow(env, title) {
  const pattern = `^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let ids = [];
    try {
      ids = xdotool(env, 'search', '--onlyvisible', '--name', pattern).split(/\s+/).filter(Boolean);
    } catch {
      // xdotool exits with 1 while nothing matches
    }
    if (ids.length > 0) {
      return ids[0];
    }
    await sleep(200);
  }
  throw new Error(`no visible window titled "${title}" appeared on ${env.DISPLAY} within ${timeoutMs} ms`);
}

async function fillDescriptionField(page, testId, value) {
  const field = page.locator(`[data-testid="${testId}"]`);
  await field.fill(value);
  await field.blur();
}

// File > Save As through the page's menu, the GTK dialog driven through xdotool: `type` (when
// given) replaces the proposed name (Ctrl+A first), Return saves. The page's "save anyway?"
// prompt of an incomplete description is answered with Yes. Resolves once `file` exists and
// the window title starts with its name.
async function saveThroughGtkDialog(page, env, dialogTitle, file, typed) {
  if (fs.existsSync(file)) {
    throw new Error(`${file} exists before Save As`);
  }
  await page.locator('[data-testid="menu-file"]').click();
  const item = page.locator('[data-testid="menu-file-saveAs"]');
  await item.waitFor({ state: 'visible', timeout: timeoutMs });
  await item.click();
  const dialog = await waitForWindow(env, dialogTitle);
  xdotool(env, 'windowactivate', '--sync', dialog);
  await sleep(500);
  if (typed) {
    xdotool(env, 'key', '--clearmodifiers', 'ctrl+a');
    await sleep(200);
    xdotool(env, 'type', '--delay', '60', typed);
    await sleep(300);
  }
  xdotool(env, 'key', '--clearmodifiers', 'Return');
  const prompt = page.locator('[data-testid="dialog-validation-failed"]');
  await waitUntil(
    `the file ${file} or the validation prompt`,
    async () => fs.existsSync(file) || (await prompt.count()) > 0,
    timeoutMs,
  );
  if ((await prompt.count()) > 0) {
    await prompt.locator('[data-testid="dialog-validation-failed-button-yes"]').click();
  }
  await waitUntil(`the file ${file}`, () => fs.existsSync(file), timeoutMs);
  const name = path.basename(file);
  await waitUntil(
    `the window title starting with "${name}"`,
    async () => (await page.title()).startsWith(`${name} - `),
    timeoutMs,
  );
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes(`<book-title>${SAVE_AS_TITLE}</book-title>`)) {
    throw new Error(`${file} does not hold the book title in UTF-8`);
  }
}

async function checkSaveAsDialog(page) {
  if (!saveAsFolder || !fs.existsSync(saveAsFolder)) {
    throw new Error('MFBE_SMOKE_SAVE_AS needs MFBE_SMOKE_SAVE_AS_FOLDER (seeded by shell-smoke.sh)');
  }
  const env = shellDisplayEnv();
  const lang = await page.evaluate(() => document.documentElement.lang);
  const dialogTitle = catalogueText(lang, 'cmd.file.saveAs.tooltip');
  const untitled = catalogueText(lang, 'app.untitled');

  // File > New, then the author and the title in the Description view.
  await page.locator('[data-testid="menu-file"]').click();
  const item = page.locator('[data-testid="menu-file-new"]');
  await item.waitFor({ state: 'visible', timeout: timeoutMs });
  await item.click();
  await waitUntil(
    `the new document "${untitled}"`,
    async () => (await page.title()).startsWith(`${untitled} - `),
    timeoutMs,
  );
  await page.locator('[data-testid="view-description"]').click();
  await page.locator('[data-testid="description-book-title"]').waitFor({ state: 'visible', timeout: timeoutMs });
  await fillDescriptionField(page, 'description-author-0-last', SAVE_AS_AUTHOR.last);
  await fillDescriptionField(page, 'description-author-0-first', SAVE_AS_AUTHOR.first);
  await fillDescriptionField(page, 'description-author-0-middle', SAVE_AS_AUTHOR.middle);
  await fillDescriptionField(page, 'description-book-title', SAVE_AS_TITLE);
  console.log(`save as:       interface "${lang}", dialog "${dialogTitle}", folder ${saveAsFolder}`);

  // The proposed name, accepted as the dialog shows it.
  const proposed = path.join(saveAsFolder, SAVE_AS_PROPOSED);
  await saveThroughGtkDialog(page, env, dialogTitle, proposed, '');
  console.log(`save as:       "${SAVE_AS_PROPOSED}" proposed by the GTK dialog and saved`);

  // A name typed into the dialog.
  const typed = path.join(saveAsFolder, SAVE_AS_TYPED);
  await saveThroughGtkDialog(page, env, dialogTitle, typed, SAVE_AS_TYPED);
  console.log(`save as:       "${SAVE_AS_TYPED}" typed into the GTK dialog and saved`);

  // The folder lists exactly the two names (the bytes Node decodes as UTF-8).
  const listed = fs.readdirSync(saveAsFolder).sort();
  const expected = [SAVE_AS_PROPOSED, SAVE_AS_TYPED].sort();
  if (JSON.stringify(listed) !== JSON.stringify(expected)) {
    throw new Error(`${saveAsFolder} holds ${JSON.stringify(listed)}, expected ${JSON.stringify(expected)}`);
  }
  await page.screenshot({ path: screenshotPath });
  console.log(`save as:       OK; screenshot ${screenshotPath}`);
}

/* ---------------------------------------------------------------------------------------- */
/* View > Status Bar reaches settings.json (the Windows journey's step, feature 002)         */
/* ---------------------------------------------------------------------------------------- */

// `session.toolbars.status` as the settings file has it (undefined while the file is missing,
// being rewritten or without the key).
function storedStatusFlag() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile, 'utf8'))?.session?.toolbars?.status;
  } catch {
    return undefined;
  }
}

async function toggleStatusBar(page) {
  await page.locator('[data-testid="menu-view"]').click();
  const item = page.locator('[data-testid="menu-view-statusBar"]');
  await item.waitFor({ state: 'visible', timeout: timeoutMs });
  await item.click();
}

// View > Status Bar hides the status bar, and the settings file records it within
// settingsBudgetMs - although the core reports the settings right after the click, as it does
// after every settings.set (here one of another key, like the start-up version check's record
// of its time on a networked machine), with the status bar still shown in that report: the
// window's own flags must not follow such a report (0.0.3 regression seen in the Windows
// journey). Then the status bar is shown again and recorded so, for the runs sharing the file.
async function checkStatusBarSetting(page) {
  const statusbar = page.locator('[data-testid="statusbar"]');
  await statusbar.waitFor({ state: 'visible', timeout: timeoutMs });
  if (storedStatusFlag() === false) {
    throw new Error(`${settingsFile} records a hidden status bar while the status bar is shown`);
  }
  await toggleStatusBar(page);
  await coreRpc(page.url(), 'settings.set', {
    patch: { session: { lastVersionCheck: new Date().toISOString() } },
  });
  await statusbar.waitFor({ state: 'hidden', timeout: timeoutMs });
  const hiddenAt = Date.now();
  await waitUntil(
    `session.toolbars.status = false in ${settingsFile}`,
    () => storedStatusFlag() === false,
    settingsBudgetMs,
  );
  if ((await statusbar.count()) !== 0) {
    throw new Error('the status bar came back after it was hidden');
  }
  console.log(`status bar:    hidden; recorded in ${settingsFile} after ${Date.now() - hiddenAt} ms`);
  await toggleStatusBar(page);
  await statusbar.waitFor({ state: 'visible', timeout: timeoutMs });
  await waitUntil(
    `session.toolbars.status = true in ${settingsFile}`,
    () => storedStatusFlag() === true,
    settingsBudgetMs,
  );
  console.log('status bar:    shown again and recorded');
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

  // View > Status Bar is recorded in the settings file (real UI; not in the restart, close and
  // Save As scenarios, whose runs are about those alone).
  if (settingsFile && !restartVariant && !checkClose && !checkSaveAs) {
    await checkStatusBarSetting(page);
  }

  // The native GTK Save dialog with the proposed and a typed Cyrillic name (feature 004 US6).
  if (checkSaveAs) {
    await checkSaveAsDialog(page);
  }

  // The window's close button runs the Exit flow (feature 003 FR-017); the editor ends.
  if (checkClose) {
    if (!openFile) {
      throw new Error('MFBE_SMOKE_CLOSE needs MFBE_SMOKE_OPEN_FILE (the book to modify)');
    }
    await checkWindowClose(page);
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
