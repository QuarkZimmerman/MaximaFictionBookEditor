/**
 * The proposed file name of a never-saved document (feature 004, FR-050 to FR-053; research
 * R6.1): "Last First - Title" from the first usable author and the title, each part sanitised on
 * its own, device names guarded, the stem cut to 120 code points and 200 UTF-8 bytes at a
 * code-point boundary, "Untitled" as the fallback; `exportStem` for the FBD export of a saved
 * book.
 */

import {
  authorPart,
  cutStem,
  exportStem,
  MAX_STEM_CODE_POINTS,
  MAX_STEM_UTF8_BYTES,
  proposedFileName,
  proposedStem,
} from '@/features/file/proposedName';
import type { Description, Person } from '@/model/document';

const UNTITLED = 'Без имени';

function person(p: Partial<Person>): Person {
  return { homePages: [], emails: [], ...p };
}

function description(authors: Person[], bookTitle: string): Description {
  return {
    titleInfo: {
      genres: [],
      authors,
      bookTitle,
      coverpage: [],
      lang: 'ru',
      translators: [],
      sequences: [],
    },
    documentInfo: {
      authors: [],
      date: { text: '' },
      srcUrls: [],
      id: '',
      version: '',
      publishers: [],
    },
    customInfo: [],
    outputs: [],
  };
}

const tolstoy = person({ lastName: 'Толстой', firstName: 'Лев', middleName: 'Николаевич' });

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

describe('proposedStem / proposedFileName (FR-050)', () => {
  it('composes "Last First - Title" from the first author and the title, the middle name unused', () => {
    expect(proposedStem(description([tolstoy], 'Война и мир'), UNTITLED)).toBe(
      'Толстой Лев - Война и мир',
    );
    expect(proposedFileName(description([tolstoy], 'Война и мир'), UNTITLED, 'fb2')).toBe(
      'Толстой Лев - Война и мир.fb2',
    );
    expect(proposedFileName(description([tolstoy], 'Война и мир'), UNTITLED, '.fbd')).toBe(
      'Толстой Лев - Война и мир.fbd',
    );
  });

  it('leaves a missing part out with its separator', () => {
    expect(proposedStem(description([], 'Война и мир'), UNTITLED)).toBe('Война и мир');
    expect(
      proposedStem(description([person({ homePages: [], emails: [] })], ' Война и мир '), UNTITLED),
    ).toBe('Война и мир');
    expect(proposedStem(description([tolstoy], ''), UNTITLED)).toBe('Толстой Лев');
    expect(proposedStem(description([person({ lastName: 'Толстой' })], ''), UNTITLED)).toBe(
      'Толстой',
    );
    expect(proposedStem(description([person({ firstName: 'Лев' })], 'Детство'), UNTITLED)).toBe(
      'Лев - Детство',
    );
  });

  it('takes the nickname when last and first name are empty, and skips unusable authors', () => {
    const nick = person({ nickname: 'Автор_без_имени', lastName: '  ', firstName: '' });
    expect(proposedStem(description([nick], 'Книга'), UNTITLED)).toBe('Автор_без_имени - Книга');
    // The template's empty author does not count: the second author is the first usable one.
    const empty = person({ firstName: '', lastName: '' });
    expect(proposedStem(description([empty, tolstoy], 'Война и мир'), UNTITLED)).toBe(
      'Толстой Лев - Война и мир',
    );
    expect(authorPart([empty, person({ nickname: ' nick ' }), tolstoy])).toBe('nick');
    expect(authorPart([])).toBe('');
  });

  it('falls back to the interface language\'s "Untitled"', () => {
    expect(proposedStem(description([], ''), UNTITLED)).toBe(UNTITLED);
    expect(proposedStem(description([person({ middleName: 'Николаевич' })], '   '), UNTITLED)).toBe(
      UNTITLED,
    );
    expect(proposedFileName(description([], ''), 'Untitled', 'fb2')).toBe('Untitled.fb2');
    expect(proposedFileName(description([], ''), 'Без назви', 'fbd')).toBe('Без назви.fbd');
  });
});

describe('sanitising (FR-052)', () => {
  it('replaces the characters any platform forbids by "_"', () => {
    expect(proposedStem(description([], 'Война/мир: что?'), UNTITLED)).toBe('Война_мир_ что_');
    expect(proposedStem(description([], 'a\\b*c"d<e>f|g'), UNTITLED)).toBe('a_b_c_d_e_f_g');
    expect(proposedStem(description([], 'tab\there\u0001bell\u007Fdel\u0085nel'), UNTITLED)).toBe(
      'tab_here_bell_del_nel',
    );
    // Each part on its own: a forbidden character in the author never touches the title.
    expect(
      proposedStem(description([person({ lastName: 'A:B', firstName: 'C?' })], 'T'), UNTITLED),
    ).toBe('A_B C_ - T');
  });

  it('drops a part made of forbidden characters only, with its separator', () => {
    expect(proposedStem(description([], '???'), UNTITLED)).toBe(UNTITLED);
    expect(proposedStem(description([tolstoy], '***'), UNTITLED)).toBe('Толстой Лев');
    expect(proposedStem(description([person({ lastName: '|' })], 'Книга'), UNTITLED)).toBe('Книга');
    expect(proposedStem(description([], '___'), UNTITLED)).toBe(UNTITLED);
  });

  it('removes leading and trailing spaces and dots of each part', () => {
    expect(proposedStem(description([], '...Книга...'), UNTITLED)).toBe('Книга');
    expect(proposedStem(description([], '  . Книга . '), UNTITLED)).toBe('Книга');
    expect(
      proposedStem(
        description([person({ lastName: '.Толстой.', firstName: ' Лев ' })], 'Книга.'),
        UNTITLED,
      ),
    ).toBe('Толстой. Лев - Книга');
    // Dots and spaces inside a part stay.
    expect(proposedStem(description([], 'Т. 1. Война и мир'), UNTITLED)).toBe('Т. 1. Война и мир');
  });

  it('guards a Windows device name, also before the first dot and in another case', () => {
    expect(proposedStem(description([], 'CON'), UNTITLED)).toBe('CON_');
    expect(proposedStem(description([], 'com1'), UNTITLED)).toBe('com1_');
    expect(proposedStem(description([], 'LPT¹'), UNTITLED)).toBe('LPT¹_');
    expect(proposedStem(description([], 'NUL. Роман'), UNTITLED)).toBe('NUL_. Роман');
    expect(proposedStem(description([], 'Aux.fb2.txt'), UNTITLED)).toBe('Aux_.fb2.txt');
    // A device name that is only part of a word, or after a separator, is no device name.
    expect(proposedStem(description([], 'CONTACT'), UNTITLED)).toBe('CONTACT');
    expect(proposedStem(description([person({ lastName: 'Иванов' })], 'NUL'), UNTITLED)).toBe(
      'Иванов - NUL',
    );
    expect(proposedFileName(description([], 'PRN'), UNTITLED, 'fb2')).toBe('PRN_.fb2');
  });

  it('cuts the stem at a code-point boundary to 120 code points and 200 UTF-8 bytes', () => {
    const cyrillic = 'ж'.repeat(121);
    const cutCyrillic = proposedStem(description([], cyrillic), UNTITLED);
    expect([...cutCyrillic].length).toBe(100);
    expect(utf8Bytes(cutCyrillic)).toBe(200);

    const cjk = '書'.repeat(100);
    const cutCjk = proposedStem(description([], cjk), UNTITLED);
    expect([...cutCjk].length).toBe(66);
    expect(utf8Bytes(cutCjk)).toBe(198);

    const emoji = '😀'.repeat(60);
    const cutEmoji = proposedStem(description([], emoji), UNTITLED);
    expect([...cutEmoji].length).toBe(50);
    expect(utf8Bytes(cutEmoji)).toBe(200);
    expect(cutEmoji.length).toBe(100); // 50 surrogate pairs, never a lone surrogate
    expect(/[\uD800-\uDBFF]$/.test(cutEmoji)).toBe(false);

    const ascii = 'a'.repeat(130);
    const cutAscii = proposedStem(description([], ascii), UNTITLED);
    expect(cutAscii.length).toBe(120);
    expect(cutAscii).toBe('a'.repeat(MAX_STEM_CODE_POINTS));
    expect(MAX_STEM_UTF8_BYTES).toBe(200);
    expect(cutStem('x'.repeat(5))).toBe('xxxxx');
  });

  it('trims a cut that ends on a space or a dot, and guards the device name after the cut', () => {
    // 119 letters, a space, then more: the cut lands right after the space.
    const spaced = `${'a'.repeat(119)} ${'b'.repeat(20)}`;
    expect(proposedStem(description([], spaced), UNTITLED)).toBe('a'.repeat(119));
    const dotted = `${'a'.repeat(118)}. ${'b'.repeat(20)}`;
    expect(proposedStem(description([], dotted), UNTITLED)).toBe('a'.repeat(118));
    // The author and the title together exceed the limit: the title is cut, the author whole.
    const long = proposedStem(description([tolstoy], 'Х'.repeat(200)), UNTITLED);
    expect(long.startsWith('Толстой Лев - ')).toBe(true);
    expect(utf8Bytes(long)).toBeLessThanOrEqual(200);
    expect([...long].length).toBeLessThanOrEqual(120);
    // "CON" followed by 200 letters after a dot: the cut shortens it, the guard still applies.
    expect(proposedStem(description([], `CON.${'x'.repeat(200)}`), UNTITLED)).toBe(
      `CON_.${'x'.repeat(116)}`,
    );
  });

  it('never proposes a name with a separator or a colon (a bare name is never a path)', () => {
    for (const title of ['..\\..\\evil', 'C:x', '/etc/passwd', 'a/b', '..']) {
      const stem = proposedStem(description([], title), UNTITLED);
      expect(stem).not.toMatch(/[\\/:]/);
      expect(stem).not.toBe('..');
    }
  });
});

describe('exportStem (FR-053)', () => {
  it('strips the last extension whatever its case and keeps the rest of the name', () => {
    expect(exportStem('book.fb2')).toBe('book');
    expect(exportStem('book.FB2')).toBe('book');
    expect(exportStem('archive.tar.fb2')).toBe('archive.tar');
    expect(exportStem('noextension')).toBe('noextension');
    expect(exportStem('/home/тест/Книги/Война и мир.fb2')).toBe('Война и мир');
    expect(exportStem('C:\\Users\\Тест\\Документы\\Война и мир.FBD')).toBe('Война и мир');
    expect(exportStem('.hidden')).toBe('.hidden');
    expect(exportStem('')).toBe('');
  });
});
