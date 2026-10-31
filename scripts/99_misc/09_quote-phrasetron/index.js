// Converted from FictionBook Editor 2.7.9: Scripts/99_Прочее/09_Цитатный фразотрон.js
// Looks in the book's bodies (not in the notes or comments) for sentences around keywords -
// Родина, смысл жизни, Путин, путинский, разум, отчизна, мудрость, истина - and shows them in a
// window, broken into lines of about 47 characters, each under a heading of diamonds (five for a
// quotation naming Путин, three for the others). Titles, subtitles and text authors are left
// out; a stanza is searched as a whole. At most Max_tsitat quotations. With SaveTsitat it offers
// to copy them, with the book's authors and title, to the clipboard. Its settings are the section
// "НАСТРОЙКИ" below; to change them, copy this folder into your scripts folder (Scripts > Open
// scripts folder), give the copy a new "id" in its script.json and edit it. Another script may run
// this one with settings of its own (the names below) in the args of mfbe.scripts.run; run()
// returns the text of the window of results.
// Differences from the original: the window is one message box, which scrolls: the original's
// pages ("Показать следующую страницу?") and its setting for the height of the window
// (Vysota_teksta) are gone; run() returns the text of the window (the original's Run() returned
// nothing); in the English interface the window's own lines are in English; the book's authors and
// title come from the document's description (the original read the fields of the Description
// form). Notes: docs/scripting/notes-279-drafts/99.md.
// The original's notice, kept as written (FR-029):
//======================================
//             «Цитатный фразотрон»
//  Поиск цитат по ключевым словам
//======================================
// Скрипт тестировался в FBE v.2.7.7 (win XP, IE8 и win 7, IE11)
// * История изменений в конце скрипта
//======================================
//--------------------------------------------------------------------
                 ///  НАСТРОЙКИ
//--------------------------------------------------------------------
         //   •  Максимум строк в окне
//  * Скрипт постарается не превышать это значение.
// * Для монитора 1024х768 максимальная высота окна равна 52 строкам (в win XP) и 50 строк (в win 7).
// ** Высота одной строки равна 13 пикселям, плюс рамка 87 пикселей (в win XP) или 116 пикселей (в win 7).
//--------------------------------------------------------------------
         //   •  Максимальное количество цитат

import { phrasetron } from './lib/phrasetron.js';

export default async function run(ctx) {
  const W = [];
  let n = 0;

//--------------------------------------------------------------------
                 ///  НАСТРОЙКИ
                 ///  SETTINGS
//--------------------------------------------------------------------

         //   •  Максимальное количество цитат
         //   •  The largest number of quotations

 var Max_tsitat = 100;

// ---------------------------------------------------------------

         //   •  Ключевые слова
         //   •  The keywords (regular expressions)

 W[n++] = "Родин[а-я]{1,2}";     // Родина
 W[n++] = "[Сс]мысл[а-я]{0,2} жизни";     // Смысл жизни
 W[n++] = "Путин[а-я]{0,2}";     // Путин
 W[n++] = "[Пп]утинск[а-я]{2,3}";     // Путинский
 W[n++] = "[Рр]азум[а-я]{0,3}";     // Разум
 W[n++] = "[Оо]тчизн[а-я]{1,2}";     // Отчизна
 W[n++] = "[Мм]удр[а-я]{0,5}";     // Мудрость
 W[n++] = "[Ии]стин[а-я]{0,3}";     // Истина

  //  Здесь можно удалить ненужные ключевые слова, удаляя/заменяя строку или добавляя символы "//" в начале строки (тем самым отправив их в комментарий).
  //  Или можно добавить свои варианты. При этом использовать регулярные выражения желательно, но не обязательно.
  //  Remove a keyword by deleting its line or putting "//" in front of it, or add your own; a
  //  regular expression is welcome but not required.

// ---------------------------------------------------------------

       //   •  Подчеркивать ключевые слова
       //   •  Underline the keywords

 var Podcherkivat_slova = 0;      // 0 ; 1 //      ("0" — отключить, "1" — включить)
 //                                              ("0" — off, "1" — on)

// ---------------------------------------------------------------

       //   •  Сохранение цитат в буфере обмена
       //   •  Offer to copy the quotations to the clipboard

 var SaveTsitat = 0;      // 0 ; 1 //      ("0" — отключить, "1" — включить)
 //                                      ("0" — off, "1" — on)

// ---------------------------------------------------------------

  const settings = { W, Max_tsitat, Podcherkivat_slova, SaveTsitat };
  if (ctx.startedBy === 'script' && ctx.args && typeof ctx.args === 'object' && !Array.isArray(ctx.args)) {
    Object.assign(settings, ctx.args);
  }
  return phrasetron(ctx, settings, (ru, en) => (ctx.uiLanguage === 'ru' ? ru : en));
}
