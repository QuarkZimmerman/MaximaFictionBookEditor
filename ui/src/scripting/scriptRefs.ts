/**
 * References to scripts (feature 007, data-model §7.3, contracts/script-api.md §5): what
 * `mfbe.scripts.run(ref)` and the AI assistant name a script by - its id, or the path of the
 * FictionBook Editor original its manifest names in `legacy.source`, as the classic scripts
 * wrote it (`runScriptInFolder("16_Поиск форматирования\\52_Перейти на следующую цитату.js")`,
 * even a whole path of the original's installation).
 */

import type { ScriptInfo } from './types';

/**
 * A legacy path in comparable form: backslashes become slashes; everything up to a `Scripts`
 * folder, a leading slash and the `.js` suffix go; letter case does not count.
 */
export function normaliseLegacyPath(path: string): string {
  let value = path.trim().replace(/\\/g, '/').toLowerCase();
  const scripts = value.lastIndexOf('scripts/');
  if (scripts === 0 || (scripts > 0 && value[scripts - 1] === '/')) {
    value = value.slice(scripts + 'scripts/'.length);
  }
  value = value.replace(/^\/+/, '').replace(/\.js$/, '');
  return value;
}

/**
 * The script a reference names: the exact id first, else the normalised legacy path - the
 * manifest's `legacy.source` or one of its `legacy.aliases` (the 2.7.9 path of a package
 * unchanged since 2.7beta1); null.
 */
export function resolveScriptRef(ref: string, scripts: readonly ScriptInfo[]): ScriptInfo | null {
  if (!ref) return null;
  const byId = scripts.find((script) => script.id === ref);
  if (byId) return byId;
  const wanted = normaliseLegacyPath(ref);
  if (!wanted) return null;
  const paths = (script: ScriptInfo) =>
    script.legacy ? [script.legacy.source, ...(script.legacy.aliases ?? [])] : [];
  return (
    scripts.find((script) =>
      paths(script).some((path) => !!path && normaliseLegacyPath(path) === wanted),
    ) ?? null
  );
}
