/**
 * Feature 010, US8 (spec D26-D30, D32, D37; research DP-1; contracts/markdown-mapping.md §1, §2):
 * the Markdown converter. Pure - no DOM, no network - so the import's worker can run it.
 * markdown-it reads the text (CommonMark with tables, strikethrough, task lists and bare
 * addresses, footnotes, sub- and superscript, heading ids, definition lists); its tokens become
 * FB2 text - the main body and the notes body - with the description's data, the pictures to
 * add, the characters to draw and what the import's summary lists.
 */

import MarkdownIt from 'markdown-it';
import type { Token } from 'markdown-it';
import attrs from 'markdown-it-attrs';
import deflist from 'markdown-it-deflist';
import footnote from 'markdown-it-footnote';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import taskLists from 'markdown-it-task-lists';

import { styleLooks } from './export/serialize';
import { frontList, frontText, readFrontMatter, type FlowValue } from './frontMatter';
import {
  codePoints,
  expandEmojiCodes,
  graphemes,
  specialChar,
  treatmentOf,
  type SpecialChar,
} from './specialChars';

export interface MarkdownPerson {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  nickname?: string;
}

/** The description's data from the front matter and the headings (D30). */
export interface MarkdownDescription {
  title: string;
  authors: MarkdownPerson[];
  date?: string;
  lang?: string;
  annotation: string[];
  keywords?: string;
  sequence?: { name: string; number?: number };
  /** The cover picture's href: `#id` of a picture to add, or a web address kept as written. */
  cover?: string;
  genres: string[];
  // Feature 011 (US7, D29, D46): the rest of the editor's own header (contracts/markdown-export.md
  // §1) and Pandoc's keys (§7).
  sequences: MarkdownSequence[];
  srcLang?: string;
  translators: MarkdownPerson[];
  source?: {
    title?: string;
    authors: MarkdownPerson[];
    lang?: string;
    sequences: MarkdownSequence[];
  };
  document?: {
    authors: MarkdownPerson[];
    program?: string;
    date?: string;
    srcUrls: string[];
    srcOcr?: string;
    id?: string;
    version?: string;
    history: string[];
  };
  publish?: {
    bookName?: string;
    publisher?: string;
    city?: string;
    year?: string;
    isbn?: string;
    sequences: MarkdownSequence[];
  };
  custom: { type: string; text: string }[];
}

export interface MarkdownSequence {
  name: string;
  number?: number;
}

/** A stylesheet the import found (D46): the export's own, or CSS another tool wrote. */
export interface MarkdownStylesheet {
  type: string;
  text: string;
  /** CSS written for HTML (Pandoc's header, a `<style>` block): translated to FB2 (D46, §7). */
  foreign: boolean;
}

/** A picture to add once the book exists (D29): a file, or the bytes of a `data:` address. */
export interface MarkdownPicture {
  id: string;
  kind: 'file' | 'data';
  /** The file's absolute path. */
  path?: string;
  /** The `data:` address. */
  data?: string;
}

export type SummaryKind =
  | 'webPicture'
  | 'missingTarget'
  | 'htmlTag'
  | 'droppedChar'
  // Feature 011 (US7; D46; FR-073, FR-074): header keys without an FB2 field, CSS not read, classes
  // beyond the first, rules and declarations the translation dropped.
  | 'headerKey'
  | 'webCss'
  | 'cssFile'
  | 'extraClass'
  | 'cssDropped'
  // Feature 011 (D49, FR-075a): a Mermaid block that could not be drawn, kept as code.
  | 'diagram';

/**
 * Feature 011 (D49): a ```mermaid block outside quotes and notes. The converter leaves the marker
 * `<!--mfbe-diagram:<index>-->` in the body; the import flow draws the diagram (Mermaid needs the
 * page) and puts `imageXml` there, or `codeXml` - the block as code - when it cannot be drawn.
 */
export interface MarkdownDiagram {
  index: number;
  /** The picture's binary id; the export recognises a diagram by it. */
  id: string;
  source: string;
  imageXml: string;
  codeXml: string;
}

export interface SummaryItem {
  kind: SummaryKind;
  detail: string;
}

export interface ConvertResult {
  bodyXml: string;
  notesXml: string | null;
  description: MarkdownDescription;
  pictures: MarkdownPicture[];
  chars: SpecialChar[];
  diagrams: MarkdownDiagram[];
  summary: SummaryItem[];
  stats: { sections: number; pictures: number; tables: number; notes: number };
  /** Feature 011 (US7, D46): the stylesheets of the header and of the text, in order. */
  stylesheets: MarkdownStylesheet[];
  /** The local CSS files the header's `css:` names, as written (read by the import afterwards). */
  cssFiles: string[];
}

export interface ConvertOptions {
  /** The Markdown file's name without its extension: the title when nothing else gives one. */
  fileName: string;
  /** The Markdown file's folder, for the pictures' relative paths. */
  baseDir: string;
  /** The notes body's title, in the interface language (as Style > Footnote... writes it). */
  notesTitle: string;
  /** The FB2 genre codes the editor knows; front-matter genres outside them are left out. */
  genres?: ReadonlySet<string>;
  /** Feature 011 (D49): the alternative text of a diagram's picture, in the interface language. */
  diagramAlt?: string;
}

const NBSP = '\u00a0';
const LIST_INDENT = NBSP.repeat(4);
/** Text the fast path takes as it is: nothing that becomes a picture or is dropped. */
function isPlain(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0x7e)) continue;
    if (
      (c >= 0xa0 && c <= 0x24f) ||
      (c >= 0x300 && c <= 0x52f) ||
      (c >= 0x2010 && c <= 0x2027) ||
      (c >= 0x2030 && c <= 0x205e) ||
      (c >= 0x20a0 && c <= 0x20bf)
    ) {
      continue;
    }
    return false;
  }
  return true;
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function attr(text: string): string {
  return esc(text).replace(/"/g, '&quot;');
}

const NCNAME = /^[\p{L}_][\p{L}\p{N}_.-]*$/u;

/** A token's attribute as text ('' when absent). */
function attrOf(token: Token, name: string): string {
  const value = token.attrGet(name);
  return value === null || value === undefined ? '' : String(value);
}

/** A valid, readable id made of a text: `Chapter One` -> `chapter-one`. */
function idOf(text: string, fallback: string): string {
  const id = text
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_.-]/gu, '')
    .replace(/^[-.]+/, '');
  if (!id) return fallback;
  return NCNAME.test(id) ? id : `${fallback}-${id}`;
}

/** The anchor GitHub gives a heading, which links in Markdown files use. */
function githubAnchor(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

function plainText(children: readonly Token[] | null): string {
  let text = '';
  for (const token of children ?? []) {
    if (token.type === 'text' || token.type === 'code_inline') text += token.content;
    else if (token.type === 'softbreak' || token.type === 'hardbreak') text += ' ';
    else if (token.type === 'image') text += plainText(token.children);
  }
  return text;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, NBSP)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

function joinPath(dir: string, relative: string): string {
  if (!dir) return relative;
  const separator = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  const parts = `${dir.replace(/[\\/]+$/, '')}${separator}${relative}`.split(/[\\/]/);
  const out: string[] = [];
  for (const part of parts) {
    if (part === '..' && out.length > 1) out.pop();
    else if (part !== '.') out.push(part);
  }
  return out.join(separator);
}

/** The header keys the import reads (feature 010's, the editor's export's, Pandoc's). */
const KNOWN_HEADER_KEYS: ReadonlySet<string> = new Set([
  'title',
  'author',
  'authors',
  'genres',
  'genre',
  'description',
  'summary',
  'abstract',
  'keywords',
  'tags',
  'subject',
  'date',
  'lang',
  'language',
  'src_lang',
  'translator',
  'translators',
  'series',
  'sequence',
  'series_index',
  'number',
  'cover',
  'image',
  'cover-image',
  'source',
  'document',
  'publish',
  'custom',
  'stylesheets',
  'header-includes',
  'css',
  'publisher',
  'identifier',
  'isbn',
  'rights',
]);

function personOf(name: string): MarkdownPerson {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return { nickname: words[0] };
  return {
    firstName: words[0],
    middleName: words.length > 2 ? words.slice(1, -1).join(' ') : undefined,
    lastName: words[words.length - 1],
  };
}

interface SectionNode {
  level: number;
  title: string | null;
  plain: string;
  id: string | null;
  blocks: string[];
  children: SectionNode[];
}

interface BlockContext {
  /** Inside a quote or a note: no block pictures, headings become subtitles. */
  inCite: boolean;
  /** List depth (0 outside lists). */
  depth: number;
  /** The marker the next paragraph of a list item begins with; '' once used. */
  item?: { marker: string; used: boolean };
}

interface InlineSink {
  push: (xml: string) => void;
  openTag: (name: string, start: string) => void;
  closeTag: (name: string) => void;
  breakLine: () => void;
}

class Converter {
  private readonly md: InstanceType<typeof MarkdownIt>;
  private readonly used = new Set<string>();
  private readonly anchors = new Map<string, string>();
  private readonly headingIds: string[] = [];
  private readonly pictures: MarkdownPicture[] = [];
  private readonly pictureIds = new Map<string, string>();
  private readonly chars = new Map<string, SpecialChar>();
  private readonly diagrams: MarkdownDiagram[] = [];
  private readonly summary: SummaryItem[] = [];
  private readonly summaryKeys = new Set<string>();
  private readonly notes: string[] = [];
  private readonly stats = { sections: 0, pictures: 0, tables: 0, notes: 0 };
  /** Feature 011 (US7, D46): the `<style>` blocks of the text, in order. */
  private readonly textStyles: MarkdownStylesheet[] = [];
  /** The classes of the `<div class>` blocks the parser is inside (D46): their paragraphs' style. */
  private readonly divStyles: string[] = [];
  /** Whether each open `<span>` is a named style (a class-less one closes nothing). */
  private readonly spans: boolean[] = [];
  private readonly root: SectionNode = {
    level: 0,
    title: null,
    plain: '',
    id: null,
    blocks: [],
    children: [],
  };
  private readonly stack: SectionNode[] = [this.root];

  constructor(private readonly options: ConvertOptions) {
    this.md = new MarkdownIt({ html: true, linkify: true })
      .use(attrs, { allowedAttributes: ['id'] })
      .use(deflist)
      .use(footnote)
      .use(sub)
      .use(sup)
      .use(taskLists, { enabled: false });
  }

  private unique(base: string): string {
    let id = base;
    for (let n = 1; this.used.has(id); n += 1) id = `${base}-${n}`;
    this.used.add(id);
    return id;
  }

  private note(kind: SummaryKind, detail: string): void {
    const key = `${kind}\n${detail}`;
    if (this.summaryKeys.has(key)) return;
    this.summaryKeys.add(key);
    this.summary.push({ kind, detail });
  }

  run(text: string): ConvertResult {
    const { values, structured, body } = readFrontMatter(text);
    const env: Record<string, unknown> = {};
    const tokens = this.md.parse(this.prepare(body, values, structured), env);
    const footnoteCount = ((env.footnotes as { list?: unknown[] } | undefined)?.list ?? []).length;
    for (let n = 1; n <= footnoteCount; n += 1) this.used.add(`n_${n}`);
    // The sections' ids first, so that links to later headings find them.
    let levelOne = 0;
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i]!;
      if (token.type !== 'heading_open' || token.level !== 0) continue;
      if (token.tag === 'h1') levelOne += 1;
      const plain = plainText(tokens[i + 1]?.children ?? null);
      const explicit = attrOf(token, 'id') || null;
      const id = this.unique(
        explicit && NCNAME.test(explicit) ? explicit : idOf(explicit ?? plain, 'section'),
      );
      this.headingIds.push(id);
      this.anchors.set(id, id);
      if (explicit) this.anchors.set(explicit, id);
      const anchor = githubAnchor(plain);
      if (anchor && !this.anchors.has(anchor)) this.anchors.set(anchor, id);
    }
    const opensWithTitle =
      tokens[0]?.type === 'heading_open' && tokens[0].tag === 'h1' && levelOne === 1;

    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i]!;
      if (token.type === 'heading_open' && token.level === 0) {
        this.openSection(Number(token.tag.slice(1)), tokens[i + 1]!);
        i += 2;
      } else if (token.type === 'footnote_block_open') {
        i = this.footnotes(tokens, i);
      } else {
        const target = this.stack[this.stack.length - 1]!;
        i = this.block(tokens, i, (xml) => target.blocks.push(xml), { inCite: false, depth: 0 });
      }
    }

    // D27: a single level-1 heading that opens the file is the book's title.
    let bodyTitle = '';
    let titlePlain = '';
    let sections = this.root.children;
    if (opensWithTitle && this.root.blocks.length === 0 && sections.length === 1) {
      const book = sections[0]!;
      bodyTitle = book.title ?? '';
      titlePlain = book.plain;
      sections = book.blocks.length
        ? [this.untitled(book.level + 1, book.blocks), ...book.children]
        : book.children;
    }
    if (this.root.blocks.length) sections = [this.untitled(1, this.root.blocks), ...sections];
    if (sections.length === 0) sections = [this.untitled(1, [])];
    const bodyXml = `<body>${bodyTitle}${sections.map((s) => this.renderSection(s)).join('')}</body>`;
    const notesXml = this.notes.length
      ? `<body name="notes"><title><p>${esc(this.options.notesTitle)}</p></title>${this.notes.join('')}</body>`
      : null;
    this.stats.notes = this.notes.length;
    return {
      bodyXml,
      notesXml,
      description: this.describe(values, structured, titlePlain),
      pictures: this.pictures,
      chars: [...this.chars.values()],
      diagrams: this.diagrams,
      summary: this.summary,
      stats: this.stats,
      stylesheets: [...this.headerStylesheets(values, structured), ...this.textStyles],
      cssFiles: this.cssFiles(values),
    };
  }

  /**
   * Feature 011 (US7, D29, D46): the text as the converter reads it - without the editor's own
   * cover and title page, which the header gives back as the description; Pandoc's `::: {.x}`
   * blocks and `[text]{.x}` spans as the `<div class>` and `<span class>` they stand for; a named
   * style's span without the Markdown forms the export added to imitate its look.
   */
  private prepare(
    body: string,
    values: ReturnType<typeof readFrontMatter>['values'],
    structured: ReturnType<typeof readFrontMatter>['structured'],
  ): string {
    let text = body;
    const title = frontText(values, 'title');
    if (title) {
      const lead = text.replace(/^\s+/, '');
      const withoutCover = lead.replace(/^!\[cover\](\[[^\]\n]*\]|\([^)\n]*\))[ \t]*\n+/, '');
      const page = /^# ([^\n]*)\n+((?:\*[^*\n][^\n]*\*\n+)*)(\*\*[^\n]*\*\*\n+)?---[ \t]*\n/.exec(
        withoutCover,
      );
      if (page && page[1]!.replace(/\\(.)/g, '$1').trim() === title) {
        text = withoutCover.slice(page[0].length);
      } else if (withoutCover !== lead) {
        text = withoutCover;
      }
    }
    text = text
      .replace(
        /^:::[ \t]*\{\.([\w-]+)((?:[ \t]+\.[\w-]+)*)\}[ \t]*$/gm,
        (_, name: string, extra: string) => {
          if (extra.trim()) this.note('extraClass', extra.trim());
          return `\n<div class="${name}">\n`;
        },
      )
      .replace(/^:::[ \t]*$/gm, '\n</div>\n')
      .replace(
        /\[([^\]\n]+)\]\{\.([\w-]+)((?:[ \t]+\.[\w-]+)*)\}(?!\()/g,
        (_, inner: string, name: string, extra: string) => {
          if (extra.trim()) this.note('extraClass', extra.trim());
          return `<span class="${name}">${inner}</span>`;
        },
      );
    // The export imitates a named style's look with Markdown's forms inside its span (D45): the
    // import takes the span alone back.
    const css = this.headerStylesheets(values, structured).map((sheet) => ({
      type: sheet.type,
      content: sheet.text,
    }));
    const looks = styleLooks({ stylesheets: css });
    if (looks.size > 0) {
      text = text.replace(
        /<span class="([\w-]+)"( data-fb2-style="element")?>(.*?)<\/span>/g,
        (whole, name: string, element: string | undefined, inner: string) => {
          const look = looks.get(name);
          if (!look) return whole;
          let content = inner;
          if (look.bold) content = /^\*\*(.*)\*\*$/s.exec(content)?.[1] ?? content;
          if (look.italic) content = /^\*(.*)\*$/s.exec(content)?.[1] ?? content;
          if (look.strike) content = /^~~(.*)~~$/s.exec(content)?.[1] ?? content;
          if (look.mono) {
            const code = /^(`+) ?(.*?) ?\1$/s.exec(content);
            if (code) content = code[2]!.replace(/[\\`*_[\]<&]/g, (ch) => `\\${ch}`);
          }
          return `<span class="${name}"${element ?? ''}>${content}</span>`;
        },
      );
    }
    return text;
  }

  private describe(
    values: ReturnType<typeof readFrontMatter>['values'],
    structured: ReturnType<typeof readFrontMatter>['structured'],
    headingTitle: string,
  ): MarkdownDescription {
    const flowText = (value: FlowValue | undefined): string =>
      typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
    const flowList = (value: FlowValue | undefined): string[] =>
      Array.isArray(value)
        ? value.map(flowText).filter(Boolean)
        : flowText(value)
          ? [flowText(value)]
          : [];
    const map = (key: string): Record<string, FlowValue> | undefined => {
      const value = structured.get(key);
      return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
    };
    const maps = (key: string): Record<string, FlowValue>[] => {
      const value = structured.get(key);
      return Array.isArray(value)
        ? (value.filter(
            (item) => item && typeof item === 'object' && !Array.isArray(item),
          ) as Record<string, FlowValue>[])
        : [];
    };
    const raw = (...keys: string[]): string[] => {
      for (const key of keys) {
        const value = values.get(key);
        if (value === undefined) continue;
        const list = (Array.isArray(value) ? value : [value])
          .map((item) => item.trim())
          .filter(Boolean);
        if (list.length > 0) return list;
      }
      return [];
    };
    const sequencesOf = (names: string[], numbers: string[]): MarkdownSequence[] =>
      names.map((name, i) => {
        const number = Number(numbers[i]);
        return { name, number: Number.isInteger(number) && number > 0 ? number : undefined };
      });
    const paragraphs = (text: string) =>
      text
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean);

    const title = frontText(values, 'title') || headingTitle.trim() || this.options.fileName;
    const sequences = sequencesOf(raw('series', 'sequence'), raw('series_index', 'number'));
    const annotation = frontText(values, 'description', 'summary', 'abstract');
    const keywords = frontList(values, 'keywords', 'tags', 'subject');
    const cover = frontText(values, 'cover', 'image', 'cover-image');
    const genres = frontList(values, 'genres', 'genre').filter(
      (code) => !this.options.genres || this.options.genres.has(code),
    );
    const source = map('source');
    const document = map('document');
    const publish = map('publish');
    // Pandoc's keys where the editor's own are absent (D46, contracts/markdown-export.md §7).
    const publisher = flowText(publish?.publisher) || frontText(values, 'publisher');
    const identifier = flowText(publish?.isbn) || frontText(values, 'identifier', 'isbn');
    const custom = maps('custom').map((item) => ({
      type: flowText(item.type),
      text: flowText(item.text),
    }));
    const rights = frontText(values, 'rights');
    if (rights) custom.push({ type: 'rights', text: rights });
    for (const key of values.keys()) {
      if (!KNOWN_HEADER_KEYS.has(key)) this.note('headerKey', key);
    }
    return {
      title,
      authors: frontList(values, 'authors', 'author').map(personOf),
      date: frontText(values, 'date') || undefined,
      lang: frontText(values, 'lang', 'language') || undefined,
      annotation: annotation ? paragraphs(annotation) : [],
      keywords: keywords.length ? keywords.join(', ') : undefined,
      sequence: sequences[0],
      sequences,
      cover: cover ? this.pictureHref(cover) : undefined,
      genres,
      srcLang: frontText(values, 'src_lang') || undefined,
      translators: frontList(values, 'translator', 'translators').map(personOf),
      source: source
        ? {
            title: flowText(source.title) || undefined,
            authors: flowList(source.author).map(personOf),
            lang: flowText(source.lang) || undefined,
            sequences: sequencesOf(flowList(source.series), flowList(source.series_index)),
          }
        : undefined,
      document: document
        ? {
            authors: flowList(document.author).map(personOf),
            program: flowText(document.program) || undefined,
            date: flowText(document.date) || undefined,
            srcUrls: flowList(document.src_url),
            srcOcr: flowText(document.src_ocr) || undefined,
            id: flowText(document.id) || undefined,
            version: flowText(document.version) || undefined,
            history: paragraphs(flowText(document.history)),
          }
        : undefined,
      publish:
        publish || publisher || identifier
          ? {
              bookName: flowText(publish?.book_name) || undefined,
              publisher: publisher || undefined,
              city: flowText(publish?.city) || undefined,
              year: flowText(publish?.year) || undefined,
              isbn: identifier || undefined,
              sequences: sequencesOf(flowList(publish?.series), flowList(publish?.series_index)),
            }
          : undefined,
      custom,
    };
  }

  /** The header's stylesheets (D46): the editor's own exactly, else Pandoc's `<style>` blocks. */
  private headerStylesheets(
    values: ReturnType<typeof readFrontMatter>['values'],
    structured: ReturnType<typeof readFrontMatter>['structured'],
  ): MarkdownStylesheet[] {
    const own = structured.get('stylesheets');
    if (Array.isArray(own) && own.length > 0) {
      return own
        .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
        .map((item) => {
          const sheet = item as Record<string, FlowValue>;
          return {
            type: typeof sheet.type === 'string' && sheet.type ? sheet.type : 'text/css',
            text: typeof sheet.text === 'string' ? sheet.text : '',
            foreign: false,
          };
        });
    }
    const includes = values.get('header-includes');
    const text = Array.isArray(includes) ? includes.join('\n') : (includes ?? '');
    return [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => ({
      type: 'text/css',
      text: match[1]!.trim(),
      foreign: true,
    }));
  }

  /** The local CSS files the header's `css:` names; web addresses are never fetched (FR-084). */
  private cssFiles(values: ReturnType<typeof readFrontMatter>['values']): string[] {
    const files: string[] = [];
    for (const entry of frontList(values, 'css')) {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(entry)) this.note('webCss', entry);
      else files.push(entry);
    }
    return files;
  }

  private untitled(level: number, blocks: string[]): SectionNode {
    return { level, title: null, plain: '', id: null, blocks, children: [] };
  }

  private openSection(level: number, inline: Token): void {
    while (this.stack.length > 1 && this.stack[this.stack.length - 1]!.level >= level) {
      this.stack.pop();
    }
    const segments = this.inline(inline.children).filter((s) => s.trim());
    const section: SectionNode = {
      level,
      title: segments.length
        ? `<title>${segments.map((s) => `<p>${s}</p>`).join('')}</title>`
        : null,
      plain: plainText(inline.children),
      id: this.headingIds.shift() ?? null,
      blocks: [],
      children: [],
    };
    this.stack[this.stack.length - 1]!.children.push(section);
    this.stack.push(section);
  }

  /** FB2 lets a section hold text or subsections: text before the first subsection goes into an
   *  untitled first subsection (D27). */
  private renderSection(section: SectionNode): string {
    let blocks = section.blocks;
    let children = section.children;
    if (blocks.length && children.length) {
      children = [this.untitled(section.level + 1, blocks), ...children];
      blocks = [];
    }
    this.stats.sections += 1;
    const inner = children.length
      ? children.map((child) => this.renderSection(child)).join('')
      : blocks.join('') || '<empty-line/>';
    return `<section${section.id ? ` id="${attr(section.id)}"` : ''}>${section.title ?? ''}${inner}</section>`;
  }

  private matching(tokens: Token[], index: number): number {
    const open = tokens[index]!;
    const closing = open.type.replace(/_open$/, '_close');
    for (let k = index + 1; k < tokens.length; k += 1) {
      const token = tokens[k]!;
      if (token.type === closing && token.level === open.level) return k;
    }
    return tokens.length - 1;
  }

  /** Renders the block starting at `index`; answers the index of its last token. */
  private block(
    tokens: Token[],
    index: number,
    out: (xml: string) => void,
    ctx: BlockContext,
  ): number {
    const token = tokens[index]!;
    switch (token.type) {
      case 'paragraph_open': {
        const children = tokens[index + 1]?.children ?? [];
        const meaningful = children.filter(
          (child) =>
            child.type !== 'softbreak' && !(child.type === 'text' && !child.content.trim()),
        );
        if (
          !ctx.inCite &&
          ctx.depth === 0 &&
          meaningful.length === 1 &&
          meaningful[0]!.type === 'image'
        ) {
          out(this.image(meaningful[0]!, true));
        } else {
          this.paragraph(children, out, ctx);
        }
        return index + 2;
      }
      case 'heading_open': {
        const text = this.inline(tokens[index + 1]?.children ?? null).join(' ');
        if (text.trim()) out(`<subtitle>${text}</subtitle>`);
        return index + 2;
      }
      case 'blockquote_open': {
        const close = this.matching(tokens, index);
        const inner: string[] = [];
        for (let k = index + 1; k < close; k += 1) {
          const type = tokens[k]!.type;
          if (type === 'blockquote_open' || type === 'blockquote_close') continue;
          k = this.block(tokens, k, (xml) => inner.push(xml), { ...ctx, inCite: true });
        }
        if (ctx.inCite) inner.forEach(out);
        else if (inner.length) out(`<cite>${inner.join('')}</cite>`);
        return close;
      }
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const close = this.matching(tokens, index);
        for (let k = index + 1; k < close; k += 1) {
          const item = tokens[k]!;
          if (item.type !== 'list_item_open') continue;
          const end = this.matching(tokens, k);
          const task = attrOf(item, 'class').includes('task-list-item');
          const marker = task
            ? ''
            : token.type === 'ordered_list_open'
              ? `${item.info}${item.markup}`
              : '\u2022';
          const holder = { marker, used: false };
          for (let m = k + 1; m < end; m += 1) {
            m = this.block(tokens, m, out, { ...ctx, depth: ctx.depth + 1, item: holder });
          }
          k = end;
        }
        return close;
      }
      case 'fence':
      case 'code_block': {
        const indent = ctx.depth > 1 ? LIST_INDENT.repeat(ctx.depth - 1) : '';
        const code: string[] = [];
        for (const line of token.content.replace(/\n$/, '').split('\n')) {
          const expanded = line.replace(/\t/g, '    ');
          if (!expanded.trim()) {
            code.push('<empty-line/>');
            continue;
          }
          const lead = /^ */.exec(expanded)![0].length;
          code.push(
            `<p>${indent}<code>${NBSP.repeat(lead)}${esc(expanded.slice(lead))}</code></p>`,
          );
        }
        // Feature 011 (D49): a Mermaid diagram becomes a picture - not in a quote or a note, where
        // FB2 has no block pictures.
        const language = token.type === 'fence' ? (token.info.trim().split(/\s+/)[0] ?? '') : '';
        if (language.toLowerCase() === 'mermaid' && !ctx.inCite && token.content.trim()) {
          const diagram = this.diagrams.length;
          const id = `mermaid-${diagram + 1}`;
          this.diagrams.push({
            index: diagram,
            id,
            source: token.content.replace(/\n$/, ''),
            imageXml: `<image l:href="#${id}" alt="${attr(this.options.diagramAlt ?? '')}"/>`,
            codeXml: code.join(''),
          });
          out(`<!--mfbe-diagram:${diagram}-->`);
          return index;
        }
        code.forEach(out);
        return index;
      }
      case 'hr':
        out('<subtitle>* * *</subtitle>');
        return index;
      case 'table_open':
        return this.table(tokens, index, out);
      case 'dl_open': {
        const close = this.matching(tokens, index);
        for (let k = index + 1; k < close; k += 1) {
          const part = tokens[k]!;
          if (part.type === 'dt_open') {
            const term = this.inline(tokens[k + 1]?.children ?? null).join(' ');
            out(`<p><strong>${term}</strong></p>`);
            k += 2;
          } else if (part.type === 'dd_open') {
            const end = this.matching(tokens, k);
            for (let m = k + 1; m < end; m += 1) m = this.block(tokens, m, out, ctx);
            k = end;
          }
        }
        return close;
      }
      case 'html_block':
        this.htmlBlock(token.content, out);
        return index;
      default:
        return index;
    }
  }

  private paragraph(children: Token[], out: (xml: string) => void, ctx: BlockContext): void {
    // Feature 011 (D18, D29): the export's empty line is a paragraph of a no-break space.
    if (
      children.length > 0 &&
      children.every((child) => child.type === 'text' && child.content === '\u00a0')
    ) {
      out('<empty-line/>');
      return;
    }
    // A styled paragraph (D45): its whole content in a span marked as the element's style.
    let style = this.divStyles[this.divStyles.length - 1] ?? '';
    const meaningful = children.filter(
      (child) => !(child.type === 'text' && !child.content.trim()),
    );
    const first = meaningful[0];
    const last = meaningful[meaningful.length - 1];
    const opening =
      first?.type === 'html_inline'
        ? /^<span class="([\w-]+)" data-fb2-style="element">$/.exec(first.content.trim())
        : null;
    if (
      opening &&
      last &&
      last !== first &&
      last.type === 'html_inline' &&
      last.content.trim() === '</span>'
    ) {
      style = opening[1]!;
      children = children.filter((child) => child !== first && child !== last);
    }
    const open = style ? `<p style="${attr(style)}">` : '<p>';
    const indent = ctx.depth > 1 ? LIST_INDENT.repeat(ctx.depth - 1) : '';
    let prefix = indent;
    if (ctx.item) {
      if (!ctx.item.used) {
        prefix += ctx.item.marker ? `${this.text(ctx.item.marker)} ` : '';
        ctx.item.used = true;
      } else {
        prefix += LIST_INDENT;
      }
    }
    let firstLine = true;
    for (const segment of this.inline(children)) {
      if (!segment.trim()) continue;
      out(`${open}${firstLine ? prefix : indent}${segment}</p>`);
      firstLine = false;
    }
  }

  private table(tokens: Token[], index: number, out: (xml: string) => void): number {
    const close = this.matching(tokens, index);
    const rows: string[] = [];
    let row: string[] | null = null;
    for (let k = index + 1; k < close; k += 1) {
      const token = tokens[k]!;
      if (token.type === 'tr_open') row = [];
      else if (token.type === 'tr_close') {
        // Feature 011 (D19, D29): the export's empty header row (a table without header cells).
        const empty = row?.every((cell) => /^<th[^>]*><\/th>$/.test(cell)) ?? false;
        if (row && !(empty && rows.length === 0)) rows.push(`<tr>${row.join('')}</tr>`);
        row = null;
      } else if (token.type === 'th_open' || token.type === 'td_open') {
        const tag = token.type === 'th_open' ? 'th' : 'td';
        const align = /text-align:\s*(left|center|right)/.exec(attrOf(token, 'style'))?.[1];
        const inline = tokens[k + 1];
        const content = inline?.type === 'inline' ? this.inline(inline.children).join(' ') : '';
        row?.push(`<${tag}${align ? ` align="${align}"` : ''}>${content}</${tag}>`);
        k += 2;
      }
    }
    this.stats.tables += 1;
    out(`<table>${rows.join('')}</table>`);
    return close;
  }

  private footnotes(tokens: Token[], index: number): number {
    const close = this.matching(tokens, index);
    for (let k = index + 1; k < close; k += 1) {
      const token = tokens[k]!;
      if (token.type !== 'footnote_open') continue;
      const end = this.matching(tokens, k);
      const n = Number((token.meta as { id?: number } | null)?.id ?? 0) + 1;
      const inner: string[] = [];
      for (let m = k + 1; m < end; m += 1) {
        m = this.block(tokens, m, (xml) => inner.push(xml), { inCite: true, depth: 0 });
      }
      this.notes.push(
        `<section id="n_${n}"><title><p>${n}</p></title>${inner.join('') || '<empty-line/>'}</section>`,
      );
      k = end;
    }
    return close;
  }

  /** The inline content as one or more paragraphs' XML (a hard break starts a new one). */
  private inline(children: readonly Token[] | null): string[] {
    const segments: string[] = [''];
    const open: { name: string; start: string }[] = [];
    const push = (xml: string) => {
      segments[segments.length - 1] += xml;
    };
    const sink: InlineSink = {
      push,
      openTag: (name, start) => {
        open.push({ name, start });
        push(start);
      },
      closeTag: (name) => {
        const at = open.map((o) => o.name).lastIndexOf(name);
        if (at < 0) return;
        for (let k = open.length - 1; k >= at; k -= 1) push(`</${open[k]!.name}>`);
        const reopen = open.slice(at + 1);
        open.length = at;
        for (const tag of reopen) {
          open.push(tag);
          push(tag.start);
        }
      },
      breakLine: () => {
        for (let k = open.length - 1; k >= 0; k -= 1) push(`</${open[k]!.name}>`);
        segments.push('');
        for (const tag of open) push(tag.start);
      },
    };
    for (const token of children ?? []) {
      switch (token.type) {
        case 'text':
          push(this.text(token.content));
          break;
        case 'code_inline':
          push(`<code>${esc(token.content)}</code>`);
          break;
        case 'softbreak':
          push(' ');
          break;
        case 'hardbreak':
          sink.breakLine();
          break;
        case 'em_open':
          sink.openTag('emphasis', '<emphasis>');
          break;
        case 'em_close':
          sink.closeTag('emphasis');
          break;
        case 'strong_open':
          sink.openTag('strong', '<strong>');
          break;
        case 'strong_close':
          sink.closeTag('strong');
          break;
        case 's_open':
          sink.openTag('strikethrough', '<strikethrough>');
          break;
        case 's_close':
          sink.closeTag('strikethrough');
          break;
        case 'sub_open':
          sink.openTag('sub', '<sub>');
          break;
        case 'sub_close':
          sink.closeTag('sub');
          break;
        case 'sup_open':
          sink.openTag('sup', '<sup>');
          break;
        case 'sup_close':
          sink.closeTag('sup');
          break;
        case 'link_open':
          sink.openTag('a', `<a l:href="${attr(this.href(attrOf(token, 'href')))}">`);
          break;
        case 'link_close':
          sink.closeTag('a');
          break;
        case 'image':
          push(this.image(token, false));
          break;
        case 'footnote_ref': {
          const n = Number((token.meta as { id?: number } | null)?.id ?? 0) + 1;
          push(`<a l:href="#n_${n}" type="note">[${n}]</a>`);
          break;
        }
        case 'html_inline':
          this.htmlInline(token.content, sink);
          break;
        default:
          if (token.content && token.type !== 'footnote_anchor') push(this.text(token.content));
      }
    }
    for (let k = open.length - 1; k >= 0; k -= 1) push(`</${open[k]!.name}>`);
    return segments;
  }

  /** Text with its special characters as pictures, dropped ones listed (D37). */
  private text(content: string): string {
    const text = content.includes(':') ? expandEmojiCodes(content) : content;
    if (isPlain(text)) return esc(text);
    let xml = '';
    for (const grapheme of graphemes(text)) {
      const treatment = treatmentOf(grapheme);
      if (treatment === 'keep') xml += esc(grapheme);
      else if (treatment === 'drop') this.note('droppedChar', codePoints(grapheme));
      else if (treatment !== 'invisible') {
        const char = specialChar(grapheme)!;
        this.chars.set(char.id, char);
        xml += `<image l:href="#${char.id}" alt="${attr(char.text)}"/>`;
      }
    }
    return xml;
  }

  private href(href: string): string {
    if (!href.startsWith('#')) return href;
    let target = href.slice(1);
    try {
      target = decodeURIComponent(target);
    } catch {
      // as written
    }
    const id = this.anchors.get(target) ?? this.anchors.get(target.toLowerCase());
    if (id) return `#${id}`;
    this.note('missingTarget', href);
    return href;
  }

  /** The href of a picture (D29): `#id` of a picture to add, a web address kept as written. */
  private pictureHref(src: string): string {
    const source = src.trim();
    if (!source) return '#undefined';
    if (/^https?:/i.test(source)) {
      this.note('webPicture', source);
      return source;
    }
    const known = this.pictureIds.get(source);
    if (known) return `#${known}`;
    let picture: MarkdownPicture;
    if (/^data:/i.test(source)) {
      const type = /^data:image\/([a-z0-9.+-]+)/i.exec(source)?.[1]?.toLowerCase() ?? 'png';
      const id = this.unique(`picture.${type === 'jpeg' ? 'jpg' : type.replace(/\+xml$/, '')}`);
      picture = { id, kind: 'data', data: source };
    } else {
      let path = source;
      if (/^file:/i.test(source)) {
        path = decodeURIComponent(source.replace(/^file:\/\//i, ''));
        if (/^\/[A-Za-z]:[\\/]/.test(path)) path = path.slice(1);
      } else {
        try {
          path = decodeURIComponent(source);
        } catch {
          // as written
        }
        if (!/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(path)) path = joinPath(this.options.baseDir, path);
      }
      const name = path.split(/[\\/]/).pop() ?? '';
      picture = { id: this.unique(idOf(name, 'picture')), kind: 'file', path };
    }
    this.pictureIds.set(source, picture.id);
    this.pictures.push(picture);
    return `#${picture.id}`;
  }

  private image(token: Token, block: boolean): string {
    this.stats.pictures += 1;
    const href = this.pictureHref(attrOf(token, 'src'));
    const alt = plainText(token.children) || token.content;
    const title = block ? attrOf(token, 'title') : '';
    return `<image l:href="${attr(href)}"${alt ? ` alt="${attr(alt)}"` : ''}${
      title ? ` title="${attr(title)}"` : ''
    }/>`;
  }

  private htmlInline(html: string, sink: InlineSink): void {
    if (/^<!--/.test(html)) return;
    const match = /^<(\/?)([a-zA-Z][\w-]*)([^>]*)>$/.exec(html.trim());
    if (!match) return;
    const closing = match[1] === '/';
    const name = match[2]!.toLowerCase();
    const attributes = match[3] ?? '';
    const attrValue = (key: string) =>
      new RegExp(`${key}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attributes);
    const value = (key: string) => {
      const found = attrValue(key);
      return found ? decodeEntities(found[2] ?? found[3] ?? found[4] ?? '') : '';
    };
    const styles: Record<string, string> = {
      b: 'strong',
      strong: 'strong',
      i: 'emphasis',
      em: 'emphasis',
      s: 'strikethrough',
      del: 'strikethrough',
      strike: 'strikethrough',
      sub: 'sub',
      sup: 'sup',
      code: 'code',
    };
    const style = styles[name];
    if (style) {
      if (closing) sink.closeTag(style);
      else sink.openTag(style, `<${style}>`);
    } else if (name === 'a') {
      if (closing) sink.closeTag('a');
      else sink.openTag('a', `<a l:href="${attr(this.href(value('href')))}">`);
    } else if (name === 'span') {
      // Feature 011 (US7, D45, D46): a span with a class is the named style of that name.
      if (closing) {
        if (this.spans.pop()) sink.closeTag('style');
      } else {
        const classes = value('class').split(/\s+/).filter(Boolean);
        this.spans.push(classes.length > 0);
        if (classes.length > 1) this.note('extraClass', classes.slice(1).join(' '));
        if (classes.length > 0) sink.openTag('style', `<style name="${attr(classes[0]!)}">`);
        // A span without a class carries nothing FB2 has: dropped and listed, as before.
        else this.note('htmlTag', name);
      }
    } else if (name === 'br') {
      sink.breakLine();
    } else if (name === 'img') {
      this.stats.pictures += 1;
      const alt = value('alt');
      sink.push(
        `<image l:href="${attr(this.pictureHref(value('src')))}"${alt ? ` alt="${attr(alt)}"` : ''}/>`,
      );
    } else if (name === 'input' && /checkbox/i.test(attributes)) {
      // A task list item's check box (D28): drawn, as readers' fonts may miss ☐ and ☑.
      // The item's text that follows begins with its own space.
      sink.push(this.text(/\bchecked\b/i.test(attributes) ? '\u2611' : '\u2610'));
    } else {
      this.note('htmlTag', name);
    }
  }

  private htmlBlock(html: string, out: (xml: string) => void): void {
    const content = html.replace(/<!--[\s\S]*?-->/g, '');
    if (!content.trim()) return;
    // Feature 011 (US7, D46): CSS in the text, and the classes of `<div>` blocks.
    const styles = [...content.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
    if (styles.length > 0) {
      for (const style of styles)
        this.textStyles.push({ type: 'text/css', text: style[1]!.trim(), foreign: true });
      return;
    }
    const div = /^\s*<div\s+class="([^"]+)"\s*>\s*$/i.exec(content);
    if (div) {
      const classes = div[1]!.split(/\s+/).filter(Boolean);
      if (classes.length > 1) this.note('extraClass', classes.slice(1).join(' '));
      this.divStyles.push(classes[0] ?? '');
      return;
    }
    if (/^\s*<\/div>\s*$/i.test(content)) {
      this.divStyles.pop();
      return;
    }
    if (/<table[\s>]/i.test(content)) {
      const rows: string[] = [];
      for (const row of content.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const cells: string[] = [];
        for (const cell of row[1]!.matchAll(/<(t[hd])([^>]*)>([\s\S]*?)<\/t[hd]>/gi)) {
          const tag = cell[1]!.toLowerCase();
          const align = /align\s*=\s*["']?(left|center|right)/i
            .exec(cell[2] ?? '')?.[1]
            ?.toLowerCase();
          const inline = this.md.parseInline(cell[3]!.replace(/<br\s*\/?>/gi, ' ').trim(), {})[0];
          const text = inline ? this.inline(inline.children).join(' ') : '';
          // Feature 011 (D19, D45): merged cells and the cells' named styles come back.
          const attrs = cell[2] ?? '';
          const span = (key: string) => {
            const value = Number(
              new RegExp(`${key}\\s*=\\s*["']?(\\d+)`, 'i').exec(attrs)?.[1] ?? 1,
            );
            return value > 1 ? ` ${key}="${value}"` : '';
          };
          const cls = /class\s*=\s*"([^"]+)"/i.exec(attrs)?.[1]?.split(/\s+/)[0];
          cells.push(
            `<${tag}${cls ? ` style="${attr(cls)}"` : ''}${span('colspan')}${span('rowspan')}${align ? ` align="${align}"` : ''}>${text}</${tag}>`,
          );
        }
        if (cells.length) rows.push(`<tr>${cells.join('')}</tr>`);
      }
      if (rows.length) {
        this.stats.tables += 1;
        const tableClass = /<table[^>]*class\s*=\s*"([^"]+)"/i.exec(content)?.[1]?.split(/\s+/)[0];
        out(`<table${tableClass ? ` style="${attr(tableClass)}"` : ''}>${rows.join('')}</table>`);
      }
      return;
    }
    for (const tag of content.matchAll(/<\/?([a-zA-Z][\w-]*)/g)) {
      const name = tag[1]!.toLowerCase();
      if (
        ![
          'b',
          'strong',
          'i',
          'em',
          's',
          'del',
          'strike',
          'sub',
          'sup',
          'code',
          'a',
          'img',
          'br',
          'p',
          'div',
          'span',
        ].includes(name)
      ) {
        this.note('htmlTag', name);
      }
    }
    for (const part of content.split(/<\/?(?:p|div|br)\b[^>]*>/i)) {
      const inline = this.md.parseInline(part.trim(), {})[0];
      if (!inline) continue;
      for (const segment of this.inline(inline.children)) {
        if (segment.replace(/<[^>]+>/g, '').trim() || segment.includes('<image'))
          out(`<p>${segment}</p>`);
      }
    }
  }
}

/** Converts a Markdown text (contracts/markdown-mapping.md). */
export function convertMarkdown(text: string, options: ConvertOptions): ConvertResult {
  return new Converter(options).run(text);
}
