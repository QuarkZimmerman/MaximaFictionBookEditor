/**
 * Feature 016 (D13; tasks T042): the description of a PDF not made by the editor - its title, authors, subject
 * and keywords from the document information; what FB2 requires and the PDF lacks comes from the template; the
 * language from the PDF, else guessed, else the template's.
 */

import { text } from './fb2';

/** "First Middle Last" as FB2's name parts; "Last, First" too. */
export function splitName(name: string): { first: string; middle: string; last: string } {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean.includes(',')) {
    const [last, rest] = clean.split(',', 2).map((s) => s.trim());
    const [first = '', ...middle] = (rest ?? '').split(' ');
    return { first, middle: middle.join(' '), last };
  }
  const words = clean.split(' ');
  if (words.length === 1) return { first: '', middle: '', last: words[0] };
  return { first: words[0], middle: words.slice(1, -1).join(' '), last: words[words.length - 1] };
}

export function metadataDescription(
  info: Record<string, string> | undefined,
  templateXml: string,
  fileStem: string,
  language: string | null,
): string {
  let description =
    /<description[\s\S]*?<\/description>/.exec(templateXml)?.[0] ?? '<description/>';
  const title = info?.Title?.trim() || fileStem;
  description = description.replace(
    /<book-title>[\s\S]*?<\/book-title>/,
    `<book-title>${text(title)}</book-title>`,
  );
  const authors = (info?.Author ?? '')
    .split(/;|\s&\s|\sand\s/)
    .map((a) => a.trim())
    .filter(Boolean);
  if (authors.length) {
    const xml = authors
      .map((author) => {
        const { first, middle, last } = splitName(author);
        return `<author>${first ? `<first-name>${text(first)}</first-name>` : ''}${middle ? `<middle-name>${text(middle)}</middle-name>` : ''}<last-name>${text(last)}</last-name></author>`;
      })
      .join('');
    // The title-info's authors are the PDF's; the template's stay in document-info.
    description = description.replace(
      /(<title-info>[\s\S]*?)(<author>[\s\S]*?<\/author>\s*)+/,
      `$1${xml}`,
    );
  }
  const extra = [
    info?.Subject?.trim() ? `<annotation><p>${text(info.Subject.trim())}</p></annotation>` : '',
    info?.Keywords?.trim() ? `<keywords>${text(info.Keywords.trim())}</keywords>` : '',
  ].join('');
  if (extra) description = description.replace(/<\/book-title>/, `</book-title>${extra}`);
  if (language)
    description = description.replace(/<lang>[\s\S]*?<\/lang>/, `<lang>${text(language)}</lang>`);
  return description;
}

/** The language whose dictionary knows most of `words` (at least half), else null (DP-14). */
export async function guessLanguage(
  words: readonly string[],
  misspelled: (words: string[], lang: string) => Promise<string[]>,
): Promise<string | null> {
  const sample = [...new Set(words.filter((w) => /^\p{L}{3,}$/u.test(w)))].slice(0, 2000);
  if (sample.length < 20) return null;
  let best: { lang: string; share: number } | null = null;
  for (const lang of ['en', 'ru', 'uk']) {
    const wrong = await misspelled(sample, lang).catch(() => sample);
    const share = 1 - wrong.length / sample.length;
    if (share >= 0.5 && (!best || share > best.share)) best = { lang, share };
  }
  return best?.lang ?? null;
}
