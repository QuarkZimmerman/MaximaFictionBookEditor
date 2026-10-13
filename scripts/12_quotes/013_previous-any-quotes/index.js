// Converted from 12_Обработка кавычек/013_Переход на пред. прямые кавычки, елочки или лапки.js (FictionBook Editor).
// Selects the previous quote of any kind after the caret; offers to continue from the other end of
// the book when the beginning is reached.
import { goToQuotes } from './goto-quotes.js';

export default async function run(ctx) {
  await goToQuotes(ctx, { direction: 'backward', chars: ['«', '»', '„', '“', '”', '"'] });
}
