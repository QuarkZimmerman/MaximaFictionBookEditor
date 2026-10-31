// Converted from FictionBook Editor 2.7.9: Scripts/02_Примечания/35_Поиск возможных маркеров сносок.js
// Searches for what may be footnote markers not marked up yet: a number in superscript after a
// space (maybe a footnote text glued to the paragraph), a superscript at the start or in the
// middle of a paragraph, digits, apostrophes or asterisks stuck to text or to digits (a space
// between allowed for some), digits after a punctuation mark, an asterisk after a letter and a
// punctuation mark, an asterisk at the start of a paragraph that is not a subtitle. The search
// goes paragraph by paragraph from the end of the selection to the end of the book with the
// older engine of "Поиск по набору регэкспов" (marker-search.js): a collapsed caret starts one
// character on; the earliest match in the first paragraph with one is selected and its
// description shown in the status bar; nothing found - a message. Like the original's, run()
// returns nothing. The expressions are the original's, as JScript read its strings.
// Differences from 2.7.9: docs/scripting/conversion-notes-279-a.md (group 02).
// The original's notice, kept as written (FR-029):
// Скрипт «Поиск возможных маркеров сносок» для редактора Fiction Book Editor (FBE).
// Версия 1.0 (20.02.2022)
// Автор исходного скрипта "Поиск по набору регэкспов" - Sclex.
//  _________________________________________________________________________
  //  _________________________________________________________________________
  //  ВАЖНО!!!
  //  _________________________________________________________________________
  // ТУТ НАДО НАСТРОИТЬ СПИСОК МАКРОСОВ
// -------------начало блока регэкспы (20.02.2022)---------------
// Это все, что будет с тегами. Остальное — addRegExp-ы. Это, по сути, те же регулярки, только косую черту надо будет удвоить.

import { createMarkerSet, runMarkerSearch } from './marker-search.js';

const APOSTROPHES = "[’＇'`‘՚′ʹꞌꞋ᾿°]+";
const SPACE = '[\\x20\\xA0\\t\\n\\r\\f]';

export default async function run(ctx) {
  const set = createMarkerSet();
  // -------------начало блока регэкспы (20.02.2022)---------------
  set.tagRegExp(`(?<=${SPACE})<sup>\\d+?</sup>`, '', {
    ru: 'Найдено: Пробел перед маркером сноски, возможно приклеившийся абзац текста сноски',
    en: 'Found: a space before a footnote marker, maybe a footnote text glued to the paragraph',
  });
  set.tagRegExp('^<sup>.+?</sup>', '', {
    ru: 'Найдено: Верхний индекс в начале абзаца',
    en: 'Found: a superscript at the start of the paragraph',
  });
  set.tagRegExp('(?<!^)<sup>.+?</sup>', '', {
    ru: 'Найдено: Верхний индекс в середине абзаца',
    en: 'Found: a superscript in the middle of the paragraph',
  });
  // Это все, что будет с тегами. Остальное — addRegExp-ы.
  set.addRegExp('(?<=[A-Za-zА-яЁё])\\d+', 'i', { ru: 'Найдено: Прилипшие к тексту цифры', en: 'Found: digits stuck to text' });
  set.addRegExp('(?<=[.,:;\\)»”“?!…"])\\d+', '', {
    ru: 'Найдено: Прилипшие к знакам препинания цифры',
    en: 'Found: digits stuck to punctuation marks',
  });
  set.addRegExp(`(?<=[A-Za-zА-яЁё])${APOSTROPHES}`, 'i', { ru: 'Найдено: Прилипшие к тексту апострофы', en: 'Found: apostrophes stuck to text' });
  set.addRegExp(`(?<=[0-9])${APOSTROPHES}`, 'i', { ru: 'Найдено: Прилипшие к цифрам апострофы', en: 'Found: apostrophes stuck to digits' });
  set.addRegExp(`(?<=[A-Za-zА-яЁё])${SPACE}${APOSTROPHES}`, 'i', {
    ru: 'Найдено: Текст с пробелом и апострофом',
    en: 'Found: text, a space and an apostrophe',
  });
  set.addRegExp(`(?<=[0-9])${SPACE}${APOSTROPHES}`, 'i', {
    ru: 'Найдено: Цифры с пробелом и апострофом',
    en: 'Found: digits, a space and an apostrophe',
  });
  set.addRegExp('(?<=[A-Za-zА-яЁё])[*]+', 'i', { ru: 'Найдено: Прилипшие к тексту звездочки', en: 'Found: asterisks stuck to text' });
  set.addRegExp('(?<=[A-Za-zА-яЁё])[»….,:;!\\?-—–][*]+', 'i', {
    ru: 'Найдено: Звездочки после знаков препинания',
    en: 'Found: asterisks after punctuation marks',
  });
  set.addRegExp(`(?<=[A-Za-zА-яЁё])${SPACE}[\\*]+`, 'i', {
    ru: 'Найдено: Текст с пробелом и звездочками',
    en: 'Found: text, a space and asterisks',
  });
  set.addRegExp('^[*]', '', {
    ru: 'Найдено: звездочки в начале строки, но не сабтайтлы',
    en: 'Found: asterisks at the start of the line, not in a subtitle',
  }, '-subtitle');
  // -------------конец блока регэкспы (20.02.2022)---------------
  await runMarkerSearch(ctx, set);
}
