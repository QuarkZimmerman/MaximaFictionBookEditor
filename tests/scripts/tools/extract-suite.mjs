#!/usr/bin/env node
/**
 * One-off generator of `tests/scripts/snapshots/suite.json` (T127): collects the harness
 * invocation of every snapshot from the conversion notes and writes the machine-readable
 * manifest `[{ snapshot, script, book, args }]` that `run-all.mjs` executes.
 *
 *   node tests/scripts/tools/extract-suite.mjs [--write]      (prints the JSON without --write)
 *
 * Sources, in the order they are merged (later entries never override earlier ones):
 *   1. the `## Harness commands` bash block of docs/scripting/conversion-notes-b.md, parsed
 *      with a small POSIX-shell tokenizer (variables G/B/S/NB, single and double quotes);
 *   2. the tables of conversion-notes-a.md - a cell `` `name.xml` (`--select ... --answer ...`) ``
 *      gives the snapshot and its arguments, the group header gives the default fixture book;
 *   3. the explicit table below for the groups whose notes list the arguments in prose
 *      (03, 04, 13, 16, 17, 18, 19, 20, 21, tree, and the CI fixture package).
 * The result was reviewed by running every entry (`tests/scripts/run-all.mjs`); the committed
 * `suite.json` is the source of truth from then on - this script only documents where the
 * arguments came from and can regenerate the file after a notes change.
 *
 * Conventions checked here: a snapshot `snapshots/<NN>/<slug>[.<variant>].xml` belongs to the
 * package whose manifest id is `<NN>/<slug>` (`tree/<slug>` for tree commands); `script` is the
 * package folder relative to the repository root; `book` is relative to the repository root.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
const NOTES = path.join(REPO_ROOT, "docs", "scripting");
const SNAPSHOTS = path.join(REPO_ROOT, "tests", "scripts", "snapshots");
const BOOKS = "tests/scripts/fixtures/books";

/* ---------------------------------------------------------------------- */
/* Packages                                                               */
/* ---------------------------------------------------------------------- */

/** id -> package folder (relative to the repository root) of every converted package. */
function packagesById() {
  const out = new Map();
  const root = path.join(REPO_ROOT, "scripts");
  for (const group of readdirSync(root, { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    for (const entry of readdirSync(path.join(root, group.name), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const manifest = path.join(root, group.name, entry.name, "script.json");
      if (!existsSync(manifest)) continue;
      const id =
        JSON.parse(readFileSync(manifest, "utf8")).id ??
        `${group.name}/${entry.name}`;
      out.set(id, path.posix.join("scripts", group.name, entry.name));
    }
  }
  return out;
}

const PACKAGES = packagesById();

function packageFor(snapshot) {
  const [group, file] = snapshot.split("/");
  const slug = file.replace(/\.xml$/, "").split(".")[0];
  const id = `${group}/${slug}`;
  const dir = PACKAGES.get(id);
  if (!dir)
    throw new Error(`no package with id "${id}" for snapshot ${snapshot}`);
  return dir;
}

/* ---------------------------------------------------------------------- */
/* 1. conversion-notes-b.md: the bash block                               */
/* ---------------------------------------------------------------------- */

/** Minimal POSIX tokenizer: whitespace splitting, '…', "…", $VAR / ${VAR} expansion, $'…' */
function shellWords(line, vars) {
  const words = [];
  let current = "";
  let has = false;
  let i = 0;
  const expand = () => {
    let name = "";
    if (line[i] === "{") {
      i += 1;
      while (i < line.length && line[i] !== "}") name += line[i++];
      i += 1;
    } else {
      while (i < line.length && /[A-Za-z0-9_]/.test(line[i])) name += line[i++];
    }
    if (!(name in vars))
      throw new Error(`unknown variable $${name} in: ${line}`);
    return vars[name];
  };
  while (i < line.length) {
    const ch = line[i];
    if (/\s/.test(ch)) {
      if (has) words.push(current);
      current = "";
      has = false;
      i += 1;
    } else if (ch === "'") {
      has = true;
      i += 1;
      while (i < line.length && line[i] !== "'") current += line[i++];
      i += 1;
    } else if (ch === '"') {
      has = true;
      i += 1;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === "$") {
          i += 1;
          current += expand();
        } else if (line[i] === "\\" && /["\\$]/.test(line[i + 1] ?? "")) {
          current += line[i + 1];
          i += 2;
        } else current += line[i++];
      }
      i += 1;
    } else if (ch === "$" && line[i + 1] === "'") {
      has = true;
      i += 2;
      let raw = "";
      while (i < line.length && line[i] !== "'") raw += line[i++];
      i += 1;
      current += raw.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16)),
      );
    } else if (ch === "$") {
      has = true;
      i += 1;
      current += expand();
    } else {
      has = true;
      current += ch;
      i += 1;
    }
  }
  if (has) words.push(current);
  return words;
}

/** Decodes `$'\xc2\xa0'` (UTF-8 bytes) into the character. */
function decodeAnsiC(value) {
  const bytes = [];
  value.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => {
    bytes.push(parseInt(hex, 16));
    return "";
  });
  return Buffer.from(bytes).toString("utf8");
}

function fromBashBlock(markdown) {
  const block = /## Harness commands\s*```bash\n([\s\S]*?)```/.exec(markdown);
  if (!block) return [];
  const vars = {};
  const entries = [];
  for (const raw of block[1].split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (!line.startsWith("node ")) {
      // Assignments: `G=scripts/06_Чистка; B=...; S=...` or `NB=$'\xc2\xa0'   # comment`
      for (const part of line.replace(/\s+#.*$/, "").split(";")) {
        const match = /^\s*([A-Z]+)=(.*)$/.exec(part);
        if (!match) continue;
        let value = match[2].trim();
        if (value.startsWith("$'")) value = decodeAnsiC(value.slice(2, -1));
        else value = shellWords(value, vars).join(" ");
        vars[match[1]] = value;
      }
      continue;
    }
    const words = shellWords(line, vars);
    // node tests/scripts/run-script.mjs <script> <book> [args...] --snapshot <file>
    const [, , script, book, ...rest] = words;
    const snapshotIndex = rest.indexOf("--snapshot");
    const snapshot = rest[snapshotIndex + 1];
    const args = rest.filter(
      (_, index) => index !== snapshotIndex && index !== snapshotIndex + 1,
    );
    entries.push({
      snapshot: path.posix.relative("tests/scripts/snapshots", snapshot),
      script,
      book,
      args,
    });
  }
  return entries;
}

/* ---------------------------------------------------------------------- */
/* 2. conversion-notes-a.md: table cells                                  */
/* ---------------------------------------------------------------------- */

/** Group number -> default fixture book of conversion-notes-a.md. */
const BOOK_A = {
  "01": `${BOOKS}/conv-a-01.fb2`,
  "02": `${BOOKS}/conv-a-02.fb2`,
  "03": `${BOOKS}/conv-a-02.fb2`,
  "04": `${BOOKS}/conv-a-04.fb2`,
  "05": `${BOOKS}/conv-a-05.fb2`,
  "08": `${BOOKS}/conv-a-08.fb2`,
};

/** Splits the argument text of a cell (`--select n8:57:57 --answer 'Текст'`) like a shell. */
function cellArgs(text) {
  return shellWords(text, {});
}

function fromTablesA(markdown) {
  const entries = [];
  let group = null;
  for (const line of markdown.split("\n")) {
    const heading = /^## (\d\d) /.exec(line);
    if (heading) group = heading[1];
    if (!group || !line.startsWith("|")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    const snapshotCell = cells.find((c) => /`[\w.-]+\.xml`/.test(c));
    if (!snapshotCell || !cells[0]?.startsWith("`")) continue;
    // One cell may list several snapshots: `a.xml` (`args`); `b.xml` (`args`, remark); a
    // variant written as `.remove.xml` continues the slug of the previous snapshot.
    const re =
      /`([\w.-]+\.xml)`(?:\s*\((?:on `([\w.-]+\.fb2)`[^)]*|`([^`]*)`[^)]*)\))?/g;
    let match;
    let lastSlug = null;
    while ((match = re.exec(snapshotCell))) {
      const [, name, bookOverride, argText] = match;
      // Variant rows with the arguments of the base snapshot ("same arguments") are left to
      // the explicit table; comments-from-* of group 04 are handled there as well.
      if (name.includes("*")) continue;
      const file = name.startsWith(".") ? `${lastSlug}${name}` : name;
      lastSlug = file.replace(/\.xml$/, "").split(".")[0];
      const snapshot = `${group}/${file}`;
      const args = argText ? cellArgs(argText) : [];
      entries.push({
        snapshot,
        script: packageFor(snapshot),
        book: bookOverride ? `${BOOKS}/${bookOverride}` : BOOK_A[group],
        args,
      });
    }
  }
  return entries;
}

/* ---------------------------------------------------------------------- */
/* 3. Arguments the notes give in prose (reviewed by hand)                */
/* ---------------------------------------------------------------------- */

const A02 = `${BOOKS}/conv-a-02.fb2`;
const A04 = `${BOOKS}/conv-a-04.fb2`;
const C13 = `${BOOKS}/conv-c-13.fb2`;
const C16 = `${BOOKS}/conv-c-16.fb2`;
const C17 = `${BOOKS}/conv-c-17.fb2`;
const C17C = `${BOOKS}/conv-c-17-comments.fb2`;
const C18 = `${BOOKS}/conv-c-18.fb2`;
const C19 = `${BOOKS}/conv-c-19.fb2`;
const C21 = `${BOOKS}/conv-c-21.fb2`;

/** `[snapshot, book, args]`; the script is derived from the snapshot name. */
const EXPLICIT = [
  // 03 (conversion-notes-a.md, group 03 paragraph): same arguments as group 02.
  ["03/add-comment.xml", A02, ["--select", "n8:57:57"]],
  [
    "03/add-comment-with-text.xml",
    A02,
    ["--select", "n8:57:57", "--answer", "Текст <em>нового</em> комментария"],
  ],
  ["03/add-comment-go-to-comment.xml", A02, ["--select", "n8:57:57"]],
  ["03/unify-comments.xml", A02, []],
  ["03/add-last-comment.xml", A02, ["--select", "n14:44:44"]],
  [
    "03/add-last-comment-with-text.xml",
    A02,
    ["--select", "n14:44:44", "--answer", "Последний комментарий"],
  ],
  ["03/add-last-comment-go-to-comment.xml", A02, ["--select", "n14:44:44"]],
  ["03/unify-comments-remove-unused.xml", A02, ["--answer", "ok"]],
  // 04 comments-from-*: the notes say "same arguments" as the footnote variants, but the
  // recorded snapshots of 611/612 were made with the tilde pair as regexes and the curly pair
  // as plain text (the fixture has one example of each kind) - verified by re-running.
  ["04/comments-from-square.xml", A04, []],
  ["04/comments-from-curly.xml", A04, []],
  ["04/comments-from-square-bang.xml", A04, []],
  ["04/comments-from-square-tilde.xml", A04, []],
  [
    "04/comments-from-regex-brackets.xml",
    A04,
    ["--answer", "\\[~", "--answer", "~\\]"],
  ],
  ["04/comments-from-text-brackets.xml", A04, ["--answer", "{ }"]],
  // 13 (conversion-notes-c.md): answers yes / no for the "ask" variant.
  ["13/subtitles-empty-lines.xml", C13, []],
  ["13/subtitles-empty-lines-unbold-titles.xml", C13, []],
  ["13/subtitles-empty-lines-ask-unbold-titles.xml", C13, ["--answer", "yes"]],
  [
    "13/subtitles-empty-lines-ask-unbold-titles.no.xml",
    C13,
    ["--answer", "no"],
  ],
  ["13/subtitles-empty-lines-plain-titles.xml", C13, []],
  // 16: `--select n9:5:5 --answer yes` on conv-c-16.fb2 (document never changes).
  ...[
    "next-code",
    "next-emphasis",
    "next-paragraph-with-code",
    "next-paragraph-with-emphasis",
    "next-paragraph-with-strikethrough",
    "next-paragraph-with-strong",
    "next-paragraph-with-sub",
    "next-paragraph-with-sup",
    "next-strikethrough",
    "next-strong",
    "next-sub",
    "next-sup",
    "previous-code",
    "previous-emphasis",
    "previous-paragraph-with-code",
    "previous-paragraph-with-emphasis",
    "previous-paragraph-with-strikethrough",
    "previous-paragraph-with-strong",
    "previous-paragraph-with-sub",
    "previous-paragraph-with-sup",
    "previous-strikethrough",
    "previous-strong",
    "previous-sub",
    "previous-sup",
  ].map((slug) => [
    `16/${slug}.xml`,
    C16,
    ["--select", "n9:5:5", "--answer", "yes"],
  ]),
  // 17
  ["17/notes-into-brackets.xml", C17, []],
  ["17/notes-into-brackets-with-space.xml", C17, []],
  ["17/one-note-into-brackets.xml", C17, ["--select", "n26:3:3"]],
  ["17/notes-into-brackets.comments.xml", C17C, []],
  ["17/one-note-into-brackets.comments.xml", C17C, ["--select", "n26:3:3"]],
  // 18
  ["18/remove-spaces.xml", C18, ["--select", "n7:0:35"]],
  [
    "18/insert-midi-link.xml",
    C18,
    ["--select", "n8:22:29", "--answer", '{"file":"song.mid"}'],
  ],
  // 18/03 insists on a collapsed caret ("(poem, n25)" in the notes means the caret in n25).
  ["18/unwrap-poem-cite-epigraph.xml", C18, ["--select", "n25:0:0"]],
  ["18/unwrap-poem-cite-epigraph.cite.xml", C18, ["--select", "n33:0:0"]],
  ["18/unwrap-poem-cite-epigraph.epigraph.xml", C18, ["--select", "n16:0:0"]],
  ["18/empty-line-before-poem-or-cite.xml", C18, ["--select", "n27"]],
  ["18/empty-line-after-poem-epigraph-or-cite.xml", C18, ["--select", "n32"]],
  ["18/remove-spaces-and-hyphens.xml", C18, ["--select", "n7:0:60"]],
  ["18/bracket-superscripts-square.xml", C18, []],
  ["18/bracket-superscripts-curly.xml", C18, []],
  ["18/line-numbers-to-superscript.xml", C18, ["--select", "n40:0:3"]],
  // Multi-block selections (T127): the cases the notes could only verify with a private
  // wrapper before `--select-range` existed - 09/03 merges three paragraphs (hyphen rule),
  // 18/09 handles every numbered line of the fixture in one run.
  [
    "09/merge-paragraphs.range.conv-b-09.xml",
    `${BOOKS}/conv-b-09.fb2`,
    ["--select-range", "n49:0-n51:5"],
  ],
  [
    "18/line-numbers-to-superscript.range.xml",
    C18,
    ["--select-range", "n39:0-n46:1"],
  ],
  // 19: the element browser (form 1 = kind, form 2 = items + action, repeated until Close).
  // The notes only name the snapshots; the item keys (`<titleId>:<line>`, `<subtitleId>`,
  // `<blockId>:<from>:<to>`) were derived from the fixture's node ids (n5 = title of the first
  // section, n13/n16/n19/n29/n37 = its subtitles, n12/n14 = the paragraphs with marks) and
  // confirmed by re-running every snapshot.
  [
    "19/element-browser.titles-to-subtitles.xml",
    C19,
    [
      "--answer",
      '{"kind":"titles"}',
      "--answer",
      '{"items":["n5:1"],"action":"subtitles"}',
      "--answer",
      "cancel",
    ],
  ],
  [
    "19/element-browser.titles-to-text.xml",
    C19,
    [
      "--answer",
      '{"kind":"titles"}',
      "--answer",
      '{"items":["n5:0","n5:1","n5:2"],"action":"text"}',
      "--answer",
      "cancel",
    ],
  ],
  [
    "19/element-browser.subtitles-to-titles.xml",
    C19,
    [
      "--answer",
      '{"kind":"subtitles"}',
      "--answer",
      '{"items":["n13","n37"],"action":"titles"}',
      "--answer",
      "cancel",
    ],
  ],
  [
    "19/element-browser.subtitles-to-text.xml",
    C19,
    [
      "--answer",
      '{"kind":"subtitles"}',
      "--answer",
      '{"items":["n16","n19","n29"],"action":"text"}',
      "--answer",
      "cancel",
    ],
  ],
  [
    "19/element-browser.inline.xml",
    C19,
    [
      "--answer",
      '{"kind":"emphasis"}',
      "--answer",
      '{"items":["n12:1:2"],"action":"strong"}',
      "--answer",
      '{"action":"kind"}',
      "--answer",
      '{"kind":"sup"}',
      "--answer",
      '{"items":["n14:1:2"],"action":"text"}',
      "--answer",
      "cancel",
    ],
  ],
  [
    "19/element-browser.case.xml",
    C19,
    [
      "--answer",
      '{"kind":"titles"}',
      "--answer",
      '{"items":["n5:0"],"action":"case:allBig"}',
      "--answer",
      '{"action":"kind"}',
      "--answer",
      '{"kind":"subtitles"}',
      "--answer",
      '{"items":["n13"],"action":"case:onlyFirstBig"}',
      "--answer",
      "cancel",
    ],
  ],
  // 20 and 21 (document unchanged)
  ["20/show-code.xml", C16, ["--select", "n23"]],
  ["20/show-whole-code.xml", C16, ["--select", "n26"]],
  ["21/text-error-search.xml", C21, ["--select", "n7:0:0"]],
  ["21/regexp-set-search-template.xml", C21, ["--select", "n7:3:3"]],
  // tree command
  [
    "tree/example-1.xml",
    C16,
    ["--tree-node", "n14", "--answer", '{"target":"n23"}'],
  ],
];

function fromExplicit() {
  return EXPLICIT.map(([snapshot, book, args]) => ({
    snapshot,
    script: packageFor(snapshot),
    book,
    args,
  }));
}

/* ---------------------------------------------------------------------- */
/* Merge, check, write                                                    */
/* ---------------------------------------------------------------------- */

function main() {
  const notesA = readFileSync(
    path.join(NOTES, "conversion-notes-a.md"),
    "utf8",
  );
  const notesB = readFileSync(
    path.join(NOTES, "conversion-notes-b.md"),
    "utf8",
  );
  const byName = new Map();
  const add = (entry, source) => {
    if (byName.has(entry.snapshot)) return;
    byName.set(entry.snapshot, { ...entry, source });
  };
  fromBashBlock(notesB).forEach((e) => add(e, "notes-b"));
  fromTablesA(notesA).forEach((e) => add(e, "notes-a"));
  fromExplicit().forEach((e) => add(e, "explicit"));
  // The CI smoke snapshot of the fixture package (e2e scenario 2 compares against it too).
  add(
    {
      snapshot: "fixtures/append.modern-utf8.xml",
      script: "tests/scripts/fixtures/04_Model/01_Append",
      book: "tests/fixtures/books/modern-utf8.fb2",
      args: [],
    },
    "fixtures",
  );

  // Every snapshot file must have an entry, every entry a file.
  const files = [];
  for (const dir of readdirSync(SNAPSHOTS, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const file of readdirSync(path.join(SNAPSHOTS, dir.name))) {
      if (file.endsWith(".xml") && !file.endsWith(".fbe.xml"))
        files.push(`${dir.name}/${file}`);
    }
  }
  const missing = files.filter((f) => !byName.has(f));
  const stale = [...byName.keys()].filter((s) => !files.includes(s));
  if (missing.length)
    console.error(`no arguments found for: ${missing.join(", ")}`);
  if (stale.length) console.error(`no snapshot file for: ${stale.join(", ")}`);
  for (const entry of byName.values()) {
    if (!existsSync(path.join(REPO_ROOT, entry.script, "script.json")))
      console.error(`${entry.snapshot}: package not found: ${entry.script}`);
    if (!existsSync(path.join(REPO_ROOT, entry.book)))
      console.error(`${entry.snapshot}: book not found: ${entry.book}`);
  }
  const entries = [...byName.values()]
    .sort((a, b) => a.snapshot.localeCompare(b.snapshot, "en"))
    .map(({ snapshot, script, book, args }) => ({
      snapshot,
      script,
      book,
      args,
    }));
  const counts = {};
  for (const e of byName.values())
    counts[e.source] = (counts[e.source] ?? 0) + 1;
  console.error(`entries: ${entries.length} (${JSON.stringify(counts)})`);
  const text = `${JSON.stringify(entries, null, 2)}\n`;
  if (process.argv.includes("--write")) {
    writeFileSync(path.join(SNAPSHOTS, "suite.json"), text);
    console.error(`wrote ${path.join(SNAPSHOTS, "suite.json")}`);
  } else process.stdout.write(text);
  if (missing.length || stale.length) process.exit(1);
}

main();
