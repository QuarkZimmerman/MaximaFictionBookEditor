// Converted from 12_Обработка кавычек/014_Переход на след. прямые кавычки, елочки или лапки.js (FictionBook Editor).
// Selects the next quote of any kind after the caret; offers to continue from the other end of
// the book when the end is reached.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
//Переход на кавычки v2.7
//Автор Sclex
//Подробности тут: http://www.fictionbook.org/forum/viewtopic.php?f=7&t=4412
//И тут: http://scripts.fictionbook.org
import { goToQuotes } from './goto-quotes.js';

export default async function run(ctx) {
  await goToQuotes(ctx, { direction: 'forward', chars: ['«', '»', '„', '“', '”', '"'] });
}
