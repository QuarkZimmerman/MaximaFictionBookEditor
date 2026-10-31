// Converted from FictionBook Editor 2.7.9: Scripts/18_Мелочи редактирования/20_Удалить все символы подчеркивания в выделении.js
// Removes every underscore from the selected text, keeping its formatting, and leaves the
// processed text selected; without a selection it says "Ничего не выделено!". The original is
// the sibling of "Удалить все пробелы в выделении" (17) with the expression [_]+; strip-lib.js is
// the helper of that sibling's package, copied unchanged. No difference from the original.
// The original's notice, kept as written (FR-029):
// Скрипт "Удалить все символы подчеркивания в выделении". Автор - Sclex
// v1.3
import { stripSelectedText } from './strip-lib.js';

export default async function run(ctx) {
  await stripSelectedText(ctx, /[_]+/g);
}
