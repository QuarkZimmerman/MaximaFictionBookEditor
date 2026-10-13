#!/usr/bin/env node
/**
 * Literal UI string check (developer tooling, never shipped).
 *
 * Scans the React sources (every .tsx file under ui/src, tests excluded) for user-visible text
 * that bypasses the i18n catalogues (`t('key')`):
 *   - JSX text with letters:                 <button>Some text</button>
 *   - string expressions in JSX children:    {'Some text'}  {`Some text`}
 *   - user-facing attributes with a literal: title="..." aria-label="..." placeholder="..."
 *     alt="..." aria-description aria-roledescription aria-valuetext label closeLabel caption
 *
 * Technical values are not reported: literals without a word of two letters (symbols, numbers,
 * punctuation, "U+"), kebab/snake-case identifiers (testids, CSS classes), `data-*` attributes,
 * URLs, file extensions, MIME types and the values listed in
 * `ui/src/i18n/literals-allowlist.json` (`values`: exact match, `patterns`: regular expressions,
 * `files`: per-file exact values). A line can also be exempted with the comment marker
 * `i18n-literal-ok` on the same line or on the line right before the literal (as a `//` comment
 * or a JSX comment block).
 *
 * Exit code 1 when a literal is found. Usage:
 *   node tools/i18n-literals.mjs [--quiet] [--root <ui/src dir>] [--allowlist <file>] [file...]
 * Needs the `typescript` package of ui/node_modules (npm ci in ui/).
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UI_DIR = path.join(ROOT, "ui");
const require = createRequire(path.join(UI_DIR, "package.json"));
const ts = require("typescript");

const MARKER = "i18n-literal-ok";

/** JSX attributes whose string value the user can see or hear. */
const USER_FACING_ATTRIBUTES = new Set([
  "title",
  "placeholder",
  "alt",
  "label",
  "caption",
  "closeLabel",
  "aria-label",
  "aria-description",
  "aria-roledescription",
  "aria-valuetext",
  "aria-placeholder",
]);

function parseArgs(argv) {
  const options = {
    quiet: false,
    root: path.join(UI_DIR, "src"),
    allowlist: null,
    files: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--quiet") options.quiet = true;
    else if (arg === "--root") {
      options.root = path.resolve(argv[++i] ?? "");
    } else if (arg === "--allowlist") {
      options.allowlist = path.resolve(argv[++i] ?? "");
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node tools/i18n-literals.mjs [--quiet] [--root <dir>] [--allowlist <file>] [file...]",
      );
      process.exit(0);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    } else {
      options.files.push(path.resolve(arg));
    }
  }
  if (!options.allowlist) {
    options.allowlist = path.join(
      UI_DIR,
      "src",
      "i18n",
      "literals-allowlist.json",
    );
  }
  return options;
}

function loadAllowlist(file) {
  if (!existsSync(file))
    return { values: new Set(), patterns: [], files: new Map() };
  const json = JSON.parse(readFileSync(file, "utf8"));
  const values = new Set(Array.isArray(json.values) ? json.values : []);
  const patterns = (Array.isArray(json.patterns) ? json.patterns : []).map(
    (source) => new RegExp(source, "u"),
  );
  const files = new Map();
  for (const [name, list] of Object.entries(json.files ?? {})) {
    files.set(
      name.replaceAll("\\", "/"),
      new Set(Array.isArray(list) ? list : []),
    );
  }
  return { values, patterns, files };
}

function* walkTsx(dir) {
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      yield* walkTsx(full);
    } else if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) {
      yield full;
    }
  }
}

/** Collapses JSX whitespace like React does (newlines + indentation vanish). */
function normalizeJsxText(text) {
  return text
    .split("\n")
    .map((line, index, lines) => {
      let trimmed = line;
      if (index > 0) trimmed = trimmed.replace(/^\s+/u, "");
      if (index < lines.length - 1) trimmed = trimmed.replace(/\s+$/u, "");
      return trimmed;
    })
    .filter((line) => line.length > 0)
    .join(" ");
}

/**
 * Built-in technical values. The identifier pattern is deliberately narrow: lower-case tokens
 * joined by hyphens/underscores ("mfbe-menu-label", "tab-view"), never a capitalised word or a
 * sentence with spaces - those are user text unless allow-listed.
 */
function isTechnical(value) {
  const trimmed = value.trim();
  if (trimmed === "") return true;
  if (!/\p{L}{2,}/u.test(trimmed)) return true; // no word of two letters: symbols, "U+", "%"
  if (/^https?:\/\//iu.test(trimmed)) return true;
  if (/^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+$/u.test(trimmed)) return true; // kebab/snake identifiers
  if (/^\.[a-z0-9]+$/iu.test(trimmed)) return true; // ".fb2"
  if (/^[a-z]+\/[a-z0-9.+-]+$/iu.test(trimmed)) return true; // "image/png"
  if (/^\{\{[\w.-]+\}\}$/u.test(trimmed)) return true; // "{{count}}"
  return false;
}

function hasMarker(sourceFile, node) {
  const text = sourceFile.text;
  const { line } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  const lineStart = sourceFile.getPositionOfLineAndCharacter(line, 0);
  const lineEnd = text.indexOf("\n", lineStart);
  const lineText = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  if (lineText.includes(MARKER)) return true;
  // A comment-only previous line carrying the marker (`// i18n-literal-ok`, `{/* ... */}`).
  if (line > 0) {
    const prevStart = sourceFile.getPositionOfLineAndCharacter(line - 1, 0);
    const prevText = text.slice(prevStart, lineStart).trim();
    if (prevText.includes(MARKER) && /^(?:\/\/|\{?\/\*)/u.test(prevText))
      return true;
  }
  return false;
}

/** Static text of a template literal with substitutions (`Version ${v}` -> "Version "). */
function templateStaticText(node) {
  if (!ts.isTemplateExpression(node)) return null;
  return [
    node.head.text,
    ...node.templateSpans.map((span) => span.literal.text),
  ].join(" ");
}

function attributeName(attribute) {
  const name = attribute.name;
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isJsxNamespacedName(name))
    return `${name.namespace.text}:${name.name.text}`;
  return name.getText();
}

function literalText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text;
  return templateStaticText(node);
}

function scanFile(file, allowlist, relativeName) {
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const findings = [];
  const fileAllow = allowlist.files.get(relativeName) ?? new Set();

  const report = (node, kind, value) => {
    const text = kind === "text" ? normalizeJsxText(value) : value;
    if (isTechnical(text)) return;
    if (allowlist.values.has(text.trim()) || fileAllow.has(text.trim())) return;
    if (allowlist.patterns.some((pattern) => pattern.test(text.trim()))) return;
    if (hasMarker(sourceFile, node)) return;
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    );
    findings.push({
      file: relativeName,
      line: line + 1,
      column: character + 1,
      kind,
      text,
    });
  };

  const visit = (node) => {
    if (ts.isJsxText(node)) {
      if (!node.containsOnlyTriviaWhiteSpaces) report(node, "text", node.text);
    } else if (ts.isJsxExpression(node) && node.expression) {
      const parent = node.parent;
      const isChild =
        parent && (ts.isJsxElement(parent) || ts.isJsxFragment(parent));
      if (isChild) {
        const text = literalText(node.expression);
        if (text !== null) report(node, "expression", text);
      }
    } else if (ts.isJsxAttribute(node)) {
      const name = attributeName(node);
      if (USER_FACING_ATTRIBUTES.has(name) && node.initializer) {
        let value = null;
        if (ts.isStringLiteral(node.initializer)) value = node.initializer.text;
        else if (
          ts.isJsxExpression(node.initializer) &&
          node.initializer.expression
        ) {
          value = literalText(node.initializer.expression);
        }
        if (value !== null) report(node, `attribute ${name}`, value);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const allowlist = loadAllowlist(options.allowlist);
  const files =
    options.files.length > 0 ? options.files : [...walkTsx(options.root)];
  const findings = [];
  for (const file of files) {
    const relativeName = path.relative(UI_DIR, file).replaceAll("\\", "/");
    findings.push(...scanFile(file, allowlist, relativeName));
  }
  for (const finding of findings) {
    console.error(
      `error: ${finding.file}:${finding.line}:${finding.column}: literal UI string (${finding.kind}): ` +
        `${JSON.stringify(finding.text)} - use t('...') or mark the line with // ${MARKER}`,
    );
  }
  if (findings.length > 0) {
    console.error(
      `i18n-literals: ${findings.length} literal(s) in ${files.length} file(s)`,
    );
    process.exit(1);
  }
  if (!options.quiet)
    console.log(
      `i18n-literals: OK (${files.length} .tsx files, no literal UI strings)`,
    );
}

main();
