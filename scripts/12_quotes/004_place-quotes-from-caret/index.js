// Converted from 12_Обработка кавычек/004_Расстановка елочек и лапок (с позиции курсора).js (FictionBook Editor).
// Turns straight quotes into typographic ones from the caret to the end of the book; see quotes.js for the rules.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
//Скрипт "Новые кавычки на елочки"
//Автор Sclex
//Подробности тут: http://www.fictionbook.org/forum/viewtopic.php?f=7&t=4412
//И тут: http://scripts.fictionbook.org
import { placeQuotes } from './quotes.js';

export default async function run(ctx) {
  await placeQuotes(ctx, { startLevel: 0, fromCursor: true });
}
