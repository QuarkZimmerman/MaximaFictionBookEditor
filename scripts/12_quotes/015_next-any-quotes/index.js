// Converted from FictionBook Editor 2.7.9: Scripts/12_Обработка кавычек/015_Перейти на следующие прямые кавычки, елочки или лапки.js
// (Sclex, version 2.9; first converted from 2.7beta1's 014_Переход на след. прямые кавычки, елочки или лапки.js).
// Selects the next of [«, », „, “, ”, "] from the end of the selection; see goto-quotes.js.
// The original's notice, kept as written (FR-029):
//Переход на кавычки v2.9
//Автор Sclex
//Подробности тут: http://www.fictionbook.org/forum/viewtopic.php?f=7&t=4412
//И тут: http://scripts.fictionbook.org
import { goToQuotes } from './goto-quotes.js';

export default async function run(ctx) {
  return goToQuotes(ctx, {
    forward: true,
    chars: ['«', '»', '„', '“', '”', '"'],
    version: { ru: 'Скрипт «Переход на кавычки v2.9».', en: 'Script "Go to quotes" v2.9.' },
  });
}
