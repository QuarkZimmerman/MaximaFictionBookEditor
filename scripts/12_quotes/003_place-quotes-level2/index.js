// Converted from 12_Обработка кавычек/003_Расстановка елочек и лапок (начиная со 2-го уровня).js (FictionBook Editor).
// Turns straight quotes into typographic ones in the selection, assuming it starts inside an open level-1 quote; see quotes.js for the rules.
import { placeQuotes } from './quotes.js';

export default async function run(ctx) {
  await placeQuotes(ctx, { startLevel: 2 });
}
