/**
 * Feature 010, US8 (spec D30): the imported book's FB2 text - the template's description, as
 * File > New makes it, with the front matter's data in the places FB2 gives them, then the
 * converter's bodies. Runs where the DOM is (the converter's worker has none).
 */

import type { ConvertResult, MarkdownDescription, MarkdownPerson } from './convert';

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

function personElement(doc: Document, person: MarkdownPerson): Element {
  const author = element(doc, 'author');
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
  if (data.sequence) {
    const sequence = element(doc, 'sequence');
    sequence.setAttribute('name', data.sequence.name);
    if (data.sequence.number !== undefined) {
      sequence.setAttribute('number', String(data.sequence.number));
    }
    replaceChildren(titleInfo, 'sequence', [sequence]);
  }
}

/** The whole FB2 text of the imported book (without its pictures, which follow by RPC). */
export function buildBook(templateXml: string, result: ConvertResult): string {
  const doc = new DOMParser().parseFromString(templateXml, 'application/xml');
  const description = doc.getElementsByTagNameNS(FB2_NS, 'description')[0];
  const titleInfo = description?.getElementsByTagNameNS(FB2_NS, 'title-info')[0];
  if (!description || !titleInfo) throw new Error('the template has no description');
  applyDescription(doc, titleInfo, result.description);
  const descriptionXml = new XMLSerializer().serializeToString(description);
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n<FictionBook xmlns="${FB2_NS}" xmlns:l="${XLINK_NS}">` +
    `${descriptionXml}${result.bodyXml}${result.notesXml ?? ''}</FictionBook>\n`
  );
}
