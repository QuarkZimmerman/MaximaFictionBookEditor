// Converted from FictionBook Editor 2.7.9: Scripts/18_Мелочи редактирования/39_Исправление крякозябров (кривые кодировки).js
// Repairs Russian text that was read in the wrong encoding - Windows-1251 letters shown as their
// Windows-1252 namesakes ("Ïðèâåò" for "Привет") - in the selected text: each such character
// becomes the Cyrillic letter, the formatting stays and the text stays selected. Without a
// selection it asks to select text. Like the original, which was built on Sclex's case script,
// it uses that script's helper (case-lib.js, copied unchanged from the converted case scripts).
// Difference from the original (a fix): "×" becomes "Ч" and "ß" becomes "Я". The original's table
// had the key "÷" twice (for "Ч" and for "ч"; in an object literal the second wins, so "Ч" was
// never restored) and "Ÿ" instead of "ß" for "Я"; "Ÿ" is left alone now. Scripts see the Body
// view's selection only: the original also worked in a text field of the description.
// See docs/scripting/notes-279-drafts/18.md.
// The original's notice, kept as written (FR-029):
//скрипт "Исправление крякозябров (кривые кодировки)"  by Sclex 
// доработка до заявленного функционала - stokber.
//v1.11
// создан на базе скрипта замены регистра за авторством Sclex-а.
import { selectedBlocks, t, transformSelection } from './case-lib.js';

// The original's table in its order; fixed: "×" (was the second "÷") for "Ч", "ß" (was "Ÿ") for "Я".
const SUMBOL = {
  'À': 'А', 'Á': 'Б', 'Â': 'В', 'Ã': 'Г', 'Ä': 'Д', 'Å': 'Е', '¨': 'Ё', 'Æ': 'Ж', 'Ç': 'З',
  'È': 'И', 'É': 'Й', 'Ê': 'К', 'Ë': 'Л', 'Ì': 'М', 'Í': 'Н', 'Î': 'О', 'Ï': 'П', 'Ð': 'Р',
  'Ñ': 'С', 'Ò': 'Т', 'Ó': 'У', 'Ô': 'Ф', 'Õ': 'Х', 'Ö': 'Ц', '×': 'Ч', 'Ø': 'Ш', 'Ù': 'Щ',
  'Ú': 'Ъ', 'Û': 'Ы', 'Ü': 'Ь', 'Ý': 'Э', 'Þ': 'Ю', 'ß': 'Я', 'à': 'а', 'á': 'б', 'â': 'в',
  'ã': 'г', 'ä': 'д', 'å': 'е', '¸': 'ё', 'æ': 'ж', 'ç': 'з', 'è': 'и', 'é': 'й', 'ê': 'к',
  'ë': 'л', 'ì': 'м', 'í': 'н', 'î': 'о', 'ï': 'п', 'ð': 'р', 'ñ': 'с', 'ò': 'т', 'ó': 'у',
  'ô': 'ф', 'õ': 'х', 'ö': 'ц', '÷': 'ч', 'ø': 'ш', 'ù': 'щ', 'ú': 'ъ', 'û': 'ы', 'ü': 'ь',
  'ý': 'э', 'þ': 'ю', 'ÿ': 'я',
};
const KEYS = new RegExp(`[${Object.keys(SUMBOL).join('')}]`, 'g');

export default async function run(ctx) {
  const selection = await selectedBlocks(false);
  if (!selection || selection.collapsed) {
    await mfbe.ui.message(
      t(
        ctx,
        'Выделите текст!\nСкрипт производит замену символов только в выделенном тексте!',
        'Select the text!\nThe script replaces characters in the selected text only!',
      ),
      { icon: 'warning' },
    );
    return;
  }
  await transformSelection(selection, (chunk) => chunk.replace(KEYS, (ch) => SUMBOL[ch]));
}
