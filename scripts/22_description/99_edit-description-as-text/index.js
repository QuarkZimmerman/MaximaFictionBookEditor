// Converted from FictionBook Editor 2.7.9: Scripts/22_Дескрипшен/99_Редакция описания документа.js
// Opens the text data of the book's description to editing, in two steps. The first run puts
// them into a body of their own, "Раздел «description-1.z.<code>»" (title, authors, keywords,
// translators and sequences of <title-info> and <src-title-info>, authors, programs and source
// OCR of <document-info>, the fields and sequences of <publish-info>, <custom-info>), with an
// explanation; edit it by hand or with other scripts. The second run writes them back into the
// description with automatic clean-up (spaces, repeated names, the dates and languages it can
// complete), removes the body, raises the file's version with a history line and shows what it
// changed. With Pause = 0 both steps run at once: the automatic clean-up alone. Its settings are
// the section "НАСТРОЙКИ" below; to change them, copy this folder into your scripts folder
// (Scripts > Open scripts folder), give the copy a new "id" in its script.json and edit it.
// Differences from 2.7.9 (lib/edit-description.js): the work is done on the document's
// description and a body of the book; the body is placed after the book's first body, not before
// it (a script cannot remove the first body); FB2 needs content after a section's title and
// annotation, so an empty line follows a book title, a sequence and the explanation; the caret
// goes to the new body's title (2.7.9 only scrolled there); the name of a person in error is
// selected, not coloured; the reminder about the caret in a field of the Description form and
// the setting for the height of the window are gone (the editor has neither problem), so are the
// pages of the window (a long message scrolls); main.js's "fbeUserName" is not read; the
// results show no proverb (left out pending the requester's decision); fields the body's text does
// not hold (a translator's or document author's id, second e-mails and home pages, a sequence's
// language) are kept for the names left unchanged; a sequence number that is not an integer is
// left out. Another script may run this one with settings of its own (the names below) and
// "today" (YYYY-MM-DD) in the args of mfbe.scripts.run. Fixed: a name without a name or nickname
// before the end of a list no longer stops the script; texts are looked for in the history as
// written, not as regular expressions; a date value with month 00 no longer gives the month
// "undefined"; a source language copied into <src-title-info> is reported as "Язык".
// The original's notice, kept as written (FR-029):
//------------------------------------------------------------------------------------------
//             «Редакция описания документа»
//  Скрипт предназначен для открытия широкого доступа к текстовым данным дескрипшена + автоматическая обработка.
//  * Скрипт тестировался в FBE v.2.7.8 (win XP, IE8 и win 7, IE11)
// v.1.0 — Создание скрипта — Александр Ка (6.06.2025)
// v.1.1 — Расширение настроек, исправление ошибок — Александр Ка (17.06.2025)
//------------------------------------------------------------------------------------------

import { editDescription } from './lib/edit-description.js';

export default async function run(ctx) {

// ---------------------------------------------------------------
                 ///  НАСТРОЙКИ
                 ///  SETTINGS
// ---------------------------------------------------------------

 //   Сохранить паузу между двумя этапами для дополнительной обработки. При отключении будут производится только автоматические операции, только этого скрипта.
 //   Keep the pause between the two steps for editing. Off: the automatic operations of this script alone, in one run.
 var Pause = 1;      // 0 ; 1 //      ("0" — Отключить паузу, "1" — Сохранить основной режим)
 //                                   ("0" — no pause, "1" — the two steps)

 //   Показывать пустые данные. При включении можно вручную заполнять пустые значения
 //   Show empty data, so that empty values can be filled in by hand
 var ShowEmpty = 1;      // 0 ; 1 //      ("0" — Скрыть, "1" — Показывать всё, что можно)
 //                                       ("0" — hide, "1" — show all that can be shown)

 //   Порядок в именах авторов
 //   The order of the parts of a name
 var FIO = 1;      // 0 ; 1 //      ("0" — Имя Отчество Фамилия, "1" — Фамилия Имя Отчество)
 //                                 ("0" — first middle last, "1" — last first middle)

 //   При импорте в <body>, сохранять исходное деление на "Фамилия Имя Отчество"
 //   Keep the division of a name into its parts (shown with "|") in the body
 var Delenie = 1;      // 0 ; 1 //      ("0" — Не сохранять, при возвращении в <description> имена будет заново разделены скриптом, "1" — Сохранять)
 //                                     ("0" — no, the script divides the names again on the way back, "1" — keep)
 //   * Алгоритм деления текста на "Фамилия Имя Отчество" у скрипта не идеальный.
 //   * The script's way of dividing a name is not perfect.

 //   Сортировать имена авторов и переводчиков по алфавиту
 //   Sort the names of authors and translators
 var Sortirovka = 0;      // 0 ; 1 //      ("0" — Сохранить исходный порядок, "1" — Сортировать)
 //                                        ("0" — keep their order, "1" — sort)

 //  Сохранение повторного значения языка в поле "Язык оригинала"
 //  A source language equal to the language
 var DelLang = 1;      // 0 ; 1 //      ("0" — Удалить повторное значение, "1" — Сохранить)
 //                                     ("0" — remove it, "1" — keep it)

// ---------------------------------------------------------------

         //  Отображение в <body> (отключение обезопасит данные от случайного изменения другими скриптами)
         //  The lists shown in the body (a list not shown is safe from other scripts)

 var ShowAuthorTI = 1;      // 0 ; 1 //      ("0" — Скрыть авторов <title-info>, "1" — Показывать)
 var ShowTranslatorTI = 1;      // 0 ; 1 //      ("0" — Скрыть переводчиков <title-info>, "1" — Показывать)
 var ShowSequenceTI = 1;      // 0 ; 1 //      ("0" — Скрыть серии <title-info>, "1" — Показывать)

 var ShowAuthorSTI = 1;      // 0 ; 1 //      ("0" — Скрыть авторов <src-title-info>, "1" — Показывать)
 var ShowTranslatorSTI = 1;      // 0 ; 1 //      ("0" — Скрыть переводчиков <src-title-info>, "1" — Показывать)
 var ShowSequenceSTI = 1;      // 0 ; 1 //      ("0" — Скрыть серии <src-title-info>, "1" — Показывать)

 var ShowAuthorDI = 1;      // 0 ; 1 //      ("0" — Скрыть авторов <document-info>, "1" — Показывать)

 var ShowSequencePI = 1;      // 0 ; 1 //      ("0" — Скрыть серии <publish-info>, "1" — Показывать)
 //                                           ("0" — hide the authors / translators / sequences of that part, "1" — show them)

// ---------------------------------------------------------------

 //  Отображение пояснения к скрипту
 //  The explanation of the script in the body
 var Pojasnenie = 1;      // 0 ; 1 //      ("0" — Отключить, "1" — Показывать)
 //                                        ("0" — off, "1" — show it)

// ---------------------------------------------------------------

         //  Автоматическое повышение версии файла и запись в историю изменений
         //  Raising the file's version and writing a line into its history

 var Version_on_off = 1;      // 0 ; 1 //      ("0" — отключить, "1" — включить)
 //                                            ("0" — off, "1" — on)

//  Добавлять, если не сделано ни одного исправления
//  Also when nothing was changed
 var Vsegda_on_off = 0;      // 0 ; 1 //      ("0" — отключить, "1" — включить)

//   Имя используемое в добавленной записи:
//   The name written in the history line:
 var youName = "Зорро";

//  * Для записи имени можно использовать почти любые символы.
//     Исключения:   |  "  |  \  |    Но и любой из этих знаков можно добавить, если поставить перед ним наклонную черту ("\"), например: "\\" = "\"
//     Или можно оставить кавычки пустыми (""), тогда строка в истории будет без имени.
//  * Almost any characters may be used; write " as \" and \ as \\. Empty quotes ("") write the
//    history line without a name.

// ---------------------------------------------------------------
// ----------------------------------------------
// -----------------------------

 return editDescription(ctx, {
   Pause, ShowEmpty, FIO, Delenie, Sortirovka, DelLang,
   ShowAuthorTI, ShowTranslatorTI, ShowSequenceTI, ShowAuthorSTI, ShowTranslatorSTI, ShowSequenceSTI, ShowAuthorDI, ShowSequencePI,
   Pojasnenie, Version_on_off, Vsegda_on_off, youName,
 });

 }
