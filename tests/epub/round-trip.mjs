#!/usr/bin/env node
/**
 * Feature 012 (T063; D34; SC-013): the EPUB round trip over a list of books. Each book is opened in the
 * editor, exported to EPUB, imported again, and compared with tests/epub/compare-fb2.js; only the
 * differences outside D34's list are reported. The work is done by the journey
 * ui/tests/e2e/us7-epub-round-trip.spec.ts against the real core and interface.
 *
 *   node tests/epub/round-trip.mjs [--core <mfbe-core>] [--report <file.json>] <book.fb2 | list.txt>...
 *
 * A `.txt` argument is a list, one path per line (`#` starts a comment), as tests/corpus/sample-1-50.txt.
 * The core defaults to MFBE_CORE_BIN, else build/linux-core-debug/bin/mfbe-core; the interface is ui/dist
 * (build it first). Exits 0 when every book comes back.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const args = process.argv.slice(2);
let core = process.env.MFBE_CORE_BIN ?? path.join(REPO, 'build/linux-core-debug/bin/mfbe-core');
let report = path.join(REPO, 'build/epub-round-trip.json');
const books = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--core') core = path.resolve(args[++i]);
  else if (args[i] === '--report') report = path.resolve(args[++i]);
  else if (args[i].endsWith('.txt')) {
    books.push(
      ...readFileSync(args[i], 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#')),
    );
  } else books.push(path.resolve(args[i]));
}
if (books.length === 0) {
  console.error('usage: node tests/epub/round-trip.mjs [--core <mfbe-core>] [--report <file>] <books or lists>');
  process.exit(2);
}
if (!existsSync(core)) {
  console.error(`round-trip: no core at ${core} (build it, or pass --core)`);
  process.exit(2);
}

const list = path.join(mkdtempSync(path.join(os.tmpdir(), 'mfbe-round-trip-list-')), 'books.txt');
writeFileSync(list, `${books.join('\n')}\n`);
// No shell: the arguments reach Playwright as they are.
const run = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['playwright', 'test', 'us7-epub-round-trip', '--reporter=line'],
  {
    cwd: path.join(REPO, 'ui'),
    stdio: 'inherit',
    env: { ...process.env, MFBE_CORE_BIN: core, MFBE_ROUND_TRIP_BOOKS: list, MFBE_ROUND_TRIP_REPORT: report },
  },
);

if (existsSync(report)) {
  const results = JSON.parse(readFileSync(report, 'utf8'));
  const failed = results.filter((result) => result.failure || result.againInvalid);
  const differing = results.filter(
    (result) => !result.failure && !result.invalid && result.differences.length > 0,
  );
  const invalid = results.filter((result) => !result.failure && result.invalid);
  const exact = results.filter((result) => !result.failure && result.differences.length === 0);
  console.log(
    `round-trip: ${results.length} book(s), ${exact.length} back as they were, ${differing.length} ` +
      `with differences, ${invalid.length - invalid.filter((r) => r.differences.length === 0).length} ` +
      `invalid originals with differences, ${failed.length} failed (report: ${report})`,
  );
  for (const result of [...failed, ...differing, ...invalid.filter((r) => r.differences.length > 0)]) {
    console.log(`\n${result.book}`);
    if (result.failure) console.log(`  failed: ${result.failure}`);
    if (result.againInvalid) {
      console.log(`  the book imported again is not valid: ${result.againInvalid[0]}`);
      if (result.againFile) console.log(`  kept as ${result.againFile}`);
    }
    if (result.invalid) console.log(`  invalid original: ${result.invalid[0]}`);
    for (const line of result.differences.slice(0, 12)) console.log(`  ${line}`);
  }
}
process.exit(run.status ?? 1);
