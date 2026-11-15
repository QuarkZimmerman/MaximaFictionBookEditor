#!/usr/bin/env node
// Feature 015 (T018): checks, in a running editor reached over DevTools, that the user items of
// tests/fixtures/user-folders put into a designated folder are in effect - the genre my_test_genre
// in Choose a genre, the script "My test script" in the Scripts menu, the misnamed genres.txt
// listed as passed over in Settings > Other, and the template's USER TEMPLATE MARKER after
// File > New. Used by the package checks of the AppImage, deb, rpm, Windows and macOS editors.
//
//   node tools/user-folders-check.mjs <cdp port> [--no-passed-over]
//
// Exit 0 when everything is in effect, 1 with the reason on stderr otherwise.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(path.join(root, "ui", "package.json"))("playwright");
process.env.PW_CHROMIUM_ATTACH_TO_OTHER = "1";

const [portArg, ...flags] = process.argv.slice(2);
const checkPassedOver = !flags.includes("--no-passed-over");

function fail(message) {
  console.error(`user-folders-check: ${message}`);
  process.exit(1);
}

if (!portArg) fail("usage: user-folders-check.mjs <cdp port> [--no-passed-over]");
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${portArg}`, { timeout: 15000 });
try {
  const page = browser
    .contexts()
    .flatMap((c) => c.pages())
    .find((p) => !p.url().startsWith("devtools:"));
  if (!page) fail(`no page on port ${portArg}`);
  const timeout = 15000;

  // 1. The template after File > New, on the untouched start-up document (no question to save).
  await page.getByTestId("menu-file").click({ timeout });
  await page.getByTestId("menu-file-new").click({ timeout });
  await page.waitForFunction(
    () => (document.querySelector('[data-testid="body-editor"]')?.textContent ?? "").includes("USER TEMPLATE MARKER"),
    undefined,
    { timeout },
  ).catch(() => fail("File > New does not use the user's template"));
  console.error("user-folders-check: File > New uses the user's template");
  // 2. The genre file's genre in Choose a genre.
  await page.keyboard.press("Escape");
  await page.getByTestId("view-description").click({ timeout });
  await page.getByTestId("description-genre-add").click({ timeout });
  await page.getByTestId("genre-picker-filter").fill("my_test_genre", { timeout });
  const list = page.getByTestId("genre-picker-list");
  await list.waitFor({ timeout });
  if (!((await list.textContent()) ?? "").includes("my_test_genre"))
    fail("my_test_genre is not in Choose a genre");
  console.error("user-folders-check: the user's genre is listed");
  await page.keyboard.press("Escape");

  // 3. The script in the Scripts menu.
  await page.getByTestId("menu-scripts").click({ timeout });
  const popup = page.getByTestId("menu-scripts-popup");
  await popup.waitFor({ timeout });
  await page.waitForFunction(
    () =>
      (document.querySelector('[data-testid="menu-scripts-popup"]')?.textContent ?? "").includes(
        "My test script",
      ),
    undefined,
    { timeout },
  ).catch(() => fail("My test script is not in the Scripts menu"));
  console.error("user-folders-check: the user's script is in the Scripts menu");
  await page.keyboard.press("Escape");

  // 4. The misnamed genre file listed in Settings > Other.
  if (checkPassedOver) {
    await page.getByTestId("menu-tools").click({ timeout });
    await page.getByTestId("menu-tools-settings").click({ timeout });
    await page.getByTestId("settings-tab-other").click({ timeout });
    const passed = page.getByTestId("settings-passed-over-genres");
    await passed.waitFor({ timeout }).catch(() => fail("Settings > Other lists no passed-over genre file"));
    if (!((await passed.textContent()) ?? "").includes("genres.txt"))
      fail("genres.txt is not listed as passed over in Settings > Other");
    console.error("user-folders-check: the misnamed genre file is listed in Settings");
    await page.keyboard.press("Escape");
  }

  console.log("user-folders-check: OK");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await browser.close().catch(() => undefined);
}
