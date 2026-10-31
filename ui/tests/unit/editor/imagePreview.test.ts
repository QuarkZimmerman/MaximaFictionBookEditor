/**
 * Feature 006, user story 3 - pictures in table cells: the size of a picture's preview and the
 * box the image node view reserves until it loads (T080; research R9 §7.6 and R9.5 "Unit
 * test"; quickstart §3 "Unit and core tests"; contracts/rpc-api.md §2 "The preview's size",
 * whose rule `tests/core/test_images.cpp` pins on the core's side; data-model §9.8 "The reserved
 * box"; research open point 23), and the display rules' scope in `ui/src/editor/styles.css`
 * (FR-027, FR-031; research R9.1 "Only long-standing CSS").
 *
 * jsdom loads no picture: `complete`, `naturalWidth` and `naturalHeight` are stubbed on the
 * `img` and `load` is dispatched by hand.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';

import {
  binaryLookup,
  createImageNodeViews,
  type ImageViewOptions,
} from '@/editor/nodeviews/image';
import { fb2Schema } from '@/editor/schema';
import { previewSize } from '@/model/binaryUrls';
import type { BinaryMeta } from '@/model/document';

function meta(id: string, width?: number, height?: number, decodable = true): BinaryMeta {
  return {
    id,
    contentType: 'image/png',
    size: 100,
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    decodable,
    willConvert: false,
    referenceCount: 1,
  };
}

describe('previewSize follows the core’s rule (preview?w=800, contracts/rpc-api.md §2)', () => {
  it('keeps a picture up to the width and scales a wider one, rounding half away from zero', () => {
    expect(previewSize(meta('a', 800, 600))).toEqual([800, 600]);
    expect(previewSize(meta('a', 4000, 3000))).toEqual([800, 600]);
    expect(previewSize(meta('a', 1600, 1200))).toEqual([800, 600]);
    expect(previewSize(meta('a', 2000, 2000))).toEqual([800, 800]);
    expect(previewSize(meta('a', 3000, 100))).toEqual([800, 27]);
    expect(previewSize(meta('a', 300, 3000))).toEqual([300, 3000]);
    expect(previewSize(meta('a', 64, 512))).toEqual([64, 512]);
    expect(previewSize(meta('a', 1600, 1001))).toEqual([800, 501]);
    // scale_to_fit's 1 px minimum: a flatter picture than 1600:1 keeps a height.
    expect(previewSize(meta('a', 10000, 5))).toEqual([800, 1]);
    expect(previewSize(meta('a', 800, 600), 400)).toEqual([400, 300]);
  });

  it('gives no size without both dimensions, nor for a binary the core cannot decode', () => {
    expect(previewSize(meta('a', 800))).toBeNull();
    expect(previewSize(meta('a', undefined, 600))).toBeNull();
    expect(previewSize(meta('a'))).toBeNull();
    expect(previewSize(meta('a', 800, 600, false))).toBeNull();
  });
});

describe('binaryLookup follows a replaced list', () => {
  it('reads a new array again and keeps its map for the same one', () => {
    let list: readonly BinaryMeta[] | undefined = [meta('a.png', 10, 10)];
    let reads = 0;
    const lookup = binaryLookup(() => {
      reads += 1;
      return list;
    });
    expect(lookup('a.png')?.width).toBe(10);
    expect(lookup('b.png')).toBeNull();
    // The same array: the same answers (the map is kept).
    const first = lookup('a.png');
    expect(lookup('a.png')).toBe(first);
    // A replaced array (the store replaces it on every change) is read again.
    list = [meta('a.png', 20, 20), meta('b.png', 5, 5)];
    expect(lookup('a.png')?.width).toBe(20);
    expect(lookup('b.png')?.height).toBe(5);
    expect(reads).toBeGreaterThan(0);
    list = undefined;
    expect(lookup('a.png')).toBeNull();
  });
});

/* ------------------------------------------------------------------------ */
/* The node view's reserved box                                             */
/* ------------------------------------------------------------------------ */

function inlineImage(href: string, alt: string | null = null): PMNode {
  return fb2Schema.nodes.inline_image!.create({ href, alt });
}

function viewOf(node: PMNode, options: Partial<ImageViewOptions> = {}): NodeView {
  const views = createImageNodeViews({
    getDocId: () => 'd1',
    getMissingText: () => 'Image not available:',
    ...options,
  });
  return views.inline_image!(
    node,
    undefined as unknown as EditorView,
    () => 0,
    [],
    undefined as never,
  );
}

function imgOf(view: NodeView): HTMLImageElement {
  return view.dom.querySelector('img')!;
}

/** What jsdom cannot do: the picture has loaded at this natural size. */
function loadAs(img: HTMLImageElement, width: number, height: number): void {
  Object.defineProperty(img, 'complete', { configurable: true, get: () => true });
  Object.defineProperty(img, 'naturalWidth', { configurable: true, get: () => width });
  Object.defineProperty(img, 'naturalHeight', { configurable: true, get: () => height });
  img.dispatchEvent(new Event('load'));
}

function properties(img: HTMLImageElement): [string, string] {
  return [img.style.getPropertyValue('--mfbe-nw'), img.style.getPropertyValue('--mfbe-nh')];
}

describe('the image node view reserves a picture’s box until its preview loads (R9.2)', () => {
  it('reserves the box of a listed binary and releases it on load', () => {
    const list = [meta('photo.png', 4000, 3000)];
    const view = viewOf(inlineImage('#photo.png'), { getBinary: binaryLookup(() => list) });
    const img = imgOf(view);
    expect(img.getAttribute('src')).toContain('/binary/d1/photo.png/preview?w=800');
    expect(img.classList.contains('fb-sized')).toBe(true);
    expect(properties(img)).toEqual(['800', '600']);
    loadAs(img, 800, 600);
    expect(img.classList.contains('fb-sized')).toBe(false);
    expect(properties(img)).toEqual(['800', '600']);
  });

  it('still requests an undecodable binary and reserves nothing for it', () => {
    const list = [meta('banner.svg', 3000, 100, false)];
    const view = viewOf(inlineImage('#banner.svg'), { getBinary: binaryLookup(() => list) });
    const img = imgOf(view);
    expect(img.getAttribute('src')).toContain('/binary/d1/banner.svg/preview?w=800');
    expect(img.classList.contains('fb-sized')).toBe(false);
    expect(properties(img)).toEqual(['', '']);
  });

  it('a binary without a listed size that loads, such as an SVG, gets the properties from its natural size and keeps them through update()', () => {
    const list = [meta('banner.svg', undefined, undefined, false)];
    const view = viewOf(inlineImage('#banner.svg'), { getBinary: binaryLookup(() => list) });
    const img = imgOf(view);
    expect(properties(img)).toEqual(['', '']);
    loadAs(img, 3000, 100);
    expect(img.classList.contains('fb-sized')).toBe(false);
    expect(properties(img)).toEqual(['3000', '100']);
    expect(view.update!(inlineImage('#banner.svg', 'A banner'), [], undefined as never)).toBe(true);
    expect(img.alt).toBe('A banner');
    expect(properties(img)).toEqual(['3000', '100']);
    expect(img.classList.contains('fb-sized')).toBe(false);
  });

  it('an EXIF-rotated JPEG listed as 600 × 800 that loads as 800 × 600 takes the loaded proportions', () => {
    const list = [{ ...meta('turned.jpg', 600, 800), contentType: 'image/jpeg' }];
    const view = viewOf(inlineImage('#turned.jpg'), { getBinary: binaryLookup(() => list) });
    const img = imgOf(view);
    expect(img.classList.contains('fb-sized')).toBe(true);
    expect(properties(img)).toEqual(['600', '800']);
    loadAs(img, 800, 600);
    expect(img.classList.contains('fb-sized')).toBe(false);
    expect(properties(img)).toEqual(['800', '600']);
  });

  it('without a lookup, or for an unknown id, it reserves nothing and requests as today', () => {
    for (const options of [{}, { getBinary: binaryLookup(() => [meta('other.png', 10, 10)]) }]) {
      const img = imgOf(viewOf(inlineImage('#photo.png'), options));
      expect(img.getAttribute('src')).toContain('/binary/d1/photo.png/preview?w=800');
      expect(img.classList.contains('fb-sized')).toBe(false);
      expect(properties(img)).toEqual(['', '']);
    }
  });
});

/* ------------------------------------------------------------------------ */
/* The display rules' scope (research R9.1)                                 */
/* ------------------------------------------------------------------------ */

describe('the display rules of pictures (ui/src/editor/pictures.css, styles.css)', () => {
  const read = (name: string) =>
    readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), `../../../src/editor/${name}`),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
  const styles = read('styles.css');
  const pictures = read('pictures.css');
  const css = `${pictures}\n${styles}`;
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1]!
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    body: m[2]!,
  }));
  const ruleFor = (selector: string) => rules.find(({ selectors }) => selectors.includes(selector));

  it('keeps every picture rule in pictures.css, imported by styles.css (feature 007, DP-4)', () => {
    expect(styles).toMatch(/@import '\.\/pictures\.css';/);
    expect(styles).not.toMatch(/fb-image|fb-inline-image|fb-sized|--mfbe-nw/);
  });

  it('scopes every rule of the cell display to .fb-editor .fb-table', () => {
    // The cell display is the one that uses the cell's height cap or floor.
    const cellRules = rules.filter(({ body }) => /var\(--mfbe-pic-cell-(lines|floor)\)/.test(body));
    expect(cellRules.length).toBeGreaterThanOrEqual(3);
    for (const { selectors } of cellRules) {
      for (const selector of selectors) expect(selector).toContain('.fb-editor .fb-table');
    }
    // The constants are defined once, on the editor.
    expect(ruleFor('.fb-editor')?.body).toMatch(/--mfbe-pic-cell-floor:\s*1\.6em/);
    expect(ruleFor('.fb-editor')?.body).toMatch(/--mfbe-pic-cell-lines:\s*10/);
    // Cells keep their own alignment: centred picture, box hanging from the top of its line.
    expect(ruleFor('.fb-editor .fb-table .fb-inline-image img')?.body).toMatch(
      /vertical-align:\s*middle/,
    );
    expect(ruleFor('.fb-editor .fb-table .fb-inline-image')?.body).toMatch(/vertical-align:\s*top/);
  });

  it('gives inline pictures outside cells their natural size: no height cap (FR-060)', () => {
    for (const selector of ['.fb-editor .fb-inline-image img', '.fb-editor .fb-inline-image']) {
      const rule = ruleFor(selector);
      expect(rule?.body).toMatch(/max-width:\s*100%/);
      expect(rule?.body).not.toMatch(/max-height/);
      expect(rule?.body).toMatch(/vertical-align:\s*baseline/);
    }
    expect(ruleFor('.fb-editor .fb-inline-image')?.body).toMatch(/text-indent:\s*0/);
    expect(ruleFor('.fb-editor .fb-starts-with-picture')?.body).toMatch(/text-indent:\s*0/);
  });

  it('reserves the natural box of block and inline pictures until their preview loads', () => {
    for (const selector of [
      '.fb-editor .fb-image img.fb-sized',
      '.fb-editor .fb-inline-image img.fb-sized',
    ]) {
      const body = ruleFor(selector)?.body ?? '';
      expect(body).toMatch(/width:\s*calc\(var\(--mfbe-nw\) \* 1px\)/);
      expect(body).toMatch(/aspect-ratio:\s*var\(--mfbe-nw\) \/ var\(--mfbe-nh\)/);
    }
  });

  it('uses only long-standing CSS: no :has(), container queries or calc-size()', () => {
    expect(css).not.toContain(':has(');
    expect(css).not.toContain('@container');
    expect(css).not.toContain('calc-size(');
  });
});
