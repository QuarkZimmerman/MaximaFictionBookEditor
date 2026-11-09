/**
 * Feature 011 (US9; D43; contracts/styles.md §4): the named styles of a book - the class names its
 * CSS stylesheets' selectors define, each once, in stylesheet order. A small reader of selector
 * text (no css-tree), so the Style menu can list them without loading the Styles view's checks.
 */
import type { Stylesheet } from '@/model/document';

const CLASS = /\.(-?[_a-zA-Z\u00a0-\uffff][\w\u00a0-\uffff-]*)/g;

/** The class names of the selectors of the CSS stylesheets, each once, in order. */
export function classNamesOf(stylesheets: readonly Stylesheet[]): string[] {
  const names: string[] = [];
  for (const sheet of stylesheets) {
    if (!/css/i.test(sheet.type)) continue;
    const text = sheet.content.replace(/\/\*[\s\S]*?\*\//g, '');
    // A rule's prelude is the text before its `{` since the last `{`, `}` or `;`.
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '{') {
        const prelude = text.slice(start, i).trim();
        if (prelude && !prelude.startsWith('@')) {
          for (const match of prelude.matchAll(CLASS)) {
            if (!names.includes(match[1]!)) names.push(match[1]!);
          }
        }
        start = i + 1;
      } else if (ch === '}' || ch === ';') {
        start = i + 1;
      }
    }
  }
  return names;
}
