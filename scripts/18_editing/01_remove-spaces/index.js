// Converted from 18_Мелочи редактирования/01_Удаление пробелов.js (FictionBook Editor 2.7), Tier 1.
// Removes spaces and non-breaking spaces from the selected text; formatting is kept.
import { stripSelectedText } from './strip-lib.js';

export default async function run(ctx) {
  await stripSelectedText(ctx, /[ \u00A0]/g);
}
