// Converted from FictionBook Editor 2.7.9: Scripts/12_Обработка кавычек/001_Проставить елочки и лапки (от начала документа).js
// (Sclex, version 3.9; first converted from 2.7beta1's 001_Расстановка елочек и лапок.js).
// Turns the straight quotes of the selection, or of the whole book when nothing is selected, into «» and „“ by their nesting level; see quotes.js for the rules and the differences from the original.
// The original's notice, kept as written (FR-029):
//Скрипт "Новые кавычки на елочки"
//Автор Sclex
//Подробности тут: http://www.fictionbook.org/forum/viewtopic.php?f=7&t=4412
//И тут: http://scripts.fictionbook.org
import { placeQuotes } from './quotes.js';

export default async function run(ctx) {
  await placeQuotes(ctx, {
    version: {
      ru: "Скрипт «Проставить елочки и лапки (от начала документа)» (версия 3.9)",
      en: "Script \"Place guillemets and low quotes (from the start of the document)\" (version 3.9)",
    },
    startLevel: 0,
    block: ['блочного элемента', 'a block element'],
  });
}
