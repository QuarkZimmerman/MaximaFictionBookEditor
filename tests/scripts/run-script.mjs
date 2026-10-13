#!/usr/bin/env node
/**
 * Script equivalence harness (T100): runs one script package headlessly on a fixture book and
 * prints the resulting FB2 text (normalised) so it can be compared with a stored snapshot of
 * the original FictionBook Editor's output (or with a previous run).
 *
 *   node tests/scripts/run-script.mjs <script-dir|script-id> <book.fb2> [--out result.xml]
 *        [--answer <value>]... [--select <nodeId>[:from[:to]]]
 *        [--select-range <fromNodeId>:<offset>-<toNodeId>:<offset>] [--tree-node <nodeId>]
 *        [--snapshot <file>] [--update] [--timeout <ms>] [--core <mfbe-core>]
 *        [--ui-dist <dir>] [--keep]
 *
 *   --answer        pre-answers the script's dialogs in order: a button id for message boxes
 *                   (`ok`, `yes`, `no`, `cancel`...), text for prompts (`cancel` cancels) and a
 *                   JSON object for forms (`{"prefix":"n_"}`; `cancel` cancels). The "script is
 *                   still running" prompt (30 s without `mfbe` activity) takes the next answer
 *                   only when it is `wait` or `cancel`; otherwise it is answered with Wait
 *   --select        selects a text block (whole block or `[from, to)`) before the run
 *   --select-range  selects from an offset in one text block to an offset in another (both in
 *                   the mounted window) - the multi-block selections of 09/01, 09/03, 18/09
 *   --tree-node     runs a `kind: "tree"` script with this node as `ctx.treeNode`
 *   --snapshot      compares the normalised XML with the file; `--update` (re)writes it
 *   --timeout       gives up after this many milliseconds (default 120000; exit code 1)
 *   --keep          keeps the temporary data dir (prints its path)
 *
 * How it works: starts `mfbe-core serve --test-hooks` with a temporary data dir whose
 * `scripts/` folder contains a copy of the package, opens the built UI in headless Chromium
 * (Playwright), opens the book, runs the script through the `window.__mfbeTest.scripts` hooks,
 * answers dialogs from the `--answer` queue and asks the core for `doc.toXml`. A failing
 * script is reported with the text of the editor's error dialog (`Script error: <message> at
 * line L, column C`), which the harness dismisses so the run can finish. Exit code 0 on
 * success (and matching snapshot), 1 on a script failure, a timeout or a snapshot mismatch, 2
 * on usage / environment errors. Requires the UI bundle (`cd ui && npm run build`) and the
 * core binary (`MFBE_CORE_BIN` or `--core`, default `build/linux-core-debug/bin/mfbe-core`).
 * `tests/scripts/run-all.mjs` runs every snapshot of `snapshots/suite.json` through this file.
 *
 * Normalisation: CRLF -> LF, trailing whitespace trimmed, the `<program-used>`, `<date>` and
 * `<id>` of document-info and binary payloads elided so snapshots do not drift.
 */

import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");

function usage(message) {
  if (message) console.error(`run-script: ${message}`);
  console.error(
    "usage: node tests/scripts/run-script.mjs <script-dir|script-id> <book.fb2> [--out file] " +
      "[--answer value]... [--select nodeId[:from[:to]]] " +
      "[--select-range fromNodeId:offset-toNodeId:offset] [--tree-node nodeId] " +
      "[--snapshot file] [--update] [--timeout ms] [--core bin] [--ui-dist dir] [--keep]",
  );
  process.exit(2);
}

/** `n7:3-n12:0` -> `{ anchor: {nodeId: 'n7', offset: 3}, head: {nodeId: 'n12', offset: 0} }`. */
export function parseSelectRange(text) {
  const match = /^([^:\s]+):(\d+)-([^:\s]+):(\d+)$/.exec(text);
  if (!match) return null;
  return {
    anchor: { nodeId: match[1], offset: Number(match[2]) },
    head: { nodeId: match[3], offset: Number(match[4]) },
  };
}

function parseArgs(argv) {
  const options = {
    positional: [],
    answers: [],
    out: null,
    select: null,
    selectRange: null,
    treeNode: null,
    snapshot: null,
    update: false,
    timeout: 120_000,
    core:
      process.env.MFBE_CORE_BIN ??
      path.join(REPO_ROOT, "build", "linux-core-debug", "bin", "mfbe-core"),
    uiDist: process.env.MFBE_UI_DIST ?? path.join(REPO_ROOT, "ui", "dist"),
    keep: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) usage(`${arg} needs a value`);
      i += 1;
      return argv[i];
    };
    switch (arg) {
      case "--out":
        options.out = next();
        break;
      case "--answer":
        options.answers.push(next());
        break;
      case "--select":
        options.select = next();
        break;
      case "--select-range":
        options.selectRange = parseSelectRange(next());
        if (!options.selectRange)
          usage(
            "--select-range expects <fromNodeId>:<offset>-<toNodeId>:<offset>",
          );
        break;
      case "--tree-node":
        options.treeNode = next();
        break;
      case "--snapshot":
        options.snapshot = next();
        break;
      case "--update":
        options.update = true;
        break;
      case "--timeout":
        options.timeout = Number(next());
        if (!Number.isFinite(options.timeout) || options.timeout <= 0)
          usage("--timeout expects a positive number of milliseconds");
        break;
      case "--core":
        options.core = next();
        break;
      case "--ui-dist":
        options.uiDist = next();
        break;
      case "--keep":
        options.keep = true;
        break;
      case "--help":
      case "-h":
        usage();
        break;
      default:
        if (arg.startsWith("--")) usage(`unknown option ${arg}`);
        options.positional.push(arg);
    }
  }
  if (options.positional.length !== 2)
    usage("expected <script-dir|script-id> and <book.fb2>");
  return options;
}

/** Strips volatile parts so two runs of the same logic produce identical text. */
export function normaliseXml(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(
      /<program-used>[^<]*<\/program-used>/g,
      "<program-used>…</program-used>",
    )
    .replace(
      /(<document-info>[\s\S]*?)<date[^>]*>[^<]*<\/date>/,
      "$1<date>…</date>",
    )
    .replace(/(<document-info>[\s\S]*?)<id>[^<]*<\/id>/, "$1<id>…</id>")
    .replace(/(<binary\b[^>]*>)[\s\S]*?(<\/binary>)/g, "$1…$2")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .trim();
}

async function startCore(binary, dataDir, uiDist) {
  if (!existsSync(binary)) usage(`core binary not found: ${binary}`);
  if (!existsSync(path.join(uiDist, "index.html")))
    usage(`UI bundle not found: ${uiDist} (cd ui && npm run build)`);
  const child = spawn(
    binary,
    ["serve", "--test-hooks", "--data-dir", dataDir, "--ui", uiDist],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const stderr = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const ready = await new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(
      () => reject(new Error(`core did not start\n${stderr.join("")}`)),
      30_000,
    );
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      for (const line of buffer.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        try {
          const value = JSON.parse(line);
          if (typeof value.port === "number") {
            clearTimeout(timer);
            resolve(value);
          }
        } catch {
          // partial line
        }
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`core exited with ${code}\n${stderr.join("")}`));
    });
  });
  return {
    child,
    baseURL: `http://127.0.0.1:${ready.port}/?token=${encodeURIComponent(ready.token)}`,
    async stop() {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await new Promise((resolve) => setTimeout(resolve, 300));
        if (child.exitCode === null) child.kill("SIGKILL");
      }
    },
  };
}

async function loadPlaywright() {
  const candidates = [
    path.join(REPO_ROOT, "ui", "node_modules", "playwright", "index.mjs"),
    path.join(
      REPO_ROOT,
      "ui",
      "node_modules",
      "@playwright",
      "test",
      "index.mjs",
    ),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return import(pathToFileURL(candidate).href);
  }
  usage("Playwright is not installed (cd ui && npm ci)");
  return null;
}

/**
 * Answers the script's dialogs from the queue as they appear, until the run promise settled.
 * The host shows the modal `dialog-script-error` after the state left `running` and resolves
 * the run only once it is dismissed, so the loop keeps polling (and dismisses that dialog,
 * recording its text) while the run is not settled yet. Returns the error dialog's text.
 */
async function answerDialogs(page, answers, log, runPromise) {
  const queue = [...answers];
  let settled = false;
  const settle = () => {
    settled = true;
  };
  runPromise.then(settle, settle);
  let errorText = null;
  for (;;) {
    if (settled) return errorText;
    const errorDialog = page.getByTestId("dialog-script-error");
    if (await errorDialog.count()) {
      errorText = (
        await errorDialog
          .getByTestId("dialog-script-error-text")
          .innerText()
          .catch(() => "")
      ).trim();
      log(`error dialog: ${errorText}`);
      const ok = errorDialog.getByTestId("dialog-script-error-button-ok");
      if (await ok.count()) await ok.click();
      else await errorDialog.locator("button").first().click();
      await page.waitForTimeout(50);
      continue;
    }
    const running = await page.evaluate(
      () => window.__mfbeTest?.scripts?.state()?.status === "running",
    );
    if (!running) {
      // Finished (or failed): wait for the run promise or the error dialog to show up.
      await page.waitForTimeout(50);
      continue;
    }
    const message = page.getByTestId("dialog-script-message");
    const prompt = page.getByTestId("dialog-script-prompt");
    const form = page.getByTestId("dialog-script-form");
    if (await message.count()) {
      const answer = queue.shift() ?? "ok";
      const text = await message
        .getByTestId("dialog-script-message-text")
        .innerText()
        .catch(() => "");
      log(
        `message box ${JSON.stringify(text.trim().slice(0, 160))} -> ${answer}`,
      );
      const button = message.getByTestId(
        `dialog-script-message-button-${answer}`,
      );
      if (await button.count()) await button.click();
      else await message.locator("button").first().click();
    } else if (await prompt.count()) {
      const answer = queue.shift() ?? "";
      log(`prompt -> ${answer}`);
      if (answer === "cancel")
        await prompt.getByTestId("dialog-script-prompt-button-cancel").click();
      else {
        await prompt.getByTestId("dialog-script-prompt-input").fill(answer);
        const ok = prompt.getByTestId("dialog-script-prompt-button-ok");
        if (await ok.count()) await ok.click();
        else
          await prompt.getByTestId("dialog-script-prompt-button-yes").click();
      }
    } else if (await form.count()) {
      const answer = queue.shift() ?? "{}";
      log(`form -> ${answer}`);
      if (answer === "cancel")
        await form.getByTestId("dialog-script-form-button-cancel").click();
      else {
        const values = JSON.parse(answer);
        for (const [id, value] of Object.entries(values)) {
          const field = form.getByTestId(`dialog-script-form-field-${id}`);
          const tag = await field
            .evaluate((el) => `${el.tagName}:${el.getAttribute("type") ?? ""}`)
            .catch(() => "");
          if (tag.startsWith("FIELDSET")) {
            await form
              .getByTestId(`dialog-script-form-field-${id}-${value}`)
              .check();
          } else if (tag === "INPUT:checkbox") {
            await field.setChecked(!!value);
          } else if (tag.startsWith("SELECT")) {
            await field.selectOption(
              Array.isArray(value) ? value.map(String) : String(value),
            );
          } else {
            await field.fill(String(value));
          }
        }
        await form.getByTestId("dialog-script-form-button-ok").click();
      }
    } else {
      const stillRunning = page.getByTestId("dialog-script-running");
      if (await stillRunning.count()) {
        // The watchdog prompt: `wait` / `cancel` from the queue when given, else Wait.
        const answer =
          queue[0] === "wait" || queue[0] === "cancel" ? queue.shift() : "wait";
        log(`still-running prompt -> ${answer}`);
        await stillRunning
          .getByTestId(`dialog-script-running-button-${answer}`)
          .click();
      }
    }
    await page.waitForTimeout(50);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const [scriptArg, bookArg] = options.positional;
  const book = path.resolve(bookArg);
  if (!existsSync(book)) usage(`book not found: ${book}`);
  const log = (text) => console.error(`run-script: ${text}`);

  const dataDir = mkdtempSync(path.join(tmpdir(), "mfbe-run-script-"));
  let scriptId = scriptArg;
  const scriptDir = path.resolve(scriptArg);
  if (existsSync(path.join(scriptDir, "script.json"))) {
    // Copy the package into the temporary user layer under its group folder (if any).
    const manifest = JSON.parse(
      readFileSync(path.join(scriptDir, "script.json"), "utf8"),
    );
    const group = path.basename(path.dirname(scriptDir));
    const target = path.join(
      dataDir,
      "scripts",
      group,
      path.basename(scriptDir),
    );
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(scriptDir, target, { recursive: true });
    const groupJson = path.join(path.dirname(scriptDir), "group.json");
    if (existsSync(groupJson))
      cpSync(groupJson, path.join(path.dirname(target), "group.json"));
    scriptId = manifest.id ?? `${group}/${path.basename(scriptDir)}`;
  }

  const core = await startCore(options.core, dataDir, options.uiDist);
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();
  let exitCode = 0;
  try {
    const page = await browser.newPage();
    page.on("pageerror", (error) => log(`page error: ${error.message}`));
    await page.goto(core.baseURL);
    await page.getByTestId("app-root").waitFor();
    await page.waitForFunction(
      () => (window.__mfbeTest?.scripts?.list().length ?? -1) >= 0,
      null,
      {
        timeout: 20_000,
      },
    );
    // The book is opened through the queued native dialog (fed over the core's WebSocket)
    // and File > Open, exactly like a user would.
    const token = new URL(core.baseURL).searchParams.get("token");
    const port = new URL(core.baseURL).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/rpc?token=${token}`);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener(
        "error",
        () => reject(new Error("cannot connect to the core")),
        { once: true },
      );
    });
    let nextId = 1;
    const call = (method, params) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        const onMessage = (event) => {
          const message = JSON.parse(String(event.data));
          if (message.id !== id) return;
          ws.removeEventListener("message", onMessage);
          if (message.error)
            reject(new Error(`${method}: ${message.error.message}`));
          else resolve(message.result);
        };
        ws.addEventListener("message", onMessage);
        ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      });
    await call("test.enqueueDialog", {
      method: "dialog.openFile",
      result: { paths: [book] },
    });
    await page.getByTestId("menu-file").click();
    await page.getByTestId("menu-file-open").click();
    await page.getByTestId("body-editor").waitFor({ timeout: 60_000 });
    await page.waitForFunction(
      () => window.__mfbeTest.scripts.document() !== null,
    );

    if (options.select) {
      const [nodeId, from, to] = options.select.split(":");
      const selected = await page.evaluate(
        ([id, a, b]) => window.__mfbeTest.scripts.select(id, a, b),
        [
          nodeId,
          from === undefined ? undefined : Number(from),
          to === undefined ? undefined : Number(to),
        ],
      );
      if (!selected) log(`warning: could not select ${options.select}`);
    }
    if (options.selectRange) {
      const selected = await page.evaluate(
        ([anchor, head]) => window.__mfbeTest.scripts.selectRange(anchor, head),
        [options.selectRange.anchor, options.selectRange.head],
      );
      if (!selected) {
        const { anchor, head } = options.selectRange;
        log(
          `warning: could not select ${anchor.nodeId}:${anchor.offset}-${head.nodeId}:${head.offset}`,
        );
      }
    }

    log(`running ${scriptId} on ${path.basename(book)}`);
    const runPromise = page.evaluate(
      ([id, treeNodeId]) =>
        window.__mfbeTest.scripts.run(id, treeNodeId ? { treeNodeId } : {}),
      [scriptId, options.treeNode],
    );
    await page.waitForTimeout(100);
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `timeout: the script did not finish within ${options.timeout} ms`,
            ),
          ),
        options.timeout,
      );
    });
    let result;
    try {
      const errorText = await Promise.race([
        answerDialogs(page, options.answers, log, runPromise),
        timeout,
      ]);
      result = await runPromise;
      if (errorText && !result.message) result.message = errorText;
    } catch (error) {
      log(error.message);
      // A hung script: cancel it so the document can still be dumped for diagnosis.
      await page
        .evaluate(() => window.__mfbeTest.scripts.cancel())
        .catch(() => {});
      result = { status: "timeout", message: error.message };
    } finally {
      clearTimeout(timer);
    }
    if (result.status !== "done") {
      log(`script ${result.status}: ${result.message ?? ""}`);
      exitCode = 1;
    }
    const xml = normaliseXml(
      await page.evaluate(() => window.__mfbeTest.scripts.toXml()),
    );
    if (options.out) {
      writeFileSync(options.out, `${xml}\n`);
      log(`wrote ${options.out}`);
    } else if (!options.snapshot) {
      process.stdout.write(`${xml}\n`);
    }
    if (options.snapshot) {
      if (options.update || !existsSync(options.snapshot)) {
        mkdirSync(path.dirname(options.snapshot), { recursive: true });
        writeFileSync(options.snapshot, `${xml}\n`);
        log(
          `snapshot ${options.update ? "updated" : "created"}: ${options.snapshot}`,
        );
      } else {
        const expected = normaliseXml(readFileSync(options.snapshot, "utf8"));
        if (expected === xml) {
          log(`snapshot matches: ${options.snapshot}`);
        } else {
          log(`snapshot differs: ${options.snapshot}`);
          const a = expected.split("\n");
          const b = xml.split("\n");
          for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
            if (a[i] !== b[i]) {
              log(
                `  first difference at line ${i + 1}:\n  - ${a[i] ?? "<eof>"}\n  + ${b[i] ?? "<eof>"}`,
              );
              break;
            }
          }
          exitCode = 1;
        }
      }
    }
    ws.close();
  } finally {
    await browser.close();
    await core.stop();
    if (options.keep) log(`data dir kept: ${dataDir}`);
    else rmSync(dataDir, { recursive: true, force: true });
  }
  process.exit(exitCode);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`run-script: ${error.message}`);
    process.exit(2);
  });
}
