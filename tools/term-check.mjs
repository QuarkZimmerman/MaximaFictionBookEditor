#!/usr/bin/env node
// Guard G14 (feature 011, FR-020a, D40): the interface never calls a table that needs repair
// "irregular" or names a category of tables at all. Scans every catalogue text of
// ui/src/i18n/*.json for the term in English ("irregular", "the table regular") and for the words
// the Russian and Ukrainian catalogues used for it ("Неправильная таблица", "таблицу правильной",
// "нерегулярной" and their forms).
// Usage: node tools/term-check.mjs [--strict]   (report only without --strict)
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const dir = join(root, "ui", "src", "i18n");
const strict = process.argv.includes("--strict");
const TERMS = [
  /irregular/i,
  /table\s+regular/i,
  /неправильн\p{L}*\s+таблиц/iu,
  /таблиц\p{L}*\s+правильн/iu,
  /нерегулярн/iu,
];

const found = [];
function walk(value, path, file) {
  if (typeof value === "string") {
    if (TERMS.some((term) => term.test(value)))
      found.push(`${file}: ${path}: ${value}`);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "$comment") continue; // notes for translators, never shown
      walk(child, path ? `${path}.${key}` : key, file);
    }
  }
}

for (const file of readdirSync(dir)
  .filter((name) => name.endsWith(".json"))
  .sort()) {
  if (file.includes("allowlist")) continue;
  walk(JSON.parse(readFileSync(join(dir, file), "utf8")), "", file);
}

if (found.length === 0) {
  console.log('term-check: OK - no catalogue text calls a table "irregular"');
} else {
  console.log(`term-check: ${found.length} text(s) still use the term:`);
  for (const line of found) console.log(`  ${line}`);
  if (strict) process.exit(1);
}
