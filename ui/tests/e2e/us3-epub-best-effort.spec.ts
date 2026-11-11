/**
 * Feature 012, User Story 3 - What FB2 cannot hold (D23-D27; FR-040-FR-044; SC-007, SC-008). Runs
 * against the real core: every picture of the new book is JPEG or PNG, SVG drawings and MathML
 * formulas are drawn, the look becomes FB2 forms and a few named styles, what FB2 has no place for is
 * listed, and no request leaves the machine.
 */

import { expect, shownDocId, test } from './fixtures/core';
import { bodyErrors, bookXml, epub, importDone, importViaMenu } from './fixtures/epubImport';

test.describe('US3 (feature 012) - what FB2 cannot hold', () => {
  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
  });

  test('pictures as JPEG or PNG, drawings and formulas drawn, the rest listed, nothing fetched', async ({
    core,
    page,
  }) => {
    const outside: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (!/^(blob|data):/.test(url) && !url.startsWith('http://127.0.0.1')) outside.push(url);
    });
    const summary = await importDone(
      page,
      await importViaMenu(core, page, epub('everything.epub')),
    );
    for (const line of [
      'Picture converted to JPEG or PNG: i.webp (WebP)',
      'Picture converted to JPEG or PNG: a.gif (GIF)',
      'Picture converted to JPEG or PNG: i.bmp (BMP)',
      'Picture converted to JPEG or PNG: i.tif (TIFF)',
      'Picture converted to JPEG or PNG: i.avif (AVIF)',
      'Picture converted to JPEG or PNG: d.svg (SVG)',
      'Embedded fonts, left out: f.otf',
      'Audio and video, left out (their text and poster picture kept): s.mp3, v.mp4',
      'Scripts, left out and never run: 1',
      'Forms and interactive parts, left out: 1',
      'Read-aloud synchronisation (media overlays), left out: c1.smil',
      'Page-number markers, left out: 1',
      "The list of the print edition's pages, left out",
      'Resource on the web, not fetched: https://example.com/remote.png',
      'Resource on the web, not fetched: https://example.com/f.woff2',
    ]) {
      expect(summary, line).toContain(line);
    }
    const docId = await shownDocId(page);
    const binaries = await core.rpc<Array<{ id: string; contentType: string }>>('binary.list', {
      docId,
    });
    for (const binary of binaries) {
      expect(['image/jpeg', 'image/png'], binary.id).toContain(binary.contentType);
    }
    expect(binaries.map((binary) => binary.id)).toEqual(
      expect.arrayContaining(['i', 'a', 'poster', 'd', 'mathml_1', 'svg_1']),
    );
    expect(await bodyErrors(core, page)).toEqual([]);
    const xml = await bookXml(core, page);
    expect(xml).toContain('alt="x squared"');
    expect(xml).toContain('The audio fallback text.');
    expect(xml).toContain('The video fallback.');
    expect(xml).not.toContain('never runs');
    expect(await page.title()).not.toContain('never runs');
    expect(outside).toEqual([]);
  });

  test('a fixed-layout book comes in reading order, its positions listed', async ({
    core,
    page,
  }) => {
    const summary = await importDone(
      page,
      await importViaMenu(core, page, epub('fixed-layout.epub')),
    );
    expect(summary).toContain('The positions of the fixed-layout pages, left out');
    const xml = await bookXml(core, page);
    expect(xml).toMatch(/<image l:href="#p"[^>]*\/>[\s\S]*Text on page 1\./);
  });

  test("a Calibre book's classes: FB2 forms, exactly three named styles, the paragraph look (SC-008)", async ({
    core,
    page,
  }) => {
    await importDone(page, await importViaMenu(core, page, epub('calibre-like.epub')));
    expect(await bodyErrors(core, page)).toEqual([]);
    const xml = await bookXml(core, page);
    expect(xml).toContain('<emphasis>italic</emphasis>');
    expect(xml).toContain('<strong>bold</strong>');
    expect(xml).toContain('<style name="calibre7">Small caps</style>');
    expect(xml).toContain('<p style="calibre8">Centred.</p>');
    expect(xml).toContain('<style name="calibre9">Spaced</style>');
    expect(xml).toContain('<p>Plain again.</p>');
    const stylesheet = /<stylesheet[^>]*>([\s\S]*?)<\/stylesheet>/.exec(xml)?.[1] ?? '';
    expect(stylesheet.match(/\.calibre\d+ \{/g)).toEqual([
      '.calibre7 {',
      '.calibre8 {',
      '.calibre9 {',
    ]);
    expect(stylesheet).toContain('text-indent: 1.2em');
  });

  test('an SVG page becomes a picture in the text', async ({ core, page }) => {
    await importDone(page, await importViaMenu(core, page, epub('svg-pages.epub')));
    const docId = await shownDocId(page);
    const binaries = await core.rpc<Array<{ id: string; contentType: string }>>('binary.list', {
      docId,
    });
    expect(binaries.find((binary) => binary.id === 'page')?.contentType).toMatch(
      /^image\/(png|jpeg)$/,
    );
    expect(await bookXml(core, page)).toContain('<image l:href="#page"');
  });
});
