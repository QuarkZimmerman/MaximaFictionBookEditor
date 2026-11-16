#!/usr/bin/env node
/**
 * Feature 016 (SC-007; tasks T046): where the import's paragraphs begin on one page of a book, as the
 * interface's layout analysis (ui/src/features/pdf/import/layout.ts, loaded through the interface's Vite - the
 * same module the import runs) finds them over the whole book. Run by tests/pdf/kinds-calibrate.py:
 *
 *   node tests/pdf/layout-paragraphs.mjs <reader folder> <page>
 *
 * Prints {"starts": [top, ...]}: the top, in points, of the first line of each paragraph that begins on the
 * page (a paragraph carried on from the page before is not one of them).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The interface's own Vite (this file lies outside ui/, where node would not look for it).
const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ui');
const { createServer } = await import(pathToFileURL(path.join(UI, 'node_modules/vite/dist/node/index.js')).href);

const [folder, wanted] = process.argv.slice(2);
const server = await createServer({
  root: UI,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'silent',
});
try {
  const { layoutParts } = await server.ssrLoadModule('/src/features/pdf/import/layout.ts');
  const pages = readdirSync(folder)
    .filter((name) => /^page-\d+\.json$/.test(name))
    .map((name) => JSON.parse(readFileSync(path.join(folder, name), 'utf8')))
    .sort((a, b) => a.n - b.n);
  const { parts } = layoutParts(pages);
  const starts = parts
    .filter((part) => part.kind === 'p' && part.page === Number(wanted))
    .map((part) => part.runs.find((run) => run.text.trim())?.top)
    .filter((top) => top !== undefined);
  process.stdout.write(JSON.stringify({ starts }));
} finally {
  await server.close();
}
