// Converted from 12_Обработка кавычек/011_Переход на пред. прямые кавычки.js (FictionBook Editor).
// Selects the previous straight quote (") after the caret; offers to continue from the other end of
// the book when the beginning is reached.
import { goToQuotes } from './goto-quotes.js';

export default async function run(ctx) {
  await goToQuotes(ctx, { direction: 'backward', chars: ['"'] });
}
