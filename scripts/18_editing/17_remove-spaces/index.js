// Converted from 18_Мелочи редактирования/01_Удаление пробелов.js (FictionBook Editor 2.7), Tier 1.
// Removes spaces and non-breaking spaces from the selected text; formatting is kept.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
//"Удаление пробелов" by Sclex
//v1.1
//вид обработки, которой подвергается выделенный текст
// 1 - перевод в верний регистр
// 2 - перевод в верний регистр
import { stripSelectedText } from './strip-lib.js';

export default async function run(ctx) {
  await stripSelectedText(ctx, /[ \u00A0]/g);
}
