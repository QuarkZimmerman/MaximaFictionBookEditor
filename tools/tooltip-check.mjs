#!/usr/bin/env node
// Guard G8 (feature 010, FR-046): every interactive control of the interface carries a tooltip.
// Scans ui/src/**/*.tsx for the opening tags of <button>, <input>, <select>, <textarea> and
// elements with role="menuitem" | "tab" | "option"; a control passes when its tag has `title=` or
// `{...tip(` (the tooltip helper of ui/src/app/tooltips.ts), or a `data-no-tooltip` mark for the
// allow-list (OK, Cancel, Close, Yes, No, Apply, script-built forms).
// Usage: node tools/tooltip-check.mjs [--strict]   (report only without --strict)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const src = join(root, 'ui', 'src');
const strict = process.argv.includes('--strict');
const START = /<(button|input|select|textarea)\b|<(\w+)\b(?=[^<]*?role="(?:menuitem|tab|option)")/g;

/** The whole opening tag at `start`: up to the `>` outside braces and quotes (so `=>` stays in). */
function openingTag(text, start) {
  let depth = 0;
  let quote = null;
  for (let i = start + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && text[i - 1] !== '\\') quote = null;
    } else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (name.endsWith('.tsx')) yield path;
  }
}

const missing = [];
let controls = 0;
for (const file of files(src)) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(START)) {
    const tag = openingTag(text, match.index);
    if (match[2] && !/role="(menuitem|tab|option)"/.test(tag)) continue;
    if (/type="hidden"/.test(tag)) continue;
    controls += 1;
    if (/\btitle=|\{\.\.\.tip\(|data-no-tooltip/.test(tag)) continue;
    const line = text.slice(0, match.index).split('\n').length;
    missing.push(`${relative(root, file)}:${line}`);
  }
}
console.log(`tooltip-check: ${controls} controls, ${missing.length} without a tooltip`);
for (const entry of missing) console.log(`  ${entry}`);
process.exit(strict && missing.length > 0 ? 1 : 0);
