// Converted from FictionBook Editor 2.7.9: Scripts/18_Мелочи редактирования/18_Удалить все пробелы и дефисы в выделении.js
// (Sclex, v1.3; first converted from 2.7beta1's 06_Удаление пробелов и дефисов.js).
// Removes every space, non-breaking space and hyphen from the selected text, keeping its
// formatting, and leaves the processed text selected; without a text selection it says "Ничего не
// выделено!". See strip-lib.js.
// The original's notice, kept as written (FR-029):
// Скрипт "Удалить все пробелы и дефисы в выделении". Автор - Sclex
// v1.3
import { stripSelectedText } from './strip-lib.js';

export default async function run(ctx) {
  await stripSelectedText(ctx, /[- \u00A0]+/g);
}
