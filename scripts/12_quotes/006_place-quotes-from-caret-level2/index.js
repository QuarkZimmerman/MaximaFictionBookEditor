// Converted from 12_Обработка кавычек/006_Расстановка елочек и лапок (с позиции курсора, начиная со 2-го уровня).js (FictionBook Editor).
// Turns straight quotes into typographic ones from the caret to the end of the book, assuming the caret is inside an open level-1 quote; see quotes.js for the rules.
import { placeQuotes } from './quotes.js';

export default async function run(ctx) {
  await placeQuotes(ctx, { startLevel: 2, fromCursor: true });
}
