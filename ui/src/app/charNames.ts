/**
 * What the character pane says about a character (feature 009, User Story 5; FR-053, SC-010,
 * data-model §8): spaces, invisible characters, hyphens and dashes by name; a letter by its
 * script (Latin, Cyrillic, Greek, Hebrew, Arabic, ...), found with Unicode property escapes;
 * a combining mark as such. The names are i18n keys under `status.char`.
 */

const NAMED: Readonly<Record<number, string>> = {
  0x0009: 'tab',
  0x0020: 'space',
  0x00a0: 'nbsp',
  0x202f: 'narrowNbsp',
  0x00ad: 'softHyphen',
  0x200b: 'zwsp',
  0x200c: 'zwnj',
  0x200d: 'zwj',
  0x2060: 'wordJoiner',
  0xfeff: 'bom',
  0x2002: 'enSpace',
  0x2003: 'emSpace',
  0x2007: 'figureSpace',
  0x2009: 'thinSpace',
  0x200a: 'hairSpace',
  0x2010: 'hyphen',
  0x2011: 'nbHyphen',
  0x2012: 'figureDash',
  0x2013: 'enDash',
  0x2014: 'emDash',
  0x2212: 'minus',
  0x002d: 'hyphenMinus',
};

/** The scripts the pane names, in the order they are tried. */
const SCRIPTS: readonly (readonly [string, RegExp])[] = [
  ['latin', /\p{Script=Latin}/u],
  ['cyrillic', /\p{Script=Cyrillic}/u],
  ['greek', /\p{Script=Greek}/u],
  ['hebrew', /\p{Script=Hebrew}/u],
  ['arabic', /\p{Script=Arabic}/u],
  ['armenian', /\p{Script=Armenian}/u],
  ['georgian', /\p{Script=Georgian}/u],
  ['devanagari', /\p{Script=Devanagari}/u],
  ['thai', /\p{Script=Thai}/u],
  ['han', /\p{Script=Han}/u],
  ['hiragana', /\p{Script=Hiragana}/u],
  ['katakana', /\p{Script=Katakana}/u],
  ['hangul', /\p{Script=Hangul}/u],
];

/** `U+00A0`: at least four hex digits, more beyond the basic plane. */
export function codePointLabel(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** `&#160;`: the decimal character reference. */
export function characterReference(cp: number): string {
  return `&#${cp};`;
}

/**
 * The i18n key describing `cp`: `status.char.<name>` for a named character,
 * `status.char.combining` for a combining mark, `status.char.script.<script>` for a letter of a
 * known script; null otherwise (digits, punctuation, symbols).
 */
export function characterKey(cp: number): string | null {
  const name = NAMED[cp];
  if (name) return `status.char.${name}`;
  const char = String.fromCodePoint(cp);
  if (/\p{M}/u.test(char)) return 'status.char.combining';
  if (!/\p{L}/u.test(char)) return null;
  for (const [script, pattern] of SCRIPTS) {
    if (pattern.test(char)) return `status.char.script.${script}`;
  }
  return null;
}
