/**
 * Feature 011 (US5; D15, D45; contracts/markdown-export.md §1; research DP-10): the YAML front
 * matter of a Markdown export - every field of the description that has a value, under fixed keys
 * the editor's import reads back. Strings are always double-quoted (`\"`, `\\`, `\n` escaped), lists
 * and nested blocks are written in YAML's flow form, empty fields are left out. The stylesheets
 * travel under `stylesheets`, the CSS ones again under Pandoc's `header-includes`.
 */

import type { Description, Person, Sequence, Stylesheet } from '@/model/document';

export interface FrontMatterInput {
  description: Description;
  stylesheets: readonly Stylesheet[];
  /** The book's annotation and the history as Markdown text (D15), '' when absent. */
  annotation: string;
  history: string;
  /** The cover's reference in the text (a picture name), when pictures are exported. */
  cover?: string;
}

/** A YAML double-quoted string. */
export function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}"`;
}

/** A person's name as one string: the names, or the nickname alone. */
export function personName(person: Person): string {
  const names = [person.firstName, person.middleName, person.lastName]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' ');
  return names || (person.nickname ?? '').trim();
}

type Value = string | number | Value[] | { [key: string]: Value | undefined };

function flow(value: Value): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return yamlString(value);
  if (Array.isArray(value)) return `[${value.map(flow).join(', ')}]`;
  const entries = Object.entries(value).filter(([, item]) => item !== undefined) as [
    string,
    Value,
  ][];
  return `{ ${entries.map(([key, item]) => `${key}: ${flow(item)}`).join(', ')} }`;
}

const names = (persons: readonly Person[]) => persons.map(personName).filter(Boolean);
const text = (value: string | undefined) => {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed : undefined;
};
const list = <T>(items: readonly T[]) => (items.length > 0 ? [...items] : undefined);

/** The series entries: one `series` / `series_index` pair, or lists for several (D15). */
function series(sequences: readonly Sequence[]): { series?: Value; series_index?: Value } {
  const named = sequences.filter((sequence) => sequence.name.trim());
  if (named.length === 0) return {};
  if (named.length === 1) {
    const only = named[0]!;
    return {
      series: only.name.trim(),
      ...(only.number !== undefined ? { series_index: only.number } : {}),
    };
  }
  return {
    series: named.map((sequence) => sequence.name.trim()),
    series_index: named.map((sequence) => sequence.number ?? 0),
  };
}

/** The front matter block, `---` to `---`, with a trailing newline. */
export function writeFrontMatter(input: FrontMatterInput): string {
  const { titleInfo, srcTitleInfo, documentInfo, publishInfo, customInfo } = input.description;
  const fields: [string, Value | undefined][] = [
    ['title', text(titleInfo.bookTitle)],
    ['author', list(names(titleInfo.authors))],
    ['genres', list(titleInfo.genres.map((genre) => genre.code).filter(Boolean))],
    ['description', text(input.annotation)],
    ['keywords', text(titleInfo.keywords)],
    ['date', text(titleInfo.date?.value) ?? text(titleInfo.date?.text)],
    ['lang', text(titleInfo.lang)],
    ['src_lang', text(titleInfo.srcLang)],
    ['translator', list(names(titleInfo.translators))],
    ...(Object.entries(series(titleInfo.sequences)) as [string, Value][]),
    ['cover', input.cover],
  ];
  if (srcTitleInfo) {
    const source: Record<string, Value | undefined> = {
      title: text(srcTitleInfo.bookTitle),
      author: list(names(srcTitleInfo.authors)),
      lang: text(srcTitleInfo.lang),
      ...series(srcTitleInfo.sequences),
    };
    if (Object.values(source).some((value) => value !== undefined)) fields.push(['source', source]);
  }
  const document: Record<string, Value | undefined> = {
    author: list(names(documentInfo.authors)),
    program: text(documentInfo.programUsed),
    date: text(documentInfo.date.value) ?? text(documentInfo.date.text),
    src_url: list(documentInfo.srcUrls.filter((url) => url.trim())),
    src_ocr: text(documentInfo.srcOcr),
    id: text(documentInfo.id),
    version: text(documentInfo.version),
    history: text(input.history),
  };
  if (Object.values(document).some((value) => value !== undefined)) {
    fields.push(['document', document]);
  }
  if (publishInfo) {
    const publish: Record<string, Value | undefined> = {
      book_name: text(publishInfo.bookName),
      publisher: text(publishInfo.publisher),
      city: text(publishInfo.city),
      year: text(publishInfo.year),
      isbn: text(publishInfo.isbn),
      ...series(publishInfo.sequences),
    };
    if (Object.values(publish).some((value) => value !== undefined))
      fields.push(['publish', publish]);
  }
  const custom = customInfo
    .filter((info) => info.text.trim() || info.infoType.trim())
    .map((info) => ({ type: info.infoType, text: info.text }));
  if (custom.length > 0) fields.push(['custom', custom]);
  if (input.stylesheets.length > 0) {
    fields.push([
      'stylesheets',
      input.stylesheets.map((sheet) => ({ type: sheet.type, text: sheet.content })),
    ]);
  }
  const lines = ['---'];
  for (const [key, value] of fields) {
    if (value !== undefined) lines.push(`${key}: ${flow(value)}`);
  }
  // Pandoc applies a header's raw HTML in its HTML and EPUB output (D45); GitHub's standard
  // filters a <style> block out of the text, so the CSS travels here instead.
  const css = input.stylesheets.filter((sheet) => /css/i.test(sheet.type));
  if (css.length > 0) {
    lines.push('header-includes: |', '  ```{=html}', '  <style>');
    for (const sheet of css) {
      for (const line of sheet.content.split(/\r?\n/)) lines.push(`  ${line}`);
    }
    lines.push('  </style>', '  ```');
  }
  lines.push('---', '');
  return lines.join('\n');
}
