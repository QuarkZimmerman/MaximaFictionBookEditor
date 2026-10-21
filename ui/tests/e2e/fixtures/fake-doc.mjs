/**
 * Document handlers of the fake core (`fake-core.mjs`): a dependency-free, deliberately
 * simplistic stand-in for the C++ `doc.*` RPC handlers so the UI can be developed and the
 * Playwright journeys exercised before the real core lands. Honest to the contract shapes of
 * rpc-api.md §3.2 / document-model.d.ts, not to the fidelity of the real reader/writer:
 *
 *  - a small XML tokenizer/tree builder reporting well-formedness errors with line/column;
 *  - FB2 -> Document (description, bodies with nodeIds, marks, inline images, unknown elements
 *    as raw-xml, binaries decoded into memory) and Document -> FB2 2.1 text (binaries elided
 *    as `...N bytes...` placeholders when asked);
 *  - encodings: BOM/declaration detection, TextDecoder for reading, utf-8/utf-16/single-byte
 *    tables for writing;
 *  - atomic save (temp file + rename) with the `test.injectFault` points, a validation that
 *    checks the required description fields, recent files (<= 10) and remembered positions (positions.json, 100 files),
 *    external-change polling (`doc.changedOnDisk` every 500 ms).
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/* ------------------------------------------------------------------------ */
/* Errors                                                                   */
/* ------------------------------------------------------------------------ */

export function rpcError(code, message, data) {
  const error = new Error(message);
  error.code = code;
  if (data !== undefined) error.data = data;
  return error;
}

/* ------------------------------------------------------------------------ */
/* Minimal XML parser                                                       */
/* ------------------------------------------------------------------------ */

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body] ?? match;
  });
}

function escapeText(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(text) {
  return escapeText(text).replace(/"/g, '&quot;');
}

class ParseError extends Error {
  constructor(message, line, column) {
    super(message);
    this.line = line;
    this.column = column;
  }
}

/** Parses `text` into `{ declaration, root }`; throws ParseError with line/column. */
export function parseXml(text) {
  let pos = 0;
  const stack = [];
  let root = null;
  let declaration = null;
  const lineStarts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') lineStarts.push(i + 1);
  const location = (offset) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - lineStarts[lo] + 1 };
  };
  const fail = (message, offset) => {
    const { line, column } = location(offset);
    throw new ParseError(message, line, column);
  };
  const current = () => stack[stack.length - 1];
  const addText = (value) => {
    const parent = current();
    if (!parent) {
      if (value.trim() !== '') fail('Text outside of the root element', pos);
      return;
    }
    const last = parent.children[parent.children.length - 1];
    if (typeof last === 'string') parent.children[parent.children.length - 1] = last + value;
    else parent.children.push(value);
  };

  while (pos < text.length) {
    const lt = text.indexOf('<', pos);
    if (lt < 0) {
      addText(decodeEntities(text.slice(pos)));
      pos = text.length;
      break;
    }
    if (lt > pos) addText(decodeEntities(text.slice(pos, lt)));
    if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt);
      if (end < 0) fail('Unterminated processing instruction', lt);
      const body = text.slice(lt + 2, end);
      if (body.startsWith('xml')) declaration = body;
      pos = end + 2;
      continue;
    }
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt);
      if (end < 0) fail('Unterminated comment', lt);
      pos = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt);
      if (end < 0) fail('Unterminated CDATA section', lt);
      addText(text.slice(lt + 9, end));
      pos = end + 3;
      continue;
    }
    if (text.startsWith('<!', lt)) {
      const end = text.indexOf('>', lt);
      if (end < 0) fail('Unterminated declaration', lt);
      pos = end + 1;
      continue;
    }
    if (text.startsWith('</', lt)) {
      const end = text.indexOf('>', lt);
      if (end < 0) fail('Unterminated end tag', lt);
      const name = text.slice(lt + 2, end).trim();
      const open = current();
      if (!open) fail(`Unexpected end tag </${name}>`, lt);
      if (open.name !== name) {
        fail(`Opening and ending tag mismatch: ${open.name} and ${name}`, lt);
      }
      stack.pop();
      pos = end + 1;
      continue;
    }
    // start tag
    const nameMatch = /^<([A-Za-z_:][\w.:-]*)/.exec(text.slice(lt, lt + 200));
    if (!nameMatch) fail('Invalid element name', lt + 1);
    const name = nameMatch[1];
    let cursor = lt + 1 + name.length;
    const attrs = {};
    let selfClosing = false;
    for (;;) {
      while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
      if (cursor >= text.length) fail(`Unterminated start tag <${name}>`, lt);
      if (text[cursor] === '>') {
        cursor += 1;
        break;
      }
      if (text.startsWith('/>', cursor)) {
        selfClosing = true;
        cursor += 2;
        break;
      }
      const attrMatch = /^([A-Za-z_:][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/.exec(
        text.slice(cursor, cursor + 4000),
      );
      if (!attrMatch) fail(`Malformed attribute in <${name}>`, cursor);
      attrs[attrMatch[1]] = decodeEntities(attrMatch[3] ?? attrMatch[4] ?? '');
      cursor += attrMatch[0].length;
    }
    const element = { name, attrs, children: [], start: location(lt) };
    const parent = current();
    if (parent) parent.children.push(element);
    else if (root) fail('Extra content at the end of the document', lt);
    else root = element;
    if (!selfClosing) stack.push(element);
    pos = cursor;
  }
  if (stack.length > 0) {
    const open = current();
    fail(`Premature end of data in tag ${open.name}`, text.length);
  }
  if (!root) fail('Document is empty', 0);
  return { declaration, root };
}

/* ------------------------------------------------------------------------ */
/* Encodings                                                                */
/* ------------------------------------------------------------------------ */

export const ENCODINGS = [
  'utf-8',
  'utf-16',
  'windows-1251',
  'windows-1252',
  'iso-8859-1',
  'iso-8859-2',
  'iso-8859-5',
  'iso-8859-15',
  'koi8-r',
];

export function normalizeEncoding(name) {
  if (!name) return null;
  const lower = String(name).trim().toLowerCase().replace(/_/g, '-');
  const compact = lower.replace(/-/g, '');
  for (const e of ENCODINGS) if (e === lower || e.replace(/-/g, '') === compact) return e;
  if (/^(cp|win|windows)?1251$/.test(compact)) return 'windows-1251';
  if (/^(cp|win|windows)?1252$/.test(compact)) return 'windows-1252';
  if (compact === 'utf16le' || compact === 'utf16be') return 'utf-16';
  if (compact === 'latin1') return 'iso-8859-1';
  if (compact === 'koi8r') return 'koi8-r';
  return null;
}

/** Detects the encoding (BOM, then declaration) and decodes `bytes`. */
export function decodeBytes(bytes) {
  let encoding = null;
  let body = bytes;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = 'utf-16';
    body = bytes.subarray(2);
    return { encoding, text: Buffer.from(body).toString('utf16le') };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = 'utf-16';
    body = Buffer.from(bytes.subarray(2));
    body.swap16();
    return { encoding, text: body.toString('utf16le') };
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    encoding = 'utf-8';
    body = bytes.subarray(3);
  }
  const head = Buffer.from(bytes.subarray(0, 300)).toString('latin1');
  const declared = /encoding\s*=\s*["']([^"']+)["']/.exec(head);
  const detected = encoding ?? normalizeEncoding(declared?.[1]) ?? 'utf-8';
  const decoder = new TextDecoder(detected === 'utf-16' ? 'utf-16le' : detected, { fatal: false });
  return { encoding: detected, text: decoder.decode(body) };
}

const singleByteTables = new Map();

function singleByteTable(encoding) {
  let table = singleByteTables.get(encoding);
  if (!table) {
    table = new Map();
    const decoder = new TextDecoder(encoding);
    for (let byte = 0; byte < 256; byte += 1) {
      const char = decoder.decode(Uint8Array.of(byte));
      if (!table.has(char)) table.set(char, byte);
    }
    singleByteTables.set(encoding, table);
  }
  return table;
}

/** Encodes `text` (whose declaration already names `encoding`). */
export function encodeText(text, encoding) {
  if (encoding === 'utf-8') return Buffer.from(text, 'utf8');
  if (encoding === 'utf-16') {
    return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  }
  const table = singleByteTable(encoding);
  const out = Buffer.alloc(text.length);
  let n = 0;
  for (const char of text) {
    const byte = table.get(char);
    out[n] = byte === undefined ? 0x3f : byte;
    n += 1;
  }
  return out.subarray(0, n);
}

/* ------------------------------------------------------------------------ */
/* FB2 -> Document                                                          */
/* ------------------------------------------------------------------------ */

const INLINE_MARKS = {
  strong: 'strong',
  emphasis: 'emphasis',
  strikethrough: 'strikethrough',
  sub: 'sub',
  sup: 'sup',
  code: 'code',
};
const BLOCK_TYPES = new Set([
  'section',
  'title',
  'epigraph',
  'annotation',
  'p',
  'subtitle',
  'text-author',
  'v',
  'empty-line',
  'poem',
  'stanza',
  'date',
  'cite',
  'table',
  'tr',
  'td',
  'th',
  'image',
]);
const INLINE_PARENTS = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);
const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/bmp',
  'image/webp',
  'image/tiff',
]);

function hrefOf(attrs) {
  for (const key of Object.keys(attrs)) {
    if (key === 'href' || key.endsWith(':href')) return attrs[key];
  }
  return undefined;
}

function textOf(element) {
  if (!element) return '';
  return element.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
}

function childrenNamed(element, name) {
  return element ? element.children.filter((c) => typeof c !== 'string' && c.name === name) : [];
}

function child(element, name) {
  return childrenNamed(element, name)[0];
}

function serializeElement(element) {
  const attrs = Object.entries(element.attrs)
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join('');
  if (element.children.length === 0) return `<${element.name}${attrs}/>`;
  const inner = element.children
    .map((c) => (typeof c === 'string' ? escapeText(c) : serializeElement(c)))
    .join('');
  return `<${element.name}${attrs}>${inner}</${element.name}>`;
}

function parsePerson(element) {
  const person = { homePages: [], emails: [] };
  const put = (name, key) => {
    const value = textOf(child(element, name)).trim();
    if (value) person[key] = value;
  };
  put('first-name', 'firstName');
  put('middle-name', 'middleName');
  put('last-name', 'lastName');
  put('nickname', 'nickname');
  put('id', 'id');
  person.homePages = childrenNamed(element, 'home-page').map((e) => textOf(e).trim());
  person.emails = childrenNamed(element, 'email').map((e) => textOf(e).trim());
  return person;
}

function parseSequence(element) {
  const sequence = { name: element.attrs.name ?? '', children: [] };
  if (element.attrs.number !== undefined && element.attrs.number !== '') {
    const number = Number(element.attrs.number);
    if (Number.isFinite(number)) sequence.number = number;
  }
  if (element.attrs['xml:lang']) sequence.lang = element.attrs['xml:lang'];
  sequence.children = childrenNamed(element, 'sequence').map(parseSequence);
  return sequence;
}

function parseDate(element) {
  if (!element) return undefined;
  const date = { text: textOf(element).trim() };
  if (element.attrs.value) date.value = element.attrs.value;
  if (element.attrs['xml:lang']) date.lang = element.attrs['xml:lang'];
  return date;
}

function parseTitleInfo(element, ids) {
  const info = {
    genres: childrenNamed(element, 'genre').map((g) => {
      const genre = { code: textOf(g).trim() };
      const match = Number(g.attrs.match);
      if (g.attrs.match !== undefined && Number.isFinite(match) && match !== 100)
        genre.match = match;
      return genre;
    }),
    authors: childrenNamed(element, 'author').map(parsePerson),
    bookTitle: textOf(child(element, 'book-title')).trim(),
    coverpage: childrenNamed(child(element, 'coverpage'), 'image').map((img) => {
      const ref = { href: hrefOf(img.attrs) ?? '' };
      if (img.attrs.alt) ref.alt = img.attrs.alt;
      if (img.attrs.title) ref.title = img.attrs.title;
      if (img.attrs.id) ref.id = img.attrs.id;
      return ref;
    }),
    lang: textOf(child(element, 'lang')).trim(),
    translators: childrenNamed(element, 'translator').map(parsePerson),
    sequences: childrenNamed(element, 'sequence').map(parseSequence),
  };
  const annotation = child(element, 'annotation');
  if (annotation) info.annotation = convertBlock(annotation, ids);
  const keywords = textOf(child(element, 'keywords')).trim();
  if (keywords) info.keywords = keywords;
  const date = parseDate(child(element, 'date'));
  if (date) info.date = date;
  const srcLang = textOf(child(element, 'src-lang')).trim();
  if (srcLang) info.srcLang = srcLang;
  return info;
}

function parseDocumentInfo(element, ids) {
  const info = {
    authors: childrenNamed(element, 'author').map(parsePerson),
    date: parseDate(child(element, 'date')) ?? { text: '' },
    srcUrls: childrenNamed(element, 'src-url').map((e) => textOf(e).trim()),
    id: textOf(child(element, 'id')).trim(),
    version: textOf(child(element, 'version')).trim(),
    publishers: childrenNamed(element, 'publisher').map(parsePerson),
  };
  const programUsed = textOf(child(element, 'program-used')).trim();
  if (programUsed) info.programUsed = programUsed;
  const srcOcr = textOf(child(element, 'src-ocr')).trim();
  if (srcOcr) info.srcOcr = srcOcr;
  const history = child(element, 'history');
  if (history) info.history = convertBlock(history, ids);
  return info;
}

function parsePublishInfo(element) {
  if (!element) return undefined;
  const info = { sequences: childrenNamed(element, 'sequence').map(parseSequence) };
  const put = (name, key) => {
    const value = textOf(child(element, name)).trim();
    if (value) info[key] = value;
  };
  put('book-name', 'bookName');
  put('publisher', 'publisher');
  put('city', 'city');
  put('year', 'year');
  put('isbn', 'isbn');
  return info;
}

/** Converts inline children (text, marks, inline images, unknown inline elements). */
function convertInline(children, marks, ids, out) {
  for (const node of children) {
    if (typeof node === 'string') {
      if (node.length === 0) continue;
      const text = { type: 'text', text: node };
      if (marks.length > 0) text.marks = marks.map((m) => ({ ...m }));
      out.push(text);
      continue;
    }
    if (INLINE_MARKS[node.name]) {
      convertInline(node.children, [...marks, { type: INLINE_MARKS[node.name] }], ids, out);
    } else if (node.name === 'style') {
      convertInline(
        node.children,
        [...marks, { type: 'style', attrs: { name: node.attrs.name ?? '' } }],
        ids,
        out,
      );
    } else if (node.name === 'a') {
      const attrs = { href: hrefOf(node.attrs) ?? '' };
      if (node.attrs.type) attrs.type = node.attrs.type;
      convertInline(node.children, [...marks, { type: 'link', attrs }], ids, out);
    } else if (node.name === 'image') {
      const attrs = { nodeId: ids(), href: hrefOf(node.attrs) ?? '' };
      if (node.attrs.alt) attrs.alt = node.attrs.alt;
      out.push({ type: 'inline-image', attrs });
    } else {
      out.push({
        type: 'raw-xml',
        attrs: { nodeId: ids(), xml: serializeElement(node), inline: true },
      });
    }
  }
}

function convertBlock(element, ids) {
  const name = element.name;
  if (!BLOCK_TYPES.has(name)) {
    return {
      type: 'raw-xml',
      attrs: { nodeId: ids(), xml: serializeElement(element), inline: false },
    };
  }
  const attrs = { nodeId: ids() };
  for (const [key, value] of Object.entries(element.attrs)) {
    if (key === 'xml:lang') attrs.lang = value;
    else if (key === 'href' || key.endsWith(':href')) attrs.href = value;
    else if (key.endsWith(':type'))
      continue; // xlink:type
    else if (key === 'colspan' || key === 'rowspan') attrs[key] = Number(value);
    else attrs[key] = value;
  }
  if (name === 'image') return { type: 'image', attrs: { href: '', ...attrs } };
  if (name === 'empty-line') return { type: 'empty-line', attrs };
  const node = { type: name, attrs, content: [] };
  if (INLINE_PARENTS.has(name)) {
    convertInline(element.children, [], ids, node.content);
  } else {
    for (const c of element.children) {
      if (typeof c === 'string') {
        if (c.trim() !== '') {
          // text directly in a container (legacy files): wrap it in a paragraph
          node.content.push({
            type: 'p',
            attrs: { nodeId: ids() },
            content: [{ type: 'text', text: c.trim() }],
          });
        }
        continue;
      }
      node.content.push(convertBlock(c, ids));
    }
  }
  return node;
}

function makeIds() {
  let counter = 0;
  return () => `n${++counter}`;
}

/** Full FB2 -> Document conversion. Binaries go to `binaryStore` (Map id -> {bytes, contentType}). */
export function fb2ToDocument(text, { docId, path: filePath, encoding, binaryStore }) {
  const { root } = parseXml(text);
  if (root.name !== 'FictionBook') {
    throw new ParseError(`Root element is <${root.name}>, expected <FictionBook>`, 1, 1);
  }
  const ids = makeIds();
  const description = child(root, 'description');
  const titleInfo = child(description, 'title-info');
  const documentInfo = child(description, 'document-info');
  const doc = {
    modelVersion: 1,
    docId,
    fileKind: fileKindOf(filePath),
    sourceEncoding: encoding,
    schemaHint: 'legacy',
    stylesheets: childrenNamed(root, 'stylesheet').map((s) => ({
      type: s.attrs.type ?? 'text/css',
      content: textOf(s),
    })),
    description: {
      titleInfo: titleInfo
        ? parseTitleInfo(titleInfo, ids)
        : {
            genres: [],
            authors: [],
            bookTitle: '',
            coverpage: [],
            lang: '',
            translators: [],
            sequences: [],
          },
      documentInfo: documentInfo
        ? parseDocumentInfo(documentInfo, ids)
        : { authors: [], date: { text: '' }, srcUrls: [], id: '', version: '', publishers: [] },
      customInfo: childrenNamed(description, 'custom-info').map((c) => {
        const info = { infoType: c.attrs['info-type'] ?? '', text: textOf(c) };
        if (c.attrs['xml:lang']) info.lang = c.attrs['xml:lang'];
        return info;
      }),
      outputs: childrenNamed(description, 'output').map((o) => ({
        type: 'raw-xml',
        attrs: { nodeId: ids(), xml: serializeElement(o), inline: false },
      })),
    },
    bodies: [],
    binaries: [],
    extras: [],
  };
  if (filePath) doc.path = filePath;
  const srcTitleInfo = child(description, 'src-title-info');
  if (srcTitleInfo) doc.description.srcTitleInfo = parseTitleInfo(srcTitleInfo, ids);
  const publishInfo = parsePublishInfo(child(description, 'publish-info'));
  if (publishInfo) doc.description.publishInfo = publishInfo;

  for (const c of root.children) {
    if (typeof c === 'string') continue;
    if (c.name === 'body') {
      const body = convertBlock({ ...c, name: 'section' }, ids);
      body.type = 'body';
      doc.bodies.push(body);
    } else if (c.name === 'binary') {
      const id = c.attrs.id ?? `binary${doc.binaries.length + 1}`;
      const contentType = c.attrs['content-type'] ?? 'application/octet-stream';
      const base64 = textOf(c).replace(/\s+/g, '');
      const placeholder = /^\u2026\d+ bytes\u2026$|^\.\.\.\d+ bytes\.\.\.$/.test(textOf(c).trim());
      let bytes;
      if (placeholder && binaryStore?.has(id)) {
        bytes = binaryStore.get(id).bytes;
      } else {
        bytes = Buffer.from(base64, 'base64');
        binaryStore?.set(id, { bytes, contentType });
      }
      const decodable = IMAGE_TYPES.has(contentType);
      doc.binaries.push({
        id,
        contentType,
        size: bytes.length,
        decodable,
        willConvert: decodable && contentType !== 'image/jpeg' && contentType !== 'image/png',
        referenceCount: countReferences(text, id),
      });
    } else if (!['description', 'stylesheet'].includes(c.name)) {
      doc.extras.push({
        type: 'raw-xml',
        attrs: { nodeId: ids(), xml: serializeElement(c), inline: false },
      });
    }
  }
  const valid = validateDocument(doc).errorCount === 0;
  doc.schemaHint = valid ? '2.1' : 'legacy';
  return doc;
}

function countReferences(text, id) {
  const needle = `href="#${id}"`;
  let count = 0;
  let index = text.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

export function fileKindOf(filePath) {
  const ext = (filePath ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === 'fbd') return 'fbd';
  if (ext === 'xml') return 'xml';
  return 'fb2';
}

/* ------------------------------------------------------------------------ */
/* Document -> FB2                                                          */
/* ------------------------------------------------------------------------ */

function tag(name, content, attrs = {}) {
  const attrText = Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => ` ${k}="${escapeAttr(String(v))}"`)
    .join('');
  if (content === undefined || content === null || content === '') return `<${name}${attrText}/>`;
  return `<${name}${attrText}>${content}</${name}>`;
}

function writePerson(name, person) {
  const parts = [];
  if (person.firstName) parts.push(tag('first-name', escapeText(person.firstName)));
  if (person.middleName) parts.push(tag('middle-name', escapeText(person.middleName)));
  if (person.lastName) parts.push(tag('last-name', escapeText(person.lastName)));
  if (person.nickname) parts.push(tag('nickname', escapeText(person.nickname)));
  for (const url of person.homePages ?? []) parts.push(tag('home-page', escapeText(url)));
  for (const email of person.emails ?? []) parts.push(tag('email', escapeText(email)));
  if (person.id) parts.push(tag('id', escapeText(person.id)));
  return tag(name, parts.join(''));
}

function writeSequence(sequence) {
  return tag('sequence', sequence.children.map(writeSequence).join(''), {
    name: sequence.name,
    number: sequence.number,
    'xml:lang': sequence.lang,
  });
}

function writeDate(date) {
  if (!date) return '';
  return tag('date', escapeText(date.text ?? ''), { value: date.value, 'xml:lang': date.lang });
}

function writeInline(nodes) {
  let out = '';
  for (const node of nodes ?? []) {
    if (node.type === 'text') {
      let text = escapeText(node.text ?? '');
      for (const mark of [...(node.marks ?? [])].reverse()) {
        if (mark.type === 'link') {
          text = tag('a', text, { 'l:href': mark.attrs?.href, type: mark.attrs?.type });
        } else if (mark.type === 'style') {
          text = tag('style', text, { name: mark.attrs?.name });
        } else {
          text = tag(mark.type, text);
        }
      }
      out += text;
    } else if (node.type === 'inline-image') {
      out += tag('image', '', { 'l:href': node.attrs.href, alt: node.attrs.alt });
    } else if (node.type === 'raw-xml') {
      out += node.attrs.xml ?? '';
    }
  }
  return out;
}

function nodeAttrs(node, extra = {}) {
  const { nodeId, lang, href, ...rest } = node.attrs ?? {};
  void nodeId;
  const attrs = { ...rest, ...extra };
  if (lang) attrs['xml:lang'] = lang;
  if (href !== undefined) attrs['l:href'] = href;
  return attrs;
}

function writeBlock(node, indent) {
  const pad = '\t'.repeat(indent);
  if (node.type === 'raw-xml') return `${pad}${node.attrs.xml}\n`;
  if (node.type === 'empty-line') return `${pad}<empty-line/>\n`;
  if (node.type === 'image') return `${pad}${tag('image', '', nodeAttrs(node))}\n`;
  if (INLINE_PARENTS.has(node.type)) {
    return `${pad}${tag(node.type, writeInline(node.content), nodeAttrs(node))}\n`;
  }
  const inner = (node.content ?? []).map((c) => writeBlock(c, indent + 1)).join('');
  const attrs = nodeAttrs(node);
  const attrText = Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => ` ${k}="${escapeAttr(String(v))}"`)
    .join('');
  return `${pad}<${node.type}${attrText}>\n${inner}${pad}</${node.type}>\n`;
}

function writeTitleInfo(name, info, indent) {
  const pad = '\t'.repeat(indent);
  const inner = '\t'.repeat(indent + 1);
  const lines = [];
  for (const genre of info.genres ?? []) {
    lines.push(tag('genre', escapeText(genre.code), { match: genre.match }));
  }
  for (const author of info.authors ?? []) lines.push(writePerson('author', author));
  lines.push(tag('book-title', escapeText(info.bookTitle ?? '')));
  if (info.annotation) {
    lines.push(writeBlock(info.annotation, indent + 1).trim());
  }
  if (info.keywords) lines.push(tag('keywords', escapeText(info.keywords)));
  if (info.date) lines.push(writeDate(info.date));
  if (info.coverpage?.length) {
    lines.push(
      tag(
        'coverpage',
        info.coverpage
          .map((img) =>
            tag('image', '', { 'l:href': img.href, alt: img.alt, title: img.title, id: img.id }),
          )
          .join(''),
      ),
    );
  }
  lines.push(tag('lang', escapeText(info.lang ?? '')));
  if (info.srcLang) lines.push(tag('src-lang', escapeText(info.srcLang)));
  for (const translator of info.translators ?? [])
    lines.push(writePerson('translator', translator));
  for (const sequence of info.sequences ?? []) lines.push(writeSequence(sequence));
  return `${pad}<${name}>\n${lines.map((l) => inner + l).join('\n')}\n${pad}</${name}>\n`;
}

export function documentToFb2(
  doc,
  { encoding = 'utf-8', elideBinaries = false, binaryStore } = {},
) {
  const d = doc.description;
  let out = `<?xml version="1.0" encoding="${encoding}"?>\n`;
  out +=
    '<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">\n';
  for (const sheet of doc.stylesheets ?? []) {
    out += `\t${tag('stylesheet', escapeText(sheet.content), { type: sheet.type })}\n`;
  }
  out += '\t<description>\n';
  out += writeTitleInfo('title-info', d.titleInfo, 2);
  if (d.srcTitleInfo) out += writeTitleInfo('src-title-info', d.srcTitleInfo, 2);
  const di = d.documentInfo;
  const docLines = [];
  for (const author of di.authors ?? []) docLines.push(writePerson('author', author));
  if (di.programUsed) docLines.push(tag('program-used', escapeText(di.programUsed)));
  docLines.push(writeDate(di.date ?? { text: '' }));
  for (const url of di.srcUrls ?? []) docLines.push(tag('src-url', escapeText(url)));
  if (di.srcOcr) docLines.push(tag('src-ocr', escapeText(di.srcOcr)));
  docLines.push(tag('id', escapeText(di.id ?? '')));
  docLines.push(tag('version', escapeText(di.version ?? '')));
  if (di.history) docLines.push(writeBlock(di.history, 3).trim());
  for (const publisher of di.publishers ?? []) docLines.push(writePerson('publisher', publisher));
  out += `\t\t<document-info>\n${docLines.map((l) => `\t\t\t${l}`).join('\n')}\n\t\t</document-info>\n`;
  if (d.publishInfo) {
    const p = d.publishInfo;
    const lines = [];
    if (p.bookName) lines.push(tag('book-name', escapeText(p.bookName)));
    if (p.publisher) lines.push(tag('publisher', escapeText(p.publisher)));
    if (p.city) lines.push(tag('city', escapeText(p.city)));
    if (p.year) lines.push(tag('year', escapeText(p.year)));
    if (p.isbn) lines.push(tag('isbn', escapeText(p.isbn)));
    for (const s of p.sequences ?? []) lines.push(writeSequence(s));
    out += `\t\t<publish-info>\n${lines.map((l) => `\t\t\t${l}`).join('\n')}\n\t\t</publish-info>\n`;
  }
  for (const info of d.customInfo ?? []) {
    out += `\t\t${tag('custom-info', escapeText(info.text), { 'info-type': info.infoType, 'xml:lang': info.lang })}\n`;
  }
  for (const output of d.outputs ?? []) out += `\t\t${output.attrs.xml}\n`;
  out += '\t</description>\n';
  for (const body of doc.bodies ?? []) out += writeBlock(body, 1);
  for (const extra of doc.extras ?? []) out += `\t${extra.attrs.xml}\n`;
  for (const binary of doc.binaries ?? []) {
    const stored = binaryStore?.get(binary.id);
    let payload;
    if (elideBinaries || !stored) {
      payload = `\u2026${binary.size} bytes\u2026`;
    } else {
      payload = stored.bytes.toString('base64').replace(/(.{76})/g, '$1\n');
    }
    out += `\t<binary id="${escapeAttr(binary.id)}" content-type="${escapeAttr(binary.contentType)}">${payload}</binary>\n`;
  }
  out += '</FictionBook>\n';
  return out;
}

/* ------------------------------------------------------------------------ */
/* Validation (required description fields only)                            */
/* ------------------------------------------------------------------------ */

export function validateDocument(doc) {
  const issues = [];
  const error = (code, params, extra = {}) =>
    issues.push({ severity: 'error', code, params, ...extra });
  const warning = (code, params, extra = {}) =>
    issues.push({ severity: 'warning', code, params, ...extra });
  const ti = doc.description?.titleInfo;
  const di = doc.description?.documentInfo;
  if (!ti?.genres?.length) error('validation.required', { element: 'genre' });
  if (!ti?.authors?.length) error('validation.required', { element: 'author' });
  if (!ti?.bookTitle) error('validation.required', { element: 'book-title' });
  if (!ti?.lang) error('validation.required', { element: 'lang' });
  if (!di?.authors?.length) error('validation.required', { element: 'document-info/author' });
  if (!di?.id) error('validation.required', { element: 'id' });
  if (!di?.version) error('validation.required', { element: 'version' });
  if (!doc.bodies?.length) error('validation.bodies.none', {});
  for (const body of doc.bodies ?? []) {
    if (!(body.content ?? []).some((c) => c.type === 'section')) {
      error(
        'validation.schema',
        { element: 'body', detail: 'missing section' },
        { nodeId: body.attrs?.nodeId },
      );
    }
  }
  for (const binary of doc.binaries ?? []) {
    if (binary.referenceCount === 0) warning('binary.unreferenced', { id: binary.id });
    if (binary.decodable && binary.willConvert) {
      warning('binary.notImage', { id: binary.id, contentType: binary.contentType });
    }
  }
  return {
    issues,
    errorCount: issues.filter((i) => i.severity === 'error').length,
    warningCount: issues.filter((i) => i.severity === 'warning').length,
    durationMs: 1,
  };
}

export function validateText(text) {
  try {
    const parsed = parseXml(text);
    void parsed;
  } catch (error) {
    return {
      issues: [
        {
          severity: 'error',
          code: 'validation.wellFormed',
          params: { message: error.message },
          line: error.line ?? 0,
          column: error.column ?? 0,
        },
      ],
      errorCount: 1,
      warningCount: 0,
      durationMs: 1,
    };
  }
  return validateDocument(
    fb2ToDocument(text, { docId: 'tmp', path: undefined, encoding: 'utf-8' }),
  );
}

/* ------------------------------------------------------------------------ */
/* Session state: documents, recent, positions, watcher, fault injection    */
/* ------------------------------------------------------------------------ */

export function createDocService({
  dataDir,
  broadcast,
  blankTemplate,
  restorePositionEnabled = () => true,
}) {
  const sessions = new Map(); // docId -> { path, binaries: Map, watcher, mtime, size, position }
  const recentPath = path.join(dataDir, 'recent.json');
  // The remembered positions (feature 004 US8, resource-formats §13): a record of its own
  // beside recent.json, 100 files, newest first, {path, at, position: {path, offset}}.
  const positionsPath = path.join(dataDir, 'positions.json');
  const MAX_POSITIONS = 100;
  const POSITION_PATH =
    /^(body\[[1-9]\d*\]|title-info\/annotation\[1\]|document-info\/history\[1\])(\/[a-z-]+\[[1-9]\d*\])*$/;
  let fault = 'none';
  let counter = 0;

  function loadRecent() {
    try {
      const parsed = JSON.parse(readFileSync(recentPath, 'utf8'));
      return Array.isArray(parsed.items) ? parsed.items : [];
    } catch {
      return [];
    }
  }
  let recent = loadRecent();
  function saveRecent() {
    try {
      writeFileSync(recentPath, JSON.stringify({ schemaVersion: 1, items: recent }, null, 2));
    } catch {
      // the fake core does not care
    }
  }
  function touchRecent(filePath) {
    recent = [
      { path: filePath, lastOpened: new Date().toISOString() },
      ...recent.filter((item) => item.path !== filePath),
    ].slice(0, 10);
    saveRecent();
  }

  function loadPositions() {
    try {
      const parsed = JSON.parse(readFileSync(positionsPath, 'utf8'));
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.items)) return [];
      return parsed.items.filter(
        (item) =>
          item &&
          typeof item.path === 'string' &&
          item.path &&
          item.position &&
          POSITION_PATH.test(item.position.path ?? '') &&
          Number.isInteger(item.position.offset) &&
          item.position.offset >= 0,
      );
    } catch {
      return [];
    }
  }
  let positions = loadPositions();
  function savePositions() {
    try {
      writeFileSync(positionsPath, JSON.stringify({ schemaVersion: 1, items: positions }, null, 2));
    } catch {
      // the fake core does not care
    }
  }
  function rememberPosition(filePath, position) {
    positions = [
      { path: filePath, at: new Date().toISOString(), position },
      ...positions.filter((item) => item.path !== filePath),
    ].slice(0, MAX_POSITIONS);
    savePositions();
  }
  function positionOf(filePath) {
    return positions.find((item) => item.path === filePath)?.position;
  }
  function pruneRecent(filePath) {
    recent = recent.filter((item) => item.path !== filePath);
    saveRecent();
  }

  function newSession(filePath) {
    counter += 1;
    const docId = `doc-${counter}`;
    sessions.set(docId, { path: filePath, binaries: new Map(), watcher: null, mtime: 0, size: 0 });
    return docId;
  }

  function session(docId) {
    const s = sessions.get(docId);
    if (!s) throw rpcError(1000, `doc.notFound: ${docId}`);
    return s;
  }

  function parseErrorOf(error, filePath) {
    if (error instanceof ParseError) {
      return rpcError(1001, `doc.parseError: ${error.message}`, {
        line: error.line,
        column: error.column,
        message: error.message,
        path: filePath,
      });
    }
    return error;
  }

  function statOf(filePath) {
    try {
      const st = statSync(filePath);
      return { mtime: st.mtimeMs, size: st.size };
    } catch {
      return { mtime: 0, size: 0 };
    }
  }

  function stopWatcher(s) {
    if (s.watcher) {
      clearInterval(s.watcher);
      s.watcher = null;
    }
  }

  const methods = {
    'doc.new': () => {
      const docId = newSession(undefined);
      const text = blankTemplate.replace(/\{uuid\}/g, randomUUID());
      const doc = fb2ToDocument(text, {
        docId,
        path: undefined,
        encoding: 'utf-8',
        binaryStore: session(docId).binaries,
      });
      doc.schemaHint = '2.1';
      return doc;
    },

    'doc.open': ({ path: filePath }) => {
      if (!filePath || !existsSync(filePath)) {
        pruneRecent(filePath);
        throw rpcError(1002, `doc.ioError: cannot open ${filePath}`, {
          path: filePath,
          reason: 'No such file',
        });
      }
      const bytes = readFileSync(filePath);
      const { encoding, text } = decodeBytes(bytes);
      const docId = newSession(filePath);
      try {
        const doc = fb2ToDocument(text, {
          docId,
          path: filePath,
          encoding,
          binaryStore: session(docId).binaries,
        });
        const s = session(docId);
        Object.assign(s, statOf(filePath));
        s.position = positionOf(filePath);
        touchRecent(filePath);
        const warnings = [];
        const declared = /encoding\s*=\s*["']([^"']+)["']/.exec(text.slice(0, 300));
        if (declared && normalizeEncoding(declared[1]) !== encoding) {
          warnings.push({
            severity: 'warning',
            code: 'encoding.mismatch',
            params: { declared: declared[1], actual: encoding },
          });
        }
        return { document: doc, warnings };
      } catch (error) {
        sessions.delete(docId);
        throw parseErrorOf(error, filePath);
      }
    },

    'doc.openSource': ({ path: filePath }) => {
      if (!filePath || !existsSync(filePath)) {
        throw rpcError(1002, `doc.ioError: cannot open ${filePath}`, {
          path: filePath,
          reason: 'No such file',
        });
      }
      const { encoding, text } = decodeBytes(readFileSync(filePath));
      const docId = newSession(filePath);
      Object.assign(session(docId), statOf(filePath));
      touchRecent(filePath);
      let error;
      try {
        parseXml(text);
      } catch (e) {
        error = { line: e.line ?? 0, column: e.column ?? 0, message: e.message };
      }
      // A Source-only session takes no Body position (feature 004 US8).
      session(docId).sourceOnly = !!error;
      return { docId, text, encoding, error };
    },

    'doc.close': ({ docId }) => {
      const s = sessions.get(docId);
      if (s) {
        stopWatcher(s);
        sessions.delete(docId);
      }
      return {};
    },

    'doc.toXml': ({ docId, document, elideBinaries }) => {
      const s = session(docId);
      return {
        text: documentToFb2(document, {
          encoding: 'utf-8',
          elideBinaries: !!elideBinaries,
          binaryStore: s.binaries,
        }),
      };
    },

    'doc.fromXml': ({ docId, text }) => {
      const s = session(docId);
      try {
        const doc = fb2ToDocument(text, {
          docId,
          path: s.path,
          encoding: 'utf-8',
          binaryStore: s.binaries,
        });
        return { document: doc };
      } catch (error) {
        throw parseErrorOf(error, s.path);
      }
    },

    'doc.validate': ({ docId, document, text }) => {
      session(docId);
      if (typeof text === 'string') return validateText(text);
      return validateDocument(document);
    },

    'doc.save': ({ docId, document, path: filePath, encoding, force }) => {
      const s = session(docId);
      const target = filePath ?? s.path ?? document.path;
      if (!target)
        throw rpcError(1002, 'doc.ioError: no path', { path: '', reason: 'No file name' });
      const enc = normalizeEncoding(encoding) ?? 'utf-8';
      const validation = validateDocument(document);
      if (validation.errorCount > 0 && !force) return { needsConfirmation: true, validation };
      const xml = documentToFb2(document, {
        encoding: enc,
        elideBinaries: false,
        binaryStore: s.binaries,
      });
      const bytes = encodeText(xml, enc);
      const temp = `${target}.mfbe-tmp`;
      const failWith = (reason) => {
        try {
          if (existsSync(temp)) unlinkSync(temp);
        } catch {
          // ignore
        }
        throw rpcError(1002, `doc.ioError: ${reason}`, { path: target, reason });
      };
      if (fault === 'before_write') failWith('injected fault before write');
      try {
        writeFileSync(
          temp,
          fault === 'during_write' ? bytes.subarray(0, Math.floor(bytes.length / 2)) : bytes,
        );
      } catch (error) {
        failWith(error.message);
      }
      if (fault === 'during_write') failWith('injected fault during write');
      if (fault === 'before_fsync') failWith('injected fault before fsync');
      if (fault === 'before_rename') failWith('injected fault before rename');
      renameSync(temp, target);
      fault = 'none';
      s.path = target;
      Object.assign(s, statOf(target));
      touchRecent(target);
      // The session's position follows the saved name (Save As) when the setting is on.
      if (s.position && restorePositionEnabled()) rememberPosition(target, s.position);
      return { path: target, encoding: enc, converted: [], validation };
    },

    'doc.recent': () => recent.map((item) => ({ ...item, exists: existsSync(item.path) })),

    'doc.clearRecent': () => {
      recent = [];
      saveRecent();
      return {};
    },

    'doc.watch': ({ docId, enabled }) => {
      const s = session(docId);
      stopWatcher(s);
      if (enabled && s.path) {
        Object.assign(s, statOf(s.path));
        s.watcher = setInterval(() => {
          const now = statOf(s.path);
          if (now.mtime !== s.mtime || now.size !== s.size) {
            s.mtime = now.mtime;
            s.size = now.size;
            broadcast('doc.changedOnDisk', {
              docId,
              path: s.path,
              mtime: new Date(now.mtime).toISOString(),
            });
          }
        }, 500);
      }
      return {};
    },

    // Restore position (feature 004 US8, rpc-api §3.2): the remembered Body position of the
    // session's file - kept in the session, recorded in positions.json when the session has a
    // file and the setting is on; {} when nothing is remembered or the setting is off.
    'doc.position': ({ docId, position }) => {
      const s = session(docId);
      if (position !== undefined) {
        if (
          !position ||
          typeof position !== 'object' ||
          !POSITION_PATH.test(position.path ?? '') ||
          !Number.isInteger(position.offset) ||
          position.offset < 0
        ) {
          throw rpcError(-32602, 'position must be {path, offset}', { field: 'position' });
        }
        s.position = { path: position.path, offset: position.offset };
        if (s.path && !s.sourceOnly && restorePositionEnabled()) {
          rememberPosition(s.path, s.position);
        }
      }
      return s.position && restorePositionEnabled() ? { position: s.position } : {};
    },

    'test.injectFault': ({ point }) => {
      fault = point ?? 'none';
      return {};
    },
  };

  return {
    methods,
    /** Raw bytes for `GET /binary/{docId}/{id}` (and `/preview`). */
    binary(docId, id) {
      const s = sessions.get(docId);
      return s?.binaries.get(id) ?? null;
    },
  };
}
