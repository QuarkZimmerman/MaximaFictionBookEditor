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
  process.exitCode = 1;
} finally {
  // For a connected (not launched) browser this only disconnects; the shell keeps running
  // until shell-smoke.sh terminates it.
  await browser.close().catch(() => {});
}
