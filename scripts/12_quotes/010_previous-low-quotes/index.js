// Converted from FictionBook Editor 2.7.9: Scripts/12_Обработка кавычек/010_Перейти на предыдущие лапки.js
// (Sclex, version 2.9; first converted from 2.7beta1's 009_Переход на пред. лапки.js).
// Selects the previous of [„, “, ”] from the start of the selection; see goto-quotes.js.
// The original's notice, kept as written (FR-029):
//Перейти на кавычки v2.9
//Автор Sclex
//Подробности тут: http://www.fictionbook.org/forum/viewtopic.php?f=7&t=4412
//И тут: http://scripts.fictionbook.org
import { goToQuotes } from './goto-quotes.js';

export default async function run(ctx) {
  return goToQuotes(ctx, {
    forward: false,
    chars: ['„', '“', '”'],
    version: { ru: 'Скрипт «Перейти на кавычки v2.9».', en: 'Script "Go to quotes" v2.9.' },
  });
}
