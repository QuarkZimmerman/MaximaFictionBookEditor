/**
 * Feature 016 (D23): the FBD the export wrote beside the editor's own PDF repeats its description - no question.
 */
import { describe, expect, it } from 'vitest';

import { sameDescription } from '@/features/pdf/import/fbd';
import type { ReadDescriptionResult } from '@/rpc/types';

const read = (contentType: string): ReadDescriptionResult =>
  ({
    importId: 'x',
    description: {
      titleInfo: { bookTitle: 'B', coverpage: [{ href: '#cover.jpg' }] },
      documentInfo: { id: '1' },
    },
    documentDetails: {},
    binaries: [{ id: 'cover.jpg', contentType, width: 424, height: 640 }],
    warnings: [],
  }) as unknown as ReadDescriptionResult;

describe("the FBD beside the editor's own PDF (D23)", () => {
  it('repeats its description when the cover is a JPEG the book calls image/jpg', () => {
    // The requester's smoke test of rc.1: the book's cover binary said image/jpg.
    expect(
      sameDescription(read('image/jpg'), read('image/jpg'), { w: 424, h: 640, jpeg: true }),
    ).toBe(true);
    expect(
      sameDescription(read('image/jpeg'), read('image/jpeg'), { w: 424, h: 640, jpeg: true }),
    ).toBe(true);
  });

  it('holds another one when its cover differs', () => {
    expect(
      sameDescription(read('image/png'), read('image/png'), { w: 424, h: 640, jpeg: true }),
    ).toBe(false);
    expect(
      sameDescription(read('image/jpg'), read('image/jpg'), { w: 400, h: 640, jpeg: true }),
    ).toBe(false);
  });
});
