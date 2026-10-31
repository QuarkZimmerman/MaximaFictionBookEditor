// The outerHTML of a container of FictionBook Editor 2.7.9's page, as the script "Поиск
// неразмеченных эпиграфов" read it (pe.outerHTML) and tested it with regular expressions.
//
// The page was files/fb2.xsl's rendering of the book, serialised by Internet Explorer in the IE7
// document mode of FictionBook Editor's WebBrowser control: upper-case tag names, the id first
// and unquoted simple attribute values (<DIV id=n_1 class=section>), no line break between a
// container's start tag and its first child (<DIV class=section><DIV class=title>) and CR LF
// between two siblings - the layout the script's own expressions rely on
// (/^(<DIV class=stanza>)?<DIV class=title>/im, /<DIV id=...class=section><DIV class=title>/,
// /^<DIV onresizestart=/im ...). A text block is a <P> (an empty line an empty <P>, a subtitle
// class=subtitle, a text author and a date class=text-author, a table cell class=td / th; a
// paragraph's style an fbstyle attribute), a block picture <DIV onresizestart=... class=image>,
// the inline content IE's notation of lib/legacy-html.js with a soft hyphen as &shy;.
// `items` are the tree of nav-lib.js's loadBook().

import { serializeInline } from './legacy-html.js';

function value(text) {
  const s = String(text ?? '');
  return /^[A-Za-z0-9_.:-]+$/.test(s) ? s : `"${s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`;
}

function attributes(list) {
  return list.length ? ` ${list.join(' ')}` : '';
}

function paragraphTag(item) {
  const attrs = item.node?.attrs ?? {};
  const list = [];
  if (attrs.id) list.push(`id=${value(attrs.id)}`);
  if (item.cls) list.push(`class=${item.cls}`);
  if (attrs.style && item.type !== 'empty-line') list.push(`fbstyle=${value(attrs.style)}`);
  if (item.type === 'td' || item.type === 'th') {
    if (attrs.colspan) list.push(`fbcolspan=${value(attrs.colspan)}`);
    if (attrs.rowspan) list.push(`fbrowspan=${value(attrs.rowspan)}`);
    if (attrs.align) list.push(`fbalign=${value(attrs.align)}`);
    if (attrs.valign) list.push(`fbvalign=${value(attrs.valign)}`);
  }
  return `<P${attributes(list)}>`;
}

function write(item, out) {
  if (item.kind === 'p') {
    const empty = item.type === 'empty-line' || item.isPlaceholder;
    const inner = empty ? '' : serializeInline(item.node?.content ?? []).replace(/­/g, '&shy;');
    out.ps.push({ item, at: out.html.length });
    out.html += `${paragraphTag(item)}${inner}</P>`;
    return;
  }
  const attrs = item.node?.attrs ?? {};
  if (item.type === 'image') {
    const href = attrs.href ?? '';
    const list = [];
    if (attrs.id) list.push(`id=${value(attrs.id)}`);
    list.push('onresizestart="return false"', 'class=image', 'contentEditable=false', `href=${value(href)}`);
    if (attrs.title) list.push(`title=${value(attrs.title)}`);
    out.html += `<DIV${attributes(list)}><IMG src=${value(`fbw-internal:${href}`)}></DIV>`;
    return;
  }
  const list = [];
  if (attrs.id) list.push(`id=${value(attrs.id)}`);
  list.push(`class=${item.cls}`);
  if (item.type === 'body' && attrs.name) list.push(`fbname=${value(attrs.name)}`);
  out.html += `<DIV${attributes(list)}>`;
  item.children.forEach((child, i) => {
    if (i > 0) out.html += '\r\n';
    write(child, out);
  });
  out.html += '</DIV>';
}

/** `{ html, ps }`: the outerHTML of a container and, for each <P> in it, where it starts. */
export function outerHtml(item) {
  const out = { html: '', ps: [] };
  write(item, out);
  return out;
}
