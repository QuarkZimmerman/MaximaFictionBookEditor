// Converted from FictionBook Editor 2.7.9: Scripts/06_Чистка/20_Символы win-1252, истолкованные как
// win-1251 ('cafй' и т.п.) (поиск слов)....js (2.7beta1's 20_Символы win-1252 (слова)....js before
// feature 007). The three-frame HTML dialog (version 1.5) became a form per finding; see
// win1252.js. This variant offers each whole word.
// The original's notice, kept as written (FR-029):
// Скрипт «Символы windows-1252 в файле windows-1251
// Автор Sclex
import { win1252 } from './win1252.js';

export default async function run(ctx) {
  await win1252(ctx, { mode: 'words' });
}
