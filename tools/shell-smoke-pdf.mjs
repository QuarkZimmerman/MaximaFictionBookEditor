#!/usr/bin/env node
// CDP helper of the PDF export smoke (feature 014, T057; tools/shell-smoke.sh MFBE_SMOKE_PDF=1):
// in the real shell, with the book open, File > Export > Export as PDF... writes the PDF the Save
// dialog proposes in `folder` (the book's folder; the name from the description, the size A4). The shell's native GTK Save dialog is accepted with Return through xdotool on the
// shell's display (MFBE_SMOKE_DISPLAY_FILE), and the pages are printed by the shell's own print
// service (CEF's PrintToPDF in a hidden browser) - the path the journeys' print seam stands in
// for. tools/ci/verapdf.sh then checks the file.
//
//   node tools/shell-smoke-pdf.mjs <cdp port> <folder>     # prints the PDF's path, last line
//
// Exit 0 when the file is written, 1 with a message on stderr otherwise.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(path.join(root, "ui", "package.json"))(
  "playwright",
);
process.env.PW_CHROMIUM_ATTACH_TO_OTHER = "1";

const [portArg, outArg] = process.argv.slice(2);
const timeoutMs = Number(process.env.MFBE_SMOKE_PDF_TIMEOUT_MS ?? 300000);

function fail(message) {
  console.error(`shell-smoke-pdf: ${message}`);
  process.exit(1);
}

// The shell's display (DISPLAY, XAUTHORITY), as tools/shell-smoke.sh records it.
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

// Accepts the visible native window titled exactly `title` with Return.
async function acceptDialog(title) {
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
      // xdotool exits with 1 while nothing matches
    }
    if (ids.length > 0) {
      // Focused, then a real key (XTEST): GTK ignores keys sent to a window (XSendEvent).
      execFileSync("xdotool", ["windowactivate", "--sync", ids[0]], { env });
      execFileSync("xdotool", ["key", "Return"], { env });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  fail(`no visible window titled "${title}" within 30 s`);
}

if (!portArg || !outArg) {
  fail("usage: shell-smoke-pdf.mjs <cdp port> <folder>");
}
const folder = path.resolve(outArg);
const pdfs = () => readdirSync(folder).filter((name) => name.toLowerCase().endsWith(".pdf"));
const before = new Set(pdfs());
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${portArg}`, {
  timeout: 10000,
});
try {
  const page = browser
    .contexts()
    .flatMap((c) => c.pages())
    .find((p) => !p.url().startsWith("devtools:"));
  if (!page) fail(`no page on port ${portArg}`);
  // The smoke before this one may have left a menu or a tooltip open.
  await page.keyboard.press("Escape");
  await page.getByTestId("menu-file").click({ timeout: 10000 });
  await page.getByTestId("menu-file-export").waitFor({ timeout: 10000 });
  await page.getByTestId("menu-file-export").hover({ timeout: 10000 });
  const item = page.getByTestId("menu-file-export-exportPdf");
  await item.waitFor({ timeout: 10000 });
  console.log(
    `shell-smoke-pdf: Export as PDF... (aria-disabled=${await item.getAttribute("aria-disabled")})`,
  );
  await item.click({ timeout: 10000 });
  // The Save dialog is the shell's own (GTK): its proposal is accepted (D2, D3).
  await acceptDialog("Export as PDF");
  // The export starts with its progress window (D4); without it, the state tells why.
  const started = await page
    .getByTestId("modal-job")
    .waitFor({ timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  if (!started) {
    const state = await page.evaluate(() => ({
      status: document.querySelector('[data-testid="status-message"]')
        ?.textContent,
      dialogs: [...document.querySelectorAll('[data-testid^="dialog-"]')].map(
        (d) => d.getAttribute("data-testid"),
      ),
      menus: [...document.querySelectorAll('[role="menu"]')].length,
    }));
    // The whole display, native dialogs included, for the log (ImageMagick's import, when there).
    const shot = path.join(root, "build", "shell-smoke-pdf-failure.png");
    try {
      execFileSync("import", ["-window", "root", shot], { env: displayEnv() });
      console.error(`shell-smoke-pdf: the display: ${shot}`);
    } catch {
      // no ImageMagick: the state alone
    }
    fail(`the export did not start: ${JSON.stringify(state)}`);
  }
  const status = page.getByTestId("status-message");
  const failed = page.getByTestId("dialog-pdf-export-failed");
  const summary = page.getByTestId("dialog-pdf-export-summary");
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await failed.isVisible()) {
      fail(`the export failed: ${await failed.textContent()}`);
    }
    if (await summary.isVisible()) {
      console.log(
        `shell-smoke-pdf: summary: ${(await summary.textContent())?.trim()}`,
      );
      await summary.getByRole("button", { name: "OK" }).click();
      break;
    }
    if (((await status.textContent()) ?? "").includes("Exported to")) break;
    if (Date.now() > deadline)
      fail(`no end of the export in ${timeoutMs} ms`);
    await page.waitForTimeout(250);
  }
  const written = pdfs().filter((name) => !before.has(name));
  if (written.length !== 1) fail(`expected one new PDF in ${folder}, found ${written.length}`);
  const out = path.join(folder, written[0]);
  if (statSync(out).size === 0) fail(`${out} is empty`);
  console.error(`shell-smoke-pdf: the shell printed ${out} (${statSync(out).size} bytes)`);
  console.log(out);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await browser.close();
}
