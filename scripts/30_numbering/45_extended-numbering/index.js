// Converted from FictionBook Editor 2.7.9: Scripts/30_'Числовые' скрипты/45_Расширенная нумерация абзацев.js
// Asks for the numbering (the dialog "HTML/Расширенная нумерация абзацев - параметры.htm": prefix,
// numbers on or off, start number, step, suffix, only the selected paragraphs, skip empty ones)
// and puts prefix + number + suffix before the content of every paragraph of the selection - from
// the one holding its start to the one holding its end, re-selected afterwards - or of every
// paragraph of the page (the book's annotation and history, then every body: title lines, verses,
// subtitles, text authors, dates and table cells included); an empty one (isLineEmpty) is skipped
// when asked, else numbered like the others: an empty line becomes a paragraph, the empty
// paragraph of a missing annotation or history a new one. Then it says how many paragraphs it
// processed (lib/numbering.js). With "only the selected paragraphs" and no selection it says so and
// numbers every paragraph, as the original did.
// Fixed: a start number of 0 starts at 0 (the original's parseInt(...) || 1 made it 1).
// Differences from 2.7.9: the dialog is a form (ui.form) without its live preview; its number
// fields always hold a number, so the original's "must be an integer" warnings cannot occur (a
// fraction counts by its integer part, as parseInt took it); the prefix and the suffix are put in as
// text (the original inserted them as HTML, so tags or entities typed into them were interpreted);
// a selected picture counts as no selection (2.7.9 stopped with a script error).
// The original's notice, kept as written (FR-029):
// Скрипт расширенной нумерации абзацев для редактора FBE
// Автор идеи - Haliz
// Реализация - DeepSeek, 04.11.2025

import { PageEdits, isLineEmpty, paragraphsOfSelection, reselect, t, textSelection, withTextBefore } from './lib/numbering.js';
import { loadBook } from './lib/nav-lib.js';

/** The dialog; null on Cancel. */
async function askSettings(ctx) {
  return mfbe.ui.form({
    title: t(ctx, 'Параметры нумерации абзацев', 'Paragraph numbering settings'),
    width: 560,
    fields: [
      { kind: 'static', id: 'heading', text: t(ctx, 'Настройки нумерации абзацев', 'Paragraph numbering settings') },
      { kind: 'text', id: 'prefix', label: t(ctx, 'Префикс (текст перед номером):', 'Prefix (text before the number):'), value: '', placeholder: t(ctx, '§ или •', '§ or •') },
      { kind: 'checkbox', id: 'useNumbering', label: t(ctx, 'Использовать нумерацию', 'Use numbers'), value: true },
      { kind: 'number', id: 'startNumber', label: t(ctx, 'Начальное число:', 'Start number:'), value: 1 },
      { kind: 'number', id: 'increment', label: t(ctx, 'Шаг инкремента (может быть отрицательным):', 'Step (may be negative):'), value: 1 },
      { kind: 'text', id: 'suffix', label: t(ctx, 'Суффикс (текст после номера):', 'Suffix (text after the number):'), value: '. ', placeholder: t(ctx, '. или :', '. or :') },
      { kind: 'checkbox', id: 'onlySelected', label: t(ctx, 'Только выделенные абзацы', 'Only the selected paragraphs'), value: true },
      { kind: 'checkbox', id: 'skipEmpty', label: t(ctx, 'Пропускать пустые абзацы', 'Skip empty paragraphs'), value: true },
      {
        kind: 'static',
        id: 'description',
        text: t(
          ctx,
          'Описание параметров:\n' +
            '• Префикс — текст, который появится перед номером (или маркером). Например: §, •, -.\n' +
            '• Использовать нумерацию — отметьте галочку, если нужны числа (1, 2, 3…). Снимите, если нужен только маркер.\n' +
            '• Начальное число — с какого числа начать отсчёт (если нумерация включена)(может быть отрицательным).\n' +
            '• Шаг инкремента — на сколько увеличивать число (может быть отрицательным: –1, –10 и т. д.).\n' +
            '• Суффикс — текст, который появится после номера (или маркера). Например: . , : , → .',
          'The settings:\n' +
            '• Prefix — the text that comes before the number (or the marker). For example: §, •, -.\n' +
            '• Use numbers — tick it if you need numbers (1, 2, 3…). Clear it if you need only a marker.\n' +
            '• Start number — the number to start counting from (with numbers on); it may be negative.\n' +
            '• Step — how much the number grows (it may be negative: –1, –10 and so on).\n' +
            '• Suffix — the text that comes after the number (or the marker). For example: . , : , → .',
        ),
      },
    ],
    okLabel: t(ctx, 'Применить нумерацию', 'Apply the numbering'),
    cancelLabel: t(ctx, 'Отмена', 'Cancel'),
  });
}

export default async function run(ctx) {
  // Показываем диалог настроек
  const settings = await askSettings(ctx);
  // Если пользователь нажал Отмена
  if (!settings) return;

  // Основной код нумерации
  const prefix = settings.prefix || '';
  const useNumbering = settings.useNumbering !== false;
  const start = parseInt(settings.startNumber);
  const startNumber = Number.isNaN(start) ? 1 : start;
  const increment = parseInt(settings.increment) || 1;
  const suffix = settings.suffix || '';
  let onlySelected = settings.onlySelected !== false;
  const skipEmpty = settings.skipEmpty !== false;

  let cnt = startNumber;
  const edits = new PageEdits();

  // Returns whether the paragraph counts as processed.
  const processP = async (item) => {
    if (skipEmpty && isLineEmpty(item)) return false;
    let textToInsert = '';
    if (prefix) textToInsert += prefix;
    if (useNumbering) textToInsert += cnt;
    if (suffix) textToInsert += suffix;
    if (textToInsert) {
      await edits.put(item, withTextBefore(item, textToInsert));
      edits.inserted.set(item, textToInsert.length);
    }
    if (useNumbering) cnt += increment;
    return true;
  };

  // Проверяем выделение
  const selected = await textSelection();
  if (onlySelected && !selected) {
    await mfbe.ui.message(t(ctx, 'Нет выделения. Будут обработаны все абзацы в документе.', 'Nothing is selected. Every paragraph of the document will be processed.'));
    onlySelected = false;
  }

  await mfbe.ui.status(t(ctx, 'Добавляем нумерацию в абзацы…', 'Numbering the paragraphs…'));

  let processedCount = 0;
  const book = selected?.book ?? (await loadBook());
  const paragraphs = onlySelected ? paragraphsOfSelection(book, selected.where) : book.ps;
  for (let k = 0; k < paragraphs.length; k += 1) {
    if (ctx.cancelled) return;
    if (k % 200 === 199) await mfbe.ui.progress(k, paragraphs.length);
    if (await processP(paragraphs[k])) processedCount++;
  }
  await edits.commit();
  if (onlySelected) await reselect(book, selected.where, edits);

  if (processedCount > 0) {
    await mfbe.ui.message(t(ctx, 'Обработано абзацев: ', 'Paragraphs processed: ') + processedCount);
  } else {
    await mfbe.ui.message(t(ctx, 'Не найдено абзацев для обработки.', 'No paragraphs to process were found.'));
  }
}
