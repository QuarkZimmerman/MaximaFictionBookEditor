/**
 * T088 - word segmentation: Cyrillic and Latin words, hyphenated words, apostrophes, combining
 * accents / `ё`, soft hyphens, non-breaking spaces, numbers, URLs / e-mail addresses, and the
 * normalised dictionary form.
 */

import { checkForm, maskUrls, tokenAt, tokenizeWords } from '@/features/spell/tokenizer';

const words = (text: string) => tokenizeWords(text).map((t) => t.text);
const checks = (text: string) => tokenizeWords(text).map((t) => t.check);

describe('tokenizeWords', () => {
  it('splits Cyrillic and Latin text on spaces and punctuation', () => {
    expect(words('«Привет», — сказал он... (тест) [ок] Hello, world!')).toEqual([
      'Привет',
      'сказал',
      'он',
      'тест',
      'ок',
      'Hello',
      'world',
    ]);
    const [first] = tokenizeWords('  Привет мир');
    expect(first).toEqual({ from: 2, to: 8, text: 'Привет', check: 'Привет' });
  });

  it('keeps hyphenated words and apostrophes inside words', () => {
    expect(words('кто-то где\u2011нибудь e-mail')).toEqual(['кто-то', 'где\u2011нибудь', 'e-mail']);
    expect(words("don't don\u2019t rock 'n' roll 'tis")).toEqual([
      'don\u0027t',
      'don\u2019t',
      'rock',
      'n',
      'roll',
      'tis',
    ]);
    expect(checks('don\u2019t')).toEqual(["don't"]);
    // A hyphen between a word and a dash or at the edge does not join.
    expect(words('слово - другое -третье')).toEqual(['слово', 'другое', 'третье']);
  });

  it('treats non-breaking and other Unicode spaces as separators', () => {
    expect(words('вот\u00a0так\u2009и\u202fникак')).toEqual(['вот', 'так', 'и', 'никак']);
    expect(tokenizeWords('a\u00a0b')[1]).toMatchObject({ from: 2, to: 3, text: 'b' });
  });

  it('strips combining accents and soft hyphens from the dictionary form, keeps ё', () => {
    expect(words('Москва\u0301 ещё со\u00adфт')).toEqual(['Москва\u0301', 'ещё', 'со\u00adфт']);
    expect(checks('Москва\u0301 ещё со\u00adфт')).toEqual(['Москва', 'ещё', 'софт']);
    // Decomposed input is composed first (е + U+0308 is ё, not е).
    expect(checkForm('е\u0308ж')).toBe('ёж');
    expect(checkForm('за\u0301мок')).toBe('замок');
  });

  it('skips numbers, tokens with digits and dotted tokens', () => {
    expect(words('в 1812 году, глава 3а, т.е. версия v2')).toEqual([
      'в',
      'году',
      'глава',
      'версия',
    ]);
  });

  it('skips URLs and e-mail addresses but keeps the surrounding words', () => {
    const text = 'see http://example.com/a-b and www.site.org or mail user@mail.ru now';
    expect(maskUrls(text)).toHaveLength(text.length);
    expect(words(text)).toEqual(['see', 'and', 'or', 'mail', 'now']);
    const tokens = tokenizeWords(text);
    expect(text.slice(tokens[4]!.from, tokens[4]!.to)).toBe('now');
  });

  it('returns offsets usable for decorations and finds the token at a caret', () => {
    const text = 'Один два-три';
    const tokens = tokenizeWords(text);
    expect(tokens.map((t) => [t.from, t.to])).toEqual([
      [0, 4],
      [5, 12],
    ]);
    expect(tokenAt(tokens, 6)?.text).toBe('два-три');
    expect(tokenAt(tokens, 4)?.text).toBe('Один'); // end of the word counts
    expect(tokenAt(tokens, 13)).toBeNull();
    expect(tokenizeWords('')).toEqual([]);
    expect(tokenizeWords(' ... ')).toEqual([]);
  });
});
