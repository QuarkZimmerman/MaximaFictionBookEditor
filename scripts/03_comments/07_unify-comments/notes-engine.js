// Shared engine of the "Добавление примечания" / "Добавление комментария" scripts (every script
// folder carries its own copy: the sandbox only allows imports from the script's own folder).
//
// The legacy scripts were one JScript program with a block of settings at the top; the settings
// are passed here as `options`. What it does, in the order of the original:
//   1. finds the notes (or comments) body, refuses nested note sections;
//   2. in "add" mode works out the number of the new note from the nearest preceding note link,
//      optionally asks for the note text and refuses a non-last note in "last note" mode;
//   3. renumbers the existing note sections (ids `n_N`, titles `N`) and every link that points to
//      them (href and text `[N]`), leaving room for the new note;
//   4. replaces the selection with the new note link and inserts the new note section at the
//      right place (empty paragraph or the entered text), optionally moving the caret there;
//   5. reports what was done.
// The whole run is one undo step, so the original's manual clean-up on errors is not needed:
// every check happens before the first change.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
// добавление сноски между уже имеющимися
// написал Sclex
// версия 2.6

const TEXT_BLOCKS = new Set(['p', 'subtitle', 'v', 'text-author', 'td', 'th']);

export function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

function fill(template, n) {
  return template.replace('%N', String(n));
}

/** `#id` (also `main.html#id` of the IE days) -> `id`; null for external links. */
export function localHref(href) {
  if (typeof href !== 'string') return null;
  const hash = href.indexOf('#');
  if (hash < 0) return null;
  return href.slice(hash + 1);
}

function sameLink(a, b) {
  return !!a && !!b && a.attrs.href === b.attrs.href && (a.attrs.type ?? null) === (b.attrs.type ?? null);
}

function linkMarkOf(textNode) {
  return (textNode.marks ?? []).find((m) => m.type === 'link') ?? null;
}

/**
 * Every link of the document in document order (the legacy `document.links`): consecutive text
 * nodes carrying the same link mark form one link.
 * -> [{ blockId, href, id, type, start, end, first, last }] (offsets/indexes inside the block).
 */
export function collectLinks(doc) {
  const links = [];
  const visit = (node) => {
    if (node.type === 'text') return;
    if (TEXT_BLOCKS.has(node.type)) {
      let pos = 0;
      let current = null;
      (node.content ?? []).forEach((child, index) => {
        const mark = child.type === 'text' ? linkMarkOf(child) : null;
        const len = child.type === 'text' ? child.text.length : 1;
        if (mark && current && sameLink(current.mark, mark) && current.last === index - 1) {
          current.end = pos + len;
          current.last = index;
        } else if (mark) {
          current = {
            blockId: node.attrs.nodeId, mark, href: mark.attrs.href, id: localHref(mark.attrs.href),
            type: mark.attrs.type ?? null, start: pos, end: pos + len, first: index, last: index,
          };
          links.push(current);
        } else {
          current = null;
        }
        pos += len;
      });
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  for (const body of doc.bodies) visit(body);
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

/* ------------------------------------------------------------------------ */
/* Note text entered in a prompt (the "введя ее текст в окошке" variants)   */
/* ------------------------------------------------------------------------ */

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
  const prompt = t(ctx,
    'Текст примечания. Используйте <b>...</b> <i>...</i> <br> <strong>...</strong> <emphasis>...</emphasis> <em>...</em>',
    'Note text. You may use <b>...</b> <i>...</i> <br> <strong>...</strong> <emphasis>...</emphasis> <em>...</em>');
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

/* ------------------------------------------------------------------------ */
/* The engine                                                               */
/* ------------------------------------------------------------------------ */

function title(text) {
  return { type: 'title', attrs: {}, content: [{ type: 'p', attrs: {}, content: [{ type: 'text', text }] }] };
}

function elapsed(since) {
  const ms = Date.now() - since;
  const min = Math.floor(ms / 60000);
  const sec = Math.ceil(10 * (ms / 1000 - min * 60)) / 10;
  return min > 0 ? `${min} мин. ${sec} с` : `${sec} с`;
}

/**
 * @param options {
 *   idTemplate, titleTemplate, linkTemplate, linkSup, bodyName, bodyTitle, noteType,
 *   isNoteLink(link) -> boolean,
 *   addNote, inputText, moveFocus, lastMode, endWindow, removeUnused, noun: {ru, en} }
 */
export async function runNotesScript(ctx, options) {
  const started = Date.now();
  const o = options;

  if (o.removeUnused) {
    const answer = await mfbe.ui.message(
      t(ctx,
        `Вы запустили скрипт «Унификация ${o.noun.ruGenPl} (с удалением неиспользуемых секций ${o.noun.ruBody})».\nВы действительно хотите, чтобы неиспользуемые секции ${o.noun.ruBody} были удалены?`,
        `You started "Unify ${o.noun.en} (removing unused ${o.noun.en} sections)".\nDo you really want the unused ${o.noun.en} sections to be removed?`),
      { buttons: [{ id: 'ok', label: '', default: true }, { id: 'cancel', label: '', cancel: true }], icon: 'question' },
    );
    if (answer !== 'ok') return;
  }

  const doc = await mfbe.doc.get();
  const notesBody = doc.bodies.find((b) => b.attrs?.name === o.bodyName) ?? null;
  const sections = notesBody ? notesBody.content.filter((c) => c.type === 'section') : [];

  // Nested note sections are not handled (as in the original).
  if (sections.some((s) => s.content.some((c) => c.type === 'section'))) {
    await mfbe.ui.message(
      t(ctx,
        `В body ${o.noun.ruBody} есть секции второго уровня вложения. Такие файлы не обрабатываются данным скриптом. Работа скрипта завершена.`,
        `The ${o.noun.en} body contains nested sections. Such files are not handled by this script.`),
      { icon: 'warning' },
    );
    return;
  }

  const links = collectLinks(doc);
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
    let index = 0;
    const order = [];
    const visitOrder = (node) => {
      if (node.type === 'text') return;
      if (TEXT_BLOCKS.has(node.type)) {
        order.push(node.attrs.nodeId);
        return;
      }
      for (const child of node.content ?? []) visitOrder(child);
    };
    doc.bodies.forEach(visitOrder);
    const blockOrder = new Map(order.map((id, i) => [id, i]));
    const here = blockOrder.get(blockId) ?? -1;
    for (const link of links) {
      const where = blockOrder.get(link.blockId) ?? -1;
      if (where < here || (where === here && link.start < from)) index += 1;
      else break;
    }
    target = { blockId, from, to, index };
    insertCnt = 1;

    if (o.lastMode && links.slice(index).some((l) => o.isNoteLink(l))) {
      await mfbe.ui.message(
        t(ctx, `Ошибка. Это получается не последн${o.noun.ruLast} в документе!`, `Error: this would not be the last ${o.noun.en} of the document!`),
        { icon: 'error' },
      );
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
        await mfbe.ui.message(
          t(ctx,
            `Не удается по ссылке перед вставляемой определить номер вставляемого ${o.noun.ruGen}.`,
            `The number of the new ${o.noun.en} cannot be derived from the ${o.noun.en} link before the caret.`),
          { icon: 'error' },
        );
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

  // Variant 08: drop note sections no link points to.
  if (o.removeUnused && notesBody) {
    const referenced = new Set(links.map((l) => l.id).filter(Boolean));
    const unused = liveSections.filter((s) => s.attrs?.id && !referenced.has(s.attrs.id));
    for (const s of unused) await mfbe.doc.removeNode(s.attrs.nodeId);
    liveSections = liveSections.filter((s) => !unused.includes(s));
    sectNumById.clear();
    liveSections.forEach((s, i) => {
      if (s.attrs?.id) sectNumById.set(s.attrs.id, i + 1);
    });
  }

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
      if (!byBlock.has(link.blockId)) byBlock.set(link.blockId, []);
      byBlock.get(link.blockId).push({ link, href, text });
    }
  }
  if (target && !byBlock.has(target.blockId)) byBlock.set(target.blockId, []);

  let newLinkHref = null;
  for (const [blockId, changes] of byBlock) {
    const block = await mfbe.doc.getNode(blockId);
    let content = block.content ?? [];
    let changed = false;
    // Existing links first, from the end so earlier offsets stay valid.
    for (const { link, href, text } of [...changes].sort((a, b) => b.link.start - a.link.start)) {
      const current = content.slice(link.first, link.last + 1).map((c) => (c.type === 'text' ? c.text : '\uFFFC')).join('');
      if (link.href === href && current === text) continue;
      const base = content[link.first].marks ?? [];
      const node = linkTextNode(text, base, href, link.type, o.linkSup);
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
    if (changed) await mfbe.doc.replaceNode(blockId, { ...block, content });
  }

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

  if (o.endWindow && o.addNote) {
    await mfbe.ui.message(
      t(ctx,
        `\n\nДобавлен${o.noun.ruAdded}   \n\n         № ${insertN}   \n\nВремя работы скрипта: ${elapsed(started)}`,
        `\n\nAdded ${o.noun.en}   \n\n         No. ${insertN}   \n\nTime taken: ${elapsed(started)}`),
    );
  }
  if (o.endWindow && !o.addNote) {
    await mfbe.ui.message(
      t(ctx,
        `Обработка ${o.noun.ruGenPl} закончена.\nДобавления ${o.noun.ruNewGen} не было, так как это отключено в настройках скрипта.\nВремя работы скрипта: ${elapsed(started)}`,
        `Processing of the ${o.noun.en}s is finished.\nNo new ${o.noun.en} was added (disabled in this script's settings).\nTime taken: ${elapsed(started)}`),
    );
  }
}

/** Settings shared by the footnote ("сноска") scripts. */
export const FOOTNOTES = {
  idTemplate: 'n_%N',
  titleTemplate: '%N',
  linkTemplate: '[%N]',
  linkSup: false,
  bodyName: 'notes',
  bodyTitle: 'Примечания',
  noteType: 'note',
  isNoteLink: (link) => link.type === 'note',
  noun: { en: 'footnote', ruBody: 'примечаний', ruGen: 'примечания', ruGenPl: 'сносок', ruLast: 'яя сноска', ruAdded: 'а сноска', ruNewGen: 'новой сноски' },
};

/** Settings shared by the comment ("комментарий") scripts. */
export const COMMENTS = {
  idTemplate: 'c_%N',
  titleTemplate: '%N',
  linkTemplate: '{%N}',
  linkSup: true,
  bodyName: 'comments',
  bodyTitle: 'Комментарии',
  noteType: null,
  isNoteLink: (link) => typeof link.id === 'string' && /^c_/.test(link.id),
  noun: { en: 'comment', ruBody: 'комментариев', ruGen: 'комментария', ruGenPl: 'комментариев', ruLast: 'ий комментарий', ruAdded: ' комментарий', ruNewGen: 'нового комментария' },
};
