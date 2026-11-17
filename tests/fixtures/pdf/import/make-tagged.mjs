// Feature 016 (research R10): the tagged text fixture, printed by Chromium (as the PDF export's journeys
// print) from a small HTML page with headings, paragraphs, a list, a table, a figure with alternative text
// and links. Run by make-fixtures.py from ui/ (Playwright's Chromium); writes the PDF to standard output.
import { chromium } from '../../../../ui/node_modules/playwright/index.mjs';

const picture =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4//8/AAX+Av4zEpUUAAAAAElFTkSuQmCC';
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Tagged</title></head><body>
<h1>Heading One</h1>
<p>A first paragraph of the tagged fixture, with <strong>strong</strong> and <em>emphasis</em> words.</p>
<h2>Heading Two</h2>
<ul><li>First item</li><li>Second item</li></ul>
<table><tr><th>Head A</th><th>Head B</th></tr><tr><td>Cell one</td><td>Cell two</td></tr></table>
<p><img src="${picture}" alt="A figure" width="80" height="40"></p>
<p>A link to <a href="https://example.org/">a web page</a>.</p>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html);
const pdf = await page.pdf({ format: 'A5', tagged: true, outline: true });
await browser.close();
process.stdout.write(pdf);
