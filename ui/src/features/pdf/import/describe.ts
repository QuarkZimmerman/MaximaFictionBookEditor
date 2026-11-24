/**
 * Feature 016 (D13; tasks T042): the description of a PDF not made by the editor - its title, authors, subject
 * and keywords from the document information; what FB2 requires and the PDF lacks comes from the template; the
 * language from the PDF, else guessed, else the template's.
 */

import type { PdfImportOcrSummary } from '@/rpc/types';

import { text } from './fb2';

export interface ResolveImportLanguageInput {
  /** Explicit PDF catalog /Lang metadata, if present (e.g. "en", "ru-RU"). */
  pdfLang?: string;
  /** OCR summary returned by pdfImport.read, if OCR ran. */
  ocrSummary?: PdfImportOcrSummary;
  /** Total pages in the PDF document. */
  totalPages: number;
  /** Spelling-dictionary fallback language guess, if any. */
  guessedLang: string | null;
}

function normalizeIsoLang(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  const match = /^([a-z]{2,3})(?:[-_].*)?$/.exec(trimmed);
  return match ? match[1] : null;
}

/**
 * Feature 020 (contracts/page-model.md §2): determines FB2 `<title-info><lang>` precedence
 * (below a user-accepted `.fbd`, which is applied afterward). When OCR recognized the majority of
 * pages, its detected primary language overrides contradictory scanner `/Lang` metadata.
 */
export function resolveImportLanguage({
  pdfLang,
  ocrSummary,
  totalPages,
  guessedLang,
}: ResolveImportLanguageInput): string | null {
  const normPdf = normalizeIsoLang(pdfLang);
  const normOcr = ocrSummary?.used ? normalizeIsoLang(ocrSummary.primaryLang) : null;
  const ocrPages = ocrSummary?.pagesRecognized ?? 0;
  const ocrMajority = !!normOcr && ocrPages > 0 && ocrPages * 2 >= Math.max(1, totalPages);
  if (ocrMajority) return normOcr;
  if (normPdf) return normPdf;
  if (normOcr) return normOcr;
  return guessedLang;
}

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
  coverId: string | null = null,
): string {
  const description =
    /<description[\s\S]*?<\/description>/.exec(templateXml)?.[0] ?? '<description/>';
  const templateInfo = /<title-info>[\s\S]*?<\/title-info>/.exec(description)?.[0] ?? '';
  const genre =
    /<genre\b[^>]*\/>|<genre\b[^>]*>[\s\S]*?<\/genre>/.exec(templateInfo)?.[0] ?? '<genre/>';
  const templateAuthor =
    /<author>[\s\S]*?<\/author>/.exec(templateInfo)?.[0] ?? '<author><last-name/></author>';
  const templateLang = /<lang>([\s\S]*?)<\/lang>/.exec(templateInfo)?.[1] ?? 'en';
  const title = info?.Title?.trim() || fileStem;
  const authors = (info?.Author ?? '')
    .split(/;|\s&\s|\sand\s/)
    .map((a) => a.trim())
    .filter(Boolean)
    .map((author) => {
      const { first, middle, last } = splitName(author);
      return `<author>${first ? `<first-name>${text(first)}</first-name>` : ''}${middle ? `<middle-name>${text(middle)}</middle-name>` : ''}<last-name>${text(last)}</last-name></author>`;
    })
    .join('');
  const titleInfo =
    `<title-info>${genre}${authors || templateAuthor}<book-title>${text(title)}</book-title>` +
    (info?.Subject?.trim() ? `<annotation><p>${text(info.Subject.trim())}</p></annotation>` : '') +
    (info?.Keywords?.trim() ? `<keywords>${text(info.Keywords.trim())}</keywords>` : '') +
    (coverId ? `<coverpage><image l:href="#${text(coverId)}"/></coverpage>` : '') +
    `<lang>${text(language ?? templateLang)}</lang></title-info>`;
  return templateInfo ? description.replace(templateInfo, titleInfo) : description;
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
