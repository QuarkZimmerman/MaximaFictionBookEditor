/**
 * Feature 012 (US2; D18-D22; contracts/epub-import.md §2, §3, §7): the pages of an EPUB as the FB2
 * body and its notes. The reading order gives the text's order; headings give the sections by their
 * levels relative to each other, the table of contents titles the pages that have no heading; a cover
 * page and a title page that only repeat the description are not repeated as text. EPUB 3's and
 * EPUB 2's notes (and InDesign's) become FB2 notes; links inside the book are resolved, links outside
 * it are kept as written. Books made from FB2 - by the converter found in the corpus, or by this
 * editor's export - give their FB2 structure back.
 */

import { XmlNameAllocator } from '../shared/names';
import { folderOf, resolvePath, type NavEntry } from './package';

export type ImportSummaryKind =
  | 'linkAsText'
  | 'pictureLeftOut'
  | 'remote'
  | 'dropped'
  | 'listedData'
  | 'recovered'
  | 'unreadable'
  | 'outside'
  | 'pageMissing';

export interface ImportSummaryItem {
  kind: ImportSummaryKind;
  detail: string;
}

export interface ConvertPage {
  path: string;
  doc: Document;
  linear: boolean;
  /** The guide's or the landmarks' type of the page ('cover', 'title-page', 'toc', ...). */
  role?: string;
}

export interface ConvertInput {
  pages: ConvertPage[];
  navigation: NavEntry[];
  /** The package's image items by path (D23: what the pages may name). */
  images: ReadonlyMap<string, string>;
  /** The words the description gives (title, authors, series), to recognise a title page (D18). */
  descriptionWords: Set<string>;
  notesTitle: string;
}

export interface ConvertedBook {
  bodyXml: string;
  notesXml: string | null;
  /** Every picture the book names, by its path in the container, with its FB2 binary id. */
  pictures: Map<string, string>;
  /** The cover picture's path, when a cover page shows one. */
  coverPath?: string;
  stats: { sections: number; pictures: number; tables: number; notes: number };
  summary: ImportSummaryItem[];
}

const EPUB_OPS = 'http://www.idpf.org/2007/ops';
// The characters XML 1.0 does not allow, removed from every text the import writes.
// eslint-disable-next-line no-control-regex
const INVALID_XML = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]', 'g');
const EXTERNAL = /^(https?|mailto|ftp):/i;
const NOTE_TYPES = new Set(['footnote', 'endnote', 'rearnote', 'note']);
const BLOCKS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'center',
  'dd',
  'details',
  'dialog',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hgroup',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'ul',
  // DTBook (EPUB 2)
  'level',
  'level1',
  'level2',
  'level3',
  'level4',
  'level5',
  'level6',
  'hd',
  'poem',
  'linegroup',
  'line',
  'epigraph',
  'list',
  'imggroup',
  'sidebar',
  'note',
  'prodnote',
  'author',
  'byline',
  'dateline',
  'book',
  'frontmatter',
  'bodymatter',
  'rearmatter',
  'doctitle',
  'docauthor',
  'caption',
]);
const DROPPED = new Set([
  'script',
  'style',
  'noscript',
  'object',
  'embed',
  'iframe',
  'canvas',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'head',
  'title',
  'pagenum',
]);

function escapeText(value: string): string {
  return value
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

function epubTypes(element: Element): string[] {
  return (
    element.getAttributeNS(EPUB_OPS, 'type') ??
    element.getAttribute('epub:type') ??
    element.getAttribute('role') ??
    ''
  )
    .toLowerCase()
    .split(/\s+/)
    .map((type) => type.replace(/^doc-/, '').replace(/^z3998:/, ''))
    .filter(Boolean);
}

function classes(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
}

function local(element: Element): string {
  return element.localName.toLowerCase();
}

function headingLevel(element: Element): number | null {
  const name = local(element);
  if (/^h[1-6]$/.test(name)) return Number(name[1]);
  if (name === 'hd') {
    const level = /level([1-6])/.exec(local(element.parentElement ?? element))?.[1];
    return level ? Number(level) : 1;
  }
  return null;
}

function normaliseSpace(text: string): string {
  return text.replace(/[\t\n\r\f ]+/g, ' ');
}

/**
 * The text of a node as a reader sees it: blocks (and line breaks and pictures) apart, inline
 * elements run on (`H<sub>2</sub>O` stays one word) - `textContent` would join two blocks into one
 * word.
 */
function textOf(node: Node): string {
  let out = '';
  const visit = (current: Node): void => {
    if (current.nodeType === Node.TEXT_NODE || current.nodeType === Node.CDATA_SECTION_NODE) {
      out += current.nodeValue ?? '';
      return;
    }
    if (current.nodeType !== Node.ELEMENT_NODE) return;
    const name = local(current as Element);
    if (DROPPED.has(name)) return;
    const apart = BLOCKS.has(name) || name === 'br' || name === 'img';
    if (apart) out += ' ';
    for (const child of Array.from(current.childNodes)) visit(child);
    if (apart) out += ' ';
  };
  visit(node);
  return normaliseSpace(out).trim();
}

/** The words of a text, lower case, for the title page's comparison (D18). */
export function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

interface Section {
  level: number;
  title?: string;
  id?: string;
  epigraphs: string[];
  blocks: Array<string | Section>;
}

interface NoteDefinition {
  key: string;
  element: Element;
  page: ConvertPage;
  fbId: string;
  label?: string;
  backlinkTargets: Set<string>;
}

export function convertPages(input: ConvertInput): ConvertedBook {
  const summary: ImportSummaryItem[] = [];
  const note = (kind: ImportSummaryKind, detail: string): void => {
    summary.push({ kind, detail });
  };
  const ids = new XmlNameAllocator();
  const pictures = new Map<string, string>();
  const stats = { sections: 0, pictures: 0, tables: 0, notes: 0 };
  const stemOf = (path: string): string =>
    path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '');

  // 1. Which anchors links point to, and which of them are notes.
  const linkTargets = new Set<string>();
  const notes = new Map<string, NoteDefinition>();
  const byKey = new Map<string, { element: Element; page: ConvertPage }>();
  for (const page of input.pages) {
    for (const element of Array.from(page.doc.getElementsByTagName('*'))) {
      const id = element.getAttribute('id');
      if (id) byKey.set(`${page.path}#${id}`, { element, page });
    }
  }
  const addNote = (key: string, element: Element, page: ConvertPage): void => {
    if (notes.has(key)) return;
    notes.set(key, {
      key,
      element,
      page,
      fbId: ids.allocate(`note_${stemOf(page.path)}_${key.split('#')[1] ?? ''}`),
      backlinkTargets: new Set(),
    });
  };
  for (const page of input.pages) {
    for (const element of Array.from(page.doc.getElementsByTagName('*'))) {
      const id = element.getAttribute('id');
      const types = epubTypes(element);
      if (
        id &&
        (types.some((type) => NOTE_TYPES.has(type)) || classes(element).includes('_idFootnote'))
      ) {
        addNote(`${page.path}#${id}`, element, page);
      }
      // DTBook's notes: <note id> and the <noteref idref> that point to them.
      if (local(element) === 'note' && id) addNote(`${page.path}#${id}`, element, page);
      if (local(element) === 'noteref') {
        const key = `${page.path}#${(element.getAttribute('idref') ?? '').replace(/^#/, '')}`;
        const target = byKey.get(key);
        if (target) addNote(key, target.element, target.page);
        continue;
      }
      if (local(element) !== 'a') continue;
      const href =
        element.getAttribute('href') ??
        element.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ??
        '';
      if (!href || EXTERNAL.test(href)) continue;
      const path = href.startsWith('#') ? page.path : resolvePath(page.path, href);
      if (!path) continue;
      const fragment = href.includes('#') ? href.slice(href.indexOf('#') + 1) : '';
      const key = `${path}#${fragment}`;
      linkTargets.add(key);
      const target = fragment ? byKey.get(key) : undefined;
      const ownId = element.getAttribute('id');
      if (target && types.includes('noteref')) addNote(key, target.element, target.page);
      // EPUB 2's notes: the target links back to this reference (contracts §3).
      if (target && ownId) {
        const back = Array.from(target.element.getElementsByTagName('a')).some((a) => {
          const backHref = a.getAttribute('href') ?? '';
          const backPath = backHref.startsWith('#')
            ? target.page.path
            : resolvePath(target.page.path, backHref);
          return backPath === page.path && backHref.endsWith(`#${ownId}`);
        });
        if (back && target.element !== element) addNote(key, target.element, target.page);
      }
    }
  }
  const noteElements = new Set([...notes.values()].map((definition) => definition.element));

  // 2. Anchors that links point to get FB2 ids on what they become.
  const fbIds = new Map<string, string>();
  const idFor = (page: ConvertPage, element: Element): string | undefined => {
    const id = element.getAttribute('id');
    if (!id) return undefined;
    const key = `${page.path}#${id}`;
    if (!linkTargets.has(key) || notes.has(key)) return undefined;
    const existing = fbIds.get(key);
    if (existing) return existing;
    const fbId = ids.allocate(`${stemOf(page.path)}_${id}`);
    fbIds.set(key, fbId);
    return fbId;
  };

  // 3. The pictures the pages name (D23).
  const pictureId = (page: ConvertPage, src: string): string | null => {
    if (EXTERNAL.test(src)) {
      note('remote', src);
      return null;
    }
    const path = resolvePath(page.path, src);
    if (!path || !input.images.has(path)) {
      note('pictureLeftOut', src);
      return null;
    }
    let id = pictures.get(path);
    if (!id) {
      id = ids.allocate(stemOf(path) || 'picture');
      pictures.set(path, id);
    }
    return id;
  };

  // The body under construction.
  const root: Section = { level: 0, epigraphs: [], blocks: [] };
  let stack: Section[] = [root];
  let bodyTitle: string | undefined;
  let coverPath: string | undefined;
  const top = (): Section => stack[stack.length - 1]!;
  const openSection = (level: number, title: string | undefined, id: string | undefined): void => {
    while (stack.length > 1 && top().level >= level) stack.pop();
    const section: Section = { level, title, id, epigraphs: [], blocks: [] };
    top().blocks.push(section);
    stack.push(section);
    stats.sections++;
  };
  const addBlock = (xml: string): void => {
    if (!xml) return;
    const section = top();
    const previous = section.blocks[section.blocks.length - 1];
    if (xml.startsWith('<image') && typeof previous === 'string' && previous.startsWith('<image'))
      section.blocks.push('<empty-line/>');
    section.blocks.push(xml);
  };

  // Inline content.
  let currentPage: ConvertPage;
  let currentNote: NoteDefinition | null = null;
  const inline = (node: Node, inLink: boolean): string => {
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
      return escapeText(normaliseSpace(node.nodeValue ?? ''));
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const element = node as Element;
    const name = local(element);
    if (DROPPED.has(name)) {
      if (name === 'script') note('dropped', 'script');
      return '';
    }
    const inner = (): string =>
      Array.from(element.childNodes)
        .map((child) => inline(child, inLink || name === 'a'))
        .join('');
    switch (name) {
      case 'em':
      case 'i':
      case 'cite':
      case 'dfn':
      case 'var':
        return wrap('emphasis', inner());
      case 'strong':
      case 'b':
        return wrap('strong', inner());
      case 's':
      case 'del':
      case 'strike':
        return wrap('strikethrough', inner());
      case 'sub':
      case 'sup':
        return wrap(name, inner());
      case 'code':
      case 'kbd':
      case 'samp':
      case 'tt':
        return wrap('code', inner());
      case 'br':
        return ' ';
      case 'img': {
        const id = pictureId(currentPage, element.getAttribute('src') ?? '');
        if (!id)
          return escapeText(element.getAttribute('alt') ? `[${element.getAttribute('alt')}]` : '');
        stats.pictures++;
        const alt = element.getAttribute('alt');
        return `<image l:href="#${id}"${alt ? ` alt="${escapeAttr(alt)}"` : ''}/>`;
      }
      case 'ruby': {
        const base = Array.from(element.childNodes)
          .filter(
            (child) =>
              !(
                child.nodeType === Node.ELEMENT_NODE &&
                ['rt', 'rp'].includes(local(child as Element))
              ),
          )
          .map((child) => inline(child, inLink))
          .join('');
        const reading = Array.from(element.getElementsByTagName('rt'))
          .map((rt) => escapeText(normaliseSpace(rt.textContent ?? '')))
          .join(' ');
        return reading ? `${base} (${reading})` : base;
      }
      case 'a':
      case 'noteref':
        return link(element, inner(), inLink);
      // EPUB 3.0's switch: its fallback, which every reading system shows (D17).
      case 'switch':
        return Array.from(element.children)
          .filter((child) => local(child) === 'default')
          .map((child) => inline(child, inLink))
          .join('');
      case 'case':
        return '';
      default:
        return inner();
    }
  };
  const wrap = (tag: string, inner: string): string =>
    inner.trim() ? `<${tag}>${inner}</${tag}>` : inner;
  const link = (element: Element, inner: string, inLink: boolean): string => {
    const idref = element.getAttribute('idref');
    const href =
      element.getAttribute('href') ??
      element.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ??
      (idref ? `#${idref.replace(/^#/, '')}` : '');
    if (inLink || !href) return inner;
    // D22: links outside the book stay exactly as written.
    if (EXTERNAL.test(href)) return `<a l:href="${escapeAttr(href)}">${inner}</a>`;
    const path = href.startsWith('#') ? currentPage.path : resolvePath(currentPage.path, href);
    if (!path) {
      note('linkAsText', href);
      return inner;
    }
    const key = `${path}#${href.includes('#') ? href.slice(href.indexOf('#') + 1) : ''}`;
    // A link inside a note back to one of its references: the reference's text is the label.
    if (currentNote?.backlinkTargets.has(key)) return '';
    const definition = notes.get(key);
    if (definition) {
      if (definition.element.contains(element)) return ''; // a back-link inside the note itself
      if (!definition.label)
        definition.label = (element.textContent ?? '').replace(/[[\]()]/g, '').trim();
      const ownId = element.getAttribute('id');
      if (ownId) definition.backlinkTargets.add(`${currentPage.path}#${ownId}`);
      return `<a l:href="#${definition.fbId}" type="note">${inner}</a>`;
    }
    return `\uE002${key}\uE003${inner}\uE004`;
  };
  const inlineOf = (element: Element): string =>
    Array.from(element.childNodes)
      .map((child) => inline(child, false))
      .join('')
      .replace(/^\s+|\s+$/g, '');

  // Paragraphs: the inline runs of a block, split at its <br>s.
  const paragraphsOf = (element: Element, tag = 'p'): string[] => {
    const out: string[] = [];
    let run = '';
    const flush = (): void => {
      const text = run.replace(/^\s+|\s+$/g, '');
      if (text) out.push(text);
      run = '';
    };
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE && local(child as Element) === 'br') flush();
      else run += inline(child, false);
    }
    flush();
    const id = idFor(currentPage, element);
    return out.map(
      (text, index) => `<${tag}${index === 0 && id ? ` id="${id}"` : ''}>${text}</${tag}>`,
    );
  };

  const titleXml = (element: Element): string => {
    const lines = paragraphsOf(element).map((line) => line.replace(/^<p id="[^"]*">/, '<p>'));
    return lines.length > 0 ? `<title>${lines.join('')}</title>` : '';
  };

  const plainTitle = (text: string): string => `<title><p>${escapeText(text)}</p></title>`;

  // A poem: DTBook's poem/linegroup/line, z3998's verse, the converters' and the editor's classes.
  const poemXml = (element: Element): string => {
    const stanzas: string[] = [];
    let title = '';
    let loose: string[] = [];
    const tail: string[] = [];
    const flush = (): void => {
      if (loose.length > 0) stanzas.push(`<stanza>${loose.join('')}</stanza>`);
      loose = [];
    };
    const verse = (line: Element): void => {
      for (const v of paragraphsOf(line, 'v')) loose.push(v);
    };
    const visit = (child: Element): void => {
      const name = local(child);
      const kind = classes(child);
      if (kind.some((one) => one === 'fb2-poem-title' || one === 'fb2-title') && !title)
        title = `<title>${paragraphsOf(child).join('')}</title>`;
      else if (name === 'linegroup' || kind.includes('stanza') || kind.includes('fb2-stanza')) {
        flush();
        const lines: string[] = [];
        for (const line of Array.from(child.children)) {
          if (classes(line).includes('fb2-stanza-title')) continue;
          lines.push(...paragraphsOf(line, 'v'));
        }
        if (lines.length > 0) stanzas.push(`<stanza>${lines.join('')}</stanza>`);
      } else if (kind.includes('fb2-text-author') || name === 'author')
        tail.push(...paragraphsOf(child, 'text-author'));
      else if (kind.includes('fb2-date')) tail.push(`<date>${inlineOf(child)}</date>`);
      else if (
        name === 'line' ||
        name === 'p' ||
        name === 'div' ||
        kind.includes('v') ||
        kind.includes('fb2-v')
      )
        verse(child);
    };
    for (const child of Array.from(element.children)) visit(child);
    flush();
    if (stanzas.length === 0) return '';
    const authors = tail.filter((one) => one.startsWith('<text-author'));
    const date = tail.find((one) => one.startsWith('<date'));
    return `<poem>${title}${stanzas.join('')}${authors.join('')}${date ?? ''}</poem>`;
  };

  // The blocks inside an epigraph or a cite, as FB2 allows them there.
  const quotedBlocks = (element: Element, epigraph: boolean): string => {
    const parts: string[] = [];
    const children = Array.from(element.children);
    children.forEach((child, index) => {
      const kind = classes(child);
      const name = local(child);
      const last = index === children.length - 1;
      if (
        kind.includes('fb2-text-author') ||
        name === 'author' ||
        name === 'byline' ||
        (epigraph && last && name === 'blockquote')
      ) {
        parts.push(...paragraphsOf(child, 'text-author'));
      } else if (name === 'blockquote' && !epigraph) parts.push(...paragraphsOf(child));
      else if (kind.includes('fb2-poem') || name === 'poem' || kind.includes('poem'))
        parts.push(poemXml(child));
      else if (kind.includes('fb2-empty-line')) parts.push('<empty-line/>');
      else parts.push(...paragraphsOf(child));
    });
    if (parts.length === 0) parts.push(...paragraphsOf(element));
    return parts.join('') || '<empty-line/>';
  };

  const tableXml = (element: Element): string => {
    stats.tables++;
    const rows: string[] = [];
    for (const row of Array.from(element.getElementsByTagName('tr'))) {
      const cells = Array.from(row.children)
        .filter((cell) => ['td', 'th'].includes(local(cell)))
        .map((cell) => {
          const name = local(cell);
          const span = (attr: string): string => {
            const value = Number(cell.getAttribute(attr));
            return Number.isInteger(value) && value > 1 ? ` ${attr}="${value}"` : '';
          };
          const kind = classes(cell).join(' ');
          const align =
            cell.getAttribute('align') ??
            /fb2-align-(left|center|right)/.exec(kind)?.[1] ??
            /text-align:\s*(left|center|right)/.exec(cell.getAttribute('style') ?? '')?.[1];
          const valign =
            cell.getAttribute('valign') ?? /fb2-valign-(top|middle|bottom)/.exec(kind)?.[1];
          return (
            `<${name}${span('colspan')}${span('rowspan')}` +
            `${align && ['left', 'center', 'right'].includes(align) ? ` align="${align}"` : ''}` +
            `${valign && ['top', 'middle', 'bottom'].includes(valign) ? ` valign="${valign}"` : ''}>` +
            `${inlineOf(cell)}</${name}>`
          );
        });
      if (cells.length > 0) rows.push(`<tr>${cells.join('')}</tr>`);
    }
    return rows.length > 0 ? `<table>${rows.join('')}</table>` : '';
  };

  const imageXml = (element: Element, caption?: string): string => {
    const src =
      element.getAttribute('src') ??
      element.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ??
      element.getAttribute('href') ??
      '';
    const id = pictureId(currentPage, src);
    if (!id) return '';
    stats.pictures++;
    const alt = element.getAttribute('alt');
    return `<image l:href="#${id}"${alt ? ` alt="${escapeAttr(alt)}"` : ''}${caption ? ` title="${escapeAttr(caption)}"` : ''}/>`;
  };

  // The blocks of an element, in the current section.
  const blockContent = (element: Element, listDepth = 0): void => {
    let run: ChildNode[] = [];
    const flushRun = (): void => {
      if (run.length === 0) return;
      const holder = element.ownerDocument.createElement('p');
      for (const node of run) holder.appendChild(node.cloneNode(true));
      for (const p of paragraphsOf(holder)) addBlock(p);
      run = [];
    };
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType !== Node.ELEMENT_NODE) {
        run.push(child);
        continue;
      }
      const el = child as Element;
      const name = local(el);
      if (noteElements.has(el) || DROPPED.has(name) || name === 'nav') {
        if (name === 'script') note('dropped', 'script');
        continue;
      }
      if (
        !BLOCKS.has(name) &&
        name !== 'img' &&
        name !== 'svg' &&
        name !== 'math' &&
        name !== 'audio' &&
        name !== 'video'
      ) {
        run.push(child);
        continue;
      }
      flushRun();
      block(el, listDepth);
    }
    flushRun();
  };

  const block = (element: Element, listDepth: number): void => {
    const name = local(element);
    const kind = classes(element);
    const types = epubTypes(element);
    if (kind.includes('fb2-backlink')) return;
    // DTBook's front matter repeats the description the way a title page does (D18).
    if (
      (name === 'doctitle' || name === 'docauthor') &&
      wordsOf(textOf(element)).every((word) => input.descriptionWords.has(word))
    )
      return;
    // The editor's own and the FB2 converter's body title (D18, D21).
    if (kind.includes('fb2-body-title') || (name === 'h1' && kind.includes('body_head'))) {
      bodyTitle = titleXml(element);
      return;
    }
    // The FB2 marks come before the heading levels: the converter writes subtitles as <h5>.
    if (kind.includes('subtitle') || kind.includes('fb2-subtitle')) {
      for (const p of paragraphsOf(element, 'subtitle')) addBlock(p);
      return;
    }
    const level = headingLevel(element);
    if (level !== null) {
      openSection(level, titleXml(element), idFor(currentPage, element));
      return;
    }
    if (kind.includes('fb2-empty-line')) {
      addBlock('<empty-line/>');
      return;
    }
    if (kind.includes('fb2-text-author')) {
      for (const p of paragraphsOf(element, 'text-author'))
        addBlock(p.replace(/^<text-author/, '<p').replace(/<\/text-author>$/, '</p>'));
      return;
    }
    if (
      types.includes('epigraph') ||
      kind.includes('epigraph') ||
      kind.includes('fb2-epigraph') ||
      name === 'epigraph'
    ) {
      const section = top();
      const xml = quotedBlocks(element, true);
      if (section.blocks.length === 0 && section !== root)
        section.epigraphs.push(`<epigraph>${xml}</epigraph>`);
      else addBlock(`<cite>${xml}</cite>`);
      return;
    }
    if (
      name === 'poem' ||
      types.includes('poem') ||
      types.includes('verse') ||
      kind.includes('poem') ||
      kind.includes('fb2-poem')
    ) {
      addBlock(poemXml(element));
      return;
    }
    if (
      name === 'blockquote' ||
      name === 'aside' ||
      name === 'sidebar' ||
      kind.includes('fb2-cite')
    ) {
      addBlock(`<cite>${quotedBlocks(element, false)}</cite>`);
      return;
    }
    if (kind.includes('fb2-annotation')) {
      blockContent(element, listDepth);
      return;
    }
    switch (name) {
      case 'p':
      case 'dt':
      case 'dd':
      case 'address':
      case 'line':
      case 'author':
      case 'byline':
      case 'dateline':
      case 'doctitle':
      case 'docauthor':
      case 'caption':
      case 'figcaption':
        if (
          Array.from(element.children).some(
            (child) => BLOCKS.has(local(child)) && local(child) !== 'p',
          )
        )
          blockContent(element, listDepth);
        else for (const p of paragraphsOf(element)) addBlock(p);
        return;
      case 'hr':
        addBlock('<subtitle>* * *</subtitle>');
        return;
      case 'pre':
        for (const line of (element.textContent ?? '').split('\n'))
          addBlock(line.trim() ? `<p><code>${escapeText(line)}</code></p>` : '<empty-line/>');
        return;
      case 'ul':
      case 'ol':
      case 'list': {
        const ordered = name === 'ol' || element.getAttribute('type') === 'ol';
        let number = Number(element.getAttribute('start')) || 1;
        for (const item of Array.from(element.children)) {
          if (local(item) !== 'li') continue;
          const marker = ordered ? `${number++}. ` : listDepth > 0 ? '\u25e6 ' : '\u2022 ';
          const paragraphs = paragraphsOf(item);
          paragraphs.forEach((p, index) =>
            addBlock(
              index === 0
                ? p.replace(
                    /^(<p[^>]*>)/,
                    `$1${escapeText('\u00a0'.repeat(listDepth * 2) + marker)}`,
                  )
                : p,
            ),
          );
          for (const nested of Array.from(item.children))
            if (['ul', 'ol', 'list'].includes(local(nested))) block(nested, listDepth + 1);
        }
        return;
      }
      case 'table':
        addBlock(tableXml(element));
        return;
      case 'img':
        addBlock(imageXml(element));
        return;
      case 'figure':
      case 'imggroup': {
        const caption = Array.from(element.children).find((child) =>
          ['figcaption', 'caption'].includes(local(child)),
        );
        const images = Array.from(element.getElementsByTagName('img'));
        const captionText = caption ? normaliseSpace(caption.textContent ?? '').trim() : undefined;
        if (images.length === 0) {
          blockContent(element, listDepth);
          return;
        }
        images.forEach((img, index) =>
          addBlock(imageXml(img, index === 0 ? captionText : undefined)),
        );
        return;
      }
      case 'svg':
      case 'math':
        // Drawn as pictures by US3 (D23, D24); until then their text stays.
        if ((element.textContent ?? '').trim())
          addBlock(`<p>${escapeText(normaliseSpace(element.textContent ?? '').trim())}</p>`);
        note('dropped', name);
        return;
      case 'audio':
      case 'video': {
        note('dropped', name);
        const fallback = normaliseSpace(element.textContent ?? '').trim();
        if (fallback) addBlock(`<p>${escapeText(fallback)}</p>`);
        const poster = element.getAttribute('poster');
        if (poster) {
          const id = pictureId(currentPage, poster);
          if (id) {
            stats.pictures++;
            addBlock(`<image l:href="#${id}"/>`);
          }
        }
        return;
      }
      default:
        blockContent(element, listDepth);
    }
  };

  // 4. The pages, in reading order: linear ones first, then the others.
  const pageTitles = new Map<string, NavEntry>();
  for (const entry of input.navigation)
    if (!entry.fragment && !pageTitles.has(entry.path)) pageTitles.set(entry.path, entry);
  const ordered = [
    ...input.pages.filter((page) => page.linear),
    ...input.pages.filter((page) => !page.linear),
  ];
  for (const page of ordered) {
    currentPage = page;
    const body = page.doc.getElementsByTagName('body')[0] ?? page.doc.documentElement;
    if (!body) continue;
    const text = textOf(body);
    const images = Array.from(body.getElementsByTagName('img'));
    const svgImages = Array.from(body.getElementsByTagName('image'));
    const bodyKinds = classes(body).concat(
      Array.from(body.children).flatMap((child) => classes(child)),
    );
    // D18: a cover page that only shows the cover becomes the book's cover.
    if (
      page.role === 'cover' ||
      bodyKinds.includes('fb2-cover') ||
      (text.length < 3 && images.length + svgImages.length === 1)
    ) {
      const picture = images[0] ?? svgImages[0];
      if (picture && !coverPath) {
        const src =
          picture.getAttribute('src') ??
          picture.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ??
          picture.getAttribute('href') ??
          '';
        const path = resolvePath(page.path, src);
        if (path && input.images.has(path)) {
          coverPath = path;
          if (!pictures.has(path)) pictures.set(path, ids.allocate(stemOf(path) || 'cover'));
        }
      }
      if (text.length < 3 || bodyKinds.includes('fb2-cover')) continue;
    }
    // D18: a title page that only repeats the description is not repeated as text.
    const titlePage =
      page.role === 'title-page' ||
      bodyKinds.includes('fb2-title-page') ||
      epubTypes(body).includes('titlepage');
    if (
      titlePage &&
      (bodyKinds.includes('fb2-title-page') ||
        wordsOf(text).every((word) => input.descriptionWords.has(word)))
    )
      continue;
    if (
      page.role === 'toc' &&
      Array.from(body.getElementsByTagName('a')).length > 2 &&
      text.length < 4000
    )
      continue;
    // A page without a heading of its own is titled by the table of contents, when it has an entry.
    const firstHeading = Array.from(body.getElementsByTagName('*')).find(
      (element) =>
        (headingLevel(element) !== null &&
          !classes(element).some((one) => one.endsWith('subtitle'))) ||
        classes(element).includes('fb2-body-title'),
    );
    const continued = bodyKinds.includes('fb-continued');
    const entry = pageTitles.get(page.path);
    if (!continued && entry && (!firstHeading || !text.startsWith(textOf(firstHeading)))) {
      openSection(entry.depth, plainTitle(entry.label), undefined);
    }
    const pageKey = `${page.path}#`;
    if (linkTargets.has(pageKey) && !fbIds.has(pageKey)) {
      // A link to the page itself leads to its first section.
      const section = top();
      if (section !== root) {
        section.id ??= ids.allocate(stemOf(page.path));
        fbIds.set(pageKey, section.id);
      }
    }
    blockContent(body);
  }

  // 5. The notes (D20).
  let notesXml: string | null = null;
  if (notes.size > 0) {
    const sections: string[] = [];
    for (const definition of notes.values()) {
      currentPage = definition.page;
      currentNote = definition;
      stack = [{ level: 0, epigraphs: [], blocks: [] }];
      const element = definition.element;
      // EPUB 2's form: the leading back-link's text is the note's label.
      const firstLink = element.getElementsByTagName('a')[0];
      if (firstLink && !definition.label)
        definition.label = (firstLink.textContent ?? '').replace(/[[\]()]/g, '').trim();
      blockContent(element);
      const content =
        (stack[0]!.blocks.filter((one) => typeof one === 'string') as string[]).join('') ||
        '<empty-line/>';
      const label = definition.label ? plainTitle(definition.label) : '';
      sections.push(`<section id="${definition.fbId}">${label}${content}</section>`);
      stats.notes++;
    }
    notesXml = `<body name="notes">${plainTitle(input.notesTitle)}${sections.join('')}</body>`;
    stack = [root];
    currentNote = null;
  }

  // D18: one opening heading above all chapters is the body's title.
  if (!bodyTitle && root.blocks.length === 1 && typeof root.blocks[0] !== 'string') {
    const only = root.blocks[0] as Section;
    if (
      only.title &&
      only.blocks.some((child) => typeof child !== 'string') &&
      !only.blocks.some((child) => typeof child === 'string' && child !== '<empty-line/>')
    ) {
      bodyTitle = only.title;
      root.blocks = only.blocks;
      stats.sections--;
    }
  }

  const sectionXml = (section: Section): string => {
    const head = `${section.title ?? ''}${section.epigraphs.join('')}`;
    const hasChildren = section.blocks.some((child) => typeof child !== 'string');
    let inner = '';
    if (!hasChildren) {
      inner = (section.blocks as string[]).join('') || '<empty-line/>';
    } else {
      let run: string[] = [];
      const flush = (): void => {
        if (run.length > 0) inner += `<section>${run.join('')}</section>`;
        run = [];
      };
      for (const child of section.blocks) {
        if (typeof child === 'string') run.push(child);
        else {
          flush();
          inner += sectionXml(child);
        }
      }
      flush();
    }
    return `<section${section.id ? ` id="${section.id}"` : ''}>${head}${inner}</section>`;
  };
  let bodyInner = '';
  let run: string[] = [];
  for (const child of root.blocks) {
    if (typeof child === 'string') run.push(child);
    else {
      if (run.length > 0) bodyInner += `<section>${run.join('')}</section>`;
      run = [];
      bodyInner += sectionXml(child);
    }
  }
  if (run.length > 0) bodyInner += `<section>${run.join('')}</section>`;
  if (!bodyInner) bodyInner = '<section><empty-line/></section>';
  let bodyXml = `<body>${bodyTitle ?? ''}${bodyInner}</body>`;

  // 6. Links inside the book, resolved now that every anchor has its FB2 id (D22).
  const resolveLinks = (xml: string): string =>
    xml.replace(/\uE002([^\uE003]*)\uE003([\s\S]*?)\uE004/g, (_, key: string, inner: string) => {
      // D22: a link to a place the book does not hold keeps its text and is listed; a place that
      // exists but became no element of its own leads to its page.
      const exists = key.endsWith('#') || byKey.has(key);
      const fbId =
        fbIds.get(key) ??
        (exists && !key.endsWith('#') ? fbIds.get(`${key.split('#')[0]}#`) : undefined);
      if (fbId) return `<a l:href="#${fbId}">${inner}</a>`;
      note('linkAsText', key.slice(key.lastIndexOf('/') + 1));
      return inner;
    });
  bodyXml = resolveLinks(bodyXml);
  if (notesXml) notesXml = resolveLinks(notesXml);
  return { bodyXml, notesXml, pictures, coverPath, stats, summary };
}

/** The folder of the package, for tests. */
export const packageFolder = folderOf;
