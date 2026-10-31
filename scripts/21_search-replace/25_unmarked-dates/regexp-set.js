// Engine of the "Поиск по набору регэкспов" scripts of FictionBook Editor 2.7.9 (group 21): the
// search by a set of regular expressions by Sclex in its 2.7.9 versions (5.x, with stokber's
// exclusions), its backward variant and the older 5.4 kept by "Перейти на следующую пустую
// строку". Each package carries an identical copy of this file (the sandbox loads modules from
// the script's own folder only); the packages differ in their list of expressions and options.
//
// What the original did, and what is reproduced here:
// - The list: addMacros("<name>", "re") defines a named sub-pattern, addRegExp(re, keys, desc,
//   inWhatTags, beforeLimit) an expression for the paragraph's text, tagRegExp(...) one for the
//   paragraph's HTML as Internet Explorer gave it (innerHTML), where the macros <emphasis>,
//   </emphasis>, <strong> ... <любые-теги> and the list's own macros are expanded. Leading
//   look-behinds (?<=...) / (?<!...) - JScript had none - are cut off and checked by hand
//   against the text before the match ("checkLookBehs"), as the original did, including its
//   optional length limit; the rest is compiled as a JavaScript RegExp without the u flag, like
//   JScript's. JScript's \s and \S knew only [ \f\n\r\t\v] (no U+00A0 and no other Unicode
//   spaces): every pattern is compiled with \s / \S rewritten to that set (jscriptPattern).
//   An entry that does not compile, or whose tag condition is malformed, is listed in the
//   original's error message and the search does not start.
// - The search: text blocks (and empty lines, which FictionBook Editor showed as empty
//   paragraphs) are tried one by one from the caret; in the first one with hits the earliest
//   hit of all the expressions wins (equal positions: the earlier entry) and is selected, its
//   description goes to the status bar. A hit whose description starts with "Пропустить" is an
//   exclusion: the search goes on right after it. Nothing found: "Поиск завершен!" in the
//   status bar and a message.
// - The paragraph's text is the original's: tags removed, entities decoded, an inline picture
//   as three placeholder characters ("~~~" or "ǾǾǾ"), a soft hyphen as U+00AD or, in the
//   scripts that did not decode it, as "&shy;". Positions are mapped back to the document
//   exactly, so a hit after a picture is selected where it is (the original's selection moved
//   by IE's character count and was off after pictures and soft hyphens).

const NBSP = '\u00A0';
const SHY = '\u00AD';

export function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/* ---------------------------------------------------------------------------------------- */
/* Compiling the list                                                                        */
/* ---------------------------------------------------------------------------------------- */

const JSCRIPT_SPACE = ' \\f\\n\\r\\t\\v';

/**
 * Rewrites a pattern so that it matches as it did in FictionBook Editor's JScript: \s and \S
 * knew only [ \f\n\r\t\v] (not U+00A0 nor the other Unicode spaces of JavaScript), and a ]
 * right after [ or [^ was a member of the class.
 */
export function jscriptPattern(source) {
  let out = '';
  let inClass = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\' && i + 1 < source.length) {
      const next = source[i + 1];
      if (next === 's') out += inClass ? JSCRIPT_SPACE : `[${JSCRIPT_SPACE}]`;
      else if (next === 'S') {
        // Inside a class a complement cannot be spliced in; \S occurs in no list of the scripts.
        out += inClass ? '\\S' : `[^${JSCRIPT_SPACE}]`;
      } else out += ch + next;
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
      // JScript, like Perl, took a ] right after [ or [^ for a member of the class (JavaScript
      // reads "[]" as an empty class): "^[]».,:;!?-]" matched a line starting with "]" or "»".
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

/** new RegExp with JScript's flags (g, i, m only) and JScript's \s. */
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

export const CONDITION_NAMES = ['section', 'body', 'epigraph', 'cite', 'poem', 'stanza', 'title', 'subtitle', 'text-author'];

/**
 * The list of expressions. `options.conditionNames` are the element names a tag condition may
 * use (the 5.4 engine of "Перейти на следующую пустую строку" adds "annotation").
 */
export function createRegExpSet(options = {}) {
  const names = (options.conditionNames ?? CONDITION_NAMES).join('|');
  const checkTagStrRE = new RegExp(`^(([-+](${names}))([ \\t]+?[-+](${names}))*?|^$)$`, 'i');
  const macroses = new Map();
  const macrosNameRE = /^<[-а-яёa-z_?/]+>$/i;
  const macrosNameRE2 = /<[-а-яёa-z_?/]+>/gi;
  const findXA0 = /((\\)+?)xA0/gi;
  const entries = [];
  let errorList = '';
  const addError = (line) => {
    errorList += (errorList === '' ? '' : '\n') + line;
  };
  // The editor keeps U+00A0 itself, so the original's replacement of a literal U+00A0 and of
  // "\xA0" by the configured non-breaking-space character is the identity here.
  const replaceMacroses = (source) => source.replace(macrosNameRE2, (name) => macroses.get(name.toLowerCase()) ?? name);
  const prepare = (source, withMacros) => {
    let s = source.replace(findXA0, (all, slashes) => (slashes.length % 2 === 1 ? NBSP : all));
    if (withMacros) s = replaceMacroses(s);
    return s;
  };

  const add = (tag, re_, keys, desc, inWhatTags, beforeLimit) => {
    const flags = `g${keys ? keys : ''}`;
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
    } else if (beforeLimit && typeof beforeLimit === 'number' && beforeLimit !== 0) limit = beforeLimit;
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
    addRegExp: (re, keys, desc, inWhatTags, beforeLimit) => add(false, re, keys, desc, inWhatTags, beforeLimit),
    tagRegExp: (re, keys, desc, inWhatTags, beforeLimit) => add(true, re, keys, desc, inWhatTags, beforeLimit),
    addMacros(macrosName, macrosRE) {
      if (String(macrosName).search(macrosNameRE) < 0) addError(`addMacros("${macrosName}","${macrosRE}"); //неверное имя макроса`);
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
  set.addMacros('<code>', '<[Ss][Pp][Aa][Nn](?![a-z])[^>]*?\\b[Cc][Ll][Aa][Ss][Ss]=["\']?[Cc][Oo][Dd][Ee](?![a-z])["\']?[^>]*?>');
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
/* The paragraphs as the original saw them                                                    */
/* ---------------------------------------------------------------------------------------- */

const TEXT_BLOCKS = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);
const TAG_CONTAINERS = new Set(['section', 'body', 'epigraph', 'cite', 'poem', 'stanza', 'title']);

/** Text blocks and empty lines of the bodies in document order. */
async function collectParagraphs(trackAnnotation) {
  const out = [];
  const visit = (node, ancestors) => {
    if (!node || node.type === 'text') return;
    const isBlock = TEXT_BLOCKS.has(node.type);
    if (isBlock || node.type === 'empty-line') {
      const inTags = new Set();
      for (const a of ancestors) {
        if (TAG_CONTAINERS.has(a) || (trackAnnotation && a === 'annotation')) inTags.add(a);
      }
      // getTags(): subtitle and text-author are the paragraph's own class; FictionBook Editor
      // showed a date as a paragraph of class text-author.
      if (node.type === 'subtitle') inTags.add('subtitle');
      if (node.type === 'text-author' || node.type === 'date') inTags.add('text-author');
      out.push({
        nodeId: node.attrs?.nodeId,
        node,
        emptyLine: !isBlock,
        cell: node.type === 'td' || node.type === 'th',
        inTags,
      });
      return;
    }
    const next = [...ancestors, node.type];
    for (const child of node.content ?? []) visit(child, next);
  };
  for (const body of await mfbe.doc.getElementsByTagName('body')) visit(await mfbe.doc.getNode(body), []);
  return out;
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

/** The tags Internet Explorer wrote for FictionBook Editor's rendering of a mark. */
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
    case 'style':
      return [`<SPAN class=${/^[A-Za-z0-9_-]+$/.test(mark.attrs?.name ?? '') ? mark.attrs.name : `"${attrText(mark.attrs?.name)}"`}>`, '</SPAN>'];
    case 'link': {
      const cls = mark.attrs?.type ? `class=${mark.attrs.type} ` : '';
      return [`<A ${cls}href="${attrText(mark.attrs?.href)}">`, '</A>'];
    }
    default:
      return ['', ''];
  }
}

const sameMark = (a, b) => a.type === b.type && JSON.stringify(a.attrs ?? {}) === JSON.stringify(b.attrs ?? {});

/**
 * The paragraph as the original saw it: `html` (its innerHTML, the marks nested as the book
 * nests them), `plain` (the text the plain expressions saw) and the maps `plainAt[o]` (plain
 * index of the document offset o) and `htmlAt[o]` (HTML index where a search from offset o
 * started: after the character before it and the closing tags that follow that character).
 */
function paragraphView(paragraph, options) {
  if (paragraph.view) return paragraph.view;
  let html = '';
  let plain = '';
  const plainAt = [0];
  const htmlAt = [0];
  let open = [];
  const switchMarks = (marks) => {
    let common = 0;
    while (common < open.length && common < marks.length && sameMark(open[common], marks[common])) common += 1;
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
  for (const item of paragraph.node.content ?? []) {
    const marks = item.marks ?? [];
    if (item.type === 'text') {
      switchMarks(marks);
      for (const ch of item.text ?? '') {
        // One UTF-16 unit at a time, as the document's offsets count.
        for (let k = 0; k < ch.length; k += 1) {
          const unit = ch[k];
          html += escapeText(unit);
          plain += unit === SHY && !options.decodeShy ? '&shy;' : unit;
          plainAt.push(plain.length);
          htmlAt.push(html.length);
        }
      }
    } else {
      switchMarks(marks);
      if (item.type === 'inline-image') {
        const href = attrText(item.attrs?.href);
        const title = item.attrs?.title ? ` title="${attrText(item.attrs.title)}"` : '';
        html += `<SPAN class=image contentEditable=false href="${href}"${title}><IMG src="fbw-internal:${href}"></SPAN>`;
        plain += options.image;
      }
      plainAt.push(plain.length);
      htmlAt.push(html.length);
    }
  }
  switchMarks([]);
  paragraph.view = { html, plain, plainAt, htmlAt, length: plainAt.length - 1 };
  return paragraph.view;
}

/** Number of document offsets of a text block (UTF-16 units, one per inline picture). */
function modelLength(node) {
  let n = 0;
  for (const item of node.content ?? []) n += item.type === 'text' ? (item.text ?? '').length : 1;
  return n;
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
/* The original's plain text of an HTML piece ("newPos", "rslt_replaced")                     */
/* ---------------------------------------------------------------------------------------- */

function forwardPlainOf(options) {
  const img = options.image;
  return (text) => {
    let s = text.replace(/<(?!IMG\b).*?(>|$)/gi, '').replace(/<IMG\b.*?>/gi, img);
    if (options.decodeShy) s = s.replace(/&shy;/g, SHY);
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, NBSP).replace(/&amp;/g, '&');
  };
}

/** The backward variant ran the same replacements, written backwards, on the reversed HTML. */
function backwardPlainOf(options) {
  const img = options.image;
  return (text) => {
    let s = text.replace(/>.*?\bGMI</gi, img).replace(/(^|>)[^><]*?</gi, '');
    if (options.decodeShy) s = s.replace(/;yhs&/g, SHY);
    return s.replace(/;tl&/g, '<').replace(/;tg&/g, '>').replace(/;psbn&/g, NBSP).replace(/;pma&/g, '&');
  };
}

/* ---------------------------------------------------------------------------------------- */
/* The search                                                                                 */
/* ---------------------------------------------------------------------------------------- */

const FIND_TAG_RE = /(^| )([-+])(section|body|epigraph|cite|poem|stanza|title|subtitle|text-author|annotation)(?= |$)/gi;

/** checkAreWeInRightTags(): inTags[name] compared as written (only the lower-case names exist). */
function inRightTags(entry, paragraph, trackAnnotation) {
  if (!entry.condition) return true;
  let ok = true;
  FIND_TAG_RE.lastIndex = 0;
  entry.condition.replace(FIND_TAG_RE, (all, start, sign, name) => {
    if (name === 'annotation' && !trackAnnotation) {
      ok = false;
      return all;
    }
    const known = name === name.toLowerCase();
    const value = known ? paragraph.inTags.has(name) : undefined;
    if (value !== (sign === '+')) ok = false;
    return all;
  });
  return ok;
}

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

/**
 * The hits of every entry in one paragraph (5.x engine): plain entries from `s1Len`, tag entries
 * from `s1HtmlLen`; a tag hit that ends inside a tag or fails its look-behinds is retried one
 * character further. `backward` mirrors the "inside a tag" test for the reversed HTML.
 */
function hitsInParagraph(set, paragraph, s, html, s1Len, s1HtmlLen, plainOf, backward, trackAnnotation) {
  const founds = [];
  for (const entry of set.entries) {
    if (!inRightTags(entry, paragraph, trackAnnotation)) continue;
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
        const newPos = plainOf(html.substr(0, r.index)).length;
        const replaced = plainOf(r[0]);
        // rslt_replaced[0] was undefined in JScript (no string indexing in the page's IE7
        // mode), so the "ends inside a tag" test always ran. JScript's lastIndex after an empty
        // match was one character further.
        let k = r[0].length === 0 ? r.index + 1 : r.index + r[0].length;
        while (k < html.length && html.charAt(k) !== '>' && html.charAt(k) !== '<') k += 1;
        if (k < html.length && html.charAt(k) === (backward ? '<' : '>')) flag = true;
        if (!flag) {
          if (!checkLookBehs(entry, html, r.index)) flag = true;
          else founds.push({ pos: newPos, len: replaced.length, entry });
        }
      }
    }
  }
  // Array.prototype.sort is stable: equal positions keep the order of the list.
  founds.sort((a, b) => a.pos - b.pos);
  return founds;
}

/**
 * The hits of the 5.4 engine kept by "Перейти на следующую пустую строку": a collapsed caret
 * skips a hit right at it (ignoreNullPosition), a look-behind failure or a tag hit ending inside
 * a tag resume after that match / tag.
 */
function hitsInParagraphOld(set, paragraph, s, html, s1Len, s1HtmlLen, ignoreNull, plainOf, trackAnnotation) {
  const founds = [];
  for (const entry of set.entries) {
    if (!inRightTags(entry, paragraph, trackAnnotation)) continue;
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
        const newPos = plainOf(html.substr(0, r.index)).length;
        const replaced = plainOf(r[0]);
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
  founds.sort((a, b) => a.pos - b.pos);
  return founds;
}

/** The selection a hit of `paragraph` gets, [from, to) in document offsets. */
async function selectHit(paragraphs, index, from, to) {
  const paragraph = paragraphs[index];
  if (!paragraph.emptyLine) {
    await mfbe.selection.set({ nodeId: paragraph.nodeId, offset: from }, { nodeId: paragraph.nodeId, offset: to });
    await mfbe.selection.scrollIntoView();
    return;
  }
  // An empty line cannot hold the caret in this editor: the hit selects from the end of the
  // text block before it to the start of the one after it, so the next search starts after it;
  // without such blocks, the editor's nearest place to it.
  let before = index - 1;
  while (before >= 0 && paragraphs[before].emptyLine) before -= 1;
  let after = index + 1;
  while (after < paragraphs.length && paragraphs[after].emptyLine) after += 1;
  const prev = paragraphs[before];
  const next = paragraphs[after];
  if (prev && next) {
    try {
      await mfbe.selection.set({ nodeId: prev.nodeId, offset: modelLength(prev.node) }, { nodeId: next.nodeId, offset: 0 });
      await mfbe.selection.scrollIntoView();
      return;
    } catch {
      // not in the editor's window: fall back to the nearest place
    }
  }
  await mfbe.selection.selectNode(paragraph.nodeId);
  await mfbe.selection.scrollIntoView();
}

/** Index of the paragraph holding `nodeId` (-1: none). */
const indexOfNode = (paragraphs, nodeId) => paragraphs.findIndex((p) => p.nodeId === nodeId);

/**
 * Runs the search. options:
 *   direction        'forward' (default) or 'backward'
 *   image            the placeholder of an inline picture in the plain text ('~~~' or 'ǾǾǾ')
 *   decodeShy        true when the script turned "&shy;" into U+00AD
 *   engine           '5' (default) or '5.4-old' ("Перейти на следующую пустую строку")
 *   trackAnnotation  getTags() knew "annotation"
 *   skipCells        hits in table cells are exclusions (unmarked dates)
 *   finishedStatus   "Поиск завершен!" when nothing is found (default true)
 *   notFound(ctx)    replaces the "nothing found" message; may return a value for run()
 * Resolves "Found" or "NotFound" (undefined after the error message of a broken list).
 */
export async function searchRegExpSet(ctx, set, options = {}) {
  const o = {
    direction: 'forward',
    image: '~~~',
    decodeShy: true,
    engine: '5',
    trackAnnotation: false,
    skipCells: false,
    finishedStatus: true,
    ...options,
  };
  const backward = o.direction === 'backward';
  const oldEngine = o.engine === '5.4-old';

  const selection = await mfbe.selection.get();
  // A picture clicked into a "Control" selection was refused by the original (its message names
  // the variable instead of its value; kept as written). A selected block picture is that case;
  // an inline picture selected as text - the original selected a hit on a picture so - is
  // searched past like text, as the editor cannot tell the two apart.
  if (!selection || (selection.text === '\uFFFC' && selection.nodes.length === 0)) {
    await MsgBox(t(ctx, 'Не обрабатываемый тип выделения: sel.type', 'Unsupported type of selection: sel.type'), ctx.script.name);
    return undefined;
  }
  if (set.errors !== '') {
    await MsgBox(
      t(ctx, 'Ошибки при компиляции регэкспов, заданных в таких строках:\n\n', 'Errors compiling the regular expressions given in these lines:\n\n') +
        set.errors +
        t(ctx, '\n\nПожалуйста, поправьте ошибки, прежде чем использовать скрипт.', '\n\nPlease fix the errors before using the script.'),
      ctx.script.name,
    );
    return undefined;
  }

  const paragraphs = await collectParagraphs(o.trackAnnotation);
  const { anchor, head } = selection;
  let ai = indexOfNode(paragraphs, anchor.nodeId);
  let hi = indexOfNode(paragraphs, head.nodeId);
  if (ai < 0) ai = hi;
  if (hi < 0) hi = ai;
  const collapsed = anchor.nodeId === head.nodeId && anchor.offset === head.offset;
  // IE's range: the end (forward) or the start (backward) of the selection in document order.
  let caret;
  if (ai < 0) caret = null;
  else if (ai === hi) {
    const offsets = [anchor.offset, head.offset];
    caret = { index: ai, offset: backward ? Math.min(...offsets) : Math.max(...offsets) };
  } else {
    const first = ai < hi ? { index: ai, offset: anchor.offset } : { index: hi, offset: head.offset };
    const last = ai < hi ? { index: hi, offset: head.offset } : { index: ai, offset: anchor.offset };
    caret = backward ? first : last;
  }

  const plainOf = backward ? backwardPlainOf(o) : forwardPlainOf(o);
  const reverse = (text) => text.split('').reverse().join('');
  const step = backward ? -1 : 1;

  let index;
  let s1Len;
  let s1HtmlLen;
  if (caret) {
    index = caret.index;
    const view = paragraphView(paragraphs[index], o);
    const offset = Math.max(0, Math.min(caret.offset, view.length));
    s1Len = backward ? view.plain.length - view.plainAt[offset] : view.plainAt[offset];
    s1HtmlLen = backward ? view.html.length - view.htmlAt[offset] : view.htmlAt[offset];
  } else {
    // Not in a text block: the search goes on with the text block after (before) the caret.
    index = backward ? paragraphs.length - 1 : 0;
    s1Len = 0;
    s1HtmlLen = 0;
  }
  let ignoreNull = oldEngine && collapsed;
  let status = null;
  let searched = 0;

  while (index >= 0 && index < paragraphs.length) {
    const paragraph = paragraphs[index];
    const view = paragraphView(paragraph, o);
    const s = backward ? reverse(view.plain) : view.plain;
    const html = backward ? reverse(view.html) : view.html;
    const sLen = s.length;
    const searchIt = oldEngine ? true : s1Len < sLen || sLen === 0;
    let restart = false;
    if (searchIt) {
      const founds = oldEngine
        ? hitsInParagraphOld(set, paragraph, s, html, s1Len, s1HtmlLen, ignoreNull, plainOf, o.trackAnnotation)
        : hitsInParagraph(set, paragraph, s, html, s1Len, s1HtmlLen, plainOf, backward, o.trackAnnotation);
      for (const found of founds) {
        if (ignoreNull && found.pos === s1Len) continue;
        let desc = found.entry.desc;
        if (desc !== undefined) status = desc;
        // Plain [from, to) of the hit in the paragraph's forward text.
        const fromPlain = backward ? sLen - found.pos - found.len : found.pos;
        const toPlain = backward ? sLen - found.pos : found.pos + found.len;
        if (o.skipCells && paragraph.cell) desc = 'Пропустить: ';
        // An exclusion ("Пропустить..."): search on right after it. (The original read
        // desc.indexOf() also when the entry had no description and stopped with an error.)
        if (!oldEngine && desc !== undefined && desc.indexOf('Пропустить') === 0) {
          const offset = backward ? offsetAtOrBefore(view, fromPlain) : offsetAtOrAfter(view, toPlain);
          const next = backward ? view.plain.length - view.plainAt[offset] : view.plainAt[offset];
          // An empty exclusion would be found again and again: step over one character.
          s1Len = next === s1Len && found.len === 0 ? s1Len + 1 : next;
          s1HtmlLen = backward ? view.html.length - view.htmlAt[offset] : view.htmlAt[offset];
          restart = true;
          break;
        }
        const from = offsetAtOrBefore(view, fromPlain);
        const to = Math.max(from, found.len === 0 ? from : offsetAtOrAfter(view, toPlain));
        await selectHit(paragraphs, index, from, to);
        if (status !== null) await mfbe.ui.status(status, { sticky: true });
        return 'Found';
      }
      ignoreNull = false;
    } else if (oldEngine) ignoreNull = false;
    if (restart) continue;
    index += step;
    s1Len = 0;
    s1HtmlLen = 0;
    searched += 1;
    if (searched % 200 === 0) {
      await mfbe.ui.progress(backward ? paragraphs.length - index : index, paragraphs.length);
      if (ctx.cancelled) return 'NotFound';
    }
  }
  if (o.finishedStatus) await mfbe.ui.status(t(ctx, 'Поиск завершен!', 'Search finished!'), { sticky: true });
  else if (status !== null) await mfbe.ui.status(status, { sticky: true });
  if (o.notFound) return o.notFound(ctx, paragraphs);
  await MsgBox(
    backward
      ? t(ctx, 'От позиции курсора до начала документа ничего не найдено.', 'Nothing was found between the caret and the start of the document.')
      : t(ctx, 'От позиции курсора до конца документа ничего не найдено.', 'Nothing was found between the caret and the end of the document.'),
    ctx.script.name,
  );
  return 'NotFound';
}
