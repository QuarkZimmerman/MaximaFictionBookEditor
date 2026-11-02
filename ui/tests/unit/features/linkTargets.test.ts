/**
 * Feature 008, T049 (FR-040, FR-045, data-model §8): the jump destinations are every element id
 * of the whole book in document order - footnote 2 before footnote 10 - and the images are the
 * book's pictures in book order.
 */
import { describe, expect, it } from 'vitest';

import { collectImageRefs, collectJumpTargets } from '@/features/linkTargets';
import type { Document } from '@/model/document';

import { fakeDocument } from './testUtils';

function section(id: string | null, ...content: unknown[]) {
  return { type: 'section', attrs: { nodeId: `n-${id ?? 'x'}`, ...(id ? { id } : {}) }, content };
}

describe('collectJumpTargets', () => {
  it('lists every id in document order, notes body included, numbers in reading order', () => {
    const notes = Array.from({ length: 12 }, (_, i) => section(`n_${i + 1}`));
    const doc = fakeDocument({
      bodies: [
        { type: 'body', attrs: { nodeId: 'b1' }, content: [section('ch_1'), section(null)] },
        { type: 'body', attrs: { nodeId: 'b2', name: 'notes' }, content: notes },
      ] as unknown as Document['bodies'],
    });
    const hrefs = collectJumpTargets(doc).map((t) => t.href);
    expect(hrefs.slice(0, 3)).toEqual(['#ch_1', '#n_1', '#n_2']);
    expect(hrefs.indexOf('#n_2')).toBeLessThan(hrefs.indexOf('#n_10'));
    expect(hrefs).toHaveLength(13);
  });

  it('starts with the ids of the annotation, as the Body view shows it', () => {
    const doc = fakeDocument({
      bodies: [
        { type: 'body', attrs: { nodeId: 'b1' }, content: [section('ch_1')] },
      ] as unknown as Document['bodies'],
    });
    doc.description.titleInfo.annotation = {
      type: 'annotation',
      attrs: { nodeId: 'a1', id: 'about' },
      content: [],
    } as unknown as NonNullable<Document['description']['titleInfo']['annotation']>;
    expect(collectJumpTargets(doc).map((t) => t.href)).toEqual(['#about', '#ch_1']);
  });

  it('is empty without a book', () => {
    expect(collectJumpTargets(null)).toEqual([]);
  });
});

describe('collectImageRefs', () => {
  it("lists the book's pictures in book order and nothing else", () => {
    const doc = fakeDocument({
      binaries: [
        { id: 'cover.jpg', contentType: 'image/jpeg', size: 10 },
        { id: 'data.bin', contentType: 'application/octet-stream', size: 5 },
        { id: 'pic.png', contentType: 'image/png', size: 7 },
      ] as Document['binaries'],
    });
    expect(collectImageRefs(doc).map((t) => t.href)).toEqual(['#cover.jpg', '#pic.png']);
  });
});
