/**
 * Feature 014, User Story 2 (tasks T033): the whole description in the PDF's metadata. pdf.js - the
 * library site's reader, not the export's own library - reads the Info dictionary and the XMP back:
 * the title and the authors where readers look for them, the editor's record equal to the book's
 * description, and the same document id for two exports of one book, each with its own instance id.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/core';
import { exportPdfTo, openFixtureBook } from './fixtures/pdfExport';
import { startPrintSeam } from './fixtures/printSeam';

declare const window: { __mfbeTest?: { scripts?: { toXml(): Promise<string> } } };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(ROOT, 'build', 'pdf-export');

interface PdfMetadata {
  info: Record<string, unknown>;
  metadata: { getRaw(): string } | null;
}
interface PdfJs {
  getDocument(options: { data: Uint8Array; verbosity: number; isEvalSupported: boolean }): {
    promise: Promise<{ getMetadata(): Promise<PdfMetadata> }>;
    destroy(): Promise<void>;
  };
}

async function metadataOf(file: string): Promise<{ info: Record<string, unknown>; xmp: string }> {
  const { getDocument } = (await import(
    pathToFileURL(path.join(ROOT, 'ui', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs'))
      .href
  )) as PdfJs;
  const task = getDocument({
    data: new Uint8Array(readFileSync(file)),
    verbosity: 0,
    isEvalSupported: false,
  });
  const { info, metadata } = await (await task.promise).getMetadata();
  await task.destroy();
  return { info, xmp: metadata?.getRaw() ?? '' };
}

const unescape = (text: string): string =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');

/**
 * An element tree in a canonical form (names and namespaces, attributes sorted, text squeezed), read
 * in the page: the e2e files have no DOM types, so the reader is a string evaluated there.
 */
function canonical(page: Page, xml: string, element: string, drop: string[] = []): Promise<string> {
  return page.evaluate(`(() => {
    const doc = new DOMParser().parseFromString(${JSON.stringify(xml)}, 'application/xml');
    const root = doc.getElementsByTagNameNS('*', ${JSON.stringify(element)})[0];
    const drop = new Set(${JSON.stringify(drop)});
    const form = (node) => {
      if (node.nodeType === 3) return node.data.replace(/\\s+/g, ' ').trim();
      if (node.nodeType !== 1) return '';
      if (node.parentNode && drop.has(node.parentNode.localName + '/' + node.localName)) return '';
      const attrs = [...node.attributes]
        .filter((a) => !a.name.startsWith('xmlns'))
        .map((a) => (a.namespaceURI || '') + ':' + a.localName + '=' + a.value)
        .sort();
      const children = [...node.childNodes].map(form).filter((c) => c !== '');
      return JSON.stringify([node.namespaceURI + ':' + node.localName, attrs, children]);
    };
    return root ? form(root) : '';
  })()`);
}

test.describe('US2: the whole description in the PDF metadata (feature 014)', () => {
  test('Info and XMP hold the description; the record equals it; one document id per book', async ({
    core,
    page,
    context,
  }) => {
    test.skip(!core.hasCore, 'needs the core');
    test.setTimeout(600_000);
    await core.openApp(page);
    const seam = startPrintSeam(core, context);
    try {
      const book = await openFixtureBook(core, page, 'reference-all-elements.fb2');
      const first = path.join(OUT, 'metadata-1.pdf');
      const second = path.join(OUT, 'metadata-2.pdf');
      await exportPdfTo(core, page, first, 'A5 (148 × 210 mm)');
      await exportPdfTo(core, page, second, 'A6 (105 × 148 mm)');
      const one = await metadataOf(first);
      const two = await metadataOf(second);
      const source = readFileSync(book, 'utf8');
      const title = /<book-title>([^<]*)<\/book-title>/.exec(source)?.[1] ?? '';

      // D14: where readers look for them.
      expect(one.info.Title).toBe(title);
      expect(String(one.info.Author ?? '')).not.toBe('');
      expect(one.info.Creator).toMatch(/^Maxima Fiction Book Editor /);
      expect(one.xmp).toContain('<pdfaid:part>2</pdfaid:part>');
      expect(one.xmp).toContain(`<rdf:li xml:lang="x-default">${title}</rdf:li>`);
      expect(one.xmp).toContain('<mfbe:recordVersion>1</mfbe:recordVersion>');

      // D15: the record is the book's description as the window has it (D4), which the editor's
      // own XML of the book gives (the file on disk lacks what the editor fills in, program-used).
      const record = /<mfbe:fb2Description>([\s\S]*?)<\/mfbe:fb2Description>/.exec(one.xmp)?.[1];
      expect(record).toBeTruthy();
      const windowXml = await page.evaluate(() => window.__mfbeTest!.scripts!.toXml());
      // The annotation and the history are printed on pages of their own, so the record leaves
      // them out (requester, rc.4): it equals the rest of the description.
      expect(unescape(record!)).not.toContain('<annotation');
      expect(unescape(record!)).not.toContain('<history');
      expect(await canonical(page, unescape(record!), 'description')).toBe(
        await canonical(page, windowXml, 'description', [
          'title-info/annotation',
          'document-info/history',
        ]),
      );

      // D16: one document id for the book, a new instance id for each export.
      const id = (xmp: string, name: string): string =>
        new RegExp(`<xmpMM:${name}>([^<]*)</xmpMM:${name}>`).exec(xmp)?.[1] ?? '';
      expect(id(one.xmp, 'DocumentID')).not.toBe('');
      expect(id(two.xmp, 'DocumentID')).toBe(id(one.xmp, 'DocumentID'));
      expect(id(one.xmp, 'InstanceID')).toMatch(/^uuid:/);
      expect(id(two.xmp, 'InstanceID')).not.toBe(id(one.xmp, 'InstanceID'));
    } finally {
      await seam.stop();
    }
  });
});
