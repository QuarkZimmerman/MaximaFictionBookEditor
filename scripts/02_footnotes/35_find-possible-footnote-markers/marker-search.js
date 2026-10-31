// Engine of "Поиск возможных маркеров сносок" (FictionBook Editor 2.7.9, 02_Примечания/35): the
// older generation of Sclex's "Поиск по набору регэкспов" (search by a set of regular
// expressions), with tagRegExp, the expressions over the paragraph's HTML.
//
// What the original did, and what is reproduced here:
// - addRegExp(re, keys, desc, tags) searches the paragraph's text (the tags removed, the
//   entities decoded), tagRegExp(...) its HTML as Internet Explorer gave it (innerHTML, see
//   lib/ie-html.js) with the macros <sup> and </sup> expanded; `keys` "" or "i"; `tags` a
//   condition like "-subtitle". Leading look-behinds, which JScript lacked and the original cut
//   off and checked against the text before the match, are left to the engine's own look-behind:
//   for these expressions both give the same matches (the look-behind's characters can never be
//   part of the match). The expressions are compiled without the u flag, as JScript had none.
// - The search goes paragraph by paragraph from the end of the selection to the end of the book,
//   the caret's paragraph from the caret on - one character further for a collapsed caret, and
//   a match right at the caret does not count then (ignoreNullPosition); in the first paragraph
//   with matches the earliest one (of two at one place the expression registered first) is
//   selected and its description shown in the status bar. Nothing found: a message. Run()
//   returns nothing. A match that ends inside a tag is passed over (the original went on after
//   that tag).
// The book, the selection and the selecting come from nav-lib.js (group 16's, unchanged).

import { loadBook, locate, setCaret, setRange, t, textOf } from './nav-lib.js';
import { ieHtml, offsetAt } from './lib/ie-html.js';

const TAG_NAMES = /^(section|body|epigraph|cite|poem|stanza|title|subtitle|text-author)$/i;
const CONTAINERS = new Set(['section', 'body', 'epigraph', 'cite', 'poem', 'stanza', 'title']);

/** The predefined macros of the original (the ones these expressions use). */
const MACROS = {
  '<sup>': '(<[Ss][Uu][Pp](?![a-z])[^>]*?>)',
  '</sup>': '(</[Ss][Uu][Pp]>)',
};

export function createMarkerSet() {
  const entries = [];
  const errors = [];
  const add = (tag, source, keys, description, tagCondition) => {
    try {
      const parts = (tagCondition || '').trim().split(/[ \t]+/).filter(Boolean);
      if (!parts.every((part) => /^[-+]/.test(part) && TAG_NAMES.test(part.slice(1)))) throw new Error('tags');
      const expanded = tag ? source.replace(/<[-а-яёa-z_?/]+>/gi, (name) => MACROS[name.toLowerCase()] ?? name) : source;
      entries.push({
        tag,
        re: new RegExp(expanded, `g${keys || ''}`),
        description,
        conditions: parts.map((part) => ({ wanted: part[0] === '+', name: part.slice(1).toLowerCase() })),
      });
    } catch {
      errors.push(`  ${tag ? 'tagRegExp' : 'addRegExp'}("${source}","${keys}","${description?.ru ?? ''}","${tagCondition}"`);
    }
  };
  return {
    entries,
    errors,
    addRegExp: (source, keys, description, tagCondition) => add(false, source, keys, description, tagCondition),
    tagRegExp: (source, keys, description, tagCondition) => add(true, source, keys, description, tagCondition),
  };
}

/** The elements a paragraph is inside, as the original's getTags saw them. */
function tagsOf(p) {
  const inside = new Set();
  if (p.cls === 'subtitle' || p.cls === 'text-author') inside.add(p.cls);
  for (let node = p.parent; node && node.type !== 'root'; node = node.parent) {
    if (CONTAINERS.has(node.cls)) inside.add(node.cls);
  }
  return inside;
}

/** The earliest matches of every expression in one paragraph from `from` (`htmlFrom`). */
function matchesIn(set, p, text, html, from, htmlFrom) {
  const inside = tagsOf(p);
  const founds = [];
  for (const entry of set.entries) {
    if (!entry.conditions.every((c) => inside.has(c.name) === c.wanted)) continue;
    const re = entry.re;
    if (!entry.tag) {
      if (from > text.length) continue;
      re.lastIndex = from;
      const m = re.exec(text);
      if (m) founds.push({ pos: m.index, len: m[0].length, entry });
      continue;
    }
    if (htmlFrom > html.html.length) continue;
    re.lastIndex = htmlFrom;
    for (;;) {
      const m = re.exec(html.html);
      if (!m) break;
      if (m[0].length === 0) re.lastIndex += 1;
      // a match ending inside a tag: the original went on right after that tag
      let k = m.index + m[0].length;
      while (k < html.html.length && html.html[k] !== '>' && html.html[k] !== '<') k += 1;
      if (k < html.html.length && html.html[k] === '>') {
        re.lastIndex = k + 1;
        continue;
      }
      const pos = offsetAt(html.starts, m.index);
      const end = offsetAt(html.starts, m.index + m[0].length);
      founds.push({ pos, len: end - pos, entry });
      break;
    }
  }
  return founds.sort((a, b) => a.pos - b.pos);
}

/**
 * Where the HTML search of the caret's paragraph starts: after the HTML of the characters before
 * the caret and the closing tags right after them (the original's s1_html_len).
 */
function htmlOffset(html, offset) {
  if (offset <= 0) return 0;
  const s = html.html;
  let i = html.starts[offset - 1];
  if (s[i] === '<') i = s.indexOf('>', i) + 1;
  else if (s[i] === '&') i = s.indexOf(';', i) + 1;
  else i += 1;
  while (s.startsWith('</', i)) i = s.indexOf('>', i) + 1;
  return i;
}

export async function runMarkerSearch(ctx, set) {
  if (set.errors.length) {
    await mfbe.ui.message(
      t(ctx, 'Ошибки при компиляции регэкспов, заданных в таких строках:\n\n', 'These regular expression entries failed to compile:\n\n') +
        set.errors.join('\n') +
        t(ctx, '\n\nПожалуйста, поправьте ошибки, прежде чем использовать скрипт.', '\n\nPlease fix them before using the script.'),
      { icon: 'error' },
    );
    return;
  }
  const book = await loadBook();
  const where = await locate(book, true);
  if (!where) return;
  if (where.picture) {
    // The original printed the words "sel.type" here instead of the kind of selection.
    await mfbe.ui.message(
      t(ctx, 'Не обрабатываемый тип выделения: выделена картинка.', 'Unsupported kind of selection: a picture is selected.'),
      { icon: 'error' },
    );
    return;
  }
  const from = where.end;
  let index = Math.floor(from.index);
  let offset = from.item && from.item.kind === 'p' ? from.offset : 0;
  let first = index === from.index && index >= 0;
  if (!first) {
    // not in a paragraph: the search starts with the next one
    index = Math.floor(from.index) + 1;
    offset = 0;
  }
  const skip = where.collapsed && first; // ignoreNullPosition
  for (let steps = 0; index < book.ps.length; steps += 1, index += 1) {
    if (ctx.cancelled) return;
    if (steps % 500 === 499) await mfbe.ui.progress(index, book.ps.length);
    const p = book.ps[index];
    const text = textOf(p);
    const html = ieHtml(p.kind === 'p' && !p.isPlaceholder && p.type !== 'empty-line' ? p.node.content ?? [] : []);
    const isFirst = first && steps === 0;
    const start = isFirst ? offset + (skip ? 1 : 0) : 0;
    const htmlStart = isFirst ? htmlOffset(html, offset) + (skip ? 1 : 0) : 0;
    const hit = matchesIn(set, p, text, html, start, htmlStart).find((f) => !(isFirst && skip && f.pos === offset));
    if (!hit) continue;
    await mfbe.ui.status(t(ctx, hit.entry.description.ru, hit.entry.description.en), { sticky: true });
    if (hit.len === 0) await setCaret(p, hit.pos);
    else await setRange(p, hit.pos, p, hit.pos + hit.len);
    return;
  }
  await mfbe.ui.message(
    t(ctx, 'От позиции курсора до конца документа ничего не найдено.', 'Nothing was found between the caret and the end of the document.'),
  );
}
