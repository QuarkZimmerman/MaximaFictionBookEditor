// Converted from FictionBook Editor 2.7.9: Scripts/12_Обработка кавычек/004_Проставить елочки и лапки (от позиции курсора).js
// (Sclex, version 3.9; first converted from 2.7beta1's 004_Расстановка елочек и лапок (с позиции курсора).js).
// Turns the straight quotes from the caret to the end of the book, or of the selection, into «» and „“ by their nesting level; see quotes.js for the rules and the differences from the original.
// The original's notice, kept as written (FR-029):
//Скрипт "Новые кавычки на елочки"
//Автор Sclex
//Подробности тут: http://www.fictionbook.org/forum/viewtopic.php?f=7&t=4412
//И тут: http://scripts.fictionbook.org
import { placeQuotes } from './quotes.js';

export default async function run(ctx) {
  await placeQuotes(ctx, {
    version: {
      ru: "Скрипт «Проставить елочки и лапки (от позиции курсора)» (версия 3.9)",
      en: "Script \"Place guillemets and low quotes (from the caret)\" (version 3.9)",
    },
    startLevel: 0,
    fromCaret: true,
    block: ['элемента', 'an element'],
  });
}
