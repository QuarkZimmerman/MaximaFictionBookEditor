// Shared helper of the converted "FictionBook Editor" clean-up scripts.
//
// The original scripts edited the Internet Explorer `innerHTML` of every paragraph with
// regular expressions that mention the inline tags (`<EM>`, `<STRONG>`, `&nbsp;`...). This
// module renders a text block of the editor's document model exactly in that notation and
// parses the edited string back, so the legacy expressions can be reused verbatim while the
// inline marks (links, styles, superscripts, inline images) survive the round trip.
//
// Notation (upper-case tags like IE 6..8 produced them):
//   strong -> <STRONG>, emphasis -> <EM>, strikethrough -> <STRIKE>, sub -> <SUB>, sup -> <SUP>,
//   code -> <SPAN class=code>, style name -> <SPAN class=NAME>,
//   note link -> <A class=note href="#id">, other link -> <A href="..."> / <A class=TYPE href>,
//   inline image -> <IMG href="#id" alt="...">, text: &amp; &lt; &gt; &nbsp; (U+00A0).
// Feature 006: a mark's language (the element's xml:lang, any value, "" included) is written
// as lang="..." on its tag (<EM lang="la">, <SPAN class=NAME lang="la">) and repeated on the
// closing tag of STRONG, EM, STRIKE, SUB and SUP (</EM lang="la">), so that the legacy
// expressions, written for bare tags (General clean-up's "</EM></EM>" -> "</EM>"), leave
// formatting with a language alone; a link's xlink:type is written as xlinktype="..." after
// its href (no colon: the "missing space after a colon" expression would split xlink:type);
// an inline image is written inside the tags of its marks (a linked or bold picture), as text
// is; nested marks of one kind with different attributes nest as read
// (<EM lang="la">a <EM lang="de">b</EM lang="de"></EM lang="la">).

export const NBSP = '\u00A0';
export const TEXT_BLOCK_TYPES = ['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date'];

/* ------------------------------------------------------------------------ */
/* Serialisation                                                            */
/* ------------------------------------------------------------------------ */

// Nesting order from the outside in; the legacy patterns accept any order of EM/STRONG.
const MARK_ORDER = ['link', 'style', 'strong', 'emphasis', 'strikethrough', 'sub', 'sup', 'code'];

function escapeText(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\u00A0/g, '&nbsp;');
}

function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// The language of a formatting mark as a tag attribute (feature 006), "" when it has none.
function langAttr(mark) {
  const lang = mark.attrs?.lang;
  return typeof lang === 'string' ? ` lang="${escapeAttr(lang)}"` : '';
}

function openTag(mark) {
  switch (mark.type) {
    case 'strong':
      return `<STRONG${langAttr(mark)}>`;
    case 'emphasis':
      return `<EM${langAttr(mark)}>`;
    case 'strikethrough':
      return `<STRIKE${langAttr(mark)}>`;
    case 'sub':
      return `<SUB${langAttr(mark)}>`;
    case 'sup':
      return `<SUP${langAttr(mark)}>`;
    case 'code':
      return `<SPAN class=code${langAttr(mark)}>`;
    case 'style': {
      const name = mark.attrs?.name ?? '';
      return `<SPAN class=${name ? escapeAttr(name) : '""'}${langAttr(mark)}>`;
    }
    case 'link': {
      const type = mark.attrs?.type;
      const cls = type ? ` class=${escapeAttr(type)}` : '';
      const xlinkType = mark.attrs?.xlinkType;
      const xlink = typeof xlinkType === 'string' ? ` xlinktype="${escapeAttr(xlinkType)}"` : '';
      return `<A${cls} href="${escapeAttr(mark.attrs?.href ?? '')}"${xlink}>`;
    }
    default:
      return '';
  }
}

function closeTag(mark) {
  switch (mark.type) {
    case 'strong':
      return `</STRONG${langAttr(mark)}>`;
    case 'emphasis':
      return `</EM${langAttr(mark)}>`;
    case 'strikethrough':
      return `</STRIKE${langAttr(mark)}>`;
    case 'sub':
      return `</SUB${langAttr(mark)}>`;
    case 'sup':
      return `</SUP${langAttr(mark)}>`;
    case 'code':
    case 'style':
      return '</SPAN>';
    case 'link':
      return '</A>';
    default:
      return '';
  }
}

function sortedMarks(marks) {
  return [...(marks ?? [])].sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
}

function sameMark(a, b) {
  return a.type === b.type && JSON.stringify(a.attrs ?? {}) === JSON.stringify(b.attrs ?? {});
}

/**
 * Renders the inline content of a text block as legacy HTML. Inline nodes that have no HTML
 * counterpart (raw XML) are kept aside in `extras` and referenced as `<X n>`.
 */
export function serializeInline(content, extras = []) {
  let html = '';
  let open = [];
  const closeDownTo = (keep) => {
    while (open.length > keep) html += closeTag(open.pop());
  };
  // Closes the open tags the item's marks do not continue and opens the missing ones.
  const openFor = (item) => {
    const marks = sortedMarks(item.marks);
    let common = 0;
    while (common < open.length && common < marks.length && sameMark(open[common], marks[common])) {
      common += 1;
    }
    closeDownTo(common);
    for (let i = common; i < marks.length; i += 1) {
      html += openTag(marks[i]);
      open.push(marks[i]);
    }
  };
  for (const item of content ?? []) {
    if (item.type === 'text') {
      openFor(item);
      html += escapeText(item.text ?? '');
    } else if (item.type === 'inline-image') {
      // A picture inside its link or formatting, as text (feature 006).
      openFor(item);
      const alt = item.attrs?.alt ? ` alt="${escapeAttr(item.attrs.alt)}"` : '';
      html += `<IMG href="${escapeAttr(item.attrs?.href ?? '')}"${alt}>`;
    } else {
      closeDownTo(0);
      extras.push(item);
      html += `<X ${extras.length - 1}>`;
    }
  }
  closeDownTo(0);
  return html;
}

/* ------------------------------------------------------------------------ */
/* Parsing                                                                  */
/* ------------------------------------------------------------------------ */

const ENTITIES = { nbsp: NBSP, lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", shy: '\u00AD' };

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[body.toLowerCase()] ?? all;
  });
}

function parseAttributes(text) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(text))) {
    const value = m[3] ?? m[4] ?? m[5];
    attrs[m[1].toLowerCase()] = value === undefined ? '' : decodeEntities(value);
  }
  return attrs;
}

// A formatting mark with the language of its tag, when the tag holds one (feature 006).
function withLang(mark, attrs) {
  if (attrs.lang !== undefined) mark.attrs = { ...(mark.attrs ?? {}), lang: attrs.lang };
  return mark;
}

function markForTag(name, attrs) {
  switch (name) {
    case 'STRONG':
    case 'B':
      return withLang({ type: 'strong' }, attrs);
    case 'EM':
    case 'I':
    case 'EMPHASIS':
      return withLang({ type: 'emphasis' }, attrs);
    case 'STRIKE':
    case 'S':
    case 'STRIKETHROUGH':
      return withLang({ type: 'strikethrough' }, attrs);
    case 'SUB':
      return withLang({ type: 'sub' }, attrs);
    case 'SUP':
      return withLang({ type: 'sup' }, attrs);
    case 'CODE':
      return withLang({ type: 'code' }, attrs);
    case 'SPAN': {
      const cls = attrs.class ?? '';
      if (cls === 'code') return withLang({ type: 'code' }, attrs);
      if (cls) return withLang({ type: 'style', attrs: { name: cls } }, attrs);
      return null;
    }
    case 'A': {
      const mark = { type: 'link', attrs: { href: attrs.href ?? '' } };
      if (attrs.class) mark.attrs.type = attrs.class;
      if (attrs.xlinktype !== undefined) mark.attrs.xlinkType = attrs.xlinktype;
      return mark;
    }
    default:
      return null;
  }
}

/**
 * Parses legacy HTML back into inline content. Unbalanced or unknown tags are tolerated: a
 * closing tag ends the innermost open mark of its kind, unknown tags are dropped.
 */
export function parseInline(html, extras = []) {
  const out = [];
  const open = [];
  let buffer = '';
  // The marks open at this place, each different one once, outer first.
  const openMarks = () => {
    const marks = [];
    for (const m of open) {
      if (m && !marks.some((other) => sameMark(other, m))) marks.push(JSON.parse(JSON.stringify(m)));
    }
    return marks;
  };
  const flush = () => {
    if (!buffer) return;
    const marks = openMarks();
    const last = out[out.length - 1];
    if (last && last.type === 'text' && JSON.stringify(last.marks ?? []) === JSON.stringify(marks)) {
      last.text += buffer;
    } else {
      const run = { type: 'text', text: buffer };
      if (marks.length) run.marks = marks;
      out.push(run);
    }
    buffer = '';
  };
  let i = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch === '<') {
      const end = html.indexOf('>', i + 1);
      if (end < 0) {
        buffer += html.slice(i);
        break;
      }
      const raw = html.slice(i + 1, end).trim();
      i = end + 1;
      if (!raw) continue;
      const closing = raw[0] === '/';
      const nameMatch = /^\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(raw);
      if (!nameMatch) continue;
      const name = nameMatch[1].toUpperCase();
      const attrText = raw.slice(nameMatch[0].length).replace(/\/\s*$/, '');
      if (name === 'IMG') {
        flush();
        const attrs = parseAttributes(attrText);
        const node = { type: 'inline-image', attrs: { href: attrs.href ?? attrs.src ?? '' } };
        if (attrs.alt) node.attrs.alt = attrs.alt;
        // The picture takes the marks open around it (feature 006), none: no member.
        const marks = openMarks();
        if (marks.length) node.marks = marks;
        out.push(node);
        continue;
      }
      if (name === 'X') {
        flush();
        const index = Number(attrText.trim());
        if (extras[index]) out.push(extras[index]);
        continue;
      }
      if (closing) {
        const kind = markForTag(name, {});
        const type = kind ? kind.type : name === 'SPAN' ? ['code', 'style'] : null;
        if (!type) continue;
        const ofKind = (m) => m && (Array.isArray(type) ? type.includes(m.type) : m.type === type);
        // A closing tag with a language ends the innermost open mark of its kind with that
        // language (feature 006), any other the innermost open mark of its kind.
        const lang = parseAttributes(attrText).lang;
        let at = -1;
        if (lang !== undefined) {
          for (let k = open.length - 1; k >= 0 && at < 0; k -= 1) {
            if (ofKind(open[k]) && open[k].attrs?.lang === lang) at = k;
          }
        }
        for (let k = open.length - 1; k >= 0 && at < 0; k -= 1) {
          if (ofKind(open[k])) at = k;
        }
        if (at >= 0) {
          flush();
          open.splice(at, 1);
        }
        continue;
      }
      const mark = markForTag(name, parseAttributes(attrText));
      if (!mark) continue;
      flush();
      open.push(mark);
      continue;
    }
    if (ch === '&') {
      const m = /^&(#x[0-9a-f]+|#\d+|[a-z]+);/i.exec(html.slice(i, i + 12));
      if (m) {
        buffer += decodeEntities(m[0]);
        i += m[0].length;
        continue;
      }
    }
    buffer += ch;
    i += 1;
  }
  flush();
  return out;
}

/** Plain text of a legacy HTML string (tags removed, entities decoded, images as U+FFFC). */
export function htmlToPlainText(html) {
  return decodeEntities(html.replace(/<IMG\b[^>]*>/gi, '\uFFFC').replace(/<[^>]*>/g, ''));
}

/* ------------------------------------------------------------------------ */
/* Document walking                                                         */
/* ------------------------------------------------------------------------ */

/**
 * Text blocks of a document snapshot (`mfbe.doc.get()`) in document order, each with its
 * parent chain so scripts can reproduce checks such as "parentNode.className == 'stanza'".
 * `options.skipTypes` lists container types that must not be entered (e.g. ['annotation']).
 */
export function collectTextBlocks(snapshot, options = {}) {
  const skip = new Set(options.skipTypes ?? []);
  const out = [];
  const visit = (node, ancestors) => {
    if (!node || node.type === 'text') return;
    if (TEXT_BLOCK_TYPES.includes(node.type)) {
      out.push({ ref: { nodeId: node.attrs.nodeId, type: node.type }, node, ancestors });
      return;
    }
    if (skip.has(node.type)) return;
    for (const child of node.content ?? []) visit(child, [node, ...ancestors]);
  };
  for (const body of snapshot.bodies ?? []) visit(body, []);
  return out;
}

/** Index of the text block that contains the caret (`selection.head`), or 0. */
export function blockIndexOfSelection(blocks, selection) {
  if (!selection) return 0;
  const id = selection.anchor?.nodeId;
  const index = blocks.findIndex((b) => b.ref.nodeId === id);
  return index < 0 ? 0 : index;
}

/** Plain text of a text block node, inline images as U+FFFC (same as mfbe.doc.textOf). */
export function plainTextOf(node) {
  return (node.content ?? []).map((c) => (c.type === 'text' ? c.text ?? '' : '\uFFFC')).join('');
}

/**
 * Applies `edit(html) -> html` to a text block and writes it back when it changed. Returns
 * true when the block was rewritten.
 */
export async function rewriteBlockHtml(block, edit) {
  const extras = [];
  const before = serializeInline(block.node.content, extras);
  const after = await edit(before, block);
  if (after === before || after === null || after === undefined) return false;
  const content = parseInline(after, extras);
  const node = { type: block.node.type, attrs: { ...block.node.attrs }, content };
  await mfbe.doc.replaceNode(block.ref, node);
  block.node = node;
  return true;
}

/** Legacy "time taken" string of the clean-up scripts (seconds with sensible precision). */
export function legacyTimeString(startedAt) {
  const ms = Date.now() - startedAt;
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor(ms / 60000 - hours * 60);
  const seconds = ms / 1000 - minutes * 60 - hours * 3600;
  if (hours >= 1) return `${hours} ч ${minutes} мин ${Math.ceil(seconds)} с`;
  if (minutes >= 1) return `${minutes} мин ${Math.ceil(seconds)} с`;
  if (seconds < 1) return `${Math.ceil(seconds * 1000) / 1000} сек`;
  if (seconds < 10) return `${Math.ceil(seconds * 100) / 100} сек`;
  if (seconds < 30) return `${Math.ceil(seconds * 10) / 10} сек`;
  return `${Math.ceil(seconds)} сек`;
}
