#!/usr/bin/env node
// CDP helper of the PDF import smoke (feature 016, T064; tools/shell-smoke.sh MFBE_SMOKE_PDF_IMPORT=1 on Linux): in
// the real shell, File > Import > PDF File... imports <pdf> through the GTK Open dialog (its location typed with
// xdotool on the shell's display, MFBE_SMOKE_DISPLAY_FILE) and waits for the new book; tools/shell-smoke.sh then
// exits the shell and checks that it and its reader process end within 20 s (D30, DP-4).
//
//   node tools/shell-smoke-pdf-import.mjs <cdp port> <pdf>
//
// Exit 0 when the book is imported, 1 with a message on stderr otherwise.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(path.join(root, "ui", "package.json"))("playwright");
process.env.PW_CHROMIUM_ATTACH_TO_OTHER = "1";
const [portArg, pdfArg] = process.argv.slice(2);

function fail(message) {
  console.error(`shell-smoke-pdf-import: ${message}`);
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

// Types `file` into the visible GTK Open dialog titled `title` and confirms it (real keys: XTEST).
async function answerOpen(title, file) {
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
      // nothing matches yet
    }
    if (ids.length > 0) {
      execFileSync("xdotool", ["windowactivate", "--sync", ids[0]], { env });
      execFileSync("xdotool", ["key", "ctrl+l"], { env });
      await new Promise((resolve) => setTimeout(resolve, 300));
      execFileSync("xdotool", ["type", "--delay", "20", file], { env });
      // The location field may first take Return for its completion; then the dialog takes it.
      for (let i = 0; i < 3; i++) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        try {
          execFileSync("xdotool", ["search", "--onlyvisible", "--name", `^${title}$`], { env, stdio: "ignore" });
        } catch {
          return; // the dialog has closed
        }
        execFileSync("xdotool", ["key", "Return"], { env });
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  fail(`no visible window titled "${title}" within 30 s`);
}

if (!portArg || !pdfArg) fail("usage: shell-smoke-pdf-import.mjs <cdp port> <pdf>");
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${portArg}`, { timeout: 10000 });
try {
  const page = browser
    .contexts()
    .flatMap((c) => c.pages())
    .find((p) => !p.url().startsWith("devtools:"));
  if (!page) fail(`no page on port ${portArg}`);
  await page.keyboard.press("Escape");
  await page.getByTestId("menu-file").click({ timeout: 10000 });
  await page.getByTestId("menu-file-import").hover({ timeout: 10000 });
  const clicked = page.getByTestId("menu-file-import-importPdf").click({ timeout: 120000 }).then(
    () => null,
    (error) => error,
  );
  await answerOpen("Import a PDF book", path.resolve(pdfArg));
  const clickError = await clicked;
  if (clickError) fail(`PDF File...: ${clickError.message}`);
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    // The import ends with its summary - in the status line, or in a window when it has more to say.
    const summary = page.getByTestId("dialog-pdf-import-summary");
    let status = (await page.getByTestId("status-message").textContent()) ?? "";
    if (await summary.isVisible()) {
      status = (await summary.textContent()) ?? "";
      await summary.getByRole("button", { name: "OK" }).click({ timeout: 10000 });
    }
    if (status.includes("Imported from PDF")) {
      console.log(`shell-smoke-pdf-import: ${status.replace(/\s+/g, " ").slice(0, 200)}`);
      // D30: File > Exit; tools/shell-smoke.sh checks that the shell and the reader end. The new book is
      // unsaved: its question is answered No.
      await page.getByTestId("menu-file").click({ timeout: 10000 });
      await page.getByTestId("menu-file-exit").click({ timeout: 10000 });
      const question = page.getByRole("dialog").filter({ hasText: "Save changes to" });
      if (await question.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false))
        await question.getByRole("button", { name: "No" }).click({ timeout: 10000 }).catch(() => undefined);
      console.error("shell-smoke-pdf-import: File > Exit");
      process.exit(0);
    }
    if (await page.getByTestId("dialog-pdf-import-failed").isVisible()) {
      fail(`the import failed: ${await page.getByTestId("dialog-pdf-import-failed").textContent()}`);
    }
    await page.waitForTimeout(200);
  }
  // What the window shows, and the native windows there are, say why.
  const state = await page.evaluate(() => ({
    status: document.querySelector('[data-testid="status-message"]')?.textContent,
    dialogs: [...document.querySelectorAll('[data-testid^="dialog-"], [data-testid="modal-job"]')]
      .filter((e) => e.getBoundingClientRect().width > 0)
      .map((e) => `${e.getAttribute("data-testid")}: ${(e.textContent ?? "").slice(0, 120)}`),
  }));
  let windows = "";
  try {
    windows = execFileSync("xdotool", ["search", "--onlyvisible", "--name", "."], {
      env: displayEnv(),
      encoding: "utf8",
    })
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => execFileSync("xdotool", ["getwindowname", id], { env: displayEnv(), encoding: "utf8" }).trim())
      .join(" | ");
  } catch {
    // no window
  }
  fail(`the import did not end within 120 s: ${JSON.stringify(state)}; windows: ${windows}`);
} finally {
  await browser.close().catch(() => undefined);
}
