// Converted from FictionBook Editor 2.7.9: Scripts/32_Маркеры сносок/71_Заменить числа в круглых скобках на знак # (в выделенном фрагменте).js
// Replaces every whole number in parentheses - "(12)" - by "#" in the paragraphs of the selection,
// whole paragraphs from the one holding its start to the one holding its end, the book's
// annotation and history included (lib/page-paragraphs.js); each run of text is searched by
// itself, as the original searched each text node: "(<emphasis>1</emphasis>)" does not count. Then
// it shows the number of replacements in the status bar and a message, which warns when the
// number is odd.
// Fixed: the original took the element holding each end of the selection for its paragraph, so a
// selection that started inside formatting (italics, bold, a link...) skipped its first paragraph,
// one inside a single formatted part replaced nothing, and one that ended inside formatting went
// on to the end of the book; here the paragraphs are always those of the selection.
// Differences from 2.7.9: a selected picture gets the message for a missing selection (2.7.9
// stopped with an error message); the original's check for a selection in an input field has no
// counterpart (the script works on the Body view).
// The original's notice, kept as written (FR-029):
// Скрипт для замены целых чисел в круглых скобках на знак решетки (#) в выделенном фрагменте для редактора FBE
// Идея - TaKir
// Реализация - DeepSeek, TaKir
// version 2.0, 04.11.2025
//  Скрипт применяется для расстановки возможных маркеров сносок, выполненных цифрами в круглых скобках

import { PageEdits, hasContent, paragraphsOfSelection, t, textSelection } from './lib/page-paragraphs.js';

/** The paragraph with "(<digits>)" replaced by "#" in each of its runs of text, or null. */
function replaced(node, onReplace) {
  let changed = false;
  const content = (node.content ?? []).map((item) => {
    if (item.type !== 'text') return item;
    const text = item.text ?? '';
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
    const errMsg = t(
      ctx,
      'Нет выделения.\n\nПеред запуском скрипта нужно выделить текст, который будет обработан.',
      'Nothing is selected.\n\nSelect the text to process before running the script.',
    );
    const selected = await textSelection();
    if (!selected) {
      await mfbe.ui.message(errMsg, { caption });
      return;
    }
    await mfbe.ui.status(t(ctx, 'Заменяем числа в круглых скобках на # в выделении…', 'Replacing the numbers in parentheses by # in the selection…'));

    // Обрабатываем абзацы выделения
    const paragraphs = paragraphsOfSelection(selected.book, selected.where);
    const edits = new PageEdits();
    for (let i = 0; i < paragraphs.length; i += 1) {
      if (ctx.cancelled) return;
      if (i % 500 === 499) await mfbe.ui.progress(i, paragraphs.length);
      const item = paragraphs[i];
      if (!hasContent(item)) continue;
      const node = replaced(item.node, () => {
        replaceCount++;
      });
      if (node) await edits.put(item, node);
    }
    await edits.commit();

    // Показываем результат
    let message = t(ctx, 'Скрипт «Замена чисел в круглых скобках на # (выделение)»\n', 'Script “Replacing the numbers in parentheses by # (selection)”\n');
    message += 'version 2.0\n\n';
    message += t(
      ctx,
      'Произведено ' + replaceCount + ' замен в выделенном фрагменте.',
      'Replacements made in the selected fragment: ' + replaceCount + '.',
    );
    message += t(ctx, '\n\nОбработаны только теги: <p>, <v>, <subtitle>, <text-author>', '\n\nOnly the tags <p>, <v>, <subtitle>, <text-author> were processed');
    message += t(ctx, '\nЗаменяются только целые числа в круглых скобках.', '\nOnly whole numbers in parentheses are replaced.');

    if (replaceCount % 2 !== 0) {
      message += t(
        ctx,
        '\n\nВНИМАНИЕ! Кол-во замен нечетное, внимательно проверьте все маркеры сносок.',
        '\n\nATTENTION! The number of replacements is odd, check all the footnote markers carefully.',
      );
    }

    await mfbe.ui.status(t(ctx, 'Заменено чисел круглых в скобках: ' + replaceCount + '.', 'Numbers in parentheses replaced: ' + replaceCount + '.'), { sticky: true });
    await mfbe.ui.message(message, { caption });
  } catch (e) {
    await mfbe.ui.message(t(ctx, 'Ошибка: ', 'Error: ') + e.message, { caption });
  }
}
