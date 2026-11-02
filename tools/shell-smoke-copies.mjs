#!/usr/bin/env node
// CDP helper of the copies smoke (feature 008, tools/shell-smoke.sh MFBE_SMOKE_COPIES=1).
//
//   node tools/shell-smoke-copies.mjs <port[,port...]> wait <test-id>   # prints the port showing it
//   node tools/shell-smoke-copies.mjs <port> click <test-id>
//   node tools/shell-smoke-copies.mjs <port> freeze                      # page busy for 120 s
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
} else {
  fail(`unknown action ${action}`);
}
