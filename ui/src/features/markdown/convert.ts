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

import { frontList, frontText, readFrontMatter } from './frontMatter';
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

export type SummaryKind = 'webPicture' | 'missingTarget' | 'htmlTag' | 'droppedChar';

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
  summary: SummaryItem[];
  stats: { sections: number; pictures: number; tables: number; notes: number };
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
  private readonly summary: SummaryItem[] = [];
  private readonly summaryKeys = new Set<string>();
  private readonly notes: string[] = [];
  private readonly stats = { sections: 0, pictures: 0, tables: 0, notes: 0 };
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
    const { values, body } = readFrontMatter(text);
    const env: Record<string, unknown> = {};
    const tokens = this.md.parse(body, env);
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
      description: this.describe(values, titlePlain),
      pictures: this.pictures,
      chars: [...this.chars.values()],
      summary: this.summary,
      stats: this.stats,
    };
  }

  private describe(
    values: ReturnType<typeof readFrontMatter>['values'],
    headingTitle: string,
  ): MarkdownDescription {
    const title = frontText(values, 'title') || headingTitle.trim() || this.options.fileName;
    const sequenceName = frontText(values, 'series', 'sequence');
    const sequenceNumber = Number(frontText(values, 'series_index', 'number'));
    const annotation = frontText(values, 'description', 'summary', 'abstract');
    const keywords = frontList(values, 'keywords', 'tags');
    const cover = frontText(values, 'cover', 'image');
    const genres = frontList(values, 'genres', 'genre').filter(
      (code) => !this.options.genres || this.options.genres.has(code),
    );
    return {
      title,
      authors: frontList(values, 'authors', 'author').map(personOf),
      date: frontText(values, 'date') || undefined,
      lang: frontText(values, 'lang', 'language') || undefined,
      annotation: annotation
        ? annotation
            .split(/\n\s*\n/)
            .map((p) => p.trim())
            .filter(Boolean)
        : [],
      keywords: keywords.length ? keywords.join(', ') : undefined,
      sequence: sequenceName
        ? {
            name: sequenceName,
            number:
              Number.isInteger(sequenceNumber) && sequenceNumber > 0 ? sequenceNumber : undefined,
          }
        : undefined,
      cover: cover ? this.pictureHref(cover) : undefined,
      genres,
    };
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
        for (const line of token.content.replace(/\n$/, '').split('\n')) {
          const expanded = line.replace(/\t/g, '    ');
          if (!expanded.trim()) {
            out('<empty-line/>');
            continue;
          }
          const lead = /^ */.exec(expanded)![0].length;
          out(`<p>${indent}<code>${NBSP.repeat(lead)}${esc(expanded.slice(lead))}</code></p>`);
        }
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
    let first = true;
    for (const segment of this.inline(children)) {
      if (!segment.trim()) continue;
      out(`<p>${first ? prefix : indent}${segment}</p>`);
      first = false;
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
        if (row) rows.push(`<tr>${row.join('')}</tr>`);
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
          cells.push(`<${tag}${align ? ` align="${align}"` : ''}>${text}</${tag}>`);
        }
        if (cells.length) rows.push(`<tr>${cells.join('')}</tr>`);
      }
      if (rows.length) {
        this.stats.tables += 1;
        out(`<table>${rows.join('')}</table>`);
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
