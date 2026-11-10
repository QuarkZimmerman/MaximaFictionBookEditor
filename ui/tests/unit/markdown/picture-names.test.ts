// Feature 011 (US5, US6; D24; contracts/markdown-export.md §5): the exported pictures' names.
import { describe, expect, it } from 'vitest';

import { pictureNames } from '@/features/markdown/export/pictureNames';

describe('picture names (D24)', () => {
  it('replaces the characters a system refuses and adds the type’s extension when missing', () => {
    const names = pictureNames(
      [
        { id: 'a:b?c*d', contentType: 'image/png' },
        { id: 'cover.jpg', contentType: 'image/jpeg' },
        { id: 'trailing. ', contentType: 'image/gif' },
        { id: 'raw', contentType: 'application/octet-stream' },
      ],
      'zip',
    );
    expect(names.get('a:b?c*d')).toBe('a_b_c_d.png');
    expect(names.get('cover.jpg')).toBe('cover.jpg');
    expect(names.get('trailing. ')).toBe('trailing__.gif');
    expect(names.get('raw')).toBe('raw.bin');
  });

  it('gives a reserved Windows name a _ after it, with or without an extension', () => {
    const names = pictureNames(
      [
        { id: 'CON', contentType: 'image/png' },
        { id: 'nul.jpg', contentType: 'image/jpeg' },
        { id: 'com1', contentType: 'image/png' },
      ],
      'zip',
    );
    expect(names.get('CON')).toBe('CON_.png');
    expect(names.get('nul.jpg')).toBe('nul_.jpg');
    expect(names.get('com1')).toBe('com1_.png');
  });

  it('keeps names unique without regard to letter case', () => {
    const names = pictureNames(
      [
        { id: 'Pic.png', contentType: 'image/png' },
        { id: 'pic.PNG', contentType: 'image/png' },
        { id: 'PIC.png', contentType: 'image/png' },
      ],
      'zip',
    );
    expect([...names.values()]).toEqual(['Pic.png', 'pic-2.PNG', 'PIC-3.png']);
  });

  it('the one-file form names every picture .jpg', () => {
    const names = pictureNames(
      [
        { id: 'a.png', contentType: 'image/png' },
        { id: 'b', contentType: 'image/gif' },
        { id: 'A', contentType: 'image/png' },
      ],
      'md',
    );
    expect([...names.values()]).toEqual(['a.jpg', 'b.jpg', 'A-2.jpg']);
  });
});
