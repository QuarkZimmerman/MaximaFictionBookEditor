// Converted from FictionBook Editor 2.7.9: Scripts/32_Маркеры сносок/70_Заменить числа в круглых скобках на знак # (во всем документе).js
// Replaces every whole number in parentheses - "(12)" - by "#" in every paragraph of the page: the
// book's annotation and history, then every body (lib/page-paragraphs.js). That is what the
// original's document.getElementsByTagName('p') found - every text block of FictionBook Editor's
// page was a <P> (table cells and dates too), and the tags <v>, <subtitle> and <text-author> it
// also asked for did not occur there. Each run of text is searched by itself, as the original
// searched each text node: "(<emphasis>1</emphasis>)" does not count. Then it shows the number of
// replacements in the status bar and a message, which warns when the number is odd.
// The original's notice, kept as written (FR-029):
// Скрипт для замены целых чисел в круглых скобках на знак решетки (#) во всем документе для редактора FBE
// Идея - TaKir
// Реализация - DeepSeek, TaKir
// version 2.0, 04.11.2025
//  Скрипт применяется для расстановки возможных маркеров сносок, выполненных цифрами в круглых скобках

import { PageEdits, hasContent, loadBook, t } from './lib/page-paragraphs.js';

/** The paragraph with "(<digits>)" replaced by "#" in each of its runs of text, or null. */
function replaced(node, onReplace) {
  let changed = false;
  const content = (node.content ?? []).map((item) => {
    if (item.type !== 'text') return item;
    const text = item.text ?? '';
    // Регулярное выражение для целых чисел: только цифры внутри круглых скобок
    const newText = text.replace(/\((\d+)\)/g, () => {
      onReplace();
      return '#';
    });
    if (newText === text) return item;
    changed = true;
    return { ...item, text: newText };
  });
  return changed ? { ...node, content } : null;
}

export default async function run(ctx) {
  const caption = t(ctx, 'FBE скрипт', 'FBE script');
  try {
    let replaceCount = 0;
    await mfbe.ui.status(t(ctx, 'Заменяем числа в круглых скобках на # во всем документе…', 'Replacing the numbers in parentheses by # in the whole document…'));

    // Обрабатываем каждый абзац страницы
    const book = await loadBook();
    const edits = new PageEdits();
    for (let i = 0; i < book.ps.length; i += 1) {
      if (ctx.cancelled) return;
      if (i % 500 === 499) await mfbe.ui.progress(i, book.ps.length);
      const item = book.ps[i];
      if (!hasContent(item)) continue;
      const node = replaced(item.node, () => {
        replaceCount++;
      });
      if (node) await edits.put(item, node);
    }
    await edits.commit();

    // Формируем сообщение со статистикой
    let message = t(ctx, 'Скрипт «Замена чисел в круглых скобках на знак решетки (#)»\n', 'Script “Replacing the numbers in parentheses by the hash sign (#)”\n');
    message += 'version 2.0\n\n';
    message += t(ctx, 'Произведено ' + replaceCount + ' замен.', 'Replacements made: ' + replaceCount + '.');
    message += t(ctx, '\n\nОбработаны только теги: <p>, <v>, <subtitle>, <text-author>', '\n\nOnly the tags <p>, <v>, <subtitle>, <text-author> were processed');
    message += t(ctx, '\nЗаменяются только целые числа в круглых скобках.', '\nOnly whole numbers in parentheses are replaced.');

    // Проверяем на нечетность
    if (replaceCount % 2 !== 0) {
      message += t(
        ctx,
        '\n\nВНИМАНИЕ! Кол-во замен нечетное, внимательно проверьте все маркеры сносок.',
        '\n\nATTENTION! The number of replacements is odd, check all the footnote markers carefully.',
      );
    }

    await mfbe.ui.status(t(ctx, 'Заменено чисел в круглых скобках: ' + replaceCount + '.', 'Numbers in parentheses replaced: ' + replaceCount + '.'), { sticky: true });
    await mfbe.ui.message(message, { caption });
  } catch (e) {
    await mfbe.ui.message(t(ctx, 'Ошибка: ', 'Error: ') + e.message, { caption });
  }
}
