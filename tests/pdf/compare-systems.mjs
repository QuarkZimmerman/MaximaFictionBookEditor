#!/usr/bin/env node
// Feature 014 (SC-009; tasks T060): the same books exported on Windows, Linux and macOS
// (ui/tests/e2e/systems-pdf.spec.ts, one JSON per system) compared. Windows and Linux must give the
// same page count and the same text on every page; macOS, whose engine hyphenates and so may break
// lines elsewhere, the same text in the same order (pages joined, whitespace and hyphens aside).
//
// Usage: node tests/pdf/compare-systems.mjs <linux.json> <win32.json> <darwin.json>
import fs from "node:fs";

const squeeze = (s) => s.normalize("NFC").replace(/[\s\u00ad\u2010-]+/g, "");

function load(file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  return new Map(data.records.map((r) => [`${r.book} ${r.size}`, r]));
}

const [linuxFile, windowsFile, macFile] = process.argv.slice(2);
if (!linuxFile || !windowsFile || !macFile) {
  console.error("usage: compare-systems.mjs <linux.json> <win32.json> <darwin.json>");
  process.exit(2);
}
const linux = load(linuxFile);
const windows = load(windowsFile);
const mac = load(macFile);
const faults = [];
for (const [key, l] of linux) {
  const w = windows.get(key);
  const m = mac.get(key);
  if (!w || !m) {
    faults.push(`${key}: missing on ${!w ? "Windows" : "macOS"}`);
    continue;
  }
  if (w.pages !== l.pages) faults.push(`${key}: ${l.pages} pages on Linux, ${w.pages} on Windows`);
  else {
    const page = l.texts.findIndex((t, i) => squeeze(t) !== squeeze(w.texts[i]));
    if (page >= 0) faults.push(`${key}: page ${page + 1} differs between Linux and Windows`);
  }
  if (squeeze(l.texts.join("")) !== squeeze(m.texts.join(""))) {
    faults.push(`${key}: the text in order differs between Linux and macOS`);
  }
}
for (const fault of faults) console.log(`compare-systems: ${fault}`);
console.log(`compare-systems: ${linux.size} exports compared, ${faults.length} difference(s)`);
process.exit(faults.length ? 1 : 0);
