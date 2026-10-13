/**
 * Word segmentation for the spell checker (T088, FR-070, edge case "accents, hyphens and
 * non-breaking spaces must not create false positives").
 *
 * `Intl.Segmenter` (word granularity, language-neutral) does the Unicode segmentation when
 * available, a regular-expression fallback otherwise. On top of it:
 *  - word parts joined by a single hyphen (`-`, U+2010, U+2011) are one word (`кто-то`,
 *    `e-mail`), the apostrophes `'` / `’` stay inside words (`don't`) - the original's
 *    `CSplitter(L"'’\u0301")` did not split on them either;
 *  - the non-breaking space (U+00A0) and the other Unicode spaces separate words;
 *  - tokens without a letter (numbers, punctuation) and tokens with digits are skipped;
 *  - URLs and e-mail addresses are masked before segmentation;
 *  - the `check` form sent to the dictionaries is NFC-normalised, without soft hyphens (U+00AD)
 *    and combining stress marks (U+0300-U+036F, the original stripped U+0301), with the
 *    typographic apostrophe folded to `'` (the dictionaries only know the ASCII one).
 */

export interface WordToken {
  /** Offset of the first character in the text. */
  from: number;
  /** Offset after the last character. */
  to: number;
  /** The word as written. */
  text: string;
  /** Normalised form for the dictionary lookup. */
  check: string;
}

const LETTER = /\p{L}/u;
const DIGIT = /\p{Nd}/u;
const HYPHENS = new Set(['-', '\u2010', '\u2011']);
const APOSTROPHES = /[\u2019\u02BC\u2018`]/g;
const LEADING_EDGE = /^[\u0027\u2019\u02BC\u2018`\u00AD]+/;
const TRAILING_EDGE = /[\u0027\u2019\u02BC\u2018`\u00AD]+$/;
/** http(s)/ftp URLs, `www.` hosts and e-mail addresses. */
const URL_OR_EMAIL =
  /(?:https?|ftp):\/\/[^\s<>"«»]+|\bwww\.[^\s<>"«»]+|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu;
/** Fallback segmentation: letters/marks/digits with inner apostrophes and soft hyphens. */
const FALLBACK_WORD =
  /[\p{L}\p{M}\p{Nd}](?:[\p{L}\p{M}\p{Nd}\u00AD\u0027\u2019\u02BC\u2018`]*[\p{L}\p{M}\p{Nd}])?/gu;

interface Segment {
  from: number;
  to: number;
  text: string;
}

type Segmenter = {
  segment(input: string): Iterable<{ segment: string; index: number; isWordLike?: boolean }>;
};

let segmenter: Segmenter | null | undefined;

function getSegmenter(): Segmenter | null {
  if (segmenter !== undefined) return segmenter;
  try {
    const ctor = (
      Intl as unknown as {
        Segmenter?: new (locale: string, options: { granularity: string }) => Segmenter;
      }
    ).Segmenter;
    segmenter = ctor ? new ctor('und', { granularity: 'word' }) : null;
  } catch {
    segmenter = null;
  }
  return segmenter;
}

/** Replaces URLs and e-mail addresses by spaces of the same length (offsets stay valid). */
export function maskUrls(text: string): string {
  return text.replace(URL_OR_EMAIL, (match) => ' '.repeat(match.length));
}

/**
 * Every Unicode space separator (NBSP, narrow NBSP, em/en spaces...) becomes a plain space:
 * `Intl.Segmenter` keeps some of them (U+202F) inside words.
 */
export function normalizeSpaces(text: string): string {
  return text.replace(/[\p{Zs}\u200B\u2060]/gu, ' ');
}

function rawSegments(text: string): Segment[] {
  const seg = getSegmenter();
  const out: Segment[] = [];
  if (seg) {
    for (const part of seg.segment(text)) {
      if (part.isWordLike === false) continue;
      if (!LETTER.test(part.segment) && !DIGIT.test(part.segment)) continue;
      out.push({ from: part.index, to: part.index + part.segment.length, text: part.segment });
    }
    return out;
  }
  for (const match of text.matchAll(FALLBACK_WORD)) {
    out.push({ from: match.index, to: match.index + match[0].length, text: match[0] });
  }
  return out;
}

/** Joins `a-b` parts: a single hyphen between two word segments makes one word. */
function joinHyphenated(text: string, segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const segment of segments) {
    const previous = out[out.length - 1];
    if (
      previous &&
      segment.from === previous.to + 1 &&
      HYPHENS.has(text[previous.to]!) &&
      LETTER.test(previous.text) &&
      LETTER.test(segment.text)
    ) {
      out[out.length - 1] = {
        from: previous.from,
        to: segment.to,
        text: text.slice(previous.from, segment.to),
      };
    } else {
      out.push(segment);
    }
  }
  return out;
}

/** Dictionary form of a word (see the module comment). */
export function checkForm(word: string): string {
  return word
    .normalize('NFC')
    .replace(/\u00AD/g, '')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(APOSTROPHES, "'");
}

/** The words of `text` worth checking, in order. */
export function tokenizeWords(text: string): WordToken[] {
  if (!text) return [];
  const masked = maskUrls(normalizeSpaces(text));
  const segments = joinHyphenated(masked, rawSegments(masked));
  const tokens: WordToken[] = [];
  for (const segment of segments) {
    // Trim apostrophes / soft hyphens at the edges ('tis -> tis, «word» quotes already split).
    const from = segment.from + (LEADING_EDGE.exec(segment.text)?.[0].length ?? 0);
    const to = segment.to - (TRAILING_EDGE.exec(segment.text)?.[0].length ?? 0);
    if (to <= from) continue;
    const word = text.slice(from, to);
    if (!LETTER.test(word) || DIGIT.test(word)) continue;
    if (word.includes('.')) continue; // host names and abbreviations like "т.е."
    const check = checkForm(word);
    if (!check || !LETTER.test(check)) continue;
    tokens.push({ from, to, text: word, check });
  }
  return tokens;
}

/** The token containing (or ending at) `offset`, if any. */
export function tokenAt(tokens: readonly WordToken[], offset: number): WordToken | null {
  for (const token of tokens) {
    if (offset >= token.from && offset <= token.to) return token;
    if (token.from > offset) break;
  }
  return null;
}
