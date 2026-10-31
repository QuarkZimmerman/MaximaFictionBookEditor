// Converted from FictionBook Editor 2.7.9: Scripts/05_Иллюстрации/06_Добавить либо удалить пустые строки возле иллюстраций....js
// (Sclex, version 1.7; 2.7beta1's 06_Пустые строки возле иллюстраций....js, 1.5, before feature
// 007). Two modes chosen in a dialog: OK adds exactly one empty line before and after every block
// picture (none next to a title, epigraph, annotation, cite or section boundary), Cancel removes
// the empty lines around the pictures. The special cases of the original are kept: a section
// holding nothing but its picture gets one empty line after it; when the text of a section starts
// with a picture (or with empty lines and a picture) the picture keeps one empty line before it.
// 2.7.9 speaks of illustrations where 2.7beta1 said pictures, and names the undo step by the mode.
//
// The original edited the IE DOM sibling by sibling (previousSibling/nextSibling); the port runs
// the same logic over a doubly linked copy of each section's children and writes the section
// back with one replaceNode. In the model an empty line is an <empty-line/> node or a paragraph
// made of spaces / non-breaking spaces (what the original's regular expression matched). A
// paragraph holding an inline picture is no empty line here: the original read the paragraph's
// text (innerText), which a picture has none of, so it removed such a paragraph next to a block
// picture (docs/scripting/conversion-notes-279-a.md, group 05). The undo step carries the
// package's label; the original's, which names the mode, is its step name.
// The original's notice, kept as written (FR-029):
//Скрипт "Добавить либо удалить пустые строки возле иллюстраций"
//Автор Sclex
//http://www.fictionbook.org/forum/viewtopic.php?t=4412

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

const BOUNDARY = new Set(['title', 'epigraph', 'annotation', 'section', 'cite']);
const EMPTY_TEXT = /^[ \u00A0]*$/;

function isP(item) {
  return item && (item.node.type === 'p' || item.node.type === 'subtitle' || item.node.type === 'empty-line');
}

function isLineEmpty(item) {
  if (!item) return false;
  const { node } = item;
  if (node.type === 'empty-line') return true;
  if (node.type !== 'p' && node.type !== 'subtitle') return false;
  const text = (node.content ?? []).map((c) => (c.type === 'text' ? c.text : '\uFFFC')).join('');
  return EMPTY_TEXT.test(text);
}

function isBoundary(item) {
  return item && BOUNDARY.has(item.node.type);
}

/** Doubly linked list of a section's children, so the original sibling walk ports verbatim. */
function toList(children) {
  const items = children.map((node) => ({ node, prev: null, next: null }));
  items.forEach((item, i) => {
    item.prev = items[i - 1] ?? null;
    item.next = items[i + 1] ?? null;
  });
  return { first: items[0] ?? null, last: items[items.length - 1] ?? null };
}

function toArray(list) {
  const out = [];
  for (let item = list.first; item; item = item.next) out.push(item.node);
  return out;
}

export default async function run(ctx) {
  const answer = await mfbe.ui.message(
    t(ctx,
      'Выберите режим обработки:\nОК – добавить пустые строки до и после иллюстраций.\nОтмена – удалить пустые строки до и после иллюстраций.\n',
      'Choose the mode:\nOK - add empty lines before and after the illustrations.\nCancel - remove the empty lines before and after the illustrations.\n'),
    { icon: 'question', buttons: [{ id: 'ok', label: '', default: true }, { id: 'cancel', label: '', cancel: true }] },
  );
  const mode = answer === 'ok'; // true: add, false: remove (the original `confirm`)
  await mfbe.edit.label(mode
    ? t(ctx, 'добавление пустых строк возле иллюстраций', 'adding empty lines around the illustrations')
    : t(ctx, 'удаление пустых строк возле иллюстраций', 'removing the empty lines around the illustrations'));
  const stats = { removed: 0, added: 0 };

  const prev = (item) => item.prev;
  const next = (item) => item.next;
  const same = (item) => item;

  function remove(list, item) {
    if (item.prev) item.prev.next = item.next;
    else list.first = item.next;
    if (item.next) item.next.prev = item.prev;
    else list.last = item.prev;
    stats.removed += 1;
  }

  function insertBefore(list, node, ref) {
    const item = { node, prev: null, next: null };
    if (ref) {
      item.prev = ref.prev;
      item.next = ref;
      if (ref.prev) ref.prev.next = item;
      else list.first = item;
      ref.prev = item;
    } else {
      item.prev = list.last;
      if (list.last) list.last.next = item;
      else list.first = item;
      list.last = item;
    }
    stats.added += 1;
    return item;
  }

  /** Removes the run of empty lines that follows `item` in direction `dir` (not `item` itself). */
  function removeEmptyLines(list, item, dir) {
    let cursor = dir(item);
    while (cursor && isP(cursor) && isLineEmpty(cursor)) {
      const following = dir(cursor);
      remove(list, cursor);
      cursor = following;
    }
  }

  function addEmptyLine(list, item, addDir) {
    insertBefore(list, { type: 'empty-line', attrs: {} }, addDir(item));
  }

  /** Exactly one empty line next to `item` (none at a section boundary unless `leaveAnyway`). */
  function makeOneEmptyLine(list, item, dir, addDir, leaveAnyway) {
    const neighbour = dir(item);
    if (neighbour && isP(neighbour) && isLineEmpty(neighbour)) {
      removeEmptyLines(list, neighbour, dir);
      const beyond = dir(neighbour);
      if (beyond === null || isBoundary(beyond)) {
        if (leaveAnyway !== true) removeEmptyLines(list, item, dir);
      }
    } else if ((neighbour && !isBoundary(neighbour)) || leaveAnyway === true) {
      addEmptyLine(list, item, addDir);
    }
  }

  /** At most one empty line next to `item` (the first pass of the removal mode). */
  function makeNoMoreThanOneEmptyLine(list, item, dir, leaveAnyway) {
    const neighbour = dir(item);
    if (neighbour && isP(neighbour) && isLineEmpty(neighbour)) {
      removeEmptyLines(list, neighbour, dir);
      const beyond = dir(neighbour);
      if (beyond === null || isBoundary(beyond)) {
        if (leaveAnyway !== true) removeEmptyLines(list, item, dir);
      }
    }
  }

  /** Processes one section (and, recursively, its subsections); returns the new children. */
  function processSection(section) {
    const list = toList(section.content ?? []);
    if (mode === false) {
      for (let item = list.first; item; item = item.next) {
        if (item.node.type === 'image') {
          makeNoMoreThanOneEmptyLine(list, item, prev, true);
          makeNoMoreThanOneEmptyLine(list, item, next, true);
        }
      }
    }
    let imageCnt = 0;
    let preBorderElement = null;
    let wasSectionImage = false;
    let border = null;
    let imageAfterBorder; // undefined until the element after the border is seen
    let wasAnnotation = false;
    let wasSectionInside = false;
    for (let item = list.first; item; item = item.next) {
      const type = item.node.type;
      if (type === 'section') {
        item.node = { ...item.node, content: processSection(item.node) };
        wasSectionInside = true;
      }
      if (type === 'annotation') wasAnnotation = true;
      if (type === 'image') {
        imageCnt += 1;
        if (wasAnnotation && border === null) border = item;
      }
      if (border !== null && imageAfterBorder === undefined) imageAfterBorder = type === 'image' ? item : false;
      if (isP(item) || type === 'poem' || type === 'cite' || type === 'table') {
        if (border === null) border = item;
      } else if (type === 'image' && imageCnt === 2) {
        if (border === null) border = item;
      } else if (border === null) preBorderElement = item;
      if (border === null && !wasSectionImage && type === 'image') wasSectionImage = true;
    }

    let cursor = list.first;
    if (!wasSectionInside && wasSectionImage && border === null) {
      // Nothing in the section but its image.
      makeOneEmptyLine(list, preBorderElement, next, next, true);
      return toArray(list);
    }
    if (!wasSectionInside && wasSectionImage && border !== null && isLineEmpty(border) && imageAfterBorder === undefined) {
      // Only the section image and empty lines.
      makeOneEmptyLine(list, preBorderElement, next, next, true);
      return toArray(list);
    }
    if (!wasSectionInside && border !== null && border.node.type === 'image') {
      // The text of the section starts with an image.
      makeOneEmptyLine(list, border, prev, same, true);
      cursor = border.next;
    } else if (!wasSectionInside && border !== null && isP(border) && isLineEmpty(border) && imageAfterBorder) {
      // The text starts with empty line(s) followed by an image.
      if (mode === false) removeEmptyLines(list, imageAfterBorder, next);
      cursor = imageAfterBorder.next;
    }
    for (let item = cursor; item; item = item.next) {
      if (item.node.type === 'image') {
        if (mode) {
          makeOneEmptyLine(list, item, prev, same);
          makeOneEmptyLine(list, item, next, next);
        } else {
          removeEmptyLines(list, item, prev);
          removeEmptyLines(list, item, next);
        }
      }
    }
    return toArray(list);
  }

  const doc = await mfbe.doc.get();
  const sections = doc.bodies.flatMap((body) => body.content.filter((c) => c.type === 'section'));
  for (let i = 0; i < sections.length; i += 1) {
    const section = sections[i];
    const before = JSON.stringify(section.content);
    const content = processSection(section);
    if (JSON.stringify(content) !== before) await mfbe.doc.replaceNode(section.attrs.nodeId, { ...section, content });
    if (i % 10 === 0) await mfbe.ui.progress(i, sections.length);
    if (ctx.cancelled) return;
  }

  await mfbe.ui.message(
    t(ctx,
      `Скрипт «Добавить либо удалить пустые строки возле иллюстраций»\n(Версия 1.7. Автор Sclex)\n\nОбработка успешно завершена.\n\nСтатистика пустых строк:\nУдалено: ${stats.removed}\nДобавлено: ${stats.added}`,
      `Script "Add or remove the empty lines around the illustrations"\n(Version 1.7. Author: Sclex)\n\nFinished.\n\nEmpty lines:\nRemoved: ${stats.removed}\nAdded: ${stats.added}`),
  );
}
