/**
 * Feature 018 (T030, contracts/mobi-import.md §3): EXTH metadata -> FB2 description mapping
 * (authors, translators, FBD Maker custom-info roles, genre matching, annotation, publisher, ISBN).
 */
import type { MarkdownDescription, MarkdownPerson } from '@/features/markdown/convert';
import type { GenreEntry } from '@/rpc/types';

import { writeFbdMakerName, type FbdMakerLabel } from '../../ebookShared/fbdMaker';

export interface MobiReadMetadata {
  title: string;
  updatedTitle?: string;
  authors: string[];
  contributors: string[];
  publisher?: string;
  description?: string;
  isbn?: string;
  subjects: string[];
  date?: string;
  language: string;
  identifier: string;
  rights?: string;
}

export interface MobiImportSummaryItem {
  kind:
    | 'fellBackToMobi7'
    | 'externallyModified'
    | 'listedData'
    | 'pictureConverted'
    | 'pictureTooLarge'
    | 'pictureLeftOut'
    | 'drawingLeftOut'
    | 'formulaAsText'
    | 'cssDropped'
    | 'fbdApplied'
    | 'fbdUnreadable';
  detail: string;
}

/** Splits "Last, First Middle", "First Middle Last", or single-word nickname (matching EPUB). */
export function splitPersonName(raw: string): MarkdownPerson {
  const cleaned = raw.trim();
  if (!cleaned) return {};
  if (cleaned.includes(',')) {
    const [last = '', rest = ''] = cleaned.split(',', 2).map((p) => p.trim());
    const [first = '', ...middle] = rest.split(/\s+/).filter(Boolean);
    return {
      lastName: last || undefined,
      firstName: first || undefined,
      middleName: middle.join(' ') || undefined,
    };
  }
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 1) return { nickname: words[0] };
  return {
    firstName: words[0],
    middleName: words.slice(1, -1).join(' ') || undefined,
    lastName: words[words.length - 1],
  };
}

function annotationParagraphs(html: string | undefined): string[] {
  if (!html) return [];
  const text = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, '\u00a0')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
}

const ROLE_PATTERNS: readonly { pattern: RegExp; kind: 'translator' | FbdMakerLabel }[] = [
  { pattern: /^(?:translator|trl|переводчик|перекладач)\s*[:—-]\s*(.+)$/i, kind: 'translator' },
  { pattern: /^(.+?)\s*\((?:translator|trl)\)$/i, kind: 'translator' },
  { pattern: /^(?:illustrator|ill|иллюстратор|ілюстратор)\s*[:—-]\s*(.+)$/i, kind: 'mlillustrator' },
  { pattern: /^(.+?)\s*\((?:illustrator|ill)\)$/i, kind: 'mlillustrator' },
  { pattern: /^(?:editor|edt|редактор)\s*[:—-]\s*(.+)$/i, kind: 'mleditor' },
  { pattern: /^(.+?)\s*\((?:editor|edt)\)$/i, kind: 'mleditor' },
  { pattern: /^(?:compiler|com|составитель|упорядник)\s*[:—-]\s*(.+)$/i, kind: 'mlcompiler' },
  { pattern: /^(.+?)\s*\((?:compiler|com)\)$/i, kind: 'mlcompiler' },
  { pattern: /^(?:designer|book designer|cover designer|dsr|bkd|cov|оформитель|дизайнер)\s*[:—-]\s*(.+)$/i, kind: 'mldesigner' },
  { pattern: /^(.+?)\s*\((?:designer|dsr|bkd|cov)\)$/i, kind: 'mldesigner' },
  { pattern: /^(?:commentator|cmm|комментатор|коментатор)\s*[:—-]\s*(.+)$/i, kind: 'mlcommentator' },
  { pattern: /^(.+?)\s*\((?:commentator|cmm)\)$/i, kind: 'mlcommentator' },
];

export interface ForeignDescriptionResult {
  description: MarkdownDescription;
  summary: MobiImportSummaryItem[];
}

export function buildForeignDescription(
  meta: MobiReadMetadata,
  genres: readonly GenreEntry[] | undefined,
  fallbackTitle: string,
): ForeignDescriptionResult {
  const summary: MobiImportSummaryItem[] = [];
  const authors: MarkdownPerson[] = meta.authors
    .map((raw) => splitPersonName(raw))
    .filter((p) => Boolean(p.firstName || p.lastName || p.nickname));
  const translators: MarkdownPerson[] = [];
  const custom: { type: string; text: string }[] = [];

  for (const rawContrib of meta.contributors) {
    const trimmed = rawContrib.trim();
    if (!trimmed) continue;
    let matched = false;
    for (const rule of ROLE_PATTERNS) {
      const m = rule.pattern.exec(trimmed);
      if (!m) continue;
      const person = splitPersonName(m[1]!.trim());
      if (rule.kind === 'translator') {
        translators.push(person);
      } else {
        custom.push({
          type: rule.kind,
          text: writeFbdMakerName({
            last: person.lastName ?? person.nickname ?? '',
            first: person.firstName ?? '',
            middle: person.middleName ?? '',
          }),
        });
      }
      matched = true;
      break;
    }
    if (!matched) {
      summary.push({ kind: 'listedData', detail: `contributor: ${trimmed}` });
    }
  }

  if (meta.rights?.trim()) {
    custom.push({ type: 'rights', text: meta.rights.trim() });
  }

  // Case-insensitive genre matching against editor genre codes and en/ru/uk names.
  const genreByName = new Map<string, string>();
  for (const entry of genres ?? []) {
    genreByName.set(entry.code.toLowerCase(), entry.code);
    for (const lang of ['en', 'ru', 'uk']) {
      const label = entry.names[lang];
      if (label) genreByName.set(label.toLowerCase(), entry.code);
    }
  }

  const genreCodes: string[] = [];
  const keywords: string[] = [];
  for (const subject of meta.subjects) {
    const trimmed = subject.trim();
    if (!trimmed) continue;
    const code = genreByName.get(trimmed.toLowerCase());
    if (code) {
      if (!genreCodes.includes(code)) genreCodes.push(code);
    } else if (!keywords.includes(trimmed)) {
      keywords.push(trimmed);
    }
  }

  const language = meta.language.trim().split(/[-_]/)[0]?.toLowerCase() ?? '';
  const date = /^\d{4}(-\d{2}(-\d{2})?)?/.exec(meta.date?.trim() ?? '')?.[0];
  const isbnClean = meta.isbn?.replace(/^urn:isbn:/i, '').trim() || undefined;
  const publisher = meta.publisher?.trim() || undefined;

  const title = (meta.updatedTitle || meta.title || fallbackTitle).trim() || fallbackTitle;

  const description: MarkdownDescription = {
    title,
    authors,
    date,
    lang: /^[a-z]{2,3}$/.test(language) && language !== 'und' ? language : undefined,
    annotation: annotationParagraphs(meta.description),
    keywords: keywords.length > 0 ? keywords.join(', ') : undefined,
    genres: genreCodes.length > 0 ? genreCodes : ['unrecognised'],
    sequences: [],
    translators,
    publish: publisher || isbnClean ? { publisher, isbn: isbnClean, sequences: [] } : undefined,
    custom,
  };

  return { description, summary };
}
