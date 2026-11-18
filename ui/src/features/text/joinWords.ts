/**
 * Words broken at a line's end (feature 016 D12; feature 017 clarify, DP-13), shared by the PDF and
 * TXT imports: a soft hyphen always joins the word; a plain hyphen after a letter joins it when the
 * shipped spelling dictionaries (English, Russian, Ukrainian) know the joined word ("pro-" and
 * "gram" give "program"), otherwise the hyphen stays and the parts join without a space ("north-"
 * and "east" give "north-east"); any other line end joins the next line with a space.
 */

/** How a line's end and the next line's start join inside a paragraph. */
export type LineJoin = 'drop-hyphen' | 'keep-hyphen' | 'space';

const HARD = /\p{L}-$/u;

/** The joined word a plain hyphen at `end` and the start of the next line would give, letters only. */
export function brokenWordCandidate(end: string, nextStart: string): string | null {
  const trimmed = end.replace(/\s+$/, '');
  if (!HARD.test(trimmed)) return null;
  const tail = trimmed.split(/\s+/).pop() ?? '';
  const head = nextStart.trim().split(/\s+/)[0] ?? '';
  const word = `${tail.slice(0, -1)}${head}`.replace(/[^\p{L}]/gu, '');
  return word || null;
}

/** The join of a line ending with `end` and the next one starting with `nextStart`. */
export function lineJoin(
  end: string,
  nextStart: string,
  known?: (word: string) => boolean,
): LineJoin {
  const trimmed = end.replace(/\s+$/, '');
  if (trimmed.endsWith('\u00ad')) return 'drop-hyphen';
  const candidate = brokenWordCandidate(trimmed, nextStart);
  if (candidate === null) return 'space';
  return known?.(candidate) ? 'drop-hyphen' : 'keep-hyphen';
}

/** The two lines joined as `lineJoin` decides. */
export function joinLines(
  end: string,
  nextStart: string,
  known?: (word: string) => boolean,
): string {
  const join = lineJoin(end, nextStart, known);
  const trimmedEnd = end.replace(/\s+$/, '');
  const trimmedStart = nextStart.replace(/^\s+/, '');
  if (join === 'drop-hyphen') return `${trimmedEnd.replace(/[\u00ad-]$/, '')}${trimmedStart}`;
  if (join === 'keep-hyphen') return `${trimmedEnd}${trimmedStart}`;
  return `${trimmedEnd} ${trimmedStart}`;
}

/** Asks a dictionary which of `words` it does not know; `code` is `en`, `ru` or `uk`. */
export type MisspelledAsker = (words: string[], code: string) => Promise<string[]>;

/** The languages whose dictionaries the editor ships, in the order they are asked. */
export const JOIN_LANGUAGES = ['en', 'ru', 'uk'] as const;

/** Candidates are asked about in batches the core takes; the caller's progress moves after each. */
export const JOIN_BATCH = 250;

/**
 * The candidates any of the shipped dictionaries knows. `onBatch` runs after each batch (asked so
 * far, all batches); `check` may throw to cancel. A dictionary that fails knows nothing.
 */
export async function knownWords(
  candidates: Iterable<string>,
  ask: MisspelledAsker,
  onBatch?: (asked: number, batches: number) => void,
  check?: () => void,
): Promise<Set<string>> {
  const all = [...new Set(candidates)];
  const known = new Set<string>();
  const batches = JOIN_LANGUAGES.length * Math.max(1, Math.ceil(all.length / JOIN_BATCH));
  let asked = 0;
  for (const code of JOIN_LANGUAGES) {
    const list = all.filter((word) => !known.has(word));
    for (let at = 0; at < list.length; at += JOIN_BATCH) {
      check?.();
      const batch = list.slice(at, at + JOIN_BATCH);
      const wrong = new Set(await ask(batch, code).catch(() => batch));
      for (const word of batch) if (!wrong.has(word)) known.add(word);
      asked++;
      onBatch?.(Math.min(asked, batches), batches);
    }
  }
  return known;
}

/** The core's dictionaries asked through `spell.check` (the editor's shipped English, Russian, Ukrainian). */
export async function dictionaryAsker(rpc: {
  call(method: 'spell.dictionaries'): Promise<{ lang: string; tag?: string }[]>;
  call(
    method: 'spell.check',
    params: { words: string[]; langs: string[] },
  ): Promise<{ misspelled: string[] }>;
}): Promise<MisspelledAsker> {
  const dictionaries = await rpc.call('spell.dictionaries').catch(() => []);
  const dictionaryOf = (code: string): string | undefined =>
    dictionaries.find(
      (d) => d.lang.toLowerCase().startsWith(code) || (d.tag ?? '').toLowerCase().startsWith(code),
    )?.lang;
  return async (words, code) => {
    const dictionary = dictionaryOf(code);
    if (!dictionary || words.length === 0) return words;
    return (await rpc.call('spell.check', { words, langs: [dictionary] })).misspelled;
  };
}
