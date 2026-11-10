/**
 * Feature 012 (US2; D28; contracts/epub-import.md §5, §6): the package's data as the FB2 description,
 * in the shape the Markdown import's `buildBook` writes into the template (010 D30). People by their
 * role: authors (role `aut` or none), translators (`trl`), and the roles the Maxima site's and FBD
 * Maker's labels keep - illustrator, editor, compiler, designer, commentator - as custom information
 * in their format; the e-book file's maker and other roles are listed only.
 */

import type { MarkdownDescription, MarkdownPerson } from '@/features/markdown/convert';
import type { GenreEntry } from '@/rpc/types';

import { LABEL_BY_ROLE, writeFbdMakerName } from '../shared/fbdMaker';
import { MARC } from '../shared/roles';
import type { ImportSummaryItem } from './convert';
import type { PackageMetadata, PackagePerson } from './package';

/** A name split by its sorting form "Last, First Middle", else by the Markdown import's rule. */
export function splitName(person: PackagePerson): MarkdownPerson {
  const sorted = person.fileAs?.trim();
  if (sorted && sorted.includes(',')) {
    const [last, rest = ''] = sorted.split(',', 2).map((part) => part.trim());
    const [first = '', ...middle] = rest.split(/\s+/).filter(Boolean);
    return {
      lastName: last || undefined,
      firstName: first || undefined,
      middleName: middle.join(' ') || undefined,
    };
  }
  const words = person.name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return {};
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
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph.length > 0);
}

export interface DescribeResult {
  description: MarkdownDescription;
  summary: ImportSummaryItem[];
}

export function describe(
  metadata: PackageMetadata,
  genres: readonly GenreEntry[] | undefined,
  fallbackTitle: string,
): DescribeResult {
  const summary: ImportSummaryItem[] = [];
  const authors: MarkdownPerson[] = [];
  const translators: MarkdownPerson[] = [];
  const custom: { type: string; text: string }[] = [];
  for (const person of [...metadata.creators, ...metadata.contributors]) {
    const role = person.role;
    const fromCreator = metadata.creators.includes(person);
    if (role === MARC.author || (!role && fromCreator)) authors.push(splitName(person));
    else if (role === MARC.translator) translators.push(splitName(person));
    else if (role && LABEL_BY_ROLE[role]) {
      const name = splitName(person);
      custom.push({
        type: LABEL_BY_ROLE[role],
        text: writeFbdMakerName({
          last: name.lastName ?? name.nickname ?? '',
          first: name.firstName ?? '',
          middle: name.middleName ?? '',
        }),
      });
    } else summary.push({ kind: 'listedData', detail: `${role ?? 'contributor'}: ${person.name}` });
  }
  if (metadata.rights) custom.push({ type: 'rights', text: metadata.rights });

  // Subjects: a genre where one matches its code or its name in the editor's languages, else a keyword.
  const byName = new Map<string, string>();
  for (const entry of genres ?? []) {
    byName.set(entry.code.toLowerCase(), entry.code);
    for (const language of ['en', 'ru', 'uk']) {
      const name = entry.names[language];
      if (name) byName.set(name.toLowerCase(), entry.code);
    }
  }
  const genreCodes: string[] = [];
  const keywords: string[] = [];
  for (const subject of metadata.subjects) {
    const code = byName.get(subject.trim().toLowerCase());
    if (code && !genreCodes.includes(code)) genreCodes.push(code);
    else if (!code) keywords.push(subject.trim());
  }
  const language = (metadata.languages[0] ?? '').trim().split(/[-_]/)[0]?.toLowerCase();
  const date = /^\d{4}(-\d{2}(-\d{2})?)?/.exec(metadata.date ?? '')?.[0];
  const isbn = metadata.identifiers
    .map((identifier) => identifier.replace(/^urn:isbn:/i, '').trim())
    .find((identifier) => /^(97[89][- ]?)?(\d[- ]?){9}[\dXx]$/.test(identifier));
  for (const item of metadata.unmapped) summary.push({ kind: 'listedData', detail: item });

  const description: MarkdownDescription = {
    title: metadata.titles[0] ?? fallbackTitle,
    authors,
    date,
    lang: language || undefined,
    annotation: annotationParagraphs(metadata.description),
    keywords: keywords.length > 0 ? keywords.join(', ') : undefined,
    genres: genreCodes,
    sequences: metadata.series.map((one) => ({ name: one.name, number: one.number })),
    translators,
    publish:
      metadata.publisher || isbn
        ? { publisher: metadata.publisher, isbn, sequences: [] }
        : undefined,
    custom,
  };
  return { description, summary };
}
