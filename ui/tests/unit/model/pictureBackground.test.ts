// Feature 010, US3 (D9, D10): the pictures' background choices - white by default, switched per
// image of one document, forgotten with the document, never stored.

import { describe, expect, it, vi } from 'vitest';

import {
  confirmTransparency,
  forgetPictureBackgrounds,
  pictureBackground,
  pictureBackgroundRevision,
  subscribePictureBackgrounds,
  togglePictureBackground,
  transparencyConfirmed,
} from '@/model/pictureBackground';

describe('picture backgrounds', () => {
  it('are white until switched, per image of one document', () => {
    expect(pictureBackground('doc-a', 'pic.png')).toBe('white');
    expect(pictureBackground(null, 'pic.png')).toBe('white');
    togglePictureBackground('doc-a', 'pic.png');
    expect(pictureBackground('doc-a', 'pic.png')).toBe('page');
    expect(pictureBackground('doc-a', 'other.png')).toBe('white');
    expect(pictureBackground('doc-b', 'pic.png')).toBe('white');
    togglePictureBackground('doc-a', 'pic.png');
    expect(pictureBackground('doc-a', 'pic.png')).toBe('white');
  });

  it('notify every listener and count revisions', () => {
    const listener = vi.fn();
    const off = subscribePictureBackgrounds(listener);
    const before = pictureBackgroundRevision();
    togglePictureBackground('doc-c', 'x.png');
    confirmTransparency('doc-c', 'x.png', true);
    confirmTransparency('doc-c', 'x.png', true); // unchanged: no notification
    expect(listener).toHaveBeenCalledTimes(2);
    expect(pictureBackgroundRevision()).toBe(before + 2);
    off();
    togglePictureBackground('doc-c', 'x.png');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('are forgotten with their document, transparency checks included', () => {
    togglePictureBackground('doc-d', 'p.png');
    confirmTransparency('doc-d', 'p.png', true);
    expect(transparencyConfirmed('doc-d', 'p.png')).toBe(true);
    forgetPictureBackgrounds('doc-d');
    expect(pictureBackground('doc-d', 'p.png')).toBe('white');
    expect(transparencyConfirmed('doc-d', 'p.png')).toBeUndefined();
  });
});
