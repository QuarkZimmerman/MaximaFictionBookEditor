// Converted from 06_Чистка/20_Символы win-1252 (слова)....js (FictionBook Editor): the three-frame HTML
// dialog became a form per finding; see win1252.js. This variant offers each whole word.
import { win1252 } from './win1252.js';

export default async function run(ctx) {
  await win1252(ctx, { mode: 'words' });
}
