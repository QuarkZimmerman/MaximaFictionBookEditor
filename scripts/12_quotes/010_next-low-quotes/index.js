// Converted from 12_Обработка кавычек/010_Переход на след. лапки.js (FictionBook Editor).
// Selects the next low/high quote („“”) after the caret; offers to continue from the other end of
// the book when the end is reached.
import { goToQuotes } from './goto-quotes.js';

export default async function run(ctx) {
  await goToQuotes(ctx, { direction: 'forward', chars: ['„', '“', '”'] });
}
