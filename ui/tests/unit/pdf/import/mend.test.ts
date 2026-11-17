/** Feature 016 (D15; tasks T035, T041): windows-1251 text read as Latin-1, mended. */
import { describe, expect, it } from 'vitest';

import { fromLatin1, looksLatin1Cyrillic } from '@/features/pdf/import/mend';

describe('mending a broken Cyrillic mapping (D15)', () => {
  it('reads Latin-1 letters as the windows-1251 letters they were', () => {
    expect(fromLatin1('Íî íè÷åãî')).toBe('Но ничего');
  });
  it('tells the symptom from ordinary accented text', () => {
    expect(looksLatin1Cyrillic('Íî íè÷åãî íå ñëó÷èëîñü')).toBe(true);
    expect(looksLatin1Cyrillic('Un café très agréable, déjà vu')).toBe(false);
  });
});
