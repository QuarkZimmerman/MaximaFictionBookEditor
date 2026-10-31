// A text block as Internet Explorer's innerHTML of FictionBook Editor's page (files/fb2.xsl), for
// the converted scripts whose expressions read the paragraph's HTML. Each package that needs it
// carries its own byte-identical copy (the sandbox loads modules from the script's own folder).
//
// The notation is that of lib/legacy-html.js (upper-case tags: <STRONG>, <EM>, <STRIKE>, <SUB>,
// <SUP>, <SPAN class=code>, <SPAN class=NAME>, <A class=note href="#id"> / <A href="...">, a
// picture as <IMG href="#id">, text with &amp; &lt; &gt; &nbsp;), which its parseInline() reads
// back; but the marks nest in the order the document model lists them (outer first) - the order
// the book was read in - as they nested in the original's page, where legacy-html.js sorts them
// (a link outermost). With `langs` a mark's language is written as legacy-html.js does
// (lang="..." on the tag, repeated on the closing tag of STRONG, EM, STRIKE, SUB and SUP); the
// original's page had none, so a search leaves it out. `starts[k]` is the index in `html` where
// the text unit at offset k of the block (a character, or a picture) begins, `starts[length]`
// the end.

const ATTR = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function lang(mark, langs) {
  const value = mark.attrs?.lang;
  return langs && typeof value === 'string' ? ` lang="${ATTR(value)}"` : '';
}

function openTag(mark, langs) {
  switch (mark.type) {
    case 'strong':
      return `<STRONG${lang(mark, langs)}>`;
    case 'emphasis':
      return `<EM${lang(mark, langs)}>`;
    case 'strikethrough':
      return `<STRIKE${lang(mark, langs)}>`;
    case 'sub':
      return `<SUB${lang(mark, langs)}>`;
    case 'sup':
      return `<SUP${lang(mark, langs)}>`;
    case 'code':
      return `<SPAN class=code${lang(mark, langs)}>`;
    case 'style': {
      const name = mark.attrs?.name ?? '';
      return `<SPAN class=${name ? ATTR(name) : '""'}${lang(mark, langs)}>`;
    }
    case 'link': {
      const type = mark.attrs?.type;
      const xlink = langs && typeof mark.attrs?.xlinkType === 'string' ? ` xlinktype="${ATTR(mark.attrs.xlinkType)}"` : '';
      return `<A${type ? ` class=${ATTR(type)}` : ''} href="${ATTR(mark.attrs?.href ?? '')}"${xlink}>`;
    }
    default:
      return '';
  }
}

function closeTag(mark, langs) {
  switch (mark.type) {
    case 'strong':
      return `</STRONG${lang(mark, langs)}>`;
    case 'emphasis':
      return `</EM${lang(mark, langs)}>`;
    case 'strikethrough':
      return `</STRIKE${lang(mark, langs)}>`;
    case 'sub':
      return `</SUB${lang(mark, langs)}>`;
    case 'sup':
      return `</SUP${lang(mark, langs)}>`;
    case 'code':
    case 'style':
      return '</SPAN>';
    case 'link':
      return '</A>';
    default:
      return '';
  }
}

function sameMark(a, b) {
  return a.type === b.type && JSON.stringify(a.attrs ?? {}) === JSON.stringify(b.attrs ?? {});
}

function escapeText(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00A0/g, '&nbsp;');
}

/**
 * `{ html, starts }` of a block's inline content. Inline items other than text and pictures
 * (raw XML) are kept aside in `extras` and written `<X n>`, as lib/legacy-html.js does.
 */
export function ieHtml(content, { langs = false, extras = [] } = {}) {
  let html = '';
  const starts = [];
  const open = [];
  const closeDownTo = (keep) => {
    while (open.length > keep) html += closeTag(open.pop(), langs);
  };
  const openFor = (marks) => {
    let common = 0;
    while (common < open.length && common < marks.length && sameMark(open[common], marks[common])) common += 1;
    closeDownTo(common);
    for (let i = common; i < marks.length; i += 1) {
      html += openTag(marks[i], langs);
      open.push(marks[i]);
    }
  };
  for (const item of content ?? []) {
    const marks = (item.marks ?? []).filter((mark) => openTag(mark, langs) !== '');
    if (item.type === 'text') {
      openFor(marks);
      for (const ch of item.text ?? '') {
        starts.push(html.length);
        html += escapeText(ch);
      }
    } else if (item.type === 'inline-image') {
      openFor(marks);
      starts.push(html.length);
      const alt = item.attrs?.alt ? ` alt="${ATTR(item.attrs.alt)}"` : '';
      html += `<IMG href="${ATTR(item.attrs?.href ?? '')}"${alt}>`;
    } else {
      closeDownTo(0);
      starts.push(html.length);
      extras.push(item);
      html += `<X ${extras.length - 1}>`;
    }
  }
  closeDownTo(0);
  starts.push(html.length);
  return { html, starts };
}

/** The block offset of the first text unit that starts at or after html index `i`. */
export function offsetAt(starts, i) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] < i) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
