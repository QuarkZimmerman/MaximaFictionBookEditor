// Engine of the citation searches of FictionBook Editor 2.7.9's group 14_Цитаты (053, 054, 056):
// Sclex's "Поиск по набору регэкспов" (a search by a set of regular expressions) in the two
// generations those scripts carry. Each package carries an identical copy of this file (the
// sandbox loads modules from the script's own folder only); the packages differ in their lists.
//
// What the originals did, and what is reproduced here:
// - The list: addMacros("<name>", "re") defines a named sub-pattern, addRegExp(re, keys, desc,
//   inWhatTags, beforeLimit) an expression for the paragraph's text, tagRegExp(...) one for the
//   paragraph's HTML as Internet Explorer gave it (innerHTML), where the macros <emphasis>,
//   </emphasis>, <strong> ... <любые-теги> and the list's own macros are expanded. Leading
//   look-behinds (?<=...) / (?<!...) - JScript had none - are cut off and checked by hand
//   against the text before the match, with the optional length limit; the rest is compiled
//   without the u flag, \s and \S with JScript's meaning ([ \f\n\r\t\v], no U+00A0), a ] right
//   after [ a member of the class. An entry that does not compile, or whose tag condition is
//   malformed, is listed in the original's error message and the search does not start. (This
//   part follows the port of the same code in group 21's regexp-set.js.)
// - The page: the originals walked FictionBook Editor's fbw_body from the selection's end - the
//   book's annotation and its history first, then every body - paragraph by paragraph (an empty
//   line an empty paragraph); nav-lib.js rebuilds it (loadBook) and finds the selection (locate).
// - A paragraph's text is the original's: tags removed, entities decoded, an inline picture as
//   three placeholder characters ("~~~" or "ǾǾǾ"), a soft hyphen as U+00AD or, where the script
//   did not decode it, as "&shy;". Hits are mapped back to the document exactly (the originals
//   moved IE's selection by its own character count, which was off after inline pictures and
//   soft hyphens).
// - Engine '5' (054, 056: the "searchNext" generation): from the end of the selection, a
//   paragraph is searched when the search does not start at its end; of the hits of all entries
//   the earliest wins (equal places: the entry listed first); a hit whose description starts with
//   "Пропустить" - or any hit in a paragraph the script's own `exclude(text)` rejects - is an
//   exception, and the search goes on right after it; nothing found: "Поиск завершен!" in the
//   status bar and the message.
// - Engine 'old' (053): a collapsed caret skips a hit right at it (ignoreNullPosition), no
//   exceptions, nothing found: the message only.

import { loadBook, locate, setCaret, setRange, t } from './nav-lib.js';

export { t };

const NBSP = ' ';
const SHY = '­';
const JSCRIPT_SPACE = ' \\f\\n\\r\\t\\v';

/** The pattern as JScript read it: \s / \S without U+00A0, "[]..." with ] a member. */
function jscriptPattern(source) {
  let out = '';
  let inClass = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\' && i + 1 < source.length) {
      const next = source[i + 1];
      if (next === 's') out += inClass ? JSCRIPT_SPACE : `[${JSCRIPT_SPACE}]`;
      else if (next === 'S') out += inClass ? '\\S' : `[^${JSCRIPT_SPACE}]`;
      else out += ch + next;
      i += 1;
      continue;
    }
    if (!inClass && ch === '[') {
      inClass = true;
      out += ch;
      if (source[i + 1] === '^') {
        out += '^';
        i += 1;
      }
      if (source[i + 1] === ']') {
        out += '\\]';
        i += 1;
      }
      continue;
    }
    if (inClass && ch === ']') inClass = false;
    out += ch;
  }
  return out;
}

function compile(source, flags) {
  if (/[^gim]/.test(flags)) throw new SyntaxError(`invalid flags "${flags}"`);
  return new RegExp(jscriptPattern(source), flags);
}

/** exec() as JScript ran it: after an empty match lastIndex moved one character on. */
function execJScript(re, text) {
  const m = re.exec(text);
  if (m && m[0].length === 0) re.lastIndex = m.index + 1;
  return m;
}

const CONDITION_NAMES = 'section|body|epigraph|cite|poem|stanza|title|subtitle|text-author';

/** The list of expressions (addMacros / addRegExp / tagRegExp as in the originals). */
export function createRegExpSet() {
  const checkTagStrRE = new RegExp(
    `^(([-+](${CONDITION_NAMES}))([ \\t]+?[-+](${CONDITION_NAMES}))*?|^$)$`,
    'i',
  );
  const macroses = new Map();
  const macrosNameRE = /^<[-а-яёa-z_?/]+>$/i;
  const macrosNameRE2 = /<[-а-яёa-z_?/]+>/gi;
  const findXA0 = /((\\)+?)xA0/gi;
  const entries = [];
  let errorList = '';
  const addError = (line) => {
    errorList += (errorList === '' ? '' : '\n') + line;
  };
  const replaceMacroses = (source) =>
    source.replace(macrosNameRE2, (name) => macroses.get(name.toLowerCase()) ?? name);
  // The original replaced a literal U+00A0 and "\xA0" by the configured non-breaking space; the
  // editor keeps U+00A0 itself, so that is U+00A0.
  const prepare = (source, withMacros) => {
    let s = source.replace(findXA0, (all, slashes) => (slashes.length % 2 === 1 ? NBSP : all));
    if (withMacros) s = replaceMacroses(s);
    return s;
  };
  const add = (tag, re_, keys, desc, inWhatTags, beforeLimit) => {
    const flags = `g${keys || ''}`;
    let re;
    const lookBehinds = [];
    try {
      const source = String(re_);
      let ii = 0;
      while (source.substr(ii, 4) === '(?<=' || source.substr(ii, 4) === '(?<!') {
        let level = 1;
        const begin = ii;
        ii += 4;
        while (ii < source.length && level !== 0) {
          const ch = source.charAt(ii);
          if (ch === '(') level += 1;
          if (ch === ')') level -= 1;
          if (ch === '\\') ii += 2;
          else ii += 1;
        }
        lookBehinds.push({
          re: compile(prepare(source.substring(begin + 4, ii - 1), tag), flags),
          positive: source.substr(begin, 4) === '(?<=',
        });
      }
      re = compile(prepare(source.substr(ii), tag), flags);
      if (inWhatTags && String(inWhatTags).search(checkTagStrRE) < 0) throw new Error('tags');
    } catch {
      addError(`  ${tag ? 'tagRegExp' : 'addRegExp'}("${re_}","${keys}","${desc}","${inWhatTags}"`);
      return;
    }
    let limit;
    if (tag) {
      if (beforeLimit && typeof beforeLimit === 'number') limit = beforeLimit;
    } else if (beforeLimit && typeof beforeLimit === 'number' && beforeLimit !== 0) {
      limit = beforeLimit;
    }
    entries.push({
      re,
      tag,
      desc: desc !== undefined && desc !== '' ? String(desc) : undefined,
      lookBehinds: lookBehinds.length ? lookBehinds : null,
      condition: inWhatTags ? String(inWhatTags) : '',
      limit,
    });
  };
  const set = {
    entries,
    get errors() {
      return errorList;
    },
    addRegExp: (re, keys, desc, inWhatTags, beforeLimit) =>
      add(false, re, keys, desc, inWhatTags, beforeLimit),
    tagRegExp: (re, keys, desc, inWhatTags, beforeLimit) =>
      add(true, re, keys, desc, inWhatTags, beforeLimit),
    addMacros(macrosName, macrosRE) {
      if (String(macrosName).search(macrosNameRE) < 0) {
        addError(`addMacros("${macrosName}","${macrosRE}"); //неверное имя макроса`);
      }
      const expanded = prepare(replaceMacroses(String(macrosRE)), false);
      try {
        compile(`(${expanded})`, 'g');
      } catch {
        addError(`addMacros("${macrosName}","${macrosRE}"); // ошибка при компиляции регэкспа`);
        return;
      }
      macroses.set(String(macrosName).toLowerCase(), `(${expanded})`);
    },
  };
  // The predefined macros: the tags of the inline elements in the editor's HTML.
  set.addMacros('<emphasis>', '<[Ee][Mm]>');
  set.addMacros('<strong>', '<([Ss][Tt][Rr][Oo][Nn][Gg]|[Bb])(?![a-z])[^>]*?>');
  set.addMacros('<sup>', '<[Ss][Uu][Pp](?![a-z])[^>]*?>');
  set.addMacros('<sub>', '<[Ss][Uu][Bb](?![a-z])[^>]*?>');
  set.addMacros('<strikethrough>', '<[Ss][Tt][Rr][Ii][Kk][Ee](?![a-z])[^>]*?>');
  set.addMacros(
    '<code>',
    '<[Ss][Pp][Aa][Nn](?![a-z])[^>]*?\\b[Cc][Ll][Aa][Ss][Ss]=["\']?[Cc][Oo][Dd][Ee](?![a-z])["\']?[^>]*?>',
  );
  set.addMacros('</emphasis>', '</([Ee][Mm]|[Ii])>');
  set.addMacros('</strong>', '</([Ss][Tt][Rr][Oo][Nn][Gg]|[Bb])>');
  set.addMacros('</sup>', '</[Ss][Uu][Pp]>');
  set.addMacros('</sub>', '</[Ss][Uu][Bb]>');
  set.addMacros('</strikethrough>', '</[Ss][Tt][Rr][Ii][Kk][Ee]>');
  set.addMacros('</code>', '</[Ss][Pp][Aa][Nn]>');
  set.addMacros('<любые-теги>', '(</?[^>]*?>)*?');
  return set;
}

/* ---------------------------------------------------------------------------------------- */
/* The paragraphs as the originals saw them                                                  */
/* ---------------------------------------------------------------------------------------- */

const CONTAINERS = new Set(['section', 'body', 'epigraph', 'cite', 'poem', 'stanza', 'title']);

/** getTags(): the containers a paragraph is in, its own subtitle / text-author class. */
function tagsOf(item) {
  const inTags = new Set();
  if (item.cls === 'subtitle' || item.cls === 'text-author') inTags.add(item.cls);
  for (let node = item.parent; node && node.type !== 'root'; node = node.parent) {
    if (CONTAINERS.has(node.cls)) inTags.add(node.cls);
  }
  return inTags;
}

const FIND_TAG_RE =
  /(^| )([-+])(section|body|epigraph|cite|poem|stanza|title|subtitle|text-author)(?= |$)/gi;

/** checkAreWeInRightTags(): inTags[name] compared as written (only lower-case names exist). */
function inRightTags(entry, inTags) {
  if (!entry.condition) return true;
  let ok = true;
  FIND_TAG_RE.lastIndex = 0;
  entry.condition.replace(FIND_TAG_RE, (all, start, sign, name) => {
    const value = name === name.toLowerCase() ? inTags.has(name) : undefined;
    if (value !== (sign === '+')) ok = false;
    return all;
  });
  return ok;
}

function escapeText(ch) {
  switch (ch) {
    case '&':
      return '&amp;';
    case '<':
      return '&lt;';
    case '>':
      return '&gt;';
    case NBSP:
      return '&nbsp;';
    case SHY:
      return '&shy;';
    default:
      return ch;
  }
}

function attrText(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/** The tags IE wrote for FictionBook Editor's rendering of a mark (files/fb2.xsl). */
function tagsFor(mark) {
  switch (mark.type) {
    case 'emphasis':
      return ['<EM>', '</EM>'];
    case 'strong':
      return ['<STRONG>', '</STRONG>'];
    case 'strikethrough':
      return ['<STRIKE>', '</STRIKE>'];
    case 'sub':
      return ['<SUB>', '</SUB>'];
    case 'sup':
      return ['<SUP>', '</SUP>'];
    case 'code':
      return ['<SPAN class=code>', '</SPAN>'];
    case 'style': {
      const name = mark.attrs?.name ?? '';
      return [`<SPAN class=${/^[A-Za-z0-9_-]+$/.test(name) ? name : `"${attrText(name)}"`}>`, '</SPAN>'];
    }
    case 'link': {
      const cls = mark.attrs?.type ? `class=${mark.attrs.type} ` : '';
      return [`<A ${cls}href="${attrText(mark.attrs?.href)}">`, '</A>'];
    }
    default:
      return ['', ''];
  }
}

const sameMark = (a, b) =>
  a.type === b.type && JSON.stringify(a.attrs ?? {}) === JSON.stringify(b.attrs ?? {});

/**
 * The paragraph as the original saw it: `html` (its innerHTML, the marks nested as the book
 * nests them), `plain` (the text the plain expressions saw) and the maps `plainAt[o]` (plain
 * index of the document offset o) and `htmlAt[o]` (HTML index where a search from offset o
 * started: after the character before it and the closing tags that follow that character).
 */
function paragraphView(item, options) {
  const key = `${options.image}|${options.decodeShy}`;
  if (item.view?.key === key) return item.view;
  let html = '';
  let plain = '';
  const plainAt = [0];
  const htmlAt = [0];
  let open = [];
  const switchMarks = (marks) => {
    let common = 0;
    while (common < open.length && common < marks.length && sameMark(open[common], marks[common])) {
      common += 1;
    }
    let closed = false;
    for (let i = open.length - 1; i >= common; i -= 1) {
      html += tagsFor(open[i])[1];
      closed = true;
    }
    if (closed) htmlAt[htmlAt.length - 1] = html.length;
    open = open.slice(0, common);
    for (let i = common; i < marks.length; i += 1) {
      html += tagsFor(marks[i])[0];
      open.push(marks[i]);
    }
  };
  const textBlock = item.type !== 'empty-line' && !item.isPlaceholder;
  for (const node of textBlock ? (item.node?.content ?? []) : []) {
    const marks = node.marks ?? [];
    switchMarks(marks);
    if (node.type === 'text') {
      for (const unit of node.text ?? '') {
        // One UTF-16 unit at a time, as the document's offsets count.
        for (let k = 0; k < unit.length; k += 1) {
          const ch = unit[k];
          html += escapeText(ch);
          plain += ch === SHY && !options.decodeShy ? '&shy;' : ch;
          plainAt.push(plain.length);
          htmlAt.push(html.length);
        }
      }
    } else {
      if (node.type === 'inline-image') {
        const href = attrText(node.attrs?.href);
        const title = node.attrs?.title ? ` title="${attrText(node.attrs.title)}"` : '';
        html += `<SPAN onresizestart="return false" class=image contentEditable=false href="${href}"${title}><IMG src="fbw-internal:${href}"></SPAN>`;
        plain += options.image;
      }
      plainAt.push(plain.length);
      htmlAt.push(html.length);
    }
  }
  switchMarks([]);
  item.view = { key, html, plain, plainAt, htmlAt, length: plainAt.length - 1 };
  return item.view;
}

/** The original's plain text of an HTML piece ("newPos", "rslt_replaced"). */
function plainOf(text, options) {
  let s = text.replace(/<(?!IMG\b).*?(>|$)/gi, '').replace(/<IMG\b.*?>/gi, options.image);
  if (options.decodeShy) s = s.replace(/&shy;/g, SHY);
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, NBSP);
}

/** Largest document offset whose plain index is <= p (a hit's start). */
function offsetAtOrBefore(view, p) {
  let o = 0;
  while (o < view.length && view.plainAt[o + 1] <= p) o += 1;
  return o;
}

/** Smallest document offset whose plain index is >= p (a hit's end). */
function offsetAtOrAfter(view, p) {
  let o = 0;
  while (o < view.length && view.plainAt[o] < p) o += 1;
  return o;
}

/* ---------------------------------------------------------------------------------------- */
/* Hits                                                                                       */
/* ---------------------------------------------------------------------------------------- */

/** checkLookBehs(): every leading look-behind against the text before `pos`. */
function checkLookBehs(entry, s, pos) {
  if (!entry.lookBehinds) return true;
  let text;
  if (!entry.limit) text = s.substr(0, pos);
  else {
    const offset = pos - entry.limit;
    text = s.substring(offset >= 0 ? offset : 0, pos);
  }
  const len = text.length;
  for (const lb of entry.lookBehinds) {
    lb.re.lastIndex = 0;
    let r = execJScript(lb.re, text);
    while (r && r.index + r[0].length !== len) r = execJScript(lb.re, text);
    if (lb.positive) {
      if (!r || r.index + r[0].length !== len) return false;
    } else if (r && r.index + r[0].length === len) return false;
  }
  return true;
}

/** The hits of engine '5': plain entries from s1Len, tag entries from s1HtmlLen. */
function hitsCurrent(set, inTags, view, s1Len, s1HtmlLen, options) {
  const s = view.plain;
  const html = view.html;
  const founds = [];
  for (const entry of set.entries) {
    if (!inRightTags(entry, inTags)) continue;
    const { re } = entry;
    if (!entry.tag) {
      re.lastIndex = s1Len;
      let savedIndex = s1Len;
      let r = re.exec(s);
      while (r && !checkLookBehs(entry, s, r.index)) {
        savedIndex += 1;
        if (r.index > savedIndex) savedIndex = r.index;
        re.lastIndex = savedIndex;
        r = re.exec(s);
      }
      if (r) founds.push({ pos: r.index, len: r[0].length, entry });
      continue;
    }
    let flag = true;
    re.lastIndex = s1HtmlLen;
    let r = re.exec(html);
    let savedIndex = s1HtmlLen;
    while (r && flag) {
      if (r.index > savedIndex) savedIndex = r.index;
      re.lastIndex = savedIndex;
      savedIndex += 1;
      r = re.exec(html);
      flag = false;
      if (r) {
        const newPos = plainOf(html.substr(0, r.index), options).length;
        const replaced = plainOf(r[0], options);
        // rslt_replaced[0] was undefined in JScript (no string indexing in the page's IE7 mode),
        // so the "ends inside a tag" test always ran; lastIndex after an empty match was one on.
        let k = r[0].length === 0 ? r.index + 1 : r.index + r[0].length;
        while (k < html.length && html.charAt(k) !== '>' && html.charAt(k) !== '<') k += 1;
        if (k < html.length && html.charAt(k) === '>') flag = true;
        if (!flag) {
          if (!checkLookBehs(entry, html, r.index)) flag = true;
          else founds.push({ pos: newPos, len: replaced.length, entry });
        }
      }
    }
  }
  // Array.prototype.sort is stable: equal positions keep the order of the list.
  return founds.sort((a, b) => a.pos - b.pos);
}

/** The hits of engine 'old': a collapsed caret skips a hit right at it. */
function hitsOld(set, inTags, view, s1Len, s1HtmlLen, ignoreNull, options) {
  const s = view.plain;
  const html = view.html;
  const founds = [];
  for (const entry of set.entries) {
    if (!inRightTags(entry, inTags)) continue;
    const { re } = entry;
    if (!entry.tag) {
      re.lastIndex = s1Len + (ignoreNull ? 1 : 0);
      let r = execJScript(re, s);
      while (r && !checkLookBehs(entry, s, r.index)) r = execJScript(re, s);
      if (r) founds.push({ pos: r.index, len: r[0].length, entry });
      continue;
    }
    let flag = true;
    re.lastIndex = s1HtmlLen + (ignoreNull ? 1 : 0);
    while (flag) {
      const r = execJScript(re, html);
      flag = false;
      if (r) {
        const newPos = plainOf(html.substr(0, r.index), options).length;
        const replaced = plainOf(r[0], options);
        let k = re.lastIndex;
        while (k < html.length && html.charAt(k) !== '>' && html.charAt(k) !== '<') k += 1;
        if (k < html.length && html.charAt(k) === '>') {
          re.lastIndex = k + 1;
          flag = true;
        }
        if (!flag) {
          if (!checkLookBehs(entry, html, r.index)) flag = true;
          else founds.push({ pos: newPos, len: replaced.length, entry });
        }
      }
    }
  }
  return founds.sort((a, b) => a.pos - b.pos);
}

/* ---------------------------------------------------------------------------------------- */
/* The search                                                                                 */
/* ---------------------------------------------------------------------------------------- */

/**
 * Where a search starts: the paragraph holding the end of the selection and the offset in it
 * (`book` and `point` from nav-lib's loadBook / locate). A point in a container starts with
 * the container's first paragraph, from its start.
 */
export function startAt(book, point, collapsed) {
  if (Number.isInteger(point.index) && point.item) {
    return { index: point.index, offset: point.offset, collapsed };
  }
  return { index: Math.max(0, Math.ceil(point.index)), offset: 0, collapsed, inContainer: true };
}

/**
 * The selection the search starts from, or null after a message: a selected picture is refused
 * (the original printed the words "sel.type" here instead of the kind of selection), a list
 * with errors is reported.
 */
export async function prepareSearch(ctx, set) {
  const book = await loadBook();
  const where = await locate(book, true);
  if (!where) return null;
  if (where.picture) {
    await mfbe.ui.message(
      t(
        ctx,
        'Не обрабатываемый тип выделения: выделена картинка.',
        'Unsupported kind of selection: a picture is selected.',
      ),
      { icon: 'error' },
    );
    return null;
  }
  if (set.errors !== '') {
    await mfbe.ui.message(
      t(
        ctx,
        'Ошибки при компиляции регэкспов, заданных в таких строках:\n\n',
        'These regular expression entries failed to compile:\n\n',
      ) +
        set.errors +
        t(
          ctx,
          '\n\nПожалуйста, поправьте ошибки, прежде чем использовать скрипт.',
          '\n\nPlease fix them before using the script.',
        ),
      { icon: 'error' },
    );
    return null;
  }
  return { book, start: startAt(book, where.end, where.collapsed) };
}

/**
 * One search (one Run() of the original) from `start`. options:
 *   engine      '5' or 'old'
 *   image       the placeholder of an inline picture ('~~~' or 'ǾǾǾ')
 *   decodeShy   true when the script turned "&shy;" into U+00AD
 *   exclude     (text) => true when every hit of a paragraph with this text is an exception
 *   describe    (desc) => the status text of a description in the interface's language
 *   finished    true: "Поиск завершен!" in the status bar when nothing is found
 * Resolves `{ found }`: the paragraph item, the document offsets [from, to) of the hit, its
 * description and the paragraph's plain text; or `{ found: null, last }`, `last` the place the
 * last search attempt started from (the end of the last exception).
 */
export async function search(ctx, set, book, start, options) {
  const old = options.engine === 'old';
  const describe = options.describe ?? ((desc) => desc);
  let index = start.index;
  let s1Len = 0;
  let s1HtmlLen = 0;
  let last = { index: start.index, offset: start.offset };
  if (!start.inContainer && book.ps[index]) {
    const view = paragraphView(book.ps[index], options);
    const offset = Math.max(0, Math.min(start.offset, view.length));
    s1Len = view.plainAt[offset];
    s1HtmlLen = view.htmlAt[offset];
  }
  let ignoreNull = old && start.collapsed;
  let searched = 0;
  while (index < book.ps.length) {
    const item = book.ps[index];
    const view = paragraphView(item, options);
    const s = view.plain;
    let restart = false;
    if (old || s1Len < s.length || s.length === 0) {
      const inTags = tagsOf(item);
      const founds = old
        ? hitsOld(set, inTags, view, s1Len, s1HtmlLen, ignoreNull, options)
        : hitsCurrent(set, inTags, view, s1Len, s1HtmlLen, options);
      for (const found of founds) {
        if (ignoreNull && found.pos === s1Len) continue;
        let desc = found.entry.desc;
        if (desc !== undefined) await mfbe.ui.status(describe(desc), { sticky: true });
        const from = offsetAtOrBefore(view, found.pos);
        const to = Math.max(from, found.len === 0 ? from : offsetAtOrAfter(view, found.pos + found.len));
        if (!old) {
          if (options.exclude && options.exclude(s)) desc = 'Пропустить: ';
          // An exception ("Пропустить..."): the search goes on right after it. (The original read
          // desc.indexOf() also for an entry without a description and stopped with an error.)
          if (desc !== undefined && desc.indexOf('Пропустить') === 0) {
            const next = view.plainAt[to];
            // An empty exception would be found again and again: one character on.
            s1Len = next === s1Len && found.len === 0 ? s1Len + 1 : next;
            s1HtmlLen = view.htmlAt[to];
            last = { index, offset: to };
            restart = true;
            break;
          }
        }
        return { found: { item, from, to, desc, text: s } };
      }
      ignoreNull = false;
    }
    if (restart) continue;
    index += 1;
    s1Len = 0;
    s1HtmlLen = 0;
    searched += 1;
    if (searched % 200 === 0) {
      if (ctx.cancelled) return { found: null, last, cancelled: true };
      await mfbe.ui.progress(index, book.ps.length);
    }
  }
  if (options.finished) {
    await mfbe.ui.status(t(ctx, 'Поиск завершен!', 'Search finished!'), { sticky: true });
  }
  return { found: null, last };
}

/** The message of a search that found nothing up to the end of the document. */
export async function notFoundMessage(ctx) {
  await mfbe.ui.message(
    t(
      ctx,
      'От позиции курсора до конца документа ничего не найдено.',
      'Nothing was found between the caret and the end of the document.',
    ),
  );
}

/** Selects a hit, or puts the caret at its end (`collapse`), and scrolls it into view. */
export async function selectHit(found, collapse = false) {
  if (collapse) await setCaret(found.item, found.to);
  else if (found.from === found.to) await setCaret(found.item, found.from);
  else await setRange(found.item, found.from, found.item, found.to);
  await mfbe.selection.scrollIntoView();
}

/** Puts the caret at a place `{ index, offset }` of the page (setCaret of nav-lib). */
export async function caretAt(book, place) {
  const item = book.ps[place.index];
  if (item) await setCaret(item, place.offset);
}
