/**
 * Feature 010, US8 (spec D30): the imported book's FB2 text - the template's description, as
 * File > New makes it, with the front matter's data in the places FB2 gives them, then the
 * converter's bodies. Runs where the DOM is (the converter's worker has none).
 */

import type {
  ConvertResult,
  MarkdownDescription,
  MarkdownPerson,
  MarkdownSequence,
  MarkdownStylesheet,
} from './convert';

const FB2_NS = 'http://www.gribuser.ru/xml/fictionbook/2.0';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** The children of `title-info` in the order of the FB2 schema. */
const TITLE_INFO_ORDER = [
  'genre',
  'author',
  'book-title',
  'annotation',
  'keywords',
  'date',
  'coverpage',
  'lang',
  'src-lang',
  'translator',
  'sequence',
] as const;

type TitleInfoChild = (typeof TITLE_INFO_ORDER)[number];

function element(doc: Document, name: string, text?: string): Element {
  const node = doc.createElementNS(FB2_NS, name);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Replaces the `name` children of `titleInfo` by `nodes`, at the schema's place. */
function replaceChildren(titleInfo: Element, name: TitleInfoChild, nodes: Element[]): void {
  for (const child of Array.from(titleInfo.children)) {
    if (child.localName === name) titleInfo.removeChild(child);
  }
  const rank = TITLE_INFO_ORDER.indexOf(name);
  const before =
    Array.from(titleInfo.children).find((child) => {
      const at = TITLE_INFO_ORDER.indexOf(child.localName as TitleInfoChild);
      return at > rank;
    }) ?? null;
  for (const node of nodes) titleInfo.insertBefore(node, before);
}

function personElement(doc: Document, person: MarkdownPerson, name = 'author'): Element {
  const author = element(doc, name);
  if (person.firstName) author.appendChild(element(doc, 'first-name', person.firstName));
  if (person.middleName) author.appendChild(element(doc, 'middle-name', person.middleName));
  if (person.lastName) author.appendChild(element(doc, 'last-name', person.lastName));
  if (person.nickname) author.appendChild(element(doc, 'nickname', person.nickname));
  return author;
}

function applyDescription(doc: Document, titleInfo: Element, data: MarkdownDescription): void {
  replaceChildren(titleInfo, 'book-title', [element(doc, 'book-title', data.title)]);
  if (data.authors.length) {
    replaceChildren(
      titleInfo,
      'author',
      data.authors.map((person) => personElement(doc, person)),
    );
  }
  if (data.genres.length) {
    replaceChildren(
      titleInfo,
      'genre',
      data.genres.map((code) => element(doc, 'genre', code)),
    );
  }
  if (data.annotation.length) {
    const annotation = element(doc, 'annotation');
    for (const paragraph of data.annotation) annotation.appendChild(element(doc, 'p', paragraph));
    replaceChildren(titleInfo, 'annotation', [annotation]);
  }
  if (data.keywords)
    replaceChildren(titleInfo, 'keywords', [element(doc, 'keywords', data.keywords)]);
  if (data.date) {
    const date = element(doc, 'date', data.date);
    if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(data.date)) date.setAttribute('value', data.date);
    replaceChildren(titleInfo, 'date', [date]);
  }
  if (data.cover) {
    const coverpage = element(doc, 'coverpage');
    const image = element(doc, 'image');
    image.setAttributeNS(XLINK_NS, 'l:href', data.cover);
    coverpage.appendChild(image);
    replaceChildren(titleInfo, 'coverpage', [coverpage]);
  }
  if (data.lang) replaceChildren(titleInfo, 'lang', [element(doc, 'lang', data.lang)]);
  if (data.srcLang)
    replaceChildren(titleInfo, 'src-lang', [element(doc, 'src-lang', data.srcLang)]);
  if (data.translators.length) {
    replaceChildren(
      titleInfo,
      'translator',
      data.translators.map((person) => personElement(doc, person, 'translator')),
    );
  }
  const sequences = data.sequences.length ? data.sequences : data.sequence ? [data.sequence] : [];
  if (sequences.length) {
    replaceChildren(
      titleInfo,
      'sequence',
      sequences.map((one) => sequenceElement(doc, one)),
    );
  }
}

function sequenceElement(doc: Document, one: MarkdownSequence): Element {
  const sequence = element(doc, 'sequence');
  sequence.setAttribute('name', one.name);
  if (one.number !== undefined) sequence.setAttribute('number', String(one.number));
  return sequence;
}

function dateElement(doc: Document, text: string): Element {
  const date = element(doc, 'date', text);
  if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(text)) date.setAttribute('value', text);
  return date;
}

/** An empty author, which the schema accepts (feature 011, US1): for a required author list. */
function emptyAuthor(doc: Document): Element {
  const author = element(doc, 'author');
  author.appendChild(element(doc, 'first-name'));
  author.appendChild(element(doc, 'last-name'));
  return author;
}

/**
 * Feature 011 (US7, D29): the description's other parts the editor's export wrote - the source
 * book's information, the document's, the publisher's and the custom information - in the places
 * and the order the FB2 schema gives them.
 */
function applyOtherParts(doc: Document, description: Element, data: MarkdownDescription): void {
  const titleInfo = description.getElementsByTagNameNS(FB2_NS, 'title-info')[0]!;
  const after = (node: Element, reference: Element | null) =>
    description.insertBefore(node, reference ? reference.nextSibling : description.firstChild);
  const child = (name: string) =>
    Array.from(description.children).find((one) => one.localName === name) ?? null;
  if (data.source) {
    child('src-title-info')?.remove();
    const source = element(doc, 'src-title-info');
    // The schema's required children: the book's genres, an author, the title, a language.
    for (const genre of Array.from(titleInfo.children).filter((one) => one.localName === 'genre')) {
      source.appendChild(genre.cloneNode(true));
    }
    const authors = data.source.authors.length
      ? data.source.authors.map((person) => personElement(doc, person))
      : [emptyAuthor(doc)];
    for (const author of authors) source.appendChild(author);
    source.appendChild(element(doc, 'book-title', data.source.title ?? ''));
    const lang = data.source.lang ?? data.srcLang ?? data.lang;
    source.appendChild(element(doc, 'lang', lang ?? 'en'));
    for (const one of data.source.sequences) source.appendChild(sequenceElement(doc, one));
    after(source, titleInfo);
  }
  if (data.document) {
    const info =
      child('document-info') ??
      after(element(doc, 'document-info'), child('src-title-info') ?? titleInfo);
    const keep = (name: string) =>
      Array.from(info.children).filter((one) => one.localName === name);
    const authors = data.document.authors.length
      ? data.document.authors.map((person) => personElement(doc, person))
      : keep('author');
    const program = data.document.program
      ? [element(doc, 'program-used', data.document.program)]
      : keep('program-used');
    const date = data.document.date ? [dateElement(doc, data.document.date)] : keep('date');
    const urls = data.document.srcUrls.length
      ? data.document.srcUrls.map((url) => element(doc, 'src-url', url))
      : keep('src-url');
    const ocr = data.document.srcOcr
      ? [element(doc, 'src-ocr', data.document.srcOcr)]
      : keep('src-ocr');
    const id = data.document.id ? [element(doc, 'id', data.document.id)] : keep('id');
    const version = data.document.version
      ? [element(doc, 'version', data.document.version)]
      : keep('version');
    let history = keep('history');
    if (data.document.history.length) {
      const node = element(doc, 'history');
      for (const paragraph of data.document.history) node.appendChild(element(doc, 'p', paragraph));
      history = [node];
    }
    const publishers = keep('publisher');
    while (info.firstChild) info.removeChild(info.firstChild);
    for (const node of [
      ...authors,
      ...program,
      ...date,
      ...urls,
      ...ocr,
      ...id,
      ...version,
      ...history,
      ...publishers,
    ]) {
      info.appendChild(node);
    }
  }
  if (data.publish) {
    child('publish-info')?.remove();
    const info = element(doc, 'publish-info');
    const add = (name: string, text?: string) => {
      if (text) info.appendChild(element(doc, name, text));
    };
    add('book-name', data.publish.bookName);
    add('publisher', data.publish.publisher);
    add('city', data.publish.city);
    add('year', data.publish.year);
    add('isbn', data.publish.isbn);
    for (const one of data.publish.sequences) info.appendChild(sequenceElement(doc, one));
    after(info, child('document-info') ?? titleInfo);
  }
  if (data.custom.length) {
    for (const old of Array.from(description.children).filter(
      (one) => one.localName === 'custom-info',
    )) {
      old.remove();
    }
    let reference = child('publish-info') ?? child('document-info') ?? titleInfo;
    for (const item of data.custom) {
      const info = element(doc, 'custom-info', item.text);
      info.setAttribute('info-type', item.type);
      after(info, reference);
      reference = info;
    }
  }
}

/** The stylesheets as FB2 elements before the description (D45, D46). */
function stylesheetsXml(stylesheets: readonly MarkdownStylesheet[]): string {
  return stylesheets
    .map((sheet) => {
      const text = sheet.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<stylesheet type="${sheet.type.replace(/"/g, '&quot;')}">${text}</stylesheet>`;
    })
    .join('');
}

/** The whole FB2 text of the imported book (without its pictures, which follow by RPC). */
export function buildBook(templateXml: string, result: ConvertResult): string {
  const doc = new DOMParser().parseFromString(templateXml, 'application/xml');
  const description = doc.getElementsByTagNameNS(FB2_NS, 'description')[0];
  const titleInfo = description?.getElementsByTagNameNS(FB2_NS, 'title-info')[0];
  if (!description || !titleInfo) throw new Error('the template has no description');
  applyDescription(doc, titleInfo, result.description);
  applyOtherParts(doc, description, result.description);
  const descriptionXml = new XMLSerializer().serializeToString(description);
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n<FictionBook xmlns="${FB2_NS}" xmlns:l="${XLINK_NS}">` +
    `${stylesheetsXml(result.stylesheets ?? [])}${descriptionXml}${result.bodyXml}${result.notesXml ?? ''}</FictionBook>\n`
  );
}
