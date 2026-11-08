// Feature 011 (US3; D7, D8; FR-020-FR-022; research DP-8): escapes of the usual syntax in the
// engine's Unicode mode.
import { describe, expect, it } from 'vitest';

import { regexCompat, regexError } from '@/features/search/regexCompat';
import { buildSearchRegExp } from '@/features/search/replacement';

const find = (pattern: string, text: string): string[] =>
  [...text.matchAll(new RegExp(regexCompat(pattern), 'gu'))].map((m) => m[0]);

describe('regexCompat', () => {
  it('an escaped character that is no syntax character means the character itself', () => {
    expect(find('\\s\\—', 'v1.0 — создание')).toEqual([' —']);
    expect(find('\\«[^\\»]+\\»', 'он сказал «да»')).toEqual(['«да»']);
    expect(find('a\\-b', 'a-b')).toEqual(['a-b']);
    expect(find('\\,\\"\\:\\_', ',":_')).toEqual([',":_']);
    expect(find('\\ж', 'жук')).toEqual(['ж']);
  });

  it('inside character classes too, with \\- kept as the literal hyphen', () => {
    expect(find('[\\—\\-]+', 'a—-b')).toEqual(['—-']);
    expect(find('[\\«\\»\\,]', '«a,b»')).toEqual(['«', ',', '»']);
    expect(find('[a\\-z]', '-')).toEqual(['-']);
  });

  it('a lone {, } or ] is a literal; quantifiers stay quantifiers', () => {
    expect(find('a{', 'a{')).toEqual(['a{']);
    expect(find('{x}', '{x}')).toEqual(['{x}']);
    expect(find('x]', 'x]')).toEqual(['x]']);
    expect(find('l{2}', 'hello')).toEqual(['ll']);
    expect(find('l{1,}', 'helllo')).toEqual(['lll']);
    expect(find('[]a]', ']a')).toEqual([']', 'a']);
  });

  it('leaves the escapes with letters and digits, and syntax-character escapes, alone', () => {
    for (const pattern of ['\\s+', '\\d\\w\\b', '\\p{Lu}\\p{Ll}+', '(\\w)\\1', '\\.\\(\\[\\{\\/']) {
      expect(regexCompat(pattern), pattern).toBe(pattern);
    }
  });

  it('an expression still invalid says why, in the engine’s words', () => {
    expect(regexError('(abc')).toMatch(/unterminated group/i);
    expect(regexError('*x')).toMatch(/nothing to repeat/i);
    expect(regexError('\\Q')).toMatch(/invalid escape/i);
    expect(regexError('\\s\\—')).toBeNull();
  });

  it('buildSearchRegExp applies it: the Body view and the fields find the escapes', () => {
    const re = buildSearchRegExp({
      query: '\\s\\—',
      regex: true,
      matchCase: false,
      wholeWord: false,
    });
    expect(re).not.toBeNull();
    expect('v1.0 — создание'.match(re!)?.[0]).toBe(' —');
  });
});
