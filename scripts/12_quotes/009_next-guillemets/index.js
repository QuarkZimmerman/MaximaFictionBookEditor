// Converted from FictionBook Editor 2.7.9: Scripts/12_Обработка кавычек/009_Перейти на следующие елочки.js
// (Sclex, version 2.9; first converted from 2.7beta1's 007_Переход на след. елочки.js).
// Selects the next of [«, »] from the end of the selection; see goto-quotes.js.
// The original's notice, kept as written (FR-029):
//Перейти на кавычки v2.9
//Автор Sclex
//Подробности тут: http://www.fictionbook.org/forum/viewtopic.php?f=7&t=4412
//И тут: http://scripts.fictionbook.org
import { goToQuotes } from './goto-quotes.js';

export default async function run(ctx) {
  return goToQuotes(ctx, {
    forward: true,
    chars: ['«', '»'],
    version: { ru: 'Скрипт «Перейти на кавычки v2.9».', en: 'Script "Go to quotes" v2.9.' },
  });
}
