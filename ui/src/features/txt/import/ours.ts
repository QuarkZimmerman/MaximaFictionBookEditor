/**
 * Feature 017 (D5, D28, D29; contracts/txt-format.md §5): the editor's own TXT read back - recognised by its
 * record at the end; the title page gives the annotation, the text comes in one paragraph per line, each note
 * block becomes a note again with its bracketed references linked, and the record's fields give the
 * description. What the title page cannot carry comes back simplified (an annotation's poems as paragraphs).
 */
import { INFO_TYPE_BY_ROLE, type Role } from '@/features/description/roles';
import type { GenreEntry, LanguageEntry } from '@/rpc/types';

import { RECORD_WORDS, TXT_WORDS } from '../shared/words';
import { xmlText } from './build';

export interface OwnTxt {
  /** The record's fields in order: label and value. */
  fields: { label: string; value: string }[];
  annotation: string[];
  /** The text: paragraphs (with their references) and note blocks, in order. */
  items: ({ kind: 'p'; text: string } | { kind: 'note'; label: string; lines: string[] })[];
}

const SEPARATOR = '='.repeat(40);
const CLOSING = '-'.repeat(40);
const NOTE_WORDS = Object.values(TXT_WORDS).map((w) => w.note);
const MARKER = new RegExp(`^-{2,} (?:${NOTE_WORDS.join('|')}) (.+?) -{2,}$`);
const MADE_WITH = /^Made with Maxima Fiction Book Editor \S+$/;

type Label = keyof typeof RECORD_WORDS;
/** Every English label of the record, singular and plural, to its field. */
const LABELS = new Map<string, Label>();
for (const [key, word] of Object.entries(RECORD_WORDS) as [Label, unknown][]) {
  if (key === 'madeWith') continue;
  if (typeof word === 'string') LABELS.set(word, key);
  else {
    const plural = word as { one: string; many: string };
    LABELS.set(plural.one, key);
    LABELS.set(plural.many, key);
  }
}

/** The editor's own TXT, or null when the file does not end with its record (D5). */
export function parseOwnTxt(text: string): OwnTxt | null {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  while (lines.length && lines[lines.length - 1]!.trim() === '') lines.pop();
  const at = lines.lastIndexOf(SEPARATOR);
  if (at < 0) return null;
  const recordLines = lines.slice(at + 1);
  if (recordLines.length < 2 || !MADE_WITH.test(recordLines[recordLines.length - 1]!)) return null;
  const fields: { label: string; value: string }[] = [];
  for (const line of recordLines.slice(0, -1)) {
    const colon = line.indexOf(': ');
    const label = colon > 0 ? line.slice(0, colon) : '';
    if (!LABELS.has(label)) return null;
    fields.push({ label, value: line.slice(colon + 2).trim() });
  }
  if (fields[0]?.label !== RECORD_WORDS.title) return null;
  // The title page: its head up to the first blank line, then the annotation up to two blank lines.
  const page = lines.slice(0, at);
  let i = 0;
  while (i < page.length && page[i]!.trim() !== '') i++;
  const annotation: string[] = [];
  let blanks = 0;
  for (; i < page.length; i++) {
    if (page[i]!.trim() === '') {
      blanks++;
      if (blanks >= 2) break;
      continue;
    }
    blanks = 0;
    annotation.push(page[i]!.trim());
  }
  const items: OwnTxt['items'] = [];
  for (i++; i < page.length; i++) {
    const line = page[i]!;
    if (line.trim() === '') continue;
    const marker = MARKER.exec(line.trim());
    if (marker) {
      const noteLines: string[] = [];
      for (i++; i < page.length && page[i] !== CLOSING; i++)
        if (page[i]!.trim() !== '') noteLines.push(page[i]!.trim());
      items.push({ kind: 'note', label: marker[1]!, lines: noteLines });
      continue;
    }
    items.push({ kind: 'p', text: line.trim() });
  }
  return { fields, annotation, items };
}

/** The editor's lists the record's names are read back with (D29). */
export interface OwnLists {
  genres: readonly GenreEntry[];
  languages: readonly LanguageEntry[];
}

/** "First Middle Last (Nickname)": the last word the last name, the first the first name (D29). */
function personXml(element: string, name: string): string {
  const nick = /\(([^()]*)\)\s*$/.exec(name);
  const words = name
    .replace(/\(([^()]*)\)\s*$/, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const part = (tag: string, value: string | undefined) =>
    value ? `<${tag}>${xmlText(value)}</${tag}>` : '';
  const first = words.length >= 2 ? words[0] : undefined;
  const last = words.length >= 1 ? words[words.length - 1] : undefined;
  const middle = words.length >= 3 ? words.slice(1, -1).join(' ') : undefined;
  return (
    `<${element}>${part('first-name', first)}${part('middle-name', middle)}` +
    `${last ? part('last-name', last) : nick ? '' : '<last-name/>'}${part('nickname', nick?.[1]?.trim())}</${element}>`
  );
}

const ROLE_OF: Partial<Record<Label, Role>> = {
  illustrators: 'illustrator',
  editors: 'editor',
  compilers: 'compiler',
  designers: 'designer',
  commentators: 'commentator',
  aboutTheAuthor: 'aboutTheAuthor',
};

const sameName = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The description of the record (D29), on the template's: the record's fields replace the template's; what
 * the record lacks stays as the template has it (D30). `unread` names the fields that could not be read.
 */
export function ownDescription(
  own: OwnTxt,
  templateXml: string,
  lists: OwnLists,
): { xml: string; unread: string[] } {
  const template = /<description[\s\S]*?<\/description>/.exec(templateXml)?.[0] ?? '<description/>';
  const templateInfo = /<title-info>[\s\S]*?<\/title-info>/.exec(template)?.[0] ?? '';
  const pick = (re: RegExp, fallback: string): string => re.exec(templateInfo)?.[0] ?? fallback;
  const values = (key: Label): string[] =>
    own.fields.filter((f) => LABELS.get(f.label) === key).map((f) => f.value);
  const list = (key: Label): string[] =>
    values(key)
      .flatMap((v) => v.split(/,\s+/))
      .map((v) => v.trim())
      .filter(Boolean);
  const unread: string[] = [];
  const genres = list('genres').map((name) => {
    const entry = lists.genres.find(
      (g) => Object.values(g.names).some((n) => sameName(n, name)) || g.code === name,
    );
    return `<genre>${xmlText(entry?.code ?? name)}</genre>`;
  });
  const languageCode = (name: string | undefined): string | undefined => {
    if (!name) return undefined;
    const entry = lists.languages.find(
      (l) =>
        l.code.toLowerCase() === name.toLowerCase() ||
        Object.values(l.names).some((n) => sameName(n, name)),
    );
    if (entry) return entry.code;
    if (/^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/i.test(name)) return name;
    unread.push(name);
    return undefined;
  };
  const authors = list('authors').map((a) => personXml('author', a));
  const translators = list('translators').map((a) => personXml('translator', a));
  const series = values('series').map((s) => {
    const m = /^(.*?)\s+#(\d+)$/.exec(s);
    return m
      ? `<sequence name="${xmlText(m[1]!)}" number="${m[2]}"/>`
      : `<sequence name="${xmlText(s)}"/>`;
  });
  const lang =
    languageCode(values('language')[0]) ??
    /<lang>([\s\S]*?)<\/lang>/.exec(templateInfo)?.[1] ??
    'en';
  const srcLang = languageCode(values('originalLanguage')[0]);
  const title = values('title')[0] ?? '';
  const keywords = values('keywords')[0];
  const date = values('date')[0];
  const annotation = own.annotation.length
    ? `<annotation>${own.annotation.map((p) => `<p>${xmlText(p)}</p>`).join('')}</annotation>`
    : '';
  const titleInfo =
    '<title-info>' +
    (genres.length
      ? genres.join('')
      : pick(/<genre\b[^>]*\/>|<genre\b[^>]*>[\s\S]*?<\/genre>/, '<genre/>')) +
    (authors.length
      ? authors.join('')
      : pick(/<author>[\s\S]*?<\/author>/, '<author><last-name/></author>')) +
    `<book-title>${xmlText(title)}</book-title>` +
    annotation +
    (keywords ? `<keywords>${xmlText(keywords)}</keywords>` : '') +
    (date ? `<date>${xmlText(date)}</date>` : '') +
    `<lang>${xmlText(lang)}</lang>` +
    (srcLang ? `<src-lang>${xmlText(srcLang)}</src-lang>` : '') +
    translators.join('') +
    series.join('') +
    '</title-info>';
  const publish = (['publisher', 'city', 'year', 'isbn'] as const)
    .map((key) => {
      const value = values(key)[0];
      return value ? `<${key}>${xmlText(value)}</${key}>` : '';
    })
    .join('');
  const custom = (Object.entries(ROLE_OF) as [Label, Role][])
    .flatMap(([key, role]) =>
      list(key).map((name) => {
        const words = name.split(/\s+/);
        const last = words.length > 1 ? words[words.length - 1] : words[0];
        const rest = words.length > 1 ? words.slice(0, -1) : [];
        const text = [last, ...rest].join(' ');
        return `<custom-info info-type="${INFO_TYPE_BY_ROLE[role]}">${xmlText(text)}</custom-info>`;
      }),
    )
    .join('');
  let xml = templateInfo ? template.replace(templateInfo, titleInfo) : template;
  if (publish) {
    xml = /<publish-info>[\s\S]*?<\/publish-info>|<publish-info\/>/.test(xml)
      ? xml.replace(
          /<publish-info>[\s\S]*?<\/publish-info>|<publish-info\/>/,
          `<publish-info>${publish}</publish-info>`,
        )
      : xml.replace(/<\/document-info>/, `</document-info><publish-info>${publish}</publish-info>`);
  }
  if (custom) xml = xml.replace(/<\/description>$/, `${custom}</description>`);
  return { xml, unread };
}

/** The bodies of the text: the paragraphs with their references linked, and the notes body (D28). */
export function ownBodies(own: OwnTxt): { xml: string; notes: number } {
  const ids: string[] = [];
  const notes: { id: string; label: string; lines: string[] }[] = [];
  own.items.forEach((item) => {
    if (item.kind === 'note') {
      const id = `n_${notes.length + 1}`;
      notes.push({ id, label: item.label, lines: item.lines });
      ids.push(id);
    } else ids.push('');
  });
  // D28: a "[label]" refers to the note whose block follows its paragraph, else to the last such note.
  const last = new Map<string, string>();
  const refs = (text: string, followers: { id: string; label: string }[]): string => {
    const taken = new Set<string>();
    return text
      .split(/(\[[^\]]+\])/)
      .map((part) => {
        const m = /^\[([^\]]+)\]$/.exec(part);
        if (!m) return xmlText(part);
        const follower = followers.find((f) => f.label === m[1] && !taken.has(f.id));
        const id = follower?.id ?? last.get(m[1]!);
        if (!id) return xmlText(part);
        if (follower) {
          taken.add(follower.id);
          last.set(m[1]!, follower.id);
        }
        return `<a l:href="#${id}" type="note">${xmlText(part)}</a>`;
      })
      .join('');
  };
  let body = '';
  let noteAt = 0;
  own.items.forEach((item, index) => {
    if (item.kind === 'note') {
      noteAt++;
      return;
    }
    const followers: { id: string; label: string }[] = [];
    for (let j = index + 1; j < own.items.length && own.items[j]!.kind === 'note'; j++) {
      const note = own.items[j] as { kind: 'note'; label: string };
      followers.push({ id: notes[noteAt + followers.length]!.id, label: note.label });
    }
    body += `<p>${refs(item.text, followers)}</p>`;
  });
  const notesBody = notes.length
    ? `<body name="notes">${notes
        .map(
          (n) =>
            `<section id="${n.id}"><title><p>${xmlText(n.label)}</p></title>${
              n.lines.map((l) => `<p>${xmlText(l)}</p>`).join('') || '<empty-line/>'
            }</section>`,
        )
        .join('')}</body>`
    : '';
  return {
    xml: `<body><section>${body || '<empty-line/>'}</section></body>${notesBody}`,
    notes: notes.length,
  };
}
