// Engine of "Поиск возможных заголовков по ключевым словам" (FictionBook Editor 2.7.9, group 13,
// script 570), the 2.7.9 version (5.0) of Sclex's "Поиск по набору регэкспов". It follows the
// engine of the converted 2.7 scripts (scripts/21_search-replace/*/regexp-search.js), with the
// changes of 2.7.9:
//   - the search starts at the end of the selection, a hit right at a collapsed caret included
//     (2.7 skipped it: the 2.7.9 code sets ignoreNullPosition to false);
//   - the paragraph text the expressions see has non-breaking spaces as spaces (the original read
//     innerHTML, whose &nbsp; it turned into " ", and &shy; into a soft hyphen);
//   - a hit whose description starts with "Пропустить" is passed over and the search goes on after
//     it (stokber's exceptions);
//   - when nothing is found, "Поиск завершен!" goes to the status bar before the message.
// Inline pictures count as one character, as in the 2.7 engine's conversion (the original
// counted "~~~", which shifted the selection after a picture).
//
// Entries: addRegExp(re, keys, description, tagCondition) runs on the paragraph's text;
// tagRegExp(...) on an HTML-like rendering of its marks (<EM>, <STRONG>, <SUP>, <SUB>, <STRIKE>,
// <SPAN class=code>, <A href=…>, <IMG>) with the macros of addMacros. `keys` is "" or "i";
// `tagCondition` is like "+poem -stanza +title". Leading (?<=…) / (?<!…) groups, which the
// original emulated, apply to the whole rest of the expression.

const TEXT_BLOCKS = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);
const TAG_NAMES = /^(section|body|epigraph|cite|poem|stanza|title|subtitle|text-author)$/i;
const MACRO_NAME_RE = /^<[-а-яёa-z_?/]+>$/i;
const MACRO_USE_RE = /<[-а-яёa-z_?/]+>/gi;

export function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/** Splits leading look-behind groups off a pattern: returns [lookbehinds, rest]. */
function splitLookbehinds(source) {
  let i = 0;
  const heads = [];
  while (source.startsWith('(?<=', i) || source.startsWith('(?<!', i)) {
    const begin = i;
    let level = 1;
    i += 4;
    while (i < source.length && level !== 0) {
      const ch = source[i];
      if (ch === '(') level += 1;
      if (ch === ')') level -= 1;
      i += ch === '\\' ? 2 : 1;
    }
    heads.push(source.slice(begin, i));
  }
  return [heads, source.slice(i)];
}

/** Builds the set of expressions; `errors` collects the entries that failed to compile. */
export function createRegExpSet() {
  const macros = new Map();
  const entries = [];
  const errors = [];

  const expandMacros = (source) => source.replace(MACRO_USE_RE, (name) => macros.get(name.toLowerCase()) ?? name);

  const compile = (source, keys, withMacros) => {
    const prepared = withMacros ? expandMacros(source) : source;
    const [heads, rest] = splitLookbehinds(prepared);
    const combined = heads.length ? `${heads.join('')}(?:${rest})` : rest;
    return new RegExp(combined, `g${keys || ''}`);
  };

  const add = (kind, source, keys, description, tagCondition) => {
    try {
      if (tagCondition && !tagCondition.trim().split(/[ \t]+/).every((p) => /^[-+]/.test(p) && TAG_NAMES.test(p.slice(1)))) {
        throw new Error('bad tag condition');
      }
      entries.push({
        re: compile(source, keys, kind === 'tag'),
        tag: kind === 'tag',
        description: description || '',
        conditions: (tagCondition || '').trim().split(/[ \t]+/).filter(Boolean).map((p) => ({ wanted: p[0] === '+', name: p.slice(1).toLowerCase() })),
      });
    } catch {
      errors.push(`  ${kind === 'tag' ? 'tagRegExp' : 'addRegExp'}("${source}","${keys}","${description}","${tagCondition}"`);
    }
  };

  const set = {
    entries,
    errors,
    addRegExp: (source, keys, description, tagCondition) => add('plain', source, keys, description, tagCondition),
    tagRegExp: (source, keys, description, tagCondition) => add('tag', source, keys, description, tagCondition),
    addMacros(name, source) {
      if (!MACRO_NAME_RE.test(name)) errors.push(`addMacros("${name}","${source}"); //неверное имя макроса`);
      const expanded = `(${expandMacros(source)})`;
      try {
        new RegExp(expanded, 'g');
      } catch {
        errors.push(`addMacros("${name}","${source}"); // ошибка при компиляции регэкспа`);
        return;
      }
      macros.set(name.toLowerCase(), expanded);
    },
  };
  // The macros the original defined for the tags of its HTML view.
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
/* Paragraph views                                                                            */
/* ---------------------------------------------------------------------------------------- */

const MARK_TAGS = {
  emphasis: ['<EM>', '</EM>'],
  strong: ['<STRONG>', '</STRONG>'],
  sup: ['<SUP>', '</SUP>'],
  sub: ['<SUB>', '</SUB>'],
  strikethrough: ['<STRIKE>', '</STRIKE>'],
  code: ['<SPAN class=code>', '</SPAN>'],
};
const MARK_ORDER = ['link', 'style', 'emphasis', 'strong', 'sup', 'sub', 'strikethrough', 'code'];

function tagsFor(mark) {
  if (MARK_TAGS[mark.type]) return MARK_TAGS[mark.type];
  if (mark.type === 'link') return [`<A href="${mark.attrs?.href ?? ''}">`, '</A>'];
  if (mark.type === 'style') return [`<SPAN class="${mark.attrs?.name ?? ''}">`, '</SPAN>'];
  return ['', ''];
}

function markKey(mark) {
  return `${mark.type}:${JSON.stringify(mark.attrs ?? {})}`;
}

/**
 * The paragraph's text as the expressions see it (non-breaking spaces as spaces, a picture as
 * one character) and its HTML-like rendering. `plainAt[k]` is the text offset of HTML index k,
 * `htmlEnd[p]` the HTML index right after text character p - 1.
 */
export function paragraphViews(node) {
  let plain = '';
  let html = '';
  const plainAt = [];
  const htmlEnd = [0];
  let open = [];
  const emit = (text, chars) => {
    for (let i = 0; i < text.length; i += 1) plainAt.push(plain.length);
    html += text;
    for (let i = 0; i < chars; i += 1) htmlEnd.push(html.length);
  };
  const emitTag = (tag) => {
    for (let i = 0; i < tag.length; i += 1) plainAt.push(plain.length);
    html += tag;
  };
  const switchMarks = (marks) => {
    const sorted = [...marks].sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
    const keys = sorted.map(markKey);
    let common = 0;
    while (common < open.length && common < keys.length && open[common].key === keys[common]) common += 1;
    for (let i = open.length - 1; i >= common; i -= 1) emitTag(tagsFor(open[i].mark)[1]);
    open = open.slice(0, common);
    for (let i = common; i < sorted.length; i += 1) {
      emitTag(tagsFor(sorted[i])[0]);
      open.push({ key: keys[i], mark: sorted[i] });
    }
  };
  for (const item of node.content ?? []) {
    if (item.type === 'text') {
      switchMarks(item.marks ?? []);
      for (const ch of item.text) {
        emit(ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '&' ? '&amp;' : ch === ' ' ? '&nbsp;' : ch, 1);
        plain += ch === ' ' ? ' ' : ch;
      }
    } else {
      switchMarks([]);
      emit('<IMG>', 1);
      plain += '￼';
    }
  }
  switchMarks([]);
  plainAt.push(plain.length);
  return { plain, html, plainAt, htmlEnd };
}

/* ---------------------------------------------------------------------------------------- */
/* The search                                                                                */
/* ---------------------------------------------------------------------------------------- */

/** Text blocks of the whole book in document order, with the elements they are in. */
export async function collectParagraphs() {
  const out = [];
  const visit = (node, ancestors) => {
    if (node.type === 'text') return;
    if (TEXT_BLOCKS.has(node.type)) {
      out.push({ node, nodeId: node.attrs?.nodeId, inside: new Set([...ancestors, node.type === 'date' ? 'text-author' : node.type]) });
      return;
    }
    const next = [...ancestors, node.type];
    for (const child of node.content ?? []) visit(child, next);
  };
  for (const body of await mfbe.doc.getElementsByTagName('body')) visit(await mfbe.doc.getNode(body), []);
  return out;
}

function matchesConditions(entry, paragraph) {
  return entry.conditions.every((c) => paragraph.inside.has(c.name) === c.wanted);
}

/** First hit of `entry` in the paragraph at or after the text offset `from` (null if none). */
function findIn(entry, views, from) {
  const { re } = entry;
  if (!entry.tag) {
    re.lastIndex = from;
    if (re.lastIndex > views.plain.length) return null;
    const m = re.exec(views.plain);
    if (!m) return null;
    return { pos: m.index, len: m[0].length };
  }
  const { html, plainAt, htmlEnd } = views;
  re.lastIndex = htmlEnd[from];
  for (;;) {
    if (re.lastIndex > html.length) return null;
    const m = re.exec(html);
    if (!m) return null;
    const end = m.index + m[0].length;
    // A match that stops inside a tag is not a match (the original resumed after that tag).
    let k = end;
    while (k < html.length && html[k] !== '>' && html[k] !== '<') k += 1;
    if (k < html.length && html[k] === '>') {
      re.lastIndex = k + 1;
      continue;
    }
    if (m[0].length === 0) re.lastIndex = m.index + 1;
    const pos = plainAt[m.index];
    return { pos, len: plainAt[end] - pos };
  }
}

/**
 * The next hit from paragraph `index`, text offset `from`: { paragraph, pos, len, entry } or null.
 * A hit whose description starts with "Пропустить" is passed over.
 */
export async function findNext(ctx, set, paragraphs, index, from) {
  let offset = from;
  for (let i = index; i < paragraphs.length; i += 1) {
    const paragraph = paragraphs[i];
    const views = paragraphViews(paragraph.node);
    for (;;) {
      if (!(offset < views.plain.length || views.plain.length === 0)) break;
      const founds = [];
      for (const entry of set.entries) {
        if (!matchesConditions(entry, paragraph)) continue;
        const hit = findIn(entry, views, offset);
        if (hit) founds.push({ ...hit, entry });
      }
      if (!founds.length) break;
      founds.sort((a, b) => a.pos - b.pos);
      const [best] = founds;
      if (best.entry.description.indexOf('Пропустить') === 0) {
        // пропускаем исключения... (stokber): the search goes on after this hit
        offset = best.pos + best.len + (best.len === 0 ? 1 : 0);
        continue;
      }
      return { paragraph, pos: best.pos, len: best.len, entry: best.entry };
    }
    offset = 0;
    if (i % 200 === 199) {
      await mfbe.ui.progress(i + 1, paragraphs.length);
      if (ctx.cancelled) return null;
    }
  }
  return null;
}

/** Where the search starts: the end of the selection (the paragraph index and text offset). */
export function startOf(selection, paragraphs) {
  const { anchor, head, nodes } = selection;
  const forward = anchor.nodeId === head.nodeId ? anchor.offset <= head.offset : nodes[0]?.nodeId === anchor.nodeId;
  const end = forward ? head : anchor;
  const index = paragraphs.findIndex((p) => p.nodeId === end.nodeId);
  return index < 0 ? { index: 0, from: 0 } : { index, from: end.offset };
}

export async function searchWithSet(ctx, set) {
  if (set.errors.length) {
    await mfbe.ui.message(
      t(ctx, 'Ошибки при компиляции регэкспов, заданных в таких строках:\n\n', 'These regular expression entries failed to compile:\n\n') +
        set.errors.join('\n') +
        t(ctx, '\n\nПожалуйста, поправьте ошибки, прежде чем использовать скрипт.', '\n\nPlease fix them before using the script.'),
      { icon: 'error' },
    );
    return 'NotFound';
  }
  const selection = await mfbe.selection.get();
  if (!selection) return 'NotFound';
  const paragraphs = await collectParagraphs();
  const { index, from } = startOf(selection, paragraphs);
  const hit = await findNext(ctx, set, paragraphs, index, from);
  if (ctx.cancelled) return 'NotFound';
  if (hit) {
    if (hit.entry.description) await mfbe.ui.status(hit.entry.description, { sticky: true });
    await mfbe.selection.set({ nodeId: hit.paragraph.nodeId, offset: hit.pos }, { nodeId: hit.paragraph.nodeId, offset: hit.pos + hit.len });
    await mfbe.selection.scrollIntoView();
    return 'Found';
  }
  await mfbe.ui.status(t(ctx, 'Поиск завершен!', 'Search finished!'), { sticky: true });
  await mfbe.ui.message(t(ctx, 'От позиции курсора до конца документа ничего не найдено.', 'Nothing was found between the caret and the end of the document.'));
  return 'NotFound';
}
