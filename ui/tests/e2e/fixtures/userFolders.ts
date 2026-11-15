/**
 * Feature 015 (T011): fills the designated folders of a journey's core with the user items of
 * `tests/fixtures/user-folders/` - the folders chosen in Settings, the per-user data folder (the
 * core's `--data-dir`) and the portable folder (`--portable-dir`). The kinds sit where the editor
 * reads them: `genres/`, `scripts/`, `dictionaries/` and `blank.fb2` under a data or portable
 * folder; a chosen folder is the kind's folder itself (`other.genresFolder` and the others).
 */

import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const USER_FOLDER_FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../tests/fixtures/user-folders',
);

/** The valid items, by kind, and the items the editor must pass over. */
export const VALID = {
  genres: ['my.genres.tsv'],
  scripts: ['my-test-script'],
  template: ['blank.fb2'],
  dictionaries: ['xx_XX.aff', 'xx_XX.dic'],
} as const;
export const PASSED_OVER = {
  genres: ['genres.txt'],
  scripts: ['stray.js', 'no-description'],
  dictionaries: ['yy_YY.aff'],
} as const;

export type Kind = keyof typeof VALID;

function copyItems(names: readonly string[], into: string): void {
  mkdirSync(into, { recursive: true });
  for (const name of names) {
    cpSync(path.join(USER_FOLDER_FIXTURES, name), path.join(into, name), { recursive: true });
  }
}

/** Fills a data or portable folder: `<root>/genres`, `<root>/scripts`, `<root>/dictionaries`, `<root>/blank.fb2`. */
export function seedLayerRoot(
  root: string,
  kinds: readonly Kind[],
  options: { passedOver?: boolean } = {},
): void {
  for (const kind of kinds) {
    if (kind === 'template') {
      copyItems(VALID.template, root);
      continue;
    }
    copyItems(VALID[kind], path.join(root, kind));
    if (options.passedOver) copyItems(PASSED_OVER[kind], path.join(root, kind));
  }
}

/**
 * Fills folders chosen in Settings (one per kind, under `chosenRoot`) and records them in the
 * data folder's `settings.json`, which the core reads at start.
 */
export function seedChosenFolders(
  dataDir: string,
  chosenRoot: string,
  kinds: readonly Kind[],
  options: { passedOver?: boolean } = {},
): void {
  const settingsFile = path.join(dataDir, 'settings.json');
  const settings: Record<string, Record<string, unknown>> = existsSync(settingsFile)
    ? (JSON.parse(readFileSync(settingsFile, 'utf8')) as Record<string, Record<string, unknown>>)
    : {};
  const other = (settings.other ??= {});
  for (const kind of kinds) {
    const folder = path.join(chosenRoot, kind);
    if (kind === 'template') {
      copyItems(VALID.template, folder);
      other.templateFolder = folder;
      continue;
    }
    copyItems(VALID[kind], folder);
    if (options.passedOver) copyItems(PASSED_OVER[kind], folder);
    other[`${kind}Folder`] = folder;
  }
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
}
