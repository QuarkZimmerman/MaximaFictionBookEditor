// Converted from 06_Чистка/19_Символы win-1252 (буквы)....js (FictionBook Editor): the three-frame HTML
// dialog became a form per finding; see win1252.js. This variant offers each single letter.
import { win1252 } from './win1252.js';

export default async function run(ctx) {
  await win1252(ctx, { mode: 'letters' });
}
