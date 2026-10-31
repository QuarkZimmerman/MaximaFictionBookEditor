#!/usr/bin/env node
/**
 * Script equivalence suite (T127): runs every snapshot of `tests/scripts/snapshots/suite.json`
 * through `run-script.mjs` (one headless Chromium + core at a time) and reports pass / fail
 * per snapshot. Exit code 1 when any snapshot fails or a converted package has no snapshot
 * at all; 2 on usage / environment errors.
 *
 *   node tests/scripts/run-all.mjs [--group <NN>]... [--filter <text>] [--update]
 *        [--timeout <ms>] [--core <mfbe-core>] [--ui-dist <dir>] [--verbose] [--json <file>]
 *        [--allow-missing-uk]
 *
 *   --group     only the snapshots of this group folder (`01`, `17`, `tree`, `fixtures`); repeatable
 *   --filter    only the snapshots whose path contains the text
 *   --update    re-record instead of comparing (passed to run-script.mjs; use after a reviewed
 *               runtime change, never to paper over a difference)
 *   --timeout   per-snapshot time limit in milliseconds (default 120000)
 *   --verbose   print the harness log of every run (default: only of the failed ones)
 *   --json      also write the per-snapshot results to this file
 *   --allow-missing-uk  report bundled packages and groups without Ukrainian names and
 *               descriptions instead of failing (feature 007: until the recheck of its US4 is
 *               done, T089)
 *
 * `suite.json` entries are `{ snapshot, script, book, args }` (paths relative to the repository
 * root); `tests/scripts/tools/extract-suite.mjs` documents how they were derived from the
 * conversion notes. A group may keep its entries in `snapshots/<group>/suite.json` instead
 * (feature 007: the 2.7.9 groups), which the run adds to the main manifest. The summary counts the converted packages (`scripts/<group>/<script>/
 * script.json`), the snapshots, the passed / failed runs and, from the inventory of the classic
 * scripts (`tests/scripts/audit/inventory-279.json`, feature 007), the scripts by status - the
 * not converted ones among them. The run also fails when an inventory entry names a package
 * without a `script.json` or without a snapshot, and when a bundled package lacks its Ukrainian
 * name or description or a bundled group its Ukrainian name (spec FR-026 of feature 007).
 * Requires the built UI (`cd ui && npm run build`) and the core binary (`MFBE_CORE_BIN` or
 * `--core`); `run-all.sh` is a thin wrapper for CI.
 */

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const SUITE = path.join(HERE, "snapshots", "suite.json");
const HARNESS = path.join(HERE, "run-script.mjs");
const INVENTORY = path.join(HERE, "audit", "inventory-279.json");

function usage(message) {
  if (message) console.error(`run-all: ${message}`);
  console.error(
    "usage: node tests/scripts/run-all.mjs [--group NN]... [--filter text] [--update] " +
      "[--timeout ms] [--core bin] [--ui-dist dir] [--verbose] [--json file] [--allow-missing-uk]",
  );
  process.exit(2);
}

function parseArgs(argv) {
  const options = {
    groups: [],
    filter: null,
    update: false,
    timeout: null,
    core: null,
    uiDist: null,
    verbose: false,
    json: null,
    allowMissingUk: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) usage(`${arg} needs a value`);
      i += 1;
      return argv[i];
    };
    switch (arg) {
      case "--group":
        options.groups.push(next());
        break;
      case "--filter":
        options.filter = next();
        break;
      case "--update":
        options.update = true;
        break;
      case "--timeout":
        options.timeout = next();
        break;
      case "--core":
        options.core = next();
        break;
      case "--ui-dist":
        options.uiDist = next();
        break;
      case "--verbose":
        options.verbose = true;
        break;
      case "--json":
        options.json = next();
        break;
      case "--allow-missing-uk":
        options.allowMissingUk = true;
        break;
      case "--help":
      case "-h":
        usage();
        break;
      default:
        usage(`unknown option ${arg}`);
    }
  }
  return options;
}

/** Folders of every converted package (`scripts/<group>/<script>/script.json`). */
function convertedPackages() {
  const root = path.join(REPO_ROOT, "scripts");
  const out = [];
  if (!existsSync(root)) return out;
  for (const group of readdirSync(root, { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    for (const entry of readdirSync(path.join(root, group.name), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      if (existsSync(path.join(root, group.name, entry.name, "script.json")))
        out.push(path.posix.join("scripts", group.name, entry.name));
    }
  }
  return out.sort();
}

/**
 * The inventory of the classic scripts (feature 007, data-model §7.4): the entries by status,
 * and every entry whose package is missing (no `script.json`) or has no snapshot in the suite.
 */
function inventoryReport(suite, groups = []) {
  const inventory = JSON.parse(readFileSync(INVENTORY, "utf8"));
  const counts = {};
  const problems = [];
  const covered = new Set(suite.map((entry) => entry.script));
  for (const entry of inventory.entries) {
    counts[entry.status] = (counts[entry.status] ?? 0) + 1;
    if (!entry.package || !inSelectedGroups(entry.package, groups)) continue;
    if (!existsSync(path.join(REPO_ROOT, entry.package, "script.json")))
      problems.push(
        `${entry.source}: package ${entry.package} has no script.json`,
      );
    else if (!covered.has(entry.package))
      problems.push(
        `${entry.source}: package ${entry.package} has no snapshot`,
      );
  }
  return { counts, problems };
}

/**
 * Spec FR-026 of feature 007: every bundled package carries `name.uk` and `description.uk`, every
 * bundled group's `group.json` its `names.uk`.
 */
/**
 * Whether a package folder (`scripts/<NN>_<name>/<package>`) or a group folder
 * (`scripts/<NN>_<name>`) belongs to the groups of `--group` (all when none is given): with
 * `--group` the run is that group's gate, blind to packages of other groups still in progress.
 */
function inSelectedGroups(dir, groups) {
  if (!groups.length) return true;
  const folder = dir.split("/")[1] ?? "";
  return groups.some(
    (group) => folder === group || folder.startsWith(`${group}_`),
  );
}

function missingUkrainian(packages, groups = []) {
  const missing = [];
  const hasUk = (texts) =>
    Boolean(texts) && typeof texts.uk === "string" && texts.uk.trim() !== "";
  for (const dir of packages) {
    const manifest = JSON.parse(
      readFileSync(path.join(REPO_ROOT, dir, "script.json"), "utf8"),
    );
    if (!hasUk(manifest.name)) missing.push(`${dir}: name.uk`);
    if (!hasUk(manifest.description)) missing.push(`${dir}: description.uk`);
  }
  const root = path.join(REPO_ROOT, "scripts");
  for (const group of readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, group.name, "group.json");
    if (!group.isDirectory() || !existsSync(file)) continue;
    if (!inSelectedGroups(`scripts/${group.name}`, groups)) continue;
    const data = JSON.parse(readFileSync(file, "utf8"));
    if (!hasUk(data.names)) missing.push(`scripts/${group.name}: names.uk`);
  }
  return missing;
}

function runOne(entry, options) {
  const args = [
    HARNESS,
    path.join(REPO_ROOT, entry.script),
    path.join(REPO_ROOT, entry.book),
    ...entry.args,
    "--snapshot",
    path.join(HERE, "snapshots", entry.snapshot),
  ];
  if (options.update) args.push("--update");
  if (options.timeout) args.push("--timeout", options.timeout);
  if (options.core) args.push("--core", options.core);
  if (options.uiDist) args.push("--ui-dist", options.uiDist);
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, args, {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = [];
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => output.push(chunk));
    child.on("close", (code, signal) => {
      resolve({
        snapshot: entry.snapshot,
        script: entry.script,
        ok: code === 0,
        code: code ?? `signal ${signal}`,
        ms: Date.now() - started,
        log: output.join(""),
      });
    });
  });
}

function pad(text, width) {
  const value = String(text);
  return value.length >= width
    ? value
    : value + " ".repeat(width - value.length);
}

/** The main manifest and every group's own `snapshots/<group>/suite.json`. */
function loadSuite() {
  const suite = JSON.parse(readFileSync(SUITE, "utf8"));
  const snapshots = path.dirname(SUITE);
  for (const entry of readdirSync(snapshots, { withFileTypes: true })) {
    const own = path.join(snapshots, entry.name, "suite.json");
    if (entry.isDirectory() && existsSync(own))
      suite.push(...JSON.parse(readFileSync(own, "utf8")));
  }
  return suite;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(SUITE)) usage(`manifest not found: ${SUITE}`);
  const suite = loadSuite();
  const selected = suite.filter((entry) => {
    const group = entry.snapshot.split("/")[0];
    if (options.groups.length && !options.groups.includes(group)) return false;
    if (options.filter && !entry.snapshot.includes(options.filter))
      return false;
    return true;
  });
  if (selected.length === 0) usage("no snapshot matches the selection");

  const packages = convertedPackages();
  const covered = new Set(suite.map((entry) => entry.script));
  const ownPackages = packages.filter((dir) =>
    inSelectedGroups(dir, options.groups),
  );
  const uncovered = ownPackages.filter((dir) => !covered.has(dir));
  const inventory = inventoryReport(suite, options.groups);
  const ukMissing = missingUkrainian(ownPackages, options.groups);
  for (const entry of suite) {
    if (!existsSync(path.join(REPO_ROOT, entry.script, "script.json")))
      console.error(
        `run-all: ${entry.snapshot}: package not found: ${entry.script}`,
      );
  }

  const results = [];
  const width = Math.max(...selected.map((e) => e.snapshot.length));
  console.log(
    `run-all: ${selected.length} snapshot(s)${options.update ? " (update)" : ""}`,
  );
  for (const entry of selected) {
    const result = await runOne(entry, options);
    results.push(result);
    const status = result.ok ? "pass" : `FAIL (exit ${result.code})`;
    console.log(`  ${pad(result.snapshot, width)}  ${status}  ${result.ms} ms`);
    if (!result.ok || options.verbose) {
      for (const line of result.log.trimEnd().split("\n"))
        console.log(`      ${line}`);
    }
  }

  // Per-group table.
  const groups = new Map();
  for (const result of results) {
    const group = result.snapshot.split("/")[0];
    const row = groups.get(group) ?? { snapshots: 0, passed: 0, failed: 0 };
    row.snapshots += 1;
    if (result.ok) row.passed += 1;
    else row.failed += 1;
    groups.set(group, row);
  }
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log("");
  console.log("group      snapshots  passed  failed");
  for (const [group, row] of [...groups.entries()].sort()) {
    console.log(
      `${pad(group, 10)} ${pad(row.snapshots, 10)} ${pad(row.passed, 7)} ${row.failed}`,
    );
  }
  console.log("");
  console.log(`converted packages : ${packages.length}`);
  console.log(`snapshots in suite : ${suite.length} (${selected.length} run)`);
  console.log(`passed             : ${passed}`);
  console.log(`failed             : ${failed}`);
  console.log(`packages without a snapshot : ${uncovered.length}`);
  for (const dir of uncovered) console.log(`  ${dir}`);
  const statuses = Object.entries(inventory.counts)
    .sort()
    .map(([status, count]) => `${status} ${count}`)
    .join(", ");
  console.log(`classic scripts (inventory-279.json) : ${statuses}`);
  console.log(
    `not converted (per the inventory)   : ${inventory.counts.notConverted ?? 0}`,
  );
  console.log(`inventory problems : ${inventory.problems.length}`);
  for (const problem of inventory.problems) console.log(`  ${problem}`);
  console.log(
    `missing Ukrainian names and descriptions : ${ukMissing.length}` +
      (ukMissing.length && options.allowMissingUk
        ? " (allowed until the recheck is done: --allow-missing-uk)"
        : ""),
  );
  for (const item of ukMissing.slice(
    0,
    options.allowMissingUk ? 10 : ukMissing.length,
  ))
    console.log(`  ${item}`);
  if (options.allowMissingUk && ukMissing.length > 10)
    console.log(`  ... and ${ukMissing.length - 10} more`);

  if (options.json) {
    mkdirSync(path.dirname(path.resolve(options.json)), { recursive: true });
    writeFileSync(
      options.json,
      `${JSON.stringify(
        {
          packages: packages.length,
          uncovered,
          inventory: inventory.counts,
          inventoryProblems: inventory.problems,
          missingUkrainian: ukMissing,
          results,
        },
        null,
        2,
      )}\n`,
    );
  }
  const ukFails = ukMissing.length > 0 && !options.allowMissingUk;
  process.exit(
    failed > 0 ||
      uncovered.length > 0 ||
      inventory.problems.length > 0 ||
      ukFails
      ? 1
      : 0,
  );
}

main().catch((error) => {
  console.error(`run-all: ${error.message}`);
  process.exit(2);
});
