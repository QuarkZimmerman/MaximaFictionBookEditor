#!/usr/bin/env node
// CDP helper of the copies smoke (feature 008, tools/shell-smoke.sh MFBE_SMOKE_COPIES=1).
//
//   node tools/shell-smoke-copies.mjs <port[,port...]> wait <test-id>   # prints the port showing it
//   node tools/shell-smoke-copies.mjs <port> click <test-id>
//   node tools/shell-smoke-copies.mjs <port> freeze                      # page busy for 120 s
//   node tools/shell-smoke-copies.mjs <port> notes-sequence <book name>  # feature 008, T039
//
// Exit 0 on success, 1 with a message on stderr otherwise.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(path.join(root, "ui", "package.json"))(
  "playwright",
);
process.env.PW_CHROMIUM_ATTACH_TO_OTHER = "1";

const [portsArg, action, testId] = process.argv.slice(2);
const ports = (portsArg ?? "").split(",").filter(Boolean).map(Number);
const timeoutMs = Number(process.env.MFBE_SMOKE_COPIES_TIMEOUT_MS ?? 30000);

function fail(message) {
  console.error(`shell-smoke-copies: ${message}`);
  process.exit(1);
}

async function pageOf(port) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
    timeout: 10000,
  });
  const page = browser
    .contexts()
    .flatMap((c) => c.pages())
    .find((p) => !p.url().startsWith("devtools:"));
  if (!page) {
    await browser.close();
    throw new Error(`no page on port ${port}`);
  }
  return { browser, page };
}

if (action === "wait") {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const port of ports) {
      try {
        const { browser, page } = await pageOf(port);
        const visible = await page.getByTestId(testId).isVisible();
        await browser.close();
        if (visible) {
          console.log(port);
          process.exit(0);
        }
      } catch {
        // the copy is starting or busy; try again
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail(`no page on ${portsArg} showed ${testId} within ${timeoutMs} ms`);
} else if (action === "click") {
  const { browser, page } = await pageOf(ports[0]);
  await page.getByTestId(testId).click({ timeout: timeoutMs });
  await browser.close();
} else if (action === "freeze") {
  const { browser, page } = await pageOf(ports[0]);
  await page.evaluate(() => {
    setTimeout(() => {
      const end = Date.now() + 120000;
      while (Date.now() < end) {
        // the page's main thread answers nothing for two minutes (FR-011)
      }
    }, 0);
  });
  await browser.close();
} else if (action === "notes-sequence") {
  // Two runs of "Add a footnote and go to its section" through the real Scripts menu, in a book
  // without notes (the 0.0.5 freeze); after each the page must answer within a second.
  const { browser, page } = await pageOf(ports[0]);
  const deadline = Date.now() + timeoutMs;
  while (!(await page.title()).startsWith(testId) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const paragraphs = ["n7", "n9"];
  for (const [index, nodeId] of paragraphs.entries()) {
    const selected = await page.evaluate(
      (id) => window.__mfbeTest?.scripts?.select(id, 1, 1) ?? false,
      nodeId,
    );
    if (!selected)
      fail(`run ${index + 1}: could not place the caret in ${nodeId}`);
    await page.getByTestId("menu-scripts").click();
    await page.getByTestId("menu-scripts-02_footnotes").hover();
    await page
      .getByTestId("menu-scripts-02_footnotes-02/add-footnote-go-to-note")
      .click();
    let status = null;
    const runDeadline = Date.now() + timeoutMs;
    while (Date.now() < runDeadline) {
      status = await page.evaluate(
        () => window.__mfbeTest?.scripts?.state()?.status ?? null,
      );
      if (status && status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (status !== "done") fail(`run ${index + 1}: the script ended ${status}`);
    const started = Date.now();
    await page.evaluate(() => 1);
    const answered = Date.now() - started;
    if (answered > 1000)
      fail(`run ${index + 1}: the page answered only after ${answered} ms`);
    console.log(`run ${index + 1}: done, the page answered in ${answered} ms`);
  }
  await browser.close();
} else {
  fail(`unknown action ${action}`);
}
