// Converted from 21_Поиск и замена/10_Поиск по набору регэкспов (заготовка).js (FictionBook
// Editor 2.7), Tier 1. A template: put your own regular expressions into buildSet() below and
// the script will select, run after run, the next hit after the caret and show the matching
// description in the status bar. As delivered it contains one empty expression whose
// description tells the user to edit the script, exactly like the original template.
//
// HOW TO FILL THE LIST (translated from the original instructions):
//   set.addMacros("<name>", "regexp");
//     A named sub-pattern for tagRegExp entries. Allowed characters in the name: а-я, a-z,
//     "/", "?", "-", "_". Earlier macros may be used inside later ones.
//   set.addRegExp("regexp", "keys", "description", "in which tags");
//     Backslashes inside the string must be doubled; a straight quote needs one backslash: \".
//     "keys" is "" (case-sensitive, the default) or "i" (case-insensitive).
//     "description" is shown in the status bar when the expression finds something.
//     "in which tags" lists "+element" / "-element" pairs separated by spaces, e.g.
//     "+poem -stanza +title" searches only paragraphs inside <poem> and <title> but not inside
//     <stanza>. Allowed elements: section, body, epigraph, cite, poem, stanza, title,
//     subtitle, text-author. Inline elements are not allowed here.
//     Examples:
//       set.addRegExp("\\d-\\d", "", "Found: two digits with a hyphen between them.");
//       set.addRegExp("\"", "", "Found: a straight quote.");
//     To put the caret in front of the found text instead of selecting it, use a look-ahead:
//       set.addRegExp("(?=\")", "", "Found: a straight quote.");
//     Look-behind constructs (?<!…) and (?<=…) are allowed only at the start of the expression
//     and apply to the whole rest of it: (?<=а)б|в finds "б or в preceded by а".
//   set.tagRegExp("regexp", "keys", "description", "in which tags");
//     Same, but the expression sees the inline formatting as tags and may use the macros
//     <emphasis>, </emphasis>, <strong>, </strong>, <sup>, </sup>, <sub>, </sub>,
//     <strikethrough>, </strikethrough>, <code>, </code>, <любые-теги> ("any tags").
//     Example (italics inside a word):
//       set.tagRegExp("[а-яё]<emphasis>[а-яё]+?</emphasis>|<emphasis>[а-яё]+?</emphasis>[а-яё]", "i", "Found: italics inside a word.");
//     The old fifth argument (a look-behind length limit) is accepted and ignored: the
//     editor's JavaScript has real look-behind.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
//Скрипт «Поиск по набору регэкспов»
//Версия 2.9
//Автор Sclex
import { createRegExpSet, searchWithSet } from './regexp-search.js';

function buildSet(ctx) {
  const set = createRegExpSet();
  // SET UP YOUR LIST HERE. Remove or comment out the next line when you add your own entries.
  set.addRegExp('', 'i', ctx.uiLanguage === 'ru'
    ? 'Задайте список регэкспов, отредактировав файл index.js этого скрипта в текстовом редакторе (кодировка UTF-8). Инструкция — в скрипте.'
    : 'Set up the list of regular expressions by editing this script\'s index.js in a text editor (UTF-8). The instructions are in the script.');
  // set.addMacros("<откр-закр-em-str>", "<emphasis>|</emphasis>|<strong>|</strong>");
  // set.tagRegExp("([а-яёa-z]<откр-закр-em-str>*)*?[а-яёa-z]<откр-закр-em-str>*?(<emphasis><strong>|<strong><emphasis>|</strong></emphasis>|</emphasis></strong>)<откр-закр-em-str>*([а-яёa-z]<откр-закр-em-str>*)+", "i", "Найдено: курсивность части слова.");
  // set.tagRegExp("[а-яё]<emphasis>[а-яё]+?</emphasis>|<emphasis>[а-яё]+?</emphasis>[а-яё]", "i", "Найдено: курсивность части слова.");
  return set;
}

export default async function run(ctx) {
  await searchWithSet(ctx, buildSet(ctx));
}
