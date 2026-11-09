/**
 * Feature 011 (US5, US6; D15-D20, D45; contracts/markdown-export.md §1-§5): the book's model as
 * Markdown - the reverse of feature 010's import wherever Markdown has a form. The interface writes
 * the text; the core writes the file or the ZIP and the pictures (`export.markdown`), so binaries
 * never travel through JSON: the text names each picture, and the list of pictures tells the core
 * which binary each name stands for.
 */

import type { ModelNodeJson } from '@/editor/fromModel';
import type { BinaryMeta, Document } from '@/model/document';

import { personName, writeFrontMatter } from './frontMatter';
import { pictureNames } from './pictureNames';

export interface ExportOptions {
  form: 'md' | 'zip';
  /** The one-file form's *Include pictures* (the ZIP form always carries them). */
  includePictures: boolean;
  /**
   * Feature 011 (D49): the Mermaid source each diagram picture carries, by binary id; such a
   * picture is written back as a ```mermaid block.
   */
  diagramSources?: ReadonlyMap<string, string>;
}

/** A fenced ```mermaid block of `source`, its fence longer than any run of backticks in it. */
export function mermaidBlock(source: string): string {
  const longest = Math.max(0, ...[...source.matchAll(/`+/g)].map((run) => run[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}mermaid\n${source.replace(/\n+$/, '')}\n${fence}`;
}

export interface LeftOut {
  kind: string;
  id?: string;
  reason: string;
}

export interface SerializedExport {
  text: string;
  /** Every picture the text names, with the binary it stands for, in the order of the text. */
  pictures: { binaryId: string; name: string }[];
  written: { sections: number; pictures: number; tables: number; notes: number };
  leftOut: LeftOut[];
}

interface Mark {
  type: string;
  attrs?: Record<string, unknown>;
}

/** The look a named style's CSS gives, which Markdown's own forms imitate (D45). */
interface StyleLook {
  italic: boolean;
  bold: boolean;
  strike: boolean;
  mono: boolean;
}

const NOTES_BODIES = new Set(['notes', 'comments']);

/** The looks of the class selectors of the book's CSS stylesheets. */
export function styleLooks(document: Pick<Document, 'stylesheets'>): Map<string, StyleLook> {
  const looks = new Map<string, StyleLook>();
  for (const sheet of document.stylesheets) {
    if (!/css/i.test(sheet.type)) continue;
    const css = sheet.content.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const rule of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const body = rule[2]!;
      const look: StyleLook = {
        italic: /font-style\s*:\s*(italic|oblique)/i.test(body),
        bold: /font-weight\s*:\s*(bold|bolder|[6-9]00)\b/i.test(body),
        strike: /text-decoration(-line)?\s*:[^;]*line-through/i.test(body),
        mono: /font-family\s*:[^;]*\bmonospace\b/i.test(body),
      };
      for (const selector of rule[1]!.split(',')) {
        const name = /^\s*\.([A-Za-z_][\w-]*)\s*$/.exec(selector)?.[1];
        if (!name) continue;
        const known = looks.get(name);
        looks.set(
          name,
          known
            ? {
                italic: known.italic || look.italic,
                bold: known.bold || look.bold,
                strike: known.strike || look.strike,
                mono: known.mono || look.mono,
              }
            : look,
        );
      }
    }
  }
  return looks;
}

/** Text Markdown would take for markup, escaped (D20). */
export function escapeInline(text: string): string {
  return text.replace(/[\\*_`[\]<&]/g, (ch) => `\\${ch}`);
}

/** A line's start Markdown would read as a block (a heading, a quote, a list, a rule), escaped. */
export function escapeLineStart(line: string): string {
  const ordered = /^(\s*)(\d+)([.)])(\s|$)/.exec(line);
  if (ordered) {
    return `${ordered[1]}${ordered[2]}\\${ordered[3]}${line.slice(ordered[0].length - ordered[4]!.length)}`;
  }
  return line.replace(/^(\s*)([#>+=-])/, '$1\\$2');
}

function codeSpan(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((run) => run[0].length));
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens. */
function slugOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

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

function plainText(node: ModelNodeJson): string {
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(plainText).join(node.type === 'title' ? ' ' : '');
}

class Writer {
  readonly pictures: { binaryId: string; name: string }[] = [];
  readonly leftOut: LeftOut[] = [];
  readonly counts = { sections: 0, pictures: 0, tables: 0, notes: 0 };
  private readonly names: Map<string, string>;
  private readonly binaries: Map<string, BinaryMeta>;
  private readonly picked = new Set<string>();
  private readonly looks: Map<string, StyleLook>;
  /** Footnote labels by the note's id, in the order of their first reference. */
  readonly footnotes = new Map<string, number>();
  /** The note sections of the notes bodies, by id. */
  readonly notes = new Map<string, ModelNodeJson>();
  /** Heading anchors by section id (`id` attribute and node id). */
  readonly anchors = new Map<string, string>();

  constructor(
    readonly document: Document,
    readonly options: ExportOptions,
  ) {
    this.binaries = new Map(document.binaries.map((binary) => [binary.id, binary]));
    this.names = pictureNames(
      document.binaries.map((binary) => ({ id: binary.id, contentType: binary.contentType })),
      options.form,
    );
    this.looks = styleLooks(document);
  }

  get withPictures(): boolean {
    return this.options.form === 'zip' || this.options.includePictures;
  }

  /** The reference of a picture in the text, or null when it is not exported. */
  pictureTarget(href: string, id?: string): string | null {
    const binaryId = href.replace(/^#/, '');
    if (!href.startsWith('#') || !this.binaries.has(binaryId)) {
      this.leftOut.push({ kind: 'picture', id, reason: href ? 'external' : 'empty' });
      return null;
    }
    if (!this.withPictures) return null;
    const name = this.names.get(binaryId)!;
    if (!this.picked.has(binaryId)) {
      this.picked.add(binaryId);
      this.pictures.push({ binaryId, name });
      this.counts.pictures += 1;
    }
    return name;
  }

  picture(node: ModelNodeJson): string {
    const href = String(node.attrs?.href ?? '');
    const chars = characterPicture(href);
    if (chars !== null) return chars;
    const target = this.pictureTarget(href, node.attrs?.nodeId as string | undefined);
    if (!target) return '';
    const alt = escapeInline(String(node.attrs?.alt ?? ''));
    const title = String(node.attrs?.title ?? '');
    if (this.options.form === 'md') return `![${alt}][${target}]`;
    const quoted = title ? ` "${title.replace(/"/g, '\\"')}"` : '';
    return `![${alt}](images/${encodeURI(target)}${quoted})`;
  }

  noteLabel(id: string): number {
    let label = this.footnotes.get(id);
    if (label === undefined) {
      label = this.footnotes.size + 1;
      this.footnotes.set(id, label);
    }
    return label;
  }

  run(text: string, marks: readonly Mark[]): string {
    const lead = /^\s*/.exec(text)![0];
    const rest = text.slice(lead.length);
    const trail = /\s*$/.exec(rest)![0];
    const inner = rest.slice(0, rest.length - trail.length);
    if (!inner) return text;
    const has = (type: string) => marks.find((mark) => mark.type === type);
    const link = has('link');
    if (link) {
      const href = String(link.attrs?.href ?? '');
      const id = href.replace(/^#/, '');
      if (link.attrs?.type === 'note' || this.notes.has(id)) {
        return `${lead}[^${this.noteLabel(id)}]${trail}`;
      }
    }
    let out = has('code') ? codeSpan(inner) : escapeInline(inner);
    if (has('strikethrough')) out = `~~${out}~~`;
    if (has('emphasis')) out = `*${out}*`;
    if (has('strong')) out = `**${out}**`;
    if (has('sub')) out = `<sub>${out}</sub>`;
    if (has('sup')) out = `<sup>${out}</sup>`;
    if (link) {
      const href = String(link.attrs?.href ?? '');
      const target = href.startsWith('#')
        ? `#${this.anchors.get(href.slice(1)) ?? href.slice(1)}`
        : href;
      out = `[${out}](${target.replace(/[()\s]/g, (ch) => encodeURIComponent(ch))})`;
    }
    for (const style of marks.filter((mark) => mark.type === 'style').reverse()) {
      out = this.styled(String(style.attrs?.name ?? ''), out);
    }
    return `${lead}${out}${trail}`;
  }

  /** A named style's text: its class, and Markdown's forms of its look inside (D45). */
  styled(name: string, inner: string, element = false): string {
    if (!name) return inner;
    const look = this.looks.get(name);
    let out = inner;
    if (look?.mono && !out.startsWith('`')) out = codeSpan(out);
    if (look?.strike) out = `~~${out}~~`;
    if (look?.italic) out = `*${out}*`;
    if (look?.bold) out = `**${out}**`;
    const mark = element ? ' data-fb2-style="element"' : '';
    return `<span class="${name.replace(/"/g, '')}"${mark}>${out}</span>`;
  }

  inline(nodes: readonly ModelNodeJson[]): string {
    let out = '';
    let pending: { text: string; marks: Mark[] } | null = null;
    const same = (a: readonly Mark[], b: readonly Mark[]) =>
      a.length === b.length && a.every((mark, i) => JSON.stringify(mark) === JSON.stringify(b[i]));
    const flush = () => {
      if (pending) out += this.run(pending.text, pending.marks);
      pending = null;
    };
    for (const node of nodes) {
      if (node.type === 'text') {
        const marks = (node.marks ?? []) as Mark[];
        if (pending && same(pending.marks, marks)) pending.text += node.text ?? '';
        else {
          flush();
          pending = { text: node.text ?? '', marks: [...marks] };
        }
      } else if (node.type === 'inline-image') {
        flush();
        out += this.picture(node);
      } else if (node.type === 'raw-xml-inline' || node.type === 'raw-xml') {
        flush();
        this.leftOut.push({ kind: 'raw-xml', reason: 'unknown inline element' });
      } else {
        flush();
        out += this.inline(node.content ?? []);
      }
    }
    flush();
    return out;
  }

  /** A text block's line, its start escaped; a styled element wraps it (D45). */
  textLine(node: ModelNodeJson): string {
    let line = escapeLineStart(this.inline(node.content ?? []));
    const style = node.attrs?.style;
    if (typeof style === 'string' && style) line = this.styled(style, line, true);
    return line;
  }

  /** Whether a paragraph is code from end to end (D18: such paragraphs make one code block). */
  isCodeParagraph(node: ModelNodeJson): boolean {
    const content = node.content ?? [];
    return (
      node.type === 'p' &&
      content.length > 0 &&
      content.every(
        (child) =>
          child.type === 'text' &&
          (child.marks ?? []).length === 1 &&
          (child.marks as Mark[])[0]!.type === 'code',
      )
    );
  }

  titleLines(title: ModelNodeJson): string {
    return (title.content ?? [])
      .filter((child) => child.type !== 'empty-line')
      .map((line) => this.inline(line.content ?? []).trim())
      .filter(Boolean)
      .join('<br>');
  }

  quote(blocks: readonly string[]): string {
    return blocks
      .join('\n\n')
      .split('\n')
      .map((line) => (line ? `> ${line}` : '>'))
      .join('\n');
  }

  /** The Markdown blocks of `nodes` (the content of a section, a quote, an annotation…). */
  blocks(nodes: readonly ModelNodeJson[], level: number): string[] {
    const out: string[] = [];
    let code: string[] | null = null;
    const endCode = () => {
      if (code) out.push(['```', ...code, '```'].join('\n'));
      code = null;
    };
    for (const node of nodes) {
      if (this.isCodeParagraph(node)) {
        (code ??= []).push(plainText(node));
        continue;
      }
      endCode();
      switch (node.type) {
        case 'p':
        case 'v':
          out.push(this.textLine(node));
          break;
        case 'text-author':
        case 'date':
          out.push(`*${this.inline(node.content ?? []).trim()}*`);
          break;
        case 'empty-line':
          out.push('\u00a0');
          break;
        case 'subtitle': {
          const text = plainText(node).trim();
          out.push(
            /^[\s*⁂]+$/.test(text) && text.length > 0
              ? '---'
              : `**${this.inline(node.content ?? []).trim()}**`,
          );
          break;
        }
        case 'image': {
          const source = this.options.diagramSources?.get(
            String(node.attrs?.href ?? '').replace(/^#/, ''),
          );
          if (source !== undefined) {
            out.push(mermaidBlock(source));
            break;
          }
          const picture = this.picture(node);
          if (picture) out.push(picture);
          break;
        }
        case 'title':
          out.push(`**${this.titleLines(node)}**`);
          break;
        case 'epigraph':
        case 'cite':
        case 'annotation':
          out.push(this.quote(this.blocks(node.content ?? [], level)));
          break;
        case 'poem':
          out.push(...this.poem(node));
          break;
        case 'table':
          out.push(this.table(node));
          break;
        case 'section':
          out.push(...this.section(node, level + 1));
          break;
        case 'raw-xml':
          this.leftOut.push({ kind: 'raw-xml', reason: 'unknown element' });
          break;
        default:
          out.push(...this.blocks(node.content ?? [], level));
      }
    }
    endCode();
    return out.filter((block) => block !== '');
  }

  poem(node: ModelNodeJson): string[] {
    const out: string[] = [];
    for (const child of node.content ?? []) {
      if (child.type === 'title') out.push(`**${this.titleLines(child)}**`);
      else if (child.type === 'epigraph') out.push(this.quote(this.blocks(child.content ?? [], 0)));
      else if (child.type === 'stanza') {
        const lines: string[] = [];
        for (const verse of child.content ?? []) {
          if (verse.type === 'title') out.push(`**${this.titleLines(verse)}**`);
          else if (verse.type === 'subtitle')
            lines.push(`**${this.inline(verse.content ?? []).trim()}**`);
          else lines.push(this.textLine(verse));
        }
        if (lines.length > 0) out.push(lines.join('  \n'));
      } else if (child.type === 'text-author' || child.type === 'date') {
        out.push(`*${this.inline(child.content ?? []).trim()}*`);
      }
    }
    return out;
  }

  cellText(cell: ModelNodeJson): string {
    return this.inline(cell.content ?? [])
      .replace(/\|/g, '\\|')
      .replace(/\n/g, ' ')
      .trim();
  }

  table(node: ModelNodeJson): string {
    this.counts.tables += 1;
    const rows = (node.content ?? []).filter((row) => row.type === 'tr');
    const cells = rows.map((row) =>
      (row.content ?? []).filter((c) => c.type === 'th' || c.type === 'td'),
    );
    const span = (cell: ModelNodeJson, key: string) => Number(cell.attrs?.[key] ?? 1) || 1;
    const styled =
      !!node.attrs?.style || cells.some((row) => row.some((cell) => !!cell.attrs?.style));
    const merged = cells.some((row) =>
      row.some((cell) => span(cell, 'colspan') > 1 || span(cell, 'rowspan') > 1),
    );
    if (merged || styled) return this.htmlTable(node, cells);
    const width = Math.max(1, ...cells.map((row) => row.length));
    const pad = (row: string[]) => [...row, ...Array<string>(width - row.length).fill('')];
    const header = cells[0] && cells[0].every((cell) => cell.type === 'th') ? cells[0] : null;
    const body = header ? cells.slice(1) : cells;
    const line = (row: string[]) => `| ${pad(row).join(' | ')} |`;
    const alignOf = (column: number) => {
      const aligns = cells.map((row) => row[column]?.attrs?.align).filter((a) => a !== undefined);
      return aligns.length === cells.length && aligns.every((a) => a === aligns[0])
        ? aligns[0]
        : undefined;
    };
    const rule = Array.from({ length: width }, (_, column) => {
      const align = alignOf(column);
      return align === 'center'
        ? ':---:'
        : align === 'right'
          ? '---:'
          : align === 'left'
            ? ':---'
            : '---';
    });
    const out = [
      line(header ? header.map((cell) => this.cellText(cell)) : []),
      `| ${rule.join(' | ')} |`,
    ];
    for (const row of body) {
      out.push(
        line(
          row.map((cell) =>
            cell.type === 'th' ? `**${this.cellText(cell)}**` : this.cellText(cell),
          ),
        ),
      );
    }
    return out.join('\n');
  }

  htmlInline(nodes: readonly ModelNodeJson[]): string {
    const escape = (text: string) =>
      text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let out = '';
    for (const node of nodes) {
      if (node.type === 'text') {
        let text = escape(node.text ?? '');
        for (const mark of ((node.marks ?? []) as Mark[]).slice().reverse()) {
          const tag = {
            strong: 'strong',
            emphasis: 'em',
            strikethrough: 's',
            sub: 'sub',
            sup: 'sup',
            code: 'code',
          }[mark.type];
          if (tag) text = `<${tag}>${text}</${tag}>`;
          else if (mark.type === 'link')
            text = `<a href="${escape(String(mark.attrs?.href ?? ''))}">${text}</a>`;
          else if (mark.type === 'style')
            text = `<span class="${escape(String(mark.attrs?.name ?? ''))}">${text}</span>`;
        }
        out += text;
      } else if (node.type === 'inline-image' || node.type === 'image') {
        const href = String(node.attrs?.href ?? '');
        const chars = characterPicture(href);
        if (chars !== null) out += escape(chars);
        else {
          const target = this.pictureTarget(href, node.attrs?.nodeId as string | undefined);
          if (target && this.options.form === 'zip')
            out += `<img src="images/${encodeURI(target)}" alt="${escape(String(node.attrs?.alt ?? ''))}">`;
          else if (target)
            this.leftOut.push({ kind: 'picture', reason: 'in an HTML table of the one-file form' });
        }
      } else out += this.htmlInline(node.content ?? []);
    }
    return out;
  }

  htmlTable(node: ModelNodeJson, cells: ModelNodeJson[][]): string {
    const attr = (name: string, value: unknown) =>
      value === undefined || value === null || value === ''
        ? ''
        : ` ${name}="${String(value).replace(/"/g, '&quot;')}"`;
    const lines = [`<table${attr('class', node.attrs?.style)}>`];
    for (const row of cells) {
      const parts = row.map((cell) => {
        const tag = cell.type;
        const attrs =
          attr('class', cell.attrs?.style) +
          attr('colspan', Number(cell.attrs?.colspan ?? 1) > 1 ? cell.attrs?.colspan : undefined) +
          attr('rowspan', Number(cell.attrs?.rowspan ?? 1) > 1 ? cell.attrs?.rowspan : undefined) +
          attr('align', cell.attrs?.align);
        return `<${tag}${attrs}>${this.htmlInline(cell.content ?? [])}</${tag}>`;
      });
      lines.push(`<tr>${parts.join('')}</tr>`);
    }
    lines.push('</table>');
    return lines.join('\n');
  }

  section(node: ModelNodeJson, level: number): string[] {
    this.counts.sections += 1;
    const content = node.content ?? [];
    const title = content.find((child) => child.type === 'title');
    const heading = '#'.repeat(Math.min(6, level));
    const text = title ? this.titleLines(title) : '';
    const out = [text ? `${heading} ${text}` : heading];
    out.push(
      ...this.blocks(
        content.filter((child) => child !== title),
        level,
      ),
    );
    return out;
  }

  /** Heading anchors of the sections with titles, as GitHub makes them (D17). */
  collectAnchors(): void {
    const used = new Map<string, number>();
    const visit = (node: ModelNodeJson) => {
      if (node.type === 'section') {
        const title = (node.content ?? []).find((child) => child.type === 'title');
        const base = title ? slugOf(plainText(title)) : '';
        if (base) {
          const seen = used.get(base) ?? 0;
          used.set(base, seen + 1);
          const slug = seen === 0 ? base : `${base}-${seen}`;
          for (const key of [node.attrs?.id, node.attrs?.nodeId]) {
            if (typeof key === 'string' && key) this.anchors.set(key, slug);
          }
        }
      }
      for (const child of node.content ?? []) if (child.type !== 'text') visit(child);
    };
    for (const body of this.document.bodies) visit(body as unknown as ModelNodeJson);
  }

  collectNotes(): void {
    for (const body of this.document.bodies) {
      const json = body as unknown as ModelNodeJson;
      if (!NOTES_BODIES.has(String(json.attrs?.name ?? ''))) continue;
      for (const child of json.content ?? []) {
        if (child.type !== 'section') continue;
        for (const key of [child.attrs?.id, child.attrs?.nodeId]) {
          if (typeof key === 'string' && key) this.notes.set(key, child);
        }
      }
    }
  }

  /** A note's text as a footnote definition (its title is the note's number: left out). */
  footnote(label: number, note: ModelNodeJson): string {
    const blocks = this.blocks(
      (note.content ?? []).filter((child) => child.type !== 'title'),
      1,
    );
    const [first = '', ...rest] = blocks;
    return [
      `[^${label}]: ${first}`,
      ...rest.map((block) =>
        block
          .split('\n')
          .map((line) => `    ${line}`)
          .join('\n'),
      ),
    ].join('\n\n');
  }
}

/** The title page of D16: the title, each series with its number, the authors, a rule. */
function titlePage(document: Document): string[] {
  const info = document.description.titleInfo;
  const out: string[] = [];
  if (info.bookTitle.trim()) out.push(`# ${escapeInline(info.bookTitle.trim())}`);
  for (const sequence of info.sequences) {
    if (!sequence.name.trim()) continue;
    const number = sequence.number !== undefined ? ` #${sequence.number}` : '';
    out.push(`*${escapeInline(sequence.name.trim())}${number}*`);
  }
  const authors = info.authors.map(personName).filter(Boolean);
  if (authors.length > 0) out.push(`**${escapeInline(authors.join(', '))}**`);
  if (out.length > 0) out.push('---');
  return out;
}

/** The book as Markdown, with the pictures it names and what it could not carry (D25). */
export function serializeMarkdown(document: Document, options: ExportOptions): SerializedExport {
  const writer = new Writer(document, options);
  writer.collectAnchors();
  writer.collectNotes();
  const blocks: string[] = [];
  const cover = document.description.titleInfo.coverpage[0];
  let coverName: string | undefined;
  if (cover && writer.withPictures) {
    const target = writer.pictureTarget(cover.href);
    if (target) {
      coverName = options.form === 'zip' ? `images/${target}` : target;
      blocks.push(
        options.form === 'md' ? `![cover][${target}]` : `![cover](images/${encodeURI(target)})`,
      );
    }
  }
  blocks.push(...titlePage(document));
  const textBodies = document.bodies.filter(
    (body) => !NOTES_BODIES.has(String((body as unknown as ModelNodeJson).attrs?.name ?? '')),
  );
  textBodies.forEach((body, index) => {
    const json = body as unknown as ModelNodeJson;
    const content = json.content ?? [];
    const title = content.find((child) => child.type === 'title');
    const name = String(json.attrs?.name ?? '');
    const heading = title ? writer.titleLines(title) : index > 0 ? escapeInline(name) : '';
    if (heading) blocks.push(`# ${heading}`);
    blocks.push(
      ...writer.blocks(
        content.filter((child) => child !== title),
        1,
      ),
    );
  });
  // Notes: the referenced ones as footnotes, the others under the notes' title (D18).
  const definitions: string[] = [];
  const unreferenced: ModelNodeJson[] = [];
  const seen = new Set<ModelNodeJson>();
  for (const [id, label] of writer.footnotes) {
    const note = writer.notes.get(id);
    if (!note || seen.has(note)) continue;
    seen.add(note);
    definitions.push(writer.footnote(label, note));
    writer.counts.notes += 1;
  }
  for (const note of new Set(writer.notes.values())) if (!seen.has(note)) unreferenced.push(note);
  if (unreferenced.length > 0) {
    const notesBody = document.bodies.find((body) =>
      NOTES_BODIES.has(String((body as unknown as ModelNodeJson).attrs?.name ?? '')),
    ) as unknown as ModelNodeJson | undefined;
    const title = notesBody?.content?.find((child) => child.type === 'title');
    blocks.push(`# ${title ? writer.titleLines(title) : 'Notes'}`);
    for (const note of unreferenced) {
      blocks.push(...writer.section(note, 2));
      writer.counts.notes += 1;
    }
  }
  const annotation = document.description.titleInfo.annotation;
  const history = document.description.documentInfo.history;
  const frontMatter = writeFrontMatter({
    description: document.description,
    stylesheets: document.stylesheets,
    annotation: annotation
      ? writer.blocks((annotation as unknown as ModelNodeJson).content ?? [], 0).join('\n\n')
      : '',
    history: history
      ? writer.blocks((history as unknown as ModelNodeJson).content ?? [], 0).join('\n\n')
      : '',
    cover: coverName,
  });
  const text = `${frontMatter}\n${blocks.join('\n\n')}\n${definitions.length > 0 ? `\n${definitions.join('\n\n')}\n` : ''}`;
  return { text, pictures: writer.pictures, written: writer.counts, leftOut: writer.leftOut };
}
