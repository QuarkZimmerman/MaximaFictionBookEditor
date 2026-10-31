// Converted from FictionBook Editor 2.7.9: Scripts/12_Обработка кавычек/005_Проставить елочки и лапки (от позиции курсора; как будто перед курсором 1 незакрытая кавычка).js
// (Sclex, version 3.9; first converted from 2.7beta1's 005_Расстановка елочек и лапок (с позиции курсора, начиная с 1-го уровня).js).
// As 004 (from the caret, or the selection), counting one quote as open before the caret; see quotes.js for the rules and the differences from the original.
// The original's notice, kept as written (FR-029):
//Скрипт "Новые кавычки на елочки"
//Автор Sclex
//Подробности тут: http://www.fictionbook.org/forum/viewtopic.php?f=7&t=4412
//И тут: http://scripts.fictionbook.org
import { placeQuotes } from './quotes.js';

export default async function run(ctx) {
  await placeQuotes(ctx, {
    version: {
      ru: "Скрипт «Проставить елочки и лапки (от позиции курсора; как будто перед курсором 1 незакрытая кавычка)» (версия 3.9)",
      en: "Script \"Place guillemets and low quotes (from the caret; as if 1 quote before the caret were still open)\" (version 3.9)",
    },
    startLevel: 1,
    fromCaret: true,
    skipDescriptionEnd: true,
    block: ['элемента', 'an element'],
  });
}
