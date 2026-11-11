/**
 * Feature 012 (US1; D4-D13, D43; FR-004-FR-017; contracts/epub-export.md): the EPUB of a book as
 * files - the pages, the navigation document, the NCX, the stylesheet and the package - built from
 * the book's model as the window has it. The pictures are put into the EPUB by the core first
 * (`epub.write.binary`), so the pages name them as the core named them. Nothing here touches the
 * document: the export changes nothing (D3).
 *
 *   EPUB/package.opf, EPUB/nav.xhtml, EPUB/toc.ncx, EPUB/style.css
 *   EPUB/text/cover.xhtml (with a cover), EPUB/text/title.xhtml, EPUB/text/0001.xhtml ...,
 *   EPUB/text/notes.xhtml (with notes), EPUB/images/... (the core's)
 */

import type {
  AnnotationNode,
  BodyNode,
  Document,
  Mark,
  Person,
  SectionNode,
  Sequence,
} from '@/model/document';

import { readFbdMakerName, ROLE_BY_LABEL, type FbdMakerLabel } from '../shared/fbdMaker';
import { MARC } from '../shared/roles';
import { bookWords, type BookWords } from '../shared/words';
import { publicationCss } from './css';
import {
  anchorLink,
  pictureSrc,
  renderBlock,
  renderTitle,
  titleText,
  type PlacedPicture,
  type RenderContext,
  type SummaryItem,
  type SummaryKind,
} from './render';
import { attr, IdAllocator, ncName, page, text } from './xhtml';

/** D5, research DP-8: a page larger than this is divided (the site's export uses the same limit). */
export const PAGE_LIMIT = 250_000;

export interface EpubFile {
  /** The path inside the EPUB. */
  name: string;
  mediaType: string;
  text: string;
}

export interface BuildInput {
  document: Document;
  /** The pictures the core has put into the EPUB, by binary id. */
  pictures: ReadonlyMap<string, PlacedPicture>;
  /** The time of the export (`dcterms:modified`). */
  modified: Date;
  /** The title written when the book has none (D4: filled in the file only, and listed). */
  fallbackTitle: string;
  /** Genre names by code in the language of the words the export adds (D6), when known. */
  genreNames?: ReadonlyMap<string, string>;
  /** A new UUID, for a book without an id (D4). */
  newId?: () => string;
}

export interface BuiltEpub {
  files: EpubFile[];
  summary: SummaryItem[];
  identifier: string;
  counts: { pages: number; sections: number; pictures: number; tables: number; notes: number };
}

const XHTML = 'application/xhtml+xml';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANGUAGE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;
const encoder = new TextEncoder();

interface TocEntry {
  label: string;
  /** An anchor placeholder, resolved like the pages' links. */
  target: string;
  children: TocEntry[];
}

interface PageDraft {
  name: string;
  title: string;
  html: string;
  bodyClass?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

function personName(person: Person): string {
  const name = [person.firstName, person.middleName, person.lastName]
    .map((part) => (part ?? '').trim())
    .filter((part) => part.length > 0)
    .join(' ');
  return name || (person.nickname ?? '').trim();
}

function fileAs(person: { firstName?: string; middleName?: string; lastName?: string }): string {
  const last = (person.lastName ?? '').trim();
  const rest = [person.firstName, person.middleName]
    .map((part) => (part ?? '').trim())
    .filter((part) => part.length > 0)
    .join(' ');
  return last && rest ? `${last}, ${rest}` : last || rest;
}

function flattenSequences(sequences: readonly Sequence[]): Sequence[] {
  return sequences.flatMap((sequence) => [sequence, ...flattenSequences(sequence.children ?? [])]);
}

function isoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function basename(name: string): string {
  return name.slice(name.lastIndexOf('/') + 1);
}

function folderOf(name: string): string {
  return name.slice(0, name.lastIndexOf('/') + 1);
}

/** A path from the file `from` to the file `to`, both inside the EPUB. */
function relativePath(from: string, to: string): string {
  const fromParts = folderOf(from).split('/').filter(Boolean);
  const toParts = to.split('/');
  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length - 1 &&
    fromParts[common] === toParts[common]
  ) {
    common++;
  }
  return [...fromParts.slice(common).map(() => '..'), ...toParts.slice(common)].join('/');
}

function plainText(nodes: readonly AnyNode[]): string {
  const parts: string[] = [];
  const visit = (node: AnyNode): void => {
    if (node.type === 'text') parts.push(node.text);
    else if (Array.isArray(node.content)) {
      for (const child of node.content) visit(child);
      if (node.type !== 'text' && node.type !== 'inline-image') parts.push(' ');
    }
  };
  for (const node of nodes) visit(node);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/** Every node of a tree, depth first. */
function forEachNode(node: AnyNode, visit: (node: AnyNode) => void): void {
  visit(node);
  if (Array.isArray(node.content)) for (const child of node.content) forEachNode(child, visit);
}

function noteTargetsOf(bodies: readonly BodyNode[]): Set<string> {
  const targets = new Set<string>();
  for (const body of bodies) {
    forEachNode(body, (node) => {
      for (const mark of (node.marks ?? []) as Mark[]) {
        if (
          mark.type === 'link' &&
          mark.attrs.type === 'note' &&
          mark.attrs.href?.startsWith('#')
        ) {
          targets.add(mark.attrs.href.slice(1));
        }
      }
    });
  }
  return targets;
}

export function buildEpub(input: BuildInput): BuiltEpub {
  const { document } = input;
  const summary: SummaryItem[] = [];
  const note = (kind: SummaryKind, detail: string): void => {
    summary.push({ kind, detail });
  };
  const titleInfo = document.description.titleInfo;

  // D4: gaps are filled in the file only, and listed.
  const declaredLang = (titleInfo.lang ?? '').trim();
  const lang = LANGUAGE.test(declaredLang) ? declaredLang : 'und';
  if (lang !== declaredLang) note('gapFilled', 'language');
  const words: BookWords = bookWords(lang);
  const title = titleInfo.bookTitle.trim() || input.fallbackTitle;
  if (!titleInfo.bookTitle.trim()) note('gapFilled', 'title');
  const documentId = (document.description.documentInfo.id ?? '').trim();
  let identifier = documentId;
  if (!identifier) {
    identifier = (input.newId ?? (() => crypto.randomUUID()))();
    note('gapFilled', 'identifier');
  }
  if (UUID.test(identifier)) identifier = `urn:uuid:${identifier.toLowerCase()}`;

  // The bodies: the first ordinary one is the main body; bodies of notes are those named so and
  // those a note link points into (export edge case: their sections become notes too).
  const noteTargets = noteTargetsOf(document.bodies);
  const bodyOfId = new Map<string, number>();
  document.bodies.forEach((body, index) =>
    forEachNode(body, (node) => {
      const id = node.attrs?.id as string | undefined;
      if (id && !bodyOfId.has(id)) bodyOfId.set(id, index);
    }),
  );
  const notesBodies = new Set<number>();
  document.bodies.forEach((body, index) => {
    const name = (body.attrs.name ?? '').toLowerCase();
    if (name === 'notes' || name === 'comments') notesBodies.add(index);
  });
  for (const target of noteTargets) {
    const index = bodyOfId.get(target);
    if (index !== undefined && index > 0) notesBodies.add(index);
  }
  const mainIndex = document.bodies.findIndex((_, index) => !notesBodies.has(index));

  // XML ids, unique in the publication: the book's own ids first (D4: duplicates made unique),
  // then one for every section, for the contents and the notes.
  const ids = new IdAllocator();
  const elementIds = new Map<string, string>();
  const targets = new Map<string, string>();
  const claim = (node: AnyNode): void => {
    const own = node.attrs?.id as string | undefined;
    if (!own || !node.attrs?.nodeId) return;
    const xmlId = ids.allocate(own);
    elementIds.set(node.attrs.nodeId, xmlId);
    if (targets.has(own)) note('idMadeUnique', own);
    else targets.set(own, xmlId);
  };
  for (const body of document.bodies) forEachNode(body, claim);
  if (titleInfo.annotation) forEachNode(titleInfo.annotation, claim);
  let sectionCount = 0;
  for (const body of document.bodies) {
    forEachNode(body, (node) => {
      if (node.type !== 'section') return;
      sectionCount++;
      if (!elementIds.has(node.attrs.nodeId))
        elementIds.set(node.attrs.nodeId, ids.allocate(`s${sectionCount}`));
    });
  }

  const backReferences = new Map<string, string>();
  let referenceCount = 0;
  const counts = { pictures: 0, tables: 0, notes: 0, withoutAlt: 0 };
  const ctx: RenderContext = {
    elementId: (nodeId) => elementIds.get(nodeId),
    hasTarget: (fb2Id) => targets.has(fb2Id),
    isNoteTarget: (fb2Id) => {
      const index = bodyOfId.get(fb2Id);
      return index !== undefined && notesBodies.has(index);
    },
    noteReference: (fb2Id) => {
      const id = ids.allocate(`ref${++referenceCount}`);
      if (!backReferences.has(fb2Id)) backReferences.set(fb2Id, id);
      return id;
    },
    picture: (href) => (href.startsWith('#') ? input.pictures.get(href.slice(1)) : undefined),
    styleClass: (name) => ncName(name),
    summary: note,
    counts,
  };

  const drafts: PageDraft[] = [];
  const toc: TocEntry[] = [];
  let pageNumber = 0;
  const textPage = (): string => `EPUB/text/${String(++pageNumber).padStart(4, '0')}.xhtml`;

  // D8: the cover first, then a title page, then the main body.
  const coverHref = titleInfo.coverpage[0]?.href ?? '';
  const coverPicture = coverHref.startsWith('#')
    ? input.pictures.get(coverHref.slice(1))
    : undefined;
  if (coverPicture) {
    counts.pictures++;
    drafts.push({
      name: 'EPUB/text/cover.xhtml',
      title: words.cover,
      bodyClass: 'fb2-cover-page',
      html:
        `<div class="fb2-cover" epub:type="cover"><img src="${attr(pictureSrc(coverPicture, true))}"` +
        ` alt="${attr(words.coverDescription)}"/></div>`,
    });
  } else if (coverHref) {
    note('pictureLeftOut', coverHref);
  }
  let titlePage = `<div class="fb2-title-page" epub:type="titlepage"><h1 class="fb2-book-title">${text(title)}</h1>`;
  for (const sequence of flattenSequences(titleInfo.sequences)) {
    if (!sequence.name.trim()) continue;
    const number = sequence.number ? ` #${sequence.number}` : '';
    titlePage += `<p class="fb2-series">${text(sequence.name.trim() + number)}</p>`;
  }
  for (const author of titleInfo.authors) {
    const name = personName(author);
    if (name) titlePage += `<p class="fb2-author">${text(name)}</p>`;
  }
  if (titleInfo.annotation) titlePage += renderBlock(titleInfo.annotation, ctx, 2);
  titlePage += '</div>';
  drafts.push({ name: 'EPUB/text/title.xhtml', title: words.titlePage, html: titlePage });

  // D34: every page of a body other than the notes carries the body's mark, so that the editor's own
  // import gives each body back (the attributes are set per body below).
  let bodyMark = '';

  // A body's own picture, title and epigraphs, on a page before its sections.
  const bodyIntro = (body: BodyNode, entryList: TocEntry[]): TocEntry[] => {
    const intro = body.content.filter((child) => child.type !== 'section');
    if (intro.length === 0) return entryList;
    const id = ids.allocate(`body${drafts.length}`);
    const html = intro
      .map((child) =>
        child.type === 'title'
          ? renderTitle(child, ctx, 1, 'fb2-title fb2-body-title')
          : renderBlock(child, ctx, 1),
      )
      .join('');
    const lang = body.attrs.lang
      ? ` xml:lang="${attr(body.attrs.lang)}" lang="${attr(body.attrs.lang)}"`
      : '';
    const label = titleText(body.content.find((child) => child.type === 'title') as AnyNode);
    drafts.push({
      name: textPage(),
      title: label || title,
      html: `<div id="${id}" class="fb2-body-intro"${lang}${bodyMark}>${html}</div>`,
    });
    if (!label) return entryList;
    const entry: TocEntry = { label, target: anchorLink(id), children: [] };
    entryList.push(entry);
    return entry.children;
  };

  // A top-level section: one page, divided at its subsections or between blocks past the limit.
  const sectionPages = (section: SectionNode): void => {
    const opening: string[] = [];
    const rest: string[] = [];
    for (const child of section.content as AnyNode[]) {
      const html = renderBlock(child, ctx, 1);
      if (rest.length === 0 && ['title', 'epigraph', 'image', 'annotation'].includes(child.type))
        opening.push(html);
      else rest.push(html);
    }
    const id = elementIds.get(section.attrs.nodeId);
    const lang = section.attrs.lang
      ? ` xml:lang="${attr(section.attrs.lang)}" lang="${attr(section.attrs.lang)}"`
      : '';
    const label = titleText(section.content.find((child) => child.type === 'title') as AnyNode);
    const wrap = (inner: string, first: boolean): string =>
      `<div${first && id ? ` id="${attr(id)}"` : ''} class="fb2-section${first ? '' : ' fb-continued'}"${lang}${bodyMark}>${inner}</div>`;
    let current = opening.join('');
    let size = encoder.encode(current).length;
    let first = true;
    for (const block of rest) {
      const blockSize = encoder.encode(block).length;
      if (size > 0 && size + blockSize > PAGE_LIMIT) {
        drafts.push({ name: textPage(), title: label || title, html: wrap(current, first) });
        first = false;
        current = '';
        size = 0;
      }
      current += block;
      size += blockSize;
    }
    drafts.push({ name: textPage(), title: label || title, html: wrap(current, first) });
  };

  const tocOfSection = (section: AnyNode): TocEntry[] => {
    const children = (section.content as AnyNode[])
      .filter((child) => child.type === 'section')
      .flatMap((child) => tocOfSection(child));
    const label = titleText(section.content.find((child: AnyNode) => child.type === 'title'));
    const id = elementIds.get(section.attrs.nodeId);
    if (!label || !id) return children;
    return [{ label, target: anchorLink(id), children }];
  };

  let firstTextPage = '';
  let bodyOrdinal = 0;
  document.bodies.forEach((body, index) => {
    if (notesBodies.has(index)) return;
    const name = (body.attrs as { name?: string }).name;
    bodyMark = ` data-fb2-body="${++bodyOrdinal}"${name ? ` data-fb2-body-name="${attr(name)}"` : ''}`;
    const before = drafts.length;
    const entries = bodyIntro(body, toc);
    for (const child of body.content) {
      if (child.type !== 'section') continue;
      sectionPages(child);
      entries.push(...tocOfSection(child));
    }
    if (index === mainIndex && drafts.length > before) firstTextPage = drafts[before]!.name;
  });
  if (!firstTextPage) {
    drafts.push({ name: textPage(), title, html: '<div class="fb2-section"><p>\u00a0</p></div>' });
    firstTextPage = drafts[drafts.length - 1]!.name;
  }

  // D11: the notes, all on one page after the text, each with a link back to its first reference.
  if (notesBodies.size > 0) {
    let html = '';
    let headed = false;
    const headingId = ids.allocate('notes');
    document.bodies.forEach((body, index) => {
      if (!notesBodies.has(index)) return;
      const heading = body.content.find((child) => child.type === 'title');
      // D34: the notes' heading is marked, so that the editor's import does not read it as a chapter;
      // the one the export adds for a notes body without a title also as added.
      if (heading) {
        const own = renderTitle(heading as AnyNode, ctx, 1, 'fb2-title fb2-notes-title');
        html += headed ? own : own.replace(/^<h1/, `<h1 id="${headingId}"`);
      } else if (!headed) {
        html += `<h1 id="${headingId}" class="fb2-title fb2-notes-title fb2-generated">${text(words.notes)}</h1>`;
      }
      headed = true;
      for (const child of body.content as AnyNode[]) {
        if (child.type !== 'section') {
          if (child.type !== 'title') html += renderBlock(child, ctx, 1);
          continue;
        }
        counts.notes++;
        const id = elementIds.get(child.attrs.nodeId);
        let inner = '';
        for (const part of child.content as AnyNode[]) {
          inner +=
            part.type === 'title'
              ? renderTitle(part, ctx, null, 'fb2-note-title')
              : renderBlock(part, ctx, 2);
        }
        const own = child.attrs.id as string | undefined;
        const back = own ? backReferences.get(own) : undefined;
        if (back) inner += `<p class="fb2-backlink"><a href="${anchorLink(back)}">\u21a9</a></p>`;
        html += `<aside${id ? ` id="${attr(id)}"` : ''} class="fb2-note" epub:type="footnote">${inner}</aside>`;
      }
    });
    drafts.push({ name: 'EPUB/text/notes.xhtml', title: words.notes, html });
    toc.push({
      label:
        titleText(
          document.bodies
            .find((_, i) => notesBodies.has(i))
            ?.content.find((c) => c.type === 'title') as AnyNode,
        ) || words.notes,
      target: anchorLink(headingId),
      children: [],
    });
  }

  // Every placeholder resolved now that every page has its name.
  const anchorPage = new Map<string, string>();
  for (const draft of drafts)
    for (const match of draft.html.matchAll(/\sid="([^"]+)"/g))
      anchorPage.set(match[1]!, draft.name);
  const hrefTo = (xmlId: string | undefined, from: string): string => {
    const target = xmlId ? anchorPage.get(xmlId) : undefined;
    if (!target || !xmlId) return basename(from);
    return target === from ? `#${xmlId}` : `${relativePath(from, target)}#${xmlId}`;
  };
  const resolve = (html: string, from: string): string =>
    html
      .replace(/\uE000([^\uE001]*)\uE001/g, (_, fb2Id: string) =>
        attr(hrefTo(targets.get(fb2Id), from)),
      )
      .replace(/\uE002([^\uE003]*)\uE003/g, (_, xmlId: string) => attr(hrefTo(xmlId, from)));

  if (toc.length === 0) {
    const first = drafts.find((draft) => draft.name === firstTextPage)!;
    const id = /\sid="([^"]+)"/.exec(first.html)?.[1];
    if (id) toc.push({ label: words.start, target: anchorLink(id), children: [] });
  }

  const files: EpubFile[] = drafts.map((draft) => ({
    name: draft.name,
    mediaType: XHTML,
    text: page({
      title: draft.title,
      lang,
      body: resolve(draft.html, draft.name),
      bodyClass: draft.bodyClass,
    }),
  }));

  // The navigation document: the contents and the landmarks (D8, D9).
  const navName = 'EPUB/nav.xhtml';
  const tocList = (entries: TocEntry[]): string =>
    `<ol>${entries
      .map(
        (entry) =>
          `<li><a href="${resolve(entry.target, navName)}">${text(entry.label)}</a>${entry.children.length > 0 ? tocList(entry.children) : ''}</li>`,
      )
      .join('')}</ol>`;
  const landmarks: string[] = [];
  if (coverPicture)
    landmarks.push(
      `<li><a epub:type="cover" href="text/cover.xhtml">${text(words.cover)}</a></li>`,
    );
  landmarks.push(
    `<li><a epub:type="titlepage" href="text/title.xhtml">${text(words.titlePage)}</a></li>`,
  );
  landmarks.push(
    `<li><a epub:type="bodymatter" href="${attr(relativePath(navName, firstTextPage))}">${text(words.start)}</a></li>`,
  );
  if (notesBodies.size > 0)
    landmarks.push(
      `<li><a epub:type="endnotes" href="text/notes.xhtml">${text(words.notes)}</a></li>`,
    );
  files.push({
    name: navName,
    mediaType: XHTML,
    text: page({
      title: words.contents,
      lang,
      css: 'style.css',
      body:
        `<nav epub:type="toc" id="toc"><h1>${text(words.contents)}</h1>${tocList(toc)}</nav>\n` +
        `<nav epub:type="landmarks" id="landmarks" hidden="hidden"><ol>${landmarks.join('')}</ol></nav>`,
    }),
  });

  // D5: the EPUB 2 table of contents, for older reading systems.
  let playOrder = 0;
  let depth = 1;
  const navPoints = (entries: TocEntry[], level: number): string =>
    entries
      .map((entry) => {
        depth = Math.max(depth, level);
        const order = ++playOrder;
        return (
          `<navPoint id="np${order}" playOrder="${order}"><navLabel><text>${text(entry.label)}</text></navLabel>` +
          `<content src="${resolve(entry.target, 'EPUB/toc.ncx')}"/>${navPoints(entry.children, level + 1)}</navPoint>`
        );
      })
      .join('');
  const navMap = navPoints(toc, 1);
  files.push({
    name: 'EPUB/toc.ncx',
    mediaType: 'application/x-dtbncx+xml',
    text:
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      `<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${attr(lang)}">\n` +
      `<head><meta name="dtb:uid" content="${attr(identifier)}"/><meta name="dtb:depth" content="${depth}"/>` +
      '<meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>\n' +
      `<docTitle><text>${text(title)}</text></docTitle>\n<navMap>${navMap}</navMap>\n</ncx>\n`,
  });

  files.push({
    name: 'EPUB/style.css',
    mediaType: 'text/css',
    text: publicationCss(document.stylesheets, summary),
  });

  // The package (D6, D7, D43).
  const coverId = titleInfo.coverpage[0]?.href?.slice(1);
  const pictureItems = [...input.pictures.entries()].map(([binaryId, picture]) => ({
    binaryId,
    picture,
    id: ncName(`img-${basename(picture.name)}`),
  }));
  const coverItem = pictureItems.find((item) => item.binaryId === coverId && coverPicture);
  const items: string[] = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
  ];
  const spine: string[] = [];
  for (const draft of drafts) {
    const id = ncName(`p-${basename(draft.name).replace(/\.xhtml$/, '')}`);
    items.push(
      `<item id="${id}" href="${attr(relativePath('EPUB/package.opf', draft.name))}" media-type="${XHTML}"/>`,
    );
    spine.push(`<itemref idref="${id}"/>`);
  }
  for (const item of pictureItems) {
    const cover = item === coverItem ? ' properties="cover-image"' : '';
    items.push(
      `<item id="${item.id}" href="${attr(relativePath('EPUB/package.opf', item.picture.name))}" media-type="${attr(item.picture.mediaType)}"${cover}/>`,
    );
  }

  const meta: string[] = [];
  meta.push(`<dc:identifier id="uid">${text(identifier)}</dc:identifier>`);
  meta.push(`<dc:title>${text(title)}</dc:title>`);
  meta.push(`<dc:language>${text(lang)}</dc:language>`);
  let personCount = 0;
  const person = (
    element: 'creator' | 'contributor',
    name: string,
    sortAs: string,
    role: string,
  ): void => {
    if (!name) return;
    const id = `person${++personCount}`;
    meta.push(`<dc:${element} id="${id}">${text(name)}</dc:${element}>`);
    meta.push(`<meta refines="#${id}" property="role" scheme="marc:relators">${role}</meta>`);
    if (sortAs) meta.push(`<meta refines="#${id}" property="file-as">${text(sortAs)}</meta>`);
  };
  for (const author of titleInfo.authors)
    person('creator', personName(author), fileAs(author), MARC.author);
  for (const translator of titleInfo.translators)
    person('contributor', personName(translator), fileAs(translator), MARC.translator);
  for (const entry of document.description.customInfo) {
    const role = ROLE_BY_LABEL[entry.infoType as FbdMakerLabel];
    if (!role) continue;
    const name = readFbdMakerName(entry.text);
    const display = [name.first, name.middle, name.last].filter((part) => part.trim()).join(' ');
    person(
      'contributor',
      display,
      fileAs({ firstName: name.first, middleName: name.middle, lastName: name.last }),
      role,
    );
  }
  const subjects = new Set<string>();
  for (const genre of titleInfo.genres)
    subjects.add(input.genreNames?.get(genre.code) ?? genre.code);
  for (const keyword of (titleInfo.keywords ?? '').split(','))
    if (keyword.trim()) subjects.add(keyword.trim());
  for (const subject of subjects) meta.push(`<dc:subject>${text(subject)}</dc:subject>`);
  if (titleInfo.annotation) {
    const description = plainText((titleInfo.annotation as AnnotationNode).content);
    if (description) meta.push(`<dc:description>${text(description)}</dc:description>`);
  }
  const year = (document.description.publishInfo?.year ?? '').trim();
  const dateValue = (titleInfo.date?.value ?? '').trim();
  const date = /^\d{4}$/.test(year)
    ? year
    : /^\d{4}(-\d{2}(-\d{2})?)?$/.test(dateValue)
      ? dateValue
      : '';
  if (date) meta.push(`<dc:date>${date}</dc:date>`);
  const publisher = (document.description.publishInfo?.publisher ?? '').trim();
  if (publisher) meta.push(`<dc:publisher>${text(publisher)}</dc:publisher>`);
  const isbn = (document.description.publishInfo?.isbn ?? '').replace(/\s+/g, '');
  if (isbn) meta.push(`<dc:identifier id="isbn">urn:isbn:${text(isbn)}</dc:identifier>`);
  flattenSequences(titleInfo.sequences)
    .filter((sequence) => sequence.name.trim())
    .forEach((sequence, index) => {
      const id = `series${index + 1}`;
      meta.push(
        `<meta property="belongs-to-collection" id="${id}">${text(sequence.name.trim())}</meta>`,
      );
      meta.push(`<meta refines="#${id}" property="collection-type">series</meta>`);
      if (sequence.number)
        meta.push(`<meta refines="#${id}" property="group-position">${sequence.number}</meta>`);
      if (index === 0) {
        meta.push(`<meta name="calibre:series" content="${attr(sequence.name.trim())}"/>`);
        if (sequence.number)
          meta.push(`<meta name="calibre:series_index" content="${sequence.number}"/>`);
      }
    });
  meta.push(`<meta property="dcterms:modified">${isoSeconds(input.modified)}</meta>`);
  // D43: what the book shows to be true, and no claim of conformance.
  const hasPictures = counts.pictures > 0;
  const allAlt = counts.withoutAlt === 0;
  meta.push('<meta property="schema:accessMode">textual</meta>');
  if (hasPictures) meta.push('<meta property="schema:accessMode">visual</meta>');
  meta.push(
    `<meta property="schema:accessModeSufficient">${hasPictures && !allAlt ? 'textual,visual' : 'textual'}</meta>`,
  );
  meta.push('<meta property="schema:accessibilityFeature">tableOfContents</meta>');
  meta.push('<meta property="schema:accessibilityFeature">readingOrder</meta>');
  if (hasPictures && allAlt)
    meta.push('<meta property="schema:accessibilityFeature">alternativeText</meta>');
  meta.push('<meta property="schema:accessibilityHazard">none</meta>');
  const summaryText = !hasPictures
    ? words.summaryTextOnly
    : allAlt
      ? words.summaryAllAlt
      : words.summarySomeAlt;
  meta.push(`<meta property="schema:accessibilitySummary">${text(summaryText)}</meta>`);
  // D7: the whole description, for the editor's own import (research DP-9).
  meta.push(
    `<meta property="mfbe:fb2-description">${text(JSON.stringify(document.description))}</meta>`,
  );
  // D34: the book's stylesheets as they are, so that the editor's own import gives them back exactly
  // (the EPUB's CSS is a translation of them).
  if (document.stylesheets.length > 0) {
    const sheets = document.stylesheets.map(({ type, content }) => ({ type, content }));
    meta.push(`<meta property="mfbe:fb2-stylesheets">${text(JSON.stringify(sheets))}</meta>`);
  }
  if (coverItem) meta.push(`<meta name="cover" content="${coverItem.id}"/>`);

  const guide: string[] = [];
  if (coverPicture)
    guide.push(`<reference type="cover" title="${attr(words.cover)}" href="text/cover.xhtml"/>`);
  guide.push(
    `<reference type="title-page" title="${attr(words.titlePage)}" href="text/title.xhtml"/>`,
  );
  guide.push(
    `<reference type="text" title="${attr(words.start)}" href="${attr(relativePath('EPUB/package.opf', firstTextPage))}"/>`,
  );

  files.push({
    name: 'EPUB/package.opf',
    mediaType: 'application/oebps-package+xml',
    text:
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${attr(lang)}"` +
      ` prefix="mfbe: https://github.com/QuarkZimmerman/MaximaFictionBookEditor/ns/epub#">\n` +
      `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n${meta.join('\n')}\n</metadata>\n` +
      `<manifest>\n${items.join('\n')}\n</manifest>\n` +
      `<spine toc="ncx">\n${spine.join('\n')}\n</spine>\n` +
      `<guide>\n${guide.join('\n')}\n</guide>\n</package>\n`,
  });
  files.push({
    name: 'META-INF/container.xml',
    mediaType: 'application/xml',
    text:
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n' +
      '<rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles>\n' +
      '</container>\n',
  });

  return {
    files,
    summary,
    identifier,
    counts: {
      pages: drafts.length,
      sections: sectionCount,
      pictures: counts.pictures,
      tables: counts.tables,
      notes: counts.notes,
    },
  };
}

/**
 * D4, FR-005: the export's own check of its result before anything is written - every link and
 * picture of every page resolves, every file is in the package, and every id is unique in its page.
 * Returns the faults found (none for a good result).
 */
export function verifyEpub(files: readonly EpubFile[], pictureNames: readonly string[]): string[] {
  const faults: string[] = [];
  const names = new Set([...files.map((file) => file.name), ...pictureNames]);
  const idsOf = new Map<string, Set<string>>();
  for (const file of files) {
    if (file.mediaType !== XHTML) continue;
    const seen = new Set<string>();
    for (const match of file.text.matchAll(/\sid="([^"]+)"/g)) {
      if (seen.has(match[1]!)) faults.push(`${file.name}: id "${match[1]}" twice`);
      seen.add(match[1]!);
    }
    idsOf.set(file.name, seen);
  }
  const resolveFrom = (from: string, href: string): string => {
    const parts = (folderOf(from) + href).split('/');
    const out: string[] = [];
    for (const part of parts) {
      if (part === '..') out.pop();
      else if (part !== '.' && part !== '') out.push(part);
    }
    return out.join('/');
  };
  for (const file of files) {
    if (file.mediaType !== XHTML && !file.name.endsWith('.ncx') && !file.name.endsWith('.opf'))
      continue;
    for (const match of file.text.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
      const href = match[1]!.replace(/&amp;/g, '&');
      if (/^(https?|mailto|ftp):/i.test(href)) continue;
      const [path, fragment] = href.split('#');
      const target = path ? resolveFrom(file.name, path) : file.name;
      if (!names.has(target)) {
        faults.push(`${file.name}: ${href} names no file of the EPUB`);
        continue;
      }
      if (fragment && idsOf.has(target) && !idsOf.get(target)!.has(fragment)) {
        faults.push(`${file.name}: ${href} names no element`);
      }
    }
  }
  const opf = files.find((file) => file.name === 'EPUB/package.opf');
  if (opf) {
    for (const file of files) {
      if (file.name === 'EPUB/package.opf' || file.name.startsWith('META-INF/')) continue;
      if (!opf.text.includes(`href="${relativePath('EPUB/package.opf', file.name)}"`))
        faults.push(`${file.name}: not in the package`);
    }
  }
  return faults;
}
