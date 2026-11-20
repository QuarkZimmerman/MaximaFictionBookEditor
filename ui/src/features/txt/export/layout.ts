/**
 * Feature 017 (D4 to D9; contracts/txt-format.md): the book laid out as plain text - the title page,
 * the bodies with each note's block after the block that first refers to it, the notes nothing
 * refers to, and the record. Lines are joined by "\n"; the core writes them with CR LF (DP-4).
 */

import type {
  AnnotationNode,
  BodyNode,
  CiteNode,
  Document,
  EpigraphNode,
  InlineNode,
  Mark,
  PoemNode,
  SectionNode,
  StanzaNode,
  TableNode,
  TitleNode,
} from '@/model/document';

import { txtWords, type TxtWords } from '../shared/words';
import { LINE_WIDTH, recordLines, type RecordLists, titlePageHead } from './record';

export interface TxtLayout {
  text: string;
  /** The book had no title; the file's name stood in for it (D16). */
  missingTitle: boolean;
}

type Out = string | { blank: number };
type AnyNode = { type: string; content?: unknown; attrs?: Record<string, unknown> };

const NOTES_BODY = /^(notes|comments)$/i;

/** The characters of a picture the Markdown import made of special characters (`#ch-1f600`). */
function characterPicture(href: string): string | null {
  const match = /^#ch-([0-9a-f]+(?:-[0-9a-f]+)*)$/i.exec(href);
  if (!match) return null;
  try {
    return String.fromCodePoint(...match[1]!.split('-').map((hex) => parseInt(hex, 16)));
  } catch {
    return null;
  }
}

const linkOf = (marks: readonly Mark[] | undefined) =>
  marks?.find((m): m is Extract<Mark, { type: 'link' }> => m.type === 'link');

/**
 * A paragraph break inside raw XML: the editor keeps what the schema does not allow - a <p> nested in a <p>, as
 * books of the corpus have - as raw XML, and each paragraph in it is a line of its own (D7), its words never run
 * together with the next one's. Writer.line breaks the line there.
 */
const RAW_BREAK = '\u2029';
/** The elements of FB2 that are blocks: their tags end a line in raw XML. */
const RAW_BLOCKS =
  /<\/?(?:p|v|subtitle|title|text-author|date|section|poem|stanza|cite|epigraph|annotation|table|tr|empty-line)\b[^>]*>/g;

/** The text of raw XML: its tags dropped, its blocks on lines of their own, its formatting spaces collapsed. */
const rawText = (xml: string): string =>
  xml
    .replace(RAW_BLOCKS, RAW_BREAK)
    .replace(/<\/?t[dh]\b[^>]*>/g, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/[ \t\r\n]+/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

class Writer {
  readonly out: Out[] = [];
  /** Notes referred to by the block being written, in order, not yet written. */
  pending: string[] = [];
  readonly written = new Set<string>();
  /** The label of each note: its first reference's text without brackets. */
  readonly labels = new Map<string, string>();

  constructor(
    readonly notes: ReadonlyMap<string, SectionNode>,
    readonly words: TxtWords,
  ) {}

  line(text: string): void {
    if (!text.includes(RAW_BREAK)) {
      this.out.push(text.replace(/[\r\n]+/g, ' '));
      return;
    }
    // Raw XML's paragraphs, each on its own line (RAW_BREAK).
    for (const piece of text.split(RAW_BREAK)) {
      const line = piece.replace(/[\r\n]+/g, ' ').trim();
      if (line) this.out.push(line);
    }
  }

  blank(n = 1): void {
    this.out.push({ blank: n });
  }

  /** The text of inline content: styles dropped, links and note references as D7 and D8 say. */
  inline(content: readonly InlineNode[]): string {
    let text = '';
    for (let i = 0; i < content.length;) {
      const node = content[i]!;
      const link = 'marks' in node ? linkOf(node.marks) : undefined;
      if (link) {
        // The run of nodes under one link.
        let j = i;
        let linked = '';
        while (j < content.length) {
          const other = content[j]!;
          const otherLink = 'marks' in other ? linkOf(other.marks) : undefined;
          if (!otherLink || otherLink.attrs.href !== link.attrs.href) break;
          linked += this.inline([{ ...other, marks: undefined } as InlineNode]);
          j++;
        }
        text += this.linkText(link, linked);
        i = j;
        continue;
      }
      if (node.type === 'text') text += node.text;
      else if (node.type === 'inline-image') {
        const chars = characterPicture(node.attrs.href);
        text +=
          chars ??
          (node.attrs.alt ? `[${this.words.image}: ${node.attrs.alt}]` : `[${this.words.image}]`);
      } else if (node.type === 'raw-xml') text += rawText(node.attrs.xml);
      i++;
    }
    return text;
  }

  linkText(link: Extract<Mark, { type: 'link' }>, text: string): string {
    const href = link.attrs.href;
    const id = href.startsWith('#') ? href.slice(1) : '';
    if (id && (link.attrs.type === 'note' || this.notes.has(id)) && this.notes.has(id)) {
      const label = text.trim().replace(/^\[(.*)\]$/, '$1') || id;
      if (!this.labels.has(id)) this.labels.set(id, label);
      if (!this.written.has(id) && !this.pending.includes(id)) this.pending.push(id);
      return `[${label}]`;
    }
    if (href.startsWith('#')) return text;
    return text.trim() === href ? `<${href}>` : `${text} <${href}>`;
  }

  /** The note blocks the block just written refers to (D8). */
  flushNotes(): void {
    while (this.pending.length) {
      const id = this.pending.shift()!;
      if (this.written.has(id)) continue;
      this.noteBlock(id);
    }
  }

  noteBlock(id: string): void {
    const note = this.notes.get(id);
    if (!note) return;
    this.written.add(id);
    const label = this.labels.get(id) ?? noteTitle(note) ?? id;
    const middle = ` ${this.words.note} ${label} `;
    const left = Math.max(2, Math.floor((LINE_WIDTH - middle.length) / 2));
    const right = Math.max(2, LINE_WIDTH - middle.length - left);
    const outer = this.pending;
    this.pending = [];
    this.blank();
    this.line(`${'-'.repeat(left)}${middle}${'-'.repeat(right)}`);
    for (const child of note.content)
      if (child.type !== 'title') this.block(child as AnyNode, false);
    this.line('-'.repeat(LINE_WIDTH));
    this.blank();
    // Notes this note refers to follow its block.
    const inner = this.pending;
    this.pending = outer;
    for (const other of inner) if (!this.written.has(other)) this.noteBlock(other);
  }

  title(node: TitleNode, before = 1): void {
    this.blank(before);
    for (const p of node.content) if (p.type === 'p') this.line(this.inline(p.content));
    this.blank();
  }

  epigraph(node: EpigraphNode): void {
    this.blank();
    for (const child of node.content) this.block(child as AnyNode, false);
    this.blank();
  }

  poem(node: PoemNode): void {
    this.blank();
    for (const child of node.content) {
      if (child.type === 'title') this.title(child);
      else if (child.type === 'epigraph') this.epigraph(child);
      else if (child.type === 'stanza') this.stanza(child);
      else this.block(child as AnyNode, false);
    }
    this.blank();
  }

  stanza(node: StanzaNode): void {
    this.blank();
    for (const child of node.content) {
      if (child.type === 'title') this.title(child);
      else if (child.type === 'subtitle') this.line(this.inline(child.content));
      else this.line(this.inline(child.content));
    }
    this.blank();
  }

  table(node: TableNode): void {
    this.blank();
    for (const row of node.content)
      this.line(row.content.map((cell) => this.inline(cell.content)).join('\t'));
    this.blank();
  }

  /** One block of a section, an epigraph, a cite or an annotation; `top`: flush its notes after it. */
  block(node: AnyNode, top: boolean): void {
    switch (node.type) {
      case 'p':
      case 'text-author':
      case 'v':
        this.line(this.inline((node.content as InlineNode[]) ?? []));
        break;
      case 'date':
        this.line(this.inline((node.content as InlineNode[]) ?? []));
        break;
      case 'subtitle':
        this.blank();
        this.line(this.inline((node.content as InlineNode[]) ?? []));
        this.blank();
        break;
      case 'empty-line':
        this.blank();
        break;
      case 'poem':
        this.poem(node as unknown as PoemNode);
        break;
      case 'stanza':
        this.stanza(node as unknown as StanzaNode);
        break;
      case 'cite':
        this.blank();
        for (const child of (node as unknown as CiteNode).content)
          this.block(child as AnyNode, false);
        this.blank();
        break;
      case 'table':
        this.table(node as unknown as TableNode);
        break;
      case 'image': {
        const attrs = (node.attrs ?? {}) as { alt?: string; title?: string };
        const caption = attrs.alt?.trim() || attrs.title?.trim();
        this.line(caption ? `[${this.words.image}: ${caption}]` : `[${this.words.image}]`);
        break;
      }
      case 'epigraph':
        this.epigraph(node as unknown as EpigraphNode);
        break;
      case 'title':
        this.title(node as unknown as TitleNode);
        break;
      case 'annotation':
        for (const child of (node as unknown as AnnotationNode).content)
          this.block(child as AnyNode, false);
        break;
      case 'raw-xml': {
        const text = rawText(String(node.attrs?.xml ?? '')).trim();
        if (text) this.line(text);
        break;
      }
      case 'section':
        this.section(node as unknown as SectionNode, false);
        break;
      default:
        break;
    }
    if (top) this.flushNotes();
  }

  section(node: SectionNode, topLevel: boolean): void {
    this.blank(topLevel ? 2 : 1);
    for (const child of node.content) {
      if (child.type === 'title') {
        this.title(child, topLevel ? 2 : 1);
        this.flushNotes();
      } else if (child.type === 'section') this.section(child, false);
      else this.block(child as AnyNode, true);
    }
  }

  body(node: BodyNode): void {
    for (const child of node.content) {
      if (child.type === 'section') this.section(child, true);
      else if (child.type === 'title') {
        this.title(child, 2);
        this.flushNotes();
      } else this.block(child as AnyNode, true);
    }
  }
}

function noteTitle(note: SectionNode): string | undefined {
  const title = note.content.find((c): c is TitleNode => c.type === 'title');
  const text = title?.content
    .map((p) =>
      p.type === 'p' ? p.content.map((n) => (n.type === 'text' ? n.text : '')).join('') : '',
    )
    .join(' ')
    .trim();
  return text || undefined;
}

/** Joins the lines: at most two blank lines in a row, none at the ends of a part. */
function render(out: readonly Out[]): string[] {
  const lines: string[] = [];
  let blanks = 0;
  for (const item of out) {
    if (typeof item !== 'string') {
      blanks = Math.max(blanks, item.blank);
      continue;
    }
    if (lines.length) for (let k = 0; k < Math.min(2, blanks); k++) lines.push('');
    blanks = 0;
    lines.push(item);
  }
  return lines;
}

/** The book as TXT (contracts/txt-format.md). `fileStem` stands in for a missing title. */
export function layoutTxt(
  document: Document,
  lists: RecordLists,
  fileStem: string,
  version: string,
): TxtLayout {
  const description = document.description;
  const words = txtWords(description.titleInfo.lang);
  const bookTitle = description.titleInfo.bookTitle.trim();
  const title = bookTitle || fileStem;
  const notes = new Map<string, SectionNode>();
  for (const body of document.bodies) {
    if (!NOTES_BODY.test(body.attrs.name ?? '')) continue;
    const walk = (content: readonly AnyNode[]): void => {
      for (const child of content)
        if (child.type === 'section') {
          const section = child as unknown as SectionNode;
          if (section.attrs.id) notes.set(section.attrs.id, section);
          walk(section.content as AnyNode[]);
        }
    };
    walk(body.content as AnyNode[]);
  }
  // The title page (D4).
  const page = new Writer(notes, words);
  for (const line of titlePageHead(description, title)) page.line(line);
  if (description.titleInfo.annotation) {
    page.blank();
    for (const child of description.titleInfo.annotation.content)
      page.block(child as AnyNode, false);
  }
  page.pending = [];
  // The text (D6 to D9), then the notes nothing referred to (D8).
  const text = new Writer(notes, words);
  for (const body of document.bodies) if (!NOTES_BODY.test(body.attrs.name ?? '')) text.body(body);
  text.flushNotes();
  for (const [id, note] of notes) {
    if (text.written.has(id)) continue;
    text.labels.set(id, noteTitle(note) ?? id);
    text.noteBlock(id);
  }
  const lines = [
    ...render(page.out),
    '',
    '',
    ...render(text.out),
    '',
    '',
    ...recordLines(description, lists, title, version),
  ];
  return { text: `${lines.join('\n')}\n`, missingTitle: !bookTitle };
}
