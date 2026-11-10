/**
 * Feature 011 (US3; D7, D8; FR-020-FR-022; research DP-8): the usual regular-expression syntax's
 * escapes in the browser engine's Unicode mode. Both searches compile with the `u` flag (the
 * Body view and the fields through `buildSearchRegExp`, the Source view through CodeMirror's
 * `RegExpCursor`), and Unicode mode refuses an escaped character that is not a syntax character
 * - `\—`, `\«`, `\,`, `\:`, `\-` outside a class - and a lone `{`, `}` or `]` (MDN, "Character
 * escape": such identity escapes are "forbidden in Unicode-aware mode"). The translation keeps
 * what every such escape means in the usual syntax - the character itself - and leaves the
 * escapes with letters and digits (`\s`, `\d`, `\w`, `\b`, `\p{…}`, back references) alone, so an
 * expression valid before finds what it found before (guard G11).
 */

/** The characters Unicode mode lets a backslash escape everywhere (ECMAScript SyntaxCharacter, /). */
const SYNTAX = new Set([
  '^',
  '$',
  '\\',
  '.',
  '*',
  '+',
  '?',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  '|',
  '/',
]);

const QUANTIFIER = /^\{\d+(?:,\d*)?\}/;

/** `pattern` with the usual syntax's escapes written as Unicode mode accepts them. */
export function regexCompat(pattern: string): string {
  const chars = Array.from(pattern);
  let out = '';
  let inClass = false;
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i]!;
    if (ch === '\\') {
      const next = chars[i + 1];
      if (next === undefined) {
        out += ch; // a trailing backslash stays: the engine reports it
        continue;
      }
      i += 1;
      if (/^[A-Za-z0-9]$/.test(next) || SYNTAX.has(next) || (next === '-' && inClass)) {
        out += `\\${next}`;
        // `\p{Lu}`, `\P{…}`, `\u{…}`: the braces belong to the escape.
        if ((next === 'p' || next === 'P' || next === 'u') && chars[i + 1] === '{') {
          const close = chars.indexOf('}', i + 2);
          if (close > 0) {
            out += chars.slice(i + 1, close + 1).join('');
            i = close;
          }
        }
      } else {
        // An escaped character that is no syntax character means the character itself.
        out += next;
      }
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
      // A `]` right after `[` or `[^` is a literal in the usual syntax when a later `]` closes
      // the class (`[]a]`); `[]` alone stays the engine's empty class.
      if (chars[i + 1] === '^') {
        out += '^';
        i += 1;
      }
      if (chars[i + 1] === ']' && chars.indexOf(']', i + 2) > 0) {
        out += '\\]';
        i += 1;
      }
      continue;
    }
    if (ch === '{') {
      const rest = chars.slice(i).join('');
      const quantifier = QUANTIFIER.exec(rest);
      if (quantifier && out.length > 0) {
        out += quantifier[0];
        i += Array.from(quantifier[0]).length - 1;
      } else {
        out += '\\{';
      }
      continue;
    }
    if (ch === '}' || ch === ']') {
      out += `\\${ch}`;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * The reason an expression is not valid after the translation (the engine's own words), or null
 * when it compiles (FR-022).
 */
export function regexError(pattern: string, flags = 'gu'): string | null {
  try {
    new RegExp(regexCompat(pattern), flags);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // "Invalid regular expression: /(abc/gu: Unterminated group" -> "Unterminated group".
    const reason = /:\s*([^:]+)$/.exec(message)?.[1]?.trim();
    return reason || message;
  }
}
