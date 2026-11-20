/**
 * Feature 017 (D4, D5; contracts/txt-format.md §1 and §4): the title page that opens the TXT and the
 * record of labelled fields that closes it, in English whatever the book's language (D14). Only the description's
 * plain fields: the custom information gives its people (illustrators, editors...) and nothing else;
 * the document information gives nothing.
 */

import { parseRoleRow, ROLES, type Role } from '@/features/description/roles';
import type { Description, Person, Sequence } from '@/model/document';
import type { GenreEntry, LanguageEntry } from '@/rpc/types';

import { type Plural, RECORD_WORDS, type RecordWords, txtWordsLanguage } from '../shared/words';

/** The editor's lists the record names genres and languages from. */
export interface RecordLists {
  genres: readonly GenreEntry[];
  languages: readonly LanguageEntry[];
}

/** The record's separator and the note blocks' width (DP-8). */
export const LINE_WIDTH = 40;
export const RECORD_SEPARATOR = '='.repeat(LINE_WIDTH);

/** "First Middle Last (Nickname)"; a nickname alone in parentheses, so that it reads back as one. */
export function personName(person: Person): string {
  const names = [person.firstName, person.middleName, person.lastName]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' ');
  const nickname = (person.nickname ?? '').trim();
  if (!nickname) return names;
  return names ? `${names} (${nickname})` : `(${nickname})`;
}

/** Every series, nested ones after their parent, "Name #n" ("#n" only with a number). */
export function seriesTexts(sequences: readonly Sequence[]): string[] {
  const out: string[] = [];
  const walk = (list: readonly Sequence[]): void => {
    for (const s of list) {
      const name = s.name.trim();
      if (name) out.push(s.number !== undefined ? `${name} #${s.number}` : name);
      walk(s.children);
    }
  };
  walk(sequences);
  return out;
}

const ROLE_WORDS: Readonly<Record<Role, keyof RecordWords>> = {
  illustrator: 'illustrators',
  editor: 'editors',
  compiler: 'compilers',
  designer: 'designers',
  commentator: 'commentators',
  aboutTheAuthor: 'aboutTheAuthor',
};

function label(word: Plural | string, count: number): string {
  return typeof word === 'string' ? word : count === 1 ? word.one : word.many;
}

function nameIn(names: Record<string, string>, language: string): string | undefined {
  return names[language] ?? names.en;
}

/** The record's lines, the separator first and the line naming the editor last (D4, D5). */
export function recordLines(
  description: Description,
  lists: RecordLists,
  title: string,
  version: string,
): string[] {
  const info = description.titleInfo;
  // The labels are English (D14, the requester's decision); the genres' and languages' names stay in
  // the book's language, as his request asked for the genres.
  const words = RECORD_WORDS;
  const language = txtWordsLanguage(info.lang);
  const lines = [RECORD_SEPARATOR, `${words.title}: ${title}`];
  const field = (word: Plural | string, values: string[]): void => {
    const present = values.map((v) => v.trim()).filter(Boolean);
    if (present.length) lines.push(`${label(word, present.length)}: ${present.join(', ')}`);
  };
  for (const series of seriesTexts(info.sequences)) lines.push(`${words.series}: ${series}`);
  field(words.authors, info.authors.map(personName));
  field(words.translators, info.translators.map(personName));
  const people = new Map<Role, string[]>();
  for (const row of description.customInfo) {
    const parsed = parseRoleRow(row);
    if (!parsed) continue;
    const name = [parsed.firstName, parsed.middleName, parsed.lastName].filter(Boolean).join(' ');
    people.set(parsed.role, [...(people.get(parsed.role) ?? []), name]);
  }
  for (const role of ROLES) {
    const names = people.get(role);
    if (names) field(words[ROLE_WORDS[role]] as Plural | string, names);
  }
  field(
    words.genres,
    info.genres.map((g) => {
      const entry = lists.genres.find((e) => e.code === g.code);
      return (entry && nameIn(entry.names, language)) || g.code;
    }),
  );
  const languageName = (code: string | undefined): string => {
    if (!code) return '';
    const entry = lists.languages.find((e) => e.code.toLowerCase() === code.toLowerCase());
    return (entry && nameIn(entry.names, language)) || code;
  };
  field(words.language, [languageName(info.lang)]);
  field(words.originalLanguage, [languageName(info.srcLang)]);
  field(words.date, [info.date?.text ?? '']);
  field(words.keywords, [info.keywords ?? '']);
  const publish = description.publishInfo;
  field(words.publisher, [publish?.publisher ?? '']);
  field(words.city, [publish?.city ?? '']);
  field(words.year, [publish?.year ?? '']);
  field(words.isbn, [publish?.isbn ?? '']);
  lines.push(`${words.madeWith} ${version}`);
  return lines;
}

/** The title page's head: the title, each series in parentheses, each author (D4). */
export function titlePageHead(description: Description, title: string): string[] {
  const info = description.titleInfo;
  return [
    title,
    ...seriesTexts(info.sequences).map((s) => `(${s})`),
    ...info.authors.map(personName).filter(Boolean),
  ];
}
