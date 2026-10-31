// Converted from FictionBook Editor 2.7.9: Scripts/03_Комментарии/20_Проверить корректность оформления комментариев.js
// Checks the comments of the book, as 02_Примечания/30 checks the footnotes: every section of
// the comments body has an id; every link of the book, external ones (http://, https://,
// ftp://) and footnote links (into the notes body) aside, has a text and an address with "#"
// pointing to a comment section, no section is pointed to twice and the links follow the order of
// the sections; every section is pointed to. The first problem is reported and the caret put
// where it is (FictionBook Editor's GoTo: at the start of the link or of the section); otherwise
// a message says that no error was found. The book is not changed. Differences from 2.7.9:
// docs/scripting/conversion-notes-279-a.md (group 03).
// The original's notice, kept as written (FR-029):
// Скрипт "Проверка корректности оформления комментариев"
// Версия: 1.4

import {
  bodyNamed,
  elapsed,
  linkGroups,
  linkText,
  loadBook,
  pageBlocks,
  t,
  TEXT_BLOCKS,
} from './lib/notes-book.js';

/** GetLocalHref of the original: "1" without "#", the id after "main.html#" or after the first character. */
function getLocalHref(href) {
  if (href.indexOf('#') < 0) return '1';
  const at = href.search(/main.html#/i);
  return at >= 0 ? href.slice(at + 10) : href.substring(1);
}

/** The first text block of a section (where GoTo puts the caret). */
function firstBlock(node) {
  if (!node || typeof node !== 'object' || node.type === 'text') return null;
  if (TEXT_BLOCKS.has(node.type)) return node;
  for (const child of node.content ?? []) {
    const found = firstBlock(child);
    if (found) return found;
  }
  return null;
}

async function goToSection(section) {
  const block = firstBlock(section);
  if (block) await mfbe.selection.set({ nodeId: block.attrs.nodeId, offset: 0 });
  else await mfbe.selection.selectNode(section.attrs.nodeId);
}

export default async function run(ctx) {
  const started = Date.now();
  const book = await loadBook();
  const notesBody = bodyNamed(book, 'notes');
  const commentsBody = bodyNamed(book, 'comments');
  if (!commentsBody) {
    await mfbe.ui.message(t(ctx, 'Отсутствует body комментариев.', 'There is no comments body.'), { icon: 'warning' });
    return;
  }
  // the ids inside the notes body (footnote links are not checked)
  const inNotes = new Set();
  const collect = (node) => {
    if (!node || typeof node !== 'object' || node.type === 'text') return;
    if (node.attrs?.id) inNotes.add(node.attrs.id);
    for (const child of node.content ?? []) collect(child);
  };
  if (notesBody) collect(notesBody);
  const sections = (commentsBody.content ?? []).filter((node) => node.type === 'section');
  const idByNum = new Map();
  const countById = new Map();
  const numById = new Map();
  for (let i = 0; i < sections.length; i += 1) {
    const id = sections[i].attrs?.id;
    if (!id) {
      await mfbe.ui.message(
        t(ctx, `Раздел номер ${i + 1} в body комментариев не имеет id.\nПеремещаемся на нее...`, `Section ${i + 1} of the comments body has no id.\nMoving to it...`),
        { icon: 'warning' },
      );
      await goToSection(sections[i]);
      return;
    }
    idByNum.set(i + 1, id);
    countById.set(id, 0);
    numById.set(id, i + 1);
  }

  // Every link of the page in document order (the annotation and the history first).
  const links = [];
  for (const entry of pageBlocks(book)) {
    const content = entry.node.content ?? [];
    for (const group of linkGroups(content)) links.push({ block: entry.node, group, text: linkText(content, group) });
  }

  let previousNum = 0;
  let previous = null;
  for (const link of links) {
    const raw = link.group.href ?? '';
    if (raw.indexOf('http://') !== -1 || raw.indexOf('https://') !== -1 || raw.indexOf('ftp://') !== -1) continue;
    let error = null;
    if (link.text === '') error = t(ctx, 'Текст ссылки равен пустой строке.', 'The link text is empty.');
    else if (raw.length === 0) error = t(ctx, 'Пустой адрес ссылки.', 'The link address is empty.');
    else {
      const href = getLocalHref(raw);
      if (href === '1') error = t(ctx, 'Отсутствует # в адресе ссылки.', 'The link address has no #.');
      else if (inNotes.has(href)) continue;
      else if (!countById.has(href)) {
        error = t(ctx, 'В body комментариев нет раздела комментария с id, указанным в ссылке.', 'The comments body has no comment section with the id of this link.');
      } else if (countById.get(href) !== 0) {
        error = t(ctx, 'Вторая сноска, которая ссылается на тот же раздел.', 'A second link points to the same section.');
      } else {
        countById.set(href, 1);
        const num = numById.get(href);
        if (num !== previousNum + 1) {
          // the comment link before, which 2.7.9 took for the link before in the document
          error = previous
            ? t(
                ctx,
                `Ссылки идут не по порядку.\n\nВот куда ссылается предыдущая:\nНомер: ${previousNum}        id: ${idByNum.get(previousNum)}\nТекст ссылки: ${previous.text}\n\nА вот куда текущая:\nНомер: ${num}        id: ${idByNum.get(num)}\nТекст ссылки: ${link.text}\n`,
                `The links are out of order.\n\nThe previous one points to:\nNumber: ${previousNum}        id: ${idByNum.get(previousNum)}\nLink text: ${previous.text}\n\nThe current one points to:\nNumber: ${num}        id: ${idByNum.get(num)}\nLink text: ${link.text}\n`,
              )
            : t(
                ctx,
                `Первая ссылка ссылается не на первый раздел.\n\nА вот сюда:\nНомер: ${num}        id: ${idByNum.get(num)}\nТекст ссылки: ${link.text}\n`,
                `The first link does not point to the first section.\n\nIt points to:\nNumber: ${num}        id: ${idByNum.get(num)}\nLink text: ${link.text}\n`,
              );
        }
        previousNum = num;
        previous = link;
      }
    }
    if (error) {
      await mfbe.ui.message(
        t(ctx, `Ошибка в сноске ${link.text}\n${error}\nПеремещаемся на ошибочную сноску...`, `Error in the link ${link.text}\n${error}\nMoving to the faulty link...`),
        { icon: 'error' },
      );
      await mfbe.selection.set({ nodeId: link.block.attrs.nodeId, offset: link.group.start });
      return;
    }
  }

  let missing = '';
  let firstMissing = null;
  for (let i = 1; i <= sections.length; i += 1) {
    const id = idByNum.get(i);
    if (countById.get(id) !== 1) {
      missing += t(ctx, `Номер: ${i}         id: ${id}\n`, `Number: ${i}         id: ${id}\n`);
      if (!firstMissing) firstMissing = sections[i - 1];
    }
  }
  if (missing) {
    await mfbe.ui.message(
      t(
        ctx,
        `Отсутствуют ссылки на некоторые разделы комментариев.\nНиже можете увидеть их перечисление.\n\n${missing}\nПереходим на первый из таких разделов...`,
        `Some comment sections have no link pointing to them.\nThey are listed below.\n\n${missing}\nMoving to the first of them...`,
      ),
      { icon: 'warning' },
    );
    await goToSection(firstMissing);
    return;
  }
  await mfbe.ui.message(
    t(
      ctx,
      `Проверка корректности оформления комментариев завершена. Ошибок не обнаружено.\nЗатраченное время: ${elapsed(started)}`,
      `The check of the comments is finished. No errors found.\nTime taken: ${elapsed(started)}`,
    ),
  );
}
