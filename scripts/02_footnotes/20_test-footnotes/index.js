// Converted from 02_Добавление примечания/20_Тест сносок.js (FictionBook Editor 2.7), Tier 2.
// Checks the footnotes of the book: every note section has an id, every note link points to an
// existing note section, no section is referenced twice, the links follow the section order and
// every section is referenced. The first problem is reported and the offending element selected.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
// Тест сносок
// Версия: 1.2
import { collectLinks, t } from './notes-engine.js';

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
        t(ctx, `Секция номер ${i + 1} в body примечаний не имеет id.\nПеремещаемся на нее...`,
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

  const links = collectLinks(doc);
  const blockText = new Map();
  const textOfLink = async (link) => {
    if (!blockText.has(link.blockId)) blockText.set(link.blockId, await mfbe.doc.textOf(link.blockId));
    return blockText.get(link.blockId).slice(link.start, link.end);
  };
  const select = async (link) => {
    await mfbe.selection.set({ nodeId: link.blockId, offset: link.start }, { nodeId: link.blockId, offset: link.end });
  };

  let previousNum = 0;
  let previous = null;
  for (const link of links) {
    if (link.type !== 'note') continue;
    if (/^(https?|ftp):\/\//i.test(link.href)) continue;
    const text = await textOfLink(link);
    let error = null;
    if (text === '') error = t(ctx, 'Текст ссылки равен пустой строке.', 'The link text is empty.');
    else if (!link.href) error = t(ctx, 'Пустой адрес ссылки.', 'The link address is empty.');
    else if (link.id === null) error = t(ctx, 'Отсутствует # в адресе ссылки.', 'The link address has no #.');
    else if (!countById.has(link.id)) error = t(ctx, 'В body примечаний нет секции примечания с id, указанным в ссылке.', 'The notes body has no section with the id of this link.');
    else if (countById.get(link.id) !== 0) error = t(ctx, 'Вторая сноска, которая ссылается на ту же секцию.', 'A second footnote points to the same section.');
    else {
      countById.set(link.id, countById.get(link.id) + 1);
      const num = numById.get(link.id);
      if (num !== previousNum + 1) {
        if (previous) {
          error = t(ctx,
            `Ссылки идут не по порядку.\n\nВот куда ссылается предыдущая:\nНомер: ${previousNum}        id: ${idByNum.get(previousNum)}\nТекст ссылки: ${await textOfLink(previous)}\n\nА вот куда текущая:\nНомер: ${num}        id: ${idByNum.get(num)}\nТекст ссылки: ${text}\n`,
            `The links are out of order.\n\nThe previous one points to:\nNumber: ${previousNum}        id: ${idByNum.get(previousNum)}\nLink text: ${await textOfLink(previous)}\n\nThe current one points to:\nNumber: ${num}        id: ${idByNum.get(num)}\nLink text: ${text}\n`);
        } else {
          error = t(ctx,
            `Первая ссылка ссылается не на первую секцию.\n\nА вот сюда:\nНомер: ${num}        id: ${idByNum.get(num)}\nТекст ссылки: ${text}\n`,
            `The first link does not point to the first section.\n\nIt points to:\nNumber: ${num}        id: ${idByNum.get(num)}\nLink text: ${text}\n`);
        }
      }
      previousNum = num;
      previous = link;
    }
    if (error) {
      await mfbe.ui.message(
        t(ctx, `Ошибка в сноске ${text}\n${error}\nПеремещаемся на ошибочную сноску...`,
          `Error in footnote ${text}\n${error}\nMoving to the faulty footnote...`),
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
      t(ctx, `Отсутствуют ссылки на некоторые секции примечаний.\nНиже можете увидеть их перечисление.\n\n${missing}\nПереходим на первую из таких секций...`,
        `Some note sections are not referenced.\nThey are listed below.\n\n${missing}\nMoving to the first of them...`),
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
    t(ctx, `Тест сносок завершен. Ошибок не обнаружено.\nЗатраченное время: ${time}`,
      `Footnote test finished. No errors found.\nTime taken: ${time}`),
  );
}
