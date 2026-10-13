// Converted from 12_Обработка кавычек/005_Расстановка елочек и лапок (с позиции курсора, начиная с 1-го уровня).js (FictionBook Editor).
// Turns straight quotes into typographic ones from the caret to the end of the book, assuming the caret is inside an open level-0 quote; see quotes.js for the rules.
import { placeQuotes } from './quotes.js';

export default async function run(ctx) {
  await placeQuotes(ctx, { startLevel: 1, fromCursor: true });
}
