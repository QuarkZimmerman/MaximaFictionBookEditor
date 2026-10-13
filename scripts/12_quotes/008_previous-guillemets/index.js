// Converted from 12_Обработка кавычек/008_Переход на пред. елочки.js (FictionBook Editor).
// Selects the previous guillemet («») after the caret; offers to continue from the other end of
// the book when the beginning is reached.
import { goToQuotes } from './goto-quotes.js';

export default async function run(ctx) {
  await goToQuotes(ctx, { direction: 'backward', chars: ['«', '»'] });
}
