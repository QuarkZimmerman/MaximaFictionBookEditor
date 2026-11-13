#!/usr/bin/env node
// Feature 014 (SC-002, D5): the independent check that an exported PDF is searchable. pdf.js - the
// reader the library site uses, not the export's own library - extracts each page's text, which
// must give back the book's text: every block in reading order (notes anywhere, since they sit at
// the foot of the pages), each word whole. Allowed apart from that: whitespace, the words the export
// adds (D11), the page numbers at the foot, and note labels.
//
// Usage: node tests/pdf/text-compare.mjs <file.pdf> <expected.json> [...pairs]
//   expected.json: { "blocks": [{ "text": "...", "note": false }, ...], "addedWords": ["..."] }
// The journeys write the expected file from the book itself (its paragraphs, titles, notes...), so
// the check never reads the export's own page map. Also importable: pdfPageTexts, compareText.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pdfjsPath = path.join(
  here,
  "..",
  "..",
  "ui",
  "node_modules",
  "pdfjs-dist",
  "legacy",
  "build",
  "pdf.mjs",
);

/** The text of each page, lines joined by "\n" (pdf.js's end-of-line marks). */
export async function pdfPageTexts(bytes) {
  const { getDocument } = await import(pathToFileURL(pdfjsPath).href);
  const task = getDocument({
    data: new Uint8Array(bytes),
    verbosity: 0,
    isEvalSupported: false,
  });
  const pdf = await task.promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    // Raw text, as the file maps it: pdf.js's own Unicode normalisation would turn a ligature
    // character back into letters and hide what other readers copy and search (D5).
    const content = await page.getTextContent({ disableNormalization: true });
    let text = "";
    for (const item of content.items) {
      if (typeof item.str !== "string") continue;
      text += item.str;
      if (item.hasEOL) text += "\n";
    }
    pages.push(text);
  }
  await task.destroy();
  return pages;
}

const SOFT_HYPHEN = /\u00ad/g;
const SPACE = /[\s\u00a0\u2000-\u200b\u202f\u205f\u3000]+/g;
const squeeze = (s) =>
  s.normalize("NFC").replace(SOFT_HYPHEN, "").replace(SPACE, "");

/** Drops a page's last line when it is only a number: the page number at the foot (D9). */
function withoutPageNumber(text) {
  const lines = text.replace(/\n+$/, "").split("\n");
  if (lines.length > 1 && /^\s*\d+\s*$/.test(lines[lines.length - 1]))
    lines.pop();
  return lines.join("\n");
}

/**
 * Compares the pages' text with the book's blocks. Returns { ok, missing, outOfOrder, extra,
 * brokenWords }: missing blocks, body blocks found only before the previous one, runs of page text
 * that no block, added word or label explains, and words split by a hyphen at a line's end.
 */
export function compareText(pageTexts, expected) {
  const pages = pageTexts.map(withoutPageNumber);
  const all = squeeze(pages.join(""));
  const covered = new Uint8Array(all.length);
  const missing = [];
  const outOfOrder = [];
  let cursor = 0;
  const cover = (at, length) => covered.fill(1, at, at + length);
  const findFree = (needle, from) => {
    for (
      let at = all.indexOf(needle, from);
      at >= 0;
      at = all.indexOf(needle, at + 1)
    ) {
      if (!covered[at]) return at;
    }
    return -1;
  };
  for (const block of expected.blocks.filter((b) => !b.note)) {
    const needle = squeeze(block.text);
    if (!needle) continue;
    let at = findFree(needle, cursor);
    if (at >= 0) {
      cursor = at + needle.length;
    } else if ((at = findFree(needle, 0)) >= 0) {
      outOfOrder.push(block.text);
    } else {
      missing.push(block.text);
      continue;
    }
    cover(at, needle.length);
  }
  for (const block of expected.blocks.filter((b) => b.note)) {
    const needle = squeeze(block.text);
    if (!needle) continue;
    const at = findFree(needle, 0);
    if (at < 0) missing.push(block.text);
    else cover(at, needle.length);
  }
  const allowed = new Set((expected.addedWords ?? []).map(squeeze));
  const extra = [];
  for (let at = 0; at < all.length;) {
    if (covered[at]) {
      at++;
      continue;
    }
    let end = at;
    while (end < all.length && !covered[end]) end++;
    const run = all.slice(at, end);
    // Note labels and reference marks ("1", "[2]", "*") and the added words are allowed.
    if (!allowed.has(run) && !/^[\d[\]().*†‡§]+$/.test(run)) extra.push(run);
    at = end;
  }
  // "Each word whole" (D5): a letter, a hyphen at the end of a line, a letter, where the book has
  // the word without that hyphen.
  const bookText = squeeze(expected.blocks.map((b) => b.text).join(" "));
  const brokenWords = [];
  for (const page of pages) {
    for (const m of page.matchAll(/(\p{L}+)[-\u2010]\n(\p{L}+)/gu)) {
      if (
        !bookText.includes(`${m[1]}-${m[2]}`) &&
        bookText.includes(m[1] + m[2])
      ) {
        brokenWords.push(`${m[1]}-${m[2]}`);
      }
    }
  }
  return {
    ok:
      !missing.length &&
      !outOfOrder.length &&
      !extra.length &&
      !brokenWords.length,
    missing,
    outOfOrder,
    extra,
    brokenWords,
  };
}

async function main(args) {
  if (args.length < 2 || args.length % 2) {
    console.error(
      "usage: node tests/pdf/text-compare.mjs <file.pdf> <expected.json> [...]",
    );
    return 2;
  }
  let status = 0;
  for (let i = 0; i < args.length; i += 2) {
    const [pdfFile, expectedFile] = [args[i], args[i + 1]];
    const result = compareText(
      await pdfPageTexts(fs.readFileSync(pdfFile)),
      JSON.parse(fs.readFileSync(expectedFile, "utf8")),
    );
    if (result.ok) {
      console.log(
        `text-compare: ${pdfFile}: the book's text, in order, words whole`,
      );
      continue;
    }
    status = 1;
    for (const [kind, list] of Object.entries(result)) {
      if (Array.isArray(list) && list.length) {
        console.log(
          `text-compare: ${pdfFile}: ${kind} (${list.length}): ${list
            .slice(0, 5)
            .map((s) => JSON.stringify(s.slice(0, 80)))
            .join(", ")}`,
        );
      }
    }
  }
  return status;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exit(await main(process.argv.slice(2)));
}
