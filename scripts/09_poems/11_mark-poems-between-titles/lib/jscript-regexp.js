// Regular expressions with the meaning they had in FictionBook Editor 2.7.9 (byte-identical copies in
// the packages that use it).
//
// The originals ran in JScript 5.8, the engine of the editor's page (the WebBrowser control's IE7
// document mode). Two of its classes differ from ECMAScript:
//   \s is [\t\n\v\f\r ] there: no U+00A0, no U+2000-U+200A, U+2028, U+2029, U+202F, U+205F, U+3000,
//      U+1680 or U+FEFF, which ECMAScript's \s matches (\S is its complement);
//   .  is [^\n] there: it also matches \r, U+2028 and U+2029, which ECMAScript's . does not.
// jscriptRegExp() compiles a pattern with those meanings, so the originals' expressions are kept as
// written and match what they matched in 2.7.9. Everything else they use (\d, \w, \b, classes and
// ranges, greedy and lazy quantifiers, lookahead, back-references, the i and g flags) means the same
// in both engines.

const SPACE = '\\t\\n\\v\\f\\r ';

/** The pattern with \s, \S and . written out as JScript understood them. */
export function jscriptSource(source) {
  let out = '';
  let inClass = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\' && i + 1 < source.length) {
      const next = source[i + 1];
      i += 1;
      if (next === 's') out += inClass ? SPACE : `[${SPACE}]`;
      else if (next === 'S') {
        if (inClass) throw new Error(`jscriptRegExp: \\S inside a character class: ${source}`);
        out += `[^${SPACE}]`;
      } else out += ch + next;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      out += ch;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      out += ch;
      continue;
    }
    out += ch === '.' ? '[^\\n]' : ch;
  }
  return out;
}

/** new RegExp(source, flags) with JScript's \s, \S and . (see above). */
export function jscriptRegExp(source, flags) {
  return new RegExp(jscriptSource(source), flags);
}
