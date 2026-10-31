// Converted from 12_Обработка кавычек/009_Переход на пред. лапки.js (FictionBook Editor).
// Selects the previous low/high quote („“”) after the caret; offers to continue from the other end of
// the book when the beginning is reached.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
//Переход на кавычки v2.7
//Автор Sclex
//Подробности тут: http://www.fictionbook.org/forum/viewtopic.php?f=7&t=4412
//И тут: http://scripts.fictionbook.org
import { goToQuotes } from './goto-quotes.js';

export default async function run(ctx) {
  await goToQuotes(ctx, { direction: 'backward', chars: ['„', '“', '”'] });
}
