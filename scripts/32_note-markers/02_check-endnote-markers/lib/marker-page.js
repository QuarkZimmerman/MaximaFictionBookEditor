// Shared helper of the "Маркеры сносок" scripts converted from FictionBook Editor 2.7.9 (group 32)
// that read the whole page: 01-04 (the searches for faulty markers) and 11, 12 (the marker tables)
// carry byte-identical copies (the sandbox only loads modules from the script's own folder).
//
// The originals took the innerHTML of fbw_body, the element of FictionBook Editor's page that held
// the book - the annotation and the history (each an empty paragraph when the book had none), then
// every body -, and turned it into a list of footnote markers with a long chain of regular
// expressions. pageHtml() rebuilds that string from the document model in the notation Internet
// Explorer gave it (files/fb2.xsl of 2.7.9):
//   - a line ("\r\n" before it) per block element: <DIV class=annotation>, <DIV class=history>,
//     <DIV class=body fbname=...>, <DIV class=section> (title, epigraph, annotation, cite, poem,
//     stanza, table, tr alike), a block picture <DIV onresizestart="return false" class=image
//     contentEditable=false href="#id"><IMG src="fbw-internal:#id"></DIV>, and every text block a
//     <P>: <P> for a paragraph, a verse and an empty line (empty), <P class=subtitle>,
//     <P class=text-author> (a date too), <P class=td>, <P class=th>;
//   - inside a <P> the inline markup as IE wrote it, upper case: <STRONG>, <EM>, <STRIKE>, <SUB>,
//     <SUP>, <SPAN class=code>, <SPAN class=NAME>, <A class=note href="#id"> / <A href="...">, an
//     inline picture <SPAN class=image contentEditable=false href="#id"><IMG ...></SPAN>; the
//     tags carry no language (2.7.9 kept none); text escaped as &amp; &lt; &gt; &nbsp; &shy;.
// Every character of the string knows the place of the book it shows (TrackedString): the
// expressions run on it unchanged - TrackedString.replace gives exactly what String.replace gives
// and carries each character's place along (a group of the match keeps its places, a literal
// replacement of the same length takes those of the matched characters) -, so the marker a script
// picks out of its final text can be selected in the book where it is. The expressions are
// compiled as JScript read them (lib/jscript-regexp.js: \s without the Unicode spaces, . matching
// \r).

import { jscriptSource } from './jscript-regexp.js';

/* ------------------------------------------------------------------------------------------ */
/* Regular expressions with JScript's meaning                                                  */
/* ------------------------------------------------------------------------------------------ */

const compiled = new Map();

/** `re` with JScript's \s, \S and . (cached); `extra` flags are added (e.g. 'd' for indices). */
export function jscript(re, extra = '') {
  const flags = [...new Set((re.flags + extra).split(''))].join('');
  const key = `${flags}/${re.source}`;
  let out = compiled.get(key);
  if (!out) {
    out = new RegExp(jscriptSource(re.source), flags);
    compiled.set(key, out);
  }
  out.lastIndex = 0;
  return out;
}

/* ------------------------------------------------------------------------------------------ */
/* A string whose characters know their place in the book                                      */
/* ------------------------------------------------------------------------------------------ */

/** Splits a replacement template into literal text and references ($&, $1.., $`, $'). */
function parseTemplate(template, groupCount) {
  const parts = [];
  let literal = '';
  for (let i = 0; i < template.length; i += 1) {
    const ch = template[i];
    if (ch !== '$' || i + 1 >= template.length) {
      literal += ch;
      continue;
    }
    const next = template[i + 1];
    if (next === '$') {
      literal += '$';
      i += 1;
      continue;
    }
    let ref = null;
    let width = 1;
    if (next === '&') ref = 0;
    else if (next === '`') ref = 'before';
    else if (next === "'") ref = 'after';
    else if (next >= '0' && next <= '9') {
      const two = template.length > i + 2 && template[i + 2] >= '0' && template[i + 2] <= '9' ? Number(next + template[i + 2]) : -1;
      if (two >= 1 && two <= groupCount) {
        ref = two;
        width = 2;
      } else if (Number(next) >= 1 && Number(next) <= groupCount) ref = Number(next);
    }
    if (ref === null) {
      literal += ch;
      continue;
    }
    if (literal) parts.push({ literal });
    literal = '';
    parts.push({ ref });
    i += width;
  }
  if (literal) parts.push({ literal });
  return parts;
}

export class TrackedString {
  /** `src[i]` is the place of character i (an index of the page's places) or -1. */
  constructor(s, src) {
    this.s = s;
    this.src = src ?? new Int32Array(s.length).fill(-1);
  }

  toString() {
    return this.s;
  }

  valueOf() {
    return this.s;
  }

  get length() {
    return this.s.length;
  }

  match(re) {
    return this.s.match(re instanceof RegExp ? jscript(re) : re);
  }

  search(re) {
    return this.s.search(re instanceof RegExp ? jscript(re) : re);
  }

  split(separator, limit) {
    return this.s.split(separator instanceof RegExp ? jscript(separator) : separator, limit);
  }

  /** String.prototype.replace with a regular expression and a template, the places carried. */
  replace(pattern, replacement) {
    if (!(pattern instanceof RegExp) || typeof replacement !== 'string') {
      throw new TypeError('TrackedString.replace: a RegExp and a template string are expected');
    }
    const re = jscript(pattern, 'd');
    const expected = this.s.replace(jscript(pattern), replacement);
    const text = [];
    const places = [];
    let size = 0;
    const copy = (from, to) => {
      if (to <= from) return;
      text.push(this.s.slice(from, to));
      places.push(this.src.subarray(from, to));
      size += to - from;
    };
    let last = 0;
    let template = null;
    let onlyLiteral = false;
    let m;
    while ((m = re.exec(this.s)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      copy(last, start);
      if (!template) {
        template = parseTemplate(replacement, m.length - 1);
        onlyLiteral = template.every((part) => part.literal !== undefined);
      }
      let offset = 0;
      for (const part of template) {
        if (part.literal !== undefined) {
          const literal = part.literal;
          const mapped = new Int32Array(literal.length).fill(-1);
          // A replacement without references maps on the matched characters one by one.
          if (onlyLiteral) for (let k = 0; k < literal.length && start + offset + k < end; k += 1) mapped[k] = this.src[start + offset + k];
          text.push(literal);
          places.push(mapped);
          size += literal.length;
          offset += literal.length;
        } else if (part.ref === 'before') copy(0, start);
        else if (part.ref === 'after') copy(end, this.s.length);
        else {
          const at = m.indices[part.ref];
          if (at) copy(at[0], at[1]);
        }
      }
      last = end;
      if (!re.global) break;
      if (m[0].length === 0) re.lastIndex = end + 1;
    }
    copy(last, this.s.length);
    const out = text.join('');
    if (out !== expected || out.length !== size) throw new Error('TrackedString.replace: internal mismatch');
    const src = new Int32Array(size);
    let at = 0;
    for (const chunk of places) {
      src.set(chunk, at);
      at += chunk.length;
    }
    return new TrackedString(out, src);
  }
}

/* ------------------------------------------------------------------------------------------ */
/* The page                                                                                    */
/* ------------------------------------------------------------------------------------------ */

const P_CLASS = { p: '', v: '', 'empty-line': '', subtitle: 'subtitle', 'text-author': 'text-author', date: 'text-author', td: 'td', th: 'th' };
const DIVS = new Set(['section', 'title', 'epigraph', 'annotation', 'cite', 'poem', 'stanza', 'table', 'tr']);
const MARK_ORDER = ['link', 'style', 'strong', 'emphasis', 'strikethrough', 'sub', 'sup', 'code'];

function attr(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** An id attribute as IE wrote it (unquoted when it is a plain word). */
function idAttr(node) {
  const id = node.attrs?.id;
  if (!id) return '';
  return /^[\w.:-]+$/.test(id) ? ` id=${id}` : ` id="${attr(id)}"`;
}

function openTag(mark) {
  switch (mark.type) {
    case 'strong':
      return '<STRONG>';
    case 'emphasis':
      return '<EM>';
    case 'strikethrough':
      return '<STRIKE>';
    case 'sub':
      return '<SUB>';
    case 'sup':
      return '<SUP>';
    case 'code':
      return '<SPAN class=code>';
    case 'style':
      return `<SPAN class=${mark.attrs?.name ? attr(mark.attrs.name) : '""'}>`;
    case 'link': {
      const type = mark.attrs?.type;
      return `<A${type ? ` class=${attr(type)}` : ''} href="${attr(mark.attrs?.href)}">`;
    }
    default:
      return '';
  }
}

function closeTag(mark) {
  return { strong: '</STRONG>', emphasis: '</EM>', strikethrough: '</STRIKE>', sub: '</SUB>', sup: '</SUP>', code: '</SPAN>', style: '</SPAN>', link: '</A>' }[mark.type] ?? '';
}

const ENTITY = { '&': '&amp;', '<': '&lt;', '>': '&gt;', ' ': '&nbsp;', '­': '&shy;' };

/**
 * fbw_body.innerHTML of the book: `{ html, places }`. `html` is a TrackedString; `places[k]` is
 * `{ nodeId, offset }` of place k: a character of a text block, `offset` in selection offsets
 * (an inline picture counts as one).
 */
export function pageHtml(snapshot) {
  const out = [];
  const srcs = [];
  const places = [];
  // Characters are UTF-16 code units, as the selection's offsets count them.
  const put = (text, src = -1) => {
    for (let k = 0; k < text.length; k += 1) {
      out.push(text[k]);
      srcs.push(src);
    }
  };
  const inline = (block) => {
    const nodeId = block.attrs?.nodeId ?? null;
    let open = [];
    let offset = 0;
    const closeDownTo = (keep) => {
      while (open.length > keep) put(closeTag(open.pop()));
    };
    const openFor = (marks) => {
      const sorted = [...(marks ?? [])].filter((m) => MARK_ORDER.includes(m.type)).sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
      let common = 0;
      while (common < open.length && common < sorted.length && JSON.stringify(open[common]) === JSON.stringify(sorted[common])) common += 1;
      closeDownTo(common);
      for (let k = common; k < sorted.length; k += 1) {
        put(openTag(sorted[k]));
        open.push(sorted[k]);
      }
    };
    for (const item of block.content ?? []) {
      if (item.type === 'text') {
        openFor((item.marks ?? []).map((m) => ({ type: m.type, ...(m.type === 'style' || m.type === 'link' ? { attrs: { name: m.attrs?.name, type: m.attrs?.type, href: m.attrs?.href } } : {}) })));
        const text = item.text ?? '';
        for (let k = 0; k < text.length; k += 1) {
          const ch = text[k];
          const place = places.length;
          places.push({ nodeId, offset });
          put(ENTITY[ch] ?? ch, place);
          offset += 1;
        }
      } else if (item.type === 'inline-image') {
        openFor((item.marks ?? []).map((m) => ({ type: m.type, ...(m.type === 'style' || m.type === 'link' ? { attrs: { name: m.attrs?.name, type: m.attrs?.type, href: m.attrs?.href } } : {}) })));
        const href = attr(item.attrs?.href);
        put(`<SPAN class=image contentEditable=false href="${href}"><IMG src="fbw-internal:${href}"></SPAN>`);
        offset += 1;
      } else {
        // Other inline content the editor keeps as it is: one position, no text on the page.
        closeDownTo(0);
        offset += 1;
      }
    }
    closeDownTo(0);
  };
  const block = (node) => {
    if (!node || node.type === 'text') return;
    if (node.type in P_CLASS) {
      const cls = P_CLASS[node.type];
      put(`\r\n<P${cls ? ` class=${cls}` : ''}${idAttr(node)}>`);
      if (node.type !== 'empty-line') inline(node);
      put('</P>');
      return;
    }
    if (node.type === 'image') {
      const href = attr(node.attrs?.href);
      put(`\r\n<DIV onresizestart="return false" class=image contentEditable=false href="${href}"><IMG src="fbw-internal:${href}"></DIV>`);
      return;
    }
    if (DIVS.has(node.type)) {
      put(`\r\n<DIV class=${node.type}${idAttr(node)}>`);
      for (const child of node.content ?? []) block(child);
      put('</DIV>');
    }
  };
  const region = (className, node) => {
    put(`\r\n<DIV class=${className}>`);
    if (node && (node.content ?? []).length) for (const child of node.content) block(child);
    else put('\r\n<P></P>');
    put('</DIV>');
  };
  const description = snapshot.description ?? {};
  region('annotation', description.titleInfo?.annotation);
  region('history', description.documentInfo?.history);
  for (const body of snapshot.bodies ?? []) {
    const name = body.attrs?.name ?? '';
    put(`\r\n<DIV class=body fbname=${name && /^[\w.:-]+$/.test(name) ? name : `"${attr(name)}"`}>`);
    for (const child of body.content ?? []) block(child);
    put('</DIV>');
  }
  return { html: new TrackedString(out.join(''), Int32Array.from(srcs)), places };
}

/**
 * The original's PerehodFinal: selects the marker `res` (the last match of /☺(.+?)☻/gm in `txt`,
 * whose lastIndex is `re.lastIndex`) - `length` characters of the book from the first character
 * of its content, as the original moved IE's selection that many characters from there; a length
 * that is no positive number (the asterisk markers' dlina is the number of asterisks as a string,
 * and more than twelve asterisks stay asterisks, which moveEnd took for no move) leaves a caret
 * there. Returns false when the marker's content has no place in the book.
 */
export async function selectMarker(places, txt, res, re, length) {
  const start = re.lastIndex - res[0].length + 1;
  const end = re.lastIndex - 1;
  let first = -1;
  for (let k = start; k < end && first < 0; k += 1) first = txt.src[k];
  if (first < 0) return false;
  const place = places[first];
  if (!place?.nodeId) return false;
  const count = Number(length);
  if (!(count > 0)) {
    await mfbe.selection.set({ nodeId: place.nodeId, offset: place.offset });
    return true;
  }
  let to = first;
  // The selection stays in the marker's text block.
  for (let n = 1; n < count && places[to + 1]?.nodeId === place.nodeId; n += 1) to += 1;
  await mfbe.selection.set({ nodeId: place.nodeId, offset: place.offset }, { nodeId: place.nodeId, offset: places[to].offset + 1 });
  return true;
}
