// Converted from FictionBook Editor 2.7.9: Scripts/07_Символы/08_Английская транскрипция.js
// The table of the symbols of English phonetic transcription (ˌ ˈ ǝ æ ʌ ɜ ɛ ɪ ʤ ʒ ɑ ŋ ʃ ɡ θ ʊ ɒ ð ʧ ɔ
// u i :). The original opened it as a modeless HTML dialog (HTML/Английская транскрипция.html):
// a click on a cell put the symbol in place of the selection of the Body view and the caret
// after it, and the dialog stayed open for the next click. Here the table is a list in a form
// (modal, one symbol per run, the run one undo step as each click was): the chosen symbol
// replaces the selection, a caret gets it inserted, and the caret goes after it. The dialog's
// blank cells (its grid had 120 cells for 23 symbols) are not listed; with the caret outside
// the book text the script says so (the original did nothing).
// The original's notice, kept as written (FR-029):
//Таблица символов английской транскрипции
//                                jurgennt™, май 2008 г.
//                          script engene by Sclex v.1.3
//                          таблица: stokber, май 2024

import { insertFromTable, t } from './lib/symbol-table.js';
import { SYMBOLS } from './symbols.js';

export default async function run(ctx) {
  await insertFromTable(ctx, t(ctx, 'Символы английской транскрипции', 'English transcription symbols'), SYMBOLS);
}
