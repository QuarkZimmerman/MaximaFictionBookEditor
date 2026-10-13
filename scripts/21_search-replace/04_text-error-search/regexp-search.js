// Engine of the "Поиск по набору регэкспов" scripts (21_Поиск и замена/04 and 10, FictionBook
// Editor 2.7, Tier 1). Each package carries its own copy (sandbox rule: imports only from the
// script's folder); the packages differ in the list of regular expressions they register.
//
// Behaviour of the original: a list of regular expressions is tried paragraph by paragraph from
// the caret to the end of the book; in the first paragraph that contains a match the earliest
// match of all expressions is selected and its description shown in the status bar. A collapsed
// caret starts one character further so that repeated runs walk through the hits. Nothing is
// changed in the document. Three kinds of entries exist:
//   addRegExp(re, keys, description, tagCondition)  - matched against the paragraph text;
//   tagRegExp(re, keys, description, tagCondition)  - matched against the paragraph as HTML-like
//       text with the inline formatting as tags (<EM>, <STRONG>, <SUP>, <SUB>, <STRIKE>,
//       <SPAN class=code>, <A href=…>, <IMG>), the macros <emphasis>, </emphasis>, <strong> …
//       <любые-теги> expanding to patterns for those tags;
//   addMacros(name, re)                              - a named sub-pattern for tagRegExp.
// `keys` is "" or "i"; `tagCondition` is like "+poem -stanza +title" (the paragraph must / must
// not be inside those elements; subtitle and text-author test the paragraph's own type).
// Leading (?<=…) / (?<!…) groups were emulated by the original (JScript had no look-behind);
// JavaScript has it now, so they are kept and the rest of the pattern is wrapped so that the
// look-behind applies to every alternative, as the emulation did.

const TEXT_BLOCKS = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);
const TAG_NAMES = /^(section|body|epigraph|cite|poem|stanza|title|subtitle|text-author)$/i;
const MACRO_NAME_RE = /^<[-а-яёa-z_?/]+>$/i;
const MACRO_USE_RE = /<[-а-яёa-z_?/]+>/gi;
const NBSP = '\u00A0';

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

  const expandMacros = (source) =>
    source.replace(MACRO_USE_RE, (name) => macros.get(name.toLowerCase()) ?? name);

  const compile = (source, keys, withMacros) => {
    const prepared = withMacros ? expandMacros(source) : source;
    const [heads, rest] = splitLookbehinds(prepared);
    // `(?<=а)б|в` meant "(б or в) preceded by а" in the emulation: wrap the rest.
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
        conditions: (tagCondition || '').trim().split(/[ \t]+/).filter(Boolean).map((p) => ({
          wanted: p[0] === '+',
          name: p.slice(1).toLowerCase(),
        })),
      });
    } catch {
      errors.push(`${kind === 'tag' ? 'tagRegExp' : 'addRegExp'}("${source}","${keys}","${description}","${tagCondition ?? ''}")`);
    }
  };

  const set = {
    entries,
    errors,
    addRegExp: (source, keys, description, tagCondition) => add('plain', source, keys, description, tagCondition),
    tagRegExp: (source, keys, description, tagCondition) => add('tag', source, keys, description, tagCondition),
    addMacros(name, source) {
      if (!MACRO_NAME_RE.test(name)) errors.push(`addMacros("${name}","${source}"); // invalid macro name`);
      const expanded = `(${expandMacros(source)})`;
      try {
        new RegExp(expanded, 'g');
      } catch {
        errors.push(`addMacros("${name}","${source}"); // the pattern does not compile`);
        return;
      }
      macros.set(name.toLowerCase(), expanded);
    },
  };
  // The tags the original's HTML view produced for the inline elements.
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
 * Plain text and HTML-like text of a block. `plainAt[k]` is the plain offset of the HTML
 * index `k` (tags map to the offset of the text that follows them), `htmlEnd[p]` the HTML index
 * right after the plain character `p - 1`.
 */
export function paragraphViews(node) {
  let plain = '';
  let html = '';
  const plainAt = [];
  const htmlEnd = [0];
  let open = [];
  const emit = (text, chars) => {
    // `chars` plain characters (not yet appended to `plain`) are written as `text` in the
    // HTML (entities, images).
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
        emit(ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '&' ? '&amp;' : ch, 1);
        plain += ch;
      }
    } else {
      switchMarks([]);
      emit('<IMG>', 1);
      plain += '\uFFFC';
    }
  }
  switchMarks([]);
  plainAt.push(plain.length);
  return { plain, html, plainAt, htmlEnd };
}

/* ---------------------------------------------------------------------------------------- */
/* The search                                                                                */
/* ---------------------------------------------------------------------------------------- */

/** Text blocks of the whole book in document order with their ancestor types. */
async function collectParagraphs() {
  const out = [];
  const visit = (node, ancestors) => {
    if (node.type === 'text') return;
    if (TEXT_BLOCKS.has(node.type)) {
      out.push({ node, nodeId: node.attrs?.nodeId, inside: new Set([...ancestors, node.type]) });
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

/** Earliest hit of `entry` in `paragraph` at or after the plain offset `from` (null if none). */
function findIn(entry, paragraph, views, from, skipExact) {
  const { re } = entry;
  if (!entry.tag) {
    re.lastIndex = from + (skipExact ? 1 : 0);
    if (re.lastIndex > views.plain.length) return null;
    const m = re.exec(views.plain);
    if (!m) return null;
    return { pos: m.index, len: m[0].length };
  }
  const { html, plainAt, htmlEnd } = views;
  re.lastIndex = htmlEnd[from] + (skipExact ? 1 : 0);
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

export async function searchWithSet(ctx, set) {
  if (set.errors.length) {
    await mfbe.ui.message(
      t(ctx, 'Ошибки при компиляции регэкспов, заданных в таких строках:\n\n', 'These regular expression entries failed to compile:\n\n') +
        set.errors.join('\n') +
        t(ctx, '\n\nПожалуйста, поправьте ошибки, прежде чем использовать скрипт.', '\n\nPlease fix them before using the script.'),
      { icon: 'error' },
    );
    return;
  }
  const selection = await mfbe.selection.get();
  if (!selection) {
    await mfbe.ui.message(t(ctx, 'Поставьте курсор в текст книги.', 'Place the caret in the text of the book.'), { icon: 'warning' });
    return;
  }
  const paragraphs = await collectParagraphs();
  // The search starts at the end of the selection; a collapsed caret skips a hit right under it.
  const { anchor, head, nodes } = selection;
  const forward = anchor.nodeId === head.nodeId ? anchor.offset <= head.offset : nodes[0]?.nodeId === anchor.nodeId;
  const end = forward ? head : anchor;
  const collapsed = anchor.nodeId === head.nodeId && anchor.offset === head.offset;
  let index = paragraphs.findIndex((p) => p.nodeId === end.nodeId);
  let from = end.offset;
  let skipExact = collapsed;
  if (index < 0) {
    // The caret is not in a text block: continue with the first text block after it.
    const order = [];
    for (const body of await mfbe.doc.getElementsByTagName('body')) {
      const visit = (n) => {
        if (n.type === 'text') return;
        order.push(n.attrs?.nodeId);
        for (const c of n.content ?? []) visit(c);
      };
      visit(await mfbe.doc.getNode(body));
    }
    const at = order.indexOf(end.nodeId);
    index = paragraphs.findIndex((p) => order.indexOf(p.nodeId) > at);
    from = 0;
    skipExact = false;
    if (index < 0) index = paragraphs.length;
  }
  for (; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index];
    const views = paragraphViews(paragraph.node);
    const founds = [];
    for (const entry of set.entries) {
      if (!matchesConditions(entry, paragraph)) continue;
      const hit = findIn(entry, paragraph, views, from, skipExact);
      if (hit && !(skipExact && hit.pos === from)) founds.push({ ...hit, entry });
    }
    if (founds.length) {
      founds.sort((a, b) => a.pos - b.pos);
      const [best] = founds;
      await mfbe.selection.set(
        { nodeId: paragraph.nodeId, offset: best.pos },
        { nodeId: paragraph.nodeId, offset: best.pos + best.len },
      );
      await mfbe.selection.scrollIntoView();
      if (best.entry.description) await mfbe.ui.status(best.entry.description, { sticky: true });
      return;
    }
    from = 0;
    skipExact = false;
    if (index % 200 === 0) await mfbe.ui.progress(index, paragraphs.length);
    if (ctx.cancelled) return;
  }
  await mfbe.ui.message(
    t(ctx, 'От позиции курсора до конца документа ничего не найдено.', 'Nothing was found between the caret and the end of the document.'),
  );
}
