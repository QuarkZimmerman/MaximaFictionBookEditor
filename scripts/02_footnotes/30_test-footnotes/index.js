// Converted from FictionBook Editor 2.7: Scripts/02_Добавление примечания/20_Тест сносок.js,
// brought up to FictionBook Editor 2.7.9: Scripts/02_Примечания/30_Проверить корректность
// оформления примечаний.js (version 1.3), Tier 2.
// Checks the footnotes of the book: every section of the notes body has an id, every footnote
// link (type="note", FictionBook Editor's class="note") points to a section of the notes body, no
// section is pointed to twice, the links follow the order of the sections and every section is
// pointed to. The first problem is reported and its place selected (the faulty link, or the
// section). The links are those of FictionBook Editor's page, in its order: the book's annotation
// and history first, then every body. 2.7.9 changed the texts only ("раздел" for "секция").
// Differences from 2.7.9: docs/scripting/conversion-notes-279-a.md (group 02).
// The original's notice, kept as written (FR-029):
// Тест сносок
// Версия: 1.3

const TEXT_BLOCKS = new Set(['p', 'subtitle', 'v', 'text-author', 'td', 'th']);

/** Russian in the Russian interface, English otherwise. */
function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/**
 * The original's GetLocalHref: "1" (here null) without "#"; what follows "main.html#"; else the
 * address without its first character - the id of "#id".
 */
function localHref(href) {
  if (typeof href !== 'string' || href.indexOf('#') < 0) return null;
  const at = href.search(/main\.html#/i);
  if (at >= 0) return href.slice(at + 10);
  return href.substring(1);
}

/** The text blocks of the page: the annotation and the history, then every body. */
function pageBlocks(doc) {
  const blocks = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object' || node.type === 'text') return;
    if (TEXT_BLOCKS.has(node.type)) {
      blocks.push(node);
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(doc.description?.titleInfo?.annotation);
  visit(doc.description?.documentInfo?.history);
  for (const body of doc.bodies) visit(body);
  return blocks;
}

function sameLink(a, b) {
  return !!a && !!b && a.attrs.href === b.attrs.href && (a.attrs.type ?? null) === (b.attrs.type ?? null);
}

/**
 * Every link of the page in order (the original's fbw_body.getElementsByTagName("A")):
 * consecutive text nodes under the same link mark form one link, with its text (a picture as
 * U+FFFC) and its offsets in the block.
 */
function collectLinks(doc) {
  const links = [];
  for (const block of pageBlocks(doc)) {
    let pos = 0;
    let current = null;
    (block.content ?? []).forEach((child, index) => {
      const mark = child.type === 'text' ? ((child.marks ?? []).find((m) => m.type === 'link') ?? null) : null;
      const text = child.type === 'text' ? child.text : '\uFFFC';
      if (mark && current && sameLink(current.mark, mark) && current.last === index - 1) {
        current.end = pos + text.length;
        current.last = index;
        current.text += text;
      } else if (mark) {
        current = {
          blockId: block.attrs.nodeId, mark, href: mark.attrs.href ?? '', id: localHref(mark.attrs.href),
          type: mark.attrs.type ?? null, start: pos, end: pos + text.length, last: index, text,
        };
        links.push(current);
      } else {
        current = null;
      }
      pos += text.length;
    });
  }
  return links;
}

export default async function run(ctx) {
  const started = Date.now();
  const doc = await mfbe.doc.get();
  const notes = doc.bodies.find((b) => b.attrs?.name === 'notes');
  if (!notes) {
    await mfbe.ui.message(t(ctx, 'Отсутствует body примечаний.', 'There is no notes body.'), { icon: 'warning' });
    return;
  }
  const sections = notes.content.filter((c) => c.type === 'section');
  const idByNum = new Map();
  const countById = new Map();
  const numById = new Map();
  for (let i = 0; i < sections.length; i += 1) {
    const id = sections[i].attrs?.id;
    if (!id) {
      await mfbe.ui.message(
        t(ctx, `Раздел номер ${i + 1} в body примечаний не имеет id.\nПеремещаемся на нее...`,
          `Section ${i + 1} of the notes body has no id.\nMoving to it...`),
        { icon: 'warning' },
      );
      await mfbe.selection.selectNode(sections[i].attrs.nodeId);
      return;
    }
    idByNum.set(i + 1, id);
    countById.set(id, 0);
    numById.set(id, i + 1);
  }

  const select = async (link) => {
    await mfbe.selection.set({ nodeId: link.blockId, offset: link.start }, { nodeId: link.blockId, offset: link.end });
  };

  let previousNum = 0;
  let previous = null;
  for (const link of collectLinks(doc)) {
    if (link.type !== 'note') continue;
    const href = link.href;
    if (href.indexOf('http://') !== -1 || href.indexOf('https://') !== -1 || href.indexOf('ftp://') !== -1) continue;
    const text = link.text;
    let error = null;
    if (text === '') error = t(ctx, 'Текст ссылки равен пустой строке.', 'The link text is empty.');
    else if (href.length === 0) error = t(ctx, 'Пустой адрес ссылки.', 'The link address is empty.');
    else if (link.id === null) error = t(ctx, 'Отсутствует # в адресе ссылки.', 'The link address has no #.');
    else if (!countById.has(link.id)) error = t(ctx, 'В body примечаний нет раздела примечания с id, указанным в ссылке.', 'The notes body has no footnote section with the id of this link.');
    else if (countById.get(link.id) !== 0) error = t(ctx, 'Вторая сноска, которая ссылается на тот же раздел.', 'A second footnote that points to the same section.');
    else {
      countById.set(link.id, countById.get(link.id) + 1);
      const num = numById.get(link.id);
      if (num !== previousNum + 1) {
        if (previous) {
          error = t(ctx,
            `Ссылки идут не по порядку.\n\nВот куда ссылается предыдущая:\nНомер: ${previousNum}        id: ${idByNum.get(previousNum)}\nТекст ссылки: ${previous.text}\n\nА вот куда текущая:\nНомер: ${num}        id: ${idByNum.get(num)}\nТекст ссылки: ${text}\n`,
            `The links are out of order.\n\nThe previous one points to:\nNumber: ${previousNum}        id: ${idByNum.get(previousNum)}\nLink text: ${previous.text}\n\nThe current one points to:\nNumber: ${num}        id: ${idByNum.get(num)}\nLink text: ${text}\n`);
        } else {
          error = t(ctx,
            `Первая ссылка ссылается не на первый раздел.\n\nА вот сюда:\nНомер: ${num}        id: ${idByNum.get(num)}\nТекст ссылки: ${text}\n`,
            `The first link does not point to the first section.\n\nIt points here:\nNumber: ${num}        id: ${idByNum.get(num)}\nLink text: ${text}\n`);
        }
      }
      previousNum = num;
      previous = link;
    }
    if (error) {
      await mfbe.ui.message(
        t(ctx, `Ошибка в сноске ${text}\n${error}\nПеремещаемся на ошибочную сноску...`,
          `Error in the footnote ${text}\n${error}\nMoving to the faulty footnote...`),
        { icon: 'error' },
      );
      await select(link);
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
      t(ctx, `Отсутствуют ссылки на некоторые разделы примечаний.\nНиже можете увидеть их перечисление.\n\n${missing}\nПереходим на первый из таких разделов...`,
        `Some footnote sections have no link pointing to them.\nThey are listed below.\n\n${missing}\nMoving to the first of them...`),
      { icon: 'warning' },
    );
    await mfbe.selection.selectNode(firstMissing.attrs.nodeId);
    return;
  }

  const ms = Date.now() - started;
  const min = Math.floor(ms / 60000);
  const sec = Math.ceil(10 * (ms / 1000 - min * 60)) / 10;
  const time = min > 0 ? `${min} мин. ${sec} с` : `${sec} с`;
  await mfbe.ui.message(
    t(ctx, `Проверка корректности оформления примечаний завершена. Ошибок не обнаружено.\nЗатраченное время: ${time}`,
      `The check of the footnotes is finished. No errors found.\nTime taken: ${time}`),
  );
}
