#!/usr/bin/env node
// Feature 014 (tasks T010, T018): writes tests/fixtures/pdf/chromium-sample.pdf, a small file as the
// browser engine prints it before the core finishes it (research R1). The core tests read it: a
// static shipped font (Noto Serif, regular and bold), a synthesised italic, a JPEG and a PNG
// picture, an inside link, an outside link and two headings, on two A5 pages, tagged.
//
// Run from the repository root (only when the fixture must change; the file is committed):
//   node tests/fixtures/pdf/make-chromium-sample.mjs
// It uses Playwright's own Chromium (ui/node_modules), the engine the journeys print with.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const { chromium } = await import(
  pathToFileURL(
    path.join(root, "ui", "node_modules", "playwright", "index.mjs"),
  ).href
);

const work = fs.mkdtempSync(path.join(os.tmpdir(), "mfbe-chromium-sample-"));
for (const [from, to] of [
  ["resources/fonts/NotoSerif-Regular.ttf", "r.ttf"],
  ["resources/fonts/NotoSerif-Bold.ttf", "b.ttf"],
  ["tests/fixtures/images/tiny.jpg", "p.jpg"],
  ["tests/fixtures/images/alpha.png", "p.png"],
]) {
  fs.copyFileSync(path.join(root, from), path.join(work, to));
}
const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Проба</title><style>
@font-face { font-family: 'T'; src: url('r.ttf'); font-weight: 400; }
@font-face { font-family: 'T'; src: url('b.ttf'); font-weight: 700; }
@page { size: 148mm 210mm; margin: 0 }
body { margin: 0; font-family: 'T'; font-size: 11pt; }
.page { width: 148mm; height: 210mm; box-sizing: border-box; padding: 15mm; break-after: page; overflow: hidden }
.picture { display: block; width: 40mm; height: 20mm; }
</style></head><body>
<div class="page"><h1 id="t1">Глава первая</h1><p>Съешь же ещё этих мягких французских булок, да выпей чаю.
Ligature fi fl ffi. <em>Курсив без своего начертания.</em> <a href="#n1">[1]</a>
<a href="https://example.org/x">внешняя ссылка</a></p><img class="picture" src="p.jpg" alt=""></div>
<div class="page"><h2 id="t2">Раздел</h2><p id="n1">Примечание один. <a href="#t2">назад</a></p>
<img class="picture" src="p.png" alt=""></div>
</body></html>`;
fs.writeFileSync(path.join(work, "doc.html"), html);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(path.join(work, "doc.html")).href);
await page.evaluate(() => document.fonts.ready);
const out = path.join(root, "tests", "fixtures", "pdf", "chromium-sample.pdf");
await page.pdf({
  path: out,
  preferCSSPageSize: true,
  printBackground: true,
  tagged: true,
  outline: false,
});
await browser.close();
fs.rmSync(work, { recursive: true, force: true });
console.log(
  `wrote ${path.relative(root, out)} (${fs.statSync(out).size} bytes)`,
);
