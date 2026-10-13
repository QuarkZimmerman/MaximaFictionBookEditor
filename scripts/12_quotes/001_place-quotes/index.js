// Converted from 12_Обработка кавычек/001_Расстановка елочек и лапок.js (FictionBook Editor).
// Turns straight quotes into typographic ones in the selection (or the whole book); see quotes.js for the rules.
import { placeQuotes } from './quotes.js';

export default async function run(ctx) {
  await placeQuotes(ctx, { startLevel: 0 });
}
