// Converted from FictionBook Editor 2.7.9: Scripts/16_Поиск форматирования/200_Найти предыдущие подряд идущие однотипные элементы.js
// Finds the previous cite, poem, subtitle or epigraph whose previous sibling (empty lines left out)
// is of the same type and selects its first paragraph (block-search.js). Returns "Found", or
// "NotFound" after saying that none was found (as the original's Run() did). Differences from the
// original: docs/scripting/conversion-notes-279-b.md (group 16).
// The original's notice, kept as written (FR-029):
// Скрипт «Найти предыдущие подряд идущие однотипные элементы» (цитаты, стихи, эпиграфы, подзаголовки...)
// Автор Sclex, сборка TaKir
// Версия 1.3
//
// Для добавления в поиск или исключения определенных элементов из поиска отредактируйте строку в начале скрипта:
// var blockElementClass="^(cite|poem|subtitle|epigraph)$"; // регэксп для класса элемента, который (элемент) нужно искать
//
// Стихи ищутся только без назначенного автора стиха, во избежание лишних срабатываний на полностью корректно оформленых стихах.
// Эпиграфы и цитаты ищутся все, с авторами и без.

import { runRepeatedSearch } from './block-search.js';

export default async function run(ctx) {
  // var blockElementClass="^(cite|poem|subtitle|epigraph)$"; - in block-search.js (REPEATED).
  return runRepeatedSearch(ctx, {
    forward: false,
    status: {
      ru: 'Переходим на предыдущие подряд идущие однотипные элементы…',
      en: 'Going to the previous consecutive elements of one type…',
    },
    notFound: {
      ru: 'До начала документа не нашлось подряд идущих однотипных элементов.',
      en: 'No consecutive elements of one type were found up to the beginning of the document.',
    },
  });
}
