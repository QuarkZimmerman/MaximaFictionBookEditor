/**
 * Replacement string expansion for regular-expression replaces, compatible with the original
 * editor (`GetReplStr` in FBEview.cpp): `$0` / `\0` the whole match, `$1`-`$9` / `\1`-`\9`
 * capture groups, `$+` the last group, `$U` / `$L` / `$T` upper / lower / title case for the
 * following text, `$S` / `$E` strong / emphasis for the following text, `$Q` resets the flags.
 * Plain (non-regex) replacements are literal.
 */

export interface StyledRange {
  start: number;
  length: number;
  strong: boolean;
  emphasis: boolean;
}

export interface Expanded {
  text: string;
  ranges: StyledRange[];
}

interface Flags {
  upper: boolean;
  lower: boolean;
  title: boolean;
  strong: boolean;
  emphasis: boolean;
}

const NO_FLAGS: Flags = {
  upper: false,
  lower: false,
  title: false,
  strong: false,
  emphasis: false,
};

function applyCase(text: string, flags: Flags): string {
  if (flags.upper) return text.toUpperCase();
  if (flags.lower) return text.toLowerCase();
  if (flags.title && text.length > 0) return text[0]!.toUpperCase() + text.slice(1).toLowerCase();
  return text;
}

/** Expands `pattern` for a regex match (`match[0]` whole match, `match[1..]` groups). */
export function expandReplacement(pattern: string, match: RegExpExecArray | string[]): Expanded {
  let text = '';
  const ranges: StyledRange[] = [];
  let flags: Flags = { ...NO_FLAGS };
  let runStart = 0;
  let runFlags: Flags = { ...NO_FLAGS };

  const closeRun = () => {
    if ((runFlags.strong || runFlags.emphasis) && text.length > runStart) {
      ranges.push({
        start: runStart,
        length: text.length - runStart,
        strong: runFlags.strong,
        emphasis: runFlags.emphasis,
      });
    }
    runStart = text.length;
    runFlags = { ...flags };
  };

  const append = (chunk: string) => {
    if (!chunk) return;
    if (runFlags.strong !== flags.strong || runFlags.emphasis !== flags.emphasis) closeRun();
    text += applyCase(chunk, flags);
    // Title case applies to the first character of a run only.
    if (flags.title) flags = { ...flags, title: false, lower: true };
  };

  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]!;
    if ((ch === '$' || ch === '\\') && i < pattern.length - 1) {
      const next = pattern[i + 1]!;
      i += 1;
      switch (next) {
        case '0':
          append(match[0] ?? '');
          continue;
        case '+':
          append(match.length > 1 ? (match[match.length - 1] ?? '') : '');
          continue;
        case 'T':
          flags = { ...flags, title: true, upper: false, lower: false };
          continue;
        case 'U':
          flags = { ...flags, upper: true, lower: false, title: false };
          continue;
        case 'L':
          flags = { ...flags, lower: true, upper: false, title: false };
          continue;
        case 'S':
          flags = { ...flags, strong: true };
          continue;
        case 'E':
          flags = { ...flags, emphasis: true };
          continue;
        case 'Q':
          flags = { ...NO_FLAGS };
          continue;
        default:
          if (next >= '1' && next <= '9') {
            append(match[Number(next)] ?? '');
            continue;
          }
          // Unknown escape: the original ignored it.
          continue;
      }
    }
    append(ch);
  }
  closeRun();
  return { text, ranges };
}

/** Builds the RegExp of a search (null when the expression is invalid). */
export function buildSearchRegExp(options: {
  query: string;
  wholeWord: boolean;
  matchCase: boolean;
  regex: boolean;
}): RegExp | null {
  if (!options.query) return null;
  let source = options.regex ? options.query : escapeRegExp(options.query);
  if (options.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  const flags = `gu${options.matchCase ? '' : 'i'}`;
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** All matches of `re` in `text` (non-empty matches only; `re` must have the `g` flag). */
export function allMatches(re: RegExp, text: string): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  re.lastIndex = 0;
  for (;;) {
    const match = re.exec(text);
    if (!match) break;
    if (match[0].length === 0) {
      re.lastIndex += 1;
      if (re.lastIndex > text.length) break;
      continue;
    }
    out.push(match);
  }
  return out;
}
