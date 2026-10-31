/**
 * Feature 007 (T014, data-model §3, DP-3): `ui/src/model/binaryUrls.ts` is the one builder of the
 * addresses of a book's binaries - the preview the core scales (`GET /binary/:docId/:id/preview`)
 * and the original bytes (`GET /binary/:docId/:id`) - and of the preview's size, which mirrors the
 * core's `scale_to_fit` (`core/src/images/converter.cpp`: the factor is the smaller of 1,
 * width / maxW and height / maxH; each side is rounded half away from zero and at least 1 px; it
 * never upscales). It also says which pictures the engine shows itself.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  PREVIEW_WIDTH,
  binaryOriginalUrl,
  binaryPreviewUrl,
  displayableInEngine,
  forgetBinaries,
  observeBinaries,
  previewSize,
} from '@/model/binaryUrls';
import type { BinaryMeta, Document } from '@/model/document';
import { createAppStore } from '@/model/store';

function meta(width?: number, height?: number, decodable = true): BinaryMeta {
  return {
    id: 'pic.png',
    contentType: 'image/png',
    size: 100,
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    decodable,
    willConvert: false,
    referenceCount: 1,
  };
}

const BASE = import.meta.env.BASE_URL;

function withToken(token: string): void {
  window.history.replaceState(null, '', `/?token=${token}`);
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
  forgetBinaries(null);
});

describe('PREVIEW_WIDTH and previewSize', () => {
  it('serves 800 px wide previews', () => {
    expect(PREVIEW_WIDTH).toBe(800);
  });

  it('mirrors the core’s scale_to_fit for a width alone', () => {
    expect(previewSize(meta(800, 600))).toEqual([800, 600]);
    expect(previewSize(meta(4000, 3000))).toEqual([800, 600]);
    expect(previewSize(meta(3000, 100))).toEqual([800, 27]);
    expect(previewSize(meta(1600, 1001))).toEqual([800, 501]);
    expect(previewSize(meta(10000, 5))).toEqual([800, 1]);
    expect(previewSize(meta(800, 600), 400)).toEqual([400, 300]);
  });

  it('fits a width and a height together, as the core does with w and h', () => {
    expect(previewSize(meta(3000, 4000), 1000, 1000)).toEqual([750, 1000]);
    expect(previewSize(meta(4000, 3000), 1000, 1000)).toEqual([1000, 750]);
    expect(previewSize(meta(640, 480), 640, 480)).toEqual([640, 480]);
    expect(previewSize(meta(300, 3000), 800, 600)).toEqual([60, 600]);
  });

  it('never upscales', () => {
    expect(previewSize(meta(300, 3000))).toEqual([300, 3000]);
    expect(previewSize(meta(64, 512))).toEqual([64, 512]);
    expect(previewSize(meta(16, 16), 4096, 4096)).toEqual([16, 16]);
  });

  it('is null for a binary the core does not decode or without both dimensions', () => {
    expect(previewSize(meta(800, 600, false))).toBeNull();
    expect(previewSize(meta(800))).toBeNull();
    expect(previewSize(meta())).toBeNull();
  });
});

describe('binaryPreviewUrl', () => {
  it('addresses the core’s preview of the binary with the session token', () => {
    withToken('t0k');
    expect(binaryPreviewUrl('doc-1', '#pic.png', 96)).toBe(
      `${BASE}binary/doc-1/pic.png/preview?w=96&token=t0k`,
    );
    expect(binaryPreviewUrl('doc-1', '#pic.png')).toBe(
      `${BASE}binary/doc-1/pic.png/preview?w=800&token=t0k`,
    );
    expect(binaryPreviewUrl('doc-1', '#scan.tif', 640, 480)).toBe(
      `${BASE}binary/doc-1/scan.tif/preview?w=640&h=480&token=t0k`,
    );
  });

  it('percent-encodes the document and the binary id', () => {
    withToken('t');
    expect(binaryPreviewUrl('doc 1', '#рис 1.png', 120)).toBe(
      `${BASE}binary/doc%201/%D1%80%D0%B8%D1%81%201.png/preview?w=120&token=t`,
    );
  });

  it('leaves the token out when the page has none (the build defines none for tests)', () => {
    expect(binaryPreviewUrl('doc-1', '#pic.png', 96)).toBe(
      `${BASE}binary/doc-1/pic.png/preview?w=96`,
    );
  });

  it('is null without a document, for an external or empty reference', () => {
    withToken('t');
    expect(binaryPreviewUrl(null, '#pic.png')).toBeNull();
    expect(binaryPreviewUrl('', '#pic.png')).toBeNull();
    expect(binaryPreviewUrl('doc-1', 'http://example.org/pic.png')).toBeNull();
    expect(binaryPreviewUrl('doc-1', '#')).toBeNull();
    expect(binaryPreviewUrl('doc-1', '#undefined')).toBeNull();
  });
});

describe('binaryOriginalUrl', () => {
  it('addresses the original bytes of the binary with the session token', () => {
    withToken('t0k');
    expect(binaryOriginalUrl('doc-1', '#small.jpg')).toBe(
      `${BASE}binary/doc-1/small.jpg?token=t0k`,
    );
    expect(binaryOriginalUrl('doc-1', '#рис.jpg')).toBe(
      `${BASE}binary/doc-1/%D1%80%D0%B8%D1%81.jpg?token=t0k`,
    );
  });

  it('is null without a document, for an external or empty reference', () => {
    withToken('t');
    expect(binaryOriginalUrl(null, '#small.jpg')).toBeNull();
    expect(binaryOriginalUrl('doc-1', 'small.jpg')).toBeNull();
    expect(binaryOriginalUrl('doc-1', '#undefined')).toBeNull();
  });
});

describe('displayableInEngine', () => {
  it('is true for the formats the engine shows itself', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp']) {
      expect(displayableInEngine(type)).toBe(true);
    }
    expect(displayableInEngine('IMAGE/JPEG')).toBe(true);
    expect(displayableInEngine('image/png; charset=binary')).toBe(true);
  });

  it('is false for every other type', () => {
    for (const type of [
      'image/tiff',
      'image/svg+xml',
      'image/x-icon',
      'application/octet-stream',
      'image/jpg',
      '',
    ]) {
      expect(displayableInEngine(type)).toBe(false);
    }
  });
});

/** A binary of the revision tests: `pic` with a size and dimensions to vary. */
function binary(id: string, size = 100, width = 10): BinaryMeta {
  return {
    id,
    contentType: 'image/png',
    size,
    width,
    height: 10,
    decodable: true,
    willConvert: false,
    referenceCount: 1,
  };
}

describe('observeBinaries - the addresses follow the binaries (feature 007: no refresh command)', () => {
  it('leaves the addresses of a document’s first list as they are', () => {
    observeBinaries('doc-1', [binary('a.png')]);
    expect(binaryPreviewUrl('doc-1', '#a.png', 96)).toBe(`${BASE}binary/doc-1/a.png/preview?w=96`);
    expect(binaryOriginalUrl('doc-1', '#a.png')).toBe(`${BASE}binary/doc-1/a.png`);
  });

  it('gives a binary that appears, goes, comes back or changes a new address', () => {
    withToken('t0k');
    observeBinaries('doc-1', [binary('a.png')]);
    // The binary of a dangling reference is added.
    observeBinaries('doc-1', [binary('a.png'), binary('b.png')]);
    expect(binaryPreviewUrl('doc-1', '#b.png', 96)).toBe(
      `${BASE}binary/doc-1/b.png/preview?w=96&r=1&token=t0k`,
    );
    expect(binaryOriginalUrl('doc-1', '#b.png')).toBe(`${BASE}binary/doc-1/b.png?r=1&token=t0k`);
    // Removed, then added again: the engine must not show its cached picture.
    observeBinaries('doc-1', [binary('a.png')]);
    observeBinaries('doc-1', [binary('a.png'), binary('b.png', 200)]);
    expect(binaryPreviewUrl('doc-1', '#b.png', 96)).toContain('&r=3&');
    // Converted in place: another size or pixel size.
    observeBinaries('doc-1', [binary('a.png', 100, 20), binary('b.png', 200)]);
    expect(binaryPreviewUrl('doc-1', '#a.png', 96)).toContain('&r=1&');
    expect(binaryPreviewUrl('doc-1', '#b.png', 96)).toContain('&r=3&');
  });

  it('keeps the addresses when a new list holds the same binaries', () => {
    observeBinaries('doc-1', [binary('a.png')]);
    observeBinaries('doc-1', [binary('a.png')]);
    expect(binaryPreviewUrl('doc-1', '#a.png', 96)).toBe(`${BASE}binary/doc-1/a.png/preview?w=96`);
  });

  it('keeps the documents apart and forgets all but the one kept', () => {
    observeBinaries('doc-1', []);
    observeBinaries('doc-1', [binary('a.png')]);
    observeBinaries('doc-2', [binary('a.png')]);
    expect(binaryPreviewUrl('doc-1', '#a.png', 96)).toContain('r=1');
    expect(binaryPreviewUrl('doc-2', '#a.png', 96)).not.toContain('r=');
    forgetBinaries('doc-2');
    expect(binaryPreviewUrl('doc-1', '#a.png', 96)).not.toContain('r=');
  });

  it('is fed by the store whenever the open document’s binary list changes', () => {
    const store = createAppStore();
    const document = (binaries: BinaryMeta[]) => ({ binaries }) as unknown as Document;
    store.setState({ docId: 'doc-9', document: document([]) });
    expect(binaryPreviewUrl('doc-9', '#a.png', 96)).not.toContain('r=');
    store.setState({ document: document([binary('a.png')]) });
    expect(binaryPreviewUrl('doc-9', '#a.png', 96)).toContain('r=1');
    // Another document: the first one's revisions are forgotten.
    store.setState({ docId: 'doc-10', document: document([binary('a.png')]) });
    expect(binaryPreviewUrl('doc-9', '#a.png', 96)).not.toContain('r=');
  });
});
