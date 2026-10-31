// The engine of this package, its own copy: the program of its original, FictionBook Editor 2.7.9
// Scripts/03_Комментарии/05_Добавить последний комментарий, введя его текст в окошке.js.
// Every package of the groups 02 and 03 carries its own copy (the sandbox loads modules from the
// script's own folder only), each with the texts of its own original.
//
// Sclex's note scripts are one JScript program with a block of settings at the top, which
// index.js passes here; the scripts of a group differ in that block, in some of their texts and,
// for the renumbering ones, in lines of their own. What it does, in the order of the original:
// - finds the comments body and refuses sections nested in its sections;
// - in "add" mode works out the number of the new note from the nearest note link before the
//   caret, asks for the note text when the settings say so, and in "last" mode refuses when a
//   note link follows the caret;
// - renumbers the sections of the body (ids, titles) and every link of the page that points to
//   one of them (address and text), leaving room for the new note;
// - replaces the selection with the new note link and inserts the new section (an empty
//   paragraph or the entered text), moving the caret into it when the settings say so;
// - writes the result to the status bar (window.external.SetStatusBarText), whatever EndWindow
//   says.
// The page is FictionBook Editor's: the book's annotation and history, then every body. A link in
// the annotation or the history counts and is renumbered like one in a body, and a note can be
// added there (doc.setDescription writes them back). An address is read as the original's
// getLocalHref did: the id after "#" of a local address.
// The whole run is one undo step, and every check happens before the first change: a refusal or
// a cancelled prompt leaves the book as it was. (By then the original had pasted the new link and
// given the body its title, or made the body; it took the link back on a refusal, not on a
// cancelled prompt.)
// The original's notice, kept as written (FR-029):
// добавление сноски между уже имеющимися
// написал Sclex
// версия 2.8

const TEXT_BLOCKS = new Set(['p', 'subtitle', 'v', 'text-author', 'td', 'th']);

/** The settings of the original that index.js does not pass: its templates and note type. */
const SETTINGS = {
  idTemplate: 'c_%N', // the ids of the sections of the comments body
  titleTemplate: '%N', // the title of a comment
  linkTemplate: '{%N}', // the text of a link, in superscript (the original's "<SUP>{%N}</SUP>")
  linkSup: true,
  bodyName: 'comments', // the name attribute of the comments body
  bodyTitle: 'Комментарии', // the title of the comments body
  noteType: null, // a comment link has no type
  isNoteLink: (link) => typeof link.id === 'string' && /^c_/.test(link.id), // the original's isItNote: the local address starts with c_
};

/** Russian in the Russian interface, English otherwise. */
export function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/* ------------------------------------------------------------------------------------------ */
/* The texts of the original (its Russian, and English)                                        */
/* ------------------------------------------------------------------------------------------ */

const TEXTS = {
  nested: [
    'В body комментариев есть разделы второго уровня вложенности. Такие документы не обрабатываются данным скриптом. Работа скрипта завершена.',
    'The comments body has sections at the second level of nesting. Such documents are not processed by this script. The script has finished.',
  ],
  numberUnknown: [
    'Не удалось создать комментарий.\n\n' +
      'Чтобы определить, с каким разделом в body комментариев ' +
      'связать сноску, которую пользователь хочет вставить, ' +
      'скрипт смотрит, с каким разделом в body комментариев ' +
      'связана определенная ранее созданная сноска. А именно – ' +
      'скрипт смотрит на ближайшую сноску вверх по документу ' +
      'от той сноски, которую пытается создать и вставить. ' +
      'Но в этот раз оказалось, что эта ближайшая сверху ' +
      'сноска не связана корректным образом с разделом в body ' +
      'комментариев. Поэтому, чтобы вставить новую сноску, ' +
      'исправьте, пожалуйста, сноску, которая идет перед ней.',
    'The comment could not be created.\n\n' +
      'To find out which section of the comments body the link the user wants to insert ' +
      'should be tied to, the script looks at the section of the comments body that a link ' +
      'created earlier is tied to - namely the nearest link above the one it is trying to ' +
      'create and insert. This time, however, that nearest link above is not tied properly ' +
      'to a section of the comments body. So, to insert the new link, please correct the ' +
      'link that comes before it.',
  ],
  notLast: [
    'Ошибка. Это получается не последняя сноска в документе!',
    'Error: this would not be the last comment of the document!',
  ],
  prompt: [
    'Текст комментария. Используйте <b>...</b> <i>...</i> <br> <strong>...</strong> <emphasis>...</emphasis> <em>...</em>',
    'Comment text. You may use <b>...</b> <i>...</i> <br> <strong>...</strong> <emphasis>...</emphasis> <em>...</em>',
  ],
  added: (n, time) => [`Добавлена сноска № ${n}. Время работы скрипта: ${time}`, `Comment No. ${n} added. Time taken: ${time}`],
  renumbered: (time) => [
    `Перенумерация сносок успешно завершена. Время работы скрипта: ${time}`,
    `Comments renumbered successfully. Time taken: ${time}`,
  ],
};

function fill(template, n) {
  return template.replace('%N', String(n));
}

function copy(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/**
 * The original's getLocalHref: null without "#"; what follows "main.html#" (the page's own
 * address in Internet Explorer); else the address without its first character - the id of
 * "#id", nothing an id could equal for an external address.
 */
export function localHref(href) {
  if (typeof href !== 'string' || href.indexOf('#') < 0) return null;
  const at = href.search(/main\.html#/i);
  if (at >= 0) return href.slice(at + 10);
  return href.substring(1);
}

function sameLink(a, b) {
  return !!a && !!b && a.attrs.href === b.attrs.href && (a.attrs.type ?? null) === (b.attrs.type ?? null);
}

function linkMarkOf(textNode) {
  return (textNode.marks ?? []).find((m) => m.type === 'link') ?? null;
}

/**
 * The text blocks of the page in FictionBook Editor's order: those of the annotation and of the
 * history of `description` (a working copy, written back with doc.setDescription), then those
 * of every body. -> [{ nodeId, node, inDescription, order }]
 */
export function pageBlocks(doc, description) {
  const blocks = [];
  const visit = (node, inDescription) => {
    if (!node || typeof node !== 'object' || node.type === 'text') return;
    if (TEXT_BLOCKS.has(node.type)) {
      blocks.push({ nodeId: node.attrs?.nodeId ?? null, node, inDescription, order: blocks.length });
      return;
    }
    for (const child of node.content ?? []) visit(child, inDescription);
  };
  visit(description?.titleInfo?.annotation, true);
  visit(description?.documentInfo?.history, true);
  for (const body of doc.bodies) visit(body, false);
  return blocks;
}

/**
 * Every link of the page in page order (the legacy `document.links`): consecutive text nodes
 * carrying the same link mark form one link.
 * -> [{ block, blockId, href, id, type, start, end, first, last }] (offsets/indexes inside the block).
 */
export function collectLinks(blocks) {
  const links = [];
  for (const block of blocks) {
    let pos = 0;
    let current = null;
    (block.node.content ?? []).forEach((child, index) => {
      const mark = child.type === 'text' ? linkMarkOf(child) : null;
      const len = child.type === 'text' ? child.text.length : 1;
      if (mark && current && sameLink(current.mark, mark) && current.last === index - 1) {
        current.end = pos + len;
        current.last = index;
      } else if (mark) {
        current = {
          block, blockId: block.nodeId, mark, href: mark.attrs.href, id: localHref(mark.attrs.href),
          type: mark.attrs.type ?? null, start: pos, end: pos + len, first: index, last: index,
        };
        links.push(current);
      } else {
        current = null;
      }
      pos += len;
    });
  }
  return links;
}

/** Text runs that make one link node: `[N]` plain, or `{N}` as superscript for comments. */
function linkTextNode(text, baseMarks, href, type, sup) {
  const marks = baseMarks.filter((m) => m.type !== 'link' && m.type !== 'sup' && m.type !== 'sub');
  marks.push({ type: 'link', attrs: type ? { href, type } : { href } });
  if (sup) marks.push({ type: 'sup' });
  return { type: 'text', text, marks };
}

/** Marks at a character offset of a block: those of the text run the offset falls into. */
function marksAt(content, offset) {
  let pos = 0;
  for (const child of content) {
    const len = child.type === 'text' ? child.text.length : 1;
    if (offset > pos && offset <= pos + len) return child.type === 'text' ? (child.marks ?? []) : [];
    pos += len;
  }
  if (offset === 0 && content[0]?.type === 'text') return content[0].marks ?? [];
  return [];
}

/** Replaces the characters [from, to) of a block's content with `node`. */
function spliceContent(content, from, to, node) {
  const out = [];
  let pos = 0;
  let inserted = false;
  for (const child of content) {
    const len = child.type === 'text' ? child.text.length : 1;
    const a = pos;
    const z = pos + len;
    pos = z;
    if (z <= from || a >= to) {
      if (a >= to && !inserted) {
        out.push(node);
        inserted = true;
      }
      out.push(child);
      continue;
    }
    if (child.type !== 'text') {
      if (!inserted) {
        out.push(node);
        inserted = true;
      }
      continue;
    }
    const before = child.text.slice(0, Math.max(0, from - a));
    const after = child.text.slice(Math.min(len, to - a));
    if (before) out.push({ ...child, text: before });
    if (!inserted) {
      out.push(node);
      inserted = true;
    }
    if (after) out.push({ ...child, text: after });
  }
  if (!inserted) out.push(node);
  return out;
}

/* ------------------------------------------------------------------------------------------ */
/* Note text entered in a prompt (the "введя его текст в окошке" variants)                     */
/* ------------------------------------------------------------------------------------------ */

const TAG_MARKS = { b: 'strong', strong: 'strong', i: 'emphasis', em: 'emphasis', emphasis: 'emphasis', sup: 'sup', sub: 'sub' };
const ENTITIES = { nbsp: '\u00A0', lt: '<', gt: '>', amp: '&', quot: '"' };

/**
 * Parses the mini markup the original allowed (<b> <i> <br> <strong> <emphasis> <em> <sup> <sub>)
 * into paragraphs; returns { paragraphs } or { error: 1..5 } with the original error codes.
 */
export function parseNoteText(source) {
  const paragraphs = [];
  let runs = [];
  let stack = [];
  let text = '';
  const flushText = () => {
    if (text) runs.push({ type: 'text', text, marks: stack.map((m) => ({ type: m })) });
    text = '';
  };
  const flushParagraph = () => {
    flushText();
    const plain = runs.map((r) => r.text).join('');
    // A blank paragraph (the original's default "&nbsp;") becomes an empty paragraph to fill in.
    paragraphs.push({ type: 'p', attrs: {}, content: /^[\s\u00A0]*$/.test(plain) ? [] : runs });
    runs = [];
  };
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '<') {
      const close = source.indexOf('>', i + 1);
      const nextOpen = source.indexOf('<', i + 1);
      if (close < 0 || (nextOpen >= 0 && nextOpen < close)) return { error: 4 };
      const raw = source.slice(i + 1, close).trim();
      if (!/^\/?[a-z]+$/i.test(raw)) return { error: 1 };
      const closing = raw.startsWith('/');
      const name = raw.replace('/', '').toLowerCase();
      if (name === 'br') {
        if (closing) return { error: 2 };
        flushParagraph();
      } else if (name === 'p') {
        if (closing) flushParagraph();
      } else if (TAG_MARKS[name]) {
        const mark = TAG_MARKS[name];
        flushText();
        if (!closing) stack.push(mark);
        else if (stack[stack.length - 1] !== mark) return { error: 3 };
        else stack.pop();
      } else return { error: 2 };
      i = close + 1;
      continue;
    }
    if (ch === '&') {
      const semi = source.indexOf(';', i + 1);
      const name = semi > 0 ? source.slice(i + 1, semi) : '';
      if (ENTITIES[name]) {
        text += ENTITIES[name];
        i = semi + 1;
        continue;
      }
    }
    text += ch;
    i += 1;
  }
  if (stack.length > 0) return { error: 5 };
  flushParagraph();
  return { paragraphs };
}

const PARSE_ERRORS = {
  1: ['Ошибка. Недопустимый символ в имени тэга.', 'Error: invalid character in a tag name.'],
  2: ['Ошибка. Неразрешенное имя тэга.', 'Error: this tag is not allowed.'],
  3: ['Ошибка. Имя закрывающего тэга не соответствует имени открывающего.', 'Error: the closing tag does not match the opening one.'],
  4: ['Ошибка. Не закрыт тэг правой угловой скобкой, как уже начинается новый, либо не закрыт последний тэг в строке.', 'Error: a tag is not closed with ">" before the next one starts, or the last tag is not closed.'],
  5: ['Ошибка. Для открытого тэга нет соответствующего закрывающего.', 'Error: an opened tag has no closing tag.'],
};

async function askNoteText(ctx) {
  const prompt = t(ctx, TEXTS.prompt[0], TEXTS.prompt[1]);
  let value = '';
  for (;;) {
    value = await mfbe.ui.prompt(prompt, { defaultValue: value });
    if (value === null) return null;
    const parsed = parseNoteText(value);
    if (!parsed.error) return parsed.paragraphs;
    const [ru, en] = PARSE_ERRORS[parsed.error];
    await mfbe.ui.message(t(ctx, ru, en), { icon: 'error' });
  }
}

/* ------------------------------------------------------------------------------------------ */
/* The engine                                                                                 */
/* ------------------------------------------------------------------------------------------ */

function title(text) {
  return { type: 'title', attrs: {}, content: [{ type: 'p', attrs: {}, content: [{ type: 'text', text }] }] };
}

/** The time a run took, as the original wrote it ("0.4 с", "1 мин. 2.5 с"). */
function elapsed(since) {
  const ms = Date.now() - since;
  const min = Math.floor(ms / 60000);
  const sec = Math.ceil(10 * (ms / 1000 - min * 60)) / 10;
  return min > 0 ? `${min} мин. ${sec} с` : `${sec} с`;
}

/**
 * Runs the original with the settings block of index.js:
 *   endWindow (EndWindow), addNote (addSnoska), inputText (InputSnoskaText),
 *   moveFocus (MoveFocusToNote), lastMode (lastSnoskaMode).
 */
export async function runNotesScript(ctx, options) {
  const started = Date.now();
  const o = { ...SETTINGS, ...options };

  const doc = await mfbe.doc.get();
  const description = copy(doc.description ?? {});
  let descriptionChanged = false;
  const notesBody = doc.bodies.find((b) => b.attrs?.name === o.bodyName) ?? null;
  const sections = notesBody ? notesBody.content.filter((c) => c.type === 'section') : [];

  // Sections nested in the sections of the body are not handled (as in the original).
  if (sections.some((s) => s.content.some((c) => c.type === 'section'))) {
    await mfbe.ui.message(t(ctx, TEXTS.nested[0], TEXTS.nested[1]), { icon: 'warning' });
    return;
  }

  const blocks = pageBlocks(doc, description);
  const blockById = new Map(blocks.filter((b) => b.nodeId).map((b) => [b.nodeId, b]));
  const links = collectLinks(blocks);
  const sectNumById = new Map();
  sections.forEach((s, i) => {
    if (s.attrs?.id) sectNumById.set(s.attrs.id, i + 1);
  });

  // --- the new note: where it goes and which number it gets --------------------------------
  let insertN = 1000000;
  let insertCnt = 0;
  let target = null; // { blockId, from, to, index } - index = position among the links
  if (o.addNote) {
    const sel = await mfbe.selection.get();
    if (!sel || sel.nodes.length === 0) {
      await mfbe.ui.message(t(ctx, 'Курсор не находится в тексте.', 'The caret is not inside text.'), { icon: 'warning' });
      return;
    }
    if (sel.nodes.length > 1) {
      await mfbe.ui.message(
        t(ctx, 'Выделение должно находиться внутри одного абзаца.', 'The selection must stay inside one paragraph.'),
        { icon: 'warning' },
      );
      return;
    }
    const blockId = sel.nodes[0].nodeId;
    const from = Math.min(sel.anchor.offset, sel.head.offset);
    const to = Math.max(sel.anchor.offset, sel.head.offset);
    // Links before the insertion point = links of earlier blocks + links of this block ending before it.
    const here = blockById.get(blockId)?.order ?? -1;
    let index = 0;
    for (const link of links) {
      const where = link.block.order;
      if (where < here || (where === here && link.start < from)) index += 1;
      else break;
    }
    target = { blockId, from, to, index };
    insertCnt = 1;

    if (o.lastMode && links.slice(index).some((l) => o.isNoteLink(l))) {
      await mfbe.ui.message(t(ctx, TEXTS.notLast[0], TEXTS.notLast[1]), { icon: 'error' });
      return;
    }
    let previous = -1;
    for (let i = index - 1; i >= 0; i -= 1) {
      if (o.isNoteLink(links[i])) {
        previous = i;
        break;
      }
    }
    if (previous >= 0) {
      const num = links[previous].id ? sectNumById.get(links[previous].id) : undefined;
      if (num === undefined) {
        await mfbe.ui.message(t(ctx, TEXTS.numberUnknown[0], TEXTS.numberUnknown[1]), { icon: 'error' });
        return;
      }
      insertN = num + 1;
    } else insertN = 1;
  }

  let noteParagraphs = [{ type: 'p', attrs: {}, content: [] }];
  if (o.addNote && o.inputText) {
    const entered = await askNoteText(ctx);
    if (!entered) return;
    noteParagraphs = entered;
  }

  // --- changes start here -----------------------------------------------------------------
  let bodyRef = notesBody ? { nodeId: notesBody.attrs.nodeId, type: 'body' } : null;
  let liveSections = sections.slice();

  // Renumber the existing sections (ids and titles), leaving room for the new one.
  if (notesBody && !o.lastMode) {
    for (let j = 0; j < liveSections.length; j += 1) {
      const section = liveSections[j];
      const n = j + 1 >= insertN ? j + 1 + insertCnt : j + 1;
      const wantedId = fill(o.idTemplate, n);
      const wantedTitle = fill(o.titleTemplate, n);
      const first = section.content[0];
      const hasTitle = first && first.type === 'title';
      const titleText = hasTitle
        ? (first.content ?? []).map((p) => (p.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('')).join('\n')
        : null;
      if (section.attrs?.id === wantedId && hasTitle && titleText === wantedTitle) continue;
      const content = hasTitle ? [title(wantedTitle), ...section.content.slice(1)] : [title(wantedTitle), ...section.content];
      await mfbe.doc.replaceNode(section.attrs.nodeId, { ...section, attrs: { ...section.attrs, id: wantedId }, content });
    }
  }

  // Rewrite the links: new hrefs and texts, plus the new link at the selection, block by block.
  const byBlock = new Map();
  if (!o.lastMode) {
    for (const link of links) {
      if (!link.id) continue;
      let num = sectNumById.get(link.id);
      if (num === undefined) continue;
      if (num >= insertN) num += 1;
      const href = `#${fill(o.idTemplate, num)}`;
      const text = fill(o.linkTemplate, num);
      const type = link.type;
      if (!byBlock.has(link.blockId)) byBlock.set(link.blockId, []);
      byBlock.get(link.blockId).push({ link, href, text, type });
    }
  }
  if (target && !byBlock.has(target.blockId)) byBlock.set(target.blockId, []);

  let newLinkHref = null;
  for (const [blockId, changes] of byBlock) {
    const entry = blockById.get(blockId);
    const inDescription = !!entry?.inDescription;
    const block = inDescription ? entry.node : await mfbe.doc.getNode(blockId);
    let content = block.content ?? [];
    let changed = false;
    // Existing links first, from the end so earlier offsets stay valid.
    for (const { link, href, text, type } of [...changes].sort((a, b) => b.link.start - a.link.start)) {
      const current = content.slice(link.first, link.last + 1).map((c) => (c.type === 'text' ? c.text : '\uFFFC')).join('');
      if (link.href === href && current === text && link.type === type) continue;
      const base = content[link.first].marks ?? [];
      const node = linkTextNode(text, base, href, type, o.linkSup);
      content = [...content.slice(0, link.first), node, ...content.slice(link.last + 1)];
      // The index map of later links in this block is unaffected (we go from the end).
      changed = true;
    }
    if (target && blockId === target.blockId) {
      // Offsets of the selection refer to the original text: recompute them if links before
      // the caret changed length.
      let shift = 0;
      for (const { link, text } of changes) {
        if (link.end <= target.from) shift += text.length - (link.end - link.start);
      }
      newLinkHref = `#${fill(o.idTemplate, insertN)}`;
      const node = linkTextNode(fill(o.linkTemplate, insertN), marksAt(content, target.from + shift), newLinkHref, o.noteType, o.linkSup);
      content = spliceContent(content, target.from + shift, target.to + shift, node);
      changed = true;
    }
    if (!changed) continue;
    if (inDescription) {
      entry.node.content = content;
      descriptionChanged = true;
    } else await mfbe.doc.replaceNode(blockId, { ...block, content });
  }
  if (descriptionChanged) await mfbe.doc.setDescription(description);

  // The notes body and its title.
  let newSectionRef = null;
  if (o.addNote) {
    const newSection = {
      type: 'section', attrs: { id: fill(o.idTemplate, insertN) },
      content: [title(fill(o.titleTemplate, insertN)), ...noteParagraphs],
    };
    if (!bodyRef) {
      const last = doc.bodies[doc.bodies.length - 1];
      bodyRef = await mfbe.doc.insertNode('after', last.attrs.nodeId, {
        type: 'body', attrs: { name: o.bodyName }, content: [title(o.bodyTitle), newSection],
      });
      const children = await mfbe.doc.childrenOf(bodyRef);
      newSectionRef = children.find((c) => c.type === 'section');
    } else {
      if (!o.lastMode && liveSections.length > 0) {
        if (insertN > 1) newSectionRef = await mfbe.doc.insertNode('after', liveSections[insertN - 2].attrs.nodeId, newSection);
        else newSectionRef = await mfbe.doc.insertNode('before', liveSections[0].attrs.nodeId, newSection);
      } else newSectionRef = await mfbe.doc.insertNode('append', bodyRef, newSection);
    }
  }
  if (notesBody) {
    const firstStructural = notesBody.content.find((c) => c.type === 'title' || c.type === 'epigraph' || c.type === 'section');
    if (!firstStructural) await mfbe.doc.insertNode('append', bodyRef, title(o.bodyTitle));
    else if (firstStructural.type !== 'title') await mfbe.doc.insertNode('before', firstStructural.attrs.nodeId, title(o.bodyTitle));
  }

  if (o.addNote && o.moveFocus && newSectionRef) {
    const children = await mfbe.doc.childrenOf(newSectionRef);
    const paragraph = children.find((c) => c.type === 'p') ?? children[0];
    if (paragraph) await mfbe.selection.selectNode(paragraph);
  }

  const time = elapsed(started);
  // 2.7.9 writes the result to the status bar, whatever EndWindow says; it stays there after the run.
  const result = o.addNote ? TEXTS.added(insertN, time) : TEXTS.renumbered(time);
  await mfbe.ui.status(t(ctx, result[0], result[1]), { sticky: true });
}
