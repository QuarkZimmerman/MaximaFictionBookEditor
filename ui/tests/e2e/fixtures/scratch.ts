/**
 * Scratch folders for the journeys' files - copies of books, saved books, exported EPUBs - inside
 * the running test's output folder (test-results/), which Playwright empties at the start of each
 * run. Nothing piles up in the system's temporary folder, on many hosts a small tmpfs: a corpus run
 * of the EPUB journeys once filled it and made the core's own corpus tests fail.
 */

import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';

import { test } from './core';

/** A new folder for the running test's files, named from `prefix`. */
export function scratchDir(prefix: string): string {
  const root = test.info().outputPath('scratch');
  mkdirSync(root, { recursive: true });
  return mkdtempSync(path.join(root, prefix));
}
