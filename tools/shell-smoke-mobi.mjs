#!/usr/bin/env node
// CDP helper of the MOBI smoke (feature 018, T046; tools/shell-smoke.sh MFBE_SMOKE_MOBI=1 on Linux):
// in the real CEF shell with a book open (in `folder`), runs:
//   1. File > Export > Export as MOBI... through the native GTK Save dialog (accepted with Return via
//      xdotool), waiting for the exported .mobi file in `folder`;
//   2. File > Import > MOBI File... through the native GTK Open dialog (typing that .mobi path via
//      xdotool), waiting for the imported book;
//   3. File > Exit (answering No to "Save changes to..."), after which tools/shell-smoke.sh checks
//      that the shell and all helper processes end cleanly within 20 s (SC-008).
//
//   node tools/shell-smoke-mobi.mjs <cdp port> <folder>
//
// Exit 0 on success, 1 with a message on stderr otherwise.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(path.join(root, "ui", "package.json"))("playwright");
process.env.PW_CHROMIUM_ATTACH_TO_OTHER = "1";
const [portArg, outArg] = process.argv.slice(2);

function fail(message) {
  console.error(`shell-smoke-mobi: ${message}`);
  process.exit(1);
}

function displayEnv() {
  const file = process.env.MFBE_SMOKE_DISPLAY_FILE;
  if (!file) fail("MFBE_SMOKE_DISPLAY_FILE is not set (run through tools/shell-smoke.sh)");
  const env = { ...process.env };
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^(DISPLAY|XAUTHORITY)=(.*)$/.exec(line);
    if (match && match[2]) env[match[1]] = match[2];
  }
  return env;
}

async function acceptSaveDialog(title) {
  const env = displayEnv();
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    let ids = [];
    try {
      ids = execFileSync("xdotool", ["search", "--onlyvisible", "--name", `^${title}$`], {
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      })
        .split(/\s+/)
        .filter(Boolean);
    } catch {
      // not visible yet
    }
    if (ids.length > 0) {
      execFileSync("xdotool", ["windowactivate", "--sync", ids[0]], { env });
      await new Promise((resolve) => setTimeout(resolve, 300));
      execFileSync("xdotool", ["key", "Return"], { env });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  fail(`no visible Save dialog titled "${title}" within 30 s`);
}

async function answerOpenDialog(title, file) {
  const env = displayEnv();
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    let ids = [];
    try {
      ids = execFileSync("xdotool", ["search", "--onlyvisible", "--name", `^${title}$`], {
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      })
        .split(/\s+/)
        .filter(Boolean);
    } catch {
      // not visible yet
    }
    if (ids.length > 0) {
      execFileSync("xdotool", ["windowactivate", "--sync", ids[0]], { env });
      execFileSync("xdotool", ["key", "ctrl+l"], { env });
      await new Promise((resolve) => setTimeout(resolve, 300));
      execFileSync("xdotool", ["type", "--delay", "20", file], { env });
      for (let i = 0; i < 3; i++) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        try {
          execFileSync("xdotool", ["search", "--onlyvisible", "--name", `^${title}$`], {
            env,
            stdio: "ignore",
          });
        } catch {
          return;
        }
        execFileSync("xdotool", ["key", "Return"], { env });
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  fail(`no visible Open dialog titled "${title}" within 30 s`);
}

if (!portArg || !outArg) fail("usage: shell-smoke-mobi.mjs <cdp port> <folder>");
const folder = path.resolve(outArg);
const mobis = () => readdirSync(folder).filter((name) => /\.(mobi|azw3)$/i.test(name));
const before = new Set(mobis());

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${portArg}`, { timeout: 10000 });
try {
  const page = browser
    .contexts()
    .flatMap((c) => c.pages())
    .find((p) => !p.url().startsWith("devtools:"));
  if (!page) fail(`no page on port ${portArg}`);

  // 1. File > Export > Export as MOBI...
  await page.keyboard.press("Escape");
  await page.getByTestId("menu-file").click({ timeout: 10000 });
  await page.getByTestId("menu-file-export").hover({ timeout: 10000 });
  const exportClick = page
    .getByTestId("menu-file-export-exportMobi")
    .click({ timeout: 120000 })
    .then(
      () => null,
      (error) => error,
    );
  await acceptSaveDialog("Export as MOBI");
  const exportClickErr = await exportClick;
  if (exportClickErr) fail(`Export as MOBI...: ${exportClickErr.message}`);

  const exportDeadline = Date.now() + 120000;
  for (;;) {
    if (await page.getByTestId("dialog-mobi-export-failed").isVisible()) {
      fail(`export failed: ${await page.getByTestId("dialog-mobi-export-failed").textContent()}`);
    }
    const expSummary = page.getByTestId("dialog-mobi-export-summary");
    if (await expSummary.isVisible()) {
      await expSummary.getByRole("button").first().click({ timeout: 10000 });
      break;
    }
    const status = (await page.getByTestId("status-message").textContent()) ?? "";
    if (status.includes("Exported to")) break;
    if (Date.now() > exportDeadline) fail("MOBI export did not finish within 120 s");
    await page.waitForTimeout(200);
  }

  const written = mobis().filter((name) => !before.has(name));
  if (written.length !== 1) fail(`expected one new MOBI in ${folder}, found ${written.length}`);
  const exportedPath = path.join(folder, written[0]);
  if (statSync(exportedPath).size === 0) fail(`${exportedPath} is empty`);
  console.log(`shell-smoke-mobi: exported ${exportedPath} (${statSync(exportedPath).size} bytes)`);

  // 2. File > Import > MOBI File...
  await page.keyboard.press("Escape");
  await page.getByTestId("menu-file").click({ timeout: 10000 });
  await page.getByTestId("menu-file-import").hover({ timeout: 10000 });
  const importClick = page
    .getByTestId("menu-file-import-importMobi")
    .click({ timeout: 120000 })
    .then(
      () => null,
      (error) => error,
    );
  await answerOpenDialog("Import a MOBI book", exportedPath);
  const importClickErr = await importClick;
  if (importClickErr) fail(`MOBI File...: ${importClickErr.message}`);

  const importDeadline = Date.now() + 120000;
  for (;;) {
    if (await page.getByTestId("dialog-mobi-import-failed").isVisible()) {
      fail(`import failed: ${await page.getByTestId("dialog-mobi-import-failed").textContent()}`);
    }
    const impSummary = page.getByTestId("dialog-mobi-import-summary");
    if (await impSummary.isVisible()) {
      const txt = (await impSummary.textContent()) ?? "";
      await impSummary.getByRole("button").first().click({ timeout: 10000 });
      console.log(`shell-smoke-mobi: ${txt.replace(/\s+/g, " ").slice(0, 200)}`);
      break;
    }
    const status = (await page.getByTestId("status-message").textContent()) ?? "";
    if (status.includes("Imported from MOBI:")) {
      console.log(`shell-smoke-mobi: ${status}`);
      break;
    }
    if (Date.now() > importDeadline) fail("MOBI import did not finish within 120 s");
    await page.waitForTimeout(200);
  }

  // 3. File > Exit (answer No to unsaved-changes prompt for the imported book)
  await page.getByTestId("menu-file").click({ timeout: 10000 });
  await page
    .getByTestId("menu-file-exit")
    .click({ timeout: 10000 })
    .catch((error) => {
      if (!/closed|disconnected/i.test(String(error))) throw error;
    });
  const question = page.getByRole("dialog").filter({ hasText: "Save changes to" });
  if (await question.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await question
      .getByRole("button", { name: "No" })
      .click({ timeout: 10000 })
      .catch(() => undefined);
  }
  console.error("shell-smoke-mobi: File > Exit");
  process.exit(0);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await browser.close().catch(() => undefined);
}
