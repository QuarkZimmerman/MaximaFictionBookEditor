// Shared engine of the "Примечания и комментарии из скобок" scripts (every script folder carries
// its own copy: the sandbox only allows imports from the script's own folder).
//
// The twelve originals were one JScript program with a settings block: the bracket pair (fixed,
// or asked as two regular expressions / as plain text) and whether footnotes (body "notes",
// ids n_N, links [N] of type note) or comments (body "comments", ids c_N, superscript links {N})
// are produced. For every paragraph of the book, in order, the text between an opening and a
// closing bracket becomes a new note section and is replaced by a link; a note may continue
// over the following sibling blocks of the same parent (they are moved into the note). New
// sections are inserted before the section of the next note link, so the order is kept; at the
// end all note sections are renumbered (ids, titles) together with every link pointing to them.
// Errors of the original (a second opening bracket, a closing bracket outside the parent, a
// link to a missing section) stop the run with the same messages after renumbering what was
// done, and the caret is put before the faulty bracket.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
// извлечение сносок из разных скобок
// написал Sclex

const TEXT_BLOCKS = new Set(['p', 'subtitle', 'v', 'text-author']);
const INLINE_BLOCKS = new Set(['p', 'subtitle', 'v', 'text-author', 'td', 'th']);

export function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

function versionStr(ctx) {
  return t(ctx, 'Примечания из скобок v2.2 by Sclex.\n\n', 'Footnotes from brackets v2.2 by Sclex.\n\n');
}

function fill(template, n) {
  return template.replace('%N', String(n));
}

export function localHref(href) {
  if (typeof href !== 'string') return null;
  const hash = href.indexOf('#');
  return hash < 0 ? null : href.slice(hash + 1);
}

function plain(content) {
  return (content ?? []).map((c) => (c.type === 'text' ? c.text : '\uFFFC')).join('');
}

function linkOf(node) {
  return node.type === 'text' ? ((node.marks ?? []).find((m) => m.type === 'link') ?? null) : null;
}

/** True when character `offset` of `content` is part of a link. */
function inLinkAt(content, offset) {
  let pos = 0;
  for (const child of content) {
    const len = child.type === 'text' ? child.text.length : 1;
    if (offset >= pos && offset < pos + len) return !!linkOf(child);
    pos += len;
  }
  return false;
}

/** Inline nodes covering the characters [from, to) of `content` (text nodes are split). */
function sliceContent(content, from, to) {
  const out = [];
  let pos = 0;
  for (const child of content) {
    const len = child.type === 'text' ? child.text.length : 1;
    const a = Math.max(from, pos);
    const z = Math.min(to, pos + len);
    if (a < z) {
      if (child.type === 'text') out.push({ ...child, text: child.text.slice(a - pos, z - pos) });
      else out.push(stripIds(child));
    }
    pos += len;
  }
  return out;
}

/** Deep copy without nodeIds (a node moved elsewhere must get fresh ids). */
export function stripIds(node) {
  if (!node || typeof node !== 'object') return node;
  const copy = { ...node };
  if (copy.attrs) {
    const attrs = { ...copy.attrs };
    delete attrs.nodeId;
    copy.attrs = attrs;
  }
  if (Array.isArray(copy.content)) copy.content = copy.content.map(stripIds);
  return copy;
}

/** Links of one block: [{ href, id, type, start, end, first, last }]. */
function linksIn(content) {
  const links = [];
  let pos = 0;
  let current = null;
  (content ?? []).forEach((child, index) => {
    const mark = linkOf(child);
    const len = child.type === 'text' ? child.text.length : 1;
    if (mark && current && current.last === index - 1 && current.href === mark.attrs.href && (current.type ?? null) === (mark.attrs.type ?? null)) {
      current.end = pos + len;
      current.last = index;
    } else if (mark) {
      current = { href: mark.attrs.href, id: localHref(mark.attrs.href), type: mark.attrs.type ?? null, start: pos, end: pos + len, first: index, last: index };
      links.push(current);
    } else current = null;
    pos += len;
  });
  return links;
}

function noteLinkNode(text, href, o) {
  const marks = [{ type: 'link', attrs: o.noteType ? { href, type: o.noteType } : { href } }];
  if (o.linkSup) marks.push({ type: 'sup' });
  return { type: 'text', text, marks };
}

function titleNode(text) {
  return { type: 'title', attrs: {}, content: [{ type: 'p', attrs: {}, content: [{ type: 'text', text }] }] };
}

/* ------------------------------------------------------------------------ */
/* Bracket pair from the prompts (605/606/611/612)                          */
/* ------------------------------------------------------------------------ */

export async function askBrackets(ctx, mode) {
  if (mode === 'regex') {
    const s1 = await mfbe.ui.prompt(
      t(ctx, 'Шаг 1 из 2. Введите регэксп "открывающей скобки":', 'Step 1 of 2. Enter the regular expression of the "opening bracket":'),
      { defaultValue: '\\[' },
    );
    if (!s1) return null;
    let open;
    try {
      open = new RegExp(s1, 'i');
    } catch {
      await mfbe.ui.message(versionStr(ctx) + t(ctx, 'Вы ввели некорректный регэксп.', 'The regular expression is not valid.'), { icon: 'error' });
      return null;
    }
    const s2 = await mfbe.ui.prompt(
      t(ctx, 'Шаг 2 из 2. Введите регэксп "закрывающей скобки":', 'Step 2 of 2. Enter the regular expression of the "closing bracket":'),
      { defaultValue: '\\]' },
    );
    if (!s2) return null;
    try {
      return { open, close: new RegExp(s2, 'i') };
    } catch {
      await mfbe.ui.message(versionStr(ctx) + t(ctx, 'Вы ввели некорректный регэксп.', 'The regular expression is not valid.'), { icon: 'error' });
      return null;
    }
  }
  const s = await mfbe.ui.prompt(
    t(ctx, 'Введите строку, содержащую скобки простым текстом, разделенные пробелом', 'Enter the two brackets as plain text, separated by a space'),
    { defaultValue: '[ ]' },
  );
  if (!s) return null;
  const groups = s.match(/ +/g);
  if (!groups) {
    await mfbe.ui.message(versionStr(ctx) + t(ctx, 'Ошибка. Во введенной вами строке отсутствует пробел.', 'Error: the entered text contains no space.'), { icon: 'error' });
    return null;
  }
  if (groups.length > 1) {
    await mfbe.ui.message(versionStr(ctx) + t(ctx, 'Ошибка. Во введенной вами строке более чем одна группа пробелов.', 'Error: the entered text contains more than one group of spaces.'), { icon: 'error' });
    return null;
  }
  const at = s.search(/ +/);
  const escape = (text) => text.replace(/([^0-9a-z])/gi, '\\$1');
  return { open: new RegExp(escape(s.slice(0, at))), close: new RegExp(escape(s.slice(at + groups[0].length))) };
}

/* ------------------------------------------------------------------------ */
/* The engine                                                               */
/* ------------------------------------------------------------------------ */

function elapsed(since) {
  const ms = Date.now() - since;
  const min = Math.floor(ms / 60000);
  const sec = ms / 1000 - min * 60;
  if (min >= 1) return `${min} мин ${Math.ceil(sec)} с`;
  if (sec < 1) return `${Math.ceil(sec * 1000) / 1000} с`;
  if (sec < 10) return `${Math.ceil(sec * 100) / 100} с`;
  return `${Math.ceil(sec)} с`;
}

/**
 * @param options { open: RegExp, close: RegExp, idTemplate, titleTemplate, linkTemplate, linkSup,
 *                  bodyName, bodyTitle, noteType, isNoteLink(link) }
 */
export async function runBracketsScript(ctx, options) {
  const o = options;
  const started = Date.now();
  const doc = await mfbe.doc.get();

  // Document order of the text blocks (the walk of the original) and the note links they hold.
  const blocks = [];
  const walk = (node) => {
    if (node.type === 'text') return;
    if (INLINE_BLOCKS.has(node.type)) {
      blocks.push({ id: node.attrs.nodeId, type: node.type, node });
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };
  for (const body of doc.bodies) walk(body);
  const allIds = new Set();
  const collectIds = (node) => {
    if (node.type === 'text') return;
    if (node.attrs?.id) allIds.add(node.attrs.id);
    for (const child of node.content ?? []) collectIds(child);
  };
  for (const body of doc.bodies) collectIds(body);
  const cache = new Map(blocks.map((b) => [b.id, b.node]));
  const removed = new Set();
  const getBlock = async (id) => {
    if (removed.has(id)) return null;
    if (!cache.has(id)) {
      try {
        cache.set(id, await mfbe.doc.getNode(id));
      } catch {
        removed.add(id);
        return null;
      }
    }
    return cache.get(id);
  };
  const setBlock = async (id, node) => {
    await mfbe.doc.replaceNode(id, node);
    cache.set(id, node);
  };

  // The notes body and its sections (kept up to date while sections are inserted).
  let notesBody = doc.bodies.find((b) => b.attrs?.name === o.bodyName) ?? null;
  let bodyId = notesBody ? notesBody.attrs.nodeId : null;
  let sections = notesBody ? notesBody.content.filter((c) => c.type === 'section').map((s) => ({ nodeId: s.attrs.nodeId, id: s.attrs.id ?? '' })) : [];
  if (notesBody && notesBody.content.some((s) => s.type === 'section' && s.content.some((c) => c.type === 'section'))) {
    await mfbe.ui.message(
      t(ctx, 'В body примечаний есть секции второго уровня вложения. Такие файлы не обрабатываются данным скриптом. Работа скрипта завершена.',
        'The notes body contains nested sections. Such files are not handled by this script.'),
      { icon: 'warning' },
    );
    return;
  }
  let initDone = false;
  /** Creates the notes body (with the first new section) or its title; true when the section went in. */
  const ensureNotesBody = async (firstSection) => {
    if (initDone) return false;
    initDone = true;
    if (!notesBody) {
      const last = doc.bodies[doc.bodies.length - 1];
      const ref = await mfbe.doc.insertNode('after', last.attrs.nodeId, {
        type: 'body', attrs: { name: o.bodyName }, content: [titleNode(o.bodyTitle), firstSection],
      });
      bodyId = ref.nodeId;
      const children = await mfbe.doc.childrenOf(ref);
      const section = children.find((c) => c.type === 'section');
      sections = [{ nodeId: section.nodeId, id: firstSection.attrs.id }];
      return true;
    }
    const first = notesBody.content.find((c) => c.type === 'title' || c.type === 'epigraph' || c.type === 'section');
    if (!first) await mfbe.doc.insertNode('append', bodyId, titleNode(o.bodyTitle));
    else if (first.type !== 'title') await mfbe.doc.insertNode('before', first.attrs.nodeId, titleNode(o.bodyTitle));
    return false;
  };

  const tempPrefix = `tmp_${Math.floor(Math.random() * 1e9)}_`;
  let added = 0;

  /** Renumbers the note sections and every link pointing to them (the original `finalization`). */
  const finalization = async () => {
    if (!initDone) return;
    const fresh = await mfbe.doc.get();
    const body = fresh.bodies.find((b) => b.attrs?.nodeId === bodyId);
    if (!body) return;
    const sects = body.content.filter((c) => c.type === 'section');
    const numById = new Map();
    for (let i = 0; i < sects.length; i += 1) {
      const s = sects[i];
      const n = i + 1;
      if (s.attrs?.id) numById.set(s.attrs.id, n);
      const wantedId = fill(o.idTemplate, n);
      const wantedTitle = fill(o.titleTemplate, n);
      const first = s.content[0];
      const hasTitle = first && first.type === 'title';
      const titleText = hasTitle ? plain((first.content ?? []).flatMap((p) => p.content ?? [])) : null;
      if (s.attrs?.id === wantedId && hasTitle && titleText === wantedTitle) continue;
      const content = hasTitle ? [titleNode(wantedTitle), ...s.content.slice(1)] : [titleNode(wantedTitle), ...s.content];
      await mfbe.doc.replaceNode(s.attrs.nodeId, { ...s, attrs: { ...s.attrs, id: wantedId }, content });
    }
    // Every link of the document that points to a note section.
    const visit = async (node) => {
      if (node.type === 'text') return;
      if (INLINE_BLOCKS.has(node.type)) {
        let content = node.content ?? [];
        let changed = false;
        for (const link of linksIn(content).reverse()) {
          const n = link.id ? numById.get(link.id) : undefined;
          if (n === undefined) continue;
          const href = `#${fill(o.idTemplate, n)}`;
          const isNote = o.isNoteLink({ ...link, href, id: localHref(href) });
          const text = isNote ? fill(o.linkTemplate, n) : null;
          const current = plain(content.slice(link.first, link.last + 1));
          if (link.href === href && (!isNote || current === text)) continue;
          if (isNote) {
            const base = (content[link.first].marks ?? []).filter((m) => m.type !== 'link' && m.type !== 'sup' && m.type !== 'sub');
            const marks = [...base, { type: 'link', attrs: link.type ? { href, type: link.type } : { href } }];
            if (o.linkSup) marks.push({ type: 'sup' });
            content = [...content.slice(0, link.first), { type: 'text', text, marks }, ...content.slice(link.last + 1)];
          } else {
            content = content.map((c, i) => {
              if (i < link.first || i > link.last) return c;
              return { ...c, marks: (c.marks ?? []).map((m) => (m.type === 'link' ? { ...m, attrs: { ...m.attrs, href } } : m)) };
            });
          }
          changed = true;
        }
        if (changed) await mfbe.doc.replaceNode(node.attrs.nodeId, { ...node, content });
        return;
      }
      for (const child of node.content ?? []) await visit(child);
    };
    for (const body2 of fresh.bodies) await visit(body2);
  };

  const fail = async (message, blockId, offset) => {
    await finalization();
    try {
      await mfbe.selection.set({ nodeId: blockId, offset });
    } catch {
      // the block may be gone; the message still explains the problem
    }
    await mfbe.ui.message(`${versionStr(ctx)}${message}\n\n${exitText()}`, { icon: 'error' });
  };
  const exitText = () =>
    t(ctx, `Добавлено примечаний: ${added}.\nЗатрачено времени: ${elapsed(started)}`,
      `Notes added: ${added}.\nTime taken: ${elapsed(started)}`);

  /** The first note link after `blockIndex`/`offset` (the original's `j6` search). */
  const nextNoteLink = async (blockIndex, content, offset) => {
    for (const link of linksIn(content)) if (link.start >= offset && o.isNoteLink(link)) return link;
    for (let i = blockIndex + 1; i < blocks.length; i += 1) {
      const node = await getBlock(blocks[i].id);
      if (!node) continue;
      for (const link of linksIn(node.content ?? [])) if (o.isNoteLink(link)) return link;
    }
    return null;
  };

  const ANOTHER_OPENING = t(ctx,
    'После открывающей скобки встречена другая открывающая, видимо пропущена закрывающая. Курсор установлен перед примечанием с ошибкой.',
    'Another opening bracket follows the opening one; the closing bracket is probably missing. The caret is placed before the faulty note.');

  for (let bi = 0; bi < blocks.length; bi += 1) {
    const block = blocks[bi];
    if (!TEXT_BLOCKS.has(block.type)) continue;
    if (bi % 25 === 0) await mfbe.ui.progress(bi, blocks.length);
    if (ctx.cancelled) return;
    for (;;) {
      const node = await getBlock(block.id);
      if (!node) break;
      const content = node.content ?? [];
      const text = plain(content);
      // The opening bracket must start outside a link (the original skipped text inside <A>).
      let openAt = -1;
      let openLen = 0;
      for (let from = 0; from <= text.length; ) {
        const m = o.open.exec(text.slice(from));
        if (!m) break;
        if (m[0].length === 0) break;
        const at = from + m.index;
        if (!inLinkAt(content, at)) {
          openAt = at;
          openLen = m[0].length;
          break;
        }
        from = at + m[0].length;
      }
      if (openAt < 0) break;

      const noteParagraphs = [];
      const moved = []; // ids of the blocks swallowed by the note
      const rest = text.slice(openAt + openLen);
      const closeHere = o.close.exec(rest);
      const openHere = o.open.exec(rest);
      if (openHere && openHere[0].length > 0 && (!closeHere || openHere.index < closeHere.index)) {
        await fail(ANOTHER_OPENING, block.id, openAt);
        return;
      }
      let newContent;
      if (closeHere) {
        const closeAt = openAt + openLen + closeHere.index;
        noteParagraphs.push({ type: 'p', attrs: {}, content: sliceContent(content, openAt + openLen, closeAt) });
        newContent = { before: sliceContent(content, 0, openAt), after: sliceContent(content, closeAt + closeHere[0].length, text.length) };
      } else {
        // The note continues in the following siblings of the same parent.
        noteParagraphs.push({ type: 'p', attrs: {}, content: sliceContent(content, openAt + openLen, text.length) });
        const parent = await mfbe.doc.parentOf(block.id);
        const siblings = parent ? await mfbe.doc.childrenOf(parent) : [];
        const start = siblings.findIndex((s) => s.nodeId === block.id);
        let closed = null;
        for (let si = start + 1; si < siblings.length && !closed; si += 1) {
          const sib = siblings[si];
          const sibNode = await mfbe.doc.getNode(sib.nodeId);
          if (TEXT_BLOCKS.has(sib.type)) {
            const sibContent = sibNode.content ?? [];
            const sibText = plain(sibContent);
            const c = o.close.exec(sibText);
            const a = o.open.exec(sibText);
            if (a && a[0].length > 0 && (!c || a.index < c.index)) {
              await fail(ANOTHER_OPENING, block.id, openAt);
              return;
            }
            if (c) {
              noteParagraphs.push({ type: 'p', attrs: {}, content: sliceContent(sibContent, 0, c.index) });
              closed = { id: sib.nodeId, after: sliceContent(sibContent, c.index + c[0].length, sibText.length) };
            } else {
              noteParagraphs.push({ type: 'p', attrs: {}, content: sliceContent(sibContent, 0, sibText.length) });
              moved.push(sib.nodeId);
            }
          } else if (sib.type === 'section') {
            break;
          } else {
            noteParagraphs.push(stripIds(sibNode)); // poems, cites, images, empty lines travel with the note
            moved.push(sib.nodeId);
          }
        }
        if (!closed) {
          await fail(
            t(ctx, 'Примечание кончается не внутри того тэга, в котором начинается. Курсор установлен перед примечанием с ошибкой.',
              'The note does not end inside the element where it starts. The caret is placed before the faulty note.'),
            block.id, openAt,
          );
          return;
        }
        moved.push(closed.id);
        newContent = { before: sliceContent(content, 0, openAt), after: closed.after };
      }

      // Where does the new section go? Before the section of the next note link.
      added += 1;
      const tempId = `${tempPrefix}${added}`;
      const link = noteLinkNode(fill(o.linkTemplate, '*'), `#${tempId}`, o);
      const rebuilt = [...newContent.before, link, ...newContent.after];
      const next = await nextNoteLink(bi, rebuilt, plain(newContent.before).length + link.text.length);
      let insertBefore = null;
      if (next) {
        const target = sections.find((s) => s.id === next.id);
        if (!target) {
          added -= 1;
          await fail(
            next.id && allIds.has(next.id)
              ? t(ctx, 'Ссылка сноски ссылается не внутрь секции в теле примечаний.\nПозиция обзора установлена на неисправную ссылку.',
                  'A note link does not point to a section of the notes body.\nThe view is positioned on the faulty link.')
              : t(ctx, 'Ссылка сноски ссылается на несуществующую секцию.\nПозиция обзора установлена на неисправную ссылку.',
                  'A note link points to a section that does not exist.\nThe view is positioned on the faulty link.'),
            block.id, openAt,
          );
          return;
        }
        insertBefore = target.nodeId;
      }

      // Apply: the paragraph, the swallowed blocks, the new section.
      await setBlock(block.id, { ...node, content: rebuilt });
      for (const id of moved) {
        await mfbe.doc.removeNode(id);
        removed.add(id);
        cache.delete(id);
      }
      const newSection = { type: 'section', attrs: { id: tempId }, content: [titleNode('***'), ...noteParagraphs] };
      let inserted = false;
      if (!initDone) inserted = await ensureNotesBody(newSection);
      if (!inserted) {
        const ref = insertBefore
          ? await mfbe.doc.insertNode('before', insertBefore, newSection)
          : await mfbe.doc.insertNode('append', bodyId, newSection);
        const at = insertBefore ? sections.findIndex((s) => s.nodeId === insertBefore) : sections.length;
        sections.splice(at, 0, { nodeId: ref.nodeId, id: tempId });
      }
    }
  }

  await finalization();
  await mfbe.ui.message(versionStr(ctx) + exitText());
}

export const FOOTNOTES = {
  idTemplate: 'n_%N',
  titleTemplate: '%N',
  linkTemplate: '[%N]',
  linkSup: false,
  bodyName: 'notes',
  bodyTitle: 'Примечания',
  noteType: 'note',
  isNoteLink: (link) => link.type === 'note',
};

export const COMMENTS = {
  idTemplate: 'c_%N',
  titleTemplate: '%N',
  linkTemplate: '{%N}',
  linkSup: true,
  bodyName: 'comments',
  bodyTitle: 'Комментарии',
  noteType: null,
  isNoteLink: (link) => typeof link.id === 'string' && /^c_/.test(link.id),
};
