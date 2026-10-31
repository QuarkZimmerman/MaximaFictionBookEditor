// Converted from FictionBook Editor 2.7.9: Scripts/12_Обработка кавычек/007_Проставить только елочки (во всем документе).js
// (Sclex, version 3.7; first converted from 2.7beta1's 015_Расстановка только елочек.js).
// Turns the straight quotes of the selection, or of the whole book, into « and »; undecided ones stay straight; see quotes.js for the rules and the differences from the original.
// The original's notice, kept as written (FR-029):
//Скрипт "Новые кавычки на елочки"
//Автор Sclex
//Подробности тут: http://www.fictionbook.org/forum/viewtopic.php?f=7&t=4412
//И тут: http://scripts.fictionbook.org
import { placeQuotes } from './quotes.js';

export default async function run(ctx) {
  await placeQuotes(ctx, {
    version: {
      ru: "Скрипт «Проставить только елочки» (версия 3.7)",
      en: "Script \"Place guillemets only\" (version 3.7)",
    },
    onlyGuillemets: true,
  });
}
