// Converted from 06_Чистка/20_Символы win-1252 (слова)....js (FictionBook Editor): the three-frame HTML
// dialog became a form per finding; see win1252.js. This variant offers each whole word.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
// Скрипт «Символы windows-1252 в файле windows-1251
// Автор Sclex
import { win1252 } from './win1252.js';

export default async function run(ctx) {
  await win1252(ctx, { mode: 'words' });
}
